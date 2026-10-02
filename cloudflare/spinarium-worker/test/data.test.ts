import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createHarness, seedSession, origin } from './support';
import { handleData } from '../src/data';
import { timingSafeEqual } from 'node:crypto';

type Harness = Awaited<ReturnType<typeof createHarness>>;
type Session = Awaited<ReturnType<typeof seedSession>>;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG2kAAAAASUVORK5CYII=', 'base64');

async function harness(t: TestContext) {
  const h = await createHarness();
  t.after(() => h.mf.dispose());
  return h;
}

function mutation(session: Session, body: unknown, revision?: number): RequestInit {
  return {
    method: revision === undefined ? 'POST' : 'PATCH',
    headers: { ...session.headers, 'Content-Type': 'application/json', ...(revision ? { 'If-Match': `"${revision}"` } : {}) },
    body: JSON.stringify(body),
  };
}

async function create(h: Harness, admin: Session, extra: Record<string, unknown> = {}) {
  const response = await h.fetch('/api/admin/veilings', mutation(admin, { name: 'Veil Sentinel', status: 'active', ...extra }));
  assert.equal(response.status, 201);
  return response.json() as Promise<{ id: string; revision: number; name: string; artworkUrl: string | null }>;
}

async function own(h: Harness, collector: Session, id: string, revealed = true, discoverer = collector.id) {
  await h.db.prepare('INSERT INTO ownerships(id,user_id,veiling_id,acquisition,acquired_at) VALUES(?,?,?,?,?)')
    .bind(crypto.randomUUID(), collector.id, id, 'server_grant', Math.floor(Date.now() / 1000)).run();
  if (revealed) await h.db.prepare('INSERT OR IGNORE INTO discoveries(veiling_id,status,first_discovered_at,first_discoverer_id,reveal_kind) VALUES(?,?,?,?,?)')
    .bind(id, 'revealed', Math.floor(Date.now() / 1000), discoverer, 'collector').run();
}

async function upload(h: Harness, admin: Session, id: string, revision: number, body: Uint8Array = png, contentType = 'image/png') {
  return h.fetch(`/api/admin/veilings/${id}/artwork`, {
    method: 'POST', headers: { ...admin.headers, 'Content-Type': contentType, 'If-Match': `"${revision}"` }, body,
  });
}

test('protected endpoints reject anonymous, expired, disabled, and forged identities', async (t) => {
  const h = await harness(t);
  const admin = await seedSession(h.db, { admin: true });
  const collector = await seedSession(h.db);
  const expired = await seedSession(h.db, { expiresAt: Math.floor(Date.now() / 1000) });
  const disabled = await seedSession(h.db, { admin: true, disabled: true });
  for (const path of ['/api/dashboard', '/api/admin/access', '/api/admin/veilings', `/api/artwork/${crypto.randomUUID()}`]) {
    assert.equal((await h.fetch(path)).status, 401);
    assert.equal((await h.fetch(path, { headers: { Cookie: expired.cookie } })).status, 401);
    assert.equal((await h.fetch(path, { headers: { Cookie: disabled.cookie } })).status, 401);
    assert.equal((await h.fetch(path, { headers: { Authorization: `Bearer ${admin.token}`, 'X-User-Id': admin.id, 'X-Role': 'admin' } })).status, 401);
  }
  assert.deepEqual(await (await h.fetch('/api/admin/access', { headers: collector.headers })).json(), { admin: false, role: null });
  assert.equal((await h.fetch('/api/admin/veilings', {
    ...mutation(collector, { name: 'Forbidden', userId: admin.id, admin: true }),
    headers: { ...collector.headers, 'Content-Type': 'application/json', 'X-User-Id': admin.id, 'X-Role': 'admin' },
  })).status, 403);
  await h.db.prepare('DELETE FROM admin_allowlist WHERE user_id=?').bind(admin.id).run();
  assert.deepEqual(await (await h.fetch('/api/admin/access', { headers: admin.headers })).json(), { admin: false, role: null });
  assert.equal((await h.fetch('/api/admin/veilings', mutation(admin, { name: 'Revoked' }))).status, 403);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM catalog_veilings').first('n'), 0);
});

