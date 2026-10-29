import { requireCsrf, requireSession } from './auth';
import { OWNER_ACTOR_GUARD, adminActorValues } from './admin-authorization';
import { getAdminRole } from './admin-accounts';
import { HttpError, json, readJson } from './http';
import { epoch, hashToken, token, TOKEN_PATTERN } from './session';
import type { Env } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL = 7 * 24 * 60 * 60;
const UNAVAILABLE = 'This code has expired, was already claimed, was revoked, or is unavailable.';
const claimUnavailable = () => new HttpError(409, 'CODE_UNAVAILABLE', UNAVAILABLE);

function objectId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new HttpError(400, 'INVALID_INPUT', 'Provide a valid Veiling identifier.');
  return value.toLowerCase();
}

async function owner(request: Request, env: Env) {
  const session = await requireSession(request, env);
  if (await getAdminRole(env, session.userId) !== 'owner')
    throw new HttpError(403, 'OWNER_REQUIRED', 'Only the Spinarium owner may manage private claim codes.');
  return session;
}

// Owner-only PILOT: a draft cannot issue codes; an active, UNPUBLISHED
// Ashenling #001 can issue one code at a time without a public showcase entry.
// Both issuance and redemption are restricted to the issuing owner account.
async function issue(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  const session = await owner(request, env);
  requireCsrf(request, env, session);
  const body = await readJson(request, 1024);
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !('veilingId' in body))
    throw new HttpError(400, 'INVALID_INPUT', 'Select Ashenling 001.');
  const veilingId = objectId((body as { veilingId: unknown }).veilingId);
  const secret = token(); // 256 bits from the runtime CSPRNG; returned exactly once.
  const now = epoch();
  const id = crypto.randomUUID();
  const result = await env.DB.withSession('first-primary').prepare(`INSERT INTO digital_claims
    (id, veiling_id, token_hash, issued_by, issued_at, expires_at)
    SELECT ?, v.id, ?, ?, ?, ? FROM catalog_veilings v
    WHERE v.id = ? AND lower(v.name) = 'ashenling'
      AND v.character_number = 1 AND v.rarity = 'Legacy' AND v.edition = 'Legacy'
      AND v.status = 'active' AND v.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM veiling_publications p WHERE p.veiling_id = v.id)
      AND NOT EXISTS (SELECT 1 FROM publication_audit a WHERE a.veiling_id = v.id)
      AND ${OWNER_ACTOR_GUARD}`)
    .bind(id, await hashToken(secret), session.userId, now, now + TTL, veilingId,
      ...adminActorValues(session)).run();
  if (result.meta.changes !== 1)
    throw new HttpError(409, 'PRIVATE_ASHENLING_REQUIRED',
      'Activate a private Ashenling 001 (Legacy rarity and edition) before issuing its pilot code.');
  // No code is persisted in plaintext or returned by later status lookups.
  return json({ schemaVersion: '1', claimId: id, veilingId, claimCode: secret,
    expiresAt: new Date((now + TTL) * 1000).toISOString() }, 201);
}

