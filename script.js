(() => {
  "use strict";
  document.documentElement.classList.add("js");
  const menu = document.querySelector(".menu-toggle");
  const nav = document.querySelector("#main-nav");
  const mobile = window.matchMedia("(max-width: 760px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function closeMenu(restoreFocus = false) {
    nav.classList.remove("is-open");
    menu.setAttribute("aria-expanded", "false");
    if (restoreFocus) menu.focus();
  }
  menu.hidden = false;
  menu.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    nav.classList.toggle("is-open", open);
    menu.setAttribute("aria-expanded", String(open));
  });
  nav.addEventListener("click", (event) => {
    const anchor = event.target.closest("a");
    if (!anchor) return;
    closeMenu();
    if (mobile.matches)
      document.querySelector(anchor.hash)?.focus({ preventScroll: true });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.getAttribute("aria-expanded") === "true")
      closeMenu(true);
  });
  mobile.addEventListener("change", () => closeMenu());

  // The displayed address is the single source for every event's directions.
  document
    .querySelectorAll(".event-card .event-location")
    .forEach((location) => {
      const address = location
        .querySelector(".event-address")
        ?.textContent.replace(/\s+/g, " ")
        .replace(/\s*·\s*/g, ", ")
        .trim();
      if (!address || location.querySelector(".event-directions")) return;

      const url = new URL("https://www.google.com/maps/dir/");
      url.searchParams.set("api", "1");
      url.searchParams.set("destination", address);
      const link = document.createElement("a");
      link.className = "button button-primary event-directions";
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Get directions ";
      const arrow = document.createElement("span");
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "↗";
      const label = document.createElement("span");
      label.className = "sr-only";
      const venue =
        location.querySelector("strong")?.textContent.trim() || address;
      label.textContent = ` to ${venue} in Google Maps (opens in a new tab)`;
      link.append(arrow, label);
      location.append(document.createElement("br"), link);
    });

  const button = document.querySelector("#roll-button");
  const options = document.querySelector(".dice-options");
  const panel = document.querySelector("#dice-panel");
  const value = document.querySelector("#die-value");
  const result = document.querySelector("#roll-result");
  const history = document.querySelector("#roll-history");
  const recent = [];
  let sides = 20;
  let rolling = false;

  // Rejection sampling avoids modulo bias. No account, server or saved history.
  function rollDie(max) {
    if (!globalThis.crypto?.getRandomValues)
      return 1 + Math.floor(Math.random() * max);
    const buffer = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / max) * max;
    do {
      crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);
    return 1 + (buffer[0] % max);
  }
  function setButtonLabel() {
    button.replaceChildren(document.createTextNode(`Roll the D${sides} `));
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↗";
    button.append(arrow);
  }
  options.disabled = false;
  button.disabled = false;
  options.addEventListener("change", (event) => {
    if (rolling || !event.target.matches('input[name="die"]')) return;
    sides = Number(event.target.value);
    value.textContent = "?";
    result.textContent = `D${sides} selected. Let’s roll.`;
    setButtonLabel();
  });
  button.addEventListener("click", () => {
    if (rolling) return;
    rolling = true;
    button.disabled = true;
    options.disabled = true;
    button.setAttribute("aria-busy", "true");
    panel.classList.add("is-rolling");
    result.textContent = "Rolling…";
    value.textContent = "?";
    const rolledSides = sides;
    const rolledValue = rollDie(rolledSides);
    function finishRoll() {
      value.textContent = String(rolledValue);
      const flavor =
        rolledValue === rolledSides
          ? rolledSides === 20
            ? "Natural 20. Big play energy."
            : "Six! That’s how you roll."
          : rolledValue === 1
            ? "A plot twist. Roll with it."
            : "Your next move is yours.";
      result.textContent = `D${rolledSides}: ${rolledValue}. ${flavor}`;
      recent.unshift({ sides: rolledSides, value: rolledValue });
      recent.splice(5);
      history.replaceChildren(document.createTextNode("Last rolls"));
      for (const roll of recent) {
        const chip = document.createElement("span");
        chip.className = "roll-chip";
        chip.textContent = `D${roll.sides}: ${roll.value}`;
        history.append(chip);
      }
      panel.classList.remove("is-rolling");
      button.disabled = false;
      options.disabled = false;
      button.removeAttribute("aria-busy");
      rolling = false;
    }
    if (reducedMotion.matches) finishRoll();
    else window.setTimeout(finishRoll, 640);
  });
  document.querySelector("#year").textContent = String(
    new Date().getFullYear(),
  );
})();
