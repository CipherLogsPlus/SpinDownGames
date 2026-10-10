import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { createHarness, seedSession, origin } from './support';
import { handleData } from '../src/data';

type Harness = Awaited<ReturnType<typeof createHarness>>;
type Session = Awaited<ReturnType<typeof seedSession>>;
type Row = { id: string; name: string; revision: number; canTrash: boolean; trashedAt: string | null; artworkUrl: string | null };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG2kAAAAASUVORK5CYII=', 'base64');
async function harness(t: TestContext, options: Parameters<typeof createHarness>[2] = {}) {
  const h = await createHarness({}, undefined, options); t.after(() => h.mf.dispose()); return h;
}
async function create(h: Harness, admin: Session, extra = {}) {
  const result = await h.fetch('/api/admin/veilings', { method: 'POST', headers: { ...admin.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Private draft', ...extra }) });
  assert.equal(result.status, 201, await result.clone().text()); return result.json() as Promise<Row>;
}
function change(h: Harness, admin: Session, row: Row, action = 'trash', extra: RequestInit = {}) {
  return h.fetch(`/api/admin/veilings/${row.id}/${action}`, { method: 'POST', headers: { ...admin.headers, 'If-Match': `"${row.revision}"` }, ...extra });
}
async function upload(h: Harness, admin: Session, row: Row) {
  const response = await h.fetch(`/api/admin/veilings/${row.id}/artwork`, { method: 'POST', headers: { ...admin.headers, 'Content-Type': 'image/png', 'If-Match': `"${row.revision}"` }, body: png });
  assert.equal(response.status, 200); return response.json() as Promise<Row>;
}
async function state(h: Harness) {
  return Promise.all(['catalog_veilings', 'catalog_audit', 'artwork', 'publication_audit', 'veiling_publications', 'ownerships', 'discoveries', 'draft_trash_audit']
    .map(async table => (await h.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results));
}
function polyfill(t: TestContext) {
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true, value: (a: ArrayBuffer, b: ArrayBuffer) => timingSafeEqual(Buffer.from(a), Buffer.from(b)) });
  t.after(() => Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual'));
}
function beforeBatch(h: Harness, action: () => Promise<void>): D1Database {
  let intercepted = false;
  return new Proxy(h.db, { get(target, property) {
    if (property === 'withSession') return (...args: Parameters<D1Database['withSession']>) => {
      const db = target.withSession(...args);
      return new Proxy(db, { get(session, key) {
        if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
          if (!intercepted) { intercepted = true; await action(); }
          return session.batch(statements);
        };
        const value = Reflect.get(session, key); return typeof value === 'function' ? value.bind(session) : value;
      } });
    };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } });
}

test('Trash and Restore retain the same draft, artwork, number and immutable history', async t => {
  const h = await harness(t); const admin = await seedSession(h.db, { admin: true });
  const row = await upload(h, admin, await create(h, admin, { number: 7, description: 'Saved lore' }));
  const objects = (await h.r2.list()).objects.map(o => ({ key: o.key, etag: o.etag, size: o.size }));
  const before = await state(h);
  assert.equal(row.canTrash, true); assert.equal(row.trashedAt, null);
  const deleted = await change(h, admin, row); assert.equal(deleted.status, 200);
  const trashed = await deleted.json() as Row;
  assert.equal(trashed.revision, row.revision + 1); assert.equal(trashed.canTrash, false); assert.match(trashed.trashedAt!, /^\d{4}-/);
  assert.deepEqual(await (await h.fetch('/api/admin/veilings', { headers: admin.headers })).json(), []);
  assert.deepEqual(await (await h.fetch('/api/admin/veilings?trashed=true', { headers: admin.headers })).json(), [trashed]);
  assert.equal((await h.fetch(row.artworkUrl!, { headers: admin.headers })).status, 200);
  assert.equal((await createNumberConflict(h, admin)).status, 409, 'Trash retains the number so Restore cannot overwrite another draft');
  const restoredResponse = await change(h, admin, trashed, 'restore'); assert.equal(restoredResponse.status, 200);
  const restored = await restoredResponse.json() as Row;
  assert.equal(restored.id, row.id); assert.equal(restored.revision, row.revision + 2); assert.equal(restored.canTrash, true); assert.equal(restored.trashedAt, null);
  assert.equal(restored.artworkUrl, row.artworkUrl);
  assert.deepEqual(await (await h.fetch('/api/admin/veilings?trashed=true', { headers: admin.headers })).json(), []);
  assert.deepEqual((await state(h)).slice(1, 7), before.slice(1, 7), 'catalog, publication, ownership, discovery and artwork history is untouched');
  assert.deepEqual((await h.r2.list()).objects.map(o => ({ key: o.key, etag: o.etag, size: o.size })), objects);
  const audits = (await h.db.prepare('SELECT * FROM draft_trash_audit ORDER BY rowid').all()).results;
  assert.equal(audits.length, 2); assert.deepEqual(audits.map(a => a.action), ['trash', 'restore']);
  assert(audits.every(a => a.actor_user_id === admin.id));
  await assert.rejects(h.db.prepare("UPDATE draft_trash_audit SET action='restore'").run(), /append-only/);
  await assert.rejects(h.db.prepare('DELETE FROM draft_trash_audit').run(), /append-only/);
});
function createNumberConflict(h: Harness, admin: Session) {
  return h.fetch('/api/admin/veilings', { method: 'POST', headers: { ...admin.headers, 'Content-Type': 'application/json' }, body: '{"name":"Other","number":7}' });
}

test('trash rejects owned, discovered, published, hidden-publication and legacy-visible records', async t => {
  const h = await harness(t); const admin = await seedSession(h.db, { admin: true }); const collector = await seedSession(h.db);
  for (const kind of ['owned', 'undiscovered', 'revealed', 'public', 'upcoming', 'hidden', 'active', 'retired', 'legacy-history'] as const) await t.test(kind, async () => {
    let row = await create(h, admin, { status: ['active', 'retired', 'legacy-history'].includes(kind) ? kind === 'retired' ? 'retired' : 'active' : 'draft' });
    if (kind === 'owned') await h.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), collector.id, row.id, 'server_grant', 1).run();
    if (kind === 'undiscovered' || kind === 'revealed') await h.db.prepare('INSERT INTO discoveries(veiling_id,status) VALUES(?,?)').bind(row.id, kind).run();
    if (['public', 'upcoming', 'hidden'].includes(kind)) {
      const result = await h.fetch(`/api/admin/veilings/${row.id}/publication`, { method: 'POST', headers: { ...admin.headers, 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: JSON.stringify({ visibility: kind === 'upcoming' ? 'upcoming' : 'public', releaseDate: null, useSavedDraft: true }) });
      assert.equal(result.status, 200); row = await result.json() as Row;
      if (kind === 'hidden') {
        const hidden = await h.fetch(`/api/admin/veilings/${row.id}/publication`, { method: 'POST', headers: { ...admin.headers, 'Content-Type': 'application/json', 'If-Match': `"${row.revision}"` }, body: JSON.stringify({ visibility: 'private', releaseDate: null, useSavedDraft: false }) });
        assert.equal(hidden.status, 200); row = await hidden.json() as Row;
      }
    }
    if (kind === 'legacy-history') {
      const edited = await h.fetch(`/api/admin/veilings/${row.id}`, { method: 'PATCH', headers: { ...admin.headers, 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: '{"status":"draft"}' });
      assert.equal(edited.status, 200); row = await edited.json() as Row;
    }
    const before = await state(h); const result = await change(h, admin, row);
    assert.equal(result.status, 409); assert.equal((await result.json() as { code: string }).code, 'DRAFT_NOT_TRASHABLE');
    assert.deepEqual(await state(h), before);
    const list = await (await h.fetch('/api/admin/veilings', { headers: admin.headers })).json() as Row[];
    assert.equal(list.find(r => r.id === row.id)!.canTrash, false);
  });
});

test('trash preserves artwork references held by other catalog entries', async t => {
  const h = await harness(t); const admin = await seedSession(h.db, { admin: true });
  const row = await upload(h, admin, await create(h, admin)); const other = await create(h, admin);
  const id = row.artworkUrl!.split('/').at(-1)!;
  await h.db.prepare('UPDATE catalog_veilings SET artwork_id=? WHERE id=?').bind(id, other.id).run();
  assert.equal((await change(h, admin, row)).status, 200);
  assert.equal(await h.db.prepare('SELECT artwork_id FROM catalog_veilings WHERE id=?').bind(other.id).first('artwork_id'), id);
  assert.equal((await h.fetch(row.artworkUrl!, { headers: admin.headers })).status, 200);
  assert.equal((await h.r2.list()).objects.length, 1);
});

test('trashed rows reject edits, uploads, publication and new ownership/discovery at API and schema boundaries', async t => {
  const h = await harness(t); const admin = await seedSession(h.db, { admin: true });
  const row = await create(h, admin); const trashed = await (await change(h, admin, row)).json() as Row;
  const before = await state(h);
  for (const [suffix, method, type, body] of [['', 'PATCH', 'application/json', '{"name":"No"}'], ['/artwork', 'POST', 'image/png', png], ['/publication', 'POST', 'application/json', '{"visibility":"public","releaseDate":null,"useSavedDraft":true}']] as const) {
    const response = await h.fetch(`/api/admin/veilings/${row.id}${suffix}`, { method, headers: { ...admin.headers, 'Content-Type': type, 'If-Match': `"${trashed.revision}"` }, body });
    assert.equal(response.status, 409); assert.equal((await response.json() as { code: string }).code, 'DRAFT_TRASHED');
  }
  await assert.rejects(h.db.prepare("UPDATE catalog_veilings SET name='Old Worker edit' WHERE id=?").bind(row.id).run(), /restore the draft/);
  await assert.rejects(h.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), admin.id, row.id, 'server_grant', 1).run(), /restore the draft/);
  await assert.rejects(h.db.prepare("INSERT INTO discoveries(veiling_id,status) VALUES(?,'undiscovered')").bind(row.id).run(), /restore the draft/);
  assert.deepEqual(await state(h), before); assert.equal((await h.r2.list()).objects.length, 0);
});

