import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAuthClient, AuthError } from "../spinarium/auth/supabase-auth.js";
import { spinariumConfig } from "../spinarium/config.js";

// Test-only provider doubles. No account, password or token is fabricated in
// the shipped application; these responses exercise its trust boundaries.
const config = {
  supabaseUrl: "https://example-project.supabase.co",
  supabasePublishableKey: "sb_publishable_test-only-public-key-1234567890",
};
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const user = {
  id: userId,
  email: "collector@example.test",
  created_at: "2026-10-01T12:00:00Z",
  email_confirmed_at: "2026-10-01T12:01:00Z",
  user_metadata: { role: "superadmin", display_name: "Unsafe role claim" },
  app_metadata: { role: "superadmin" },
};
const accessToken = "test-only-access-token";
const password = "test-only-password-12345";
const tokenResponse = {
  access_token: accessToken,
  refresh_token: "test-only-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  // The user included in a token response is deliberately wrong. Only GET
  // /user is authoritative, and all privilege metadata must be discarded.
  user: { ...user, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
};
function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
function provider(handlers = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname.replace("/auth/v1", "") + new URL(url).search;
    const call = { path, ...options };
    calls.push(call);
    const route = `${options.method} ${path}`;
    const handler = handlers[route];
    if (handler) return handler(call);
    if (route === "POST /token?grant_type=password") return json(tokenResponse);
    if (route === "GET /user") return json(user);
    if (route === "POST /logout?scope=local") return new Response(null, { status: 204 });
    throw new Error("Unexpected test provider route");
  };
  return { fetchImpl, calls };
}
async function rejectsCode(promise, code, forbidden = []) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof AuthError);
    assert.equal(error.code, code);
    for (const secret of forbidden) {
      assert.equal(error.message.includes(secret), false);
      assert.equal(JSON.stringify(error).includes(secret), false);
    }
    assert.equal("cause" in error, false);
    return true;
  });
}

assert.equal(spinariumConfig.supabaseUrl, "");
assert.equal(spinariumConfig.supabasePublishableKey, "");
assert.ok(Object.isFrozen(spinariumConfig));
let disabledNetworkCalls = 0;
const disabled = createAuthClient(spinariumConfig, {
  fetchImpl() { disabledNetworkCalls += 1; throw new Error("Must not run"); },
});
assert.equal(disabled.configured, false);
assert.equal(disabled.getSession(), null);
await rejectsCode(disabled.signIn({ email: user.email, password }), "NOT_CONFIGURED");
assert.equal(disabledNetworkCalls, 0);

