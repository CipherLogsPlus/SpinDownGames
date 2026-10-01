import { spinariumConfig } from "./config.js";
import { createAuthClient, AuthError } from "./auth/supabase-auth.js";
import { createSpinariumService } from "./data/supabase-service.js";
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

// Composition root. The live entry never imports the demonstration adapter.
const auth = createAuthClient(spinariumConfig);
const service = createSpinariumService(spinariumConfig, auth);
const $ = (selector) => document.querySelector(selector);
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
  $("#navigation-toggle").setAttribute("aria-expanded", "false");
  if (restore) $("#navigation-toggle").focus();
}
function navigationSize() {
  $("#navigation-toggle").hidden =
    !state.session || state.session.flow === "recovery" || !mobile.matches;
  closeNavigation();
}
function setAuthMode(mode) {
  authMode = authRoutes.has(mode) ? mode : "signin";
  if (authMode === "update-password" && state.session?.flow !== "recovery")
    authMode = "signin";
  const signup = authMode === "signup";
  const reset = authMode === "reset";
  const recovery = authMode === "update-password";
  $("#auth-title").textContent = signup
    ? "Begin your Spinarium"
    : reset
      ? "Reset your password"
      : recovery
        ? "Choose a new password"
        : "Enter your Spinarium";
  $("#auth-description").textContent = signup
    ? "Create an account. Your collection begins empty; no Veilings are granted automatically."
    : reset
      ? "Request a secure password-reset link by email."
      : recovery
        ? "Use a new password with at least 12 characters."
        : "Sign in to your personal collection, or create an account to begin.";
  $("#auth-submit").textContent = signup
    ? "Create account"
    : reset
      ? "Send reset link"
      : recovery
        ? "Save new password"
        : "Sign in";
  $("#auth-email").closest(".auth-field").hidden = recovery;
  $("#auth-email").disabled = recovery;
  $("#auth-password-group").hidden = reset;
  $("#auth-password").disabled = reset;
  $("#auth-password").required = !reset;
  $("#auth-password").minLength = signup || recovery ? 12 : 1;
  $("#auth-password").autocomplete =
    signup || recovery ? "new-password" : "current-password";
  $("#auth-confirm-group").hidden = !(signup || recovery);
  $("#auth-confirm-password").disabled = !(signup || recovery);
  $("#auth-confirm-password").required = signup || recovery;
  $("#forgot-password").hidden = authMode !== "signin";
  $("#auth-fields").disabled = !auth.configured || state.authBusy;
  $("#auth-availability").hidden = auth.configured;
  for (const [selector, active] of [
    ["#signin-tab", authMode === "signin"],
    ["#signup-tab", signup],
  ]) {
    if (active) $(selector).setAttribute("aria-current", "page");
    else $(selector).removeAttribute("aria-current");
  }
  document.title =
    (signup
      ? "Create account"
      : reset || recovery
        ? "Reset password"
        : "Sign in") + " · Spinarium — SpinDownGames™";
  clearPasswords();
}
function clearPrivateViews() {
  state.snapshot = null;
  state.selectedId = null;
  state.admin = false;
  state.query = { search: "", filter: "owned", sort: "number" };
  $("#collection-search").value = "";
  $("#catalog-search").value = "";
  $("#collection-sort").value = "number";
  adminRows = [];
  $("#admin-form").reset();
  $("#admin-list").replaceChildren();
  for (const id of [
    "stats",
    "collection-grid",
    "detail-panel",
    "dashboard-footer",
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
    "route-view",
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
  $("#detail-panel").replaceChildren(renderDetail(selectedDetail()));
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
  $("#collection-status").textContent = entries.length
    ? entries.length + " Veilings in this view"
    : "Your collection is empty. No Veilings have been added.";
  $("#collection-filter")
    .querySelectorAll("button")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.filter === state.query.filter),
      ),
    );
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
    state.selectedId = snapshot.veilings[0]?.id ?? null;
    $("#stats").replaceChildren(renderStats(snapshot));
    $("#dashboard-footer").replaceChildren(renderFooter(snapshot));
    updateCollection();
    updateSelection();
    $("#admin-nav").hidden = !state.admin;
    $("#loading-status").hidden = true;
    route();
  } catch {
    if (epoch === state.epoch && auth.getSession()) showCollectionError();
  }
}
function handleSession(session) {
  state.epoch++;
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
  document.body.classList.remove("auth-gated");
  $("#auth-view").hidden = true;
  $("#guest-tools").hidden = true;
  $("#account-tools").hidden = false;
  $("#sidebar-nav").hidden = false;
  $("#collection-notice").hidden = false;
  $("#claim-open").hidden = false;
  $("#profile-name").textContent = session.user.email;
  navigationSize();
  if (authRoutes.has(location.hash.slice(1)) || !location.hash)
    history.replaceState(null, "", "#dashboard");
  loadCollection();
}
function route() {
  const requested =
    location.hash.slice(1) || (state.session ? "dashboard" : "signin");
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
  $("#dashboard-view").hidden = !(
    name === "dashboard" || name === "collection"
  );
  $("#route-view").hidden =
    name === "dashboard" || name === "collection" || name === "admin";
  $("#admin-view").hidden = name !== "admin" || !state.admin;
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.dataset.nav === name) link.setAttribute("aria-current", "page");
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
  } else if (name !== "dashboard" && name !== "collection")
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
  const email = $("#auth-email").value;
  const password = $("#auth-password").value;
  if (
    (authMode === "signup" || authMode === "update-password") &&
    password !== $("#auth-confirm-password").value
  ) {
    feedback("The passwords do not match.", true);
    return;
  }
  const mode = authMode;
  state.authBusy = true;
  $("#auth-fields").disabled = true;
  feedback("Please wait…");
  try {
    if (mode === "signup") {
      const result = await auth.signUp({ email, password });
      feedback(
        result.confirmationRequired
          ? "Check your email for a confirmation link before signing in."
          : "Your account is ready.",
      );
    } else if (mode === "reset") {
      await auth.requestPasswordReset({ email });
      feedback(
        "If an account matches that email, a password-reset link will be sent.",
      );
    } else if (mode === "update-password") {
      await auth.updatePassword({ password });
      feedback("Your password has been updated. Please sign in.");
    } else await auth.signIn({ email, password });
  } catch (error) {
    feedback(
      error instanceof AuthError
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
$("#collection-filter").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button || !state.snapshot) return;
  state.query.filter = button.dataset.filter;
  updateCollection();
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
  $("#navigation-toggle").setAttribute("aria-expanded", String(open));
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeNavigation(true);
});
mobile.addEventListener("change", navigationSize);
window.addEventListener("hashchange", () => {
  feedback("");
  route();
});

