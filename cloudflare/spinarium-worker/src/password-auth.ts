import { HttpError, json, readJson } from './http';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password-hash';
import {
  applicationConfig, assertRequestOrigin, clearCookie, cookie, epoch, hashToken,
  readCookie, requireCsrf, requireSession, SESSION_COOKIE, SESSION_TTL,
  sessionProjection, token, type AuthSession,
} from './session';
import type { Env } from './types';

const LOCAL_ISSUER = 'urn:spinarium:password';

function invalidInput(): never {
  throw new HttpError(400, 'INVALID_INPUT', 'Use a valid email-shaped account name and a password of 15 to 128 characters.');
}
function invalidCredentials(): never {
  throw new HttpError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
}
function malformedUnicode(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0)!;
    return point >= 0xd800 && point <= 0xdfff;
  });
}
export function validatePassword(value: unknown): string {
  if (typeof value !== 'string') invalidInput();
  const characters = Array.from(value).length;
  if (characters < 15 || characters > 128 || new TextEncoder().encode(value).byteLength > 512 || !value.trim() || malformedUnicode(value)) invalidInput();
  return value;
}
function mutationOrigin(request: Request, env: Env): void {
  const config = applicationConfig(env);
  assertRequestOrigin(request, config);
  if (request.headers.get('Origin') !== config.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new HttpError(403, 'ORIGIN_DENIED', 'This request origin is not allowed.');
  }
}

async function credentials(request: Request, signup: boolean): Promise<{ email: string; password: string; displayName: string }> {
  const value = await readJson(request, 8192);
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidInput();
  const body = value as Record<string, unknown>;
  const expected = signup ? ['email', 'password', 'displayName'] : ['email', 'password'];
  if (Object.keys(body).some((key) => !expected.includes(key))) invalidInput();
  if (typeof body.email !== 'string' || typeof body.password !== 'string') invalidInput();
  // No provider aliases, plus-tag stripping, domain rewriting or cross-provider linking.
  const email = body.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\u0000-\u001f\u007f]/.test(email) || malformedUnicode(email)) invalidInput();
  const password = validatePassword(body.password);
  let displayName = '';
  if (signup) {
    if (typeof body.displayName !== 'string') invalidInput();
    displayName = body.displayName.trim();
    if (!displayName || Array.from(displayName).length > 120 || /[\u0000-\u001f\u007f]/.test(displayName) || malformedUnicode(displayName)) invalidInput();
  }
  return { email, password, displayName };
}

async function limit(request: Request, env: Env, email: string, signup: boolean): Promise<void> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unavailable';
  if (ip.length > 64) throw new HttpError(400, 'INVALID_INPUT', 'Invalid request.');
  const now = epoch();
  const windowStart = Math.floor(now / 900) * 900;
  const db = env.DB.withSession('first-primary');
  const operation = signup ? 'signup' : 'login';
  const keys = [
    { key: await hashToken(`password:${operation}:ip:${ip}`), maximum: signup ? 5 : 30 },
    { key: await hashToken(`password:${operation}:account:${email}`), maximum: signup ? 5 : 10 },
  ];
  // Consume/check the IP budget first. A blocked IP cannot keep creating new
  // per-account rows by varying email-shaped names on rejected requests.
  for (const { key, maximum } of keys) {
    const result = await db.prepare(`
    INSERT INTO auth_rate_limits (key, hits, window_start) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      hits = CASE WHEN window_start = excluded.window_start THEN hits + 1 ELSE 1 END,
      window_start = excluded.window_start
    RETURNING hits
  `).bind(key, windowStart).first<{ hits: number }>();
    if (!result || result.hits > maximum) {
      throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Wait a few minutes before trying again.');
    }
  }
  // Bound cleanup work and run it on normal logins too, including when signup
  // is closed. The expiry indexes keep these small batches inexpensive.
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)').bind(now),
    db.prepare('DELETE FROM auth_rate_limits WHERE key IN (SELECT key FROM auth_rate_limits WHERE window_start < ? ORDER BY window_start LIMIT 100)').bind(now - 86400),
  ]);
}

function issuedSession(userId: string, displayName: string, createdAt: number, csrfToken: string, expiresAt: number): AuthSession {
  return { userId, displayName, memberSince: new Date(createdAt * 1000).toISOString(), csrfToken, expiresAt, sessionTokenHash: '' };
}

async function removePrevious(request: Request, env: Env): Promise<void> {
  const previous = readCookie(request, SESSION_COOKIE);
  if (previous) await env.DB.withSession('first-primary').prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hashToken(previous)).run();
}