const legacyKey = (role) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.testSignature`;
};
for (const badConfig of [
  { ...config, supabaseUrl: "http://example-project.supabase.co" },
  { ...config, supabaseUrl: "https://user:password@example-project.supabase.co" },
  { ...config, supabaseUrl: `${config.supabaseUrl}/auth/v1` },
  { ...config, supabaseUrl: `${config.supabaseUrl}/?token=secret` },
  { ...config, supabasePublishableKey: "sb_secret_do-not-use-server-keys-here" },
  { ...config, supabasePublishableKey: legacyKey("service_role") },
  { ...config, supabasePublishableKey: "malformed-key" },
]) {
  assert.equal(createAuthClient(badConfig).configured, false);
}
assert.equal(createAuthClient({ ...config, supabasePublishableKey: legacyKey("anon") }).configured, true);

const basic = provider();
const auth = createAuthClient(config, basic);
const changes = [];
const unsubscribe = auth.onAuthStateChange((session) => changes.push(session));
const session = await auth.signIn({ email: ` ${user.email} `, password });
assert.equal(session.user.id, userId);
assert.equal(session.user.emailConfirmed, true);
assert.equal(session.flow, "signin");
assert.equal(auth.getAccessToken(), accessToken);
assert.deepEqual(Object.keys(session).sort(), ["expiresAt", "flow", "user"]);
assert.deepEqual(Object.keys(session.user).sort(), ["createdAt", "email", "emailConfirmed", "id"]);
assert.ok(Object.isFrozen(session));
assert.ok(Object.isFrozen(session.user));
assert.equal(JSON.stringify(session).includes(accessToken), false);
assert.equal(JSON.stringify(session).includes("refresh-token"), false);
assert.equal(JSON.stringify(session).includes("superadmin"), false);
assert.deepEqual(basic.calls.slice(0, 2).map((call) => call.path), ["/token?grant_type=password", "/user"]);
assert.deepEqual(JSON.parse(basic.calls[0].body), { email: user.email, password });
assert.equal(basic.calls[1].headers.Authorization, `Bearer ${accessToken}`);
assert.ok(basic.calls.every((call) => call.redirect === "error" && call.credentials === "omit" &&
  call.cache === "no-store" && call.referrerPolicy === "no-referrer"));
assert.equal((await auth.getCurrentUser()).id, userId);
await auth.signOut();
assert.equal(auth.getSession(), null);
assert.equal(auth.getAccessToken(), null);
assert.equal(basic.calls.at(-1).path, "/logout?scope=local");
unsubscribe();
const changeCount = changes.length;
await auth.signIn({ email: user.email, password });
assert.equal(changes.length, changeCount);
await auth.signOut();

// A token response or locally editable flags cannot create a trusted session.
const rejectedProvider = provider({
  "GET /user": () => new Response(null, { status: 401 }),
});
const rejectedAuth = createAuthClient(config, rejectedProvider);
await rejectsCode(rejectedAuth.signIn({ email: user.email, password }), "SESSION_EXPIRED");
assert.equal(rejectedAuth.getSession(), null);
const unconfirmed = createAuthClient(config, provider({
  "GET /user": () => json({ ...user, email_confirmed_at: null }),
}));
await rejectsCode(unconfirmed.signIn({ email: user.email, password }), "INVALID_CREDENTIALS");
assert.equal(unconfirmed.getSession(), null);

const signupProvider = provider({ "POST /signup": () => json(user) });
const signupAuth = createAuthClient(config, signupProvider);
assert.deepEqual(await signupAuth.signUp({ email: user.email, password }), {
  confirmationRequired: true, session: null,
});
assert.equal(signupAuth.getSession(), null);
assert.equal(signupProvider.calls.length, 1);
const signupImmediate = createAuthClient(config, provider({
  "POST /signup": () => json(tokenResponse),
}));
assert.equal((await signupImmediate.signUp({ email: user.email, password })).session.user.id, userId);
await signupImmediate.signOut();

const callbackEvents = [];
const callbackAuth = createAuthClient(config, {
  fetchImpl: async (url) => {
    if (new URL(url).pathname === "/auth/v1/logout")
      return new Response(null, { status: 204 });
    callbackEvents.push("provider verification");
    assert.equal(new URL(url).pathname, "/auth/v1/user");
    return json(user);
  },
});
const callbackUrl = `${config.supabaseUrl}/spinarium/#access_token=${accessToken}` +
  "&refresh_token=test-only-refresh-token&token_type=bearer&expires_in=3600&type=recovery";
const callback = await callbackAuth.consumeAuthCallback({
  url: callbackUrl,
  replaceUrl(cleanUrl) {
    assert.equal(new URL(cleanUrl).hash, "");
    assert.equal(cleanUrl.includes(accessToken), false);
    assert.equal(cleanUrl.includes("refresh-token"), false);
    callbackEvents.push("fragment cleared");
  },
});
assert.deepEqual(callbackEvents, ["fragment cleared", "provider verification"]);
assert.equal(callback.flow, "recovery");
assert.equal(callback.session.user.id, userId);
await callbackAuth.signOut();
assert.equal(callbackAuth.getSession(), null);
let unexpectedReplace = false;
assert.deepEqual(await callbackAuth.consumeAuthCallback({
  url: `${config.supabaseUrl}/spinarium/#collection`,
  replaceUrl() { unexpectedReplace = true; },
}), { handled: false, flow: null, session: null });
assert.equal(unexpectedReplace, false);

let disabledCallbackScrubbed = false;
await rejectsCode(disabled.consumeAuthCallback({
  url: callbackUrl,
  replaceUrl() { disabledCallbackScrubbed = true; },
}), "NOT_CONFIGURED");
assert.equal(disabledCallbackScrubbed, true);
let errorFragmentScrubbed = false;
await rejectsCode(callbackAuth.consumeAuthCallback({
  url: `${config.supabaseUrl}/spinarium/#error=expired&error_description=${accessToken}`,
  replaceUrl(cleanUrl) { errorFragmentScrubbed = new URL(cleanUrl).hash === ""; },
}), "INVALID_CALLBACK", [accessToken]);
assert.equal(errorFragmentScrubbed, true);
await rejectsCode(callbackAuth.consumeAuthCallback({ url: callbackUrl,
  replaceUrl() { throw new Error("History is unavailable"); },
}), "INVALID_CALLBACK");

