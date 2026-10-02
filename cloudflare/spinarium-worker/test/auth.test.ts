import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createHarness, origin, seedSession } from './support';

const issuer = 'https://identity.test/';
type TokenCase = 'valid' | 'signature' | 'nonce' | 'audience' | 'issuer' | 'expired' | 'unverified' | 'missing-email';

function cookieValue(response: Response, name: string): string | null {
  return response.headers.get('set-cookie')?.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`))?.[1] ?? null;
}

test('real signed OIDC protocol through the local Worker and D1', async (t) => {
  const keys = await generateKeyPair('RS256', { extractable: true });
  const attacker = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'fixture-key', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { nonce: string; challenge: string; subject: string; kind: TokenCase }>();
  let sequence = 0;
  let tokenCalls = 0;
  const fixtureResponse = async (request: Request) => {
    const url = new URL(request.url);
    assert.equal(url.origin, new URL(issuer).origin, 'only the configured identity fixture may receive requests');
    if (url.pathname === '/.well-known/openid-configuration') {
      return Response.json({
        issuer, authorization_endpoint: `${issuer}authorize`, token_endpoint: `${issuer}token`, jwks_uri: `${issuer}jwks`,
        response_types_supported: ['code'], subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      });
    }
    if (url.pathname === '/jwks') return Response.json({ keys: [jwk] });
    assert.equal(url.pathname, '/token');
    tokenCalls += 1;
    assert.equal(request.method, 'POST');
    const basic = request.headers.get('authorization');
    assert.ok(basic?.startsWith('Basic '));
    const credentials = Buffer.from(basic.slice(6), 'base64').toString().split(':').map(decodeURIComponent);
    assert.deepEqual(credentials, ['spinarium-test', 'test-only-provider-secret']);
    const body = new URLSearchParams(await request.text());
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('redirect_uri'), `${origin}/api/auth/callback`);
    const fixture = codes.get(body.get('code')!);
    assert.ok(fixture);
    assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), fixture.challenge, 'the provider verifies PKCE');
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      nonce: fixture.kind === 'nonce' ? 'wrong-nonce' : fixture.nonce,
      name: 'Verified Collector',
      email_verified: fixture.kind !== 'unverified',
      ...(fixture.kind === 'missing-email' ? {} : { email: 'collector@example.test' }),
      roles: ['admin'], admin: true,
    };
    const jwt = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
      .setIssuer(fixture.kind === 'issuer' ? 'https://attacker.test' : issuer)
      .setAudience(fixture.kind === 'audience' ? 'different-client' : 'spinarium-test')
      .setSubject(fixture.subject)
      .setIssuedAt(fixture.kind === 'expired' ? now - 600 : now)
      .setExpirationTime(fixture.kind === 'expired' ? now - 60 : now + 300)
      .sign(fixture.kind === 'signature' ? attacker.privateKey : keys.privateKey);
    return Response.json({ access_token: 'fixture-provider-access-token', refresh_token: 'fixture-provider-refresh-token', token_type: 'Bearer', expires_in: 300, id_token: jwt });
  };
  const h = await createHarness({ SIGNUP_ENABLED: 'true' }, async (request) => {
    try { return await fixtureResponse(request); }
    catch (error) { t.diagnostic(error instanceof Error ? error.message : String(error)); throw error; }
  });
  t.after(() => h.mf.dispose());

  async function begin(kind: TokenCase = 'valid', signup = false, active = h) {
    sequence += 1;
    const ip = `192.0.2.${sequence}`;
    const response = await active.fetch(signup ? '/api/auth/signup' : '/api/auth/login', { headers: { 'CF-Connecting-IP': ip } });
    assert.equal(response.status, 303);
    const target = new URL(response.headers.get('location')!);
    assert.equal(target.origin, new URL(issuer).origin);
    assert.equal(target.pathname, '/authorize');
    assert.equal(target.searchParams.get('scope'), 'openid profile email');
    assert.equal(target.searchParams.get('connection'), 'Username-Password-Authentication');
    assert.equal(target.searchParams.get('redirect_uri'), `${origin}/api/auth/callback`);
    assert.equal(target.searchParams.get('response_type'), 'code');
    assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(target.searchParams.get('screen_hint'), signup ? 'signup' : null);
    if (signup) assert.equal(target.searchParams.get('prompt'), 'login');
    const code = `test-code-${sequence}`;
    const subject = `subject-${sequence}`;
    codes.set(code, { nonce: target.searchParams.get('nonce')!, challenge: target.searchParams.get('code_challenge')!, subject, kind });
    const binding = cookieValue(response, '__Host-spinarium_oidc');
    assert.ok(binding);
    assert.match(response.headers.get('set-cookie')!, /Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600/);
    return {
      path: `/api/auth/callback?code=${code}&state=${target.searchParams.get('state')}`,
      headers: { Cookie: `__Host-spinarium_oidc=${binding}`, 'CF-Connecting-IP': ip },
      subject,
    };
  }

  await t.test('verified email login creates only a collector and a hashed opaque session', async () => {
    const flow = await begin();
    const response = await h.fetch(flow.path, { headers: flow.headers });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `${origin}/spinarium/`);
    const rawToken = cookieValue(response, '__Host-spinarium_session');
    assert.ok(rawToken);
    assert.equal(rawToken.length, 43);
    assert.match(response.headers.get('set-cookie')!, /Secure; HttpOnly; SameSite=Lax; Max-Age=28800/);
    const stored = await h.db.prepare('SELECT token_hash, csrf_token, expires_at, user_id FROM sessions').first<{ token_hash: string; csrf_token: string; expires_at: number; user_id: string }>();
    assert.ok(stored);
    assert.equal(stored.token_hash, createHash('sha256').update(rawToken).digest('hex'));
    assert.notEqual(stored.token_hash, rawToken);
    assert.ok(!JSON.stringify(stored).includes('fixture-provider'));
    for (const table of ['admin_allowlist', 'ownerships', 'discoveries']) {
      const count = await h.db.prepare(`SELECT COUNT(*) count FROM ${table}`).first<{ count: number }>();
      assert.equal(count?.count, 0, `authentication grants no ${table}`);
    }
    const session = await h.fetch('/api/auth/session', { headers: { Cookie: `__Host-spinarium_session=${rawToken}` } });
    assert.equal(session.status, 200);
    assert.equal(session.headers.get('cache-control'), 'no-store');
    const body = await session.json() as { user: { id: string; displayName: string }; csrfToken: string; expiresAt: string };
    assert.equal(body.user.id, stored.user_id);
    assert.equal(body.user.displayName, 'Verified Collector');
    assert.equal(body.csrfToken, stored.csrf_token);
    assert.equal(body.expiresAt, new Date(stored.expires_at * 1000).toISOString());
    assert.ok(!JSON.stringify(body).includes(rawToken));
    assert.equal((await h.fetch('/api/admin/veilings', { headers: { Cookie: `__Host-spinarium_session=${rawToken}` } })).status, 403);
  });

  await t.test('callback replay cannot exchange another token or create another session', async () => {
    const flow = await begin();
    const before = tokenCalls;
    assert.equal((await h.fetch(flow.path, { headers: flow.headers })).headers.get('location'), `${origin}/spinarium/`);
    const replay = await h.fetch(flow.path, { headers: flow.headers });
    assert.equal(replay.headers.get('location'), `${origin}/spinarium/?auth=failed#signin`);
    assert.equal(cookieValue(replay, '__Host-spinarium_session'), null);
    assert.equal(tokenCalls, before + 1);
  });

  await t.test('simultaneous callbacks consume the state only once', async () => {
    const flow = await begin();
    const before = tokenCalls;
    const results = await Promise.all([h.fetch(flow.path, { headers: flow.headers }), h.fetch(flow.path, { headers: flow.headers })]);
    const locations = results.map((response) => response.headers.get('location'));
    assert.equal(locations.filter((location) => location === `${origin}/spinarium/`).length, 1);
    assert.equal(locations.filter((location) => location === `${origin}/spinarium/?auth=failed#signin`).length, 1);
    assert.equal(tokenCalls, before + 1);
  });

  await t.test('state is bound to the initiating browser and remains usable by that browser', async () => {
    const flow = await begin();
    const wrong = await h.fetch(flow.path, { headers: { ...flow.headers, Cookie: `__Host-spinarium_oidc=${'a'.repeat(43)}` } });
    assert.equal(wrong.headers.get('location'), `${origin}/spinarium/?auth=failed#signin`);
    assert.equal(cookieValue(wrong, '__Host-spinarium_session'), null);
    assert.equal((await h.fetch(flow.path, { headers: flow.headers })).headers.get('location'), `${origin}/spinarium/`);
  });

  for (const kind of ['signature', 'nonce', 'audience', 'issuer', 'expired'] as TokenCase[]) {
    await t.test(`a signed token with invalid ${kind} fails closed and burns the attempt`, async () => {
      const flow = await begin(kind);
      const response = await h.fetch(flow.path, { headers: flow.headers });
      assert.equal(response.headers.get('location'), `${origin}/spinarium/?auth=failed#signin`);
      assert.equal(cookieValue(response, '__Host-spinarium_session'), null);
      const user = await h.db.prepare('SELECT id FROM users WHERE oidc_subject = ?').bind(flow.subject).first();
      assert.equal(user, null);
      const before = tokenCalls;
      await h.fetch(flow.path, { headers: flow.headers });
      assert.equal(tokenCalls, before);
    });
  }

  for (const kind of ['unverified', 'missing-email'] as TokenCase[]) {
    await t.test(`${kind} cannot bootstrap an account or session`, async () => {
      const flow = await begin(kind, true);
      const response = await h.fetch(flow.path, { headers: flow.headers });
      assert.equal(response.headers.get('location'), `${origin}/spinarium/?auth=verify-email#signin`);
      assert.equal(cookieValue(response, '__Host-spinarium_session'), null);
      assert.equal(await h.db.prepare('SELECT id FROM users WHERE oidc_subject = ?').bind(flow.subject).first(), null);
    });
  }

  await t.test('signup uses Auth0 registration while verified signups still receive no grants', async () => {
    const flow = await begin('valid', true);
    const response = await h.fetch(flow.path, { headers: flow.headers });
    assert.equal(response.headers.get('location'), `${origin}/spinarium/`);
    assert.ok(cookieValue(response, '__Host-spinarium_session'));
  });

  await t.test('closed registration rejects a new login identity while active existing users may log in', async () => {
    const closed = await createHarness({ SIGNUP_ENABLED: 'false' }, fixtureResponse);
    t.after(() => closed.mf.dispose());
    const newIdentity = await begin('valid', false, closed);
    const denied = await closed.fetch(newIdentity.path, { headers: newIdentity.headers });
    assert.equal(denied.headers.get('location'), `${origin}/spinarium/?auth=failed#signin`);
    assert.equal(cookieValue(denied, '__Host-spinarium_session'), null);
    assert.equal((await closed.db.prepare('SELECT COUNT(*) count FROM users').first<{ count: number }>())?.count, 0);
    assert.equal((await closed.db.prepare('SELECT COUNT(*) count FROM sessions').first<{ count: number }>())?.count, 0);
    const knownIdentity = await begin('valid', false, closed);
    const known = await seedSession(closed.db);
    await closed.db.prepare('UPDATE users SET oidc_issuer = ?, oidc_subject = ? WHERE id = ?').bind(issuer, knownIdentity.subject, known.id).run();
    const allowed = await closed.fetch(knownIdentity.path, { headers: knownIdentity.headers });
    assert.equal(allowed.headers.get('location'), `${origin}/spinarium/`);
    assert.ok(cookieValue(allowed, '__Host-spinarium_session'));
    assert.equal((await closed.db.prepare('SELECT COUNT(*) count FROM users').first<{ count: number }>())?.count, 1);
    const disabledIdentity = await begin('valid', false, closed);
    const disabled = await seedSession(closed.db, { disabled: true });
    await closed.db.prepare('UPDATE users SET oidc_issuer = ?, oidc_subject = ? WHERE id = ?').bind(issuer, disabledIdentity.subject, disabled.id).run();
    const before = (await closed.db.prepare('SELECT COUNT(*) count FROM sessions').first<{ count: number }>())?.count;
    const disabledResult = await closed.fetch(disabledIdentity.path, { headers: disabledIdentity.headers });
    assert.equal(disabledResult.headers.get('location'), `${origin}/spinarium/?auth=failed#signin`);
    assert.equal(cookieValue(disabledResult, '__Host-spinarium_session'), null);
    assert.equal((await closed.db.prepare('SELECT COUNT(*) count FROM sessions').first<{ count: number }>())?.count, before);
  });

  await t.test('expired login state cannot be exchanged', async () => {
    const flow = await begin();
    const now = Math.floor(Date.now() / 1000);
    await h.db.prepare('UPDATE oidc_attempts SET created_at = ?, expires_at = ?').bind(now - 700, now - 1).run();
    const before = tokenCalls;
    const response = await h.fetch(flow.path, { headers: flow.headers });
    assert.equal(response.headers.get('location'), `${origin}/spinarium/?auth=failed#signin`);
    assert.equal(tokenCalls, before);
  });

  await t.test('logout needs trusted Origin and timing-safe CSRF then invalidates the server session', async () => {
    const seeded = await seedSession(h.db);
    assert.equal((await h.fetch('/api/auth/logout', { method: 'POST', headers: { ...seeded.headers, Origin: 'https://attacker.test' } })).status, 403);
    assert.equal((await h.fetch('/api/auth/logout', { method: 'POST', headers: { ...seeded.headers, 'X-CSRF-Token': 'x'.repeat(43) } })).status, 403);
    assert.equal((await h.fetch('/api/auth/logout', { method: 'POST', headers: { Cookie: seeded.cookie, 'X-CSRF-Token': seeded.csrfToken } })).status, 403);
    const response = await h.fetch('/api/auth/logout', { method: 'POST', headers: seeded.headers });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie')!, /__Host-spinarium_session=; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=0/);
    assert.equal(await h.db.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').bind(seeded.hash).first(), null);
    assert.equal((await h.fetch('/api/auth/session', { headers: { Cookie: seeded.cookie } })).status, 401);
  });

  await t.test('disabled users, expired sessions, caller bearer tokens and preview credentials have no authority', async () => {
    const disabled = await seedSession(h.db, { disabled: true });
    assert.equal((await h.fetch('/api/auth/session', { headers: disabled.headers })).status, 401);
    const expired = await seedSession(h.db);
    const now = Math.floor(Date.now() / 1000);
    await h.db.prepare('UPDATE sessions SET created_at = ?, expires_at = ? WHERE token_hash = ?').bind(now - 100, now - 1, expired.hash).run();
    assert.equal((await h.fetch('/api/auth/session', { headers: expired.headers })).status, 401);
    assert.equal((await h.fetch('/api/auth/session', { headers: { Authorization: 'Bearer admin:1234' } })).status, 401);
    const revoked = await seedSession(h.db);
    assert.equal((await h.fetch('/api/auth/session', { headers: revoked.headers })).status, 200);
    await h.db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').bind(revoked.id).run();
    assert.equal((await h.fetch('/api/auth/session', { headers: revoked.headers })).status, 401);
  });
});

test('authentication and registration remain disabled without explicit secure configuration', async (t) => {
  const disabled = await createHarness({ AUTH_ENABLED: 'false' });
  t.after(() => disabled.mf.dispose());
  for (const path of ['/api/auth/login', '/api/auth/signup', '/api/auth/session']) assert.equal((await disabled.fetch(path)).status, 503);
  const missing = await createHarness({ OIDC_CLIENT_SECRET: '' });
  t.after(() => missing.mf.dispose());
  assert.equal((await missing.fetch('/api/auth/login')).status, 503);
  const registration = await createHarness({ SIGNUP_ENABLED: 'false' });
  t.after(() => registration.mf.dispose());
  assert.equal((await registration.fetch('/api/auth/signup')).status, 503);
});