test('trash and restore validate exact revisions, request shape, CSRF and administrator access without changes', async t => {
  const h = await harness(t); const admin = await seedSession(h.db, { admin: true }); const collector = await seedSession(h.db);
  const row = await create(h, admin); const before = await state(h);
  for (const [extra, status] of [
    [{ headers: {} }, 401], [{ headers: collector.headers }, 403], [{ headers: { Cookie: admin.cookie, 'If-Match': '"1"' } }, 403],
    [{ headers: { ...admin.headers, Origin: 'https://wrong.test', 'If-Match': '"1"' } }, 403],
    [{ headers: admin.headers }, 428], [{ headers: { ...admin.headers, 'If-Match': '*' } }, 400],
    [{ headers: { ...admin.headers, 'If-Match': '"99"' } }, 409], [{ body: '{}' }, 400], [{ body: 'x'.repeat(1025) }, 413],
    [{ method: 'DELETE' }, 405],
  ] as Array<[RequestInit, number]>) assert.equal((await change(h, admin, row, 'trash', extra)).status, status);
  assert.equal((await change(h, admin, row, 'restore')).status, 409);
  assert.equal((await h.fetch('/api/admin/veilings?trashed=all', { headers: admin.headers })).status, 400);
  assert.deepEqual(await state(h), before);
  const result = await change(h, admin, row); assert.equal(result.status, 200);
  assert.equal((await change(h, admin, row)).status, 409, 'duplicate click uses stale revision');
  const trashed = await result.json() as Row;
  assert.equal((await change(h, admin, trashed)).status, 409);
  assert.equal((await change(h, admin, row, 'restore')).status, 409);
});