test('mutations enforce Origin, CSRF, payload bounds, allowlists, and append-only audit without granting ownership', async (t) => {
  const h = await harness(t);
  const admin = await seedSession(h.db, { admin: true });
  for (const headers of [
    { Cookie: admin.cookie, 'Content-Type': 'application/json', Origin: origin },
    { ...admin.headers, Origin: 'https://untrusted.test', 'Content-Type': 'application/json' },
    { ...admin.headers, 'X-CSRF-Token': 'forged', 'Content-Type': 'application/json' },
  ]) assert.equal((await h.fetch('/api/admin/veilings', { method: 'POST', headers, body: '{"name":"No"}' })).status, 403);
  for (const input of [
    { name: 'No', userId: admin.id }, { name: 'No', role: 'admin' }, { name: 'No', ownerships: [] },
    { name: 'No', artwork_id: crypto.randomUUID() }, { name: 'No', revision: 1 },
    { name: 'No', status: 'published' }, { name: 'No', number: '1' }, { name: 'No', number: 1.5 },
    { name: 'No', number: 1000000 }, { name: 'x'.repeat(121) }, { name: 'No', description: 'x'.repeat(20001) },
    { name: 'No', rarity: 'x'.repeat(81) }, { name: 'No', edition: 'x'.repeat(121) }, {}, [],
  ]) assert.equal((await h.fetch('/api/admin/veilings', mutation(admin, input))).status, 400);
  assert.equal((await h.fetch('/api/admin/veilings', { ...mutation(admin, {}), body: 'x'.repeat(100001) })).status, 413);
  const row = await create(h, admin, { name: '  Verified Sentinel  ', description: 'Lore', number: 7, rarity: 'Rare', edition: 'First' });
  assert.equal(row.name, 'Verified Sentinel');
  assert.equal(row.revision, 1);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM ownerships').first('n'), 0);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM discoveries').first('n'), 0);
  const audit = await h.db.prepare('SELECT * FROM catalog_audit WHERE veiling_id=?').bind(row.id).first<{ actor_user_id: string; before_json: string | null; after_json: string }>();
  assert.equal(audit!.actor_user_id, admin.id);
  assert.equal(audit!.before_json, null);
  assert.equal(JSON.parse(audit!.after_json).name, 'Verified Sentinel');
  await assert.rejects(h.db.prepare("UPDATE catalog_audit SET action='update'").run(), /append-only/);
  await assert.rejects(h.db.prepare('DELETE FROM catalog_audit').run(), /append-only/);
  assert.equal((await h.fetch('/api/admin/veilings', mutation(admin, { name: 'Duplicate', number: 7 }))).status, 409);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM catalog_audit').first('n'), 1);
});

test('catalog revisions prevent stale editors and missing revision writes', async (t) => {
  const h = await harness(t);
  const admin = await seedSession(h.db, { admin: true });
  const row = await create(h, admin, { description: 'Original', number: 10 });
  assert.equal((await h.fetch(`/api/admin/veilings/${row.id}`, { ...mutation(admin, { name: 'Missing' }), method: 'PATCH' })).status, 428);
  assert.equal((await h.fetch(`/api/admin/veilings/${row.id}`, { ...mutation(admin, { name: 'Bad' }, 1), headers: { ...admin.headers, 'Content-Type': 'application/json', 'If-Match': '*' } })).status, 400);
  const saved = await h.fetch(`/api/admin/veilings/${row.id}`, mutation(admin, { name: 'Editor A' }, 1));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json() as { revision: number }).revision, 2);
  assert.equal((await h.fetch(`/api/admin/veilings/${row.id}`, mutation(admin, { name: 'Editor B' }, 1))).status, 409);
  assert.equal((await upload(h, admin, row.id, 1)).status, 409);
  assert.equal((await h.r2.list()).objects.length, 0);
  const current = await h.db.prepare('SELECT name,description,revision FROM catalog_veilings WHERE id=?').bind(row.id).first();
  assert.deepEqual(current, { name: 'Editor A', description: 'Original', revision: 2 });
  const audit = await h.db.prepare("SELECT before_json,after_json FROM catalog_audit WHERE veiling_id=? AND action='update'").bind(row.id).first<{ before_json: string; after_json: string }>();
  assert.equal(JSON.parse(audit!.before_json).name, 'Veil Sentinel');
  assert.equal(JSON.parse(audit!.after_json).name, 'Editor A');
  assert.equal(await h.db.prepare('SELECT count(*) n FROM catalog_audit').first('n'), 2);
});

