import { HttpError } from './http';
import type { Env } from './types';

export const SESSION_COOKIE = '__Host-spinarium_session';
export const SESSION_TTL = 8 * 60 * 60;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface AuthSession {
  userId: string;
  displayName: string;
  memberSince: string;
  csrfToken: string;
  sessionTokenHash: string;
  expiresAt: number;
}

export function epoch(): number { return Math.floor(Date.now() / 1000); }

export function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function hashToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header || header.length > 8192) return null;
  const values = header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return TOKEN_PATTERN.test(value) ? value : null;
}

export function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
export function clearCookie(name: string): string { return cookie(name, '', 0); }

/** Direct password sessions need only this application configuration, never an external identity service. */
export function applicationConfig(env: Env): { origin: string } {
  if (env.AUTH_ENABLED !== 'true') throw new HttpError(503, 'ACCOUNTS_DISABLED', 'Account access is not enabled yet.');
  try {
    const origin = new URL(env.APP_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== env.APP_ORIGIN || origin.username || origin.password) throw new Error();
    if (!['password', 'oidc'].includes(env.AUTH_PROVIDER)) throw new Error();
    return { origin: origin.origin };
  } catch { throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'Account access is not configured.'); }
}

export function assertRequestOrigin(request: Request, config: { origin: string }): void {
  if (new URL(request.url).origin !== config.origin) throw new HttpError(403, 'ORIGIN_DENIED', 'This request origin is not allowed.');
}

export function requireCsrf(request: Request, env: Env, session: AuthSession): void {
  const config = applicationConfig(env);
  assertRequestOrigin(request, config);
  if (request.headers.get('Origin') !== config.origin) throw new HttpError(403, 'ORIGIN_DENIED', 'This request origin is not allowed.');
  const value = request.headers.get('X-CSRF-Token') ?? '';
  const encoder = new TextEncoder();
  if (!TOKEN_PATTERN.test(value) || !crypto.subtle.timingSafeEqual(encoder.encode(value), encoder.encode(session.csrfToken))) {
    throw new HttpError(403, 'CSRF_REJECTED', 'Reload your session before continuing.');
  }
}

/** Always query the primary: disabled accounts and revoked sessions must stop immediately. */
export async function requireSession(request: Request, env: Env): Promise<AuthSession> {
  assertRequestOrigin(request, applicationConfig(env));
  const rawToken = readCookie(request, SESSION_COOKIE);
  if (!rawToken) throw new HttpError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
  const sessionTokenHash = await hashToken(rawToken);
  const row = await env.DB.withSession('first-primary').prepare(`
    SELECT s.user_id, s.csrf_token, s.expires_at, u.display_name, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0
  `).bind(sessionTokenHash, epoch()).first<{
    user_id: string; csrf_token: string; expires_at: number; display_name: string; created_at: number;
  }>();
  if (!row) throw new HttpError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
  return {
    userId: row.user_id, displayName: row.display_name,
    memberSince: new Date(row.created_at * 1000).toISOString(), csrfToken: row.csrf_token,
    sessionTokenHash, expiresAt: row.expires_at,
  };
}

export function sessionProjection(session: AuthSession) {
  return {
    user: { id: session.userId, displayName: session.displayName, memberSince: session.memberSince },
    csrfToken: session.csrfToken,
    expiresAt: new Date(session.expiresAt * 1000).toISOString(),
  };
}