test('trash and restore audit failures roll back every change', async t => {
  const h = await harness(t); const admin = await seedSession(h.db, { admin: true }); let row = await create(h, admin);
  for (const action of ['trash', 'restore']) {
    await h.db.prepare("CREATE TRIGGER reject_trash_audit BEFORE INSERT ON draft_trash_audit BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").run();
    const before = await state(h); assert.equal((await change(h, admin, row, action)).status, 503); assert.deepEqual(await state(h), before);
    await h.db.prepare('DROP TRIGGER reject_trash_audit').run();
    const success = await change(h, admin, row, action); assert.equal(success.status, 200); row = await success.json() as Row;
  }
});

test('eligibility and revision are rechecked atomically when ownership, discovery, publication, or edits arrive in flight', async t => {
  const h = await harness(t); polyfill(t); const admin = await seedSession(h.db, { admin: true });
  for (const kind of ['ownership', 'discovery', 'publication', 'edit']) await t.test(kind, async () => {
    const row = await create(h, admin); let expected: Awaited<ReturnType<typeof state>>;
    const db = beforeBatch(h, async () => {
      if (kind === 'ownership') await h.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), admin.id, row.id, 'server_grant', 1).run();
      else if (kind === 'discovery') await h.db.prepare("INSERT INTO discoveries(veiling_id,status) VALUES(?,'undiscovered')").bind(row.id).run();
      else if (kind === 'publication') assert.equal((await h.fetch(`/api/admin/veilings/${row.id}/publication`, { method: 'POST', headers: { ...admin.headers, 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: '{"visibility":"public","releaseDate":null,"useSavedDraft":true}' })).status, 200);
      else await h.db.prepare('UPDATE catalog_veilings SET revision=revision+1 WHERE id=?').bind(row.id).run();
      expected = await state(h);
    });
    await assert.rejects(handleData(new Request(`${origin}/api/admin/veilings/${row.id}/trash`, { method: 'POST', headers: { ...admin.headers, 'If-Match': '"1"' } }), { ...h.env, DB: db }), (e: unknown) => e instanceof Error && 'status' in e && e.status === 409);
    assert.deepEqual(await state(h), expected!);
  });
});

