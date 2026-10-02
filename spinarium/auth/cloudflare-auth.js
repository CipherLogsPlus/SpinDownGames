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
  SIGN_IN_FAILED: "Sign-in could not be completed. Please try again.",
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_PASSWORD: "Use a password with 15 to 128 characters.",
  INVALID_INPUT: "Check your account details and try again.",
  INVALID_CREDENTIALS: "Sign-in failed. Check your email and password.",
  ACCOUNT_UNAVAILABLE: "The account could not be created. Try signing in or use different account details.",
  PASSWORD_RESET_UNAVAILABLE: "This reset link is invalid or has expired. Ask an administrator for a new link.",
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
    !value.displayName.trim() || Array.from(value.displayName).length > 120)
    throw new AuthError("PROVIDER_ERROR");
  const user = { id: value.id, displayName: value.displayName };
  if (value.email != null) {
    if (typeof value.email !== "string" || value.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))
      throw new AuthError("PROVIDER_ERROR");
    user.email = value.email;
  }
  if (typeof value.memberSince === "string" && Number.isFinite(Date.parse(value.memberSince)))
    user.memberSince = value.memberSince;
  return Object.freeze(user);
}

function credentials(input, signup = false) {
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    /[\u0000-\u001f\u007f]/.test(email) || /[\uD800-\uDFFF]/u.test(email)) throw new AuthError("INVALID_EMAIL");
  const password = input?.password;
  if (typeof password !== "string" || Array.from(password).length < 15 ||
    Array.from(password).length > 128 || new TextEncoder().encode(password).byteLength > 512 ||
    !password.trim() || /[\uD800-\uDFFF]/u.test(password))
    throw new AuthError(signup ? "INVALID_PASSWORD" : "INVALID_CREDENTIALS");
  if (!signup) return { email, password };
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  if (!displayName || Array.from(displayName).length > 120 ||
    /[\u0000-\u001f\u007f]/.test(displayName) || /[\uD800-\uDFFF]/u.test(displayName)) throw new AuthError("INVALID_INPUT");
  return { email, password, displayName };
}

