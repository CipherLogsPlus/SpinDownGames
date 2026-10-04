import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createHarness, seedSession } from './support';

type Harness = Awaited<ReturnType<typeof createHarness>>;
type Session = Awaited<ReturnType<typeof seedSession>>;
const notFound = { code: 'NOT_FOUND', message: 'The ownership was not found.' };

async function harness(t: TestContext) {
  const h = await createHarness();
  t.after(() => h.mf.dispose());
  return h;
}

async function catalog(h: Harness, author: Session, options: { status?: string; discovery?: string | null } = {}) {
  const id = crypto.randomUUID();
  const artworkId = crypto.randomUUID();
  await h.db.prepare(`INSERT INTO catalog_veilings
    (id,name,description,status,created_by,updated_by,created_at,updated_at,character_number)
    VALUES (?, 'Private Veiling name', 'Private Veiling lore', ?, ?, ?, 1, 1, 12)`)
    .bind(id, options.status ?? 'active', author.id, author.id).run();
  await h.db.prepare(`INSERT INTO artwork (id,veiling_id,object_key,content_type,byte_length,created_by,created_at)
    VALUES (?, ?, ?, 'image/png', 1, ?, 1)`).bind(artworkId, id, `private/${artworkId}`, author.id).run();
  await h.db.prepare('UPDATE catalog_veilings SET artwork_id = ? WHERE id = ?').bind(artworkId, id).run();
  const discovery = options.discovery === undefined ? 'revealed' : options.discovery;
  if (discovery !== null) await h.db.prepare('INSERT INTO discoveries (veiling_id,status) VALUES (?,?)').bind(id, discovery).run();
  return { id, artworkId };
}

async function own(h: Harness, user: Session, veilingId: string, acquiredAt = 1_700_000_000) {
  const id = crypto.randomUUID();
  await h.db.prepare('INSERT INTO ownerships (id,user_id,veiling_id,acquisition,acquired_at) VALUES (?,?,?,\'server_grant\',?)')
    .bind(id, user.id, veilingId, acquiredAt).run();
  return id;
}

test('ownership detail selects the exact owned instance and retains copy-specific metadata', async (t) => {
  const h = await harness(t);
  const author = await seedSession(h.db, { admin: true });
  const alice = await seedSession(h.db);
  const bob = await seedSession(h.db);
  const veiling = await catalog(h, author);
  const firstId = await own(h, alice, veiling.id);
  const secondId = await own(h, alice, veiling.id, 1_700_001_000);
  const bobId = await own(h, bob, veiling.id, 1_700_002_000);
  for (const [id, acquiredAt] of [[firstId, 1_700_000_000], [secondId, 1_700_001_000]] as const) {
    const response = await h.fetch(`/api/ownerships/${id.toUpperCase()}?userId=${bob.id}&role=admin`, {
      headers: { ...alice.headers, 'X-User-Id': bob.id, 'X-Role': 'admin' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      schemaVersion: '1', mode: 'live',
      ownership: { id, userId: alice.id, veilingId: veiling.id, acquisition: 'server_grant',
        acquiredAt: new Date(acquiredAt * 1000).toISOString(), physicalCardId: null },
      veiling: { id: veiling.id, number: 12, name: 'Private Veiling name', description: 'Private Veiling lore',
        artworkUrl: `/api/artwork/${veiling.artworkId}`, contentStatus: 'published' },
    });
  }
  const snapshot = await (await h.fetch('/api/dashboard', { headers: alice.headers })).json() as {
    ownerships: { id: string }[];
  };
  assert.deepEqual(snapshot.ownerships.map(item => item.id), [firstId, secondId]);
  for (const session of [alice, author]) {
    const denied = await h.fetch(`/api/ownerships/${bobId}`, { headers: session.headers });
    assert.equal(denied.status, 404, 'admin authority does not grant collector detail access');
    assert.deepEqual(await denied.json(), notFound);
  }
});

test('ownership detail keeps missing and unrevealed discovery content redacted', async (t) => {
  for (const discovery of [null, 'undiscovered'] as const) await t.test(String(discovery), async t => {
    const h = await harness(t);
    const collector = await seedSession(h.db);
    const veiling = await catalog(h, collector, { discovery });
    const id = await own(h, collector, veiling.id);
    const response = await h.fetch(`/api/ownerships/${id}`, { headers: collector.headers });
    assert.equal(response.status, 200);
    const result = await response.json() as { ownership: { id: string }; veiling: unknown };
    assert.equal(result.ownership.id, id);
    assert.deepEqual(result.veiling, {
      id: veiling.id, number: 12, name: null, description: null, artworkUrl: null, contentStatus: 'redacted',
    });
    const encoded = JSON.stringify(result);
    for (const secret of ['Private Veiling name', 'Private Veiling lore', veiling.artworkId, 'private/'])
      assert(!encoded.includes(secret));
  });
});

test('ownership detail returns the same not-found response for absent, malformed and deleted IDs', async t => {
  const h = await harness(t);
  const collector = await seedSession(h.db);
  const veiling = await catalog(h, collector, { status: 'retired' });
  const id = await own(h, collector, veiling.id);
  for (const selected of [crypto.randomUUID(), '', 'not-a-uuid', '0'.repeat(36), `${id}%00`]) {
    const response = await h.fetch(`/api/ownerships/${selected}`, { headers: collector.headers });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), notFound);
  }
  assert.equal((await h.fetch(`/api/ownerships/${id}`, { headers: collector.headers })).status, 200);
  await h.db.prepare('DELETE FROM ownerships WHERE id=?').bind(id).run();
  const deleted = await h.fetch(`/api/ownerships/${id}`, { headers: collector.headers });
  assert.equal(deleted.status, 404);
  assert.deepEqual(await deleted.json(), notFound);
});

