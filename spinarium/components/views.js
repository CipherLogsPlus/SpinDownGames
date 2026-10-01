import { icon } from "./icons.js";
import { getDashboardStats, getVeilingDetail } from "../domain/collection.js";

// Service strings are always text nodes. Only trusted component structure is markup.
export function el(tag, className = "", text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = String(text);
  return node;
}
const number = (value) =>
  value === null || value === undefined ? "—" : String(value).padStart(3, "0");
const date = (value) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(value))
    : "Not announced";
const accents = {
  silver: "#7e898f",
  cyan: "#bfa477",
  violet: "#9b83ad",
  gold: "#c6a56a",
};

function image(src, alt, className = "", eager = false) {
  const img = el("img", className);
  img.src = src;
  img.alt = alt;
  img.width = 1086;
  img.height = 1448;
  img.loading = eager ? "eager" : "lazy";
  img.decoding = "async";
  img.addEventListener(
    "error",
    () => {
      const fallback = el("div", "asset-fallback", "Artwork coming soon");
      fallback.setAttribute("role", "img");
      fallback.setAttribute("aria-label", alt);
      img.replaceWith(fallback);
    },
    { once: true },
  );
  return img;
}

function link(text, href, className = "") {
  const node = el("a", className, text);
  // A future editorial response must not turn a URL into executable script.
  const url = new URL(href, document.baseURI);
  if (!["https:", "http:"].includes(url.protocol))
    return el("span", className, text);
  node.href = href;
  if (href.startsWith("https://")) {
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    node.append(el("span", "sr-only", " (opens in a new tab)"));
  }
  return node;
}

function action(text, kind, className = "outlined-button") {
  const button = el("button", className, text);
  button.type = "button";
  button.dataset.action = kind;
  return button;
}

function panelHeading(title, href) {
  const header = el("div", "panel-heading");
  header.append(el("h2", "", title), link("View all →", href));
  return header;
}

export function renderStats(snapshot) {
  const values = getDashboardStats(snapshot);
  const fragment = document.createDocumentFragment();
  for (const [key, label] of [
    ["veilingsOwned", "Veilings Owned"],
    ["collectionsCompleted", "Collections Completed"],
    ["achievements", "Achievements"],
    ["firstDiscoveries", "First Discoveries"],
    ["memberSince", "Member Since"],
  ]) {
    const card = el("div", "stat-card");
    card.append(el("strong", "", values[key]), el("span", "", label));
    fragment.append(card);
  }
  return fragment;
}

function blankCard() {
  const card = el("div", "blank-card");
  card.setAttribute("aria-hidden", "true");
  return card;
}

export function renderCollection(entries, selectedId) {
  const fragment = document.createDocumentFragment();
  if (!entries.length) {
    // Decorative empty slots are not catalog records, character counts or grants.
    for (let i = 0; i < 10; i++) fragment.append(blankCard());
    return fragment;
  }
  for (const entry of entries) {
    if (entry.status !== "owned") {
      fragment.append(blankCard());
      continue;
    }
    const card = el("button", `veiling-card is-${entry.status}`);
    card.type = "button";
    card.dataset.cardId = entry.id;
    card.setAttribute("aria-pressed", String(selectedId === entry.id));
    card.setAttribute(
      "aria-label",
      `${number(entry.number)} ${entry.displayName}, ${entry.status === "undiscovered" ? "not discovered" : entry.status}`,
    );
    if (entry.rarity)
      card.style.setProperty(
        "--card-accent",
        accents[entry.rarity.accent] || "#7da8b1",
      );
    const art = el("div", "card-art");
    if (entry.status !== "undiscovered" && entry.thumbnail)
      art.append(image(entry.thumbnail, "", "", true));
    const caption = el("span", "card-caption");
    caption.append(
      el("span", "card-number", number(entry.number)),
      el("span", "card-name", entry.displayName),
    );
    if (entry.status !== "owned")
      caption.append(
        el(
          "span",
          "card-state",
          entry.status === "undiscovered"
            ? "NOT DISCOVERED"
            : "DISCOVERED · UNOWNED",
        ),
      );
    card.append(art, caption);
    fragment.append(card);
  }
  return fragment;
}

