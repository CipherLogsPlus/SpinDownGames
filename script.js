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


  // Archive an event after its final day, based on the event's local Ohio date.
  // Each .past-events wrapper owns the original event article and its start/end dates.
  // Markup defaults to an accessible archive even if JavaScript is unavailable.
  const eventList = document.querySelector(".events-list");
  const featuredEvents = document.querySelector("#upcoming-events");
  const eventStatus = document.querySelector("#next-event-status");
  const ohioDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const fullDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const records = [...eventList.querySelectorAll(".past-events[data-event-start][data-event-end]")]
    .map((archive) => {
      const article = archive.querySelector(".event-card");
      if (!article) return null;
      const eyebrow = article.querySelector(".event-card-top .eyebrow");
      const pill = article.querySelector(".event-card-top .pill");
      return {
        archive,
        article,
        start: archive.dataset.eventStart,
        end: archive.dataset.eventEnd,
        eyebrow,
        originalEyebrow: eyebrow?.textContent,
        pill,
        originalPill: pill?.textContent,
      };
    })
    .filter(Boolean);

  function todayInOhio() {
    const date = Object.fromEntries(
      ohioDate.formatToParts(new Date()).map(({ type, value }) => [type, value]),
    );
    return `${date.year}-${date.month}-${date.day}`;
  }

  function dateLabel(start, end) {
    const first = new Date(`${start}T12:00:00Z`);
    const last = new Date(`${end}T12:00:00Z`);
    if (start === end) return fullDate.format(first);
    if (start.slice(0, 7) === end.slice(0, 7)) {
      const month = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" }).format(first);
      return `${month} ${first.getUTCDate()}–${last.getUTCDate()}, ${first.getUTCFullYear()}`;
    }
    return `${fullDate.format(first)} – ${fullDate.format(last)}`;
  }

  function updateEventDisplay() {
    const today = todayInOhio();
    const scheduled = records
      .filter(({ start, end }) => /^\d{4}-\d{2}-\d{2}$/.test(start) &&
        /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end && end >= today)
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

    for (const record of records) {
      const isUpcoming = scheduled.includes(record);
      record.archive.hidden = isUpcoming;
      if (!isUpcoming) {
        if (record.article.parentElement !== record.archive)
          record.archive.append(record.article);
        if (record.eyebrow) record.eyebrow.textContent = record.originalEyebrow;
        if (record.pill) record.pill.textContent = record.originalPill;
      }
    }
    scheduled.forEach((record, index) => {
      if (featuredEvents.children[index] !== record.article)
        featuredEvents.insertBefore(record.article, featuredEvents.children[index] || null);
      if (record.eyebrow) record.eyebrow.textContent = index === 0 ? "Next event" : "Upcoming event";
      if (record.pill && record.originalPill?.trim() === "PAST EVENT")
        record.pill.textContent = "EVENT DETAILS";
    });
    const byMostRecent = [...records].sort((a, b) => b.end.localeCompare(a.end));
    byMostRecent.forEach((record, index) => {
      if (eventList.children[index + 1] !== record.archive)
        eventList.insertBefore(record.archive, eventList.children[index + 1] || null);
    });
    const title = eventStatus.querySelector("strong");
    const subtitle = eventStatus.querySelector("div > span");
    if (!scheduled.length) {
      title.textContent = "No upcoming events announced.";
      subtitle.textContent = "Check back soon or follow our event updates.";
      return;
    }
    const next = scheduled[0];
    const name = next.article.querySelector(".event-main h3")?.textContent.replace(/\s+/g, " ").trim() || "Upcoming event";
    const venue = next.article.querySelector(".event-location strong")?.textContent.trim();
    title.textContent = `Next event · ${dateLabel(next.start, next.end)}`;
    subtitle.textContent = venue ? `${name} · ${venue}` : name;
  }
  updateEventDisplay();
  // Refresh across midnight and when returning to a tab without a reload.
  window.setInterval(updateEventDisplay, 60_000);
  window.addEventListener("focus", updateEventDisplay);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateEventDisplay();
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
