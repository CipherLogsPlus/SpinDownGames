import { epoch, type AuthSession } from './session';

// Bind the exact initiating session, not merely any session for this account.
// The database clock also covers time spent waiting for the batch to execute.
export const ADMIN_ACTOR_GUARD = `EXISTS (SELECT 1 FROM admin_allowlist actor
  JOIN users actor_user ON actor_user.id = actor.user_id
  JOIN sessions actor_session ON actor_session.user_id = actor.user_id
  WHERE actor.user_id = ? AND actor_user.disabled = 0 AND actor.role IN ('admin', 'owner')
  AND actor_session.token_hash = ? AND actor_session.expires_at > MAX(?, unixepoch()))`;
export const OWNER_ACTOR_GUARD = ADMIN_ACTOR_GUARD.replace("actor.role IN ('admin', 'owner')", "actor.role = 'owner'");

export function adminActorValues(session: AuthSession): [string, string, number] {
  return [session.userId, session.sessionTokenHash, epoch()];
}