function metadata(detail, full = false) {
  const dl = el("dl", "metadata");
  const items = [
    ["Type", detail.veiling.type || "Not announced"],
    ["Rarity", detail.rarity?.label || "Not announced"],
    ["Edition", detail.edition?.name || "Not announced"],
    ["Physical Serial", detail.physicalCard?.serial || "Not owned"],
    [
      "Claimed",
      detail.ownership ? date(detail.ownership.acquiredAt) : "Not claimed",
    ],
    ["Origin", detail.veiling.origin || "Unknown"],
    [
      "First Discovered",
      detail.discovery?.revealKind === "launch"
        ? "Launch release"
        : date(detail.discovery?.firstDiscoveredAt),
    ],
  ];
  if (full)
    items.push(
      ["Variant", detail.variant?.name || "Not announced"],
      ["Release", date(detail.veiling.releaseDate)],
    );
  for (const [label, value] of items) {
    const row = el("div");
    row.append(el("dt", "", label), el("dd", "", value));
    dl.append(row);
  }
  return dl;
}

export function renderDetail(detail) {
  const fragment = document.createDocumentFragment();
  if (!detail) {
    const empty = el("div", "mystery-detail");
    const title = el("h2", "", "The archive awaits");
    title.id = "selected-name";
    empty.append(
      title,
      el(
        "p",
        "",
        "Veiling details will appear here when the collection is available.",
      ),
    );
    fragment.append(empty);
    return fragment;
  }
  if (detail.status !== "owned") {
    const empty = el("div", "mystery-detail");
    const title = el("h2", "", "Yet to be discovered");
    title.id = "selected-name";
    empty.append(
      title,
      el(
        "p",
        "",
        "Register a physical card to add its Veiling to your collection.",
      ),
    );
    fragment.append(empty);
    return fragment;
  }
  const main = el("div", "detail-main");
  const portrait = el("div", "detail-portrait");
  if (detail.colorArt)
    portrait.append(
      image(
        detail.colorArt,
        `Full-color artwork for ${detail.displayName}`,
        "",
        true,
      ),
    );
  const info = el("div", "detail-info");
  const badge = el(
    "span",
    "ownership-badge",
    detail.status === "owned" ? "Owned" : "Discovered",
  );
  if (detail.status === "owned") badge.prepend(icon("check"));
  const title = el("h2", "", detail.displayName);
  title.id = "selected-name";
  info.append(
    badge,
    title,
    el("p", "detail-number", `// ${number(detail.number)}`),
    el("p", "detail-quote", detail.description),
    metadata(detail),
  );
  main.append(portrait, info);
  const actions = el("div", "detail-actions");
  const three = action("View in 3D", "three");
  three.prepend(icon("cube"));
  // A server capability cannot enable a renderer that has not been built.
  three.disabled = true;
  three.title = "3D artwork is not available yet";
  three.setAttribute("aria-label", "View in 3D — not available yet");
  actions.append(action("View Full Details", "details"), three);
  const lore = el("div", "lore-preview");
  lore.append(
    el("h3", "", "Lore Preview"),
    el(
      "p",
      "",
      detail.lore?.text
        ? `${detail.lore.text.slice(0, 178).trim()}${detail.lore.text.length > 178 ? "…" : ""}`
        : "This story has not been written yet.",
    ),
    action("Read more →", "details", ""),
  );
  fragment.append(main, actions, lore);
  return fragment;
}

export function renderFullDetail(detail) {
  const grid = el("div", "full-detail-grid");
  if (detail.colorArt)
    grid.append(
      image(detail.colorArt, `Artwork for ${detail.displayName}`, "", true),
    );
  const content = el("div");
  const title = el("h2", "", detail.displayName);
  title.id = "full-detail-name";
  content.append(
    el(
      "p",
      "eyebrow",
      `Veiling // ${number(detail.number)} · ${detail.status}`,
    ),
    title,
    el("p", "detail-quote", detail.description),
    metadata(detail, true),
    el("h3", "", "Lore"),
    el("p", "", detail.lore?.text || "Awaiting discovery."),
  );
  grid.append(content);
  return grid;
}

function newsPanel(snapshot) {
  const panel = el("section", "panel feed-panel");
  panel.append(panelHeading("Latest News", "#news"));
  const list = el("ul", "news-list");
  for (const item of snapshot.news) {
    const row = el("li");
    const time = el("time", "", date(item.date));
    time.dateTime = item.date;
    row.append(el("span", "", item.title), time);
    list.append(row);
  }
  panel.append(list);
  if (!snapshot.news.length)
    panel.append(el("p", "", "Collection announcements will appear here."));
  return panel;
}