test('dashboard projects only own non-draft collection and redacts undiscovered content and other identities', async (t) => {
  const h = await harness(t);
  const admin = await seedSession(h.db, { admin: true });
  const alice = await seedSession(h.db);
  const bob = await seedSession(h.db);
  const ownRow = await create(h, admin, { name: 'Alice Only', description: 'Own lore', number: 1 });
  const bobRow = await create(h, admin, { name: 'Bob Secret', description: 'Other collector lore', number: 2 });
  const hidden = await create(h, admin, { name: 'Unrevealed Secret', description: 'Unrevealed lore', number: 3 });
  const draft = await create(h, admin, { name: 'Draft Secret', status: 'draft', number: 4 });
  await create(h, admin, { name: 'Unowned Catalog Secret', number: 5 });
  await own(h, alice, ownRow.id, true, bob.id);
  await own(h, bob, bobRow.id);
  await own(h, alice, hidden.id, false);
  await own(h, alice, draft.id);
  const response = await h.fetch(`/api/dashboard?userId=${bob.id}&role=admin`, { headers: { ...alice.headers, 'X-User-Id': bob.id, 'X-Role': 'admin' } });
  assert.equal(response.status, 200);
  const snapshot = await response.json() as {
    schemaVersion: string; mode: string; profile: { id: string }; veilings: Array<{ id: string; name: string | null; lore: unknown[]; artwork: unknown[] }>;
    ownerships: Array<{ userId: string }>; discoveries: Array<{ firstDiscovererId: string | null }>;
  };
  assert.equal(snapshot.schemaVersion, '1');
  assert.equal(snapshot.mode, 'live');
  assert.equal(snapshot.profile.id, alice.id);
  assert.deepEqual(snapshot.veilings.map((v) => v.id), [ownRow.id, hidden.id]);
  assert(snapshot.ownerships.every((o) => o.userId === alice.id));
  assert(snapshot.discoveries.every((d) => d.firstDiscovererId === null));
  assert.deepEqual(snapshot.veilings.find((v) => v.id === hidden.id), {
    id: hidden.id, number: 3, name: null, type: null, origin: null, editionIds: [], artwork: [], lore: [], releaseDate: null, contentStatus: 'redacted',
  });
  const encoded = JSON.stringify(snapshot);
  for (const secret of ['Bob Secret', 'Draft Secret', 'Unrevealed Secret', 'Unrevealed lore', 'Unowned Catalog Secret', bob.id]) assert(!encoded.includes(secret));
  const empty = await (await h.fetch('/api/dashboard', { headers: admin.headers })).json() as { veilings: unknown[]; ownerships: unknown[] };
  assert.deepEqual(empty.veilings, []);
  assert.deepEqual(empty.ownerships, []);
  assert.equal((await h.fetch('/api/admin/veilings', { headers: alice.headers })).status, 403);
});

