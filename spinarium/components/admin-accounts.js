import { el } from "./views.js";

const PAGE_SIZE = 50;
const DETAIL_PAGE_SIZE = 25;
const formatCount = new Intl.NumberFormat("en-US");
const formatDate = new Intl.DateTimeFormat("en-US", {
  year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
});
const formatTimestamp = new Intl.DateTimeFormat("en-US", {
  year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});
function date(value) {
  if (!value) return "Never";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unavailable" : formatDate.format(parsed);
}
function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? formatCount.format(value) : "—";
}
function timestamp(value) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unavailable" : `${formatTimestamp.format(parsed)} UTC`;
}
function textError(value, maximum) {
  if (!value.trim()) return "Enter a value.";
  if (Array.from(value.trim()).length > maximum) return `Use ${maximum} characters or fewer.`;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value) || /[\uD800-\uDFFF]/u.test(value))
    return "Use valid text without line breaks or control characters.";
  return "";
}
function button(label, id, className = "outlined-button") {
  const node = el("button", className, label);
  node.type = "button";
  if (id) node.id = id;
  return node;
}
function field(label, input) {
  const wrapper = el("div", "auth-field");
  const caption = el("label", "", label);
  caption.htmlFor = input.id;
  wrapper.append(caption, input);
  return wrapper;
}
function select(id, choices) {
  const node = el("select");
  node.id = id;
  for (const [value, label] of choices) {
    const option = el("option", "", label);
    option.value = value;
    node.append(option);
  }
  return node;
}
function feedback(id) {
  const node = el("p", "accounts-feedback");
  node.id = id;
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  return node;
}
function badge(label, kind) {
  return el("span", `accounts-badge accounts-badge-${kind}`, label);
}
function pager(prefix) {
  const node = el("div", "accounts-pager");
  const previous = button("Previous", `${prefix}-previous`);
  const label = el("span", "accounts-page-label", "Page 1");
  const next = button("Next", `${prefix}-next`);
  previous.disabled = true;
  next.disabled = true;
  node.append(previous, label, next);
  return { node, previous, label, next };
}
function metadata(items) {
  const node = el("dl", "accounts-metadata");
  for (const [label, value] of items) {
    const row = el("div");
    row.append(el("dt", "", label), el("dd", "", value));
    node.append(row);
  }
  return node;
}
function emptyPage() {
  return { cursor: null, previous: [], nextCursor: null, loaded: false, loading: false, items: [] };
}

/**
 * Account administration is a view over protected service methods. A browser
 * control never grants authority. reset() aborts requests and removes all
 * account data when the host app changes identity or signs out.
 */
