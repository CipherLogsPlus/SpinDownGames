import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { timingSafeEqual } from 'node:crypto';
import { handleData } from '../src/data';
import { createHarness, seedSession, origin } from './support';

type Harness = Awaited<ReturnType<typeof createHarness>>;
type Session = Awaited<ReturnType<typeof seedSession>>;
type Operation = 'create' | 'edit' | 'artwork';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG2kAAAAASUVORK5CYII=', 'base64');

async function harness(t: TestContext) {
  const h = await createHarness();
  t.after(() => h.mf.dispose());
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true,
    value: (a: ArrayBuffer, b: ArrayBuffer) => timingSafeEqual(Buffer.from(a), Buffer.from(b)) });
  t.after(() => Reflect.deleteProperty(crypto.subtle, 'timingSafeEqual'));
  return h;
}

async function requestFor(h: Harness, admin: Session, operation: Operation) {
  const headers = { ...admin.headers, 'Content-Type': 'application/json' };
  if (operation === 'create') return new Request(`${origin}/api/admin/veilings`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'New unauthorized row' }),
  });
  const created = await h.fetch('/api/admin/veilings', {
    method: 'POST', headers, body: JSON.stringify({ name: 'Original catalog' }),
  });
  assert.equal(created.status, 201);
  const row = await created.json() as { id: string; revision: number };
  if (operation === 'edit') return new Request(`${origin}/api/admin/veilings/${row.id}`, {
    method: 'PATCH', headers: { ...headers, 'If-Match': '"1"' }, body: JSON.stringify({ name: 'Unauthorized edit' }),
  });
  // Preserve an existing image as well as cleaning up the rejected replacement.
  const first = await h.fetch(`/api/admin/veilings/${row.id}/artwork`, {
    method: 'POST', headers: { ...admin.headers, 'Content-Type': 'image/png', 'If-Match': '"1"' }, body: png,
  });
  assert.equal(first.status, 200);
  return new Request(`${origin}/api/admin/veilings/${row.id}/artwork`, {
    method: 'POST', headers: { ...admin.headers, 'Content-Type': 'image/png', 'If-Match': '"2"' }, body: png,
  });
}

async function catalogState(h: Harness) {
  const tables = await Promise.all(['catalog_veilings', 'catalog_audit', 'artwork', 'publication_audit', 'veiling_publications']
    .map(async table => (await h.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results));
  return { tables, objects: (await h.r2.list()).objects.map(object => object.key).sort() };
}

function beforeBatch(h: Harness, action: () => Promise<void>): D1Database {
  let intercepted = false;
  return new Proxy(h.db, { get(target, property) {
    if (property === 'withSession') return (...args: Parameters<D1Database['withSession']>) => {
      const primary = target.withSession(...args);
      return new Proxy(primary, { get(session, key) {
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

async function otherSession(h: Harness, admin: Session) {
  const now = Math.floor(Date.now() / 1000);
  await h.db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,created_at,expires_at) VALUES(?,?,?,?,?)')
    .bind(crypto.randomUUID(), admin.id, admin.csrfToken, now, now + 7200).run();
}

function statusIs(status: number) {
  return (error: unknown) => error instanceof Error && 'status' in error && error.status === status;
}

test('every catalog mutation rechecks the exact session and live authority in its transaction', async t => {
  const h = await harness(t);
  const owner = await seedSession(h.db, { owner: true });
  for (const operation of ['create', 'edit', 'artwork'] as const) {
    for (const change of ['logout', 'revoke-sessions', 'password-reset', 'expiry', 'disabled', 'role'] as const) {
      await t.test(`${operation}: ${change}`, async () => {
        const admin = await seedSession(h.db, { admin: true, email: `${crypto.randomUUID()}@fixture.test` });
        await otherSession(h, admin);
        const request = await requestFor(h, admin, operation);
        const before = await catalogState(h);
        let changed = false;
        const db = beforeBatch(h, async () => {
          changed = true;
          if (change === 'logout') {
            assert.equal((await h.fetch('/api/auth/logout', { method: 'POST', headers: admin.headers })).status, 200);
            assert.equal(await h.db.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').bind(admin.id).first('n'), 1,
              'a different active session must not authorize the logged-out request');
          } else if (change === 'revoke-sessions' || change === 'password-reset') {
            const revision = await h.db.prepare('SELECT account_revision FROM users WHERE id=?').bind(admin.id).first<number>('account_revision');
            const response = await h.fetch(`/api/admin/accounts/${admin.id}/${change}`, {
              method: 'POST', headers: { ...owner.headers, 'Content-Type': 'application/json', 'If-Match': `"${revision}"` },
              body: JSON.stringify({ reason: 'Synthetic in-flight request regression' }),
            });
            assert.equal(response.status, 200, await response.clone().text());
          } else if (change === 'expiry') {
            await h.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?')
              .bind(Math.floor(Date.now() / 1000), admin.hash).run();
          } else if (change === 'disabled') {
            await h.db.prepare('UPDATE users SET disabled=1 WHERE id=?').bind(admin.id).run();
          } else {
            await h.db.prepare('DELETE FROM admin_allowlist WHERE user_id=?').bind(admin.id).run();
          }
        });
        await assert.rejects(handleData(request, { ...h.env, DB: db }), statusIs(change === 'role' ? 403 : 401));
        assert(changed);
        assert.deepEqual(await catalogState(h), before, 'no catalog, artwork, audit, revision or object changes');
      });
    }
  }
});

test('expiry uses fresh time after slow request bodies and artwork storage', async t => {
  const h = await harness(t);
  for (const operation of ['create', 'edit', 'artwork'] as const) await t.test(`${operation}: delayed body`, async t => {
    const admin = await seedSession(h.db, { admin: true });
    const original = await requestFor(h, admin, operation);
    const bytes = new Uint8Array(await original.arrayBuffer());
    const before = await catalogState(h);
    let now = Date.now(); let read = false;
    t.mock.method(Date, 'now', () => now);
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      read = true; now += 3_601_000; controller.enqueue(bytes); controller.close();
    } }, { highWaterMark: 0 });
    const request = new Request(original.url, { method: original.method, headers: original.headers, body, duplex: 'half' } as RequestInit);
    await assert.rejects(handleData(request, h.env), statusIs(401));
    assert(read);
    assert.deepEqual(await catalogState(h), before);
  });
  await t.test('artwork: delayed R2 put', async t => {
    const admin = await seedSession(h.db, { admin: true });
    const request = await requestFor(h, admin, 'artwork');
    const before = await catalogState(h);
    let now = Date.now(); let stored = false;
    t.mock.method(Date, 'now', () => now);
    const r2 = new Proxy(h.r2, { get(target, key) {
      if (key === 'put') return async (...args: Parameters<R2Bucket['put']>) => {
        const result = await target.put(...args); stored = true; now += 3_601_000; return result;
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(handleData(request, { ...h.env, ARTWORK: r2 }), statusIs(401));
    assert(stored);
    assert.deepEqual(await catalogState(h), before);
  });
});

test('database clock rejects a session that expires while its prepared batch is waiting', async t => {
  const h = await harness(t);
  const admin = await seedSession(h.db, { admin: true });
  const request = await requestFor(h, admin, 'create');
  const expiresAt = Math.floor(Date.now() / 1000) + 2;
  await h.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').bind(expiresAt, admin.hash).run();
  const before = await catalogState(h);
  const db = beforeBatch(h, async () => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt * 1000 - Date.now()) + 30));
  });
  await assert.rejects(handleData(request, { ...h.env, DB: db }), statusIs(401));
  assert.deepEqual(await catalogState(h), before);
});
