/**
 * Supabase Auth REST adapter. The provider, not browser flags or user metadata,
 * validates identity. Tokens exist only in this closure and are never persisted.
 * There is deliberately no refresh-token persistence: reload/expiry requires
 * sign-in until a server-managed HttpOnly session layer is introduced.
 */

const EARLY_EXPIRY_MS = 30_000;
const MAX_SESSION_MS = 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGES = Object.freeze({
  NOT_CONFIGURED: "Accounts are not connected yet. Please check back soon.",
  INVALID_CONFIGURATION: "The account connection is unavailable. Please contact SpinDownGames.",
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_PASSWORD: "Use a password with at least 12 characters.",
  INVALID_CREDENTIALS: "Sign-in failed. Check your email and password and confirm your email.",
  RATE_LIMITED: "Too many requests. Please wait before trying again.",
  CHALLENGE_REQUIRED: "Account verification is required. Please try again later.",
  SESSION_EXPIRED: "Your session has ended. Please sign in again.",
  INVALID_CALLBACK: "This account link is invalid or has expired. Please request a new link.",
  NETWORK_ERROR: "The account service could not be reached. Please try again.",
  PROVIDER_ERROR: "The account service could not complete this request. Please try again.",
  CANCELLED: "The account request was cancelled.",
});

/** Safe errors contain neither provider response bodies nor submitted secrets. */
export class AuthError extends Error {
  constructor(code, { retryAfter = null } = {}) {
    super(MESSAGES[code] || MESSAGES.PROVIDER_ERROR);
    this.name = "AuthError";
    this.code = code in MESSAGES ? code : "PROVIDER_ERROR";
    this.retryAfter = retryAfter;
  }
}

function configuration(config) {
  const urlValue = config?.supabaseUrl;
  const key = config?.supabasePublishableKey;
  if (!urlValue && !key) return { error: "NOT_CONFIGURED" };
  if (typeof urlValue !== "string" || typeof key !== "string")
    return { error: "INVALID_CONFIGURATION" };
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    return { error: "INVALID_CONFIGURATION" };
  }
  if (
    url.protocol !== "https:" || url.username || url.password ||
    url.search || url.hash || url.pathname !== "/" ||
    key.length > 4096 || /\s/.test(key) || key.startsWith("sb_secret_")
  ) return { error: "INVALID_CONFIGURATION" };

  if (!/^sb_publishable_[a-zA-Z0-9_-]{20,}$/.test(key)) {
    // Legacy public keys carry role=anon. Decoding classifies configuration;
    // this never verifies a user JWT or grants any account permission.
    try {
      const parts = key.split(".");
      if (parts.length !== 3 || parts.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part)))
        return { error: "INVALID_CONFIGURATION" };
      const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      if (JSON.parse(globalThis.atob(payload)).role !== "anon")
        return { error: "INVALID_CONFIGURATION" };
    } catch {
      return { error: "INVALID_CONFIGURATION" };
    }
  }
  return { url: url.origin, key, error: null };
}

function credentials(email, password, newPassword = false) {
  const normalizedEmail = typeof email === "string" ? email.trim() : "";
  if (
    normalizedEmail.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  ) throw new AuthError("INVALID_EMAIL");
  validatePassword(password, newPassword);
  return { email: normalizedEmail, password };
}

function validatePassword(password, newPassword) {
  if (typeof password !== "string" || password.length > 4096 ||
    password.length < (newPassword ? 12 : 1))
    throw new AuthError(newPassword ? "INVALID_PASSWORD" : "INVALID_CREDENTIALS");
}

function publicUser(value) {
  if (!value || typeof value.id !== "string" || !UUID.test(value.id) ||
    typeof value.email !== "string" || value.email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) || value.is_anonymous === true)
    throw new AuthError("PROVIDER_ERROR");
  return Object.freeze({
    id: value.id,
    email: value.email,
    createdAt: typeof value.created_at === "string" &&
      Number.isFinite(Date.parse(value.created_at)) ? value.created_at : null,
    emailConfirmed: Boolean(value.email_confirmed_at),
  });
}

function safeRetryAfter(response) {
  const value = response.headers?.get?.("retry-after");
  if (typeof value !== "string" || !/^\d{1,6}$/.test(value)) return null;
  return Math.min(Number(value), 86_400);
}

/**
 * @param {{supabaseUrl:string,supabasePublishableKey:string}} config
 * @param {{fetchImpl?:typeof fetch,now?:()=>number}} options
 */