export function createAdminAccountsController({ root, service, onAccessLost = () => {}, onProfileChanged = () => {} }) {
  root.classList.add("admin-accounts");
  let epoch = 0;
  let actorId = null;
  let actorRole = null;
  let active = false;
  let destroyed = false;
  let selected = null;
  let selectedId = null;
  let detailLoading = false;
  let mutationPending = false;
  let confirmation = null;
  let draft = null;
  let resetLink = null;
  let resetLinkTimer = null;
  let tab = "collection";
  let query = { search: "", status: "all", role: "all" };
  let directory = emptyPage();
  let collection = emptyPage();
  let history = emptyPage();
  const requests = new Map();

  const header = el("div", "accounts-heading");
  const headingCopy = el("div");
  headingCopy.append(el("p", "eyebrow", "Protected account administration"));
  const title = el("h2", "", "Accounts");
  title.id = "accounts-title";
  title.tabIndex = -1;
  headingCopy.append(title, el("p", "accounts-intro", "Find a collector, review their account, and manage access."));
  const refresh = button("Refresh", "accounts-refresh");
  header.append(headingCopy, refresh);

  const overview = el("div", "accounts-overview");
  overview.setAttribute("aria-label", "Account overview");
  const overviewValues = new Map();
  for (const [key, label] of [["total", "Total accounts"], ["active", "Active"], ["disabled", "Disabled"], ["admins", "Administrators"], ["owners", "Owners"]]) {
    const card = el("div", "accounts-stat");
    const value = el("strong", "", "—");
    overviewValues.set(key, value);
    card.append(value, el("span", "", label));
    overview.append(card);
  }
  const overviewNotice = feedback("accounts-overview-feedback");

  const filters = el("form", "accounts-filters");
  filters.setAttribute("aria-label", "Filter accounts");
  const search = el("input");
  search.type = "search";
  search.id = "accounts-search";
  search.maxLength = 254;
  search.autocomplete = "off";
  search.spellcheck = false;
  search.placeholder = "Email, display name, or UUID";
  const searchKind = select("accounts-search-kind", [["email", "Email prefix"], ["name", "Display name prefix"], ["id", "Exact UUID"]]);
  const searchField = field("Search accounts", search);
  searchField.classList.add("accounts-search-field");
  const hint = el("span", "accounts-field-hint", "Choose a field to search. Names and emails match from the beginning.");
  hint.id = "accounts-search-hint";
  search.setAttribute("aria-describedby", hint.id);
  searchField.append(hint);
  const status = select("accounts-status-filter", [["all", "All statuses"], ["active", "Active"], ["disabled", "Disabled"]]);
  const role = select("accounts-role-filter", [["all", "All roles"], ["collector", "Collector"], ["admin", "Administrator"], ["owner", "Owner"]]);
  const searchSubmit = button("Search", "accounts-search-submit");
  searchSubmit.type = "submit";
  filters.append(field("Search by", searchKind), searchField, field("Status", status), field("Role", role), searchSubmit);

  const notice = feedback("accounts-feedback");
  const layout = el("div", "accounts-layout");
  const directoryPanel = el("section", "accounts-directory");
  const directoryHeading = el("div", "accounts-section-heading");
  const directoryTitle = el("h3", "", "Account directory");
  directoryTitle.id = "accounts-directory-title";
  directoryPanel.setAttribute("aria-labelledby", directoryTitle.id);
  const resultLabel = el("span", "accounts-result-label", "50 accounts per page");
  directoryHeading.append(directoryTitle, resultLabel);
  const list = el("div", "accounts-list");
  list.id = "accounts-list";
  const listPager = pager("accounts");
  directoryPanel.append(directoryHeading, list, listPager.node);
  const detail = el("section", "accounts-detail");
  detail.id = "accounts-detail";
  detail.setAttribute("aria-label", "Selected account");
  layout.append(directoryPanel, detail);

  const dialog = el("dialog", "modal accounts-confirm-dialog");
  dialog.id = "accounts-confirm-dialog";
  dialog.setAttribute("aria-labelledby", "accounts-confirm-title");
  dialog.setAttribute("aria-describedby", "accounts-confirm-description");
  const confirmTitle = el("h2");
  confirmTitle.id = "accounts-confirm-title";
  const confirmDescription = el("p");
  confirmDescription.id = "accounts-confirm-description";
  const confirmAccount = el("p", "accounts-confirm-account");
  const confirmForm = el("form");
  const reason = el("textarea");
  reason.id = "accounts-action-reason";
  reason.rows = 3;
  reason.maxLength = 1000;
  reason.required = true;
  reason.addEventListener("input", () => reason.setCustomValidity(""));
  const reasonField = field("Reason for this change", reason);
  const reasonHint = el("span", "accounts-field-hint", "Required. Saved in this account’s administration history. Up to 500 characters.");
  reasonHint.id = "accounts-reason-hint";
  reason.setAttribute("aria-describedby", reasonHint.id);
  reasonField.append(reasonHint);
  const consentLabel = el("label", "accounts-confirm-check");
  const consent = el("input");
  consent.type = "checkbox";
  consent.id = "accounts-action-confirmed";
  consent.required = true;
  const consentText = el("span");
  consentLabel.append(consent, consentText);
  const confirmNotice = feedback("accounts-confirm-feedback");
  const confirmActions = el("div", "accounts-confirm-actions");
  const cancel = button("Cancel", "accounts-confirm-cancel");
  const confirmSubmit = button("Confirm change", "accounts-confirm-submit");
  confirmSubmit.type = "submit";
  confirmActions.append(cancel, confirmSubmit);
  confirmForm.append(reasonField, consentLabel, confirmNotice, confirmActions);
  dialog.append(el("p", "eyebrow", "Review account change"), confirmTitle, confirmDescription, confirmAccount, confirmForm);
  root.replaceChildren(header, overview, overviewNotice, filters, notice, layout, dialog);

  function setNotice(node, message = "", error = false) {
    node.textContent = message;
    node.classList.toggle("is-error", error);
  }
  function startRequest(key) {
    requests.get(key)?.abort();
    const controller = new AbortController();
    requests.set(key, controller);
    return { controller, token: epoch, key };
  }
  function current(request) {
    return active && !destroyed && request.token === epoch && !request.controller.signal.aborted && requests.get(request.key) === request.controller;
  }
  function finishRequest(request) {
    if (requests.get(request.key) === request.controller) requests.delete(request.key);
  }
  function handleFailure(error, request, node) {
    if (!current(request) || error?.code === "CANCELLED" || error?.name === "AbortError") return;
    if (["AUTH_REQUIRED", "ACCESS_DENIED"].includes(error?.code)) {
      reset();
      onAccessLost(error);
      return;
    }
    setNotice(node, error?.message || "The account service could not complete this request. Try again.", true);
  }
  function closeConfirmation() {
    if (dialog.open) dialog.close();
    confirmation = null;
    reason.value = "";
    consent.checked = false;
    setNotice(confirmNotice);
  }
  function canManage(account, capability) {
    const permission = ({ profile: "editProfile", status: "setStatus", revokeSessions: "revokeSessions", passwordReset: "resetPassword", role: "setRole" })[capability];
    if (account.permissions?.[permission] !== true) return false;
    if (account.role === "owner" && !(capability === "profile" && account.id === actorId)) return false;
    if (capability !== "profile" && account.id === actorId) return false;
    if (account.role === "admin" && actorRole !== "owner" && account.id !== actorId) return false;
    if (capability === "role" && actorRole !== "owner") return false;
    if (capability === "passwordReset" && (account.disabled || account.passwordAccount !== true)) return false;
    return true;
  }
  function roleLabel(value) {
    return value === "owner" ? "Owner" : value === "admin" ? "Administrator" : "Collector";
  }
  function clearResetLink() {
    if (resetLinkTimer !== null) globalThis.clearTimeout(resetLinkTimer);
    resetLinkTimer = null;
    resetLink = null;
    detail.querySelector("#accounts-reset-link-panel")?.remove();
  }
  function invalidateRecords() {
    for (const key of ["collection", "history"]) {
      requests.get(key)?.abort();
      requests.delete(key);
    }
    collection = emptyPage();
    history = emptyPage();
  }
  function renderResetLink() {
    if (!resetLink || resetLink.id !== selectedId) return;
    const expiry = new Date(resetLink.expiresAt).getTime();
    const remaining = expiry - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return clearResetLink();
    if (resetLinkTimer !== null) globalThis.clearTimeout(resetLinkTimer);
    resetLinkTimer = globalThis.setTimeout(clearResetLink, Math.min(remaining, 2147483647));
    const panel = el("section", "accounts-reset-link-panel");
    panel.id = "accounts-reset-link-panel";
    panel.setAttribute("aria-labelledby", "accounts-reset-link-title");
    const title = el("h4", "", "Temporary password reset link");
    title.id = "accounts-reset-link-title";
    const warning = el("p", "", "Verify the account holder before sharing this temporary link. It expires in 15 minutes and can be used once.");
    const input = el("input");
    input.type = "text";
    input.id = "accounts-reset-link";
    input.readOnly = true;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = resetLink.url;
    const expiryText = el("p", "accounts-field-hint", `Expires ${new Date(expiry).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC. This link is shown here once; it is not saved in this browser.`);
    const actions = el("div", "accounts-action-buttons");
    const copy = button("Copy link", "accounts-reset-copy");
    const dismiss = button("Dismiss link", "accounts-reset-dismiss");
    const copyNotice = feedback("accounts-reset-copy-feedback");
    copy.addEventListener("click", async () => {
      if (!resetLink || resetLink.id !== selectedId || Date.now() >= expiry) return clearResetLink();
      const identityEpoch = epoch;
      const link = resetLink.url;
      try {
        await navigator.clipboard.writeText(link);
        if (active && epoch === identityEpoch && resetLink?.url === link) setNotice(copyNotice, "Link copied. Share it only after verifying the account holder.");
      } catch {
        if (active && epoch === identityEpoch && resetLink?.url === link) {
          input.focus();
          input.select();
          setNotice(copyNotice, "Copy is unavailable. The link is selected for you to copy.");
        }
      }
    });
    dismiss.addEventListener("click", clearResetLink);
    actions.append(copy, dismiss);
    panel.append(title, warning, field("One-time reset link", input), expiryText, actions, copyNotice);
    detail.append(panel);
  }
  function renderPlaceholder() {
    detail.replaceChildren(el("div", "accounts-detail-empty", "Select an account to view its details and management options."));
  }
  function renderDirectory() {
    const fragment = document.createDocumentFragment();
    if (!directory.items.length) fragment.append(el("p", "accounts-empty", "No accounts match these filters."));
    for (const account of directory.items) {
      const row = button("", null, "accounts-list-item");
      row.dataset.accountId = account.id;
      row.disabled = mutationPending;
      row.setAttribute("aria-pressed", String(account.id === selectedId));
      const identity = el("span", "accounts-list-identity");
      identity.append(el("strong", "", account.displayName || "Unnamed collector"), el("span", "accounts-list-email", account.email || "No email claim available"));
      const tags = el("span", "accounts-list-tags");
      tags.append(badge(account.disabled ? "Disabled" : "Active", account.disabled ? "disabled" : "active"));
      if (account.role !== "collector") tags.append(badge(roleLabel(account.role), account.role));
      const uuid = el("span", "accounts-list-uuid", account.id);
      row.append(identity, tags, uuid);
      row.addEventListener("click", () => selectAccount(account.id));
      fragment.append(row);
    }
    list.replaceChildren(fragment);
    resultLabel.textContent = `${directory.items.length} on this page · 50 per page`;
    renderListPager();
  }
  function renderListPager() {
    listPager.previous.disabled = directory.loading || mutationPending || !directory.previous.length;
    listPager.next.disabled = directory.loading || mutationPending || !directory.nextCursor;
    listPager.label.textContent = `Page ${directory.previous.length + 1}`;
  }
  async function loadOverview() {
    const request = startRequest("overview");
    setNotice(overviewNotice);
    try {
      const values = await service.getAccountOverview({ signal: request.controller.signal });
      if (!current(request)) return;
      for (const [key, node] of overviewValues) node.textContent = count(values[key]);
    } catch (error) { handleFailure(error, request, overviewNotice); }
    finally { finishRequest(request); }
  }
  async function loadDirectory(cursor = null, previous = []) {
    const request = startRequest("directory");
    directory.loading = true;
    list.setAttribute("aria-busy", "true");
    renderListPager();
    setNotice(notice, "Loading accounts…");
    try {
      const page = await service.listAccounts({ ...query, cursor, limit: PAGE_SIZE, signal: request.controller.signal });
      if (!current(request)) return;
      directory = { cursor, previous, nextCursor: page.nextCursor, items: page.accounts, loaded: true, loading: false };
      renderDirectory();
      setNotice(notice, `${page.accounts.length} account${page.accounts.length === 1 ? "" : "s"} shown.`);
    } catch (error) { handleFailure(error, request, notice); }
    finally {
      if (current(request)) {
        directory.loading = false;
        list.removeAttribute("aria-busy");
        renderListPager();
      }
      finishRequest(request);
    }
  }
  async function selectAccount(id) {
    if (!active || mutationPending) return;
    closeConfirmation();
    clearResetLink();
    draft = null;
    selectedId = id;
    selected = null;
    invalidateRecords();
    tab = "collection";
    renderDirectory();
    await loadDetail({ focus: true });
  }
  async function loadDetail({ focus = false, message = "" } = {}) {
    if (!selectedId) return;
    const id = selectedId;
    const request = startRequest("detail");
    detailLoading = true;
    detail.setAttribute("aria-busy", "true");
    detail.replaceChildren(el("p", "accounts-empty", "Loading account details…"));
    try {
      const account = await service.getAccount(id, { signal: request.controller.signal });
      if (!current(request) || selectedId !== id) return;
      selected = account;
      detailLoading = false;
      renderDetail(message);
      if (focus) {
        detail.querySelector("h3")?.focus({ preventScroll: true });
        if (globalThis.matchMedia?.("(max-width: 900px)").matches)
          detail.scrollIntoView({ block: "start", behavior: "instant" });
      }
    } catch (error) {
      if (current(request)) {
        selected = null;
        const errorNode = feedback("accounts-detail-feedback");
        const retry = button("Retry account details", "accounts-detail-retry");
        retry.addEventListener("click", () => loadDetail({ focus: true }));
        detail.replaceChildren(errorNode, retry);
        handleFailure(error, request, errorNode);
      }
    } finally {
      if (current(request)) {
        detailLoading = false;
        detail.removeAttribute("aria-busy");
      }
      finishRequest(request);
    }
  }
  function renderDetail(message = "") {
    if (!selected) return renderPlaceholder();
    const account = selected;
    const heading = el("div", "accounts-detail-heading");
    const name = el("h3", "", account.displayName || "Unnamed collector");
    name.id = "accounts-selected-name";
    name.tabIndex = -1;
    const tags = el("div", "accounts-detail-tags");
    tags.append(badge(account.disabled ? "Disabled" : "Active", account.disabled ? "disabled" : "active"), badge(roleLabel(account.role), account.role));
    heading.append(name, tags);
    const email = el("div", "accounts-email-note");
    email.append(el("strong", "", account.email || "No email claim available"), badge("Unverified email", "unverified"), el("p", "", "This email is an unverified identity-provider claim. It is not proof of identity."));
    const facts = metadata([
      ["Account UUID", account.id], ["Created (UTC)", date(account.createdAt)],
      ["Updated (UTC)", date(account.updatedAt)], ["Last sign-in", timestamp(account.lastLoginAt)],
      ["Owned entries", count(account.ownershipCount)], ["Active sessions", count(account.activeSessionCount)],
    ]);
    const detailNotice = feedback("accounts-detail-feedback");
    setNotice(detailNotice, message, Boolean(message));
    const edit = el("form", "accounts-profile-form");
    edit.setAttribute("aria-label", "Edit display name");
    const displayName = el("input");
    displayName.id = "accounts-display-name";
    displayName.maxLength = 240;
    displayName.required = true;
    displayName.autocomplete = "off";
    displayName.addEventListener("input", () => displayName.setCustomValidity(""));
    displayName.value = draft?.id === account.id && typeof draft.displayName === "string" ? draft.displayName : account.displayName;
    const save = button("Review display name change", "accounts-save-profile");
    save.type = "submit";
    edit.append(field("Display name", displayName), save);
    edit.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = displayName.value.trim();
      displayName.setCustomValidity(textError(value, 120));
      if (!value || !edit.reportValidity()) return;
      if (value === selected.displayName) {
        setNotice(detailNotice, "The display name is unchanged.");
        return;
      }
      draft = { id: account.id, displayName: value, reason: draft?.reason || "" };
      showConfirmation("profile", { displayName: value });
    });
    const access = el("section", "accounts-access-actions");
    access.append(el("h4", "", "Account access"));
    const actionButtons = el("div", "accounts-action-buttons");
    const toggle = button(account.disabled ? "Enable account" : "Disable account", "accounts-toggle-status");
    const revoke = button("Revoke all sessions", "accounts-revoke-sessions");
    toggle.disabled = !canManage(account, "status") || mutationPending;
    revoke.disabled = !canManage(account, "revokeSessions") || mutationPending;
    toggle.addEventListener("click", () => showConfirmation("status", { status: account.disabled ? "active" : "disabled" }));
    revoke.addEventListener("click", () => showConfirmation("sessions"));
    actionButtons.append(toggle, revoke);
    const passwordReset = button("Issue password reset link", "accounts-issue-reset");
    passwordReset.disabled = !canManage(account, "passwordReset") || mutationPending;
    passwordReset.addEventListener("click", () => showConfirmation("passwordReset"));
    actionButtons.append(passwordReset);
    if (actorRole === "owner" && account.role !== "owner") {
      const changeRole = button(account.role === "admin" ? "Demote to collector" : "Promote to administrator", "accounts-change-role");
      changeRole.disabled = !canManage(account, "role") || mutationPending;
      changeRole.addEventListener("click", () => showConfirmation("role", { role: account.role === "admin" ? "collector" : "admin" }));
      actionButtons.append(changeRole);
    }
    access.append(actionButtons, el("p", "accounts-field-hint", account.id === actorId || account.role === "owner"
      ? "Owner accounts and your own account have protected access controls."
      : "Disabling blocks account access and revokes sessions. Revoking sessions requires the collector to sign in again."));
    detail.replaceChildren(heading, email, facts, detailNotice, edit, access);
    if (!canManage(account, "profile")) {
      displayName.disabled = true;
      save.disabled = true;
    }
    if (resetLink?.id === account.id) renderResetLink();
    renderTabs();
    setDetailBusy(mutationPending);
  }
  function renderTabs() {
    const tabs = el("div", "accounts-detail-tabs");
    tabs.setAttribute("aria-label", "Account records");
    for (const [key, label] of [["collection", "Owned collection"], ["history", "Administration history"]]) {
      const node = button(label, null, "accounts-tab");
      node.dataset.accountTab = key;
      node.setAttribute("aria-pressed", String(tab === key));
      node.disabled = mutationPending;
      node.addEventListener("click", () => {
        tab = key;
        detail.querySelector(".accounts-detail-tabs")?.remove();
        detail.querySelector(".accounts-records")?.remove();
        renderTabs();
      });
      tabs.append(node);
    }
    const records = el("section", "accounts-records");
    records.id = `accounts-${tab}`;
    const recordTitle = el("h4", "sr-only", tab === "collection" ? "Owned collection" : "Administration history");
    recordTitle.id = `accounts-${tab}-title`;
    records.setAttribute("aria-labelledby", recordTitle.id);
    const recordList = el("div", "accounts-record-list");
    recordList.id = `accounts-${tab}-list`;
    const recordNotice = feedback(`accounts-${tab}-feedback`);
    const recordPager = pager(`accounts-${tab}`);
    records.append(recordTitle, recordList, recordNotice, recordPager.node);
    detail.append(tabs, records);
    const page = tab === "collection" ? collection : history;
    recordPager.previous.addEventListener("click", () => {
      const currentPage = tab === "collection" ? collection : history;
      loadRecords(tab, currentPage.previous.at(-1), currentPage.previous.slice(0, -1));
    });
    recordPager.next.addEventListener("click", () => {
      const currentPage = tab === "collection" ? collection : history;
      loadRecords(tab, currentPage.nextCursor, [...currentPage.previous, currentPage.cursor]);
    });
    if (!page.loaded && !page.loading) loadRecords(tab);
    else renderRecords(tab);
  }
  function renderRecords(kind) {
    if (tab !== kind || !selected) return;
    const page = kind === "collection" ? collection : history;
    const recordList = detail.querySelector(`#accounts-${kind}-list`);
    if (!recordList) return;
    const fragment = document.createDocumentFragment();
    if (page.loading && !page.loaded) fragment.append(el("p", "accounts-empty", "Loading records…"));
    else if (!page.items.length) fragment.append(el("p", "accounts-empty", kind === "collection" ? "This account has no owned collection entries." : "No administration history is available for this account."));
    for (const record of page.items) {
      const row = el("article", "accounts-record");
      if (kind === "collection") {
        const label = record.number == null ? record.name : `${String(record.number).padStart(3, "0")} · ${record.name}`;
        row.append(el("strong", "", label || "Veiling"), el("p", "", `Acquired ${date(record.acquiredAt)} · ${record.acquisition || "Recorded ownership"}`), el("span", "accounts-record-meta", `Status: ${record.status} · Entry ${record.id}`));
      } else {
        const actor = record.actorId ? `Administrator ${record.actorId}` : record.action === "password_reset_completed" ? "Reset link holder" : "Not recorded";
        row.append(el("strong", "", historyAction(record.action)), el("p", "accounts-history-reason", record.reason || "No reason recorded"), el("span", "accounts-record-meta", `${timestamp(record.createdAt)} · ${actor}`));
        const changes = historyChanges(record);
        if (changes) row.append(el("p", "accounts-history-change", changes));
      }
      fragment.append(row);
    }
    recordList.replaceChildren(fragment);
    recordList.setAttribute("aria-busy", String(page.loading));
    detail.querySelector(`#accounts-${kind}-previous`).disabled = mutationPending || page.loading || !page.previous.length;
    detail.querySelector(`#accounts-${kind}-next`).disabled = mutationPending || page.loading || !page.nextCursor;
    detail.querySelector(`#accounts-${kind} .accounts-page-label`).textContent = `Page ${page.previous.length + 1}`;
  }
  function historyAction(value) {
    return ({ profile_updated: "Display name updated", account_disabled: "Account disabled", account_enabled: "Account enabled", sessions_revoked: "Sessions revoked", password_reset_issued: "Password reset link issued", password_reset_completed: "Password reset completed", role_changed: "Account role changed" })[value] || String(value || "Account change").replace(/[._]/g, " ");
  }
  function historyChanges(record) {
    if (!record.before || !record.after || typeof record.before !== "object" || typeof record.after !== "object") return "";
    const changes = [];
    if (typeof record.before.displayName === "string" && typeof record.after.displayName === "string" && record.before.displayName !== record.after.displayName)
      changes.push(`Display name: ${record.before.displayName} → ${record.after.displayName}`);
    if (typeof record.before.disabled === "boolean" && typeof record.after.disabled === "boolean" && record.before.disabled !== record.after.disabled)
      changes.push(`Status: ${record.before.disabled ? "Disabled" : "Active"} → ${record.after.disabled ? "Disabled" : "Active"}`);
    if (typeof record.before.role === "string" && typeof record.after.role === "string" && record.before.role !== record.after.role)
      changes.push(`Role: ${roleLabel(record.before.role)} → ${roleLabel(record.after.role)}`);
    return changes.join(" · ");
  }
  async function loadRecords(kind, cursor = null, previous = []) {
    if (!selected || mutationPending) return;
    const method = kind === "collection" ? "listAccountCollection" : "listAccountAudit";
    const recordNotice = detail.querySelector(`#accounts-${kind}-feedback`);
    if (typeof service[method] !== "function") {
      if (recordNotice) setNotice(recordNotice, "These records are not available from the account service yet.");
      return;
    }
    const id = selected.id;
    const request = startRequest(kind);
    const page = kind === "collection" ? collection : history;
    page.loading = true;
    renderRecords(kind);
    if (recordNotice) setNotice(recordNotice);
    try {
      const result = await service[method](id, { cursor, limit: DETAIL_PAGE_SIZE, signal: request.controller.signal });
      if (!current(request) || selectedId !== id) return;
      const next = { cursor, previous, nextCursor: result.nextCursor, items: result[kind === "collection" ? "ownerships" : "history"], loaded: true, loading: false };
      if (kind === "collection") collection = next;
      else history = next;
      renderRecords(kind);
    } catch (error) {
      const node = detail.querySelector(`#accounts-${kind}-feedback`);
      if (node) handleFailure(error, request, node);
      else if (current(request) && ["AUTH_REQUIRED", "ACCESS_DENIED"].includes(error?.code)) handleFailure(error, request, notice);
    } finally {
      if (current(request) && selectedId === id) {
        (kind === "collection" ? collection : history).loading = false;
        renderRecords(kind);
      }
      finishRequest(request);
    }
  }
  function showConfirmation(kind, values = {}) {
    if (!active || !selected || detailLoading || mutationPending) return;
    if (!canManage(selected, kind === "sessions" ? "revokeSessions" : kind)) return;
    clearResetLink();
    confirmation = { kind, id: selected.id, revision: selected.revision, ...values };
    const action = kind === "profile" ? "Change display name" : kind === "sessions" ? "Revoke all sessions" : kind === "passwordReset" ? "Issue password reset link" : kind === "role" ? `Change role to ${roleLabel(values.role).toLowerCase()}` : values.status === "disabled" ? "Disable account" : "Enable account";
    confirmTitle.textContent = action;
    confirmSubmit.textContent = `Confirm ${kind === "profile" ? "name change" : kind === "sessions" ? "session revocation" : kind === "passwordReset" ? "reset link" : kind === "role" ? "role change" : values.status === "disabled" ? "disable" : "enable"}`;
    confirmDescription.textContent = kind === "profile" ? `New display name: ${values.displayName}`
      : kind === "sessions" ? "Every active session for this collector will be revoked. They will need to sign in again."
      : kind === "passwordReset" ? "A temporary link will let this account holder choose a new password. Existing sessions and earlier reset links will be revoked. Verify the account holder before sharing the link."
      : kind === "role" ? `This account will become ${values.role === "admin" ? "an administrator" : "a collector"}. All active sessions and password reset links will be revoked. ${values.role === "admin" ? "Administrators can manage collectors and the Veiling catalog." : "Collector accounts cannot manage other accounts or the catalog."}`
      : values.status === "disabled" ? "This collector will lose account access and all active sessions will be revoked. Their collection remains recorded."
      : "This collector will be allowed to sign in again. Revoked sessions will remain signed out.";
    confirmAccount.textContent = `${selected.displayName || "Unnamed collector"} · ${selected.id}`;
    reason.value = draft?.id === selected.id ? draft.reason || "" : "";
    consent.checked = false;
    consentText.textContent = `I have reviewed this account and confirm: ${action.toLowerCase()}.`;
    setNotice(confirmNotice);
    dialog.showModal();
    reason.focus();
  }
  function setDetailBusy(busy) {
    for (const control of detail.querySelectorAll("input, button")) control.disabled = busy;
    if (!busy && selected) {
      detail.querySelector("#accounts-display-name").disabled = !canManage(selected, "profile");
      detail.querySelector("#accounts-save-profile").disabled = !canManage(selected, "profile");
      detail.querySelector("#accounts-toggle-status").disabled = !canManage(selected, "status");
      detail.querySelector("#accounts-revoke-sessions").disabled = !canManage(selected, "revokeSessions");
      detail.querySelector("#accounts-issue-reset").disabled = !canManage(selected, "passwordReset");
      const changeRole = detail.querySelector("#accounts-change-role");
      if (changeRole) changeRole.disabled = !canManage(selected, "role");
      renderRecords(tab);
    }
    refresh.disabled = busy;
    searchSubmit.disabled = busy;
    for (const control of filters.querySelectorAll("input, select")) control.disabled = busy;
    for (const row of list.querySelectorAll("button")) row.disabled = busy;
    renderListPager();
    reason.disabled = busy;
    consent.disabled = busy;
    cancel.disabled = busy;
    confirmSubmit.disabled = busy;
  }
  confirmForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!confirmation || !selected || mutationPending) return;
    reason.setCustomValidity(textError(reason.value, 500));
    if (!confirmForm.reportValidity()) return;
    const reasonText = reason.value.trim();
    if (!reasonText) {
      setNotice(confirmNotice, "Enter a reason for this change.", true);
      reason.focus();
      return;
    }
    const action = { ...confirmation, reason: reasonText };
    if (action.id !== selected.id || action.revision !== selected.revision) return;
    draft = { ...draft, id: action.id, reason: reasonText };
    clearResetLink();
    invalidateRecords();
    const request = startRequest("mutation");
    mutationPending = true;
    setDetailBusy(true);
    setNotice(confirmNotice, "Saving account change…");
    try {
      const options = { reason: action.reason, revision: action.revision, signal: request.controller.signal };
      const result = action.kind === "profile"
        ? await service.updateAccountProfile(action.id, { ...options, displayName: action.displayName })
        : action.kind === "status"
          ? await service.setAccountStatus(action.id, { ...options, status: action.status })
          : action.kind === "role"
            ? await service.setAccountRole(action.id, { ...options, role: action.role })
            : action.kind === "passwordReset"
              ? await service.issueAccountPasswordReset(action.id, options)
              : await service.revokeAccountSessions(action.id, options);
      if (!current(request) || selectedId !== action.id) return;
      selected = action.kind === "passwordReset" ? result.account : result;
      if (action.kind === "passwordReset") resetLink = { id: action.id, url: result.resetLink, expiresAt: result.expiresAt };
      draft = null;
      mutationPending = false;
      closeConfirmation();
      renderDetail();
      const label = action.kind === "profile" ? "Display name updated." : action.kind === "status" ? `Account ${action.status === "disabled" ? "disabled" : "enabled"}.` : action.kind === "role" ? `Role changed to ${roleLabel(action.role).toLowerCase()}. Active sessions and earlier reset links were revoked.` : action.kind === "passwordReset" ? "Password reset link issued. Active sessions and earlier reset links were revoked." : `${count(result.revokedSessionCount)} session${result.revokedSessionCount === 1 ? "" : "s"} revoked.`;
      setNotice(detail.querySelector("#accounts-detail-feedback"), label);
      loadDirectory(directory.cursor, directory.previous);
      loadOverview();
      if (action.kind === "profile") {
        const changedAccount = selected;
        Promise.resolve().then(() => onProfileChanged(changedAccount)).catch(() => {});
      }
    } catch (error) {
      if (!current(request)) return;
      if (["ACCOUNT_CHANGED", "STALE_REVISION", "REVISION_REQUIRED"].includes(error?.code)) {
        mutationPending = false;
        closeConfirmation();
        const message = "This account changed before your action was saved. The latest details are shown below. Review them and confirm your change again.";
        await loadDetail({ message });
        if (current(request)) loadDirectory(directory.cursor, directory.previous);
      } else if (error?.code === "PROTECTED_ACCOUNT") {
        mutationPending = false;
        closeConfirmation();
        selected = { ...selected, permissions: { ...selected.permissions, setStatus: false, revokeSessions: false, resetPassword: false, setRole: false } };
        renderDetail("The server protects this account from changes to access or sessions.");
      } else {
        handleFailure(error, request, confirmNotice);
      }
    } finally {
      if (current(request)) {
        mutationPending = false;
        setDetailBusy(false);
      }
      finishRequest(request);
    }
  });
  cancel.addEventListener("click", () => { if (!mutationPending) closeConfirmation(); });
  dialog.addEventListener("cancel", (event) => {
    if (mutationPending) event.preventDefault();
    else closeConfirmation();
  });
  filters.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!active || mutationPending) return;
    clearResetLink();
    query = { search: search.value.trim(), searchBy: searchKind.value, status: status.value, role: role.value };
    loadDirectory();
  });
  for (const control of [search, searchKind, status, role]) {
    control.addEventListener("input", clearResetLink);
    control.addEventListener("change", clearResetLink);
  }
  listPager.previous.addEventListener("click", () => loadDirectory(directory.previous.at(-1), directory.previous.slice(0, -1)));
  listPager.next.addEventListener("click", () => loadDirectory(directory.nextCursor, [...directory.previous, directory.cursor]));
  refresh.addEventListener("click", () => {
    if (!active || mutationPending) return;
    closeConfirmation();
    clearResetLink();
    loadOverview();
    loadDirectory(directory.cursor, directory.previous);
    if (selectedId) {
      draft = null;
      invalidateRecords();
      loadDetail();
    }
  });

  function reset() {
    active = false;
    epoch += 1;
    for (const request of requests.values()) request.abort();
    requests.clear();
    actorId = null;
    actorRole = null;
    selected = null;
    selectedId = null;
    detailLoading = false;
    mutationPending = false;
    draft = null;
    query = { search: "", searchBy: "email", status: "all", role: "all" };
    directory = emptyPage();
    collection = emptyPage();
    history = emptyPage();
    search.value = "";
    searchKind.value = "email";
    status.value = "all";
    role.value = "all";
    closeConfirmation();
    clearResetLink();
    for (const value of overviewValues.values()) value.textContent = "—";
    setNotice(overviewNotice);
    setNotice(notice);
    list.replaceChildren();
    list.removeAttribute("aria-busy");
    detail.removeAttribute("aria-busy");
    resultLabel.textContent = "50 accounts per page";
    renderPlaceholder();
    setDetailBusy(false);
  }
  async function open({ actorId: id, actorRole: role } = {}) {
    if (destroyed) return;
    if (active && actorId === id && actorRole === role) return;
    reset();
    actorId = id;
    actorRole = role;
    active = true;
    await Promise.allSettled([loadOverview(), loadDirectory()]);
  }
  function destroy() {
    reset();
    destroyed = true;
    root.replaceChildren();
  }
  reset();
  return Object.freeze({ open, reset, destroy });
}
