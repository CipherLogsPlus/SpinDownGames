import { spinariumConfig } from "./config.js";
import { createAuthClient, AuthError } from "./auth/cloudflare-auth.js";
import { createSpinariumService } from "./data/cloudflare-service.js";
import { createPreviewAccess } from "./data/preview-service.js";
import { createFirstLoginIntro } from "./components/first-login-intro.js";
import { createDashboardReveal } from "./components/dashboard-reveal.js";
import { renderHomeHub } from "./components/home-hub.js";
import { parseRoute } from "./domain/routing.js";
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

// Preview is explicitly selected; provider failures never fall back to it.
const preview = spinariumConfig.previewEnabled === true;
document.body.classList.toggle("static-preview", preview);
const adapters = preview ? createPreviewAccess() : null;
const auth = adapters?.auth ?? createAuthClient(spinariumConfig);
const service = adapters?.service ?? createSpinariumService(spinariumConfig, auth);
const $ = (selector) => document.querySelector(selector);
const dashboardReveal = createDashboardReveal(document.body);
const firstLoginIntro = createFirstLoginIntro($("#first-login-intro"), {
  dock: $("#welcome-ribbon-dock"), focusTarget: $("#main-content"),
  onPrepare: dashboardReveal.prepare, onReveal: dashboardReveal.reveal,
  onReset: dashboardReveal.reset,
});
const mobile = matchMedia("(max-width: 640px)");
const state = {
  session: null,
  snapshot: null,
  capabilities: null,
  selectedId: null,
  admin: false,
  authBusy: false,
  epoch: 0,
  query: { search: "", filter: "owned", sort: "number" },
};
const authRoutes = new Set(["signin", "signup", "reset", "update-password"]);
let authMode = "signin";
let adminRows = [];
let adminSaving = false;
let adminRevision = null;
hydrateIcons();