test('active to draft to active preserves every owned record and hides all draft catalog metadata', async t => {
  const h = await harness(t);
  const admin = await seedSession(h.db, { admin: true });
  const alice = await seedSession(h.db);
  const bob = await seedSession(h.db);
  const veiling = await catalog(h, admin);
  const firstId = await own(h, alice, veiling.id);
  const secondId = await own(h, alice, veiling.id, 1_700_001_000);
  await h.r2.put(`private/${veiling.artworkId}`, new Uint8Array([1]));
  const getDetail = async (id: string) => {
    const response = await h.fetch(`/api/ownerships/${id}`, { headers: alice.headers });
    assert.equal(response.status, 200);
    return response.json() as Promise<{ ownership: Record<string, unknown>; veiling: Record<string, unknown> }>;
  };
  const getDashboard = async () => {
    const response = await h.fetch('/api/dashboard', { headers: alice.headers });
    assert.equal(response.status, 200);
    return response.json() as Promise<{ ownerships: Record<string, unknown>[]; veilings: Record<string, unknown>[]; discoveries: unknown[] }>;
  };
  const publish = async (status: 'draft' | 'active', revision: number) => {
    const response = await h.fetch(`/api/admin/veilings/${veiling.id}`, {
      method: 'PATCH', headers: { ...admin.headers, 'Content-Type': 'application/json', 'If-Match': `"${revision}"` },
      body: JSON.stringify({ status }),
    });
    assert.equal(response.status, 200);
  };
  const firstBefore = await getDetail(firstId);
  const secondBefore = await getDetail(secondId);
  const dashboardBefore = await getDashboard();
  assert.equal(firstBefore.veiling.contentStatus, 'published');
  assert.equal((await h.fetch(`/api/artwork/${veiling.artworkId}`, { headers: alice.headers })).status, 200);

  await publish('draft', 1);
  const firstDraft = await getDetail(firstId);
  const secondDraft = await getDetail(secondId);
  const dashboardDraft = await getDashboard();
  assert.deepEqual(firstDraft.ownership, firstBefore.ownership);
  assert.deepEqual(secondDraft.ownership, secondBefore.ownership);
  assert.deepEqual(dashboardDraft.ownerships, dashboardBefore.ownerships);
  const unavailable = { id: veiling.id, number: null, name: null, description: null, artworkUrl: null, contentStatus: 'unavailable' };
  assert.deepEqual(firstDraft.veiling, unavailable);
  assert.deepEqual(secondDraft.veiling, unavailable);
  assert.deepEqual(dashboardDraft.veilings, [{
    id: veiling.id, number: null, name: null, type: null, origin: null, editionIds: [], artwork: [], lore: [], releaseDate: null, contentStatus: 'unavailable',
  }]);
  assert.deepEqual(dashboardDraft.discoveries, []);
  const encoded = JSON.stringify([firstDraft, secondDraft, dashboardDraft]);
  for (const secret of ['Private Veiling name', 'Private Veiling lore', veiling.artworkId, 'private/'])
    assert(!encoded.includes(secret));
  const foreign = await h.fetch(`/api/ownerships/${firstId}`, { headers: bob.headers });
  assert.equal(foreign.status, 404);
  assert.deepEqual(await foreign.json(), notFound);
  const bobDashboard = await (await h.fetch('/api/dashboard', { headers: bob.headers })).json() as {
    ownerships: unknown[]; veilings: unknown[]; discoveries: unknown[];
  };
  assert.deepEqual(bobDashboard.ownerships, []);
  assert.deepEqual(bobDashboard.veilings, []);
  assert.deepEqual(bobDashboard.discoveries, []);
  for (const session of [alice, bob])
    assert.equal((await h.fetch(`/api/artwork/${veiling.artworkId}`, { headers: session.headers })).status, 404);

  await publish('active', 2);
  assert.deepEqual(await getDetail(firstId), firstBefore);
  assert.deepEqual(await getDetail(secondId), secondBefore);
  const dashboardAfter = await getDashboard();
  assert.deepEqual(dashboardAfter.ownerships, dashboardBefore.ownerships);
  assert.equal(dashboardAfter.veilings[0].contentStatus, 'published');
  assert.deepEqual(dashboardAfter.discoveries, dashboardBefore.discoveries);
  assert.equal((await h.fetch(`/api/artwork/${veiling.artworkId}`, { headers: alice.headers })).status, 200);
});