// Signup and recovery never reveal whether an address exists. Provider text
// and transport failures can contain secrets; neither may reach public errors.
const recoveryProvider = provider({ "POST /recover": () => json({}) });
const recoveryAuth = createAuthClient(config, recoveryProvider);
assert.deepEqual(await recoveryAuth.requestPasswordReset({ email: user.email }), { requested: true });
assert.deepEqual(JSON.parse(recoveryProvider.calls[0].body), { email: user.email });
assert.equal(recoveryAuth.getSession(), null);
const unsafeProvider = provider({
  "POST /token?grant_type=password": () => json({ msg: `${password} ${accessToken}` }, 400),
});
await rejectsCode(createAuthClient(config, unsafeProvider).signIn({ email: user.email, password }),
  "INVALID_CREDENTIALS", [password, accessToken]);
await rejectsCode(createAuthClient(config, { fetchImpl() { throw new Error(accessToken); } })
  .signIn({ email: user.email, password }), "NETWORK_ERROR", [accessToken]);
const limited = createAuthClient(config, provider({
  "POST /token?grant_type=password": () => json({ msg: password }, 429, { "Retry-After": "120" }),
}));
await assert.rejects(limited.signIn({ email: user.email, password }), (error) => {
  assert.equal(error.code, "RATE_LIMITED");
  assert.equal(error.retryAfter, 120);
  assert.equal(error.message.includes(password), false);
  return true;
});
const captcha = createAuthClient(config, provider({
  "POST /signup": () => json({ error_code: "captcha_failed", msg: password }, 400),
}));
await rejectsCode(captcha.signUp({ email: user.email, password }), "CHALLENGE_REQUIRED", [password]);

// Failed logout cannot leave the local session authenticated.
const offlineLogout = createAuthClient(config, provider({
  "POST /logout?scope=local": () => { throw new Error(accessToken); },
}));
await offlineLogout.signIn({ email: user.email, password });
await rejectsCode(offlineLogout.signOut(), "NETWORK_ERROR", [accessToken]);
assert.equal(offlineLogout.getSession(), null);

const resetProvider = provider({ "PUT /user": () => json(user) });
const reset = createAuthClient(config, resetProvider);
await reset.signIn({ email: user.email, password });
assert.deepEqual(await reset.updatePassword({ password }), { updated: true, signOutConfirmed: true });
assert.equal(reset.getSession(), null);
assert.equal(resetProvider.calls.at(-2).method, "PUT");
assert.equal(resetProvider.calls.at(-1).path, "/logout?scope=local");
await rejectsCode(reset.updatePassword({ password }), "SESSION_EXPIRED");

// Expiry is fail-closed, even if a scheduled timer has not yet fired.
let clock = Date.now();
const expiry = createAuthClient(config, { ...provider(), now: () => clock });
await expiry.signIn({ email: user.email, password });
clock += 3_571_000;
assert.equal(expiry.getAccessToken(), null);
assert.equal(expiry.getSession(), null);

// A logout during provider verification invalidates that in-flight sign-in.
let finishVerification;
let verificationStarted;
const started = new Promise((resolve) => { verificationStarted = resolve; });
const race = createAuthClient(config, provider({
  "GET /user": () => {
    verificationStarted();
    return new Promise((resolve) => { finishVerification = () => resolve(json(user)); });
  },
}));
const pending = race.signIn({ email: user.email, password });
await started;
await race.signOut();
finishVerification();
await rejectsCode(pending, "CANCELLED");
assert.equal(race.getSession(), null);

const inputProvider = provider();
const inputAuth = createAuthClient(config, inputProvider);
await rejectsCode(inputAuth.signUp({ email: user.email, password: "short" }), "INVALID_PASSWORD");
await rejectsCode(inputAuth.signIn({ email: "invalid-address", password }), "INVALID_EMAIL");
assert.equal(inputProvider.calls.length, 0);

const source = await readFile(new URL("../spinarium/auth/supabase-auth.js", import.meta.url), "utf8");
assert.equal(/localStorage|sessionStorage|indexedDB|document\.cookie/.test(source), false);
assert.equal(/console\.(log|error|warn)/.test(source), false);
console.log("PASS Spinarium auth: provider-verified identities, account confirmation, secret-safe callbacks/errors, recovery, rate-limit handling, session expiry, race safety and no persistent tokens");
