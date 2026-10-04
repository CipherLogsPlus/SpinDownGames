import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { timingSafeEqual } from 'node:crypto';
import { createHarness, seedSession, origin } from './support';
import { handleData } from '../src/data';

type Harness = Awaited<ReturnType<typeof createHarness>>;
type Session = Awaited<ReturnType<typeof seedSession>>;
interface Snapshot {
  id: string; name: string; number: number | null; description: string; rarity: string | null; edition: string | null;
  artworkUrl: string | null; visibility: 'public' | 'upcoming'; releaseDate: string | null; updatedAt: string;
}
interface Catalog {
  id: string; name: string; revision: number; artworkUrl: string | null;
  publication: (Snapshot & { sourceRevision: number }) | null;
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG2kAAAAASUVORK5CYII=', 'base64');
async function harness(t: TestContext) { const h = await createHarness(); t.after(() => h.mf.dispose()); return h; }
function write(session: Session, body: unknown, revision?: number, method = 'POST'): RequestInit {
  return { method, headers: { ...session.headers, 'Content-Type': 'application/json',
    ...(revision === undefined ? {} : { 'If-Match': `"${revision}"` }) }, body: JSON.stringify(body) };
}
async function create(h: Harness, admin: Session, fields: Record<string, unknown> = {}): Promise<Catalog> {
  const response = await h.fetch('/api/admin/veilings', write(admin,
    { name: 'Approved name', description: 'Approved lore', number: 71, rarity: 'Rare', edition: 'First', status: 'draft', ...fields }));
  assert.equal(response.status, 201);
  return response.json() as Promise<Catalog>;
}
async function publish(h: Harness, admin: Session, row: Catalog, visibility = 'public', useSavedDraft = true, releaseDate: string | null = null): Promise<Catalog> {
  const response = await h.fetch(`/api/admin/veilings/${row.id}/publication`, write(admin, { visibility, releaseDate, useSavedDraft }, row.revision));
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<Catalog>;
}
async function edit(h: Harness, admin: Session, row: Catalog, fields: Record<string, unknown>): Promise<Catalog> {
  const response = await h.fetch(`/api/admin/veilings/${row.id}`, write(admin, fields, row.revision, 'PATCH'));
  assert.equal(response.status, 200);
  return response.json() as Promise<Catalog>;
}
async function upload(h: Harness, admin: Session, row: Catalog): Promise<Catalog> {
  const response = await h.fetch(`/api/admin/veilings/${row.id}/artwork`, {
    method: 'POST', headers: { ...admin.headers, 'Content-Type': 'image/png', 'If-Match': `"${row.revision}"` }, body: png,
  });
  assert.equal(response.status, 200);
  return response.json() as Promise<Catalog>;
}
async function showcase(h: Harness, member: Session) {
  const response = await h.fetch('/api/showcase', { headers: member.headers });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json() as Promise<{ schemaVersion: string; mode: string; veilings: Snapshot[] }>;
}

test('showcase is members-only, never backfills active catalog and leaves collection/discovery authority untouched', async t => {
  const h = await harness(t); const admin = await seedSession(h.db, { admin: true });
  const member = await seedSession(h.db); const expired = await seedSession(h.db, { expiresAt: Math.floor(Date.now() / 1000) });
  const row = await create(h, admin, { status: 'active' });
  assert.equal(row.publication, null);
  assert.deepEqual(await showcase(h, member), { schemaVersion: '1', mode: 'live', veilings: [] });
  for (const endpoint of ['/api/showcase', `/api/showcase/${row.id}`]) {
    assert.equal((await h.fetch(endpoint)).status, 401);
    assert.equal((await h.fetch(endpoint, { headers: expired.headers })).status, 401);
    assert.equal((await h.fetch(endpoint, { headers: { 'X-User-Id': admin.id, 'X-Role': 'admin' } })).status, 401);
    assert.equal((await h.fetch(endpoint, { method: 'POST', headers: member.headers })).status, 405);
  }
  for (const id of [row.id, crypto.randomUUID(), 'bad', ''])
    assert.equal((await h.fetch(`/api/showcase/${id}`, { headers: member.headers })).status, 404);
  const published = await publish(h, admin, row);
  const list = await showcase(h, member);
  assert.equal(list.veilings.length, 1);
  const { sourceRevision, ...snapshot } = published.publication!;
  assert.equal(sourceRevision, published.revision);
  assert.deepEqual(list.veilings[0], snapshot);
  const detail = await h.fetch(`/api/showcase/${row.id.toUpperCase()}`, { headers: member.headers });
  assert.equal(detail.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await detail.json(), { schemaVersion: '1', mode: 'live', veiling: snapshot });
  for (const table of ['ownerships', 'discoveries']) assert.equal(await h.db.prepare(`SELECT count(*) n FROM ${table}`).first('n'), 0);
  const dashboard = await (await h.fetch('/api/dashboard', { headers: member.headers })).json() as { ownerships: unknown[]; veilings: unknown[] };
  assert.deepEqual(dashboard.ownerships, []); assert.deepEqual(dashboard.veilings, []);
  await h.db.prepare('UPDATE users SET disabled=1 WHERE id=?').bind(member.id).run();
  assert.equal((await h.fetch('/api/showcase', { headers: member.headers })).status, 401);
  await h.db.prepare('UPDATE users SET disabled=0 WHERE id=?').bind(member.id).run();
  await h.db.prepare('DELETE FROM sessions WHERE user_id=?').bind(member.id).run();
  assert.equal((await h.fetch('/api/showcase', { headers: member.headers })).status, 401);
});

test('manual visibility/date changes preserve approved snapshots and pending edits until explicit approval', async t => {
  const h = await harness(t); const admin = await seedSession(h.db, { admin: true }); const member = await seedSession(h.db);
  let row = await create(h, admin);
  for (const visibility of ['public', 'upcoming', 'private']) {
    const noSnapshot = await h.fetch(`/api/admin/veilings/${row.id}/publication`, write(admin,
      { visibility, releaseDate: null, useSavedDraft: false }, row.revision));
    assert.equal(noSnapshot.status, 409); assert.equal((await noSnapshot.json() as { code: string }).code, 'PUBLICATION_REQUIRED');
    assert.equal(await h.db.prepare('SELECT revision FROM catalog_veilings WHERE id=?').bind(row.id).first('revision'), row.revision);
    assert.equal(await h.db.prepare('SELECT count(*) n FROM publication_audit').first('n'), 0);
  }
  row = await publish(h, admin, row, 'upcoming', true, '2000-01-01');
  assert.equal((await showcase(h, member)).veilings[0].visibility, 'upcoming', 'past dates do not publish automatically');
  assert.equal(row.publication!.sourceRevision, row.revision);
  row = await publish(h, admin, row, 'public', false);
  assert.equal(row.publication!.sourceRevision, row.revision, 'visibility-only changes without pending edits keep revisions aligned');
  const approvedRevision = row.publication!.sourceRevision;
  row = await edit(h, admin, row, { name: 'Unapproved name', description: 'Unapproved lore', number: 72, rarity: 'Other', edition: 'Next', status: 'draft' });
  assert.equal(row.publication!.name, 'Approved name');
  row = await publish(h, admin, row, 'upcoming', false, null);
  assert.equal(row.publication!.sourceRevision, approvedRevision);
  assert.deepEqual({ ...row.publication, updatedAt: null }, {
    id: row.id, name: 'Approved name', description: 'Approved lore', number: 71, rarity: 'Rare', edition: 'First',
    artworkUrl: null, visibility: 'upcoming', releaseDate: null, sourceRevision: approvedRevision, updatedAt: null,
  });
  assert(!JSON.stringify(await showcase(h, member)).includes('Unapproved'));
  row = await publish(h, admin, row, 'public', true);
  assert.equal(row.publication!.name, 'Unapproved name'); assert.equal(row.publication!.sourceRevision, row.revision);
  const current = (await showcase(h, member)).veilings[0]; assert.equal(current.number, 72);
  row = await publish(h, admin, row, 'private', false);
  assert.equal(row.publication, null); assert.deepEqual((await showcase(h, member)).veilings, []);
  assert.equal((await h.fetch(`/api/showcase/${row.id}`, { headers: member.headers })).status, 404);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM publication_audit').first('n'), 5);
  const repeatedHide = await h.fetch(`/api/admin/veilings/${row.id}/publication`, write(admin,
    { visibility: 'private', releaseDate: null, useSavedDraft: false }, row.revision));
  assert.equal(repeatedHide.status, 409);
  assert.equal((await repeatedHide.json() as { code: string }).code, 'PUBLICATION_REQUIRED');
  assert.equal(await h.db.prepare('SELECT revision FROM catalog_veilings WHERE id=?').bind(row.id).first('revision'), row.revision);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM publication_audit').first('n'), 5);
  await assert.rejects(h.db.prepare('UPDATE publication_audit SET action=\'hide\'').run(), /append-only/);
  await assert.rejects(h.db.prepare('DELETE FROM publication_audit').run(), /append-only/);
  const audit = await h.db.prepare('SELECT before_json,after_json FROM publication_audit WHERE action=\'hide\'').first<{ before_json: string; after_json: null }>();
  assert.equal(JSON.parse(audit!.before_json).name, current.name); assert.equal(audit!.after_json, null);
});

test('owned records and member artwork use the approved snapshot while working draft edits remain private', async t => {
  const h = await harness(t); const admin = await seedSession(h.db, { admin: true });
  const owner = await seedSession(h.db); const member = await seedSession(h.db);
  let row = await upload(h, admin, await create(h, admin));
  const originalArt = row.artworkUrl!; const ownershipId = crypto.randomUUID();
  await h.db.prepare('INSERT INTO ownerships VALUES(?,?,?,?,?)').bind(ownershipId, owner.id, row.id, 'server_grant', 1700000000).run();
  assert.equal((await h.fetch(originalArt, { headers: member.headers })).status, 404);
  row = await publish(h, admin, row);
  const detailBefore = await (await h.fetch(`/api/ownerships/${ownershipId}`, { headers: owner.headers })).json();
  const dashboardBefore = await (await h.fetch('/api/dashboard', { headers: owner.headers })).json() as { ownerships: unknown[]; veilings: unknown[]; discoveries: unknown[] };
  assert.deepEqual(dashboardBefore.discoveries, []);
  row = await edit(h, admin, row, { name: 'Secret working name', description: 'Secret working lore', number: 99, status: 'active' });
  row = await upload(h, admin, row);
  const draftArt = row.artworkUrl!;
  assert.notEqual(draftArt, originalArt);
  for (const session of [owner, member]) {
    const art = await h.fetch(originalArt, { headers: session.headers });
    assert.equal(art.status, 200); assert.equal(art.headers.get('cache-control'), 'private, no-store');
    assert.equal((await h.fetch(draftArt, { headers: session.headers })).status, 404);
  }
  assert.equal((await h.fetch(draftArt, { headers: admin.headers })).status, 200);
  assert.equal((await h.fetch(originalArt)).status, 401);
  assert.deepEqual(await (await h.fetch(`/api/ownerships/${ownershipId}`, { headers: owner.headers })).json(), detailBefore);
  const dashboardAfter = await (await h.fetch('/api/dashboard', { headers: owner.headers })).json() as typeof dashboardBefore;
  assert.deepEqual(dashboardAfter.veilings, dashboardBefore.veilings);
  assert.deepEqual(dashboardAfter.ownerships, dashboardBefore.ownerships);
  assert(!JSON.stringify(await showcase(h, member)).includes('Secret working'));
  row = await edit(h, admin, row, { status: 'draft' });
  row = await publish(h, admin, row, 'upcoming', false);
  assert.equal(row.publication!.artworkUrl, originalArt);
  row = await publish(h, admin, row, 'public', true);
  assert.equal(row.publication!.artworkUrl, draftArt);
  assert.equal((await h.fetch(originalArt, { headers: member.headers })).status, 404);
  assert.equal((await h.fetch(draftArt, { headers: member.headers })).status, 200);
  const approved = await (await h.fetch(`/api/ownerships/${ownershipId}`, { headers: owner.headers })).json() as { veiling: { name: string; artworkUrl: string } };
  assert.equal(approved.veiling.name, 'Secret working name'); assert.equal(approved.veiling.artworkUrl, draftArt);
  row = await publish(h, admin, row, 'private', false);
  assert.equal((await h.fetch(draftArt, { headers: member.headers })).status, 404);
  const hidden = await (await h.fetch(`/api/ownerships/${ownershipId}`, { headers: owner.headers })).json() as { veiling: { contentStatus: string; name: null } };
  assert.equal(hidden.veiling.contentStatus, 'unavailable'); assert.equal(hidden.veiling.name, null);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM ownerships').first('n'), 1);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM discoveries').first('n'), 0);
});

