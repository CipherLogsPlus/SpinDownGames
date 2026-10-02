import * as oauth from 'oauth4webapi';
import { HttpError, json } from './http';
import type { Env } from './types';
import { handlePasswordAuth } from './password-auth';
import { applicationConfig, assertRequestOrigin, cookie, clearCookie, epoch, hashToken, readCookie, requireCsrf, requireSession, SESSION_COOKIE, SESSION_TTL, sessionProjection, token, TOKEN_PATTERN } from './session';
export { hashToken, requireCsrf, requireSession } from './session';
export type { AuthSession } from './session';

const ATTEMPT_COOKIE = '__Host-spinarium_oidc';
const ATTEMPT_TTL = 10 * 60;
const CALLBACK_PATH = '/api/auth/callback';

interface Attempt {
  nonce: string;
  code_verifier: string;
}

interface AuthConfig {
  origin: string;
  issuer: URL;
  client: oauth.Client;
  secret: string;
  callback: string;
  connection: string;
}

/** Only the test harness injects this dependency. HTTP input cannot select a transport. */
export interface AuthDependencies {
  fetch?: typeof fetch;
}

function authConfig(env: Env): AuthConfig {
  const { origin: configuredOrigin } = applicationConfig(env);
  try {
    const origin = new URL(configuredOrigin);
    const issuer = new URL(env.OIDC_ISSUER);
    if (origin.protocol !== 'https:' || origin.origin !== env.APP_ORIGIN || origin.username || origin.password) throw new Error();
    if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash) throw new Error();
    if (!env.OIDC_CLIENT_ID || env.OIDC_CLIENT_ID.length > 512 || !env.OIDC_CLIENT_SECRET || env.OIDC_CLIENT_SECRET.length > 4096) throw new Error();
    if (!env.AUTH0_CONNECTION || env.AUTH0_CONNECTION.length > 128 || /[\u0000-\u001f\u007f]/.test(env.AUTH0_CONNECTION)) throw new Error();
    return {
      origin: origin.origin,
      issuer,
      client: { client_id: env.OIDC_CLIENT_ID, id_token_signed_response_alg: 'RS256', [oauth.clockTolerance]: 30 },
      secret: env.OIDC_CLIENT_SECRET,
      callback: `${origin.origin}${CALLBACK_PATH}`,
      connection: env.AUTH0_CONNECTION,
    };
  } catch {
    throw new HttpError(503, 'authentication_unavailable', 'Account access is not configured.');
  }
}

async function rateLimit(request: Request, env: Env): Promise<void> {
  // CF-Connecting-IP is assigned by Cloudflare; it is never used as identity or authority.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unavailable';
  if (ip.length > 64) throw new HttpError(400, 'invalid_request', 'Invalid request.');
  const key = await hashToken(`oidc:${ip}`);
  const now = epoch();
  const windowStart = Math.floor(now / 300) * 300;
  const row = await env.DB.withSession('first-primary').prepare(`
    INSERT INTO auth_rate_limits (key, hits, window_start) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      hits = CASE WHEN window_start = excluded.window_start THEN hits + 1 ELSE 1 END,
      window_start = excluded.window_start
    RETURNING hits
  `).bind(key, windowStart).first<{ hits: number }>();
  if (!row || row.hits > 20) throw new HttpError(429, 'too_many_requests', 'Try signing in again in a few minutes.');
}

function boundedFetch(dependencies: AuthDependencies): typeof fetch {
  const transport = dependencies.fetch ?? fetch;
  return async (input, init) => {
    const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Invalid identity endpoint.');
    const response = await transport(input, { ...init, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if (response.status >= 300 && response.status < 400) throw new Error('Identity endpoint redirects are not allowed.');
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 131072) throw new Error('Identity response exceeds limit.');
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

async function provider(config: AuthConfig, transport: typeof fetch): Promise<oauth.AuthorizationServer> {
  const response = await oauth.discoveryRequest(config.issuer, { [oauth.customFetch]: transport });
  const metadata = await oauth.processDiscoveryResponse(config.issuer, response);
  for (const value of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
    if (!value) throw new Error('Identity endpoint missing.');
    const endpoint = new URL(value);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) throw new Error('Invalid identity endpoint.');
  }
  if (!metadata.code_challenge_methods_supported?.includes('S256')) throw new Error('Identity provider must support PKCE S256.');
  if (metadata.token_endpoint_auth_methods_supported && !metadata.token_endpoint_auth_methods_supported.includes('client_secret_basic')) {
    throw new Error('Identity provider must support confidential client authentication.');
  }
  return metadata;
}

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, { status: 303, headers });
}

