/** Presentation-only onboarding; device preference never grants access. */
export function createFirstLoginIntro(dialog, { storage = () => localStorage, dock, focusTarget, onPrepare, onReveal, onReset } = {}) {
  const key = "spinarium.preview.introduction.v3";
  const phrase = "Welcome to your Spinarium";
  const position = dialog.querySelector(".intro-banner-position");
  const banner = dialog.querySelector(".intro-banner");
  const enter = dialog.querySelector(".intro-enter");
  const sound = dialog.querySelector(".intro-sound");
  const status = dialog.querySelector(".intro-voice-status");
  const voiceAvailable = "speechSynthesis" in globalThis && "SpeechSynthesisUtterance" in globalThis;
  let seen = false, muted = false, timers = [], active = false, docking = false;
  const later = (fn, delay) => timers.push(setTimeout(() => { if (active) fn(); }, delay));
  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  const stopVoice = () => { if (voiceAvailable) speechSynthesis.cancel(); };
  function finish(keepRibbon = false) {
    if (!active) return;
    active = false;
    clear();
    stopVoice();
    seen = true;
    try { storage().setItem(key, "seen"); } catch { /* Optional device preference. */ }
    if (keepRibbon && dock) { dock.append(banner); dock.hidden = false; }
    else if (dock) dock.hidden = true;
    if (!keepRibbon) onReset?.();
    dialog.close();
    focusTarget?.focus({ preventScroll: true });
  }
  function moveToTop() {
    if (docking || !active) return;
    docking = true;
    dialog.dataset.phase = "dock";
    if (dock) {
      dock.hidden = false;
      const rect = dock.getBoundingClientRect();
      const initial = position.getBoundingClientRect();
      dialog.style.setProperty("--dock-center", `${rect.top + rect.height / 2}px`);
      dialog.style.setProperty("--dock-left", `${rect.left + rect.width / 2}px`);
      dialog.style.setProperty("--dock-scale", String(Math.min(1, rect.width / initial.width)));
    }
    later(() => { onReveal?.(); dialog.dataset.phase = "reveal"; }, 1900);
    later(() => finish(true), 3400);
  }
  function greeting() {
    dialog.dataset.phase = "lettering";
    let textReady = false, voiceReady = !voiceAvailable || muted, holdScheduled = false;
    const hold = () => {
      if (!textReady || !voiceReady || holdScheduled || !active) return;
      holdScheduled = true;
      dialog.dataset.phase = "hold";
      later(moveToTop, 1100);
    };
    later(() => { textReady = true; hold(); }, 1800);
    // Provider/browser speech can fail or remain queued. Never trap the visitor.
    later(() => { voiceReady = true; hold(); }, 6500);
    if (voiceReady) return;
    try {
      const line = new SpeechSynthesisUtterance(phrase + ".");
      line.lang = "en-US"; line.rate = 0.8; line.pitch = 0.85;
      line.onend = line.onerror = () => { voiceReady = true; status.textContent = ""; hold(); };
      status.textContent = "Welcome to your Spinarium.";
      speechSynthesis.speak(line);
    } catch { voiceReady = true; hold(); }
  }
  sound.hidden = !voiceAvailable;
  sound.addEventListener("click", () => {
    muted = !muted;
    sound.textContent = muted ? "Enable voice" : "Mute voice";
    sound.setAttribute("aria-pressed", String(muted));
    if (muted) stopVoice();
  });
  dialog.querySelector(".intro-skip").addEventListener("click", () => finish());
  enter.addEventListener("click", () => finish());
  dialog.addEventListener("cancel", event => { event.preventDefault(); finish(); });
  dialog.addEventListener("close", () => { active = false; clear(); stopVoice(); });
  return {
    show() {
      try { seen ||= storage().getItem(key) === "seen"; } catch { /* Memory fallback. */ }
      if (seen || dialog.open) return false;
      active = true; docking = false;
      position.append(banner);
      dialog.dataset.phase = "dark";
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      dialog.dataset.reduced = String(reduced);
      enter.hidden = !reduced;
      sound.hidden = !voiceAvailable || reduced;
      dialog.showModal();
      dialog.querySelector(".intro-skip").focus();
      if (reduced) dialog.dataset.phase = "hold";
      else {
        onPrepare?.();
        later(() => { dialog.dataset.phase = "unfurl"; }, 650);
        later(greeting, 3750);
      }
      return true;
    },
    reset() {
      onReset?.();
      active = false; clear(); stopVoice();
      position.append(banner);
      if (dock) dock.hidden = true;
      if (dialog.open) dialog.close();
    },
  };
}