export function createAuthClient(config, {
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  const connection = config?.authProvider === "password"
    ? cloudflareConnection(config) : { error: "INVALID_CONFIGURATION" };
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
    const hadSession = current !== null;
    current = null;
    if (expiryTimer !== null) globalThis.clearTimeout(expiryTimer);
    expiryTimer = null;
    if (hadSession) notify();
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
  async function request(path, { method = "GET", signal, csrfToken, body = {} } = {}) {
    assertConfigured();
    if (signal?.aborted) throw new AuthError("CANCELLED");
    let response;
    try {
      response = await fetchImpl(`${connection.base}/auth${path}`, {
        method, credentials: "same-origin", mode: "same-origin",
        cache: "no-store", redirect: "error", referrerPolicy: "same-origin",
        headers: {
          Accept: "application/json",
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch { throw new AuthError(signal?.aborted ? "CANCELLED" : "NETWORK_ERROR"); }
    if (!response || typeof response.ok !== "boolean") throw new AuthError("PROVIDER_ERROR");
    if (response.status === 401) {
      if (path === "/session" || path === "/logout") return null;
      throw new AuthError("INVALID_CREDENTIALS");
    }
    if (response.status === 429) throw new AuthError("RATE_LIMITED");
    if (response.status === 503) throw new AuthError("UNAVAILABLE");
    if (response.status === 400) {
      let code;
      try { code = (await response.json())?.code; } catch { /* Only safe machine codes are read. */ }
      throw new AuthError(["ACCOUNT_UNAVAILABLE", "PASSWORD_RESET_UNAVAILABLE"].includes(code) ? code : "INVALID_INPUT");
    }
    // Never expose a backend response body or submitted credential in errors.
    if (!response.ok) throw new AuthError("PROVIDER_ERROR");
    if (response.status === 204) return null;
    let data;
    try { data = await response.json(); } catch { throw new AuthError("PROVIDER_ERROR"); }
    if (signal?.aborted) throw new AuthError("CANCELLED");
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new AuthError("PROVIDER_ERROR");
    return data;
  }
  async function refreshSession({ signal } = {}) {
    const version = ++operation;
    try {
      return adopt(await request("/session", { signal }), version, signal);
    } catch (error) {
      if (version === operation) clearSession();
      throw error;
    }
  }
  function adopt(data, version, signal) {
    if (version !== operation || signal?.aborted) throw new AuthError("CANCELLED");
    if (!data) { clearSession(); return null; }
    const user = publicUser(data.user);
    const expiresAt = typeof data.expiresAt === "string" ? Date.parse(data.expiresAt) : NaN;
    if (!CSRF.test(data.csrfToken) || !Number.isFinite(expiresAt)) throw new AuthError("PROVIDER_ERROR");
    if (expiresAt <= now()) throw new AuthError("SESSION_EXPIRED");
    if (expiryTimer !== null) globalThis.clearTimeout(expiryTimer);
    const session = Object.freeze({ user, flow: "password", expiresAt });
    current = { session, csrfToken: data.csrfToken };
    expiryTimer = globalThis.setTimeout(() => {
      if (current?.session === session) invalidateSession();
    }, Math.min(expiresAt - now(), 2_147_483_647));
    expiryTimer?.unref?.();
    notify();
    return session;
  }
  async function authenticate(path, input, signup = false) {
    assertConfigured();
    const version = ++operation;
    clearSession();
    try {
      const body = credentials(input, signup);
      const data = await request(path, { method: "POST", body, signal: input?.signal });
      return adopt(data, version, input?.signal);
    } catch (error) {
      if (version === operation) clearSession();
      throw error;
    }
  }
  async function signIn(options) { return authenticate("/login", options); }
  async function signUp(options) {
    assertConfigured();
    if (config.signupEnabled !== true) throw new AuthError("UNSUPPORTED");
    return authenticate("/signup", options, true);
  }
  async function signOut() {
    const csrfToken = current?.csrfToken;
    invalidateSession();
    if (!csrfToken) return;
    await request("/logout", { method: "POST", csrfToken });
  }
  async function resetPassword({ token, password, signal } = {}) {
    assertConfigured();
    const version = operation;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new AuthError("PASSWORD_RESET_UNAVAILABLE");
    // The same password bounds apply to signup and reset. No email is needed.
    credentials({ email: "reset@example.invalid", password, displayName: "Reset" }, true);
    const result = await request("/password-reset", { method: "POST", body: { token, password }, signal });
    if (result.passwordReset !== true) throw new AuthError("PROVIDER_ERROR");
    // Expiry can clear an old session while the public request is pending.
    // A newly authenticated identity belongs to a later operation instead.
    if (version !== operation && current !== null) throw new AuthError("CANCELLED");
    invalidateSession();
    return { passwordReset: true };
  }
  async function consumeAuthCallback(options = {}) {
    const callbackUrl = options.url || globalThis.location?.href;
    if (callbackUrl) {
      let callback;
      try { callback = new URL(callbackUrl); } catch { throw new AuthError("SIGN_IN_FAILED"); }
      if (callback.searchParams.has("auth")) {
        callback.searchParams.delete("auth");
        const replace = options.replaceUrl || ((cleanUrl) => globalThis.history.replaceState(null, "", cleanUrl));
        try { replace(callback.href); } catch { throw new AuthError("SIGN_IN_FAILED"); }
      }
    }
    if (connection.error) return { handled: false, session: null, flow: null };
    // Reloading uses only the server session, never local storage or URL claims.
    const session = await refreshSession(options);
    return { handled: Boolean(session), session, flow: session?.flow || null };
  }
  const unsupported = async () => { throw new AuthError("UNSUPPORTED"); };
  return Object.freeze({
    configured: !connection.error,
    configurationError: connection.error ? MESSAGES[connection.error] : null,
    signIn, signUp, signOut, resetPassword, getSession, consumeAuthCallback, invalidateSession,
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
