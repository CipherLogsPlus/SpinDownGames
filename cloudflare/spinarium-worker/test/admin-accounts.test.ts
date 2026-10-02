import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { timingSafeEqual } from 'node:crypto';
import { accountDirectoryStatement, handleAdminAccounts } from '../src/admin-accounts';
import { createHarness, seedSession, origin } from './support';

type Harness = Awaited<ReturnType<typeof createHarness>>;
type Session = Awaited<ReturnType<typeof seedSession>>;
interface Account {
  id: string; email: string | null; displayName: string; disabled: boolean; role: string; revision: number;
  activeSessionCount: number; ownershipCount: number; passwordAccount: boolean;
  permissions: Record<string, boolean>; lastLoginAt: string | null;
}
async function harness(t: TestContext) {
  const h = await createHarness({ AUTH_PROVIDER: 'password', SIGNUP_ENABLED: 'true' });
  t.after(() => h.mf.dispose()); return h;
}
async function get(h: Harness, actor: Session, target: string): Promise<Account> {
  const response = await h.fetch(`/api/admin/accounts/${target}`, { headers: actor.headers });
  assert.equal(response.status, 200); return response.json() as Promise<Account>;
}
function write(actor: Session, account: Account, body: unknown, method = 'PATCH'): RequestInit {
  return { method, headers: { ...actor.headers, 'Content-Type': 'application/json', 'If-Match': `"${account.revision}"` }, body: JSON.stringify(body) };
}
function nodeTimingSafe(t: TestContext) {
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true,
    value: (a: ArrayBuffer, b: ArrayBuffer) => timingSafeEqual(Buffer.from(a), Buffer.from(b)) });
  t.after(() => Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual'));
}
function interceptMutation(h: Harness, before: () => Promise<unknown>) {
  let intercepted = false;
  return new Proxy(h.db, { get(target, property) {
    if (property === 'withSession') return (...args: Parameters<D1Database['withSession']>) => {
      const primary = target.withSession(...args);
      return new Proxy(primary, { get(session, key) {
        if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
          if (statements.length > 2 && !intercepted) { intercepted = true; await before(); }
          return session.batch(statements);
        };
        const value = Reflect.get(session, key); return typeof value === 'function' ? value.bind(session) : value;
      } });
    };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } });
}

test('admin directory is protected, bounded and projects no credential or provider/session secrets', async (t) => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true, email: 'owner@fixture.invalid' });
  const admin = await seedSession(h.db, { admin: true, email: 'admin@fixture.invalid' });
  const collector = await seedSession(h.db, { email: 'collector@fixture.invalid', displayName: 'A Collector' });
  for (const path of ['/api/admin/accounts', '/api/admin/accounts/summary', `/api/admin/accounts/${owner.id}`, `/api/admin/accounts/${owner.id}/history`, `/api/admin/accounts/${owner.id}/ownerships`]) {
    assert.equal((await h.fetch(path)).status, 401);
    assert.equal((await h.fetch(path, { headers: collector.headers })).status, 403);
  }
  const response = await h.fetch('/api/admin/accounts?limit=2', { headers: admin.headers });
  assert.equal(response.status, 200);
  const page = await response.json() as { accounts: Account[]; nextCursor: string; limit: number };
  assert.equal(page.accounts.length, 2); assert.equal(page.limit, 2); assert(page.nextCursor);
  const next = await (await h.fetch(`/api/admin/accounts?limit=2&cursor=${page.nextCursor}`, { headers: admin.headers })).json() as { accounts: Account[]; nextCursor: null };
  assert.equal(next.accounts.length, 1); assert.equal(next.nextCursor, null);
  assert.equal(new Set([...page.accounts, ...next.accounts].map((a) => a.id)).size, 3);
  const encoded = JSON.stringify([...page.accounts, ...next.accounts]);
  for (const forbidden of ['password_hash', 'local-fixture-noncredential', 'oidc_issuer', 'oidc_subject', owner.hash, owner.csrfToken, owner.token]) assert(!encoded.includes(forbidden));
  assert.deepEqual(await (await h.fetch('/api/admin/accounts/summary', { headers: owner.headers })).json(), {
    total: 3, active: 3, disabled: 0, admins: 2, owners: 1, currentActorRole: 'owner',
  });
  assert.deepEqual(await (await h.fetch('/api/admin/access', { headers: owner.headers })).json(), { admin: true, role: 'owner' });
  const detail = await get(h, owner, collector.id);
  assert.equal(detail.activeSessionCount, 1); assert.equal(detail.ownershipCount, 0); assert.equal(detail.lastLoginAt, null);
  assert.equal(detail.email, 'collector@fixture.invalid'); assert.equal(detail.passwordAccount, true);
  assert.equal((await h.fetch('/api/admin/accounts?limit=101', { headers: owner.headers })).status, 400);
  assert.equal((await h.fetch('/api/admin/accounts?role=god', { headers: owner.headers })).status, 400);
  assert.equal((await h.fetch(`/api/admin/accounts?status=disabled&limit=2&cursor=${page.nextCursor}`, { headers: owner.headers })).status, 400);
  assert.equal((await h.fetch('/api/admin/accounts?cursor=invalid', { headers: owner.headers })).status, 400);
  assert.equal((await h.fetch('/api/admin/accounts?searchBy=id&search=partial', { headers: owner.headers })).status, 400);
});

