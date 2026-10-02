/**
 * Same-origin Worker session adapter. Identity and permissions belong to the
 * server. The session cookie is HttpOnly; provider tokens never enter this UI.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CSRF = /^[a-zA-Z0-9_-]{32,256}$/;
const MESSAGES = Object.freeze({
  NOT_CONFIGURED: "Accounts are not connected yet. Please check back soon.",
  INVALID_CONFIGURATION: "The account connection is unavailable. Please contact SpinDownGames™.",
  SESSION_EXPIRED: "Your session has ended. Please sign in again.",
  RATE_LIMITED: "Too many requests. Please wait before trying again.",
  NETWORK_ERROR: "The account service could not be reached. Please try again.",
  PROVIDER_ERROR: "The account service could not complete this request. Please try again.",
  UNAVAILABLE: "Secure accounts are not available yet. Please check back soon.",
  UNSUPPORTED: "Account registration and password changes are not available here yet.",
  EMAIL_UNVERIFIED: "Verify your email address using the email from the account service, then sign in.",
  SIGN_IN_FAILED: "Sign-in could not be completed. Please try again.",
  CANCELLED: "The account request was cancelled.",
});

export class AuthError extends Error {
  constructor(code) {
    super(MESSAGES[code] || MESSAGES.PROVIDER_ERROR);
    this.name = "AuthError";
    this.code = code in MESSAGES ? code : "PROVIDER_ERROR";
  }
}

/** Absolute URLs and credential-bearing cross-origin configuration fail closed. */
export function cloudflareConnection(config) {
  if (config?.backend !== "cloudflare") return { error: "INVALID_CONFIGURATION" };
  if (config.apiBase === "" || config.apiBase == null) return { error: "NOT_CONFIGURED" };
  if (config.apiBase !== "/api") return { error: "INVALID_CONFIGURATION" };
  return { base: "/api", error: null };
}

function publicUser(value) {
  if (!value || !UUID.test(value.id) || typeof value.displayName !== "string" ||
    !value.displayName.trim() || value.displayName.length > 120)
    throw new AuthError("PROVIDER_ERROR");
  const user = { id: value.id, displayName: value.displayName };
  if (value.email != null) {
    if (typeof value.email !== "string" || value.email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))
      throw new AuthError("PROVIDER_ERROR");
    user.email = value.email;
  }
  if (typeof value.memberSince === "string" && Number.isFinite(Date.parse(value.memberSince)))
    user.memberSince = value.memberSince;
  return Object.freeze(user);
}