test('artwork status reflects binding availability and unconfigured uploads preserve saved drafts', async t => {
  for (const available of [false, true]) await t.test(String(available), async t => {
    const h = await harness(t, { artwork: available }); const admin = await seedSession(h.db, { admin: true }); const collector = await seedSession(h.db);
    assert.equal((await h.fetch('/api/admin/artwork-status')).status, 401);
    assert.equal((await h.fetch('/api/admin/artwork-status', { headers: collector.headers })).status, 403);
    const capability = await h.fetch('/api/admin/artwork-status', { headers: admin.headers });
    assert.equal(capability.status, 200); assert.deepEqual(await capability.json(), { available, maxBytes: 8388608, acceptedTypes: ['image/png', 'image/jpeg', 'image/webp'] });
    const row = await create(h, admin); const before = await state(h);
    const response = await h.fetch(`/api/admin/veilings/${row.id}/artwork`, { method: 'POST', headers: { ...admin.headers, 'Content-Type': 'image/png', 'If-Match': '"1"' }, body: png });
    assert.equal(response.status, available ? 200 : 503);
    if (!available) { assert.equal((await response.json() as { code: string }).code, 'ARTWORK_UNAVAILABLE'); assert.deepEqual(await state(h), before); }
  });
});

test('additive migration preserves existing rows and does not prevent pre-trash Worker operations', async t => {
  const h = await harness(t, { throughMigration: '0005_member_showcase.sql' }); const admin = await seedSession(h.db, { admin: true });
  const id = crypto.randomUUID();
  await h.db.prepare("INSERT INTO catalog_veilings(id,name,created_by,updated_by,created_at,updated_at) VALUES(?,'Existing draft',?,?,1,1)").bind(id, admin.id, admin.id).run();
  const before = await h.db.prepare('SELECT * FROM catalog_veilings').first<Record<string, unknown>>();
  const migration = await readFile(new URL('../migrations/0006_draft_trash.sql', import.meta.url), 'utf8');
  for (const statement of migration.split(/;\s*(?:\n|$)/).filter(s => s.trim())) await h.db.prepare(statement).run();
  assert.deepEqual(await h.db.prepare('SELECT * FROM catalog_veilings').first(), { ...before, trashed_at: null, trashed_by: null });
  await h.db.prepare("UPDATE catalog_veilings SET name='Old Worker edit',revision=revision+1 WHERE id=?").bind(id).run();
  assert.equal(await h.db.prepare('SELECT name FROM catalog_veilings WHERE id=?').bind(id).first('name'), 'Old Worker edit');
  assert.equal(await h.db.prepare('SELECT count(*) n FROM draft_trash_audit').first('n'), 0);
});