function feedback(message, isError = false) {
  $("#auth-feedback").textContent = message;
  $("#auth-feedback").classList.toggle("is-error", isError);
}
function clearPasswords() {
  $("#auth-password").value = "";
  $("#auth-confirm-password").value = "";
}
function closeNavigation(restore = false) {
  $("#sidebar-nav").classList.remove("is-open");
  $("#sidebar-nav").inert = true;
  $("#sidebar-nav").setAttribute("aria-hidden", "true");
  $("#navigation-toggle").setAttribute("aria-expanded", "false");
  if (restore) $("#navigation-toggle").focus();
}
function navigationSize() {
  $("#navigation-toggle").hidden =
    !state.session || state.session.flow === "recovery";
  closeNavigation();
}
function setAuthMode(mode) {
  const signupEnabled = !preview && auth.configured && spinariumConfig.signupEnabled === true;
  authMode = signupEnabled && mode === "signup" ? "signup" : "signin";
  const signup = authMode === "signup";
  $("#auth-title").textContent = signup ? "Begin your Spinarium" : "Enter your Spinarium";
  $("#auth-description").textContent = signup
    ? "Create your account using the secure account service. Verify your email before signing in. Your collection begins empty."
    : "Continue to secure email and password sign-in. Password recovery is available there.";
  $("#auth-submit").textContent = signup ? "Create account" : "Sign in";
  $("#auth-email").closest(".auth-field").hidden = !preview;
  $("#auth-email").disabled = !preview;
  $("#auth-email").required = preview;
  $("#auth-password-group").hidden = !preview;
  $("#auth-password").disabled = !preview;
  $("#auth-password").required = preview;
  $("#auth-password").minLength = 1;
  $("#auth-confirm-group").hidden = true;
  $("#auth-confirm-password").disabled = true;
  $("#auth-confirm-password").required = false;
  $("#forgot-password").hidden = true;
  $("#signup-tab").hidden = !signupEnabled;
  $("#guest-tools a[href='#signup']").hidden = !signupEnabled;
  $(".auth-tabs").hidden = !preview && !signupEnabled;
  $("#auth-fields").disabled = !auth.configured || state.authBusy;
  $("#auth-availability").hidden = auth.configured && !preview;
  if (!preview && !auth.configured) {
    $("#auth-availability").replaceChildren(
      el("strong", "", "Accounts are being connected."),
      el("p", "", auth.configurationError),
    );
  }
  if (preview) {
    $("#auth-title").textContent = "Spinarium login";
    $("#auth-description").textContent = "Explore an empty collection preview. Real accounts are not connected yet.";
    $("#auth-availability").replaceChildren(
      el("strong", "", "Static preview"),
      el("p", "", "Username: admin · Password: 1234. This preview contains no private data or real account access."),
    );
    $("#auth-email").type = "text";
    $("label[for='auth-email']").textContent = "Username";
    $("#auth-submit").textContent = "Log in";
  } else {
    $(".auth-policy").replaceChildren(
      document.createTextNode("By signing in, you agree to the "),
      Object.assign(el("a", "", "Terms"), { href: "../terms.html" }),
      document.createTextNode(" and acknowledge the "),
      Object.assign(el("a", "", "Privacy Policy"), { href: "../privacy.html" }),
      document.createTextNode("."),
    );
  }
  for (const [selector, active] of [
    ["#signin-tab", !signup],
    ["#signup-tab", signup],
  ]) {
    if (active) $(selector).setAttribute("aria-current", "page");
    else $(selector).removeAttribute("aria-current");
  }
  document.title = (signup ? "Create account" : "Sign in") + " · Spinarium — SpinDownGames™";
  clearPasswords();
}
function clearPrivateViews() {
  firstLoginIntro.reset();
  state.snapshot = null;
  state.selectedId = null;
  state.admin = false;
  state.query = { search: "", filter: "owned", sort: "number" };
  $("#collection-search").value = "";
  $("#catalog-search").value = "";
  $("#collection-sort").value = "number";
  adminRows = [];
  adminRevision = null;
  $("#admin-form").reset();
  $("#admin-list").replaceChildren();
  for (const id of [
    "stats",
    "collection-grid",
    "detail-panel",
    "dashboard-footer",
    "hub-view",
    "route-content",
    "full-detail-content",
  ])
    $("#" + id).replaceChildren();
  for (const dialog of document.querySelectorAll("dialog[open]"))
    dialog.close();
}
function signedOutView() {
  document.body.classList.add("auth-gated");
  $("#auth-view").hidden = false;
  $("#guest-tools").hidden = false;
  for (const id of [
    "account-tools",
    "sidebar-nav",
    "dashboard-view",
    "hub-view",
    "route-view",
    "explore-tabs",
    "admin-view",
    "collection-notice",
    "claim-open",
    "admin-nav",
    "loading-status",
  ])
    $("#" + id).hidden = true;
  $("#profile-name").textContent = "Collector";
  navigationSize();
}
function selectedDetail() {
  return state.snapshot
    ? getVeilingDetail(state.snapshot, state.selectedId)
    : null;
}
function updateSelection() {
  const detail = selectedDetail();
  $("#detail-panel").hidden = !detail;
  $(".dashboard-layout").classList.toggle("has-selection", Boolean(detail));
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
  if (!entries.some(entry => entry.id === state.selectedId)) state.selectedId = null;
  $("#collection-grid").replaceChildren(
    renderCollection(entries, state.selectedId),
  );
  $("#collection-status").textContent = entries.length
    ? entries.length + " Veilings in this view"
    : state.query.filter === "owned"
      ? "Your collection is empty. No Veilings have been added."
      : "No Veilings to show in this view yet.";
  $("#collection-filter").value = state.query.filter;
  updateSelection();
}
function showCollectionError() {
  $("#dashboard-view").hidden = true;
  $("#route-view").hidden = true;
  $("#loading-status").hidden = false;
  $("#loading-status").className = "error-message";
  const retry = el("button", "outlined-button", "Try again");
  retry.type = "button";
  retry.addEventListener("click", loadCollection);
  $("#loading-status").replaceChildren(
    el(
      "p",
      "",
      "Your account is signed in. The collection service is not available yet. No sample collection has been substituted.",
    ),
    retry,
  );
}
async function loadCollection() {
  if (!state.session || state.session.flow === "recovery") return;
  const epoch = state.epoch;
  $("#loading-status").hidden = false;
  $("#loading-status").className = "";
  $("#loading-status").textContent = "Opening your collection…";
  try {
    const [snapshot, admin] = await Promise.all([
      service.getDashboard(),
      service.getAdminAccess(),
    ]);
    if (epoch !== state.epoch || !auth.getSession()) return;
    state.snapshot = snapshot;
    state.admin = admin === true;
    state.capabilities = service.getCapabilities();
    state.selectedId = null;
    $("#stats").replaceChildren(renderStats(snapshot));
    $("#dashboard-footer").replaceChildren(renderFooter(snapshot));
    $("#hub-view").replaceChildren(renderHomeHub(snapshot));
    updateCollection();
    updateSelection();
    $("#admin-nav").hidden = !state.admin;
    $("#loading-status").hidden = true;
    route();

  } catch {
    if (epoch === state.epoch && auth.getSession()) showCollectionError();
  }
}
async function handleSession(session) {
  const epoch = ++state.epoch;
  state.session = session;
  clearPrivateViews();
  if (!session) {
    signedOutView();
    setAuthMode("signin");
    if (!authRoutes.has(location.hash.slice(1)))
      history.replaceState(null, "", "#signin");
    return;
  }
  if (session.flow === "recovery") {
    signedOutView();
    setAuthMode("update-password");
    history.replaceState(null, "", "#update-password");
    return;
  }
  if (preview && firstLoginIntro.show()) {
    // Keep login beneath the fade-to-black before revealing the layout.
    await new Promise(resolve => setTimeout(resolve, 400));
    if (epoch !== state.epoch || !auth.getSession()) return;
  }
  document.body.classList.remove("auth-gated");
  $("#auth-view").hidden = true;
  $("#guest-tools").hidden = true;
  $("#account-tools").hidden = false;
  $("#sidebar-nav").hidden = false;
  $("#collection-notice").hidden = false;
  $("#claim-open").hidden = false;
  $("#profile-name").textContent = session.user.displayName || session.user.email;
  if (preview) $("#collection-notice").textContent = "Static preview · No real account, ownership, or backend actions are connected.";
  navigationSize();
  if (authRoutes.has(location.hash.slice(1)) || !location.hash)
    history.replaceState(null, "", "#dashboard");
  loadCollection();
}
function route() {
  const parsed = parseRoute(location.hash, Boolean(state.session));
  const requested = parsed.name;
  if (!state.session || state.session.flow === "recovery") {
    signedOutView();
    setAuthMode(
      state.session?.flow === "recovery" ? "update-password" : requested,
    );
    if (!authRoutes.has(requested) && requested !== "main-content")
      history.replaceState(null, "", "#signin");
    return;
  }
  if (!state.snapshot) return;
  const name =
    requested === "main-content" || authRoutes.has(requested)
      ? "dashboard"
      : requested;
  const collectionPage = name === "collection" || name === "explore";
  document.body.classList.toggle("hub-route", name === "dashboard");
  $(".hero").hidden = name !== "dashboard";
  $("#hub-view").hidden = name !== "dashboard";
  $("#dashboard-view").hidden = !collectionPage;
  $("#collection-notice").hidden = name !== "dashboard";
  $("#welcome-ribbon-dock").hidden = name !== "dashboard" || !$("#welcome-ribbon-dock").firstChild;
  $("#explore-tabs").hidden = !(name === "explore" || name === "upcoming");
  $("#claim-open").hidden = name !== "collection";
  for (const link of $("#explore-tabs").querySelectorAll("a")) {
    const target = parseRoute(link.hash, true);
    if (target.name === name && (name === "upcoming" || target.filter === parsed.filter)) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (collectionPage) {
    state.query.filter = parsed.filter;
    $("#collection-page-title").textContent = name === "explore" ? "Explore Veilings" : "My Collection";
    updateCollection();
  }
  $("#route-view").hidden =
    name === "dashboard" || collectionPage || name === "admin";
  $("#admin-view").hidden = name !== "admin" || !state.admin;
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.dataset.nav === name || (link.dataset.nav === "explore" && name === "upcoming")) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (name === "admin") {
    if (state.admin) {
      loadAdmin();
      document.title = "Veiling Studio · Spinarium — SpinDownGames™";
    } else {
      $("#route-view").hidden = false;
      const title = el("h2", "", "Admin access required");
      title.id = "route-title";
      $("#route-content").replaceChildren(
        title,
        el(
          "p",
          "",
          "Your account is not authorized to manage Veiling content.",
        ),
      );
    }
  } else if (name !== "dashboard" && !collectionPage)
    $("#route-content").replaceChildren(
      renderRoute(name, state.snapshot, state.capabilities),
    );
  if (name !== "admin") document.title = "Spinarium — SpinDownGames™";
  closeNavigation();
}
function openDialog(dialog, trigger) {
  dialog._returnFocus = trigger || document.activeElement;
  dialog.showModal();
}
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-dialog]")) dialog.close();
  });
  dialog.addEventListener("close", () => {
    if (
      dialog._returnFocus?.isConnected &&
      !dialog._returnFocus.closest("[hidden]")
    )
      dialog._returnFocus.focus({ preventScroll: true });
  });
}
$("#claim-form").addEventListener("submit", (event) => event.preventDefault());
$("#claim-open").addEventListener("click", (event) => {
  if (state.session) openDialog($("#claim-dialog"), event.currentTarget);
});
$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!auth.configured || state.authBusy) return;
  state.authBusy = true;
  $("#auth-fields").disabled = true;
  feedback("Please wait…");
  try {
    if (preview) await auth.signIn({
      email: $("#auth-email").value, password: $("#auth-password").value,
    });
    else if (authMode === "signup") await auth.signUp();
    else await auth.signIn();
  } catch (error) {
    feedback(
      preview
        ? "Preview login failed. Use admin and 1234."
        : error instanceof AuthError
        ? error.message
        : "The account service could not complete this request.",
      true,
    );
  } finally {
    clearPasswords();
    state.authBusy = false;
    $("#auth-fields").disabled = !auth.configured;
  }
});
$("#sign-out").addEventListener("click", async () => {
  try {
    await auth.signOut();
    feedback("You have signed out.");
  } catch {
    feedback(
      "You have signed out on this page. The account service could not confirm session revocation.",
    );
  }
});
$("#collection-search").addEventListener("input", (event) => {
  if (!state.snapshot) return;
  state.query.search = event.currentTarget.value;
  updateCollection();
});
$("#collection-sort").addEventListener("change", (event) => {
  if (!state.snapshot) return;
  state.query.sort = event.currentTarget.value;
  updateCollection();
});
$("#collection-filter").addEventListener("change", (event) => {
  if (!state.snapshot) return;
  const name = parseRoute(location.hash, true).name === "explore" ? "explore" : "collection";
  location.hash = name + "?filter=" + event.currentTarget.value;
});
$("#catalog-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.snapshot) return;
  state.query.search = $("#catalog-search").value;
  $("#collection-search").value = state.query.search;
  updateCollection();
  location.hash = "collection";
});
$("#collection-grid").addEventListener("click", (event) => {
  const card = event.target.closest("[data-card-id]");
  if (!card || !state.snapshot) return;
  state.selectedId = card.dataset.cardId;
  updateSelection();
  const detail = selectedDetail();
  if (mobile.matches && detail?.status === "owned") {
    $("#full-detail-content").replaceChildren(renderFullDetail(detail));
    openDialog($("#veiling-dialog"), card);
  }
});
$("#detail-panel").addEventListener("click", (event) => {
  const trigger = event.target.closest('[data-action="details"]');
  if (!trigger || !selectedDetail() || selectedDetail().status !== "owned")
    return;
  $("#full-detail-content").replaceChildren(renderFullDetail(selectedDetail()));
  openDialog($("#veiling-dialog"), trigger);
});
$("#navigation-toggle").addEventListener("click", () => {
  const open = $("#navigation-toggle").getAttribute("aria-expanded") !== "true";
  $("#sidebar-nav").classList.toggle("is-open", open);
  $("#sidebar-nav").inert = !open;
  $("#sidebar-nav").setAttribute("aria-hidden", String(!open));
  $("#navigation-toggle").setAttribute("aria-expanded", String(open));
  if (open) $("#sidebar-nav a").focus();
});
document.addEventListener("click", event => {
  if (!event.target.closest("#sidebar-nav, #navigation-toggle") && $("#sidebar-nav").classList.contains("is-open")) closeNavigation();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeNavigation(true);
});
mobile.addEventListener("change", navigationSize);
window.addEventListener("hashchange", () => {
  feedback("");
  route();
  if (state.session && state.snapshot) $("#main-content").focus({ preventScroll: true });
});

