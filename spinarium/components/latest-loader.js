/** Independent identity-bound reads, with latest-wins delivery and a deadline.
 * The deadline settles even a faulty adapter that ignores AbortSignal. */
export function createLatestLoader({ read, getIdentity, onStart = () => {}, onSuccess, onError,
  timeoutMs = 30_000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let current = null;
  function reset() {
    const previous = current;
    current = null;
    previous?.abort.abort();
  }
  async function load() {
    reset();
    const identity = getIdentity();
    if (!identity) return;
    const entry = { abort: new AbortController() };
    current = entry;
    const valid = () => current === entry && getIdentity() === identity;
    let timer;
    const cancelled = new Promise((_, reject) => {
      entry.abort.signal.addEventListener("abort", () => reject(new Error("Read cancelled or timed out.")), { once: true });
    });
    try {
      onStart();
      timer = setTimer(() => entry.abort.abort(), timeoutMs);
      const result = await Promise.race([Promise.resolve().then(() => read({ identity, signal: entry.abort.signal })), cancelled]);
      if (valid()) onSuccess(result);
    } catch (error) {
      if (valid()) onError(error);
    } finally {
      clearTimer(timer);
      if (current === entry) current = null;
    }
  }
  return Object.freeze({ load, reset, get loading() { return current !== null; } });
}
