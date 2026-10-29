import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createHarness, seedSession } from './support';

const url = (id: string) => `/api/admin/veilings/${id}`;
async function harness(t: TestContext) {
  const h = await createHarness();
  t.after(() => h.mf.dispose());
  return h;
}
async function create(h: Awaited<ReturnType<typeof createHarness>>, headers: Record<string,string>, name = 'Test Ashenling') {
  const response = await h.fetch('/api/admin/veilings', { method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, status: 'draft', number: 71 }) });
  assert.equal(response.status, 201);
  return response.json() as Promise<{ id: string, revision: number }>;
}
function del(id: string, headers: Record<string,string>, revision?: number) {
  return { method: 'DELETE', headers: {
    ...headers, 'Content-Type': 'application/json',
    ...(revision ? { 'If-Match': `"${revision}"` } : {}),
  }, body: '{}' };
}
function visibility(headers: Record<string,string>, revision: number, value: string, useSavedDraft: boolean) {
  return { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'If-Match': `"${revision}"` },
    body: JSON.stringify({ visibility: value, releaseDate: null, useSavedDraft }) };
}

test('draft deletion keeps the historical row and audit while removing it from active Studio', async t => {
  const h = await harness(t);
  const admin = await seedSession(h.db, { admin: true });
  const draft = await create(h, admin.headers);
  const response = await h.fetch(url(draft.id), del(draft.id, admin.headers, draft.revision));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: draft.id, deleted: true });
  const rows = await (await h.fetch('/api/admin/veilings', { headers: admin.headers })).json() as Array<{ id: string }>;
  assert(!rows.some(row => row.id === draft.id));
  const record = await h.db.prepare('SELECT id,deleted_at,deleted_by,character_number,revision FROM catalog_veilings WHERE id=?')
    .bind(draft.id).first<{ id:string,deleted_at:number,deleted_by:string,character_number:number|null,revision:number }>();
  assert.equal(record?.id, draft.id);
  assert.equal(record?.deleted_by, admin.id);
  assert.equal(record?.character_number, null);
  assert.equal(record?.revision, draft.revision + 1);
  assert(record?.deleted_at && record.deleted_at > 0);
  const audit = await h.db.prepare('SELECT before_json,actor_user_id FROM veiling_deletion_audit WHERE veiling_id=?')
    .bind(draft.id).first<{ before_json:string,actor_user_id:string }>();
  assert.equal(JSON.parse(audit!.before_json).name, 'Test Ashenling');
  assert.equal(audit?.actor_user_id, admin.id);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM catalog_audit WHERE veiling_id=?')
    .bind(draft.id).first('n'), 1);
  await assert.rejects(h.db.prepare('DELETE FROM veiling_deletion_audit WHERE veiling_id=?').bind(draft.id).run(), /append-only/);
  assert.equal((await h.fetch(url(draft.id), del(draft.id, admin.headers, draft.revision))).status, 404);
});

test('draft deletion requires admin authorization, active session, CSRF and current revision', async t => {
  const h = await harness(t);
  const admin = await seedSession(h.db, { admin: true });
  const collector = await seedSession(h.db);
  const draft = await create(h, admin.headers);
  assert.equal((await h.fetch(url(draft.id), del(draft.id, collector.headers, draft.revision))).status, 403);
  assert.equal((await h.fetch(url(draft.id), del(draft.id, {}, draft.revision))).status, 401);
  assert.equal((await h.fetch(url(draft.id), del(draft.id, admin.headers))).status, 428);
  assert.equal((await h.fetch(url(draft.id), del(draft.id, { ...admin.headers, Origin: 'https://outside.test' }, draft.revision))).status, 403);
  assert.equal((await h.fetch(url(draft.id), del(draft.id, { ...admin.headers, 'X-CSRF-Token':'forged' }, draft.revision))).status, 403);
  assert.equal((await h.fetch(url(draft.id), del(draft.id, admin.headers, draft.revision+1))).status, 409);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM veiling_deletion_audit').first('n')), 0);
});

test('published Veilings are protected until explicitly hidden, then can be removed from Studio', async t => {
  const h = await harness(t);
  const admin = await seedSession(h.db, { admin: true });
  const draft = await create(h, admin.headers);
  const publish = await h.fetch(url(draft.id)+'/publication', visibility(admin.headers, draft.revision, 'public', true));
  assert.equal(publish.status, 200);
  const published = await publish.json() as { revision: number, publication: unknown };
  assert(published.publication);
  const denied = await h.fetch(url(draft.id), del(draft.id, admin.headers, published.revision));
  assert.equal(denied.status, 409);
  assert.equal((await denied.json() as {code:string}).code, 'UNPUBLISH_FIRST');
  assert.equal((await h.db.prepare('SELECT deleted_at FROM catalog_veilings WHERE id=?').bind(draft.id).first<{deleted_at:number|null}>())?.deleted_at, null);
  const hide = await h.fetch(url(draft.id)+'/publication', visibility(admin.headers, published.revision, 'private', false));
  assert.equal(hide.status, 200);
  const hidden = await hide.json() as { revision: number, publication: unknown };
  assert.equal(hidden.publication, null);
  const removed = await h.fetch(url(draft.id), del(draft.id, admin.headers, hidden.revision));
  assert.equal(removed.status, 200);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM publication_audit WHERE veiling_id=?')
    .bind(draft.id).first('n'), 2);
});

test('deleted catalog records keep real collector ownership rather than revoking it', async t => {
  const h = await harness(t);
  const admin = await seedSession(h.db, { admin: true });
  const collector = await seedSession(h.db);
  const row = await create(h, admin.headers);
  const ownershipId = crypto.randomUUID();
  await h.db.prepare("INSERT INTO ownerships(id,user_id,veiling_id,acquisition,acquired_at) VALUES(?,?,?,'server_grant',?)")
    .bind(ownershipId,collector.id,row.id,Math.floor(Date.now()/1000)).run();
  assert.equal((await h.fetch(url(row.id), del(row.id, admin.headers, row.revision))).status, 200);
  const ownership = await h.fetch('/api/ownerships/'+ownershipId, { headers: collector.headers });
  assert.equal(ownership.status, 200);
  const detail = await ownership.json() as { ownership:{id:string},veiling:{contentStatus:string} };
  assert.equal(detail.ownership.id, ownershipId);
  assert.equal(detail.veiling.contentStatus, 'unavailable');
});