function renderAdminList(rows) {
  const fragment = document.createDocumentFragment();
  if (!rows.length)
    fragment.append(el("p", "", "No Veilings have been added yet."));
  for (const row of rows) {
    const button = el("button", "admin-catalog-item");
    button.type = "button";
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
      $("#admin-id").value = row.id;
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
  $("#admin-form").reset();
  $("#admin-id").value = "";
  $("#admin-feedback").textContent = "";
  $("#admin-name").focus();
});
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
  adminSaving = true;
  $("#admin-save").disabled = true;
  $("#admin-feedback").textContent = "Saving…";
  let saved = null;
  try {
    const input = {
      id: $("#admin-id").value || undefined,
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
    if (file) await service.uploadArtwork({ veilingId: saved.id, file });
    if (epoch !== state.epoch) return;
    $("#admin-feedback").textContent =
      "Veiling saved. No collector ownership has been changed.";
    $("#admin-artwork").value = "";
    await loadAdmin();
  } catch {
    if (epoch === state.epoch)
      $("#admin-feedback").textContent = saved
        ? "The description was saved, but artwork could not be attached. Please retry the upload."
        : "The Veiling could not be saved. No changes have been confirmed.";
  } finally {
    adminSaving = false;
    $("#admin-save").disabled = false;
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
