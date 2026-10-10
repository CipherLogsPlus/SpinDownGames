import { spinariumConfig } from "./config.js";
import { createAuthClient, AuthError } from "./auth/cloudflare-auth.js";
import { createSpinariumService } from "./data/cloudflare-service.js";
import { createPreviewAccess } from "./data/preview-service.js";
import { createFirstLoginIntro } from "./components/first-login-intro.js";
import { createDashboardReveal } from "./components/dashboard-reveal.js";
import { createAdminAccountsController } from "./components/admin-accounts.js";
import { createOwnershipRecordController } from "./components/ownership-record.js";
import { createMemberShowcase } from "./components/member-showcase.js";
import { createVeilingStudio } from "./components/veiling-studio.js";
import { renderHomeHub } from "./components/home-hub.js";
import { parseRoute } from "./domain/routing.js";
import { createGuardedNavigation } from "./components/guarded-navigation.js";
import { createLatestLoader } from "./components/latest-loader.js";
import { getVeilingDetail, queryCollection, withUnavailableVeiling } from "./domain/collection.js";
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

// Fragment credentials remain in memory and are scrubbed before session reads.
let resetToken = null;
let resetLanding = false;
let resetComplete = false;
let resetBusy = false;
let resetRequest = null;
let navigation = null;
function captureResetLink() {
  if (!location.hash.startsWith("#reset-password=")) return;
  resetRequest?.abort();
  resetRequest = null;
  resetBusy = false;
  for (const fieldId of ["password-reset-password", "password-reset-confirm"])
    document.getElementById(fieldId).value = "";
  resetLanding = true;
  resetComplete = false;
  const match = /^#reset-password=([A-Za-z0-9_-]{43})$/.exec(location.hash);
  resetToken = match?.[1] || null;
  if (navigation) navigation.replace("#reset-password");
  else history.replaceState(null, "", location.pathname + location.search + "#reset-password");
}
captureResetLink();

