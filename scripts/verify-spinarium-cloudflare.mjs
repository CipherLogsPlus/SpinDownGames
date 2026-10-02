import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAuthClient, AuthError } from "../spinarium/auth/cloudflare-auth.js";
import { createSpinariumService, SpinariumServiceError } from "../spinarium/data/cloudflare-service.js";
import { createPreviewAccess } from "../spinarium/data/preview-service.js";
import { spinariumConfig } from "../spinarium/config.js";

// Isolated HTTP doubles: no Cloudflare account, provider, or hosted API is used.
const config = { backend: "cloudflare", authProvider: "password", apiBase: "/api", signupEnabled: false };
const account = { email: "collector@example.invalid", password: "test-only-password-12345", displayName: "Test collector" };
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const veilingId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const artworkId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const csrfToken = "test_only_csrf_token_for_isolated_checks_123456789";
const user = { id: userId, displayName: "Test collector", memberSince: "2026-10-01T00:00:00Z" };
const sessionData = () => ({ user: { ...user, role: "admin", isAdmin: true }, csrfToken,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(), access_token: "never-public" });
const row = (revision = 1) => ({ id: veilingId, name: "Test Veiling", description: "Approved definition",
  character_number: 1, status: "draft", rarity: null, edition: null,
  artworkUrl: `/api/artwork/${artworkId}`, revision });
const editorInput = { name: "Test Veiling", description: "Approved definition", number: 1,
  status: "draft", rarity: null, edition: null };
const dashboard = () => ({ schemaVersion: "1", mode: "live", profile: { ...user, avatarSrc: null },
  veilings: [], series: [], editions: [], variants: [], rarities: [], physicalCards: [],
  ownerships: [], discoveries: [], achievements: [], userAchievements: [], collections: [], news: [], events: [] });
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
function rejectCode(promise, code, ErrorClass = AuthError) {
  return assert.rejects(promise, (error) => {
    assert(error instanceof ErrorClass);
    assert.equal(error.code, code);
    assert.equal(error.message.includes("private-provider-detail"), false);
    assert.equal("cause" in error, false);
    return true;
  });
}
async function signedIn() {
  const auth = createAuthClient(config, { fetchImpl: async () => json(sessionData()) });
  await auth.consumeAuthCallback();
  return auth;
}

await test("public config explicitly selects Cloudflare; unsupported or cross-origin settings fail closed", async () => {
  assert.equal(typeof spinariumConfig.previewEnabled, "boolean");
  assert.equal(spinariumConfig.backend, "cloudflare");
  assert.equal(spinariumConfig.authProvider, "password");
  assert.equal(spinariumConfig.apiBase, spinariumConfig.previewEnabled ? "" : "/api");
  assert.equal(typeof spinariumConfig.signupEnabled, "boolean");
  if (spinariumConfig.previewEnabled) assert.equal(spinariumConfig.signupEnabled, false);
  assert.equal(spinariumConfig.supabaseUrl, "");
  assert.equal(spinariumConfig.supabasePublishableKey, "");
  assert(Object.isFrozen(spinariumConfig));
  for (const invalid of [{ ...spinariumConfig, apiBase: "" }, { ...config, backend: "supabase" },
    { ...config, apiBase: "https://example.invalid/api" }, { ...config, apiBase: "//example.invalid/api" },
    { ...config, apiBase: "/api?secret=private-provider-detail" }, { ...config, apiBase: "/api/../admin" },
    { ...config, apiBase: "/api/" }, { ...config, apiBase: "" }]) {
    let requests = 0;
    const fetchImpl = async () => { requests++; throw new Error("Must not connect"); };
    const auth = createAuthClient(invalid, { fetchImpl });
    const service = createSpinariumService(invalid, auth, { fetchImpl });
    assert.equal(auth.configured, false);
    assert.equal(service.configured, false);
    await assert.rejects(auth.signIn(), AuthError);
    await rejectCode(service.getDashboard(), "CONFIGURATION_REQUIRED", SpinariumServiceError);
    assert.equal(await service.getAdminAccess(), false);
    assert.equal(requests, 0);
  }
});