async function signup(request: Request, env: Env): Promise<Response> {
  if (env.SIGNUP_ENABLED !== 'true') throw new HttpError(503, 'SIGNUP_DISABLED', 'Registration is not enabled yet.');
  mutationOrigin(request, env);
  const { email, password, displayName } = await credentials(request, true);
  await limit(request, env, email, true);
  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();
  const rawToken = token();
  const csrfToken = token();
  const now = epoch();
  const expiresAt = now + SESSION_TTL;
  const db = env.DB.withSession('first-primary');
  try {
    // D1 batch is transactional. A duplicate credential rolls back the user and
    // session as well, including concurrent signups. Catalog/ownership are absent.
    await db.batch([
      db.prepare(`INSERT INTO users (id, oidc_issuer, oidc_subject, display_name, disabled, created_at, updated_at, last_login_at)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?)`).bind(userId, LOCAL_ISSUER, userId, displayName, now, now, now),
      db.prepare(`INSERT INTO password_accounts (user_id, email_normalized, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`).bind(userId, email, passwordHash, now, now),
      db.prepare(`INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)`).bind(await hashToken(rawToken), userId, csrfToken, now, expiresAt),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: password_accounts\.email_normalized/.test(error.message)) {
      throw new HttpError(400, 'ACCOUNT_UNAVAILABLE', 'An account could not be created with those details.');
    }
    throw error;
  }
  await removePrevious(request, env);
  return json(sessionProjection(issuedSession(userId, displayName, now, csrfToken, expiresAt)), 201,
    { 'Set-Cookie': cookie(SESSION_COOKIE, rawToken, SESSION_TTL) });
}

async function login(request: Request, env: Env): Promise<Response> {
  mutationOrigin(request, env);
  const { email, password } = await credentials(request, false);
  await limit(request, env, email, false);
  const db = env.DB.withSession('first-primary');
  const account = await db.prepare(`SELECT p.user_id, p.password_hash, u.disabled, u.display_name, u.created_at
    FROM password_accounts p JOIN users u ON u.id = p.user_id WHERE p.email_normalized = ?`)
    .bind(email).first<{ user_id: string; password_hash: string; disabled: number; display_name: string; created_at: number }>();
  const matches = await verifyPassword(password, account?.password_hash ?? DUMMY_HASH);
  if (!account || !matches || account.disabled !== 0) invalidCredentials();
  const rawToken = token();
  const csrfToken = token();
  const now = epoch();
  const expiresAt = now + SESSION_TTL;
  // Recheck account status AND the exact credential after the slow hash. Neither
  // a disabled account nor an in-flight password replacement can mint a session.
  const tokenHash = await hashToken(rawToken);
  const results = await db.batch([
    db.prepare(`INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at)
      SELECT ?, u.id, ?, ?, ? FROM users u JOIN password_accounts p ON p.user_id = u.id
      WHERE u.id = ? AND u.disabled = 0 AND p.password_hash = ?`)
      .bind(tokenHash, csrfToken, now, expiresAt, account.user_id, account.password_hash),
    // Record only a successful mint in the same transaction. Concurrent logins
    // cannot move this time backwards; login does not invalidate admin edits.
    db.prepare(`UPDATE users SET last_login_at = MAX(COALESCE(last_login_at, 0), ?)
      WHERE id = ? AND disabled = 0 AND EXISTS (
        SELECT 1 FROM sessions WHERE token_hash = ? AND user_id = users.id
      )`).bind(now, account.user_id, tokenHash),
  ]);
  if (results[0].meta.changes !== 1) invalidCredentials();
  await removePrevious(request, env);
  return json(sessionProjection(issuedSession(account.user_id, account.display_name, account.created_at, csrfToken, expiresAt)), 200,
    { 'Set-Cookie': cookie(SESSION_COOKIE, rawToken, SESSION_TTL) });
}

export async function handlePasswordAuth(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!['/api/auth/login', '/api/auth/signup', '/api/auth/session', '/api/auth/logout'].includes(path)) return null;
  assertRequestOrigin(request, applicationConfig(env));
  const method = path === '/api/auth/session' ? 'GET' : 'POST';
  if (request.method !== method) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not supported.');
  if (path === '/api/auth/signup') return signup(request, env);
  if (path === '/api/auth/login') return login(request, env);
  const session = await requireSession(request, env);
  if (path === '/api/auth/session') return json(sessionProjection(session));
  requireCsrf(request, env, session);
  await env.DB.withSession('first-primary').prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session.sessionTokenHash).run();
  return json({ signedOut: true }, 200, { 'Set-Cookie': clearCookie(SESSION_COOKIE) });
}