test('profile, status and session controls enforce live hierarchy, safe self-rename and audited revision conflicts', async (t) => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true });
  const admin = await seedSession(h.db, { admin: true });
  const otherAdmin = await seedSession(h.db, { admin: true });
  const collector = await seedSession(h.db);
  for (const target of [owner, otherAdmin]) {
    const row = await get(h, admin, target.id);
    assert.equal((await h.fetch(`/api/admin/accounts/${target.id}`, write(admin, row, { displayName: 'Forbidden', reason: 'Test hierarchy' }))).status, 403);
    assert.equal((await h.fetch(`/api/admin/accounts/${target.id}/revoke-sessions`, write(admin, row, { reason: 'Test hierarchy' }, 'POST'))).status, 403);
  }
  const self = await get(h, admin, admin.id);
  assert.equal(self.permissions.editProfile, true); assert.equal(self.permissions.setStatus, false);
  assert.equal((await h.fetch(`/api/admin/accounts/${admin.id}`, write(admin, self, { disabled: false, reason: 'Self status forbidden' }))).status, 403);
  const rename = await h.fetch(`/api/admin/accounts/${admin.id}`, write(admin, self, { displayName: 'My New Name', reason: 'Correct my own name' }));
  assert.equal(rename.status, 200);
  assert.equal((await (await h.fetch('/api/auth/session', { headers: admin.headers })).json() as { user: { displayName: string } }).user.displayName, 'My New Name');
  const target = await get(h, admin, collector.id);
  const changed = await h.fetch(`/api/admin/accounts/${collector.id}`, write(admin, target, { displayName: 'Corrected', reason: 'Correct supplied name' }));
  assert.equal(changed.status, 200);
  const updated = await changed.json() as Account;
  assert.equal(updated.revision, target.revision + 1); assert.equal(updated.activeSessionCount, 1);
  assert.equal((await h.fetch(`/api/admin/accounts/${collector.id}`, write(admin, target, { disabled: true, reason: 'Stale form' }))).status, 409);
  const ban = await h.fetch(`/api/admin/accounts/${collector.id}`, write(admin, updated, { disabled: true, reason: 'Account rule violation' }));
  assert.equal(ban.status, 200);
  const banned = await ban.json() as Account & { revokedSessionCount: number };
  assert.equal(banned.disabled, true); assert.equal(banned.activeSessionCount, 0); assert.equal(banned.revokedSessionCount, 1);
  assert.equal((await h.fetch('/api/dashboard', { headers: collector.headers })).status, 401);
  const enabled = await h.fetch(`/api/admin/accounts/${collector.id}`, write(owner, banned, { disabled: false, reason: 'Review complete' }));
  assert.equal(enabled.status, 200); assert.equal((await enabled.json() as Account).activeSessionCount, 0);
  const ownedAdmin = await get(h, owner, otherAdmin.id);
  assert.equal((await h.fetch(`/api/admin/accounts/${otherAdmin.id}/revoke-sessions`, write(owner, ownedAdmin, { reason: 'Revoke administrative session' }, 'POST'))).status, 200);
  const ownerSelf = await get(h, owner, owner.id);
  assert.equal((await h.fetch(`/api/admin/accounts/${owner.id}/revoke-sessions`, write(owner, ownerSelf, { reason: 'Never lock owner out' }, 'POST'))).status, 403);
  const history = await (await h.fetch(`/api/admin/accounts/${collector.id}/history`, { headers: owner.headers })).json() as { history: Array<{ action: string; reason: string; before: Record<string, unknown>; after: Record<string, unknown> }> };
  assert.deepEqual(new Set(history.history.map((event) => event.action)), new Set(['profile_updated', 'account_disabled', 'account_enabled']));
  assert(history.history.every((event) => Object.keys(event.before).sort().join(',') === 'disabled,displayName,revision,role'));
});