test('an in-flight upload cannot attach to a newly trashed draft or remove its retained artwork', async t => {
  const h = await harness(t); polyfill(t); const admin = await seedSession(h.db, { admin: true });
  const row = await upload(h, admin, await create(h, admin));
  const objects = (await h.r2.list()).objects.map(o => o.key);
  let expected: Awaited<ReturnType<typeof state>>;
  const bucket = new Proxy(h.r2, { get(target, key) {
    if (key === 'put') return async (...args: Parameters<R2Bucket['put']>) => {
      const stored = await target.put(...args);
      assert.equal((await change(h, admin, row)).status, 200);
      expected = await state(h); return stored;
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  await assert.rejects(handleData(new Request(`${origin}/api/admin/veilings/${row.id}/artwork`, {
    method: 'POST', headers: { ...admin.headers, 'If-Match': `"${row.revision}"`, 'Content-Type': 'image/png' }, body: png,
  }), { ...h.env, ARTWORK: bucket }), (e: unknown) => e instanceof Error && 'status' in e && e.status === 409);
  assert.deepEqual(await state(h), expected!);
  assert.deepEqual((await h.r2.list()).objects.map(o => o.key), objects);
  assert.equal((await h.fetch(row.artworkUrl!, { headers: admin.headers })).status, 200);
});

test('legacy active rows without create audits remain ineligible when only the before-snapshot records visibility', async t => {
  const h = await harness(t); const admin = await seedSession(h.db, { admin: true }); const id = crypto.randomUUID();
  await h.db.prepare("INSERT INTO catalog_veilings(id,name,status,created_by,updated_by,created_at,updated_at) VALUES(?,'Legacy visible','active',?,?,1,1)")
    .bind(id, admin.id, admin.id).run();
  const updated = await h.fetch(`/api/admin/veilings/${id}`, { method: 'PATCH', headers: { ...admin.headers, 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: '{"status":"draft"}' });
  assert.equal(updated.status, 200); const row = await updated.json() as Row; assert.equal(row.canTrash, false);
  const audit = await h.db.prepare('SELECT before_json,after_json FROM catalog_audit WHERE veiling_id=?').bind(id).first<{ before_json: string; after_json: string }>();
  assert.equal(JSON.parse(audit!.before_json).status, 'active'); assert.equal(JSON.parse(audit!.after_json).status, 'draft');
  const before = await state(h); assert.equal((await change(h, admin, row)).status, 409);
  await assert.rejects(h.db.prepare('UPDATE catalog_veilings SET trashed_at=1,trashed_by=? WHERE id=?').bind(admin.id, id).run(), /only unpublished unowned drafts/);
  assert.deepEqual(await state(h), before);
});