async function login(request: Request, env: Env, config: AuthConfig, dependencies: AuthDependencies, signup: boolean): Promise<Response> {
  if (signup && env.SIGNUP_ENABLED !== 'true') throw new HttpError(503, 'signup_unavailable', 'Registration is not enabled yet.');
  const origin = request.headers.get('Origin');
  if (origin && origin !== config.origin) throw new HttpError(403, 'origin_rejected', 'This request origin is not allowed.');
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new HttpError(403, 'origin_rejected', 'Open Spinarium to sign in.');
  await rateLimit(request, env);
  const transport = boundedFetch(dependencies);
  let metadata: oauth.AuthorizationServer;
  try { metadata = await provider(config, transport); }
  catch { throw new HttpError(503, 'authentication_unavailable', 'The sign-in provider is unavailable.'); }
  const state = token();
  const browserBinding = token();
  const nonce = oauth.generateRandomNonce();
  const verifier = oauth.generateRandomCodeVerifier();
  const now = epoch();
  const db = env.DB.withSession('first-primary');
  await db.batch([
    db.prepare('DELETE FROM oidc_attempts WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM auth_rate_limits WHERE window_start < ?').bind(now - 86400),
    db.prepare('INSERT INTO oidc_attempts (state_hash, browser_hash, nonce, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await hashToken(state), await hashToken(browserBinding), nonce, verifier, now, now + ATTEMPT_TTL),
  ]);
  const target = new URL(metadata.authorization_endpoint!);
  target.searchParams.set('client_id', config.client.client_id);
  target.searchParams.set('redirect_uri', config.callback);
  target.searchParams.set('response_type', 'code');
  target.searchParams.set('scope', 'openid profile email');
  target.searchParams.set('connection', config.connection);
  if (signup) {
    target.searchParams.set('screen_hint', 'signup');
    target.searchParams.set('prompt', 'login');
  }
  target.searchParams.set('state', state);
  target.searchParams.set('nonce', nonce);
  target.searchParams.set('code_challenge', await oauth.calculatePKCECodeChallenge(verifier));
  target.searchParams.set('code_challenge_method', 'S256');
  target.searchParams.set('response_mode', 'query');
  return redirect(target.href, [cookie(ATTEMPT_COOKIE, browserBinding, ATTEMPT_TTL)]);
}

async function callback(request: Request, env: Env, config: AuthConfig, dependencies: AuthDependencies): Promise<Response> {
  const failure = (notice = 'failed') => redirect(`${config.origin}/spinarium/?auth=${notice}#signin`, [clearCookie(ATTEMPT_COOKIE)]);
  const url = new URL(request.url);
  const states = url.searchParams.getAll('state');
  const binding = readCookie(request, ATTEMPT_COOKIE);
  if (url.href.length > 4096 || states.length !== 1 || !TOKEN_PATTERN.test(states[0]) || !binding) return failure();
  await rateLimit(request, env);
  const db = env.DB.withSession('first-primary');
  // DELETE ... RETURNING makes consumption single-use even under simultaneous callbacks.
  const attempt = await db.prepare(`DELETE FROM oidc_attempts
    WHERE state_hash = ? AND browser_hash = ? AND expires_at > ? RETURNING nonce, code_verifier`)
    .bind(await hashToken(states[0]), await hashToken(binding), epoch()).first<Attempt>();
  if (!attempt) return failure();
  try {
    const transport = boundedFetch(dependencies);
    const metadata = await provider(config, transport);
    const parameters = oauth.validateAuthResponse(metadata, config.client, url, states[0]);
    const response = await oauth.authorizationCodeGrantRequest(metadata, config.client,
      oauth.ClientSecretBasic(config.secret), parameters, config.callback, attempt.code_verifier,
      { [oauth.customFetch]: transport });
    const tokens = await oauth.processAuthorizationCodeResponse(metadata, config.client, response, {
      expectedNonce: attempt.nonce, requireIdToken: true,
    });
    // Explicitly validate the JWS as well as issuer, audience, expiry, nonce and protocol checks.
    await oauth.validateApplicationLevelSignature(metadata, response, { [oauth.customFetch]: transport });
    const claims = oauth.getValidatedIdTokenClaims(tokens);
    if (!claims || !claims.sub || claims.sub.length > 255 || claims.iat > epoch() + 30 || epoch() - claims.iat > ATTEMPT_TTL + 30) return failure();
    if (claims.email_verified !== true || typeof claims.email !== 'string' || claims.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)) {
      return failure('verify-email');
    }
    const displayName = typeof claims.name === 'string'
      ? claims.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || 'Collector'
      : 'Collector';
    const now = epoch();
    // There is intentionally no ownership, achievement, discovery or administrator insertion.
    const user = await db.prepare(`INSERT INTO users
      (id, oidc_issuer, oidc_subject, display_name, disabled, created_at, updated_at)
      SELECT ?, ?, ?, ?, 0, ?, ?
      WHERE ? = 1 OR EXISTS (SELECT 1 FROM users WHERE oidc_issuer = ? AND oidc_subject = ?)
      ON CONFLICT(oidc_issuer, oidc_subject) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at
      RETURNING id, disabled`)
      .bind(crypto.randomUUID(), config.issuer.href, claims.sub, displayName, now, now,
        env.SIGNUP_ENABLED === 'true' ? 1 : 0, config.issuer.href, claims.sub)
      .first<{ id: string; disabled: number }>();
    if (!user || user.disabled !== 0) return failure();
    const rawToken = token();
    const expiresAt = now + SESSION_TTL;
    const result = await db.prepare(`INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at)
      SELECT ?, id, ?, ?, ? FROM users WHERE id = ? AND disabled = 0`)
      .bind(await hashToken(rawToken), token(), now, expiresAt, user.id).run();
    if (result.meta.changes !== 1) return failure();
    const previous = readCookie(request, SESSION_COOKIE);
    if (previous) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hashToken(previous)).run();
    return redirect(`${config.origin}/spinarium/`, [clearCookie(ATTEMPT_COOKIE), cookie(SESSION_COOKIE, rawToken, SESSION_TTL)]);
  } catch {
    // Never expose provider tokens, claim data, client secrets, or provider error payloads.
    return failure();
  }
}