await test("signin/signup POST only allowed account fields to the same-origin Worker", async () => {
  const calls = [];
  const fetchImpl = async (path, options) => { calls.push({ path, options }); return json(sessionData()); };
  const auth = createAuthClient(config, { fetchImpl });
  await auth.signIn({ ...account, role: "admin", userId: otherId });
  assert.equal(auth.getSession().flow, "password");
  assert.equal(calls[0].path, "/api/auth/login");
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: account.email, password: account.password });
  await rejectCode(auth.signUp(), "UNSUPPORTED");
  const signup = createAuthClient({ ...config, signupEnabled: true }, { fetchImpl });
  await signup.signUp({ ...account, email: "  COLLECTOR@example.invalid ", role: "admin", ownerships: [{ veilingId }] });
  assert.equal(calls[1].path, "/api/auth/signup");
  assert.deepEqual(JSON.parse(calls[1].options.body), account);
  for (const { options } of calls) {
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.mode, "same-origin");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.equal(options.headers["x-csrf-token"], undefined);
    assert.equal(options.headers.Authorization, undefined);
  }
  await rejectCode(auth.requestPasswordReset(), "UNSUPPORTED");
  await rejectCode(auth.updatePassword(), "UNSUPPORTED");
  auth.invalidateSession(); signup.invalidateSession();
});

await test("signup validates Unicode password/name bounds without sending invalid account details", async () => {
  const calls = [];
  const auth = createAuthClient({ ...config, signupEnabled: true }, { fetchImpl: async (path, options) => {
    calls.push({ path, options });
    return json({ ...sessionData(), user: { ...user, displayName: JSON.parse(options.body).displayName } });
  } });
  for (const password of ["1234", "a".repeat(129), "🔐".repeat(14), " ".repeat(15), "a".repeat(15) + "\ud800"])
    await rejectCode(auth.signUp({ ...account, password }), "INVALID_PASSWORD");
  await rejectCode(auth.signUp({ ...account, email: "bad-email" }), "INVALID_EMAIL");
  await rejectCode(auth.signUp({ ...account, displayName: " " }), "INVALID_INPUT");
  await rejectCode(auth.signUp({ ...account, displayName: "🔐".repeat(121) }), "INVALID_INPUT");
  assert.equal(calls.length, 0);
  const unicode = { ...account, password: "🔐".repeat(128), displayName: "🔐".repeat(120) };
  const session = await auth.signUp(unicode);
  assert.equal(session.user.displayName, unicode.displayName);
  assert.equal(JSON.parse(calls[0].options.body).password, unicode.password);
  auth.invalidateSession();
});

await test("wrong credentials and unavailable signup expose only safe errors and clear local identity", async () => {
  const auth = createAuthClient(config, { fetchImpl: async (path) =>
    path.endsWith("/session") ? json(sessionData()) : json({ code: "INVALID_CREDENTIALS", message: "private-provider-detail" }, 401) });
  await auth.consumeAuthCallback();
  await rejectCode(auth.signIn(account), "INVALID_CREDENTIALS");
  assert.equal(auth.getSession(), null);
  const signup = createAuthClient({ ...config, signupEnabled: true }, { fetchImpl: async () =>
    json({ code: "ACCOUNT_UNAVAILABLE", message: "private-provider-detail" }, 400) });
  await rejectCode(signup.signUp(account), "ACCOUNT_UNAVAILABLE");
  assert.equal(signup.getSession(), null);
});

await test("session hydration strips privilege claims and tokens while using same-origin cookies", async () => {
  const calls = [];
  const auth = createAuthClient(config, { fetchImpl: async (path, options) => {
    calls.push({ path, options }); return json(sessionData());
  } });
  const callback = await auth.consumeAuthCallback();
  assert.equal(callback.handled, true);
  const session = auth.getSession();
  assert.equal(session.flow, "password");
  assert.deepEqual(session.user, user);
  assert(Object.isFrozen(session));
  assert.equal(auth.getCsrfToken(), csrfToken);
  assert.equal(JSON.stringify(session).includes(csrfToken), false);
  assert.equal(JSON.stringify(session).includes("never-public"), false);
  assert.equal("getAccessToken" in auth, false);
  assert.equal(calls[0].path, "/api/auth/session");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.mode, "same-origin");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  await auth.invalidateSession();
});

