import assert from 'node:assert/strict';
import { createFirstLoginIntro } from '../spinarium/components/first-login-intro.js';
let now = 0, nextId = 0, tasks = new Map();
const original = { setTimeout, clearTimeout, matchMedia: globalThis.matchMedia };
globalThis.setTimeout = (fn, delay) => { const id = ++nextId; tasks.set(id, { fn, at: now + delay }); return id; };
globalThis.clearTimeout = id => tasks.delete(id);
function advance(ms) {
  const end = now + ms;
  while (true) {
    const next = [...tasks].sort((a,b) => a[1].at-b[1].at)[0];
    if (!next || next[1].at > end) break;
    now = next[1].at; tasks.delete(next[0]); next[1].fn();
  }
  now = end;
}
function fixture({ reduced = false, brokenStorage = false } = {}) {
  const nodes = new Map(), listeners = new Map(), values = new Map();
  let focused = false;
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      hidden: false, textContent: '',
      addEventListener(event, fn) { this[event] = fn; },
      setAttribute() {}, append(child) { this.child = child; }, focus() {},
      getBoundingClientRect: () => ({ left: 240, top: 60, height: 148, width: selector === '.intro-banner-position' ? 1100 : 640 }),
    });
    return nodes.get(selector);
  };
  const dialog = {
    open: false, dataset: {}, style: { setProperty() {} }, querySelector: node,
    addEventListener(event, fn) { listeners.set(event, fn); },
    focus() {},
    showModal() { this.open = true; },
    close() { this.open = false; listeners.get('close')?.(); },
  };
  globalThis.matchMedia = () => ({ matches: reduced });
  const storage = () => {
    if (brokenStorage) throw new Error('Storage blocked');
    return { getItem: k => values.get(k), setItem: (k,v) => values.set(k,v) };
  };
  const dock = node('dock'); dock.hidden = true;
  const options = { storage, dock, focusTarget: { focus() { focused = true; } } };
  return { dialog, nodes, dock, values, options, listeners, focused: () => focused, intro: createFirstLoginIntro(dialog, options) };
}
try {
  const f = fixture(); f.intro.show();
  assert.equal(f.dialog.dataset.phase, 'dark');
  advance(650); assert.equal(f.dialog.dataset.phase, 'unfurl');
  advance(3100); assert.equal(f.dialog.dataset.phase, 'lettering');
  advance(1800); assert.equal(f.dialog.dataset.phase, 'hold');
  advance(1100); assert.equal(f.dialog.dataset.phase, 'dock');
  advance(1900); assert.equal(f.dialog.dataset.phase, 'reveal');
  advance(1500); assert.equal(f.dialog.open, false);
  assert.equal(f.dock.hidden, false); assert.ok(f.dock.child); assert.equal(f.focused(), true);
  assert.equal(tasks.size, 0);
  createFirstLoginIntro(f.dialog, f.options).show(); assert.equal(f.dialog.open, false);
  const fallback = fixture({ brokenStorage: true }); fallback.intro.show();
  let prevented = false;
  fallback.listeners.get('cancel')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(fallback.dialog.open, true);
  advance(15000); assert.equal(tasks.size, 0); assert.equal(fallback.dialog.open, false);
  fallback.intro.show(); assert.equal(fallback.dialog.open, false);
  const logout = fixture(); logout.intro.show(); advance(650); logout.intro.reset();
  assert.equal(logout.dialog.open, false); assert.equal(tasks.size, 0); assert.equal(logout.values.size, 0);
  const reduced = fixture({ reduced: true }); reduced.intro.show();
  assert.equal(reduced.dialog.dataset.phase, 'hold');
  advance(1200); assert.equal(reduced.dialog.open, false); assert.equal(tasks.size, 0);
  let spoken = null, cancellations = 0;
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.speechSynthesis = { speak(line) { spoken = line; }, cancel() { cancellations++; } };
  const voiced = fixture(); voiced.intro.show(); advance(3750);
  assert.equal(spoken.text, 'Welcome to your Spinarium.');
  advance(1800); assert.equal(voiced.dialog.dataset.phase, 'lettering');
  spoken.onend(); assert.equal(voiced.dialog.dataset.phase, 'hold');
  advance(4500); assert.equal(voiced.dialog.open, false); assert.ok(cancellations > 0);
  const blocked = fixture(); blocked.intro.show(); advance(3750);
  advance(6500); assert.equal(blocked.dialog.dataset.phase, 'hold');
  advance(4500); assert.equal(blocked.dialog.open, false); assert.equal(tasks.size, 0);
  delete globalThis.speechSynthesis; delete globalThis.SpeechSynthesisUtterance;
  console.log('PASS voice timing/fallback, cinematic timing, docking, focus, remembered entry, storage fallback, automatic completion/logout cleanup, reduced motion');
} finally {
  globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout;
  globalThis.matchMedia = original.matchMedia;
}
