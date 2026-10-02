import assert from "node:assert/strict";
import { createSpinariumService, SpinariumServiceError } from "../spinarium/data/cloudflare-service.js";
import { createAuthClient, AuthError } from "../spinarium/auth/cloudflare-auth.js";

// Isolated HTTP doubles. These checks do not contact a Cloudflare account.
const config = { backend: "cloudflare", authProvider: "password", apiBase: "/api" };
const origin = "https://spinarium.example.test";
const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const csrf = "test_only_account_admin_csrf_12345678901234567890";
const token = "test_only_reset_token_012345678901234567890";
const now = "2026-10-02T12:00:00Z";
const row = (extra = {}) => ({ id: accountId, email: "collector@example.invalid", emailVerified: false,
  displayName: "Test collector", disabled: false, role: "collector", createdAt: now,
  updatedAt: now, lastLoginAt: null, revision: 3, ...extra });
const detail = (extra = {}) => ({ ...row(), activeSessionCount: 2, ownershipCount: 0,
  protected: false, passwordAccount: true,
  permissions: { editProfile: true, setStatus: true, revokeSessions: true, resetPassword: true, setRole: true }, ...extra });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const page = (field, rows, limit = 50, nextCursor = null) => ({ [field]: rows, nextCursor, limit });
function harness(reply = detail()) {
  let session = Object.freeze({ flow: "password", user: { id: actorId } });
  const auth = { getSession: () => session, getCsrfToken: () => csrf,
    invalidateSession: () => { session = null; } };
  const calls = [];
  const service = createSpinariumService(config, auth, { origin, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return typeof reply === "function" ? reply(url, options) : json(reply);
  } });
  return { service, calls, auth, changeIdentity() { session = Object.freeze({ flow: "password", user: { id: otherId } }); } };
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
async function reject(promise, code) {
  await assert.rejects(promise, (error) => {
    assert(error instanceof SpinariumServiceError);
    assert.equal(error.code, code);
    assert(!error.message.includes("private-provider-detail"));
    return true;
  });
}

