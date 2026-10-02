import { HttpError, json, readJson } from './http';
import { hashPassword } from './password-hash';
import { validatePassword } from './password-auth';
import { applicationConfig, assertRequestOrigin, clearCookie, epoch, hashToken, readCookie, SESSION_COOKIE, TOKEN_PATTERN } from './session';
import type { Env } from './types';

// Re-evaluate current authority, not the roles observed when a link was issued.
const VALID_RESET = `r.expires_at > ? AND target.disabled = 0 AND issuer.disabled = 0
  AND r.user_id != r.created_by AND NOT EXISTS (
    SELECT 1 FROM admin_allowlist protected WHERE protected.user_id = r.user_id AND protected.role = 'owner'
  ) AND (actor.role = 'owner' OR NOT EXISTS (
    SELECT 1 FROM admin_allowlist target_admin WHERE target_admin.user_id = r.user_id
  ))`;
const RESET_JOINS = `password_resets r JOIN users target ON target.id = r.user_id
  JOIN password_accounts credential ON credential.user_id = target.id
  JOIN users issuer ON issuer.id = r.created_by
  JOIN admin_allowlist actor ON actor.user_id = issuer.id`;

function unavailable(): never {
  throw new HttpError(400, 'PASSWORD_RESET_UNAVAILABLE', 'This password-reset link is unavailable. Request a new link from an administrator.');
}

async function rateLimit(env: Env, value: string, maximum: number): Promise<void> {
  const now = epoch();
  const row = await env.DB.withSession('first-primary').prepare(`
    INSERT INTO auth_rate_limits(key,hits,window_start) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET hits = CASE WHEN window_start = excluded.window_start THEN hits + 1 ELSE 1 END,
      window_start = excluded.window_start RETURNING hits
  `).bind(await hashToken(value), Math.floor(now / 900) * 900).first<{ hits: number }>();
  if (!row || row.hits > maximum) throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Wait a few minutes before trying again.');
}

export async function handlePasswordReset(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/auth/password-reset') return null;
  if (env.AUTH_PROVIDER !== 'password') throw new HttpError(404, 'NOT_FOUND', 'This endpoint does not exist.');
  const { origin } = applicationConfig(env);
  assertRequestOrigin(request, { origin });
  if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not supported.');
  if (request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new HttpError(403, 'ORIGIN_DENIED', 'This request origin is not allowed.');
  }
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unavailable';
  if (ip.length > 64) unavailable();
  // Check the IP before storing per-token keys or performing any expensive hash.
  await rateLimit(env, `password-reset:ip:${ip}`, 20);
  const value = await readJson(request, 8192);
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['token', 'password'].includes(key)) || typeof body.token !== 'string' || !TOKEN_PATTERN.test(body.token)) unavailable();
  const password = validatePassword(body.password);
  const tokenHash = await hashToken(body.token);
  await rateLimit(env, `password-reset:token:${tokenHash}`, 5);
  const db = env.DB.withSession('first-primary');
  const reset = await db.prepare(`SELECT r.user_id FROM ${RESET_JOINS}
    WHERE r.token_hash = ? AND ${VALID_RESET}`).bind(tokenHash, epoch()).first<{ user_id: string }>();
  if (!reset) unavailable();
  const passwordHash = await hashPassword(password);
  const now = epoch();
  const eventId = crypto.randomUUID();
  const currentCookie = readCookie(request, SESSION_COOKIE);
  const currentTokenHash = currentCookie ? await hashToken(currentCookie) : null;
  // The successful conditional password update creates a unique audit marker.
  // Every later mutation is guarded by that marker, all in one transaction.
  // Concurrent redemption or an intervening role/disable/revoke leaves no marker.
  const results = await db.batch([
    db.prepare(`UPDATE password_accounts SET password_hash = ?, updated_at = ?
      WHERE user_id = ? AND EXISTS (
        SELECT 1 FROM ${RESET_JOINS} WHERE r.token_hash = ? AND r.user_id = password_accounts.user_id AND ${VALID_RESET}
      )`).bind(passwordHash, now, reset.user_id, tokenHash, now),
    db.prepare(`INSERT INTO account_audit(id,target_user_id,actor_user_id,action,reason,before_json,after_json,created_at)
      SELECT ?,id,NULL,'password_reset_completed','A one-time administrator-issued password-reset link was redeemed.',
        json_object('displayName',display_name,'disabled',json(CASE disabled WHEN 1 THEN 'true' ELSE 'false' END),'revision',account_revision),
        json_object('displayName',display_name,'disabled',json(CASE disabled WHEN 1 THEN 'true' ELSE 'false' END),'revision',account_revision+1),?
      FROM users WHERE id = ? AND changes() = 1`).bind(eventId, now, reset.user_id),
    db.prepare(`UPDATE users SET account_revision = account_revision + 1, updated_at = ?
      WHERE id = ? AND EXISTS(SELECT 1 FROM account_audit WHERE id = ? AND target_user_id = users.id)`)
      .bind(now, reset.user_id, eventId),
    db.prepare(`DELETE FROM sessions WHERE (user_id = ? OR token_hash = ?) AND EXISTS(SELECT 1 FROM account_audit WHERE id = ?)`)
      .bind(reset.user_id, currentTokenHash, eventId),
    db.prepare(`DELETE FROM password_resets WHERE user_id = ? AND EXISTS(SELECT 1 FROM account_audit WHERE id = ?)`)
      .bind(reset.user_id, eventId),
  ]);
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) unavailable();
  // Reset changes no login activity timestamp and grants no automatic session.
  // A browser may have arrived while signed into another account. End only
  // that supplied browser session too, so refresh cannot restore an old login.
  return json({ passwordReset: true }, 200, { 'Set-Cookie': clearCookie(SESSION_COOKIE) });
}