export async function handleAuth(request: Request, env: Env, dependencies: AuthDependencies = {}): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!['/api/auth/login', '/api/auth/signup', CALLBACK_PATH, '/api/auth/session', '/api/auth/logout'].includes(path)) return null;
  const commonConfig = applicationConfig(env);
  assertRequestOrigin(request, commonConfig);
  if (env.AUTH_PROVIDER === 'password') return handlePasswordAuth(request, env);
  const config = authConfig(env);
  if (request.url.length > 4096) throw new HttpError(400, 'invalid_request', 'Invalid request.');
  const method = path === '/api/auth/logout' ? 'POST' : 'GET';
  if (request.method !== method) throw new HttpError(405, 'method_not_allowed', 'This method is not supported.');
  if (path === '/api/auth/login' || path === '/api/auth/signup') return login(request, env, config, dependencies, path === '/api/auth/signup');
  if (path === CALLBACK_PATH) return callback(request, env, config, dependencies);
  const session = await requireSession(request, env);
  if (path === '/api/auth/session') {
    return json(sessionProjection(session));
  }
  requireCsrf(request, env, session);
  const db = env.DB.withSession('first-primary');
  const binding = readCookie(request, ATTEMPT_COOKIE);
  const statements = [db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session.sessionTokenHash)];
  if (binding) statements.push(db.prepare('DELETE FROM oidc_attempts WHERE browser_hash = ?').bind(await hashToken(binding)));
  await db.batch(statements);
  const headers = new Headers();
  headers.append('Set-Cookie', clearCookie(SESSION_COOKIE));
  headers.append('Set-Cookie', clearCookie(ATTEMPT_COOKIE));
  return json({ signedOut: true }, 200, headers);
}