await test("anonymous sessions remain signed out; disabled and malformed sessions fail safely", async () => {
  const anonymous = createAuthClient(config, { fetchImpl: async () => json({ error: { code: "authentication_required" } }, 401) });
  assert.equal((await anonymous.consumeAuthCallback()).session, null);
  assert.equal(anonymous.getCsrfToken(), null);
  const disabled = createAuthClient(config, { fetchImpl: async () => json({ error: "private-provider-detail" }, 503) });
  await rejectCode(disabled.consumeAuthCallback(), "UNAVAILABLE");
  for (const data of [{ ...sessionData(), csrfToken: "bad" }, { ...sessionData(), user: { ...user, id: "spoofed" } },
    { ...sessionData(), expiresAt: "bad" }, { ...sessionData(), user: { id: userId } },
    { ...sessionData(), expiresAt: "2000-01-01T00:00:00Z" }]) {
    const auth = createAuthClient(config, { fetchImpl: async () => json(data) });
    await assert.rejects(auth.consumeAuthCallback(), AuthError);
    assert.equal(auth.getSession(), null);
  }
});

await test("obsolete provider notices are scrubbed and cannot create identity or demand verification", async () => {
  for (const notice of ["verify-email", "failed", "admin"]) {
    let calls = 0;
    const replaced = [];
    const auth = createAuthClient(config, { fetchImpl: async () => { calls++; return json({ code: "AUTHENTICATION_REQUIRED" }, 401); } });
    const result = await auth.consumeAuthCallback({ url: `https://example.invalid/spinarium/?auth=${notice}#signin`,
      replaceUrl: (url) => replaced.push(url) });
    assert.equal(result.session, null);
    assert.deepEqual(replaced, ["https://example.invalid/spinarium/#signin"]);
    assert.equal(calls, 1);
    assert.equal(auth.getSession(), null);
  }
  const replaced = [];
  const auth = createAuthClient(config, { fetchImpl: async () => json({ error: "anonymous" }, 401) });
  const result = await auth.consumeAuthCallback({ url: "https://example.invalid/spinarium/?auth=admin#signup",
    replaceUrl: (url) => replaced.push(url) });
  assert.equal(result.session, null);
  assert.deepEqual(replaced, ["https://example.invalid/spinarium/#signup"]);
});

await test("logout clears UI immediately and sends only same-origin CSRF-protected revocation", async () => {
  let release;
  const calls = [];
  const auth = createAuthClient(config, { fetchImpl: async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith("/session")) return json(sessionData());
    return new Promise((resolve) => { release = resolve; });
  } });
  await auth.consumeAuthCallback();
  const signout = auth.signOut();
  assert.equal(auth.getSession(), null);
  assert.equal(auth.getCsrfToken(), null);
  const request = calls[1];
  assert.equal(request.path, "/api/auth/logout");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["x-csrf-token"], csrfToken);
  assert.equal(request.options.body, "{}");
  assert.equal(request.options.credentials, "same-origin");
  release(json({ signedOut: true }));
  await signout;
});

await test("network logout failure never restores private state", async () => {
  const auth = createAuthClient(config, { fetchImpl: async (path) => {
    if (path.endsWith("/session")) return json(sessionData());
    throw new Error("private-provider-detail");
  } });
  await auth.consumeAuthCallback();
  await rejectCode(auth.signOut(), "NETWORK_ERROR");
  assert.equal(auth.getSession(), null);
});

await test("expiry and late session hydration cannot restore a signed-out browser", async () => {
  let clock = Date.now();
  const data = sessionData();
  const auth = createAuthClient(config, { now: () => clock, fetchImpl: async () => json(data) });
  await auth.consumeAuthCallback();
  clock = Date.parse(data.expiresAt);
  assert.equal(auth.getSession(), null);
  let release;
  const race = createAuthClient(config, { fetchImpl: async () => new Promise((resolve) => { release = resolve; }) });
  const pending = race.consumeAuthCallback();
  await race.signOut();
  release(json(sessionData()));
  await rejectCode(pending, "CANCELLED");
  assert.equal(race.getSession(), null);
});

