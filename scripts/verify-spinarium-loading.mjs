import assert from "node:assert/strict";
import { createLatestLoader } from "../spinarium/components/latest-loader.js";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
let passed = 0;
async function test(name, run) { await run(); passed++; console.log("PASS " + name); }
function harness() {
  let identity = {}, status = "", snapshot = null;
  const reads = [], errors = [], delivered = [];
  const timers = new Set();
  const loader = createLatestLoader({
    getIdentity: () => identity,
    onStart() { status = "loading"; },
    read({ signal }) { const request = { ...deferred(), signal }; reads.push(request); return request.promise; },
    onSuccess(value) { snapshot = value; delivered.push(value); status = "ready"; },
    onError(error) { errors.push(error); status = snapshot ? "stale" : "error"; },
    setTimer(callback) { timers.add(callback); return callback; }, clearTimer(timer) { timers.delete(timer); },
  });
  return { loader, reads, errors, delivered, timers, get status() { return status; }, get snapshot() { return snapshot; },
    expire() { for (const timer of timers) timer(); },
    signOut() { identity = null; snapshot = null; status = "signed-out"; loader.reset(); },
  };
}
await test("dashboard success is independent of failed or indefinitely pending admin discovery", async () => {
  const collection = harness(), admin = harness();
  const c = collection.loader.load(), a = admin.loader.load(); await tick();
  collection.reads[0].resolve("collection"); await c;
  assert.equal(collection.snapshot, "collection"); assert.equal(collection.status, "ready");
  assert.equal(admin.status, "loading");
  admin.reads[0].reject(new Error("503")); await a;
  assert.equal(collection.status, "ready"); assert.equal(admin.status, "error");
});
await test("a refresh failure settles loading and retains the known snapshot with stale status", async () => {
  const h = harness(); const first = h.loader.load(); await tick(); h.reads[0].resolve("known"); await first;
  const refresh = h.loader.load(); await tick(); h.reads[1].reject(new Error("503")); await refresh;
  assert.equal(h.snapshot, "known"); assert.equal(h.status, "stale"); assert.equal(h.loader.loading, false);
});
await test("reversed responses deliver only the newest read even when an adapter ignores cancellation", async () => {
  const h = harness(); const old = h.loader.load(); await tick();
  const latest = h.loader.load(); await tick(); assert.equal(h.reads[0].signal.aborted, true);
  h.reads[1].resolve("new"); await latest;
  h.reads[0].resolve("old"); await old; await tick();
  assert.deepEqual(h.delivered, ["new"]); assert.equal(h.snapshot, "new"); assert.equal(h.errors.length, 0);
});
await test("deadlines settle never-resolving adapters, clean timers, and allow retry", async () => {
  const h = harness(); const pending = h.loader.load(); await tick(); h.expire(); await pending;
  assert.equal(h.status, "error"); assert.equal(h.reads[0].signal.aborted, true);
  assert.equal(h.loader.loading, false); assert.equal(h.timers.size, 0);
  const retry = h.loader.load(); await tick(); h.reads[1].resolve("retry"); await retry;
  assert.equal(h.snapshot, "retry"); assert.equal(h.status, "ready");
});
await test("sign-out cancels pending reads and late private data cannot return", async () => {
  const h = harness(); const pending = h.loader.load(); await tick(); h.signOut(); await pending;
  h.reads[0].resolve("private"); await tick();
  assert.equal(h.status, "signed-out"); assert.equal(h.snapshot, null);
  assert.deepEqual(h.delivered, []); assert.equal(h.errors.length, 0); assert.equal(h.timers.size, 0);
  await h.loader.load(); assert.equal(h.reads.length, 1);
});
console.log(`PASS ${passed} independent bounded collection read checks`);