function achievementPanel(snapshot) {
  const panel = el("section", "panel feed-panel");
  panel.append(panelHeading("Recent Achievements", "#achievements"));
  const list = el("ul", "achievement-list");
  const earned = snapshot.userAchievements
    .filter((item) => item.userId === snapshot.profile.id)
    .toSorted((a, b) => b.earnedAt.localeCompare(a.earnedAt));
  for (const item of earned.slice(0, 3)) {
    const definition = snapshot.achievements.find(
      (achievement) => achievement.id === item.achievementId,
    );
    if (!definition) continue;
    const row = el("li");
    const emblem = el("span", "achievement-icon");
    emblem.append(icon(definition.icon));
    const copy = el("div", "achievement-copy");
    copy.append(
      el("strong", "", definition.name),
      el("p", "", definition.description),
    );
    row.append(
      emblem,
      copy,
      el("span", "achievement-date", date(item.earnedAt)),
    );
    list.append(row);
  }
  panel.append(list);
  if (!earned.length) panel.append(el("p", "", "No achievements earned yet."));
  return panel;
}

function eventPanel(snapshot) {
  const event = snapshot.events[0];
  const panel = el("section", "panel event-panel");
  panel.append(panelHeading("Featured Event", "#events"));
  if (!event) {
    panel.append(el("p", "", "More gatherings to come."));
    return panel;
  }
  const content = el("div", "event-body");
  content.append(
    el("p", "event-brand", "SpinDownGames™"),
    el("h3", "", event.title),
    el("p", "event-tag", "Cards · Community · Discovery"),
    el(
      "p",
      "",
      `${date(event.startDate)} – ${date(event.endDate)}  |  ${event.location}`,
    ),
  );
  panel.append(content);
  return panel;
}

export function renderFooter(snapshot) {
  const fragment = document.createDocumentFragment();
  fragment.append(
    newsPanel(snapshot),
    achievementPanel(snapshot),
    eventPanel(snapshot),
  );
  return fragment;
}

const titles = {
  achievements: "Achievements",
  discoveries: "Discovery Log",
  transfers: "Ownership Transfers",
  settings: "Collector Settings",
  collections: "Collections & Editions",
  events: "Gatherings in the World",
  news: "From the Archive",
};