async function redeem(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  const session = await requireSession(request, env);
  requireCsrf(request, env, session);
  const body = await readJson(request, 1024);
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !('code' in body) ||
      typeof (body as { code: unknown }).code !== 'string' ||
      !TOKEN_PATTERN.test((body as { code: string }).code))
    throw new HttpError(400, 'INVALID_INPUT', 'Enter a valid one-time claim code.');
  const hash = await hashToken((body as { code: string }).code);
  const now = epoch();
  const ownershipId = crypto.randomUUID();
  const db = env.DB.withSession('first-primary');
  // The UPDATE, ownership INSERT, and discovery INSERT run in one D1 batch
  // transaction. changes() gates later writes on the immediately previous
  // statement. A second/replayed claimant can never mint another ownership.
  const results = await db.batch([
    db.prepare(`UPDATE digital_claims SET redeemed_by=?, redeemed_at=?, ownership_id=?
      WHERE token_hash=? AND issued_by=? AND redeemed_at IS NULL
        AND revoked_at IS NULL AND expires_at > unixepoch()
        AND EXISTS (SELECT 1 FROM catalog_veilings v
          WHERE v.id = digital_claims.veiling_id AND lower(v.name)='ashenling'
            AND v.character_number=1 AND v.rarity='Legacy' AND v.edition='Legacy'
            AND v.status='active' AND v.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM veiling_publications p WHERE p.veiling_id=v.id)
            AND NOT EXISTS (SELECT 1 FROM publication_audit a WHERE a.veiling_id=v.id))
        AND ${OWNER_ACTOR_GUARD}`)
      .bind(session.userId, now, ownershipId, hash, session.userId, ...adminActorValues(session)),
    db.prepare(`INSERT INTO ownerships(id,user_id,veiling_id,acquisition,acquired_at)
      SELECT ownership_id,redeemed_by,veiling_id,'server_grant',redeemed_at
      FROM digital_claims WHERE ownership_id=? AND redeemed_by=? AND redeemed_at=?
        AND changes()=1`).bind(ownershipId, session.userId, now),
    db.prepare(`INSERT INTO discoveries
      (veiling_id,status,first_discovered_at,first_discoverer_id,reveal_kind)
      SELECT veiling_id,'revealed',?,redeemed_by,'collector' FROM digital_claims
      WHERE ownership_id=? AND redeemed_by=? AND changes()=1
      ON CONFLICT(veiling_id) DO NOTHING`).bind(now, ownershipId, session.userId),
  ]);
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1)
    throw claimUnavailable();
  return json({ schemaVersion: '1', claimId: null, ownershipId, redeemed: true }, 201);
}

async function status(request: Request, env: Env, id: string): Promise<Response> {
  if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET.');
  const session = await owner(request, env);
  const row = await env.DB.withSession('first-primary').prepare(`SELECT id, veiling_id, issued_at,
    expires_at, redeemed_at, revoked_at, ownership_id FROM digital_claims
    WHERE id = ? AND issued_by = ?`).bind(objectId(id), session.userId).first<{
    id: string; veiling_id: string; issued_at: number; expires_at: number;
    redeemed_at: number | null; revoked_at: number | null; ownership_id: string | null;
  }>();
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'The claim record was not found.');
  return json({ schemaVersion: '1', claimId: row.id, veilingId: row.veiling_id,
    state: row.redeemed_at !== null ? 'redeemed' : row.revoked_at !== null ? 'revoked'
      : row.expires_at <= epoch() ? 'expired' : 'issued',
    issuedAt: new Date(row.issued_at * 1000).toISOString(),
    expiresAt: new Date(row.expires_at * 1000).toISOString(),
    ownershipId: row.ownership_id });
}

async function revoke(request: Request, env: Env, id: string): Promise<Response> {
  if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  const session = await owner(request, env);
  requireCsrf(request, env, session);
  const now = epoch();
  const result = await env.DB.withSession('first-primary').prepare(`UPDATE digital_claims
    SET revoked_at=? WHERE id=? AND issued_by=? AND redeemed_at IS NULL
      AND revoked_at IS NULL AND ${OWNER_ACTOR_GUARD}`)
    .bind(now, objectId(id), session.userId, ...adminActorValues(session)).run();
  if (result.meta.changes !== 1) throw claimUnavailable();
  return json({ schemaVersion: '1', claimId: id.toLowerCase(), state: 'revoked' });
}

export async function handleDigitalClaims(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/admin/digital-claims') return issue(request, env);
  if (path === '/api/digital-claims/redeem') return redeem(request, env);
  const match = /^\/api\/admin\/digital-claims\/([^/]+)(\/revoke)?$/.exec(path);
  if (match) return match[2] ? revoke(request, env, match[1]) : status(request, env, match[1]);
  return null;
}