test('only owner can grant or remove regular admin, with singleton owner protection and exact audit revision', async (t) => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true });
  const admin = await seedSession(h.db, { admin: true });
  const collector = await seedSession(h.db);
  const target = await get(h, owner, collector.id);
  assert.equal((await h.fetch(`/api/admin/accounts/${collector.id}/role`, write(admin, target, { role: 'admin', reason: 'Not an owner' }))).status, 403);
  assert.equal((await h.fetch(`/api/admin/accounts/${collector.id}/role`, write(owner, target, { role: 'owner', reason: 'Owner unavailable in API' }))).status, 400);
  const grant = await h.fetch(`/api/admin/accounts/${collector.id}/role`, write(owner, target, { role: 'admin', reason: 'Trusted appointment' }));
  assert.equal(grant.status, 200, 'trigger writes must not cause a false conflict after committed grant');
  const promoted = await grant.json() as Account;
  assert.equal(promoted.role, 'admin'); assert.equal(promoted.revision, target.revision + 1); assert.equal(promoted.activeSessionCount, 0);
  const stored = await h.db.prepare('SELECT account_role,account_revision FROM users WHERE id=?').bind(collector.id).first();
  assert.deepEqual(stored, { account_role: 'admin', account_revision: promoted.revision });
  const demote = await h.fetch(`/api/admin/accounts/${collector.id}/role`, write(owner, promoted, { role: 'collector', reason: 'End appointment' }));
  assert.equal(demote.status, 200); const demoted = await demote.json() as Account;
  assert.equal(demoted.role, 'collector'); assert.equal(demoted.revision, promoted.revision + 1);
  const events = await h.db.prepare('SELECT after_json FROM account_audit WHERE target_user_id=? ORDER BY created_at,id').bind(collector.id).all<{ after_json: string }>();
  assert.deepEqual(new Set(events.results.map((event) => JSON.parse(event.after_json).revision)), new Set([promoted.revision, demoted.revision]));
  const ownerRow = await get(h, owner, owner.id);
  assert.equal((await h.fetch(`/api/admin/accounts/${owner.id}/role`, write(owner, ownerRow, { role: 'collector', reason: 'Owner cannot demote self' }))).status, 403);
  await assert.rejects(h.db.prepare("UPDATE admin_allowlist SET role='owner' WHERE user_id=?").bind(admin.id).run(), /UNIQUE/);
});