await test("collector reads use only protected same-origin paths and genuine empty projection", async () => {
  const auth = await signedIn();
  const calls = [];
  const service = createSpinariumService(config, auth, { fetchImpl: async (path, options) => {
    calls.push({ path, options });
    if (path === "/api/dashboard") return json(dashboard());
    if (path === "/api/admin/access") return json({ admin: false, role: "admin" });
    throw new Error("Unexpected request");
  } });
  const data = await service.getDashboard();
  assert.deepEqual(data.ownerships, []);
  assert.deepEqual(data.veilings, []);
  assert.equal(await service.getAdminAccess(), false);
  assert.equal(service.getCapabilities().claims, false);
  for (const { options } of calls) {
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.mode, "same-origin");
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.apikey, undefined);
    assert.equal(options.body, undefined);
  }
  auth.invalidateSession();
});

await test("cross-account projections, unowned definitions and unsafe artwork URLs are rejected", async () => {
  const auth = await signedIn();
  const incompatible = [];
  incompatible.push({ ...dashboard(), profile: { ...user, id: otherId } });
  incompatible.push({ ...dashboard(), ownerships: [{ userId: otherId, veilingId }] });
  incompatible.push({ ...dashboard(), userAchievements: [{ userId: otherId }] });
  incompatible.push({ ...dashboard(), veilings: [{ id: veilingId, artwork: [] }] });
  for (const url of ["https://private.invalid/image.png", "//private.invalid/image.png", "/api/artwork/../../secret",
    `/api/artwork/${artworkId}?token=private-provider-detail`]) {
    incompatible.push({ ...dashboard(), ownerships: [{ userId, veilingId }], veilings: [{ id: veilingId, artwork: [{ url }] }] });
  }
  for (const snapshot of incompatible) {
    const service = createSpinariumService(config, auth, { fetchImpl: async () => json(snapshot) });
    await rejectCode(service.getDashboard(), "INVALID_PROJECTION", SpinariumServiceError);
  }
  auth.invalidateSession();
});

await test("session changes during a response discard its collection and catalog state", async () => {
  const auth = await signedIn();
  const service = createSpinariumService(config, auth, { fetchImpl: async () => {
    auth.invalidateSession(); return json(dashboard());
  } });
  await rejectCode(service.getDashboard(), "AUTH_REQUIRED", SpinariumServiceError);
  assert.equal(auth.getSession(), null);
});

await test("backend rejection clears expired sessions and never exposes server error text", async () => {
  const auth = await signedIn();
  const unauthorized = createSpinariumService(config, auth, { fetchImpl: async () => json({ error: "private-provider-detail" }, 401) });
  await rejectCode(unauthorized.getDashboard(), "AUTH_REQUIRED", SpinariumServiceError);
  assert.equal(auth.getSession(), null);
  const next = await signedIn();
  for (const [status, code] of [[403, "ACCESS_DENIED"], [409, "STALE_REVISION"], [428, "REVISION_REQUIRED"],
    [429, "RATE_LIMITED"], [503, "BACKEND_UNAVAILABLE"], [500, "BACKEND_ERROR"]]) {
    const service = createSpinariumService(config, next, { fetchImpl: async () => json({ error: "private-provider-detail" }, status) });
    await rejectCode(service.saveVeiling(editorInput), code, SpinariumServiceError);
  }
  const duplicate = createSpinariumService(config, next, {
    fetchImpl: async () => json({ code: "NUMBER_IN_USE", message: "private-provider-detail" }, 409),
  });
  await rejectCode(duplicate.saveVeiling(editorInput), "NUMBER_IN_USE", SpinariumServiceError);
  next.invalidateSession();
});

await test("catalog writes allowlist fields, preserve server revision and use If-Match for edits", async () => {
  const auth = await signedIn();
  const calls = [];
  const service = createSpinariumService(config, auth, { fetchImpl: async (path, options) => {
    calls.push({ path, options });
    return json(options.method === "GET" ? [{ ...row(), user_id: otherId, role: "admin" }] : row(options.method === "PATCH" ? 2 : 1));
  } });
  const list = await service.listAdminVeilings();
  assert.equal(list[0].revision, 1);
  assert.equal("role" in list[0], false);
  assert.equal("user_id" in list[0], false);
  const created = await service.saveVeiling({ ...editorInput, role: "admin", user_id: otherId,
    ownerships: [{ userId, veilingId }], artwork_path: "untrusted-path" });
  assert.equal(created.id, veilingId);
  assert.equal(created.revision, 1);
  const saved = await service.saveVeiling({ ...editorInput, id: veilingId, revision: 1 });
  assert.equal(saved.revision, 2);
  assert.equal(calls[1].path, "/api/admin/veilings");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.headers["If-Match"], undefined);
  assert.equal(calls[2].path, `/api/admin/veilings/${veilingId}`);
  assert.equal(calls[2].options.method, "PATCH");
  assert.equal(calls[2].options.headers["If-Match"], '"1"');
  for (const call of calls.slice(1)) {
    assert.deepEqual(Object.keys(JSON.parse(call.options.body)).sort(), ["description", "edition", "name", "number", "rarity", "status"]);
    assert.equal(call.options.headers["x-csrf-token"], csrfToken);
  }
  const count = calls.length;
  await rejectCode(service.saveVeiling({ ...editorInput, id: veilingId }), "REVISION_REQUIRED", SpinariumServiceError);
  await rejectCode(service.saveVeiling({ ...editorInput, id: "../other", revision: 1 }), "INVALID_INPUT", SpinariumServiceError);
  assert.equal(calls.length, count);
  auth.invalidateSession();
});

