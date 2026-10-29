import { requireCsrf, requireSession } from './auth';
import { OWNER_ACTOR_GUARD, adminActorValues } from './admin-authorization';
import { getAdminRole } from './admin-accounts';
import { HttpError, json, readJson } from './http';
import { epoch, hashToken, token, TOKEN_PATTERN } from './session';
import type { Env } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL = 7 * 24 * 60 * 60;

// Only the account owner may create a secret, and only for an intentionally
// published, active Ashenling. Publishing a draft does not issue an item.
async function issue(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  const session = await requireSession(request, env);
  requireCsrf(request, env, session);
  if (await getAdminRole(env, session.userId) !== 'owner')
    throw new HttpError(403, 'OWNER_REQUIRED', 'The account owner must issue a pilot code.');
  const input = await readJson(request, 1024);
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== 1 || typeof (input as { veilingId?: unknown }).veilingId !== 'string' ||
      !UUID.test((input as { veilingId: string }).veilingId))
    throw new HttpError(400, 'INVALID_INPUT', 'Select the published Ashenling.');
  const veilingId = (input as { veilingId: string }).veilingId.toLowerCase();
  const db = env.DB.withSession('first-primary');
  const secret = token();
  const now = epoch();
  const id = crypto.randomUUID();
  const result = await db.prepare(`INSERT INTO digital_claims
    (id,veiling_id,token_hash,issued_by,issued_at,expires_at)
    SELECT ?,v.id,?,?,?,? FROM catalog_veilings v
    JOIN veiling_publications p ON p.veiling_id=v.id
    WHERE v.id=? AND lower(v.name)='ashenling' AND lower(p.name)='ashenling'
      AND v.status='active' AND p.visibility='public'
      AND ${OWNER_ACTOR_GUARD}`)
    .bind(id, await hashToken(secret), session.userId, now, now + TTL,
      veilingId, ...adminActorValues(session)).run();
  if (result.meta.changes !== 1)
    throw new HttpError(409, 'PUBLICATION_REQUIRED', 'Publish an active Ashenling before issuing a code.');
  // Returned once only. Never expose the hash, stored records, or the code in logs.
  return json({ schemaVersion: '1', veilingId, claimCode: secret,
    expiresAt: new Date((now + TTL) * 1000).toISOString() }, 201);
}

async function redeem(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  const session = await requireSession(request, env);
  requireCsrf(request, env, session);
  const input = await readJson(request, 1024);
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== 1 || !TOKEN_PATTERN.test((input as { code?: unknown }).code as string))
    throw new HttpError(400, 'INVALID_INPUT', 'Enter a valid one-time digital code.');
  const hash = await hashToken((input as { code: string }).code);
  const now = epoch();
  const ownershipId = crypto.randomUUID();
  const db = env.DB.withSession('first-primary');
  // D1 batch statements execute atomically. changes() is the immediately
  // preceding conditional redemption update, so a second claimant never
  // creates an ownership row. A failed insert rolls back consumption.
  const results = await db.batch([
    db.prepare(`UPDATE digital_claims SET redeemed_by=?, redeemed_at=?, ownership_id=?
      WHERE token_hash=? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > unixepoch()
        AND EXISTS (SELECT 1 FROM catalog_veilings v
          JOIN veiling_publications p ON p.veiling_id=v.id
          WHERE v.id=digital_claims.veiling_id AND v.status='active' AND p.visibility='public')
        AND EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
          WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>unixepoch() AND u.disabled=0)`)
      .bind(session.userId, now, ownershipId, hash, session.sessionTokenHash, session.userId),
    db.prepare(`INSERT INTO ownerships(id,user_id,veiling_id,acquisition,acquired_at)
      SELECT ownership_id,redeemed_by,veiling_id,'server_grant',redeemed_at
      FROM digital_claims WHERE ownership_id=? AND redeemed_by=? AND redeemed_at=? AND changes()=1`)
      .bind(ownershipId, session.userId, now),
  ]);
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1)
    throw new HttpError(409, 'CODE_UNAVAILABLE', 'This code has expired, was already used, or is unavailable.');
  return json({ schemaVersion: '1', ownershipId }, 201);
}

export async function handleDigitalClaims(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/admin/digital-claims') return issue(request, env);
  if (path === '/api/digital-claims/redeem') return redeem(request, env);
  return null;
}