test('password-reset issuance respects hierarchy, stores only hash and invalidates prior links and all sessions', async (t) => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true });
  const admin = await seedSession(h.db, { admin: true, email: 'admin@fixture.invalid' });
  const collector = await seedSession(h.db, { email: 'collector@fixture.invalid' });
  let row = await get(h, admin, collector.id);
  const issue = await h.fetch(`/api/admin/accounts/${collector.id}/password-reset`, write(admin, row, { reason: 'Collector requested password help' }, 'POST'));
  assert.equal(issue.status, 200);
  const reset = await issue.json() as { account: Account; resetLink: string; expiresAt: string };
  assert.match(reset.resetLink, /^https:\/\/spinarium.test\/spinarium\/#reset-password=[A-Za-z0-9_-]{43}$/);
  const raw = reset.resetLink.split('=')[1];
  const record = await h.db.prepare('SELECT token_hash,expires_at,created_at FROM password_resets WHERE user_id=?').bind(collector.id).first<{ token_hash: string; expires_at: number; created_at: number }>();
  assert.notEqual(record!.token_hash, raw); assert.equal(record!.token_hash.length, 64); assert.equal(record!.expires_at - record!.created_at, 900);
  assert.equal(reset.account.activeSessionCount, 0);
  assert.equal((await h.fetch('/api/auth/session', { headers: collector.headers })).status, 401);
  const auditText = JSON.stringify(await h.db.prepare('SELECT * FROM account_audit').all());
  assert(!auditText.includes(raw)); assert(!auditText.includes(record!.token_hash)); assert(!auditText.includes('local-fixture-noncredential'));
  row = reset.account;
  const again = await h.fetch(`/api/admin/accounts/${collector.id}/password-reset`, write(owner, row, { reason: 'Replace old reset link' }, 'POST'));
  assert.equal(again.status, 200); const replaced = await again.json() as { account: Account; resetLink: string };
  assert.notEqual(replaced.resetLink, reset.resetLink); assert.equal(await h.db.prepare('SELECT count(*) n FROM password_resets').first('n'), 1);
  assert.equal((await h.fetch(`/api/admin/accounts/${collector.id}`, write(owner, replaced.account, { displayName: 'Updated after reset', reason: 'Profile correction cancels link' }))).status, 200);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM password_resets').first('n'), 0);
  const adminRow = await get(h, admin, admin.id);
  assert.equal((await h.fetch(`/api/admin/accounts/${admin.id}/password-reset`, write(admin, adminRow, { reason: 'Admin cannot reset self' }, 'POST'))).status, 403);
  assert.equal((await h.fetch(`/api/admin/accounts/${admin.id}/password-reset`, write(owner, adminRow, { reason: 'Owner helps administrator' }, 'POST'))).status, 200);
});

test('account mutations require CSRF/revision/strict fields and audit failure rolls back sessions and profile', async (t) => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true });
  const collector = await seedSession(h.db, { email: 'collector@fixture.invalid' });
  const row = await get(h, owner, collector.id);
  for (const payload of [
    { disabled: true, role: 'owner', reason: 'No elevation' }, { email: 'changed@fixture.invalid', reason: 'No credential edit' },
    { password: 'new password', reason: 'No plaintext editor' }, { displayName: '', reason: 'Empty name' },
    { disabled: 'yes', reason: 'Boolean required' }, { displayName: 'Valid', reason: '' },
  ]) assert.equal((await h.fetch(`/api/admin/accounts/${collector.id}`, write(owner, row, payload))).status, 400);
  const missing = write(owner, row, { disabled: true, reason: 'Missing revision' });
  delete (missing.headers as Record<string, string>)['If-Match'];
  assert.equal((await h.fetch(`/api/admin/accounts/${collector.id}`, missing)).status, 428);
  const noCsrf = write(owner, row, { disabled: true, reason: 'Missing token' });
  delete (noCsrf.headers as Record<string, string>)['X-CSRF-Token'];
  assert.equal((await h.fetch(`/api/admin/accounts/${collector.id}`, noCsrf)).status, 403);
  await h.db.prepare("CREATE TRIGGER reject_account_audit BEFORE INSERT ON account_audit BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  assert.equal((await h.fetch(`/api/admin/accounts/${collector.id}`, write(owner, row, { disabled: true, reason: 'Atomic ban' }))).status, 503);
  assert.equal((await h.fetch(`/api/admin/accounts/${collector.id}/password-reset`, write(owner, row, { reason: 'Atomic reset' }, 'POST'))).status, 503);
  assert.equal((await get(h, owner, collector.id)).revision, row.revision);
  assert.equal((await get(h, owner, collector.id)).activeSessionCount, 1);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM password_resets').first('n'), 0);
  await h.db.prepare('DROP TRIGGER reject_account_audit').run();
  const revoked = await h.fetch(`/api/admin/accounts/${collector.id}/revoke-sessions`, write(owner, row, { reason: 'End sessions' }, 'POST'));
  assert.equal(revoked.status, 200); const next = await revoked.json() as Account;
  assert.equal((await h.fetch(`/api/admin/accounts/${collector.id}/revoke-sessions`, write(owner, next, { reason: 'Record zero-session revocation' }, 'POST'))).status, 200);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM account_audit').first('n'), 2);
  await assert.rejects(h.db.prepare("UPDATE account_audit SET reason='rewritten'").run(), /append-only/);
  await assert.rejects(h.db.prepare('DELETE FROM account_audit').run(), /append-only/);
});