await test("artwork uploads send raw validated content with revision and cannot choose storage keys", async () => {
  const auth = await signedIn();
  const calls = [];
  const service = createSpinariumService(config, auth, { fetchImpl: async (path, options) => {
    calls.push({ path, options }); return json(row(2));
  } });
  const file = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], { type: "image/png" });
  await rejectCode(service.uploadArtwork({ veilingId, file }), "REVISION_REQUIRED", SpinariumServiceError);
  await rejectCode(service.uploadArtwork({ veilingId, revision: 1, file: new Blob(["<svg/>"], { type: "image/png" }) }), "INVALID_INPUT", SpinariumServiceError);
  await rejectCode(service.uploadArtwork({ veilingId, revision: 1, file: { type: "image/png", size: 8388609, slice() {} } }), "INVALID_INPUT", SpinariumServiceError);
  assert.equal(calls.length, 0);
  const saved = await service.uploadArtwork({ veilingId, revision: 1, file, storagePath: "untrusted" });
  assert.equal(saved.revision, 2);
  assert.equal(calls[0].path, `/api/admin/veilings/${veilingId}/artwork`);
  assert.equal(calls[0].options.body, file);
  assert.equal(calls[0].options.headers["Content-Type"], "image/png");
  assert.equal(calls[0].options.headers["If-Match"], '"1"');
  assert.equal(calls[0].options.headers["x-csrf-token"], csrfToken);
  auth.invalidateSession();
});

await test("session logout during artwork inspection prevents dispatch", async () => {
  const auth = await signedIn();
  let calls = 0;
  const service = createSpinariumService(config, auth, { fetchImpl: async () => { calls++; return json(row()); } });
  const file = { type: "image/png", size: 12, slice: () => ({ async arrayBuffer() {
    auth.invalidateSession(); return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
  } }) };
  await rejectCode(service.uploadArtwork({ veilingId, revision: 1, file }), "AUTH_REQUIRED", SpinariumServiceError);
  assert.equal(calls, 0);
});

await test("preview admin login grants no real authentication, ownership or admin capability", async () => {
  const { auth, service } = createPreviewAccess();
  await auth.signIn({ email: "admin", password: "1234" });
  assert.equal(auth.getSession().flow, "preview");
  assert.equal(auth.getAccessToken(), null);
  assert.equal(await service.getAdminAccess(), false);
  assert.equal(service.getCapabilities().authentication, false);
  assert.equal(service.getCapabilities().claims, false);
  assert.deepEqual((await service.getDashboard()).ownerships, []);
  assert.deepEqual((await service.getDashboard()).veilings, []);
  assert.equal("saveVeiling" in service, false);
  const worker = createSpinariumService(config, auth, { fetchImpl: async () => { throw new Error("Preview must not authorize backend calls"); } });
  await rejectCode(worker.getDashboard(), "AUTH_REQUIRED", SpinariumServiceError);
  const app = await readFile(new URL("../spinarium/app.js", import.meta.url), "utf8");
  assert(app.includes('./auth/cloudflare-auth.js'));
  assert(app.includes('./data/cloudflare-service.js'));
  assert.equal(app.includes('./auth/supabase-auth.js'), false);
  assert.equal(app.includes('./data/supabase-service.js'), false);
  await auth.signOut();
});

console.log(`PASS ${passed} isolated Cloudflare browser adapter checks; no hosted provider or backend was contacted`);