test('publication enforces exact input, calendar dates, Origin, CSRF, admin authority and revision', async t => {
  const h = await harness(t); const admin = await seedSession(h.db, { admin: true }); const member = await seedSession(h.db);
  const row = await create(h, admin); const path = `/api/admin/veilings/${row.id}/publication`;
  const valid = { visibility: 'upcoming', releaseDate: null, useSavedDraft: true };
  assert.equal((await h.fetch(path, write(member, valid, 1))).status, 403);
  assert.equal((await h.fetch(path, write(admin, valid))).status, 428);
  assert.equal((await h.fetch(path, write(admin, valid, 2))).status, 409);
  for (const body of [null, [], {}, { ...valid, extra: true }, { ...valid, useSavedDraft: 1 }, { ...valid, visibility: 'scheduled' },
    { ...valid, visibility: 'private' },
    { ...valid, releaseDate: '0000-01-01' }, { ...valid, releaseDate: '1900-02-29' }, { ...valid, releaseDate: '2025-02-29' },
    { ...valid, releaseDate: '2026-04-31' }, { ...valid, releaseDate: '2026-13-01' }, { ...valid, releaseDate: '2026-1-01' },
    { ...valid, releaseDate: '2026-01-01T00:00:00Z' }, { ...valid, releaseDate: ' 2026-01-01' },
    { ...valid, visibility: 'public', releaseDate: '2026-01-01' }, { ...valid, visibility: 'private', releaseDate: '2026-01-01' }])
    assert.equal((await h.fetch(path, write(admin, body, 1))).status, 400);
  for (const headers of [{ ...admin.headers, Origin: 'https://untrusted.test' }, { ...admin.headers, 'X-CSRF-Token': 'forged' }])
    assert.equal((await h.fetch(path, { ...write(admin, valid, 1), headers: { ...headers, 'Content-Type': 'application/json', 'If-Match': '"1"' } })).status, 403);
  assert.equal((await h.fetch(path, { ...write(admin, valid, 1), body: 'x'.repeat(2049) })).status, 413);
  assert.equal((await h.fetch(path, { headers: admin.headers })).status, 405);
  const leap = await publish(h, admin, row, 'upcoming', true, '2000-02-29');
  assert.equal(leap.publication!.releaseDate, '2000-02-29');
});

