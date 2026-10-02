/** Bounded, authorized account management projections. No credentials are read. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{1,2048}$/;
const ROLES = new Set(["owner", "admin", "collector"]);
const PERMISSIONS = ["editProfile", "setStatus", "revokeSessions", "resetPassword", "setRole"];
const AUDIT_FIELDS = new Set(["displayName", "disabled", "revision", "role"]);

export function createAdminAccountService({ request, ErrorClass, origin = globalThis.location?.origin }) {
  const fail = (code = "INVALID_PROJECTION") => { throw new ErrorClass(code); };
  function id(value) { if (typeof value !== "string" || !UUID.test(value)) fail("INVALID_INPUT"); return value.toLowerCase(); }
  function count(value) { if (!Number.isSafeInteger(value) || value < 0) fail(); return value; }
  function timestamp(value, nullable = false) {
    if (nullable && value === null) return null;
    if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value))) fail();
    return value;
  }
  function text(value, maximum, required = true) {
    if (typeof value !== "string") fail("INVALID_INPUT");
    const result = value.trim();
    if ((required && !result) || Array.from(result).length > maximum ||
      /[\u0000-\u001f\u007f-\u009f]/.test(result) || /[\uD800-\uDFFF]/u.test(result)) fail("INVALID_INPUT");
    return result;
  }
  function account(value, detail = false) {
    if (!value || !UUID.test(value.id) || typeof value.displayName !== "string" ||
      !value.displayName.trim() || Array.from(value.displayName).length > 120 ||
      typeof value.disabled !== "boolean" || !ROLES.has(value.role) ||
      !Number.isSafeInteger(value.revision) || value.revision < 1) fail();
    if (value.email !== null && (typeof value.email !== "string" || value.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))) fail();
    if (value.emailVerified !== (value.email === null ? null : false)) fail();
    const result = {
      id: value.id, email: value.email, emailVerified: value.emailVerified,
      displayName: value.displayName, disabled: value.disabled, role: value.role,
      createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt),
      lastLoginAt: timestamp(value.lastLoginAt, true), revision: value.revision,
    };
    if (detail) {
      if (typeof value.protected !== "boolean" || typeof value.passwordAccount !== "boolean" ||
        !value.permissions || PERMISSIONS.some((key) => typeof value.permissions[key] !== "boolean")) fail();
      Object.assign(result, {
        activeSessionCount: count(value.activeSessionCount), ownershipCount: count(value.ownershipCount),
        protected: value.protected, passwordAccount: value.passwordAccount,
        permissions: Object.freeze(Object.fromEntries(PERMISSIONS.map((key) => [key, value.permissions[key]]))),
      });
      if (value.revokedSessionCount != null) result.revokedSessionCount = count(value.revokedSessionCount);
    }
    return Object.freeze(result);
  }
  function paging(options, fallback) {
    const limit = options.limit ?? fallback;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("INVALID_INPUT");
    const params = new URLSearchParams({ limit: String(limit) });
    if (options.cursor != null) {
      if (typeof options.cursor !== "string" || !CURSOR.test(options.cursor)) fail("INVALID_INPUT");
      params.set("cursor", options.cursor);
    }
    return { limit, params };
  }
  function page(value, field, limit, project) {
    if (!value || !Array.isArray(value[field]) || value[field].length > limit || value.limit !== limit ||
      (value.nextCursor !== null && (typeof value.nextCursor !== "string" || !CURSOR.test(value.nextCursor)))) fail();
    return { [field]: value[field].map(project), nextCursor: value.nextCursor, limit };
  }
  function revision(value) { if (!Number.isSafeInteger(value) || value < 1) fail("REVISION_REQUIRED"); return value; }
  function auditRecord(value) {
    if (value === null) return null;
    if (!value || typeof value !== "object" || Array.isArray(value)) fail();
    const result = {};
    for (const [key, field] of Object.entries(value)) {
      if (!AUDIT_FIELDS.has(key) ||
        (key === "displayName" && (typeof field !== "string" || Array.from(field).length > 120)) ||
        (key === "disabled" && typeof field !== "boolean") ||
        (key === "revision" && (!Number.isSafeInteger(field) || field < 1)) ||
        (key === "role" && !ROLES.has(field))) fail();
      result[key] = field;
    }
    return result;
  }
  async function getAccountOverview({ signal } = {}) {
    const value = await request("/admin/accounts/summary", { signal });
    const result = { total: count(value?.total), active: count(value?.active), disabled: count(value?.disabled),
      admins: count(value?.admins), owners: count(value?.owners), currentActorRole: value?.currentActorRole };
    if (result.total !== result.active + result.disabled || result.admins > result.total ||
      result.owners > result.admins || !["owner", "admin"].includes(result.currentActorRole)) fail();
    return result;
  }
  async function listAccounts(options = {}) {
    const { limit, params } = paging(options, 50);
    const status = options.status ?? "all", role = options.role ?? "all", searchBy = options.searchBy ?? "email";
    if (!["all", "active", "disabled"].includes(status) || !["all", "owner", "admin", "collector"].includes(role) ||
      !["email", "name", "id"].includes(searchBy)) fail("INVALID_INPUT");
    const search = text(options.search ?? "", 254, false);
    if (search.length > 254 || (search && searchBy === "id" && !UUID.test(search))) fail("INVALID_INPUT");
    params.set("search", search); params.set("searchBy", searchBy); params.set("status", status); params.set("role", role);
    return page(await request(`/admin/accounts?${params}`, { signal: options.signal }), "accounts", limit, (value) => account(value));
  }
  async function getAccount(accountId, { signal } = {}) {
    const selected = id(accountId);
    const value = account(await request(`/admin/accounts/${selected}`, { signal }), true);
    if (value.id.toLowerCase() !== selected) fail();
    return value;
  }
  async function update(accountId, options, fields, path = "", method = "PATCH") {
    const selected = id(accountId);
    const body = { ...fields, reason: text(options.reason, 500) };
    const value = account(await request(`/admin/accounts/${selected}${path}`, {
      method, body, revision: revision(options.revision), signal: options.signal,
    }), true);
    if (value.id.toLowerCase() !== selected) fail();
    return value;
  }
  async function updateAccountProfile(accountId, options = {}) {
    return update(accountId, options, { displayName: text(options.displayName, 120) });
  }
  async function setAccountStatus(accountId, options = {}) {
    if (!["active", "disabled"].includes(options.status)) fail("INVALID_INPUT");
    return update(accountId, options, { disabled: options.status === "disabled" });
  }
  async function setAccountRole(accountId, options = {}) {
    if (!["admin", "collector"].includes(options.role)) fail("INVALID_INPUT");
    return update(accountId, options, { role: options.role }, "/role");
  }
  async function revokeAccountSessions(accountId, options = {}) {
    return update(accountId, options, {}, "/revoke-sessions", "POST");
  }
  async function issueAccountPasswordReset(accountId, options = {}) {
    const selected = id(accountId);
    const value = await request(`/admin/accounts/${selected}/password-reset`, {
      method: "POST", body: { reason: text(options.reason, 500) },
      revision: revision(options.revision), signal: options.signal,
    });
    const saved = account(value?.account, true);
    if (saved.id.toLowerCase() !== selected || typeof value.resetLink !== "string" || value.resetLink.length > 2048) fail();
    let url;
    try { url = new URL(value.resetLink); } catch { fail(); }
    if (url.username || url.password || url.pathname !== "/spinarium/" || url.search ||
      !/^#reset-password=[A-Za-z0-9_-]{43}$/.test(url.hash) ||
      (origin ? url.origin !== origin : url.protocol !== "https:")) fail();
    return { account: saved, resetLink: url.href, expiresAt: timestamp(value.expiresAt) };
  }
  async function listAccountCollection(accountId, options = {}) {
    const selected = id(accountId), { params, limit } = paging(options, 25);
    const value = await request(`/admin/accounts/${selected}/ownerships?${params}`, { signal: options.signal });
    return page(value, "ownerships", limit, (row) => {
      if (!row || !UUID.test(row.id) || !UUID.test(row.veilingId) ||
        (row.name !== null && typeof row.name !== "string") ||
        (row.number !== null && !Number.isSafeInteger(row.number)) || typeof row.status !== "string" ||
        !["server_grant", "physical_claim", "transfer"].includes(row.acquisition)) fail();
      return { id: row.id, veilingId: row.veilingId, name: row.name, number: row.number,
        status: row.status, acquisition: row.acquisition, acquiredAt: timestamp(row.acquiredAt) };
    });
  }
  async function listAccountAudit(accountId, options = {}) {
    const selected = id(accountId), { params, limit } = paging(options, 25);
    const value = await request(`/admin/accounts/${selected}/history?${params}`, { signal: options.signal });
    return page(value, "history", limit, (row) => {
      if (!row || !UUID.test(row.id) || (row.actorId !== null && !UUID.test(row.actorId)) || typeof row.action !== "string" || row.action.length > 80 ||
        typeof row.reason !== "string" || Array.from(row.reason).length > 500) fail();
      return { id: row.id, actorId: row.actorId, action: row.action, reason: row.reason,
        before: auditRecord(row.before), after: auditRecord(row.after), createdAt: timestamp(row.createdAt) };
    });
  }
  return Object.freeze({ getAccountOverview, listAccounts, getAccount, updateAccountProfile,
    setAccountStatus, setAccountRole, revokeAccountSessions, issueAccountPasswordReset,
    listAccountCollection, listAccountAudit });
}
