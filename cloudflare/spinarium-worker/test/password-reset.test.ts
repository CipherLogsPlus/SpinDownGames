import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness, origin, seedSession } from './support';
import { hashPassword, verifyPassword } from '../src/password-hash';
import { hashToken, token } from '../src/session';
import { handlePasswordReset } from '../src/password-reset';
import { HttpError } from '../src/http';

const oldPassword = 'The prior account phrase 2026!';
const newPassword = 'The replacement account phrase 2026!';

test('one-time administrator-issued password resets preserve current authority and atomic consumption', async (t) => {
  const h = await createHarness({ AUTH_PROVIDER: 'password', SIGNUP_ENABLED: 'true' });
  t.after(() => h.mf.dispose());
  const owner = await seedSession(h.db, { owner: true, email: 'owner@invalid.test' });
  const admin = await seedSession(h.db, { admin: true, email: 'admin@invalid.test' });
  const previousHash = await hashPassword(oldPassword);
  let sequence = 0;
  async function account(options: { admin?: boolean; disabled?: boolean } = {}) {
    sequence += 1;
    const value = await seedSession(h.db, { ...options, email: `reset-${sequence}@invalid.test` });
    await h.db.prepare('UPDATE password_accounts SET password_hash=? WHERE user_id=?').bind(previousHash, value.id).run();
    return value;
  }
  async function issue(userId: string, actorId = admin.id, expired = false) {
    const raw = token();
    const now = Math.floor(Date.now() / 1000);
    await h.db.prepare(`INSERT INTO password_resets(token_hash,user_id,created_by,created_at,expires_at) VALUES(?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,created_by=excluded.created_by,created_at=excluded.created_at,expires_at=excluded.expires_at`)
      .bind(await hashToken(raw), userId, actorId, now - (expired ? 1000 : 0), now + (expired ? -1 : 900)).run();
    return raw;
  }
  function consume(raw: string, password: string = newPassword, headers: Record<string, string> = {}) {
    sequence += 1;
    return h.fetch('/api/auth/password-reset', { method: 'POST', headers: {
      Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': `192.0.2.${sequence}`, ...headers,
    }, body: JSON.stringify({ token: raw, password }) });
  }

  await t.test('valid redemption changes the password, revokes sessions, audits once and does not sign in', async () => {
    const target = await account();
    const raw = await issue(target.id);
    const before = await h.db.prepare('SELECT last_login_at,account_revision FROM users WHERE id=?').bind(target.id)
      .first<{ last_login_at: number | null; account_revision: number }>();
    const response = await consume(raw);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { passwordReset: true });
    assert.match(response.headers.get('set-cookie')!, /__Host-spinarium_session=; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=0/);
    const credential = await h.db.prepare('SELECT password_hash FROM password_accounts WHERE user_id=?').bind(target.id).first<{ password_hash: string }>();
    assert.ok(await verifyPassword(newPassword, credential!.password_hash));
    assert.ok(!await verifyPassword(oldPassword, credential!.password_hash));
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').bind(target.id).first<{ n: number }>())?.n, 0);
    assert.equal(await h.db.prepare('SELECT token_hash FROM password_resets WHERE user_id=?').bind(target.id).first(), null);
    const audit = await h.db.prepare('SELECT * FROM account_audit WHERE target_user_id=?').bind(target.id).all();
    assert.equal(audit.results.length, 1);
    assert.equal(audit.results[0].action, 'password_reset_completed');
    assert.equal(audit.results[0].actor_user_id, null);
    assert.ok(!JSON.stringify(audit.results).includes(raw));
    assert.ok(!JSON.stringify(audit.results).includes(newPassword));
    assert.ok(!JSON.stringify(audit.results).includes(credential!.password_hash));
    const after = await h.db.prepare('SELECT last_login_at,account_revision FROM users WHERE id=?').bind(target.id)
      .first<{ last_login_at: number | null; account_revision: number }>();
    assert.equal(after?.last_login_at, before?.last_login_at);
    assert.equal(after?.account_revision, before!.account_revision + 1);
    assert.equal((await h.fetch('/api/auth/session', { headers: { Cookie: target.cookie } })).status, 401);
    const replay = await consume(raw);
    assert.equal(replay.status, 400);
    assert.equal((await replay.json() as { code: string }).code, 'PASSWORD_RESET_UNAVAILABLE');
  });

  await t.test('invalid passwords and cross-origin requests do not consume a valid link', async () => {
    const target = await account();
    const raw = await issue(target.id);
    assert.equal((await consume(raw, 'short')).status, 400);
    assert.equal((await consume(raw, newPassword, { Origin: 'https://attacker.test' })).status, 403);
    assert.equal((await consume(raw, newPassword, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await consume(raw, newPassword, { 'Content-Type': 'text/plain' })).status, 415);
    assert.ok(await h.db.prepare('SELECT token_hash FROM password_resets WHERE token_hash=?').bind(await hashToken(raw)).first());
    assert.equal((await consume(raw)).status, 200);
  });

  await t.test('success ends the supplied browser session; failure preserves an unrelated account session', async () => {
    const target = await account();
    const unrelated = await account();
    const denied = await consume(token(), newPassword, { Cookie: unrelated.cookie });
    assert.equal(denied.status, 400);
    assert.equal(denied.headers.get('set-cookie'), null);
    assert.ok(await h.db.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').bind(unrelated.hash).first());
    assert.equal((await h.fetch('/api/auth/session', { headers: { Cookie: unrelated.cookie } })).status, 200);
    const allowed = await consume(await issue(target.id), newPassword, { Cookie: unrelated.cookie });
    assert.equal(allowed.status, 200);
    assert.match(allowed.headers.get('set-cookie')!, /__Host-spinarium_session=; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=0/);
    assert.equal(await h.db.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').bind(unrelated.hash).first(), null);
    assert.equal((await h.fetch('/api/auth/session', { headers: { Cookie: unrelated.cookie } })).status, 401);
  });

  await t.test('invalid, expired, disabled and role-forbidden links return the same generic error', async () => {
    const target = await account();
    const unknown = await consume(token());
    const expected = await unknown.json();
    assert.equal(unknown.status, 400);
    const expired = await issue(target.id, admin.id, true);
    assert.deepEqual(await (await consume(expired)).json(), expected);
    const disabled = await account({ disabled: true });
    assert.deepEqual(await (await consume(await issue(disabled.id))).json(), expected);
    const administrator = await account({ admin: true });
    assert.deepEqual(await (await consume(await issue(administrator.id, admin.id))).json(), expected);
    assert.deepEqual(await (await consume(await issue(owner.id, admin.id))).json(), expected);
    assert.deepEqual(await (await consume(await issue(admin.id, admin.id))).json(), expected);
  });

  await t.test('an owner may reset a regular administrator, while an ordinary administrator may not', async () => {
    const target = await account({ admin: true });
    const forbidden = await consume(await issue(target.id, admin.id));
    assert.equal(forbidden.status, 400);
    const allowed = await consume(await issue(target.id, owner.id));
    assert.equal(allowed.status, 200);
    assert.ok(await h.db.prepare("SELECT user_id FROM admin_allowlist WHERE user_id=? AND role='admin'").bind(target.id).first());
  });

  await t.test('a revoked or disabled issuing administrator cannot authorize redemption', async () => {
    const issuer = await account({ admin: true });
    const target = await account();
    const raw = await issue(target.id, issuer.id);
    await h.db.prepare('DELETE FROM admin_allowlist WHERE user_id=?').bind(issuer.id).run();
    assert.equal((await consume(raw)).status, 400);
    const otherIssuer = await account({ admin: true });
    const otherRaw = await issue(target.id, otherIssuer.id);
    await h.db.prepare('UPDATE users SET disabled=1 WHERE id=?').bind(otherIssuer.id).run();
    assert.equal((await consume(otherRaw)).status, 400);
  });

  await t.test('promotion and a replacement link invalidate older links', async () => {
    const target = await account();
    const old = await issue(target.id);
    const replacement = await issue(target.id);
    assert.equal((await consume(old)).status, 400);
    await h.db.prepare('INSERT INTO admin_allowlist(user_id,granted_at,granted_by,role) VALUES(?,?,?,?)')
      .bind(target.id, Math.floor(Date.now() / 1000), 'trusted test operator', 'admin').run();
    assert.equal((await consume(replacement)).status, 400);
  });

  await t.test('concurrent redemption has exactly one winner and one completion audit', async () => {
    const target = await account();
    const raw = await issue(target.id);
    const responses = await Promise.all([consume(raw), consume(raw)]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
    assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM account_audit WHERE target_user_id=? AND action='password_reset_completed'")
      .bind(target.id).first<{ n: number }>())?.n, 1);
  });

  await t.test('revocation during slow hashing cannot update the credential or create an audit', async () => {
    const target = await account();
    const raw = await issue(target.id);
    const request = handlePasswordReset(new Request(`${origin}/api/auth/password-reset`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.150' },
      body: JSON.stringify({ token: raw, password: newPassword }),
    }), h.env);
    await new Promise((resolve) => setTimeout(resolve, 75));
    await h.db.prepare('DELETE FROM password_resets WHERE user_id=?').bind(target.id).run();
    await assert.rejects(request, (error: unknown) => error instanceof HttpError && error.code === 'PASSWORD_RESET_UNAVAILABLE');
    assert.equal((await h.db.prepare('SELECT password_hash FROM password_accounts WHERE user_id=?').bind(target.id).first<{ password_hash: string }>())?.password_hash, previousHash);
    assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM account_audit WHERE target_user_id=?').bind(target.id).first<{ n: number }>())?.n, 0);
  });
});
