import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createHarness, seedSession, origin } from './support';

type Harness = Awaited<ReturnType<typeof createHarness>>;
type Session = Awaited<ReturnType<typeof seedSession>>;
const claimHeaders = (user: Session) => ({ ...user.headers, 'Content-Type': 'application/json' });
const mutation = (user: Session, body: unknown) => ({
  method: 'POST', headers: claimHeaders(user), body: JSON.stringify(body),
});
async function harness(t: TestContext, enabled = true) {
  const h = await createHarness(enabled ? { CLAIMS_ENABLED: 'true' } : {});
  t.after(() => h.mf.dispose());
  return h;
}
async function createAshenling(h: Harness, author: Session, details: Record<string, unknown> = {}) {
  const r = await h.fetch('/api/admin/veilings', mutation(author, {
    name: 'Ashenling', number: 1, rarity: 'Legacy', edition: 'Legacy',
    status: 'active', description: 'A mysterious first Veiling', ...details,
  }));
  assert.equal(r.status, 201);
  return (await r.json() as { id: string; revision: number }).id;
}
async function issue(h: Harness, user: Session, veilingId: string) {
  return h.fetch('/api/admin/digital-claims', mutation(user, { veilingId }));
}
async function redeem(h: Harness, user: Session, code: string) {
  return h.fetch('/api/digital-claims/redeem', mutation(user, { code }));
}

test('claim feature stays disabled by default and neither API nor health advertises live claims', async t => {
  const h = await harness(t, false);
  const owner = await seedSession(h.db, { owner: true });
  const id = await createAshenling(h, owner);
  const health = await (await h.fetch('/api/health')).json() as { claimsEnabled: boolean };
  assert.equal(health.claimsEnabled, false);
  assert.equal((await issue(h, owner, id)).status, 404);
  assert.equal((await redeem(h, owner, 'a'.repeat(43))).status, 404);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM digital_claims').first('n'), 0);
});

test('owner issues secret privately; code is returned once and never appears in database or status', async t => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true });
  const other = await seedSession(h.db);
  const id = await createAshenling(h, owner);
  const response = await issue(h, owner, id);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const result = await response.json() as { claimId: string; veilingId: string; claimCode: string; expiresAt: string };
  assert.equal(result.veilingId, id);
  assert.match(result.claimId, /^[0-9a-f-]{36}$/);
  assert.match(result.claimCode, /^[A-Za-z0-9_-]{43}$/);
  const dbRow = await h.db.prepare('SELECT token_hash,issued_by,redeemed_at FROM digital_claims WHERE id=?')
    .bind(result.claimId).first<{ token_hash: string; issued_by: string; redeemed_at: number | null }>();
  assert.equal(dbRow?.issued_by, owner.id);
  assert.equal(dbRow?.redeemed_at, null);
  assert.match(dbRow!.token_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(dbRow!.token_hash, result.claimCode);
  const status = await h.fetch('/api/admin/digital-claims/' + result.claimId, { headers: owner.headers });
  assert.equal(status.status, 200);
  const body = await status.text();
  assert.equal(JSON.parse(body).state, 'issued');
  assert(!body.includes(result.claimCode));
  assert(!body.includes(dbRow!.token_hash));
  assert.equal((await h.fetch('/api/admin/digital-claims/' + result.claimId, { headers: other.headers })).status, 403);
  assert.deepEqual((await (await h.fetch('/api/showcase', { headers: other.headers })).json()), {
    schemaVersion: '1', mode: 'live', veilings: [],
  });
});

test('one successful claim adds one owner copy and reveals privately, but replay can never add another', async t => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true });
  const other = await seedSession(h.db);
  const id = await createAshenling(h, owner);
  const issued = await (await issue(h, owner, id)).json() as { claimCode: string; claimId: string };
  const first = await redeem(h, owner, issued.claimCode);
  assert.equal(first.status, 201);
  const firstBody = await first.json() as { ownershipId: string; redeemed: boolean };
  assert.equal(firstBody.redeemed, true);
  assert.match(firstBody.ownershipId, /^[0-9a-f-]{36}$/);
  assert.equal((await redeem(h, owner, issued.claimCode)).status, 409);
  assert.equal((await redeem(h, other, issued.claimCode)).status, 409);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM ownerships').first('n'), 1);
  const row = await h.db.prepare('SELECT redeemed_at,ownership_id FROM digital_claims WHERE id=?')
    .bind(issued.claimId).first<{ redeemed_at: number; ownership_id: string }>();
  assert(row?.redeemed_at);
  assert.equal(row?.ownership_id, firstBody.ownershipId);
  const status = await (await h.fetch('/api/admin/digital-claims/' + issued.claimId, { headers: owner.headers })).json() as {
    state: string; ownershipId: string;
  };
  assert.equal(status.state, 'redeemed');
  assert.equal(status.ownershipId, firstBody.ownershipId);
  const snapshot = await (await h.fetch('/api/dashboard', { headers: owner.headers })).json() as {
    veilings: { name: string | null; contentStatus: string; number: number }[];
    ownerships: { id: string; veilingId: string }[];
    discoveries: { veilingId: string; status: string }[];
  };
  assert.equal(snapshot.veilings[0].name, 'Ashenling');
  assert.equal(snapshot.veilings[0].number, 1);
  assert.equal(snapshot.veilings[0].contentStatus, 'published');
  assert.equal(snapshot.ownerships.length, 1);
  assert.equal(snapshot.ownerships[0].id, firstBody.ownershipId);
  assert.deepEqual(snapshot.discoveries.map(({ veilingId, status }) => ({ veilingId, status })), [{ veilingId: id, status: 'revealed' }]);
  const otherDashboard = await (await h.fetch('/api/dashboard', { headers: other.headers })).json() as {
    veilings: unknown[]; ownerships: unknown[];
  };
  assert.deepEqual(otherDashboard.veilings, []);
  assert.deepEqual(otherDashboard.ownerships, []);
});

