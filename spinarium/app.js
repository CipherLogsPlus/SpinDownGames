import { demoSpinariumService } from "./data/demo-service.js";
import { getVeilingDetail, queryCollection } from "./domain/collection.js";
import { hydrateIcons } from "./components/icons.js";
import {
  el,
  renderStats,
  renderCollection,
  renderDetail,
  renderFooter,
  renderRoute,
  renderFullDetail,
} from "./components/views.js";

// Composition root: replace this read adapter when an authenticated API exists.
// There is intentionally no browser-side ownership, redemption, or token store.
const service = demoSpinariumService;
const state = {
  snapshot: null,
  capabilities: null,
  selectedId: "ashenling",
  query: { search: "", filter: "all", sort: "number" },
};
const $ = (selector) => document.querySelector(selector);
const mobile = matchMedia("(max-width: 640px)");
let initialized = false;
let lastRoute = "";
hydrateIcons();

function updateSelection() {
  const detail = getVeilingDetail(state.snapshot, state.selectedId);
  $("#detail-panel").replaceChildren(renderDetail(detail));
  document
    .querySelectorAll("[data-card-id]")
    .forEach((card) =>
      card.setAttribute(
        "aria-pressed",
        String(card.dataset.cardId === state.selectedId),
      ),
    );
}

function updateCollection() {
  const entries = queryCollection(state.snapshot, state.query);
  $("#collection-grid").replaceChildren(
    renderCollection(entries, state.selectedId),
  );
  const suffix =
    state.query.filter === "discovered"
      ? " · Includes revealed owned and unowned Veilings"
      : "";
  $("#collection-status").textContent =
    `${entries.length} ${entries.length === 1 ? "Veiling" : "Veilings"} shown · Sample collection${suffix}`;
  $("#collection-filter")
    .querySelectorAll("button")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.filter === state.query.filter),
      ),
    );
}

function closeNavigation(restoreFocus = false) {
  $("#sidebar-nav").classList.remove("is-open");
  $("#navigation-toggle").setAttribute("aria-expanded", "false");
  if (restoreFocus) $("#navigation-toggle").focus();
}

function syncMobileNavigation() {
  $("#navigation-toggle").hidden = !mobile.matches;
  closeNavigation();
}

function openDialog(dialog, trigger) {
  dialog._returnFocus = trigger || document.activeElement;
  dialog.showModal();
}

function setupDialogs() {
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-dialog]")) dialog.close();
      if (event.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          dialog.close();
      }
    });
    dialog.addEventListener("close", () => {
      if (dialog._returnFocus?.isConnected)
        dialog._returnFocus.focus({ preventScroll: true });
    });
  });
  $("#claim-form").addEventListener("submit", (event) =>
    event.preventDefault(),
  );
  $("#claim-open").addEventListener("click", (event) =>
    openDialog($("#claim-dialog"), event.currentTarget),
  );
}

function route() {
  const hash = location.hash.slice(1) || "dashboard";
  // The skip destination is an HTML anchor, not an application route.
  const name = hash === "main-content" ? "dashboard" : hash;
  const isCollection = name === "dashboard" || name === "collection";
  $("#dashboard-view").hidden = !isCollection;
  $("#route-view").hidden = isCollection;
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.dataset.nav === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (!isCollection)
    $("#route-content").replaceChildren(
      renderRoute(name, state.snapshot, state.capabilities),
    );
  document.title =
    name === "dashboard"
      ? "Spinarium — SpinDownGames™"
      : `${name === "collection" ? "My Collection" : $("#route-title").textContent} · Spinarium — SpinDownGames™`;
  if (lastRoute && lastRoute !== name) {
    if (isCollection) $("#collection-search").focus({ preventScroll: true });
    else $("#route-title").focus({ preventScroll: true });
  }
  lastRoute = name;
  closeNavigation();
}

function setupInteractions() {
  $("#catalog-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.query.search = $("#catalog-search").value;
    state.query.filter = "all";
    $("#collection-search").value = state.query.search;
    updateCollection();
    if (location.hash !== "#collection") location.hash = "collection";
    else $("#collection-search").focus();
  });
  $("#collection-search").addEventListener("input", (event) => {
    state.query.search = event.currentTarget.value;
    updateCollection();
  });
  $("#collection-sort").addEventListener("change", (event) => {
    state.query.sort = event.currentTarget.value;
    updateCollection();
  });
  $("#collection-filter").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.query.filter = button.dataset.filter;
    updateCollection();
  });
  $("#collection-grid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-card-id]");
    if (!card) return;
    state.selectedId = card.dataset.cardId;
    updateSelection();
    // Mobile uses a separate, accessible detail sheet for revealed cards.
    const detail = getVeilingDetail(state.snapshot, state.selectedId);
    if (mobile.matches && detail.status !== "undiscovered") {
      $("#full-detail-content").replaceChildren(renderFullDetail(detail));
      openDialog($("#veiling-dialog"), card);
    } else if (mobile.matches) {
      $("#detail-panel").scrollIntoView({ block: "start", behavior: "auto" });
      $("#selected-name").tabIndex = -1;
      $("#selected-name").focus({ preventScroll: true });
    }
  });
  $("#detail-panel").addEventListener("click", (event) => {
    const trigger = event.target.closest('[data-action="details"]');
    if (!trigger) return;
    const detail = getVeilingDetail(state.snapshot, state.selectedId);
    $("#full-detail-content").replaceChildren(renderFullDetail(detail));
    openDialog($("#veiling-dialog"), trigger);
  });
  $("#navigation-toggle").addEventListener("click", () => {
    const open =
      $("#navigation-toggle").getAttribute("aria-expanded") !== "true";
    $("#sidebar-nav").classList.toggle("is-open", open);
    $("#navigation-toggle").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      $("#navigation-toggle").getAttribute("aria-expanded") === "true"
    )
      closeNavigation(true);
  });
  document.addEventListener("click", (event) => {
    if (
      mobile.matches &&
      !event.target.closest("#sidebar-nav, #navigation-toggle")
    )
      closeNavigation();
  });
  mobile.addEventListener("change", syncMobileNavigation);
  window.addEventListener("hashchange", route);
  setupDialogs();
  syncMobileNavigation();
}

async function boot() {
  const status = $("#loading-status");
  try {
    state.snapshot = await service.getDashboard();
    state.capabilities = await service.getCapabilities();
    if (!state.snapshot.veilings.some((item) => item.id === state.selectedId)) {
      state.selectedId = state.snapshot.veilings[0]?.id ?? null;
    }
    $("#stats").replaceChildren(renderStats(state.snapshot));
    $("#dashboard-footer").replaceChildren(renderFooter(state.snapshot));
    updateCollection();
    updateSelection();
    if (!initialized) {
      setupInteractions();
      initialized = true;
    }
    route();
    status.hidden = true;
  } catch {
    // Never stringify transport errors: future responses may contain secrets.
    status.className = "error-message";
    status.replaceChildren(
      el("p", "", "The archive could not be opened. Please try again."),
      el("button", "outlined-button", "Try again"),
    );
    status
      .querySelector("button")
      .addEventListener("click", boot, { once: true });
    $("#dashboard-view").hidden = true;
    $("#route-view").hidden = true;
  }
}

boot();