export function renderRoute(route, snapshot, capabilities) {
  const fragment = document.createDocumentFragment();
  const title = el("h2", "", titles[route] || "Page not found");
  title.id = "route-title";
  title.tabIndex = -1;
  fragment.append(el("p", "eyebrow", "Your Spinarium"), title);
  if (route === "achievements") {
    fragment.append(
      el(
        "p",
        "route-intro",
        "Milestones along the way. Earned achievements will appear here as your collection grows.",
      ),
    );
    const grid = el("div", "route-grid");
    const stats = getDashboardStats(snapshot);
    for (const definition of snapshot.achievements) {
      const earned = snapshot.userAchievements.find(
        (item) =>
          item.achievementId === definition.id &&
          item.userId === snapshot.profile.id,
      );
      const card = el("article", "route-card");
      const emblem = el("span", "achievement-icon");
      emblem.append(icon(definition.icon));
      card.append(
        emblem,
        el("h3", "", definition.name),
        el("p", "", definition.description),
      );
      if (earned)
        card.append(el("small", "", `Earned ${date(earned.earnedAt)}`));
      else {
        const progress = el("progress");
        progress.max = definition.rule.minimum || 1;
        progress.value =
          definition.rule.type === "distinct_owned_count"
            ? stats.veilingsOwned
            : 0;
        progress.setAttribute("aria-label", `${definition.name} progress`);
        card.append(
          progress,
          el("small", "", `${progress.value} / ${progress.max} · In progress`),
        );
      }
      grid.append(card);
    }
    fragment.append(grid);
  } else if (route === "discoveries") {
    fragment.append(
      el(
        "p",
        "route-intro",
        "Discovery belongs to the world; ownership belongs to the collector. Verified discoveries will appear here.",
      ),
    );
    const list = el("ol", "discovery-list");
    for (const discovery of snapshot.discoveries
      .filter((item) => item.status === "revealed")
      .toSorted((a, b) =>
        b.firstDiscoveredAt.localeCompare(a.firstDiscoveredAt),
      )) {
      const detail = getVeilingDetail(snapshot, discovery.veilingId);
      const row = el("li", "discovery-item");
      const content = el("div");
      const time = el("time", "", date(discovery.firstDiscoveredAt));
      time.dateTime = discovery.firstDiscoveredAt;
      content.append(
        el("h3", "", `${number(detail.number)} · ${detail.displayName}`),
        time,
        el(
          "p",
          "",
          discovery.publicDiscovererName
            ? `First discovered by ${discovery.publicDiscovererName}`
            : "Launch reveal",
        ),
      );
      row.append(icon("discovery"), content);
      list.append(row);
    }
    fragment.append(list);
  } else if (route === "collections") {
    fragment.append(
      el(
        "p",
        "route-intro",
        "Gather stories that belong together. Progress comes from your verified ownership records.",
      ),
    );
    const grid = el("div", "route-grid");
    for (const collection of snapshot.collections) {
      const owned = collection.veilingIds.filter((id) =>
        snapshot.ownerships.some(
          (item) =>
            item.userId === snapshot.profile.id && item.veilingId === id,
        ),
      ).length;
      const card = el("article", "route-card");
      card.append(
        el("h3", "", collection.name),
        el(
          "p",
          "",
          `${owned} of ${collection.veilingIds.length} Veilings owned`,
        ),
      );
      const progress = el("progress");
      progress.max = collection.veilingIds.length;
      progress.value = owned;
      progress.setAttribute("aria-label", `${collection.name} completion`);
      card.append(
        progress,
        el(
          "small",
          "",
          owned === collection.veilingIds.length ? "Complete" : "In progress",
        ),
      );
      grid.append(card);
    }
    const legacy = el("article", "legacy-note");
    legacy.append(
      el("h3", "", "Legacy editions"),
      el(
        "p",
        "",
        "Before the Spinarium, there were the Legacy Veilings. Early editions may have no claim code or individual digital ownership record. Legacy editions will have their own documented production and retirement information; verification is not available.",
      ),
      el("span", "draft-label", "Edition details awaiting confirmation"),
    );
    fragment.append(grid, legacy);
  } else if (route === "events") {
    fragment.append(
      el(
        "p",
        "route-intro",
        "Meet the people behind the collection. Explore the confirmed SpinDownGames™ event on the original website.",
      ),
    );
    const grid = el("div", "route-grid");
    for (const event of snapshot.events) {
      const card = el("article", "route-card");
      card.append(
        image(event.image, "Trainer’s Bazaar event flyer"),
        el("h3", "", event.title),
        el("p", "", event.subtitle),
        el(
          "small",
          "",
          `${date(event.startDate)} – ${date(event.endDate)} · ${event.location}`,
        ),
        link("View event details →", event.href, "link-button"),
      );
      grid.append(card);
    }
    fragment.append(grid);
  } else if (route === "news") {
    fragment.append(
      el(
        "p",
        "route-intro",
        "Approved collection announcements and stories will appear here.",
      ),
    );
    const grid = el("div", "route-grid");
    for (const item of snapshot.news) {
      const card = el("article", "route-card");
      card.append(
        el("p", "eyebrow", `${item.status} · ${date(item.date)}`),
        el("h3", "", item.title),
        el("p", "", item.body),
      );
      grid.append(card);
    }
    fragment.append(grid);
  } else if (route === "transfers") {
    fragment.append(
      el(
        "p",
        "route-intro",
        "Verified ownership transfers will connect a card’s current owner and its next collector.",
      ),
    );
    const note = el("div", "availability-note");
    note.append(
      el("strong", "", "Transfers are not available yet."),
      el("p", "", "Secure ownership transfers are not available yet."),
    );
    fragment.append(
      note,
      link("Return to your collection →", "#collection", "link-button"),
    );
  } else if (route === "settings") {
    fragment.append(
      el(
        "p",
        "route-intro",
        "Your account is managed by the secure sign-in service. Profile editing is not available yet.",
      ),
    );
    const grid = el("div", "route-grid");
    for (const [heading, body] of [
      [
        "Accounts",
        capabilities.authentication
          ? "Available"
          : "Secure sign-in and collector profiles are not available yet.",
      ],
      [
        "Privacy",
        "Your collection is private. Public ownership visibility controls are not available yet.",
      ],
      ["Motion", "Spinarium follows your device’s reduced-motion preference."],
    ]) {
      const card = el("article", "route-card");
      card.append(el("h3", "", heading), el("p", "", body));
      grid.append(card);
    }
    fragment.append(grid);
  } else {
    fragment.append(
      el("p", "route-intro", "This part of the archive could not be found."),
      link("Return to Spinarium →", "#dashboard", "link-button"),
    );
  }
  return fragment;
}