test('ownership detail rejects missing, forged, expired, revoked and disabled sessions', async t => {
  const h = await harness(t);
  const collector = await seedSession(h.db);
  const veiling = await catalog(h, collector);
  const id = await own(h, collector, veiling.id);
  const path = `/api/ownerships/${id}`;
  const expired = await seedSession(h.db, { expiresAt: Math.floor(Date.now() / 1000) });
  for (const headers of [undefined, { Authorization: `Bearer ${collector.token}`, 'X-User-Id': collector.id }, expired.headers]) {
    const response = await h.fetch(path, { headers });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  await h.db.prepare('UPDATE users SET disabled=1 WHERE id=?').bind(collector.id).run();
  assert.equal((await h.fetch(path, { headers: collector.headers })).status, 401);
  await h.db.prepare('UPDATE users SET disabled=0 WHERE id=?').bind(collector.id).run();
  assert.equal((await h.fetch(path, { headers: collector.headers })).status, 200);
  await h.db.prepare('DELETE FROM sessions WHERE user_id=?').bind(collector.id).run();
  assert.equal((await h.fetch(path, { headers: collector.headers })).status, 401);
});

test('ownership detail is GET-only and exposes no collector write path', async t => {
  const h = await harness(t);
  const collector = await seedSession(h.db);
  const veiling = await catalog(h, collector);
  const id = await own(h, collector, veiling.id);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const response = await h.fetch(`/api/ownerships/${id}`, { method, headers: collector.headers });
    assert.equal(response.status, 405);
  }
  assert.equal(await h.db.prepare('SELECT COUNT(*) FROM ownerships WHERE id=?').bind(id).first('COUNT(*)'), 1);
  assert.equal((await h.fetch('/api/ownerships', { method: 'POST', headers: collector.headers })).status, 404);
});
