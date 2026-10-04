import assert from "node:assert/strict";
import { createOwnershipRecordController } from "../spinarium/components/ownership-record.js";

// No browser, hosted account or real ownership records are used by these tests.
const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function harness() {
  let session = { user: { id: "test-account" } };
  const requests = [], views = [], loaded = [], timers = new Map();
  const root = { replaceChildren(view) { views.push(view ?? null); } };
  const service = { getOwnershipDetail(id, { signal }) {
    return new Promise((resolve, reject) => requests.push({ id, signal, resolve, reject }));
  } };
  const controller = createOwnershipRecordController({ root, service, getSession: () => session,
    render: data => data,
    onLoaded: detail => loaded.push(detail),
    setTimer(fn, duration) { assert.equal(duration, 30_000); const key = {}; timers.set(key, fn); return key; },
    clearTimer(key) { timers.delete(key); },
  });
  return { controller, requests, views, loaded, timers, get session() { return session; }, setSession(value) { session = value; } };
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("PASS " + name); }

await test("record navigation aborts and discards a late response from the previous route", async () => {
  const h = harness();
  const old = h.controller.open({ id: first, identity: h.session });
  const next = h.controller.open({ id: second, identity: h.session });
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[1].resolve({ ownership: { id: second } }); await next;
  h.requests[0].resolve({ ownership: { id: first } }); await old;
  assert.equal(h.views.at(-1).status, "ready");
  assert.equal(h.views.at(-1).detail.ownership.id, second);
  assert.deepEqual(h.loaded.map(detail => detail.ownership.id), [second]);
  assert.equal(h.timers.size, 0);
});
await test("leaving the page removes its content and prevents late success or failure from rendering", async () => {
  for (const rejected of [false, true]) {
    const h = harness(), pending = h.controller.open({ id: first, identity: h.session });
    h.controller.reset();
    assert.equal(h.requests[0].signal.aborted, true);
    if (rejected) h.requests[0].reject({ code: "NOT_FOUND" });
    else h.requests[0].resolve({ ownership: { id: first } });
    await pending;
    assert.equal(h.views.at(-1), null);
    assert.equal(h.loaded.length, 0);
  }
});
await test("a different session object cannot receive a previous account response", async () => {
  const h = harness(), pending = h.controller.open({ id: first, identity: h.session });
  h.setSession({ user: { id: "another-account" } });
  h.requests[0].resolve({ ownership: { id: first } }); await pending;
  assert.equal(h.views.some(view => view?.status === "ready"), false);
  assert.equal(h.loaded.length, 0);
  h.controller.reset();
  h.setSession(null);
  await h.controller.open({ id: first, identity: null });
  assert.equal(h.requests.length, 1);
});
await test("malformed IDs and server not-found share the same display without exposing server text", async () => {
  const h = harness();
  await h.controller.open({ id: "../../private", identity: h.session });
  assert.equal(h.requests.length, 0);
  const localStatus = h.views.at(-1).status;
  const pending = h.controller.open({ id: first, identity: h.session });
  h.requests[0].reject({ code: "NOT_FOUND", message: "private backend reason" }); await pending;
  assert.equal(h.views.at(-1).status, localStatus);
  assert.equal(localStatus, "not-found");
  assert.equal(h.views.at(-1).detail, undefined);
});
await test("same-route rerenders do not duplicate a request; an explicit retry reads again", async () => {
  const h = harness(), initial = h.controller.open({ id: first, identity: h.session });
  assert.equal(h.controller.open({ id: first, identity: h.session }), initial);
  h.requests[0].reject(new Error("offline")); await initial;
  assert.equal(h.views.at(-1).status, "error");
  h.views.at(-1).retry();
  assert.equal(h.requests.length, 2);
  const retry = h.controller.open({ id: first, identity: h.session });
  h.requests[1].resolve({ ownership: { id: first } }); await retry;
  assert.equal(h.views.at(-1).status, "ready");
});
await test("a timed-out request cannot display a late successful record", async () => {
  const h = harness(), pending = h.controller.open({ id: first, identity: h.session });
  h.timers.values().next().value();
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].resolve({ ownership: { id: first } }); await pending;
  assert.equal(h.views.at(-1).status, "error");
  assert.equal(h.timers.size, 0);
  assert.equal(h.loaded.length, 0);
});
console.log(`PASS ${passed} ownership record controller checks`);
