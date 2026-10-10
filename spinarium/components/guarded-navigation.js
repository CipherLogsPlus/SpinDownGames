const ENTRY = "spinariumRoute";

/** Keep the rendered route until its draft guard resolves. History cancellations
 * traverse back to the original entry instead of replacing/duplicating it, so
 * a cancelled Back still leaves Forward usable. No draft data is persisted. */
export function createGuardedNavigation({ window, canLeave, onRoute, onStay = () => {} }) {
  const { history, location } = window;
  let sequence = 0;
  let nextId = 0;
  const newId = () => `${Date.now()}-${Math.random()}-${++nextId}`;
  const entry = () => history.state?.[ENTRY];
  const validEntry = value => value && Number.isSafeInteger(value.index) && typeof value.id === "string";
  const stamp = value => history.replaceState({ ...history.state, [ENTRY]: value }, "", location.href);
  let current = { ...(validEntry(entry()) ? entry() : { index: 0, id: newId() }), hash: location.hash };
  let position = current;
  stamp({ index: current.index, id: current.id });

  function replace(hash) {
    sequence++;
    current = { index: position.index, id: newId(), hash };
    position = current;
    history.replaceState({ ...history.state, [ENTRY]: { index: current.index, id: current.id } }, "", hash);
  }
  async function confirm(action) {
    const request = ++sequence;
    if (await canLeave() && request === sequence) await action();
  }
  async function changed() {
    let target = entry();
    if (!validEntry(target) || (target.id === position.id && location.hash !== position.hash)) {
      target = { index: position.index + 1, id: newId() };
      stamp(target);
    }
    position = { ...target, hash: location.hash };
    const destination = position;
    const request = ++sequence;
    if (destination.id === current.id && destination.hash === current.hash) {
      onStay();
      return;
    }
    const allowed = await canLeave();
    if (request !== sequence) return;
    if (allowed) {
      current = destination;
      onRoute();
    } else {
      const delta = current.index - destination.index;
      if (delta) history.go(delta);
      else {
        history.replaceState({ ...history.state, [ENTRY]: { index: current.index, id: current.id } }, "", current.hash);
        position = current;
        onStay();
      }
    }
  }
  window.addEventListener("hashchange", changed);
  return Object.freeze({
    get hash() { return current.hash; },
    replace,
    confirm,
  });
}