test('approved numbers stay unique across pending edits and release only after explicit approval, while blanks remain allowed', async t => {
  const h = await harness(t); const admin = await seedSession(h.db, { admin: true }); const member = await seedSession(h.db);
  let original = await publish(h, admin, await create(h, admin));
  original = await edit(h, admin, original, { number: 72 });
  let replacement = await create(h, admin, { name: 'Replacement' });
  const response = await h.fetch(`/api/admin/veilings/${replacement.id}/publication`, write(admin,
    { visibility: 'upcoming', releaseDate: null, useSavedDraft: true }, replacement.revision));
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { code: string }).code, 'NUMBER_IN_USE');
  assert.equal(await h.db.prepare('SELECT revision FROM catalog_veilings WHERE id=?').bind(replacement.id).first('revision'), replacement.revision);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM publication_audit WHERE veiling_id=?').bind(replacement.id).first('n'), 0);
  assert.deepEqual((await showcase(h, member)).veilings.map(row => [row.id, row.number]), [[original.id, 71]]);
  original = await publish(h, admin, original);
  replacement = await publish(h, admin, replacement, 'upcoming');
  assert.equal(original.publication!.number, 72); assert.equal(replacement.publication!.number, 71);
  for (const name of ['Unnumbered first', 'Unnumbered second'])
    await publish(h, admin, await create(h, admin, { name, number: null }));
  assert.equal((await showcase(h, member)).veilings.filter(row => row.number === null).length, 2);
});