export function createAuthClient(config, {
  fetchImpl = globalThis.fetch,
  navigate = (path) => globalThis.location.assign(path),
  now = Date.now,
} = {}) {
  const connection = cloudflareConnection(config);
  const listeners = new Set();
  let current = null;
  let operation = 0;
  let expiryTimer = null;

  function notify() {
    for (const listener of listeners) {
      try { Promise.resolve(listener(current?.session || null)).catch(() => {}); }
      catch { /* Consumers own their error UI. */ }
    }
  }
  function clearSession() {
    current = null;
    if (expiryTimer !== null) globalThis.clearTimeout(expiryTimer);
    expiryTimer = null;
    notify();
  }
  function invalidateSession() { ++operation; clearSession(); }
  function getSession() {
    if (current && current.session.expiresAt <= now()) invalidateSession();
    return current?.session || null;
  }
  function assertConfigured() {
    if (connection.error) throw new AuthError(connection.error);
    if (typeof fetchImpl !== "function") throw new AuthError("NETWORK_ERROR");
  }
  async function request(path, { method = "GET", signal, csrfToken } = {}) {
    assertConfigured();
    let response;
    try {
      response = await fetchImpl(`${connection.base}/auth${path}`, {
        method, credentials: "same-origin", mode: "same-origin",
        cache: "no-store", redirect: "error", referrerPolicy: "same-origin",
        headers: {
          Accept: "application/json",
          ...(method === "POST" ? { "Content-Type": "application/json", "x-csrf-token": csrfToken } : {}),
        },
        ...(method === "POST" ? { body: "{}" } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch { throw new AuthError(signal?.aborted ? "CANCELLED" : "NETWORK_ERROR"); }
    if (!response || typeof response.ok !== "boolean") throw new AuthError("PROVIDER_ERROR");
    if (response.status === 401) return null;
    if (response.status === 429) throw new AuthError("RATE_LIMITED");
    if (response.status === 503) throw new AuthError("UNAVAILABLE");
    // Never expose a provider response body, callback, or credential in errors.
    if (!response.ok) throw new AuthError("PROVIDER_ERROR");
    if (response.status === 204) return null;
    let data;
    try { data = await response.json(); } catch { throw new AuthError("PROVIDER_ERROR"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new AuthError("PROVIDER_ERROR");
    return data;
  }
  async function refreshSession({ signal } = {}) {
    const version = ++operation;
    let data;
    try {
      data = await request("/session", { signal });
      if (version !== operation || signal?.aborted) throw new AuthError("CANCELLED");
      if (!data) { clearSession(); return null; }
      const user = publicUser(data.user);
      const expiresAt = typeof data.expiresAt === "string" ? Date.parse(data.expiresAt) : NaN;
      if (!CSRF.test(data.csrfToken) || !Number.isFinite(expiresAt)) throw new AuthError("PROVIDER_ERROR");
      if (expiresAt <= now()) throw new AuthError("SESSION_EXPIRED");
      if (expiryTimer !== null) globalThis.clearTimeout(expiryTimer);
      const session = Object.freeze({ user, flow: "oidc", expiresAt });
      current = { session, csrfToken: data.csrfToken };
      expiryTimer = globalThis.setTimeout(() => {
        if (current?.session === session) invalidateSession();
      }, Math.min(expiresAt - now(), 2_147_483_647));
      expiryTimer?.unref?.();
      notify();
      return session;
    } catch (error) {
      if (version === operation) clearSession();
      throw error;
    }
  }
  async function redirectTo(path, { signal } = {}) {
    assertConfigured();
    if (signal?.aborted) throw new AuthError("CANCELLED");
    invalidateSession();
    try { navigate(`${connection.base}/auth/${path}`); }
    catch { throw new AuthError("NETWORK_ERROR"); }
    return { redirecting: true };
  }
  async function signIn(options) { return redirectTo("login", options); }
  async function signUp(options) {
    assertConfigured();
    if (config.signupEnabled !== true) throw new AuthError("UNSUPPORTED");
    return redirectTo("signup", options);
  }
  async function signOut() {
    const csrfToken = current?.csrfToken;
    invalidateSession();
    if (!csrfToken) return;
    await request("/logout", { method: "POST", csrfToken });
  }
  async function consumeAuthCallback(options = {}) {
    let notice = null;
    const callbackUrl = options.url || globalThis.location?.href;
    if (callbackUrl) {
      let callback;
      try { callback = new URL(callbackUrl); } catch { throw new AuthError("SIGN_IN_FAILED"); }
      if (callback.searchParams.has("auth")) {
        const values = callback.searchParams.getAll("auth");
        if (values.length === 1) notice = values[0];
        callback.searchParams.delete("auth");
        const replace = options.replaceUrl || ((cleanUrl) => globalThis.history.replaceState(null, "", cleanUrl));
        try { replace(callback.href); } catch { throw new AuthError("SIGN_IN_FAILED"); }
      }
    }
    // These allowlisted notices provide feedback only. They cannot authenticate
    // a browser or replace server-side email verification/session authority.
    if (notice === "verify-email") throw new AuthError("EMAIL_UNVERIFIED");
    if (notice === "failed") throw new AuthError("SIGN_IN_FAILED");
    if (connection.error) return { handled: false, session: null, flow: null };
    // The Worker consumes provider callbacks and redirects to /spinarium/.
    // Reloading uses only the server session, never a token from the address.
    const session = await refreshSession(options);
    return { handled: Boolean(session), session, flow: session?.flow || null };
  }
  const unsupported = async () => { throw new AuthError("UNSUPPORTED"); };
  return Object.freeze({
    configured: !connection.error,
    configurationError: connection.error ? MESSAGES[connection.error] : null,
    signIn, signUp, signOut, getSession, consumeAuthCallback, invalidateSession,
    requestPasswordReset: unsupported, updatePassword: unsupported,
    async getCurrentUser(options) { return (await refreshSession(options))?.user || null; },
    getCsrfToken() { return getSession() ? current.csrfToken : null; },
    onAuthStateChange(listener) {
      if (typeof listener !== "function") throw new TypeError("An auth listener is required.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
