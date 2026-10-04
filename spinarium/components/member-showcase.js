import { el } from "./views.js";
import { releaseLabel } from "../domain/showcase.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const byNumber = (a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

function artwork(row, className) {
  if (!row.artworkUrl) return null;
  const image = el("img", className);
  image.src = row.artworkUrl;
  image.alt = "Artwork for " + row.name;
  image.loading = "lazy";
  image.addEventListener("error", () => image.remove(), { once: true });
  return image;
}
function numberLabel(row) {
  return row.number === null ? "Veiling" : "Veiling // " + String(row.number).padStart(3, "0");
}
function timing(row) {
  const label = el(row.releaseDate ? "time" : "span", "showcase-release", releaseLabel(row.releaseDate));
  if (row.releaseDate) label.dateTime = row.releaseDate;
  return label;
}

/** Each route loads an approved member projection; private catalog data is never requested. */
export function createMemberShowcase({ root, service, getSession, getOwnedIds = () => new Set() }) {
  let current = null;
  function reset() {
    if (!current) return;
    current.abort.abort();
    clearTimeout(current.timer);
    current = null;
    root.replaceChildren();
  }
  function open({ identity, id = null, upcoming = false, unowned = false }) {
    const key = JSON.stringify([id, upcoming, unowned]);
    if (current?.identity === identity && current.key === key) return current.promise;
    reset();
    if (!identity || getSession() !== identity) return Promise.resolve();
    const entry = { identity, key, abort: new AbortController(), timer: null, promise: null };
    current = entry;
    const valid = () => current === entry && getSession() === identity;
    const retry = () => { if (valid()) { reset(); void open({ identity, id, upcoming, unowned }); } };
    const heading = el("h2", "", id ? "Veiling" : upcoming ? "Upcoming Veilings" : "Explore Veilings");
    heading.id = "route-title";
    root.replaceChildren(heading);
    const status = el("p", "showcase-status", "Opening the showcase…");
    status.setAttribute("role", "status");
    root.append(status);
    const showError = (missing = false) => {
      heading.textContent = missing ? "Veiling unavailable" : id ? "Veiling" : upcoming ? "Upcoming Veilings" : "Explore Veilings";
      status.textContent = missing ? "This Veiling is not currently available to members." : "We couldn’t open the showcase. Please try again.";
      if (!missing) {
        const button = el("button", "outlined-button", "Try again");
        button.type = "button";
        button.dataset.action = "retry-showcase";
        button.addEventListener("click", retry);
        root.append(button);
      }
      if (id) root.append(Object.assign(el("a", "outlined-button showcase-back", "Back to Explore"), { href: "#explore?filter=discovered" }));
    };
    if (id !== null && !UUID.test(id)) { showError(true); return Promise.resolve(); }
    entry.timer = setTimeout(() => entry.abort.abort(), 30_000);
    entry.promise = (async () => {
      try {
        const data = id ? await service.getShowcaseVeiling(id, { signal: entry.abort.signal })
          : await service.getShowcase({ signal: entry.abort.signal });
        if (!valid()) return;
        if (entry.abort.signal.aborted) throw new Error("Cancelled");
        if (id) {
          heading.textContent = data.name;
          root.replaceChildren(Object.assign(el("a", "outlined-button showcase-back", data.visibility === "upcoming" ? "Back to Upcoming" : "Back to Explore"), {
            href: data.visibility === "upcoming" ? "#upcoming" : "#explore?filter=discovered",
          }), el("p", "eyebrow", numberLabel(data)), heading);
          const detail = el("div", "showcase-detail");
          const image = artwork(data, "showcase-detail-artwork");
          if (image) detail.append(image);
          const copy = el("div", "showcase-detail-copy");
          if (data.visibility === "upcoming") copy.append(el("p", "eyebrow", "Upcoming"), timing(data));
          if (data.description) copy.append(el("p", "showcase-description", data.description));
          const properties = el("dl", "showcase-properties");
          for (const [label, value] of [["Rarity", data.rarity], ["Edition", data.edition]]) if (value) {
            const field = el("div"); field.append(el("dt", "", label), el("dd", "", value)); properties.append(field);
          }
          copy.append(properties);
          const owned = getOwnedIds().has(data.id);
          copy.append(el("p", "showcase-ownership", owned ? "In your collection" : "Not in your collection"));
          if (owned) copy.append(Object.assign(el("a", "outlined-button", "View my collection"), { href: "#collection?filter=owned" }));
          detail.append(copy); root.append(detail);
          return;
        }
        root.replaceChildren(heading, el("p", "route-intro", upcoming
          ? "A look at what’s coming to the Spinarium."
          : "Meet the Veilings revealed to Spinarium members."));
        const controls = el("div", "showcase-controls");
        const label = el("label", "auth-field", "Search Veilings");
        const input = el("input"); input.id = "showcase-search"; input.type = "search";
        input.maxLength = 120; input.placeholder = "Search by name or number…";
        label.append(input); controls.append(label);
        const refresh = el("button", "outlined-button", "Refresh"); refresh.type = "button";
        refresh.addEventListener("click", retry); controls.append(refresh);
        const grid = el("div", "showcase-grid"); grid.id = "showcase-grid";
        const count = el("p", "showcase-status"); count.id = "showcase-status"; count.setAttribute("role", "status");
        root.append(controls, grid, count);
        const rows = data.filter(row => row.visibility === (upcoming ? "upcoming" : "public") && (!unowned || !getOwnedIds().has(row.id)));
        rows.sort((a, b) => upcoming ? (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999") || byNumber(a, b) : byNumber(a, b));
        const render = () => {
          const term = input.value.trim().toLocaleLowerCase();
          const visible = rows.filter(row => `${row.name} ${row.number === null ? "" : String(row.number).padStart(3, "0")}`.toLocaleLowerCase().includes(term));
          grid.replaceChildren();
          for (const row of visible) {
            const link = el("a", "showcase-card"); link.href = "#showcase/" + row.id;
            link.dataset.showcaseId = row.id;
            const image = artwork(row, "showcase-card-artwork"); if (image) link.append(image);
            const copy = el("div", "showcase-card-copy");
            copy.append(el("p", "eyebrow", numberLabel(row)), el("h3", "", row.name));
            if (upcoming) copy.append(timing(row));
            else if (getOwnedIds().has(row.id)) copy.append(el("span", "showcase-owned", "In your collection"));
            if (row.description) copy.append(el("p", "showcase-excerpt", row.description.slice(0, 180) + (row.description.length > 180 ? "…" : "")));
            copy.append(el("span", "showcase-view", "View Veiling →")); link.append(copy); grid.append(link);
          }
          count.textContent = visible.length ? `${visible.length} ${visible.length === 1 ? "Veiling" : "Veilings"}` : term
            ? "No Veilings match your search." : upcoming ? "No upcoming Veilings to show yet."
            : unowned ? "No uncollected Veilings are currently available in the showcase."
            : "Nothing has been revealed here yet. Check back as the Spinarium expands.";
        };
        input.addEventListener("input", render); render();
      } catch (error) {
        if (valid()) showError(error?.code === "NOT_FOUND");
      } finally { clearTimeout(entry.timer); }
    })();
    return entry.promise;
  }
  return Object.freeze({ open, reset });
}
