import { el } from "./views.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const acquiredDate = value => new Intl.DateTimeFormat("en-US", {
  year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
}).format(new Date(value));

export function renderOwnershipRecord({ status, detail, retry }) {
  const page = el("div", "ownership-record-page");
  const back = el("a", "outlined-button ownership-back", "Back to collection");
  back.href = "#collection?filter=owned";
  const title = el("h2", "", status === "not-found" ? "Ownership record not found" : "Ownership record");
  title.id = "route-title";
  page.append(back, title);
  if (status !== "ready") {
    const message = el("p", "ownership-record-status", {
      loading: "Loading ownership record…",
      error: "We couldn’t load this ownership record.",
      "not-found": "This record is not available in your collection.",
    }[status]);
    message.setAttribute("role", "status");
    page.append(message);
    if (status === "error") {
      const button = el("button", "outlined-button", "Try again");
      button.type = "button";
      button.dataset.action = "retry-ownership";
      button.addEventListener("click", retry);
      page.append(button);
    }
    return page;
  }
  const { ownership, veiling } = detail;
  const unavailable = veiling.contentStatus === "unavailable";
  const metadata = el("dl", "ownership-record-metadata");
  for (const [label, value] of [["Record ID", ownership.id], ["Acquired", acquiredDate(ownership.acquiredAt)]]) {
    const row = el("div");
    row.append(el("dt", "", label), el("dd", label === "Record ID" ? "ownership-id" : "", value));
    metadata.append(row);
  }
  page.append(metadata);
  const content = el("section", "ownership-veiling");
  if (veiling.artworkUrl) {
    const artwork = el("img", "ownership-artwork");
    artwork.src = veiling.artworkUrl;
    artwork.alt = "Artwork for " + (veiling.name || "this Veiling");
    artwork.addEventListener("error", () => artwork.remove(), { once: true });
    content.append(artwork);
  }
  const copy = el("div");
  copy.append(
    el("p", "eyebrow", unavailable ? "Veiling" : veiling.number === null ? "Number not recorded" : "Veiling // " + String(veiling.number).padStart(3, "0")),
    el("h3", "", unavailable ? "Unavailable Veiling" : veiling.name || (veiling.contentStatus === "redacted" ? "Unknown Veiling" : "Name not recorded")),
    el("p", "ownership-description", unavailable ? "Veiling details are currently unavailable." : veiling.description || (veiling.contentStatus === "redacted" ? "Details have not been revealed." : "No description recorded.")),
  );
  content.append(copy);
  page.append(content);
  return page;
}

/** A read belongs to one route and one session; leaving either cancels its view. */
export function createOwnershipRecordController({ root, service, getSession, render = renderOwnershipRecord,
  onLoaded = () => {}, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout }) {
  let current = null;
  function reset() {
    if (!current) return;
    current.controller.abort();
    clearTimer(current.timer);
    current = null;
    root.replaceChildren();
  }
  function open({ id, identity }) {
    if (current?.id === id && current.identity === identity) return current.promise;
    reset();
    if (!identity || getSession() !== identity) return Promise.resolve();
    const entry = { id, identity, controller: new AbortController(), timer: null, promise: null };
    current = entry;
    const valid = () => current === entry && getSession() === identity;
    const show = (status, detail) => {
      if (valid()) root.replaceChildren(render({ status, detail, retry() {
        if (!valid()) return;
        reset();
        void open({ id, identity });
      } }));
    };
    if (typeof id !== "string" || !UUID.test(id)) {
      show("not-found");
      return Promise.resolve();
    }
    show("loading");
    entry.timer = setTimer(() => entry.controller.abort(), 30_000);
    entry.promise = (async () => {
      try {
        const detail = await service.getOwnershipDetail(id, { signal: entry.controller.signal });
        if (entry.controller.signal.aborted) throw new Error("Cancelled");
        if (valid()) onLoaded(detail);
        show("ready", detail);
      } catch (error) {
        show(error?.code === "NOT_FOUND" ? "not-found" : "error");
      } finally {
        clearTimer(entry.timer);
      }
    })();
    return entry.promise;
  }
  return Object.freeze({ open, reset });
}