export function createAuthClient(config, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const connection = configuration(config);
  const listeners = new Set();
  let current = null;
  let operation = 0;
  let expiryTimer = null;

  function notify() {
    const session = current ? Object.freeze({
      user: current.user, expiresAt: current.expiresAt, flow: current.flow,
    }) : null;
    for (const listener of listeners) {
      // Consumer exceptions must neither leak a credential nor corrupt state.
      try { listener(session); } catch { /* consumers own their error UI */ }
    }
  }

  function clearSession() {
    current = null;
    if (expiryTimer !== null) globalThis.clearTimeout(expiryTimer);
    expiryTimer = null;
    notify();
  }

  function validSession() {
    if (current && current.expiresAt <= now() + EARLY_EXPIRY_MS) {
      operation += 1;
      clearSession();
    }
    return current;
  }

  function assertConfigured() {
    if (connection.error) throw new AuthError(connection.error);
    if (typeof fetchImpl !== "function") throw new AuthError("NETWORK_ERROR");
  }

  async function request(path, { method = "GET", body, token, signal } = {}) {
    assertConfigured();
    let response;
    try {
      response = await fetchImpl(`${connection.url}/auth/v1${path}`, {
        method,
        headers: {
          apikey: connection.key,
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch {
      throw new AuthError(signal?.aborted ? "CANCELLED" : "NETWORK_ERROR");
    }
    if (!response || typeof response.ok !== "boolean")
      throw new AuthError("PROVIDER_ERROR");
    if (response.status === 429)
      throw new AuthError("RATE_LIMITED", { retryAfter: safeRetryAfter(response) });
    if (response.status === 204 && response.ok) return null;
    if (!response.ok && token && (response.status === 401 || response.status === 403))
      throw new AuthError("SESSION_EXPIRED");
    if (!response.ok && path.startsWith("/token") && response.status === 401)
      throw new AuthError("INVALID_CREDENTIALS");

    let data;
    try { data = await response.json(); } catch {
      throw new AuthError("PROVIDER_ERROR");
    }
    if (!response.ok) {
      // Inspect only known machine error codes; never display provider text.
      if (data?.code === "captcha_failed" || data?.error_code === "captcha_failed")
        throw new AuthError("CHALLENGE_REQUIRED");
      if (data?.code === "weak_password" || data?.error_code === "weak_password")
        throw new AuthError("INVALID_PASSWORD");
      if (path.startsWith("/token") && (response.status === 400 || response.status === 401))
        throw new AuthError("INVALID_CREDENTIALS");
      throw new AuthError("PROVIDER_ERROR");
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new AuthError("PROVIDER_ERROR");
    return data;
  }

  async function adopt(data, flow, version, signal) {
    const token = data?.access_token;
    if (typeof token !== "string" || !token || token.length > 16_384 ||
      /\s/.test(token) || String(data?.token_type).toLowerCase() !== "bearer")
      throw new AuthError("INVALID_CALLBACK");
    const verified = publicUser(await request("/user", { token, signal }));
    if (version !== operation || signal?.aborted) throw new AuthError("CANCELLED");
    if (!verified.emailConfirmed) throw new AuthError("INVALID_CREDENTIALS");
    const expiresIn = Number(data.expires_in);
    const expiresAt = Number(data.expires_at);
    // Provider verifies the token. These values only shorten the local session;
    // no local timestamp ever authorizes a backend request.
    const deadlines = [now() + MAX_SESSION_MS];
    if (Number.isFinite(expiresIn) && expiresIn > 0) deadlines.push(now() + expiresIn * 1000);
    if (Number.isFinite(expiresAt) && expiresAt > 0) deadlines.push(expiresAt * 1000);
    const deadline = Math.min(...deadlines);
    if (deadline <= now() + EARLY_EXPIRY_MS) throw new AuthError("SESSION_EXPIRED");
    current = { token, user: verified, expiresAt: deadline, flow };
    if (expiryTimer !== null) globalThis.clearTimeout(expiryTimer);
    expiryTimer = globalThis.setTimeout(() => {
      if (current?.token === token) {
        operation += 1;
        clearSession();
      }
    }, Math.max(0, deadline - now() - EARLY_EXPIRY_MS));
    // Node contract verification should not stay alive for a browser session.
    expiryTimer?.unref?.();
    notify();
    return getSession();
  }

  function getSession() {
    const active = validSession();
    return active ? Object.freeze({
      user: active.user, expiresAt: active.expiresAt, flow: active.flow,
    }) : null;
  }

  async function signIn({ email, password, signal } = {}) {
    assertConfigured();
    const body = credentials(email, password);
    const version = ++operation;
    clearSession();
    const data = await request("/token?grant_type=password", { method: "POST", body, signal });
    return adopt(data, "signin", version, signal);
  }

  async function signUp({ email, password, signal } = {}) {
    assertConfigured();
    const body = credentials(email, password, true);
    const version = ++operation;
    clearSession();
    const data = await request("/signup", { method: "POST", body, signal });
    if (version !== operation || signal?.aborted) throw new AuthError("CANCELLED");
    if (!data.access_token) {
      // Identical outcome for existing addresses and pending registrations.
      return { confirmationRequired: true, session: null };
    }
    const session = await adopt(data, "signin", version, signal);
    return { confirmationRequired: false, session };
  }

  async function signOut() {
    const token = current?.token;
    ++operation;
    clearSession();
    if (!token) return;
    try {
      await request("/logout?scope=local", { method: "POST", token });
    } catch (error) {
      // Local state stays signed out even if provider revocation is unavailable.
      if (error.code !== "SESSION_EXPIRED") throw error;
    }
  }

  async function getCurrentUser({ signal } = {}) {
    const active = validSession();
    if (!active) return null;
    const version = operation;
    try {
      const user = publicUser(await request("/user", { token: active.token, signal }));
      if (version !== operation || signal?.aborted) throw new AuthError("CANCELLED");
      if (!user.emailConfirmed) throw new AuthError("SESSION_EXPIRED");
      if (user.id !== active.user.id) throw new AuthError("SESSION_EXPIRED");
      current.user = user;
      return user;
    } catch (error) {
      if (version === operation && error.code === "SESSION_EXPIRED") {
        ++operation;
        clearSession();
      }
      throw error;
    }
  }

  async function consumeAuthCallback({ url, replaceUrl, signal } = {}) {
    let callback;
    try { callback = new URL(url || globalThis.location?.href); } catch {
      throw new AuthError("INVALID_CALLBACK");
    }
    const fragment = new URLSearchParams(callback.hash.slice(1));
    const recognized = ["access_token", "refresh_token", "error", "error_code", "error_description"]
      .some((key) => fragment.has(key));
    if (!recognized) return { handled: false, flow: null, session: getSession() };
    // Remove callback secrets before checks, fetches, subscriptions, or UI work.
    callback.hash = "";
    const replace = replaceUrl || ((cleanUrl) => globalThis.history.replaceState(null, "", cleanUrl));
    try { replace(callback.href); } catch { throw new AuthError("INVALID_CALLBACK"); }
    const version = ++operation;
    clearSession();
    if (fragment.has("error") || fragment.has("error_code") || !fragment.has("access_token"))
      throw new AuthError("INVALID_CALLBACK");
    const flow = fragment.get("type") === "recovery" ? "recovery" : "confirmation";
    fragment.delete("refresh_token");
    const session = await adopt({
      access_token: fragment.get("access_token"),
      token_type: fragment.get("token_type"),
      expires_in: fragment.get("expires_in"),
      expires_at: fragment.get("expires_at"),
    }, flow, version, signal);
    return { handled: true, flow, session };
  }

  async function requestPasswordReset({ email, signal } = {}) {
    assertConfigured();
    const { email: normalizedEmail } = credentials(email, "validation-only");
    await request("/recover", { method: "POST", body: { email: normalizedEmail }, signal });
    // Never tell the caller whether this address belongs to an account.
    return { requested: true };
  }

  async function updatePassword({ password, signal } = {}) {
    validatePassword(password, true);
    const active = validSession();
    if (!active) throw new AuthError("SESSION_EXPIRED");
    const version = operation;
    publicUser(await request("/user", {
      method: "PUT", token: active.token, body: { password }, signal,
    }));
    if (version !== operation || signal?.aborted) throw new AuthError("CANCELLED");
    try {
      await signOut();
      return { updated: true, signOutConfirmed: true };
    } catch (error) {
      // The password update has already committed and local state is cleared.
      // Do not invite repeated updates merely because revocation was unreachable.
      if (error instanceof AuthError)
        return { updated: true, signOutConfirmed: false };
      throw error;
    }
  }

  return Object.freeze({
    configured: !connection.error,
    configurationError: connection.error ? MESSAGES[connection.error] : null,
    signIn, signUp, signOut, getSession, getCurrentUser,
    consumeAuthCallback, requestPasswordReset, updatePassword,
    // Data-service adapter only. Never pass this token to UI, analytics or logs.
    getAccessToken() { return validSession()?.token || null; },
    onAuthStateChange(listener) {
      if (typeof listener !== "function") throw new TypeError("An auth listener is required.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