test('transaction guard rejects a session revoked after the initial admin checks', async (t) => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true });
  const collector = await seedSession(h.db);
  const row = await get(h, owner, collector.id);
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true,
    value: (a: ArrayBuffer, b: ArrayBuffer) => timingSafeEqual(Buffer.from(a), Buffer.from(b)) });
  t.after(() => Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual'));
  let intercepted = false;
  const db = new Proxy(h.db, { get(target, property) {
    if (property === 'withSession') return (...args: Parameters<D1Database['withSession']>) => {
      const primary = target.withSession(...args);
      return new Proxy(primary, { get(session, key) {
        if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
          if (statements.length > 2 && !intercepted) {
            intercepted = true;
            await h.db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(owner.hash).run();
          }
          return session.batch(statements);
        };
        const value = Reflect.get(session, key); return typeof value === 'function' ? value.bind(session) : value;
      } });
    };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } });
  await assert.rejects(handleAdminAccounts(new Request(`${origin}/api/admin/accounts/${collector.id}`, write(owner, row, { disabled: true, reason: 'Late revocation denial' })),
    { ...h.env, DB: db }), (error: unknown) => error instanceof Error && 'status' in error && error.status === 403);
  assert(intercepted);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM account_audit').first('n'), 0);
  assert.deepEqual(await h.db.prepare('SELECT disabled,account_revision FROM users WHERE id=?').bind(collector.id).first(), { disabled: 0, account_revision: 1 });
});

test('transaction-time authority and target hierarchy reject races without a partial event', async (t) => {
  const h = await harness(t); nodeTimingSafe(t);
  const owner = await seedSession(h.db, { owner: true });
  const admin = await seedSession(h.db, { admin: true });
  const collector = await seedSession(h.db);
  const target = await get(h, admin, collector.id);
  const promotedDb = interceptMutation(h, () => h.db.prepare("INSERT INTO admin_allowlist(user_id,role,granted_at,granted_by) VALUES(?,'admin',?,'test race')").bind(collector.id, 100000).run());
  await assert.rejects(handleAdminAccounts(new Request(`${origin}/api/admin/accounts/${collector.id}`, write(admin, target, { disabled: true, reason: 'Target changed role during request' })),
    { ...h.env, DB: promotedDb }), (error: unknown) => error instanceof Error && 'status' in error && error.status === 403);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM account_audit').first('n'), 0);
  assert.equal(await h.db.prepare('SELECT disabled FROM users WHERE id=?').bind(collector.id).first('disabled'), 0);
  const newCollector = await seedSession(h.db);
  const roleTarget = await get(h, owner, newCollector.id);
  const demotedOwnerDb = interceptMutation(h, () => h.db.prepare("UPDATE admin_allowlist SET role='admin' WHERE user_id=?").bind(owner.id).run());
  await assert.rejects(handleAdminAccounts(new Request(`${origin}/api/admin/accounts/${newCollector.id}/role`, write(owner, roleTarget, { role: 'admin', reason: 'Actor lost owner role during request' })),
    { ...h.env, DB: demotedOwnerDb }), (error: unknown) => error instanceof Error && 'status' in error && error.status === 403);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM account_audit').first('n'), 0);
  assert.equal(await h.db.prepare('SELECT account_role FROM users WHERE id=?').bind(newCollector.id).first('account_role'), 'collector');
});

