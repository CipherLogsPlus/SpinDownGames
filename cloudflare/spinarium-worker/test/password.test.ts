import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createHarness, origin, seedSession } from './support';
import { handlePasswordAuth } from '../src/password-auth';
import { HttpError } from '../src/http';
import { hashPassword } from '../src/password-hash';

const password = 'Saving Veilings safely 2026!';
const differentPassword = 'A different strong phrase 2026!';

function sessionCookie(response: Response): string {
  const match = response.headers.get('set-cookie')?.match(/__Host-spinarium_session=([^;]+)/);
  assert.ok(match);
  return `__Host-spinarium_session=${match[1]}`;
}

test('direct password accounts use the actual local Worker, native scrypt and authoritative D1', async (t) => {
  const h = await createHarness({
    AUTH_PROVIDER: 'password', SIGNUP_ENABLED: 'true',
    OIDC_ISSUER: '', OIDC_CLIENT_ID: '', OIDC_CLIENT_SECRET: '', AUTH0_CONNECTION: '',
  });
  t.after(() => h.mf.dispose());
  let sequence = 0;
  function post(path: string, body: unknown, additional: Record<string, string> = {}) {
    sequence += 1;
    return h.fetch(path, { method: 'POST', headers: {
      Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.100.${sequence}`, ...additional,
    }, body: JSON.stringify(body) });
  }
  let accountId = '';
  let cookie = '';
  let createdAt = '';

  await t.test('unverified imaginary email signup saves a collector and hashes both password and session', async () => {
    const response = await post('/api/auth/signup', { email: ' Imaginary+Collector@Not-Real.invalid ', password, displayName: 'Saved Collector' });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('set-cookie')!, /Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=28800/);
    cookie = sessionCookie(response);
    const body = await response.json() as { user: { id: string; displayName: string; memberSince: string }; csrfToken: string; expiresAt: string };
    accountId = body.user.id;
    createdAt = body.user.memberSince;
    assert.equal(body.user.displayName, 'Saved Collector');
    assert.match(body.csrfToken, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(Date.parse(body.expiresAt) > Date.now());
    const stored = await h.db.prepare('SELECT * FROM password_accounts WHERE user_id = ?').bind(accountId)
      .first<{ email_normalized: string; password_hash: string }>();
    assert.equal(stored?.email_normalized, 'imaginary+collector@not-real.invalid');
    assert.match(stored!.password_hash, /^\$scrypt\$v=1\$N=32768,r=8,p=3\$/);
    assert.ok(!JSON.stringify(stored).includes(password));
    const rawToken = cookie.split('=')[1];
    assert.equal((await h.db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').bind(accountId).first<{ token_hash: string }>())?.token_hash,
      createHash('sha256').update(rawToken).digest('hex'));
    assert.ok(!JSON.stringify(body).includes(rawToken));
    const activity = await h.db.prepare('SELECT created_at,last_login_at,account_revision FROM users WHERE id=?').bind(accountId)
      .first<{ created_at: number; last_login_at: number; account_revision: number }>();
    assert.equal(activity?.last_login_at, activity?.created_at);
    assert.equal(activity?.account_revision, 1);
    for (const table of ['admin_allowlist', 'ownerships', 'discoveries']) {
      assert.equal((await h.db.prepare(`SELECT COUNT(*) count FROM ${table}`).first<{ count: number }>())?.count, 0);
    }
    const dashboard = await h.fetch('/api/dashboard', { headers: { Cookie: cookie } });
    assert.equal(dashboard.status, 200);
    assert.equal((await dashboard.json() as { profile: { id: string } }).profile.id, accountId);
    assert.equal((await h.fetch('/api/admin/veilings', { headers: { Cookie: cookie } })).status, 403);
  });

  await t.test('logout and a later normalized login restore the same saved account', async () => {
    const session = await h.fetch('/api/auth/session', { headers: { Cookie: cookie } });
    const current = await session.json() as { csrfToken: string };
    assert.equal((await h.fetch('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'X-CSRF-Token': 'x'.repeat(43) } })).status, 403);
    assert.equal((await h.fetch('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'X-CSRF-Token': current.csrfToken } })).status, 200);
    assert.equal((await h.fetch('/api/auth/session', { headers: { Cookie: cookie } })).status, 401);
    const beforeLogin = Math.floor(Date.now() / 1000);
    await h.db.prepare('UPDATE users SET last_login_at=?,account_revision=7 WHERE id=?').bind(beforeLogin - 600, accountId).run();
    const response = await post('/api/auth/login', { email: '  IMAGINARY+COLLECTOR@not-real.invalid  ', password });
    assert.equal(response.status, 200);
    cookie = sessionCookie(response);
    const body = await response.json() as { user: { id: string; displayName: string; memberSince: string } };
    assert.equal(body.user.id, accountId);
    assert.equal(body.user.displayName, 'Saved Collector');
    assert.equal(body.user.memberSince, createdAt);
    assert.equal((await h.db.prepare('SELECT COUNT(*) count FROM users').first<{ count: number }>())?.count, 1);
    const activity = await h.db.prepare('SELECT last_login_at,account_revision FROM users WHERE id=?').bind(accountId)
      .first<{ last_login_at: number; account_revision: number }>();
    assert.ok(activity!.last_login_at >= beforeLogin);
    assert.equal(activity?.account_revision, 7);
  });

  await t.test('wrong passwords and unknown names receive the same generic response', async () => {
    const before = await h.db.prepare('SELECT last_login_at,account_revision FROM users WHERE id=?').bind(accountId).first();
    const wrong = await post('/api/auth/login', { email: 'imaginary+collector@not-real.invalid', password: differentPassword });
    const unknown = await post('/api/auth/login', { email: 'absent@not-real.invalid', password: differentPassword });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(await wrong.json(), await unknown.json());
    assert.equal(wrong.headers.get('set-cookie'), null);
    assert.equal(unknown.headers.get('set-cookie'), null);
    assert.deepEqual(await h.db.prepare('SELECT last_login_at,account_revision FROM users WHERE id=?').bind(accountId).first(), before);
  });

  await t.test('duplicate and simultaneous normalized signups cannot leave orphan users or duplicate sessions', async () => {
    const before = (await h.db.prepare('SELECT COUNT(*) count FROM users').first<{ count: number }>())!.count;
    const duplicate = await post('/api/auth/signup', { email: 'IMAGINARY+COLLECTOR@not-real.invalid', password: differentPassword, displayName: 'Different' });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.headers.get('set-cookie'), null);
    assert.equal((await h.db.prepare('SELECT COUNT(*) count FROM users').first<{ count: number }>())?.count, before);
    const results = await Promise.all([
      post('/api/auth/signup', { email: 'race@invalid.test', password, displayName: 'Race' }),
      post('/api/auth/signup', { email: 'RACE@invalid.test', password, displayName: 'Race' }),
    ]);
    assert.deepEqual(results.map((response) => response.status).sort(), [201, 400]);
    assert.equal((await h.db.prepare('SELECT COUNT(*) count FROM users').first<{ count: number }>())?.count, before + 1);
    assert.equal((await h.db.prepare("SELECT COUNT(*) count FROM password_accounts WHERE email_normalized='race@invalid.test'").first<{ count: number }>())?.count, 1);
  });

  await t.test('unverified email does not link an existing OIDC account or inherit administrator authority', async () => {
    const external = await seedSession(h.db, { admin: true });
    const response = await post('/api/auth/signup', { email: 'external-admin@invalid.test', password, displayName: 'Untrusted Name' });
    assert.equal(response.status, 201);
    const body = await response.json() as { user: { id: string } };
    assert.notEqual(body.user.id, external.id);
    assert.equal(await h.db.prepare('SELECT user_id FROM admin_allowlist WHERE user_id = ?').bind(body.user.id).first(), null);
    const user = await h.db.prepare('SELECT oidc_issuer, oidc_subject FROM users WHERE id = ?').bind(body.user.id).first<{ oidc_issuer: string; oidc_subject: string }>();
    assert.equal(user?.oidc_issuer, 'urn:spinarium:password');
    assert.equal(user?.oidc_subject, body.user.id);
  });

  await t.test('pre-login mutations require exact Origin, JSON and bounded valid input', async () => {
    const body = { email: 'blocked@invalid.test', password, displayName: 'Blocked' };
    assert.equal((await post('/api/auth/signup', body, { Origin: 'https://attacker.test' })).status, 403);
    assert.equal((await post('/api/auth/signup', body, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await h.fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 403);
    assert.equal((await post('/api/auth/signup', body, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post('/api/auth/signup', { ...body, admin: true })).status, 400);
    assert.equal((await post('/api/auth/signup', { ...body, password: 'short' })).status, 400);
    assert.equal((await post('/api/auth/signup', { ...body, password: 'x'.repeat(129) })).status, 400);
    assert.equal((await post('/api/auth/signup', { ...body, displayName: 'x'.repeat(9000) })).status, 413);
    for (const field of ['email', 'password', 'displayName']) {
      const malformed = { ...body, [field]: field === 'email' ? 'bad\ud800@invalid.test' : `${'x'.repeat(20)}\ud800` };
      assert.equal((await post('/api/auth/signup', malformed)).status, 400);
    }
    assert.equal((await h.fetch('/api/auth/login')).status, 405);
    assert.equal((await h.fetch('/api/auth/reset', { method: 'POST' })).status, 404);
  });

  await t.test('valid Unicode passwords and display names preserve exact content', async () => {
    const unicodePassword = '🌀'.repeat(15);
    const name = '🌀'.repeat(120);
    const response = await post('/api/auth/signup', { email: 'unicode@invalid.test', password: unicodePassword, displayName: name });
    assert.equal(response.status, 201);
    assert.equal((await response.json() as { user: { displayName: string } }).user.displayName, name);
    assert.equal((await post('/api/auth/login', { email: 'unicode@invalid.test', password: unicodePassword })).status, 200);
  });

  await t.test('revocation during password hashing cannot mint a new session', async () => {
    // Run this handler with the real D1 binding and Node's independent scrypt
    // worker thread. This lets the revocation complete during hashing instead
    // of queuing both requests behind a single Miniflare isolate event loop.
    const before = await h.db.prepare('SELECT last_login_at,account_revision FROM users WHERE id=?').bind(accountId).first();
    const request = handlePasswordAuth(new Request(`${origin}/api/auth/login`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.55' },
      body: JSON.stringify({ email: 'imaginary+collector@not-real.invalid', password }),
    }), h.env);
    await new Promise((resolve) => setTimeout(resolve, 75));
    await h.db.prepare('UPDATE users SET disabled=1 WHERE id=?').bind(accountId).run();
    await assert.rejects(request, (error: unknown) => error instanceof HttpError && error.status === 401);
    assert.equal((await h.fetch('/api/auth/session', { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await post('/api/auth/login', { email: 'imaginary+collector@not-real.invalid', password })).status, 401);
    assert.deepEqual(await h.db.prepare('SELECT last_login_at,account_revision FROM users WHERE id=?').bind(accountId).first(), before);
  });

  await t.test('account and IP limits reject requests before hashing; blocked IPs cannot add account keys', async () => {
    const start = Math.floor(Date.now() / 1000 / 900) * 900;
    const key = createHash('sha256').update('password:login:account:rate@invalid.test').digest('hex');
    await h.db.prepare('INSERT INTO auth_rate_limits(key,hits,window_start) VALUES(?,10,?)').bind(key, start).run();
    assert.equal((await post('/api/auth/login', { email: 'rate@invalid.test', password })).status, 429);
    const ip = '203.0.113.99';
    const ipKey = createHash('sha256').update(`password:login:ip:${ip}`).digest('hex');
    await h.db.prepare('INSERT INTO auth_rate_limits(key,hits,window_start) VALUES(?,30,?)').bind(ipKey, start).run();
    for (let index = 0; index < 3; index += 1) {
      const email = `blocked-${index}@invalid.test`;
      assert.equal((await post('/api/auth/login', { email, password }, { 'CF-Connecting-IP': ip })).status, 429);
      const accountKey = createHash('sha256').update(`password:login:account:${email}`).digest('hex');
      assert.equal(await h.db.prepare('SELECT key FROM auth_rate_limits WHERE key=?').bind(accountKey).first(), null);
    }
  });
});

test('direct signup can be closed without disabling existing password login', async (t) => {
  const h = await createHarness({ AUTH_PROVIDER: 'password', SIGNUP_ENABLED: 'false', OIDC_CLIENT_SECRET: '' });
  t.after(() => h.mf.dispose());
  const response = await h.fetch('/api/auth/signup', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'closed@invalid.test', password, displayName: 'Closed' }) });
  assert.equal(response.status, 503);
  assert.equal((await h.db.prepare('SELECT COUNT(*) count FROM password_accounts').first<{ count: number }>())?.count, 0);
  const existing = await seedSession(h.db);
  assert.equal((await h.db.prepare('SELECT last_login_at FROM users WHERE id=?').bind(existing.id).first<{ last_login_at: number | null }>())?.last_login_at, null);
  const now = Math.floor(Date.now() / 1000);
  await h.db.prepare('UPDATE users SET oidc_issuer=?,oidc_subject=? WHERE id=?').bind('urn:spinarium:password', existing.id, existing.id).run();
  await h.db.prepare('INSERT INTO password_accounts(user_id,email_normalized,password_hash,created_at,updated_at) VALUES(?,?,?,?,?)')
    .bind(existing.id, 'existing@invalid.test', await hashPassword(password), now, now).run();
  const login = await h.fetch('/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.201' }, body: JSON.stringify({ email: 'existing@invalid.test', password }) });
  assert.equal(login.status, 200);
  assert.equal((await login.json() as { user: { id: string } }).user.id, existing.id);
  const activity = await h.db.prepare('SELECT last_login_at,account_revision FROM users WHERE id=?').bind(existing.id)
    .first<{ last_login_at: number; account_revision: number }>();
  assert.ok(activity!.last_login_at >= now);
  assert.equal(activity?.account_revision, 1);
});