await test("account overview validates bounded counts and server owner context", async () => {
  const data = { total: 55, active: 54, disabled: 1, admins: 2, owners: 1, currentActorRole: "owner" };
  const { service, calls } = harness(data);
  assert.deepEqual(await service.getAccountOverview(), data);
  assert.equal(calls[0].url, "/api/admin/accounts/summary");
  for (const invalid of [{ ...data, total: 56 }, { ...data, owners: 3 }, { ...data, currentActorRole: "collector" }, { ...data, active: -1 }])
    await reject(harness(invalid).service.getAccountOverview(), "INVALID_PROJECTION");
});
await test("administrator context accepts only consistent server owner/admin grants", async () => {
  for (const context of [{ admin: false, role: null }, { admin: true, role: "admin" }, { admin: true, role: "owner" }])
    assert.deepEqual(await harness(context).service.getAdminContext(), context);
  for (const context of [{ admin: true, role: null }, { admin: false, role: "owner" }, { admin: true, role: "superadmin" }, { admin: true }])
    await reject(harness(context).service.getAdminContext(), "INVALID_PROJECTION");
});
await test("directory uses bounded pages and explicit indexed search/status/role filters", async () => {
  const { service, calls } = harness(page("accounts", [row()], 50, "opaque_next_cursor"));
  const first = await service.listAccounts();
  assert.equal(first.accounts.length, 1); assert.equal(first.nextCursor, "opaque_next_cursor");
  await service.listAccounts({ search: " collector@ ", searchBy: "email", status: "active", role: "collector", cursor: first.nextCursor });
  await service.listAccounts({ search: "Test", searchBy: "name", role: "owner" });
  await service.listAccounts({ search: accountId, searchBy: "id", status: "disabled" });
  const urls = calls.map(({ url }) => new URL(url, origin));
  assert.equal(urls[0].searchParams.get("limit"), "50");
  assert.equal(urls[1].searchParams.get("search"), "collector@");
  assert.equal(urls[1].searchParams.get("searchBy"), "email");
  assert.equal(urls[1].searchParams.get("status"), "active");
  assert.equal(urls[1].searchParams.get("role"), "collector");
  assert.equal(urls[1].searchParams.get("cursor"), first.nextCursor);
  assert.equal(urls[2].searchParams.get("role"), "owner");
  assert.equal(urls[3].searchParams.get("searchBy"), "id");
});
await test("invalid directory limits, cursors and search modes never reach the API", async () => {
  const { service, calls } = harness();
  for (const options of [{ limit: 10000 }, { limit: 0 }, { limit: 1.5 }, { cursor: "../secret" },
    { status: "deleted" }, { role: "superadmin" }, { searchBy: "contains" }, { searchBy: "id", search: "not-a-uuid" },
    { search: "a".repeat(255) }, { search: "bad\u0000query" }])
    await reject(service.listAccounts(options), "INVALID_INPUT");
  assert.equal(calls.length, 0);
});
await test("overlarge or malformed pages and verified-email claims fail closed", async () => {
  for (const value of [page("accounts", Array.from({ length: 51 }, () => row())), page("accounts", [row()], 49),
    page("accounts", [row({ emailVerified: true })]), page("accounts", [row({ revision: 0 })]),
    page("accounts", [row()], 50, "../bad"), page("accounts", [row({ role: "superadmin" })])])
    await reject(harness(value).service.listAccounts(), "INVALID_PROJECTION");
});
await test("account projections discard credentials and arbitrary identity claims", async () => {
  const { service } = harness(detail({ passwordHash: "never-public", secret: "never-public", isAdmin: true, resetToken: "never-public" }));
  const data = await service.getAccount(accountId);
  assert.equal(JSON.stringify(data).includes("never-public"), false);
  assert.equal("isAdmin" in data, false);
  assert(Object.isFrozen(data)); assert(Object.isFrozen(data.permissions));
});
await test("detail identity and all server permission flags are required", async () => {
  for (const value of [detail({ id: otherId }), detail({ permissions: { profile: true } }),
    detail({ protected: "false" }), detail({ passwordAccount: undefined }), detail({ activeSessionCount: -1 }),
    detail({ updatedAt: "not-a-date" })])
    await reject(harness(value).service.getAccount(accountId), "INVALID_PROJECTION");
});
await test("profile changes allow only display name and reason with revision and CSRF", async () => {
  const { service, calls } = harness(detail({ revision: 4 }));
  await service.updateAccountProfile(accountId, { displayName: " Updated collector ", reason: " QA change ", revision: 3,
    email: "attacker@example.invalid", role: "owner", password: "never-submit", disabled: true });
  assert.equal(calls[0].url, `/api/admin/accounts/${accountId}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { displayName: "Updated collector", reason: "QA change" });
  assert.equal(calls[0].options.method, "PATCH");
  assert.equal(calls[0].options.headers["If-Match"], '"3"');
  assert.equal(calls[0].options.headers["x-csrf-token"], csrf);
});
await test("all mutations require valid reasons, names and saved revisions", async () => {
  const { service, calls } = harness();
  for (const options of [{ displayName: "", reason: "QA", revision: 3 }, { displayName: "A".repeat(121), reason: "QA", revision: 3 },
    { displayName: "Valid", reason: "", revision: 3 }, { displayName: "Valid", reason: "x".repeat(501), revision: 3 },
    { displayName: "Valid", reason: "QA", revision: 0 }])
    await reject(service.updateAccountProfile(accountId, options), options.revision === 0 ? "REVISION_REQUIRED" : "INVALID_INPUT");
  await reject(service.revokeAccountSessions(accountId, { reason: "QA" }), "REVISION_REQUIRED");
  assert.equal(calls.length, 0);
});
await test("status and session revocation use explicit protected endpoints", async () => {
  const { service, calls } = harness(detail({ revision: 4, revokedSessionCount: 2 }));
  await service.setAccountStatus(accountId, { status: "disabled", reason: "QA disable", revision: 3 });
  await service.setAccountStatus(accountId, { status: "active", reason: "QA enable", revision: 3 });
  await service.revokeAccountSessions(accountId, { reason: "QA revoke", revision: 3 });
  assert.deepEqual(JSON.parse(calls[0].options.body), { disabled: true, reason: "QA disable" });
  assert.deepEqual(JSON.parse(calls[1].options.body), { disabled: false, reason: "QA enable" });
  assert.equal(calls[2].url, `/api/admin/accounts/${accountId}/revoke-sessions`);
  assert.equal(calls[2].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[2].options.body), { reason: "QA revoke" });
  await reject(service.setAccountStatus(accountId, { status: "deleted", reason: "QA", revision: 3 }), "INVALID_INPUT");
});
await test("role management submits administrator or collector only and never owner", async () => {
  const { service, calls } = harness(detail({ role: "admin", revision: 4 }));
  await service.setAccountRole(accountId, { role: "admin", reason: "QA promotion", revision: 3 });
  assert.equal(calls[0].url, `/api/admin/accounts/${accountId}/role`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { role: "admin", reason: "QA promotion" });
  await reject(service.setAccountRole(accountId, { role: "owner", reason: "QA", revision: 3 }), "INVALID_INPUT");
  assert.equal(calls.length, 1);
});
await test("read and mutation transport uses same-origin cookies and no bearer token", async () => {
  const { service, calls } = harness(detail());
  await service.getAccount(accountId);
  await service.revokeAccountSessions(accountId, { reason: "QA", revision: 3 });
  for (const { options } of calls) {
    assert.equal(options.credentials, "same-origin"); assert.equal(options.mode, "same-origin");
    assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, undefined);
  }
  assert.equal(calls[0].options.headers["x-csrf-token"], undefined);
});
await test("revision and permission errors expose only allowlisted safe messages", async () => {
  for (const [status, code, expected] of [[409, "ACCOUNT_CHANGED", "ACCOUNT_CHANGED"], [428, "REVISION_REQUIRED", "REVISION_REQUIRED"],
    [403, "PROTECTED_ACCOUNT", "PROTECTED_ACCOUNT"], [403, "ADMIN_REQUIRED", "ACCESS_DENIED"],
    [400, "private-provider-detail", "INVALID_INPUT"], [500, "private-provider-detail", "BACKEND_ERROR"]])
    await reject(harness(() => json({ code, message: "private-provider-detail" }, status)).service.getAccount(accountId), expected);
});
await test("401 invalidates identity and discards protected account responses", async () => {
  const { service, auth } = harness(() => json({ message: "private-provider-detail" }, 401));
  await reject(service.getAccount(accountId), "AUTH_REQUIRED");
  assert.equal(auth.getSession(), null);
});
await test("late private responses are discarded when identity changes", async () => {
  let resolve;
  const fixture = harness(() => new Promise((done) => { resolve = done; }));
  const request = fixture.service.getAccount(accountId);
  fixture.changeIdentity(); resolve(json(detail()));
  await reject(request, "AUTH_REQUIRED");
});
await test("aborted directory requests cannot provide a stale page", async () => {
  const controller = new AbortController();
  const { service } = harness(() => { controller.abort(); return json(page("accounts", [row()])); });
  await reject(service.listAccounts({ signal: controller.signal }), "CANCELLED");
});
await test("collection and audit records use bounded independent 25-row cursors", async () => {
  const { service, calls } = harness((url) => json(page(url.includes("/ownerships") ? "ownerships" : "history", [], 25, "record_next_cursor")));
  const collection = await service.listAccountCollection(accountId);
  await service.listAccountAudit(accountId, { cursor: collection.nextCursor });
  assert.equal(new URL(calls[0].url, origin).searchParams.get("limit"), "25");
  assert.equal(new URL(calls[1].url, origin).searchParams.get("cursor"), "record_next_cursor");
  assert(calls[0].url.startsWith(`/api/admin/accounts/${accountId}/ownerships?`));
});
await test("audit projections reject secrets and nested private payloads", async () => {
  const record = { id: otherId, actorId, action: "account.profile_updated", reason: "QA reason", before: { displayName: "Old" }, after: { displayName: "New" }, createdAt: now };
  assert.equal((await harness(page("history", [record], 25)).service.listAccountAudit(accountId)).history[0].reason, "QA reason");
  assert.equal((await harness(page("history", [{ ...record, actorId: null, action: "password_reset_completed" }], 25)).service.listAccountAudit(accountId)).history[0].actorId, null);
  for (const before of [{ passwordHash: "never-public" }, { token: "never-public" }, { nested: { email: "private" } }])
    await reject(harness(page("history", [{ ...record, before }], 25)).service.listAccountAudit(accountId), "INVALID_PROJECTION");
});
await test("manual reset issuance requires reason, CSRF and revision but never a password", async () => {
  const result = { account: detail({ revision: 4 }), resetLink: `${origin}/spinarium/#reset-password=${token}`, expiresAt: now };
  const { service, calls } = harness(result);
  const issued = await service.issueAccountPasswordReset(accountId, { reason: "QA recovery", revision: 3, password: "must-not-send" });
  assert.equal(issued.account.id, accountId);
  assert.equal(calls[0].url, `/api/admin/accounts/${accountId}/password-reset`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { reason: "QA recovery" });
  assert.equal(calls[0].options.headers["If-Match"], '"3"');
  assert.equal(calls[0].options.headers["x-csrf-token"], csrf);
});
await test("reset projections reject cross-origin, query or malformed credential links", async () => {
  for (const resetLink of [`https://evil.example/spinarium/#reset-password=${token}`, `${origin}/spinarium/?token=${token}`,
    `${origin}/spinarium/#reset-password=short`, `${origin}/other/#reset-password=${token}`,
    `https://user:pass@spinarium.example.test/spinarium/#reset-password=${token}`])
    await reject(harness({ account: detail(), resetLink, expiresAt: now }).service.issueAccountPasswordReset(accountId, { reason: "QA", revision: 3 }), "INVALID_PROJECTION");
});
await test("public password reset sends only token/password and clears cached identity without automatic sign-in", async () => {
  const calls = [];
  const auth = createAuthClient(config, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return url.endsWith("/session") ? json({ user: { id: actorId, displayName: "Test owner" }, csrfToken: csrf,
      expiresAt: new Date(Date.now() + 3600000).toISOString() }) : json({ passwordReset: true });
  } });
  await auth.consumeAuthCallback(); assert(auth.getSession());
  await auth.resetPassword({ token, password: "New-test-only-passphrase42!", email: "must-not-submit@example.invalid" });
  assert.equal(auth.getSession(), null);
  assert.equal(calls[1].url, "/api/auth/password-reset");
  assert.deepEqual(JSON.parse(calls[1].options.body), { token, password: "New-test-only-passphrase42!" });
  assert.equal(calls[1].options.credentials, "same-origin");
  assert.equal(calls[1].options.headers["x-csrf-token"], undefined);
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert(!calls.some(({ url }) => url.includes(token) || url.endsWith("/login")));
});
await test("public reset validates token grammar and Unicode password bounds before transport", async () => {
  let requests = 0;
  const auth = createAuthClient(config, { fetchImpl: async () => { requests++; return json({ passwordReset: true }); } });
  for (const value of ["short", "a".repeat(44), "?".repeat(43)])
    await assert.rejects(auth.resetPassword({ token: value, password: "Test-only-passphrase42!" }), (error) => error instanceof AuthError && error.code === "PASSWORD_RESET_UNAVAILABLE");
  for (const password of ["a".repeat(14), "a".repeat(129), "🔐".repeat(14), " ".repeat(15), "a".repeat(15) + "\ud800"])
    await assert.rejects(auth.resetPassword({ token, password }), (error) => error instanceof AuthError && error.code === "INVALID_PASSWORD");
  assert.equal(requests, 0);
  await auth.resetPassword({ token, password: "🔐".repeat(128) });
  assert.equal(requests, 1);
});
await test("expired, used and invalid reset failures expose one safe message without backend details", async () => {
  for (const backendReason of ["expired private-provider-detail", "used private-provider-detail", "invalid private-provider-detail"] ) {
    const auth = createAuthClient(config, { fetchImpl: async () => json({ code: "PASSWORD_RESET_UNAVAILABLE", message: backendReason }, 400) });
    await assert.rejects(auth.resetPassword({ token, password: "Test-only-passphrase42!" }), (error) => {
      assert(error instanceof AuthError); assert.equal(error.code, "PASSWORD_RESET_UNAVAILABLE");
      assert(!error.message.includes("private-provider-detail")); assert(!error.message.includes(token)); return true;
    });
    assert.equal(auth.getSession(), null);
  }
});
await test("late reset responses cannot clear a newly signed-in identity", async () => {
  let resolve;
  const session = (id) => ({ user: { id, displayName: "Test identity" }, csrfToken: csrf,
    expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const auth = createAuthClient(config, { fetchImpl: async (url) => url.endsWith("/password-reset")
    ? new Promise((done) => { resolve = done; }) : json(session(url.endsWith("/session") ? actorId : otherId)) });
  await auth.consumeAuthCallback();
  const reset = auth.resetPassword({ token, password: "New-test-only-passphrase42!" });
  auth.invalidateSession();
  await auth.signIn({ email: "new@example.invalid", password: "Test-only-passphrase42!" });
  resolve(json({ passwordReset: true }));
  await assert.rejects(reset, (error) => error instanceof AuthError && error.code === "CANCELLED");
  assert.equal(auth.getSession().user.id, otherId);
  auth.invalidateSession();
});

console.log(`All ${passed} isolated account administrator adapter checks passed. Hosted APIs were not tested.`);
