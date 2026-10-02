import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = path.resolve(workerRoot, '../..');
const destination = path.join(workerRoot, '.staging-assets');
const argumentsSet = new Set(process.argv.slice(2));
const allowedArguments = new Set(['--accounts-enabled', '--signup-enabled']);
for (const argument of argumentsSet) {
  if (!allowedArguments.has(argument)) throw new Error(`Unknown staging option: ${argument}`);
}
const accountsEnabled = argumentsSet.has('--accounts-enabled');
const signupEnabled = argumentsSet.has('--signup-enabled');
if (signupEnabled && !accountsEnabled) throw new Error('Staging signup requires --accounts-enabled.');

// A public allowlist prevents backend sources, migrations, tests, documentation,
// dependencies, environment files and Git metadata from becoming website assets.
const rootFiles = [
  'index.html', 'privacy.html', 'terms.html',
  'styles.css', 'legal.css', 'script.js', 'coin-viewer.js',
];
const artworkExtensions = new Set(['.webp', '.png', '.jpg', '.jpeg', '.svg', '.ttf', '.woff', '.woff2', '.glb']);
const siteExtensions = new Set(['.html', '.css', '.js']);
const retiredModules = new Set([
  'spinarium/auth/supabase-auth.js',
  'spinarium/data/supabase-service.js',
  'spinarium/data/demo-service.js',
]);

let fileCount = 0;
let byteCount = 0;
async function copyPublicFile(relativePath) {
  const source = path.join(repositoryRoot, relativePath);
  const output = path.join(destination, relativePath);
  await mkdir(path.dirname(output), { recursive: true });
  await copyFile(source, output);
  fileCount += 1;
  byteCount += (await stat(output)).size;
}

async function copyPublicDirectory(relativePath, include) {
  const entries = await readdir(path.join(repositoryRoot, relativePath), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.')) continue;
    const child = `${relativePath}/${entry.name}`;
    // Never follow a symlink out of the checked-in public trees.
    if (entry.isSymbolicLink()) throw new Error(`A public asset must not be a symlink: ${child}`);
    if (entry.isDirectory()) await copyPublicDirectory(child, include);
    else if (entry.isFile() && include(child)) await copyPublicFile(child);
  }
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const file of rootFiles) await copyPublicFile(file);
await copyPublicDirectory('assets', (file) => artworkExtensions.has(path.extname(file)) || /^assets\/fonts\/[^/]+\.txt$/.test(file));
await copyPublicDirectory('spinarium', (file) => siteExtensions.has(path.extname(file)) && !retiredModules.has(file) && file !== 'spinarium/config.js');

const publicConfig = {
  previewEnabled: false,
  backend: 'cloudflare',
  signupEnabled,
  // Until the secure provider is configured, the UI shows account unavailability
  // and disables its sign-in action. /api/health remains available for staging.
  apiBase: accountsEnabled ? '/api' : '',
  supabaseUrl: '',
  supabasePublishableKey: '',
};
const configModule = `// Generated staging-only public switches. Contains no credentials.\nexport const spinariumConfig = Object.freeze(${JSON.stringify(publicConfig, null, 2)});\n`;
await writeFile(path.join(destination, 'spinarium/config.js'), configModule);
const stagingHeaders = '/*\n  X-Robots-Tag: noindex, nofollow\n\n/spinarium/config.js\n  Cache-Control: no-store\n';
await writeFile(path.join(destination, '_headers'), stagingHeaders);
fileCount += 2;
byteCount += Buffer.byteLength(configModule) + Buffer.byteLength(stagingHeaders);
console.log(JSON.stringify({ directory: '.staging-assets', files: fileCount, bytes: byteCount, accountsEnabled, signupEnabled }));