// Preview is explicitly selected; provider failures never fall back to it.
const preview = spinariumConfig.previewEnabled === true;
const passwordProvider = !preview && spinariumConfig.authProvider === "password";
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
  adminRole: null,
  adminAvailability: "loading",
  authBusy: false,
  epoch: 0,
  query: { search: "", filter: "owned", sort: "number" },
};
const authRoutes = new Set(["signin", "signup", "reset", "update-password", "reset-password"]);
let authMode = "signin";
function protectedReturnRoute(hash) {
  const parsed = parseRoute(hash);
  const id = parsed.name === "ownership" ? parsed.ownershipId : parsed.name === "showcase" ? parsed.veilingId : null;
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? "#" + parsed.name + "/" + id.toLowerCase() : null;
}
let pendingProtectedRoute = protectedReturnRoute(location.hash);
const collectionReads = new Set();
const ownershipRecords = createOwnershipRecordController({
  root: $("#route-content"), service, getSession: () => auth.getSession(),
  onLoaded(detail) {
    if (detail.veiling.contentStatus !== "unavailable" || !state.snapshot) return;
    for (const invalidations of collectionReads) invalidations.add(detail.veiling.id);
    state.snapshot = withUnavailableVeiling(state.snapshot, detail.veiling.id);
    // Refresh hidden collection views too, so returning cannot revive old content.
    $("#full-detail-content").replaceChildren();
    updateCollection();
    $("#stats").replaceChildren(renderStats(state.snapshot));
    $("#dashboard-footer").replaceChildren(renderFooter(state.snapshot));
    $("#hub-view").replaceChildren(renderHomeHub(state.snapshot));
  },
});
const memberShowcase = createMemberShowcase({
  root: $("#route-content"), service, getSession: () => auth.getSession(),
  getOwnedIds: () => new Set(state.snapshot?.ownerships.filter(record => record.userId === state.session?.user.id).map(record => record.veilingId) || []),
});
const veilingStudio = createVeilingStudio({
  root: $("#veiling-studio-content"), service, getSession: () => auth.getSession(),
  onChanged() { memberShowcase.reset(); void loadCollection(); },
});
const accounts = createAdminAccountsController({
  root: $("#admin-accounts-content"), service,
  onAccessLost() {
    state.admin = false;
    state.adminRole = null;
    $("#admin-nav").hidden = true;
    $("#admin-accounts-nav").hidden = true;
    route();
  },
  async onProfileChanged(account) {
    if (account.id !== state.session?.user.id) return;
    // The session projection, rather than the editor draft, updates the header.
    try { await auth.getCurrentUser(); } catch { auth.invalidateSession?.(); }
  },
});
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
    ? "Create your Spinarium account. Your collection begins empty."
    : "Sign in with your email address and password to open your collection.";
  $("#auth-submit").textContent = signup ? "Create account" : "Sign in";
  const credentialsVisible = preview || passwordProvider;
  $("#auth-display-name-group").hidden = !signup;
  $("#auth-display-name").disabled = !signup;
  $("#auth-display-name").required = signup;
  $("#auth-email").closest(".auth-field").hidden = !credentialsVisible;
  $("#auth-email").disabled = !credentialsVisible;
  $("#auth-email").required = credentialsVisible;
  $("#auth-email").type = preview ? "text" : "email";
  $("#auth-email").maxLength = preview ? 320 : 254;
  $("label[for='auth-email']").textContent = preview ? "Username" : "Email address";
  $("#auth-password-group").hidden = !credentialsVisible;
  $("#auth-password").disabled = !credentialsVisible;
  $("#auth-password").required = credentialsVisible;
  $("#auth-password").minLength = passwordProvider ? 15 : 1;
  $("#auth-password").maxLength = passwordProvider ? 256 : 4096;
  $("#auth-password").autocomplete = signup ? "new-password" : "current-password";
  $("#auth-password-hint").hidden = !signup;
  if (signup) $("#auth-password").setAttribute("aria-describedby", "auth-password-hint");
  else $("#auth-password").removeAttribute("aria-describedby");
  $("#auth-confirm-group").hidden = !signup;
  $("#auth-confirm-password").disabled = !signup;
  $("#auth-confirm-password").required = signup;
  $("#auth-confirm-password").maxLength = passwordProvider ? 256 : 4096;
  $("#auth-recovery-note").hidden = !passwordProvider;
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
      document.createTextNode(signup ? "By creating an account, you agree to the " : "By signing in, you agree to the "),
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
  accounts.reset();
  ownershipRecords.reset();
  memberShowcase.reset();
  veilingStudio.reset();
  collectionReads.clear();
  collectionLoader.reset();
  adminLoader.reset();
  state.adminAvailability = "loading";
  $("#admin-access-status").hidden = true;
  firstLoginIntro.reset();
  state.snapshot = null;
  state.selectedId = null;
  state.admin = false;
  state.adminRole = null;
  $("#signed-in-account-id").value = "";
  $("#account-id-feedback").textContent = "";
  state.query = { search: "", filter: "owned", sort: "number" };
  $("#collection-search").value = "";
  $("#catalog-search").value = "";
  $("#collection-sort").value = "number";
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
    "admin-accounts-nav",
    "admin-accounts-view",
    "password-reset-view",
    "signed-in-account",
  ])
    $("#" + id).hidden = true;
  $("#profile-name").textContent = "Collector";
  navigationSize();
}
function resetView() {
  signedOutView();
  for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  $("#auth-view").hidden = true;
  $("#guest-tools").hidden = true;
  $("#password-reset-view").hidden = false;
  $("#navigation-toggle").hidden = true;
  $("#password-reset-signin").textContent = state.session && !resetComplete ? "Return to your Spinarium" : "Return to sign in";
  $("#password-reset-signin").href = state.session && !resetComplete ? "#dashboard" : "#signin";
  $("#password-reset-fields").disabled = resetBusy || resetComplete || !resetToken || !auth.configured || !passwordProvider;
  if (!resetComplete && !resetBusy && (!resetToken || !auth.configured || !passwordProvider)) {
    $("#password-reset-feedback").textContent = !auth.configured || !passwordProvider
      ? "Password reset is unavailable on this page."
      : "This reset link is invalid or has expired. Ask an administrator for a new link.";
  }
  document.title = "Reset password · Spinarium — SpinDownGames™";
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
    : state.query.search.trim()
      ? "No Veilings match your search."
      : "Your collection is empty. No Veilings have been added.";
  updateSelection();
}
function showCollectionError() {
  if (!state.snapshot) {
    $("#dashboard-view").hidden = true;
    $("#route-view").hidden = true;
  }
  $("#loading-status").hidden = false;
  $("#loading-status").className = "error-message";
  const retry = el("button", "outlined-button", "Try again");
  retry.type = "button";
  retry.addEventListener("click", loadCollection);
  $("#loading-status").replaceChildren(
    el("p", "", state.snapshot
      ? "We couldn’t refresh your collection. The last loaded collection is still shown. Try again to get the latest changes."
      : "Your account is signed in. The collection service is not available yet. No sample collection has been substituted."),
    retry,
  );
}
const readIdentity = () => state.session && state.session.flow !== "recovery" && auth.getSession() === state.session ? state.session : null;
const collectionLoader = createLatestLoader({
  getIdentity: readIdentity,
  onStart() {
    $("#loading-status").hidden = false;
    $("#loading-status").className = "";
    $("#loading-status").textContent = state.snapshot ? "Refreshing your collection…" : "Opening your collection…";
  },
  async read({ signal }) {
    const unavailableSinceStart = new Set();
    collectionReads.add(unavailableSinceStart);
    signal.addEventListener("abort", () => collectionReads.delete(unavailableSinceStart), { once: true });
    try {
      let snapshot = await service.getDashboard({ signal });
      // A newer record response also invalidates older dashboard reads in flight.
      for (const id of unavailableSinceStart) snapshot = withUnavailableVeiling(snapshot, id);
      return snapshot;
    } finally { collectionReads.delete(unavailableSinceStart); }
  },
  onSuccess(snapshot) {
    state.snapshot = snapshot;
    state.capabilities = service.getCapabilities();
    $("#stats").replaceChildren(renderStats(snapshot));
    $("#dashboard-footer").replaceChildren(renderFooter(snapshot));
    $("#hub-view").replaceChildren(renderHomeHub(snapshot));
    updateCollection();
    $("#loading-status").hidden = true;
    route();
  },
  onError: showCollectionError,
});
function showAdminAvailability() {
  $("#admin-nav").hidden = !state.admin;
  $("#admin-accounts-nav").hidden = !state.admin;
  const status = $("#admin-access-status");
  status.hidden = state.adminAvailability !== "unavailable";
  status.replaceChildren();
  if (!status.hidden) {
    const retry = el("button", "outlined-button", "Retry admin access");
    retry.type = "button";
    retry.addEventListener("click", () => void adminLoader.load());
    status.append(el("p", "", "Admin tools could not be checked. Your personal collection is still available."), retry);
  }
  if (state.snapshot) route();
}
const adminLoader = createLatestLoader({
  getIdentity: readIdentity,
  onStart() { state.adminAvailability = "loading"; showAdminAvailability(); },
  read: ({ signal }) => service.getAdminContext ? service.getAdminContext({ signal }) : Promise.resolve({ admin: false, role: null }),
  onSuccess(context) {
    state.admin = context.admin === true;
    state.adminRole = state.admin ? context.role : null;
    state.adminAvailability = "ready";
    showAdminAvailability();
  },
  onError() {
    state.admin = false;
    state.adminRole = null;
    state.adminAvailability = "unavailable";
    showAdminAvailability();
  },
});
function loadCollection() { return collectionLoader.load(); }
async function handleSession(session) {
  if (state.session && (!session || session.user.id !== state.session.user.id)) pendingProtectedRoute = null;
  const epoch = ++state.epoch;
  state.session = session;
  clearPrivateViews();
  if (resetLanding && location.hash === "#reset-password") {
    resetView();
    return;
  }
  if (!session) {
    signedOutView();
    setAuthMode("signin");
    if (!authRoutes.has(location.hash.slice(1)))
      navigation.replace("#signin");
    return;
  }
  if (session.flow === "recovery") {
    signedOutView();
    setAuthMode("update-password");
    navigation.replace("#update-password");
    return;
  }
  if (firstLoginIntro.show()) {
    // Keep login beneath the fade-to-black before revealing the layout.
    await new Promise(resolve => setTimeout(resolve, 400));
    if (epoch !== state.epoch || !auth.getSession()) return;
  }
  document.body.classList.remove("auth-gated");
  $("#auth-view").hidden = true;
  $("#password-reset-view").hidden = true;
  $("#guest-tools").hidden = true;
  $("#account-tools").hidden = false;
  $("#sidebar-nav").hidden = false;
  $("#collection-notice").hidden = false;
  $("#claim-open").hidden = false;
  $("#profile-name").textContent = session.user.displayName || session.user.email;
  if (preview) $("#collection-notice").textContent = "Static preview · No real account, ownership, or backend actions are connected.";
  navigationSize();
  if (authRoutes.has(location.hash.slice(1)) || !location.hash)
    navigation.replace(pendingProtectedRoute || "#dashboard");
  pendingProtectedRoute = null;
  void adminLoader.load();
  void loadCollection();
}
function route() {
  const parsed = parseRoute(navigation.hash, Boolean(state.session));
  const requested = parsed.name;
  if (requested !== "ownership" || !state.session || resetLanding) ownershipRecords.reset();
  if (!["explore", "upcoming", "showcase"].includes(requested) || !state.session || resetLanding) memberShowcase.reset();
  if (requested !== "admin" || !state.session || resetLanding) veilingStudio.reset();
  if (requested === "reset-password") {
    pendingProtectedRoute = null;
    resetLanding = true;
    accounts.reset();
    resetView();
    return;
  }
  if (resetLanding) {
    resetRequest?.abort();
    resetRequest = null;
    resetBusy = false;
    resetLanding = false;
    resetToken = null;
    resetComplete = false;
    $("#password-reset-password").value = "";
    $("#password-reset-confirm").value = "";
    $("#password-reset-feedback").textContent = "";
    if (state.session) {
      document.body.classList.remove("auth-gated");
      $("#auth-view").hidden = true;
      $("#guest-tools").hidden = true;
      $("#account-tools").hidden = false;
      $("#sidebar-nav").hidden = false;
      $("#admin-nav").hidden = !state.admin;
      $("#admin-accounts-nav").hidden = !state.admin;
      navigationSize();
    }
  }
  $("#password-reset-view").hidden = true;
  if (!state.session || state.session.flow === "recovery") {
    if (["ownership", "showcase"].includes(requested) && !state.session) pendingProtectedRoute = protectedReturnRoute(location.hash);
    signedOutView();
    setAuthMode(
      state.session?.flow === "recovery" ? "update-password" : requested,
    );
    if (!authRoutes.has(requested))
      navigation.replace("#signin");
    return;
  }
  if (!state.snapshot) {
    if (!collectionLoader.loading) void loadCollection();
    return;
  }
  const name = authRoutes.has(requested) ? "dashboard" : requested;
  const collectionPage = name === "collection";
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
    state.query.filter = "owned";
    $("#collection-page-title").textContent = name === "explore" ? "Explore Veilings" : "My Collection";
    updateCollection();
  }
  $("#route-view").hidden =
    name === "dashboard" || collectionPage || name === "admin" || name === "accounts";
  $("#admin-view").hidden = name !== "admin" || !state.admin;
  $("#admin-accounts-view").hidden = name !== "accounts" || !state.admin;
  $("#signed-in-account").hidden = name !== "settings";
  if (name === "settings") $("#signed-in-account-id").value = state.session.user.id;
  if (name !== "accounts") accounts.reset();
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.dataset.nav === name || (link.dataset.nav === "explore" && ["upcoming", "showcase"].includes(name))) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (name === "accounts") {
    if (state.admin) {
      accounts.open({ actorId: state.session.user.id, actorRole: state.adminRole });
      document.title = "Accounts · Spinarium — SpinDownGames™";
    } else {
      accounts.reset();
      $("#route-view").hidden = false;
      const title = el("h2", "", state.adminAvailability === "ready" ? "Admin access required" : "Checking admin access");
      title.id = "route-title";
      $("#route-content").replaceChildren(title, el("p", "", state.adminAvailability === "ready" ? "Your account is not authorized to view or manage accounts." : "Admin tools are unavailable until your access can be verified."));
    }
  } else if (name === "ownership") {
    const detailDialog = $("#veiling-dialog");
    detailDialog._returnFocus = null;
    if (detailDialog.open) detailDialog.close();
    void ownershipRecords.open({ id: parsed.ownershipId, identity: state.session });
  } else if (["explore", "upcoming", "showcase"].includes(name)) {
    void memberShowcase.open({ identity: state.session, id: name === "showcase" ? parsed.veilingId : null, upcoming: name === "upcoming", unowned: parsed.filter === "unowned" });
  } else if (name === "admin") {
    if (state.admin) {
      void veilingStudio.open({ identity: state.session });
      document.title = "Veiling Studio · Spinarium — SpinDownGames™";
    } else {
      // Capability loss is an authorization boundary, not a voluntary leave.
      veilingStudio.reset();
      $("#route-view").hidden = false;
      const title = el("h2", "", state.adminAvailability === "ready" ? "Admin access required" : "Checking admin access");
      title.id = "route-title";
      $("#route-content").replaceChildren(
        title,
        el(
          "p",
          "",
          state.adminAvailability === "ready" ? "Your account is not authorized to manage Veiling content." : "Admin tools are unavailable until your access can be verified.",
        ),
      );
    }
  } else if (name !== "dashboard" && !collectionPage)
    $("#route-content").replaceChildren(
      renderRoute(name, state.snapshot, state.capabilities),
    );
  if (name !== "admin" && name !== "accounts") document.title = (name === "ownership" ? "Ownership record · " : "") + "Spinarium — SpinDownGames™";
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
  const accountDetails = {
    email: $("#auth-email").value,
    password: $("#auth-password").value,
    ...(authMode === "signup" ? { displayName: $("#auth-display-name").value } : {}),
  };
  if (authMode === "signup" && accountDetails.password !== $("#auth-confirm-password").value) {
    clearPasswords();
    feedback("The passwords do not match. Please enter them again.", true);
    return;
  }
  state.authBusy = true;
  $("#auth-fields").disabled = true;
  feedback("Please wait…");
  try {
    if (authMode === "signup") await auth.signUp(accountDetails);
    else await auth.signIn(accountDetails);
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
    accountDetails.password = "";
    clearPasswords();
    state.authBusy = false;
    $("#auth-fields").disabled = !auth.configured;
  }
});
async function signOut() {
  pendingProtectedRoute = null;
  try {
    await auth.signOut();
    feedback("You have signed out.");
  } catch {
    feedback(
      "You have signed out on this page. The account service could not confirm session revocation.",
    );
  }
}
let signOutPending = false;
async function requestSignOut() {
  if (signOutPending) return;
  signOutPending = true;
  try { await navigation.confirm(signOut); }
  finally { signOutPending = false; }
}
$("#sign-out").addEventListener("click", requestSignOut);
$("#menu-sign-out").addEventListener("click", requestSignOut);
$("#copy-account-id").addEventListener("click", async () => {
  const accountId = state.session?.user.id;
  if (!accountId) return;
  try {
    await navigator.clipboard.writeText(accountId);
    if (state.session?.user.id === accountId) $("#account-id-feedback").textContent = "Account ID copied.";
  } catch {
    if (state.session?.user.id !== accountId) return;
    $("#signed-in-account-id").focus();
    $("#signed-in-account-id").select();
    $("#account-id-feedback").textContent = "Select and copy your account ID.";
  }
});
$("#password-reset-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (resetBusy || !resetToken || !auth.configured || !passwordProvider) return;
  let password = $("#password-reset-password").value;
  const clear = () => {
    $("#password-reset-password").value = "";
    $("#password-reset-confirm").value = "";
  };
  if (password !== $("#password-reset-confirm").value) {
    password = "";
    clear();
    $("#password-reset-feedback").textContent = "The passwords do not match. Please enter them again.";
    return;
  }
  resetBusy = true;
  const token = resetToken;
  const controller = new AbortController();
  resetRequest = controller;
  $("#password-reset-fields").disabled = true;
  $("#password-reset-feedback").textContent = "Saving your new password…";
  try {
    await auth.resetPassword({ token, password, signal: controller.signal });
    if (controller.signal.aborted || resetRequest !== controller) return;
    resetToken = null;
    resetComplete = true;
    clearPrivateViews();
    state.session = null;
    if (resetLanding && location.hash === "#reset-password") {
      resetView();
      $("#password-reset-feedback").textContent = "Your password has been changed. Return to sign in with your new password.";
    }
  } catch (error) {
    if (!controller.signal.aborted && resetRequest === controller && resetToken === token && resetLanding) {
      if (error?.code === "PASSWORD_RESET_UNAVAILABLE") resetToken = null;
      $("#password-reset-feedback").textContent = error instanceof AuthError
        ? error.message : "The password could not be reset. Please try again.";
    }
  } finally {
    password = "";
    if (resetRequest === controller) {
      clear();
      resetRequest = null;
      resetBusy = false;
      if (resetLanding) $("#password-reset-fields").disabled = resetComplete || !resetToken || !auth.configured;
    }
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
navigation = createGuardedNavigation({
  window,
  canLeave: veilingStudio.canLeave,
  onStay: veilingStudio.cancelLeave,
  onRoute() {
    if (!["ownership", "showcase", "signin", "signup"].includes(parseRoute(navigation.hash).name)) pendingProtectedRoute = null;
    captureResetLink();
    feedback("");
    route();
    if (state.session && state.snapshot) $("#main-content").focus({ preventScroll: true });
  },
});
$(".skip-link").addEventListener("click", event => {
  event.preventDefault();
  $("#main-content").focus({ preventScroll: true });
  $("#main-content").scrollIntoView({ block: "start" });
});
// Same-tab links outside the hash router get the same save/discard choice.
// New tabs leave this document and its draft intact.
document.addEventListener("click", event => {
  const link = event.target.closest("a[href]");
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      !link || link.hasAttribute("download") || (link.target && link.target !== "_self") || !veilingStudio.hasPendingChanges()) return;
  const target = new URL(link.href, location.href);
  if (target.origin === location.origin && target.pathname === location.pathname && target.search === location.search) return;
  event.preventDefault();
  void navigation.confirm(() => location.assign(target.href));
});
window.addEventListener("beforeunload", event => {
  if (!veilingStudio.hasPendingChanges()) return;
  event.preventDefault();
  event.returnValue = "";
});

auth.onAuthStateChange(handleSession);
signedOutView();
setAuthMode(location.hash.slice(1));
if (resetLanding || location.hash === "#reset-password") {
  resetLanding = true;
  resetView();
} else try {
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
