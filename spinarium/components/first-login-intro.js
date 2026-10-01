/** Device-local introduction preference; never used for identity or access. */
export function createFirstLoginIntro(dialog, { storage = () => localStorage } = {}) {
  const key = "spinarium.preview.introduction.v1";
  const stages = [
    ["Beyond the metal", "Real artifacts.", "Living stories."],
    ["A world waiting quietly", "Some things are", "meant to be found."],
    ["Spinarium", "Your Collection.", "A Larger World."],
  ];
  let seen = false;
  let timers = [];
  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  const voiceButton = dialog.querySelector(".intro-voice");
  const voiceStatus = dialog.querySelector(".intro-voice-status");
  const voiceAvailable = "speechSynthesis" in globalThis && "SpeechSynthesisUtterance" in globalThis;
  voiceButton.hidden = !voiceAvailable;
  voiceButton.addEventListener("click", () => {
    if (!voiceAvailable) return;
    speechSynthesis.cancel();
    const line = new SpeechSynthesisUtterance("Welcome to your Spinarium.");
    line.lang = "en-US";
    line.rate = 0.8;
    line.pitch = 0.85;
    voiceButton.disabled = true;
    voiceStatus.textContent = "Playing the welcome voice.";
    line.onend = line.onerror = () => {
      voiceButton.disabled = false;
      voiceStatus.textContent = "";
    };
    speechSynthesis.speak(line);
  });
  function finish() {
    clear();
    seen = true;
    try { storage().setItem(key, "seen"); } catch { /* Memory-only fallback. */ }
    dialog.close();
  }
  function stage(index) {
    dialog.dataset.stage = String(index);
    const [eyebrow, title, subtitle] = stages[index];
    dialog.querySelector(".intro-eyebrow").textContent = eyebrow;
    dialog.querySelector(".intro-title").textContent = title;
    dialog.querySelector(".intro-subtitle").textContent = subtitle;
    dialog.querySelector(".intro-progress").textContent = `${index + 1} / ${stages.length}`;
    dialog.querySelector(".intro-enter").hidden = index !== stages.length - 1;
  }
  dialog.querySelector(".intro-skip").addEventListener("click", finish);
  dialog.querySelector(".intro-enter").addEventListener("click", finish);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(); });
  dialog.addEventListener("close", () => {
    clear();
    if (voiceAvailable) speechSynthesis.cancel();
    voiceButton.disabled = false;
    voiceStatus.textContent = "";
  });
  return {
    show() {
      try { seen ||= storage().getItem(key) === "seen"; } catch { /* Optional storage. */ }
      if (seen || dialog.open) return;
      clear();
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      stage(reduced ? 2 : 0);
      dialog.showModal();
      dialog.querySelector(".intro-skip").focus();
      if (!reduced) {
        timers.push(setTimeout(() => stage(1), 4000));
        timers.push(setTimeout(() => stage(2), 8000));
      }
    },
  };
}