function renderAdminList(rows) {
  const fragment = document.createDocumentFragment();
  if (!rows.length)
    fragment.append(el("p", "", "No Veilings have been added yet."));
  for (const row of rows) {
    const button = el("button", "admin-catalog-item");
    button.type = "button";
    button.disabled = adminSaving;
    if (row.artworkUrl) {
      const thumbnail = el("img", "admin-artwork-thumbnail");
      thumbnail.src = row.artworkUrl;
      thumbnail.alt = "Artwork for " + row.name;
      thumbnail.width = 60;
      thumbnail.height = 80;
      thumbnail.loading = "lazy";
      button.append(thumbnail);
    }
    button.append(
      el("strong", "", row.name),
      el("span", "", row.status + " · " + (row.edition || "No edition")),
    );
    button.addEventListener("click", () => {
      if (adminSaving) return;
      $("#admin-id").value = row.id;
      adminRevision = row.revision ?? null;
      $("#admin-name").value = row.name;
      $("#admin-description").value = row.description;
      $("#admin-number").value = row.character_number ?? "";
      $("#admin-status").value = row.status;
      $("#admin-rarity").value = row.rarity ?? "";
      $("#admin-edition").value = row.edition ?? "";
      $("#admin-artwork").value = "";
      $("#admin-name").focus();
    });
    fragment.append(button);
  }
  $("#admin-list").replaceChildren(fragment);
}
async function loadAdmin() {
  if (!state.admin) return;
  const epoch = state.epoch;
  $("#admin-list").replaceChildren(el("p", "", "Opening catalog…"));
  try {
    const rows = await service.listAdminVeilings();
    if (epoch !== state.epoch || !state.admin) return;
    adminRows = rows;
    renderAdminList(rows);
  } catch {
    if (epoch === state.epoch)
      $("#admin-list").replaceChildren(
        el("p", "", "The catalog could not be loaded. Please try again."),
      );
  }
}
$("#admin-new").addEventListener("click", () => {
  if (adminSaving) return;
  $("#admin-form").reset();
  $("#admin-id").value = "";
  adminRevision = null;
  $("#admin-feedback").textContent = "";
  $("#admin-name").focus();
});
function setAdminBusy(busy) {
  adminSaving = busy;
  for (const control of $("#admin-form").querySelectorAll("input, textarea, select, button"))
    control.disabled = busy;
  for (const button of $("#admin-list").querySelectorAll("button")) button.disabled = busy;
}
$("#admin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.admin || adminSaving) return;
  const epoch = state.epoch;
  const file = $("#admin-artwork").files[0] || null;
  if (
    file &&
    (!["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 8 * 1024 * 1024)
  ) {
    $("#admin-feedback").textContent =
      "Choose a PNG, JPEG, or WebP image no larger than 8 MB.";
    return;
  }
  setAdminBusy(true);
  $("#admin-feedback").textContent = "Saving…";
  let saved = null;
  try {
    const input = {
      id: $("#admin-id").value || undefined,
      revision: adminRevision,
      name: $("#admin-name").value,
      description: $("#admin-description").value,
      number: $("#admin-number").value
        ? Number($("#admin-number").value)
        : null,
      status: $("#admin-status").value,
      rarity: $("#admin-rarity").value || null,
      edition: $("#admin-edition").value || null,
    };
    saved = await service.saveVeiling(input);
    if (epoch !== state.epoch) return;
    $("#admin-id").value = saved.id;
    adminRevision = saved.revision;
    if (file) {
      const uploaded = await service.uploadArtwork({ veilingId: saved.id, file, revision: saved.revision });
      if (epoch !== state.epoch) return;
      adminRevision = uploaded.revision;
    }
    if (epoch !== state.epoch) return;
    $("#admin-feedback").textContent =
      "Veiling saved. No collector ownership has been changed.";
    $("#admin-artwork").value = "";
    await loadAdmin();
  } catch (error) {
    if (epoch === state.epoch) {
      const stale = error?.code === "STALE_REVISION" || error?.code === "REVISION_REQUIRED";
      $("#admin-feedback").textContent = stale
        ? "This Veiling changed or needs to be reloaded. Select its current catalog entry before saving again."
        : error?.code === "NUMBER_IN_USE"
        ? "This character number is already in use. Choose another number."
        : saved
        ? "The description was saved, but artwork could not be attached. Please retry the upload."
        : "The Veiling could not be saved. No changes have been confirmed.";
      if (stale) await loadAdmin();
    }
  } finally {
    setAdminBusy(false);
  }
});
auth.onAuthStateChange(handleSession);
signedOutView();
setAuthMode(location.hash.slice(1));
try {
  const callback = await auth.consumeAuthCallback();
  if (!callback.handled) route();
} catch (error) {
  signedOutView();
  setAuthMode("signin");
  feedback(
    error instanceof AuthError
      ? error.message
      : "This account link could not be verified.",
    true,
  );
}
