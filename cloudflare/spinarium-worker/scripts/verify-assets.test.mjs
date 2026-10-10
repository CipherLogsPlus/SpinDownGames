// Local packaging checks only. No Worker deploys, accounts or remote resources.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { unstable_readConfig as readConfig } from 'wrangler';
import { createAuthClient } from '../../../spinarium/auth/cloudflare-auth.js';

const workerRoot = fileURLToPath(new URL('../', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function readWorkerConfig(environment) {
  // Reuse the installed deploy tool's JSONC parser and validation.
  return readConfig({ config: path.join(workerRoot, `wrangler.${environment}.jsonc`) }, { hideWarnings: true });
}

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    assert(!entry.isSymbolicLink(), `Unexpected public symlink: ${relative}`);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

for (const environment of ['staging', 'production']) {
  test(`${environment} package matches its backend account switches`, async () => {
    // Exercise the documented npm release command, not a hand-built flag list.
    execFileSync(npm, ['run', `prepare:${environment}`], { cwd: workerRoot, stdio: 'pipe' });
    const backend = await readWorkerConfig(environment);
    const destination = path.resolve(workerRoot, backend.assets.directory);
    assert.equal(destination, path.join(workerRoot, `.${environment}-assets`));
    const source = await readFile(path.join(destination, 'spinarium/config.js'), 'utf8');
    const { spinariumConfig: frontend } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    for (const flag of ['AUTH_ENABLED', 'SIGNUP_ENABLED']) {
      assert(['true', 'false'].includes(backend.vars[flag]), `Unexpected backend ${flag}`);
    }
    const accountsEnabled = backend.vars.AUTH_ENABLED === 'true';
    const signupEnabled = backend.vars.SIGNUP_ENABLED === 'true';
    assert.equal(frontend.previewEnabled, false);
    assert.equal(frontend.backend, 'cloudflare');
    assert.equal(frontend.authProvider, backend.vars.AUTH_PROVIDER);
    assert.equal(frontend.apiBase, accountsEnabled ? '/api' : '');
    assert.equal(frontend.signupEnabled, signupEnabled);
    assert(!signupEnabled || accountsEnabled, 'Signup must never be enabled without accounts');
    assert.equal(frontend.supabaseUrl, '');
    assert.equal(frontend.supabasePublishableKey, '');
    // This is the real browser adapter: enabled packaging must allow login.
    const client = createAuthClient(frontend, {
      fetchImpl() { throw new Error('Packaging checks must never call an API'); },
    });
    assert.equal(client.configured, accountsEnabled);

    const headers = await readFile(path.join(destination, '_headers'), 'utf8');
    assert.match(headers, /\/spinarium\/config\.js\n  Cache-Control: no-store/);
    assert.equal(headers.includes('X-Robots-Tag: noindex, nofollow'), environment === 'staging');
    const files = await listFiles(destination);
    for (const file of files) {
      assert(!/(^|\/)(cloudflare|supabase|scripts|docs|node_modules|test|tests|\.git)(\/|$)/.test(file), `Private source packaged: ${file}`);
      assert(!/(^|\/)\.(env|dev\.vars)/.test(file), `Environment file packaged: ${file}`);
      assert(!/spinarium\/(auth\/supabase-auth|data\/(supabase-service|demo-service))\.js$/.test(file), `Retired adapter packaged: ${file}`);
    }
    assert(files.includes('index.html'));
    assert(files.includes('spinarium/index.html'));
    assert(!files.includes('package.json'));
    assert(!files.includes('package-lock.json'));
  });
}

test('asset packaging rejects signup without accounts and unknown switches', () => {
  for (const args of [['--signup-enabled'], ['--unknown-option']]) {
    assert.throws(() => execFileSync(process.execPath, ['scripts/prepare-staging-assets.mjs', ...args], {
      cwd: workerRoot, stdio: 'pipe',
    }), (error) => {
      assert.equal(error.status, 1);
      assert.match(error.stderr.toString(), args[0] === '--signup-enabled' ? /Signup requires --accounts-enabled/ : /Unknown asset packaging option/);
      return true;
    });
  }
});