test('private artwork validates size/signature, checks ownership/discovery, and preserves immutable prior artwork', async (t) => {
  const h = await harness(t);
  const admin = await seedSession(h.db, { admin: true });
  const owner = await seedSession(h.db);
  const stranger = await seedSession(h.db);
  const row = await create(h, admin);
  await own(h, owner, row.id, false);
  assert.equal((await upload(h, admin, row.id, 1, new TextEncoder().encode('<svg>not PNG</svg>'))).status, 400);
  assert.equal((await upload(h, admin, row.id, 1, png, 'image/svg+xml')).status, 400);
  assert.equal((await upload(h, admin, row.id, 1, new Uint8Array(8 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await h.r2.list()).objects.length, 0);
  const uploaded = await upload(h, admin, row.id, 1);
  assert.equal(uploaded.status, 200);
  const first = await uploaded.json() as { revision: number; artworkUrl: string };
  assert.equal(first.revision, 2);
  assert.match(first.artworkUrl, /^\/api\/artwork\/[0-9a-f-]{36}$/);
  assert.equal((await h.fetch(first.artworkUrl)).status, 401);
  assert.equal((await h.fetch(first.artworkUrl, { headers: stranger.headers })).status, 404);
  assert.equal((await h.fetch(first.artworkUrl, { headers: owner.headers })).status, 404, 'undiscovered artwork stays redacted even for its owner');
  await h.db.prepare('INSERT INTO discoveries(veiling_id,status,reveal_kind) VALUES(?,?,?)').bind(row.id, 'revealed', 'launch').run();
  const visible = await h.fetch(first.artworkUrl, { headers: owner.headers });
  assert.equal(visible.status, 200);
  assert.equal(visible.headers.get('Content-Type'), 'image/png');
  assert.match(visible.headers.get('Cache-Control')!, /no-store/);
  assert.equal(visible.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(Buffer.from(await visible.arrayBuffer()), png);
  const secondResponse = await upload(h, admin, row.id, 2);
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json() as { artworkUrl: string };
  assert.notEqual(second.artworkUrl, first.artworkUrl);
  assert.equal((await h.r2.list()).objects.length, 2);
  assert.equal((await h.fetch(first.artworkUrl, { headers: owner.headers })).status, 404);
  assert.equal((await h.fetch(first.artworkUrl, { headers: admin.headers })).status, 200);
  assert.equal((await h.fetch(second.artworkUrl, { headers: owner.headers })).status, 200);
  const rows = await (await h.fetch('/api/admin/veilings', { headers: admin.headers })).json();
  assert(!JSON.stringify(rows).includes('veilings/'));
  assert(!JSON.stringify(rows).includes('object_key'));
});

test('D1 catalog/audit failure rolls back creation, edits, artwork attachment and removes new R2 object', async (t) => {
  const h = await harness(t);
  const admin = await seedSession(h.db, { admin: true });
  const rejectAudit = () => h.db.prepare("CREATE TRIGGER reject_audit BEFORE INSERT ON catalog_audit BEGIN SELECT RAISE(ABORT, 'test audit failure'); END").run();
  await rejectAudit();
  assert.equal((await h.fetch('/api/admin/veilings', mutation(admin, { name: 'Rollback Creation' }))).status, 503);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM catalog_veilings').first('n'), 0);
  await h.db.prepare('DROP TRIGGER reject_audit').run();
  const row = await create(h, admin);
  await rejectAudit();
  assert.equal((await h.fetch(`/api/admin/veilings/${row.id}`, mutation(admin, { name: 'Rollback Edit' }, 1))).status, 503);
  assert.equal((await upload(h, admin, row.id, 1)).status, 503);
  assert.deepEqual(await h.db.prepare('SELECT name,revision,artwork_id FROM catalog_veilings WHERE id=?').bind(row.id).first(), {
    name: 'Veil Sentinel', revision: 1, artwork_id: null,
  });
  assert.equal(await h.db.prepare('SELECT count(*) n FROM catalog_audit').first('n'), 1);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM artwork').first('n'), 0);
  assert.equal((await h.r2.list()).objects.length, 0);
});

test('administrator removal during R2 upload is rechecked inside the D1 attachment transaction', async (t) => {
  const h = await harness(t);
  const admin = await seedSession(h.db, { admin: true });
  const row = await create(h, admin);
  // Node's Web Crypto lacks Workers' timingSafeEqual extension. Use Node's
  // equivalent only for this direct boundary-interception test.
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
    configurable: true,
    value: (a: ArrayBuffer, b: ArrayBuffer) => timingSafeEqual(Buffer.from(a), Buffer.from(b)),
  });
  t.after(() => Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual'));
  // Use real local D1/R2 bindings and pause at their service boundary. Removing
  // permission after the initial check must not authorize the later DB write.
  const r2 = new Proxy(h.r2, {
    get(target, property, receiver) {
      if (property === 'put') return async (...args: Parameters<R2Bucket['put']>) => {
        const stored = await target.put(...args);
        await h.db.prepare('DELETE FROM admin_allowlist WHERE user_id=?').bind(admin.id).run();
        return stored;
      };
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await assert.rejects(handleData(new Request(`${origin}/api/admin/veilings/${row.id}/artwork`, {
    method: 'POST', headers: { ...admin.headers, 'Content-Type': 'image/png', 'If-Match': '"1"' }, body: png,
  }), { ...h.env, ARTWORK: r2 }), (error: unknown) => error instanceof Error && 'status' in error && error.status === 403);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM artwork').first('n'), 0);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM catalog_audit').first('n'), 1);
  assert.deepEqual(await h.db.prepare('SELECT revision,artwork_id FROM catalog_veilings WHERE id=?').bind(row.id).first(), { revision: 1, artwork_id: null });
  assert.equal((await h.r2.list()).objects.length, 0);
});