test('publication CAS has one winner and a failed snapshot/audit transaction changes nothing', async t => {
  const h = await harness(t); const admin = await seedSession(h.db, { admin: true }); let row = await create(h, admin);
  const path = `/api/admin/veilings/${row.id}/publication`;
  const request = write(admin, { visibility: 'public', releaseDate: null, useSavedDraft: true }, row.revision);
  const responses = await Promise.all([h.fetch(path, request), h.fetch(path, request)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  row = await responses.find(r => r.status === 200)!.json() as Catalog;
  assert.equal(await h.db.prepare('SELECT count(*) n FROM publication_audit').first('n'), 1);
  await h.db.prepare("CREATE TRIGGER reject_snapshot BEFORE UPDATE ON veiling_publications BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  assert.equal((await h.fetch(path, write(admin, { visibility: 'upcoming', releaseDate: null, useSavedDraft: false }, row.revision))).status, 503);
  assert.equal(await h.db.prepare('SELECT revision FROM catalog_veilings WHERE id=?').bind(row.id).first('revision'), row.revision);
  assert.equal(await h.db.prepare('SELECT visibility FROM veiling_publications WHERE veiling_id=?').bind(row.id).first('visibility'), 'public');
  assert.equal(await h.db.prepare('SELECT count(*) n FROM publication_audit').first('n'), 1);
  await h.db.prepare('DROP TRIGGER reject_snapshot').run();
  await h.db.prepare("CREATE TRIGGER reject_publication_audit BEFORE INSERT ON publication_audit BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  assert.equal((await h.fetch(path, write(admin, { visibility: 'private', releaseDate: null, useSavedDraft: false }, row.revision))).status, 503);
  assert.equal(await h.db.prepare('SELECT revision FROM catalog_veilings WHERE id=?').bind(row.id).first('revision'), row.revision);
  assert.equal(await h.db.prepare('SELECT count(*) n FROM veiling_publications').first('n'), 1);
});

test('transactional publication guard rejects session revocation, account disable, role loss and intervening edits', async t => {
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true,
    value: (a: ArrayBuffer, b: ArrayBuffer) => timingSafeEqual(Buffer.from(a), Buffer.from(b)) });
  t.after(() => Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual'));
  for (const kind of ['session', 'disabled', 'role', 'revision']) await t.test(kind, async t => {
    const h = await harness(t); const admin = await seedSession(h.db, { admin: true }); const row = await create(h, admin);
    let intercepted = false;
    const db = new Proxy(h.db, { get(target, property) {
      if (property === 'withSession') return (...args: Parameters<D1Database['withSession']>) => {
        const primary = target.withSession(...args);
        return new Proxy(primary, { get(session, key) {
          if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
            if (!intercepted) {
              intercepted = true;
              if (kind === 'session') await h.db.prepare('DELETE FROM sessions WHERE user_id=?').bind(admin.id).run();
              if (kind === 'disabled') await h.db.prepare('UPDATE users SET disabled=1 WHERE id=?').bind(admin.id).run();
              if (kind === 'role') await h.db.prepare('DELETE FROM admin_allowlist WHERE user_id=?').bind(admin.id).run();
              if (kind === 'revision') await h.db.prepare('UPDATE catalog_veilings SET revision=revision+1 WHERE id=?').bind(row.id).run();
            }
            return session.batch(statements);
          };
          const value = Reflect.get(session, key); return typeof value === 'function' ? value.bind(session) : value;
        } });
      };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(handleData(new Request(`${origin}/api/admin/veilings/${row.id}/publication`,
      write(admin, { visibility: 'public', releaseDate: null, useSavedDraft: true }, row.revision)), { ...h.env, DB: db }),
      (error: unknown) => error instanceof Error && 'status' in error && error.status === (kind === 'revision' ? 409 : kind === 'role' ? 403 : 401));
    assert(intercepted);
    assert.equal(await h.db.prepare('SELECT count(*) n FROM veiling_publications').first('n'), 0);
    assert.equal(await h.db.prepare('SELECT count(*) n FROM publication_audit').first('n'), 0);
    assert.equal(await h.db.prepare('SELECT revision FROM catalog_veilings WHERE id=?').bind(row.id).first('revision'), kind === 'revision' ? 2 : 1);
  });
});