test('a losing CAS cannot revoke winner sessions/reset link, and banning an issuer cancels their links permanently', async (t) => {
  const h = await harness(t); nodeTimingSafe(t);
  const owner = await seedSession(h.db, { owner: true });
  const admin = await seedSession(h.db, { admin: true });
  const collector = await seedSession(h.db, { email: 'collector@fixture.invalid' });
  const old = await get(h, owner, collector.id);
  let winningResetHash: string | null = null;
  const racedDb = interceptMutation(h, async () => {
    const winner = await h.fetch(`/api/admin/accounts/${collector.id}/password-reset`, write(owner, old, { reason: 'Winning newer reset request' }, 'POST'));
    assert.equal(winner.status, 200);
    winningResetHash = await h.db.prepare('SELECT token_hash FROM password_resets WHERE user_id=?').bind(collector.id).first('token_hash');
    const now = Math.floor(Date.now() / 1000);
    await h.db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,expires_at) VALUES(?,?,?,?,?)')
      .bind('winner-session-marker', collector.id, 'local-csrf-marker', now, now + 3600).run();
  });
  await assert.rejects(handleAdminAccounts(new Request(`${origin}/api/admin/accounts/${collector.id}/revoke-sessions`, write(owner, old, { reason: 'Losing stale action' }, 'POST')),
    { ...h.env, DB: racedDb }), (error: unknown) => error instanceof Error && 'status' in error && error.status === 409);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM account_audit').first('n'), 1);
  assert.equal(await h.db.prepare('SELECT token_hash FROM password_resets WHERE user_id=?').bind(collector.id).first('token_hash'), winningResetHash);
  assert.equal(await h.db.prepare("SELECT count(*) n FROM sessions WHERE token_hash='winner-session-marker'").first('n'), 1);
  // Issue a fresh link as a regular admin, then ban and re-enable that issuer.
  const current = await get(h, admin, collector.id);
  assert.equal((await h.fetch(`/api/admin/accounts/${collector.id}/password-reset`, write(admin, current, { reason: 'Admin-issued recovery' }, 'POST'))).status, 200);
  const adminRow = await get(h, owner, admin.id);
  const ban = await h.fetch(`/api/admin/accounts/${admin.id}`, write(owner, adminRow, { disabled: true, reason: 'Ban issuing administrator' }));
  assert.equal(ban.status, 200); const banned = await ban.json() as Account;
  assert.equal(await h.db.prepare('SELECT count(*) n FROM password_resets').first('n'), 0);
  assert.equal((await h.fetch(`/api/admin/accounts/${admin.id}`, write(owner, banned, { disabled: false, reason: 'Restore account without old authority links' }))).status, 200);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM password_resets').first('n'), 0);
});