test('concurrent redemption race produces exactly one successful claim', async t => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true });
  const id = await createAshenling(h, owner);
  const issued = await (await issue(h, owner, id)).json() as { claimCode: string };
  const results = await Promise.all(Array.from({ length: 7 }, () => redeem(h, owner, issued.claimCode)));
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 6);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM ownerships').first('n'), 1);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM discoveries').first('n'), 1);
});

test('each new code is random, can mint one duplicate, and does not establish a 999-copy limit', async t => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true });
  const id = await createAshenling(h, owner);
  const a = await (await issue(h, owner, id)).json() as { claimCode: string };
  const b = await (await issue(h, owner, id)).json() as { claimCode: string };
  assert.notEqual(a.claimCode, b.claimCode);
  assert.equal((await redeem(h, owner, a.claimCode)).status, 201);
  assert.equal((await redeem(h, owner, b.claimCode)).status, 201);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM ownerships WHERE veiling_id=?').bind(id).first('n'), 2);
});

test('wrong Veiling, draft and member-visible publication cannot issue private pilot codes', async t => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true });
  const incorrect = await createAshenling(h, owner, { name: 'Not Ashenling' });
  assert.equal((await issue(h, owner, incorrect)).status, 409);
  const draft = await createAshenling(h, owner, { name: 'Ashenling Draft', number: 2, status: 'draft' });
  assert.equal((await issue(h, owner, draft)).status, 409);
  const id = await createAshenling(h, owner);
  await h.db.prepare(`INSERT INTO veiling_publications
    (veiling_id,name,description,character_number,rarity,edition,visibility,source_revision,updated_at)
    VALUES (?, 'Ashenling', '', 1, 'Legacy', 'Legacy', 'upcoming', 1, 1)`).bind(id).run();
  assert.equal((await issue(h, owner, id)).status, 409);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM digital_claims').first('n'), 0);
});

test('codes reject unauthorized writes, forged identity, bad payloads, absent CSRF, and revoked sessions', async t => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true });
  const admin = await seedSession(h.db, { admin: true });
  const collector = await seedSession(h.db);
  const id = await createAshenling(h, owner);
  assert.equal((await issue(h, admin, id)).status, 403);
  assert.equal((await issue(h, collector, id)).status, 403);
  assert.equal((await h.fetch('/api/admin/digital-claims', mutation(owner, { veilingId: 'invalid' }))).status, 400);
  assert.equal((await h.fetch('/api/admin/digital-claims', {
    method: 'POST', headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ veilingId: id }),
  })).status, 403);
  const issued = await (await issue(h, owner, id)).json() as { claimCode: string };
  assert.equal((await redeem(h, admin, issued.claimCode)).status, 409);
  assert.equal((await redeem(h, collector, issued.claimCode)).status, 409);
  assert.equal((await h.fetch('/api/digital-claims/redeem', {
    method: 'POST', headers: { Authorization: 'Bearer ' + owner.token, 'X-User-Id': owner.id, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: issued.claimCode }),
  })).status, 401);
  await h.db.prepare('DELETE FROM sessions WHERE user_id=?').bind(owner.id).run();
  assert.equal((await redeem(h, owner, issued.claimCode)).status, 401);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM ownerships').first('n'), 0);
});

test('revocation permanently destroys claimability and history cannot be deleted or reset', async t => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true });
  const id = await createAshenling(h, owner);
  const issued = await (await issue(h, owner, id)).json() as { claimCode: string; claimId: string };
  const response = await h.fetch('/api/admin/digital-claims/' + issued.claimId + '/revoke', {
    method: 'POST', headers: owner.headers,
  });
  assert.equal(response.status, 200);
  assert.equal((await redeem(h, owner, issued.claimCode)).status, 409);
  const state = await (await h.fetch('/api/admin/digital-claims/' + issued.claimId, { headers: owner.headers })).json() as { state: string };
  assert.equal(state.state, 'revoked');
  assert.equal((await h.fetch('/api/admin/digital-claims/' + issued.claimId + '/revoke', {
    method: 'POST', headers: owner.headers,
  })).status, 409);
  await assert.rejects(() => h.db.prepare('DELETE FROM digital_claims WHERE id=?').bind(issued.claimId).run(), /permanent/);
  await assert.rejects(() => h.db.prepare('UPDATE digital_claims SET revoked_at=NULL WHERE id=?').bind(issued.claimId).run(), /cannot be reused/);
});

test('expired unused code cannot redeem and remains recorded as expired', async t => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true });
  const id = await createAshenling(h, owner);
  const code = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))).toString('hex');
  const claimId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await h.db.prepare(`INSERT INTO digital_claims(id,veiling_id,token_hash,issued_by,issued_at,expires_at)
    VALUES(?,?,?,?,?,?)`).bind(claimId,id,hash,owner.id,now - 7200,now - 3600).run();
  assert.equal((await redeem(h, owner, code)).status, 409);
  const state = await (await h.fetch('/api/admin/digital-claims/' + claimId, { headers: owner.headers })).json() as { state: string };
  assert.equal(state.state, 'expired');
  assert.equal(await h.db.prepare('SELECT count(*) n FROM ownerships').first('n'), 0);
  await assert.rejects(() => h.db.prepare('UPDATE digital_claims SET expires_at=? WHERE id=?').bind(now + 7200,claimId).run(), /cannot be reused/);
});
