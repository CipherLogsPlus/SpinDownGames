import assert from "node:assert/strict";
import { createGuardedNavigation } from "../spinarium/components/guarded-navigation.js";
import { parseRoute } from "../spinarium/domain/routing.js";

// A deterministic History API model; actual keyboard/dialog contracts also live
// in verify-spinarium-showcase-browser.cjs. No browser or live account is used.
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function browser(hash = "#dashboard") {
  const entries = [{ hash, state: null }];
  const listeners = new Map();
  let index = 0;
  const change = () => queueMicrotask(() => listeners.get("hashchange")?.());
  const window = {
    location: {
      get hash() { return entries[index].hash; },
      get href() { return "https://example.test/spinarium/" + this.hash; },
      set hash(value) {
        if (value === this.hash) return;
        entries.splice(index + 1);
        entries.push({ hash: value, state: null }); index++;
        change();
      },
    },
    history: {
      get state() { return entries[index].state; },
      replaceState(state, _, url) { entries[index] = { state, hash: new URL(url, window.location.href).hash }; },
      go(delta) {
        const next = index + delta;
        if (next < 0 || next >= entries.length || next === index) return;
        index = next; change();
      },
    },
    addEventListener(name, callback) { listeners.set(name, callback); },
  };
  return { window, entries, get index() { return index; } };
}
function harness() {
  const fake = browser();
  let dirty = false, pending = null, prompts = 0;
  const rendered = [];
  const navigation = createGuardedNavigation({ window: fake.window,
    canLeave() {
      if (!dirty) return Promise.resolve(true);
      if (pending) return pending.promise;
      prompts++;
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      pending = { promise, resolve };
      return promise;
    },
    onStay() { if (pending) { pending.resolve(false); pending = null; } },
    onRoute() { rendered.push(navigation.hash); },
  });
  return { ...fake, fake, rendered, navigation, get prompts() { return prompts; },
    dirty() { dirty = true; },
    answer(value) { assert(pending); dirty = value ? false : dirty; pending.resolve(value); pending = null; },
    async goto(hash) { fake.window.location.hash = hash; await tick(); },
  };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log("PASS " + name); }

await test("cancelled in-app navigation preserves Studio, draft guard, and forward history", async () => {
  const h = harness(); await h.goto("#admin"); h.dirty();
  const count = h.entries.length;
  await h.goto("#collection");
  assert.equal(h.navigation.hash, "#admin");
  assert.deepEqual(h.rendered, ["#admin"]);
  h.answer(false); await tick();
  assert.equal(h.window.location.hash, "#admin");
  assert.equal(h.entries.length, count + 1, "Cancellation must not append another entry.");
  h.window.history.go(1); await tick();
  assert.equal(h.prompts, 2, "Forward must still visit the cancelled destination.");
  h.answer(true); await tick();
  assert.equal(h.navigation.hash, "#collection");
  assert.deepEqual(h.rendered, ["#admin", "#collection"]);
});
await test("cancelled Back and Forward restore the original history position", async () => {
  const h = harness(); await h.goto("#collection"); await h.goto("#admin"); h.dirty();
  h.window.history.go(-1); await tick(); h.answer(false); await tick();
  assert.equal(h.navigation.hash, "#admin"); assert.equal(h.window.location.hash, "#admin");
  h.window.history.go(-1); await tick(); h.answer(true); await tick();
  assert.equal(h.navigation.hash, "#collection");
  h.window.history.go(1); await tick(); assert.equal(h.navigation.hash, "#admin");
  await h.goto("#settings"); h.window.history.go(-1); await tick(); h.dirty();
  h.window.history.go(1); await tick(); h.answer(false); await tick();
  assert.equal(h.navigation.hash, "#admin"); assert.equal(h.window.location.hash, "#admin");
  assert.equal(h.entries.length, 4);
});
await test("repeated navigation shares one prompt and only the latest destination commits", async () => {
  const h = harness(); await h.goto("#admin"); h.dirty();
  await h.goto("#collection"); await h.goto("#explore");
  assert.equal(h.prompts, 1); h.answer(true); await tick();
  assert.deepEqual(h.rendered, ["#admin", "#explore"]);
});
await test("returning through history while a prompt is open cancels that pending leave", async () => {
  const h = harness(); await h.goto("#admin"); h.dirty(); await h.goto("#collection");
  h.window.history.go(-1); await tick();
  assert.equal(h.navigation.hash, "#admin"); assert.equal(h.window.location.hash, "#admin");
  assert.deepEqual(h.rendered, ["#admin"]);
});
await test("sign-out and external actions obey the guard and superseded actions do not run", async () => {
  const h = harness(); await h.goto("#admin"); h.dirty();
  let actions = 0;
  const denied = h.navigation.confirm(() => actions++); await tick(); h.answer(false); await denied;
  assert.equal(actions, 0);
  const superseded = h.navigation.confirm(() => actions++); await tick();
  h.navigation.replace("#signin"); h.answer(true); await superseded;
  assert.equal(actions, 0); assert.equal(h.navigation.hash, "#signin");
  await h.navigation.confirm(() => actions++); assert.equal(actions, 1);
});
await test("obsolete collection filters cannot produce an impossible owned-only view", () => {
  for (const filter of ["all", "unowned", "discovered", "undiscovered", "owned"])
    assert.equal(parseRoute(`#collection?filter=${filter}`, true).filter, "owned");
  assert.equal(parseRoute("#explore?filter=unowned", true).filter, "unowned");
});
console.log(`PASS ${passed} guarded navigation and collection route checks`);