test('50,000-row local D1 directory uses indexed prefix/filter/keyset plans and bounded response pages', async (t) => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true });
  // Actual local SQLite rows/indexes/triggers, not a browser projection or any
  // remotely seeded account. These fixture hashes cannot authenticate.
  await h.db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<50000)
    INSERT INTO users(id,oidc_issuer,oidc_subject,display_name,disabled,created_at,updated_at)
    SELECT printf('%08x-0000-4000-8000-%012x',x,x),'urn:local:scale',printf('local-%d',x),
      printf('Collector %05d',x),x%31=0,100000+x%5,100000+x%5 FROM n`).run();
  await h.db.prepare(`INSERT INTO password_accounts(user_id,email_normalized,password_hash,created_at,updated_at)
    SELECT id,printf('member%05d@fixture.invalid',CAST(substr(oidc_subject,7) AS INTEGER)),
      'local-fixture-noncredential',created_at,updated_at FROM users WHERE oidc_issuer='urn:local:scale'`).run();
  await h.db.prepare(`INSERT INTO admin_allowlist(user_id,granted_at,granted_by,role)
    SELECT id,100000,'local scale fixture','admin' FROM users WHERE oidc_issuer='urn:local:scale' AND CAST(substr(oidc_subject,7) AS INTEGER)%97=0`).run();
  assert.equal(await h.db.prepare('SELECT count(*) n FROM users').first('n'), 50001);
  const primary = h.db.withSession('first-primary');
  for (const searchBy of ['email', 'name']) for (const status of ['all', 'active', 'disabled']) for (const role of ['all', 'collector', 'admin', 'owner']) {
    const url = new URL(`/api/admin/accounts?searchBy=${searchBy}&search=${searchBy === 'email' ? 'member49' : 'Collector 49'}&status=${status}&role=${role}&limit=50`, origin);
    const built = accountDirectoryStatement(primary, url);
    const plan = await h.db.prepare(`EXPLAIN QUERY PLAN ${built.sql}`).bind(...built.values).all<{ detail: string }>();
    assert(plan.results.some((row) => /SEARCH u USING INDEX users_account_/.test(row.detail)), JSON.stringify(plan.results));
    assert(!plan.results.some((row) => /TEMP B-TREE/.test(row.detail)), JSON.stringify(plan.results));
    const actual = await built.statement.all();
    assert(actual.results.length <= 51);
    assert(Number.isFinite(actual.meta.rows_read));
    if (actual.results.length) assert(actual.meta.rows_read > 0, 'D1 must report actual row-read metadata');
    assert(actual.meta.rows_read <= 400, `${searchBy}/${status}/${role} read ${actual.meta.rows_read} rows`);
  }
  let cursor: string | null = null; let deepCursor: string | null = null; const ids = new Set<string>(); let pages = 0;
  do {
    const response = await h.fetch(`/api/admin/accounts?limit=100${cursor ? `&cursor=${cursor}` : ''}`, { headers: owner.headers });
    assert.equal(response.status, 200);
    const page = await response.json() as { accounts: Account[]; nextCursor: string | null };
    assert(page.accounts.length <= 100);
    for (const row of page.accounts) { assert(!ids.has(row.id), 'equal-timestamp keyset must not repeat an account'); ids.add(row.id); }
    cursor = page.nextCursor; pages += 1;
    if (pages === 250) deepCursor = cursor;
  } while (cursor);
  assert.equal(ids.size, 50001); assert.equal(pages, 501);
  assert(deepCursor);
  const deep = accountDirectoryStatement(primary, new URL(`/api/admin/accounts?limit=100&cursor=${deepCursor}`, origin));
  const deepPlan = await h.db.prepare(`EXPLAIN QUERY PLAN ${deep.sql}`).bind(...deep.values).all<{ detail: string }>();
  assert(deepPlan.results.some((row) => /SEARCH u USING INDEX users_account_newest/.test(row.detail)), JSON.stringify(deepPlan.results));
  assert(!deepPlan.results.some((row) => /TEMP B-TREE/.test(row.detail)));
  const deepPage = await deep.statement.all();
  assert.equal(deepPage.results.length, 101);
  assert(deepPage.meta.rows_read > 0 && deepPage.meta.rows_read <= 400, `deep keyset read ${deepPage.meta.rows_read}`);
  const unicode = await seedSession(h.db, { displayName: 'Éclair%_Name', email: 'literal%_@fixture.invalid' });
  const accented = await (await h.fetch('/api/admin/accounts?searchBy=name&search=%C3%89c', { headers: owner.headers })).json() as { accounts: Account[] };
  assert(accented.accounts.some((row) => row.id === unicode.id));
  const literal = await (await h.fetch('/api/admin/accounts?searchBy=email&search=literal%25_', { headers: owner.headers })).json() as { accounts: Account[] };
  assert.deepEqual(literal.accounts.map((row) => row.id), [unicode.id]);
  const exact = await (await h.fetch(`/api/admin/accounts?searchBy=id&search=${unicode.id}`, { headers: owner.headers })).json() as { accounts: Account[] };
  assert.deepEqual(exact.accounts.map((row) => row.id), [unicode.id]);
});
