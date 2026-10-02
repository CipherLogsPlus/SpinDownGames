import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = path.resolve(workerRoot, '../..');
const argumentsSet = new Set(process.argv.slice(2));
const allowedArguments = new Set(['--production', '--accounts-enabled', '--signup-enabled']);
for (const argument of argumentsSet) {
  if (!allowedArguments.has(argument)) throw new Error(`Unknown asset packaging option: ${argument}`);
}
const production = argumentsSet.has('--production');
const outputDirectory = production ? '.production-assets' : '.staging-assets';
const destination = path.join(workerRoot, outputDirectory);
const accountsEnabled = argumentsSet.has('--accounts-enabled');
const signupEnabled = argumentsSet.has('--signup-enabled');
if (signupEnabled && !accountsEnabled) throw new Error('Signup requires --accounts-enabled.');

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
  authProvider: 'password',
  signupEnabled,
  // These switches must match the separately verified backend configuration.
  // When accounts are disabled, the UI fails closed and health remains available.
  apiBase: accountsEnabled ? '/api' : '',
  supabaseUrl: '',
  supabasePublishableKey: '',
};
const configModule = `// Generated ${production ? 'production' : 'staging'} public switches. Contains no credentials.\nexport const spinariumConfig = Object.freeze(${JSON.stringify(publicConfig, null, 2)});\n`;
await writeFile(path.join(destination, 'spinarium/config.js'), configModule);
const assetHeaders = `/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n${production ? '' : '  X-Robots-Tag: noindex, nofollow\n'}\n/spinarium/config.js\n  Cache-Control: no-store\n`;
await writeFile(path.join(destination, '_headers'), assetHeaders);
fileCount += 2;
byteCount += Buffer.byteLength(configModule) + Buffer.byteLength(assetHeaders);
console.log(JSON.stringify({ directory: outputDirectory, files: fileCount, bytes: byteCount, accountsEnabled, signupEnabled }));
