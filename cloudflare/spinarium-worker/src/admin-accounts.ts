import { requireCsrf, requireSession, type AuthSession } from './auth';
import { epoch, hashToken, token } from './session';
import { HttpError, json, readJson } from './http';
import type { Env } from './types';

type Role = 'owner' | 'admin' | 'collector';
type ActorRole = Exclude<Role, 'collector'>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTOR_GUARD = `EXISTS (SELECT 1 FROM admin_allowlist actor
  JOIN users actor_user ON actor_user.id = actor.user_id
  JOIN sessions actor_session ON actor_session.user_id = actor.user_id
  WHERE actor.user_id = ? AND actor_user.disabled = 0
  AND actor_session.token_hash = ? AND actor_session.expires_at > ?)`;
const OWNER_GUARD = ACTOR_GUARD.replace('actor.user_id = ?', "actor.role = 'owner' AND actor.user_id = ?");
const SELECT_ACCOUNT = `SELECT u.id, u.display_name, u.disabled, u.created_at, u.updated_at,
  u.last_login_at, u.account_revision, u.account_email AS email,
  COALESCE(a.role, 'collector') AS role,
  EXISTS (SELECT 1 FROM password_accounts p WHERE p.user_id = u.id) AS password_account`;
const ACCOUNT_FROM = 'LEFT JOIN admin_allowlist a ON a.user_id = u.id';
const SAFE_AUDIT_JSON = `json_object('displayName', u.display_name,
  'disabled', json(CASE WHEN u.disabled = 1 THEN 'true' ELSE 'false' END),
  'revision', u.account_revision,
  'role', COALESCE((SELECT role FROM admin_allowlist WHERE user_id = u.id), 'collector'))`;

interface AccountRow {
  id: string;
  display_name: string;
  disabled: number;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
  account_revision: number;
  email: string | null;
  role: Role;
  password_account: number;
  active_session_count?: number;
  ownership_count?: number;
  actor_role?: ActorRole;
}
interface Cursor { v: 1; kind: string; scope: string; key: string | number; id: string }
interface DirectoryQuery {
  search: string; searchBy: 'email' | 'name' | 'id'; status: 'all' | 'active' | 'disabled';
  role: 'all' | Role; limit: number; cursor: Cursor | null; scope: string;
}

function invalid(message = 'Check the account fields and try again.'): never {
  throw new HttpError(400, 'INVALID_INPUT', message);
}
function safeText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') invalid();
  const normalized = value.trim();
  const points = Array.from(normalized);
  if (!points.length || points.length > maximum || /[\u0000-\u001f\u007f-\u009f]/.test(normalized) ||
    points.some((point) => { const code = point.codePointAt(0)!; return code >= 0xd800 && code <= 0xdfff; })) invalid();
  return normalized;
}
function objectBody(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !fields.includes(key))) invalid();
  return body;
}
function iso(seconds: number): string { return new Date(seconds * 1000).toISOString(); }
function revision(request: Request): number {
  const header = request.headers.get('If-Match');
  if (!header) throw new HttpError(428, 'REVISION_REQUIRED', 'Reload the account before editing it.');
  const match = header.match(/^"([1-9][0-9]{0,15})"$/);
  if (!match || !Number.isSafeInteger(Number(match[1]))) invalid('Send a valid account revision.');
  return Number(match[1]);
}
function conflict(): never { throw new HttpError(409, 'ACCOUNT_CHANGED', 'The account changed. Reload before trying again.'); }
function protectedAccount(): never { throw new HttpError(403, 'PROTECTED_ACCOUNT', 'This account is protected from that action.'); }

export async function getAdminRole(env: Env, userId: string): Promise<ActorRole | null> {
  const row = await env.DB.withSession('first-primary').prepare(`SELECT a.role FROM admin_allowlist a
    JOIN users u ON u.id = a.user_id WHERE a.user_id = ? AND u.disabled = 0`).bind(userId).first<{ role: ActorRole }>();
  return row?.role ?? null;
}
function guardValues(session: AuthSession): [string, string, number] {
  return [session.userId, session.sessionTokenHash, epoch()];
}
async function authorizedRead<T>(db: D1DatabaseSession, session: AuthSession, statement: D1PreparedStatement): Promise<T[]> {
  // Authorization and result share one primary transaction. A role/session
  // revoked after the entry check cannot expose a later directory snapshot.
  const results = await db.batch<T | { role: ActorRole }>([
    db.prepare(`SELECT role FROM admin_allowlist WHERE user_id = ? AND ${ACTOR_GUARD}`)
      .bind(session.userId, ...guardValues(session)), statement,
  ]);
  if (!results[0].results.length) throw new HttpError(403, 'ADMIN_REQUIRED', 'Trusted administrator access is required.');
  return results[1].results as T[];
}
function canManage(actorRole: ActorRole, actorId: string, account: AccountRow): boolean {
  return account.id !== actorId && account.role !== 'owner' && (actorRole === 'owner' || account.role === 'collector');
}
function profile(row: AccountRow) {
  return {
    id: row.id, email: row.email, emailVerified: row.email === null ? null : false,
    displayName: row.display_name, disabled: row.disabled === 1, role: row.role,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    lastLoginAt: row.last_login_at === null ? null : iso(row.last_login_at),
    revision: row.account_revision, passwordAccount: row.password_account === 1,
  };
}
function detailProjection(row: AccountRow, actorRole: ActorRole, actorId: string) {
  const currentActorRole = row.actor_role ?? actorRole;
  const manage = canManage(currentActorRole, actorId, row);
  return {
    ...profile(row), activeSessionCount: row.active_session_count ?? 0, ownershipCount: row.ownership_count ?? 0,
    protected: !manage,
    permissions: {
      editProfile: manage || row.id === actorId,
      setStatus: manage, revokeSessions: manage,
      resetPassword: manage && row.disabled === 0 && row.password_account === 1,
      setRole: manage && currentActorRole === 'owner' && row.disabled === 0,
    },
  };
}
function detailStatement(db: D1DatabaseSession, id: string, actorId: string): D1PreparedStatement {
  return db.prepare(`${SELECT_ACCOUNT},
    (SELECT role FROM admin_allowlist WHERE user_id = ?) AS actor_role,
    (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS active_session_count,
    (SELECT count(*) FROM ownerships o WHERE o.user_id = u.id) AS ownership_count
    FROM users u ${ACCOUNT_FROM} WHERE u.id = ?`).bind(actorId, epoch(), id);
}
async function account(db: D1DatabaseSession, session: AuthSession, id: string): Promise<AccountRow> {
  const rows = await authorizedRead<AccountRow>(db, session, detailStatement(db, id, session.userId));
  if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'The account was not found.');
  return rows[0];
}
function safeAudit(row: AccountRow) {
  return { displayName: row.display_name, disabled: row.disabled === 1, revision: row.account_revision, role: row.role };
}

function encodeCursor(cursor: Cursor): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(cursor))))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function decodeCursor(value: string | null, kind: string, scope: string): Cursor | null {
  if (value === null || value === '') return null;
  if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) invalid('Select a valid page.');
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    const cursor = parsed as Cursor;
    if (Object.keys(cursor).sort().join(',') !== 'id,key,kind,scope,v' || cursor.v !== 1 || cursor.kind !== kind ||
      cursor.scope !== scope || !UUID.test(cursor.id) ||
      !((typeof cursor.key === 'number' && Number.isSafeInteger(cursor.key) && cursor.key >= 0) ||
        (typeof cursor.key === 'string' && cursor.key.length <= 254)) || encodeCursor(cursor) !== value) throw new Error();
    return cursor;
  } catch { invalid('Select a valid page for these filters.'); }
}
function queryParameters(url: URL, allowed: string[]): void {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) invalid('Use valid account filters.');
  }
}
function limitValue(url: URL, fallback: number): number {
  const value = url.searchParams.get('limit');
  if (value === null) return fallback;
  if (!/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > 100) invalid('Choose a page size from 1 to 100.');
  return Number(value);
}
function directoryQuery(url: URL): DirectoryQuery {
  queryParameters(url, ['search', 'searchBy', 'status', 'role', 'cursor', 'limit']);
  const rawSearch = (url.searchParams.get('search') ?? '').trim();
  if (rawSearch.length > 254) invalid('Use a search of 254 characters or less.');
  if (rawSearch) safeText(rawSearch, 254);
  const searchBy = url.searchParams.get('searchBy') ?? 'email';
  const status = url.searchParams.get('status') ?? 'all';
  const role = url.searchParams.get('role') ?? 'all';
  if (!['email', 'name', 'id'].includes(searchBy) || !['all', 'active', 'disabled'].includes(status) ||
    !['all', 'collector', 'admin', 'owner'].includes(role)) invalid('Use valid account filters.');
  // SQLite lower() folds ASCII only. Keep name query and generated index exactly
  // consistent: accented/non-ASCII characters retain their original case.
  const search = searchBy === 'email' ? rawSearch.toLowerCase() : searchBy === 'name'
    ? rawSearch.replace(/[A-Z]/g, (character) => character.toLowerCase()) : rawSearch.toLowerCase();
  if (searchBy === 'id' && search && !UUID.test(search)) invalid('Use an exact account ID.');
  const scope = JSON.stringify({ searchBy, search, status, role });
  const cursor = decodeCursor(url.searchParams.get('cursor'), 'accounts', scope);
  if (cursor && ((search && searchBy !== 'id') ? typeof cursor.key !== 'string' : typeof cursor.key !== 'number')) invalid();
  return { search, searchBy: searchBy as DirectoryQuery['searchBy'], status: status as DirectoryQuery['status'],
    role: role as DirectoryQuery['role'], scope, cursor, limit: limitValue(url, 50) };
}
function prefixUpper(value: string): string | null {
  const characters = Array.from(value);
  while (characters.length) {
    const last = characters.pop()!.codePointAt(0)!;
    if (last < 0x10ffff) return characters.join('') + String.fromCodePoint(last === 0xd7ff ? 0xe000 : last + 1);
  }
  return null;
}

// Export the actual bounded query builder so scale tests inspect its D1 plan,
// rather than a simplified SQL copy that could diverge from the endpoint.
export function accountDirectoryStatement(db: D1DatabaseSession, url: URL): {
  statement: D1PreparedStatement; query: DirectoryQuery; sql: string; values: unknown[];
} {
  const query = directoryQuery(url);
  const prefix = query.search && query.searchBy !== 'id';
  const field = prefix ? (query.searchBy === 'email' ? 'account_email' : 'display_name_search') : 'created_at';
  const conditions: string[] = [];
  const values: unknown[] = [];
  const statusFilter = query.status !== 'all';
  const roleFilter = query.role !== 'all';
  if (statusFilter) { conditions.push('u.disabled = ?'); values.push(query.status === 'disabled' ? 1 : 0); }
  if (roleFilter) { conditions.push('u.account_role = ?'); values.push(query.role); }
  if (query.searchBy === 'id' && query.search) { conditions.push('u.id = ?'); values.push(query.search); }
  if (prefix) {
    conditions.push(`u.${field} >= ?`); values.push(query.search);
    const upper = prefixUpper(query.search);
    if (upper !== null) { conditions.push(`u.${field} < ?`); values.push(upper); }
  }
  if (query.cursor) {
    conditions.push(`(u.${field}, u.id) ${prefix ? '>' : '<'} (?, ?)`);
    values.push(query.cursor.key, query.cursor.id);
  }
  const order = prefix ? 'ASC' : 'DESC';
  const index = `users_account_${statusFilter ? 'status_' : ''}${roleFilter ? 'role_' : ''}${prefix ? query.searchBy : 'newest'}`;
  const source = query.searchBy === 'id' && query.search ? 'users u' : `users u INDEXED BY ${index}`;
  const sql = `${SELECT_ACCOUNT}, u.${field} AS cursor_key FROM ${source} ${ACCOUNT_FROM}
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY u.${field} ${order}, u.id ${order} LIMIT ?`;
  values.push(query.limit + 1);
  return { statement: db.prepare(sql).bind(...values), query, sql, values };
}
async function directory(db: D1DatabaseSession, session: AuthSession, url: URL): Promise<Response> {
  const { statement, query } = accountDirectoryStatement(db, url);
  const rows = await authorizedRead<AccountRow & { cursor_key: number | string }>(db, session, statement);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return json({ accounts: page.map(profile), limit: query.limit,
    nextCursor: rows.length > query.limit && last ? encodeCursor({ v: 1, kind: 'accounts', scope: query.scope, key: last.cursor_key, id: last.id }) : null });
}

async function summary(db: D1DatabaseSession, session: AuthSession): Promise<Response> {
  const rows = await authorizedRead<{ total: number; active: number; disabled: number; admins: number; owners: number; currentActorRole: ActorRole }>(db, session,
    db.prepare(`SELECT count(*) AS total, count(*) FILTER (WHERE disabled = 0) AS active,
      count(*) FILTER (WHERE disabled = 1) AS disabled,
      (SELECT count(*) FROM admin_allowlist) AS admins,
      (SELECT count(*) FROM admin_allowlist WHERE role = 'owner') AS owners,
      (SELECT role FROM admin_allowlist WHERE user_id = ?) AS currentActorRole FROM users`).bind(session.userId));
  return json(rows[0]);
}

async function relatedPage(db: D1DatabaseSession, session: AuthSession, id: string, kind: 'ownerships' | 'history', url: URL): Promise<Response> {
  queryParameters(url, ['cursor', 'limit']);
  await account(db, session, id);
  const limit = limitValue(url, 25);
  const cursor = decodeCursor(url.searchParams.get('cursor'), kind, id);
  if (cursor && typeof cursor.key !== 'number') invalid();
  const values: unknown[] = [id];
  if (cursor) values.push(cursor.key, cursor.id);
  values.push(limit + 1);
  if (kind === 'ownerships') {
    interface Owned { id: string; veiling_id: string; name: string; character_number: number | null; status: string; acquired_at: number; acquisition: string }
    const rows = await authorizedRead<Owned>(db, session, db.prepare(`SELECT o.id, o.veiling_id, v.name, v.character_number, v.status, o.acquired_at, o.acquisition
      FROM ownerships o JOIN catalog_veilings v ON v.id = o.veiling_id WHERE o.user_id = ?
      ${cursor ? 'AND (o.acquired_at, o.id) < (?, ?)' : ''} ORDER BY o.acquired_at DESC, o.id DESC LIMIT ?`).bind(...values));
    const page = rows.slice(0, limit); const last = page.at(-1);
    return json({ ownerships: page.map((row) => ({ id: row.id, veilingId: row.veiling_id, name: row.name,
      number: row.character_number, status: row.status, acquiredAt: iso(row.acquired_at), acquisition: row.acquisition })), limit,
      nextCursor: rows.length > limit && last ? encodeCursor({ v: 1, kind, scope: id, key: last.acquired_at, id: last.id }) : null });
  }
  interface Audit { id: string; actor_user_id: string | null; action: string; reason: string; before_json: string; after_json: string; created_at: number }
  const rows = await authorizedRead<Audit>(db, session, db.prepare(`SELECT id, actor_user_id, action, reason, before_json, after_json, created_at
    FROM account_audit WHERE target_user_id = ? ${cursor ? 'AND (created_at, id) < (?, ?)' : ''}
    ORDER BY created_at DESC, id DESC LIMIT ?`).bind(...values));
  const page = rows.slice(0, limit); const last = page.at(-1);
  return json({ history: page.map((row) => ({ id: row.id, actorId: row.actor_user_id, action: row.action, reason: row.reason,
    before: JSON.parse(row.before_json), after: JSON.parse(row.after_json), createdAt: iso(row.created_at) })), limit,
    nextCursor: rows.length > limit && last ? encodeCursor({ v: 1, kind, scope: id, key: last.created_at, id: last.id }) : null });
}

// A regular administrator may manage collectors. The owner may also manage
// regular administrators. No destructive operation can target self or owner.
const MANAGE_TARGET = `u.id != ? AND NOT EXISTS (SELECT 1 FROM admin_allowlist target_owner WHERE target_owner.user_id = u.id AND target_owner.role = 'owner')
  AND (EXISTS (SELECT 1 FROM admin_allowlist actor_owner WHERE actor_owner.user_id = ? AND actor_owner.role = 'owner')
    OR NOT EXISTS (SELECT 1 FROM admin_allowlist target_admin WHERE target_admin.user_id = u.id))`;
function manageValues(session: AuthSession): [string, string] { return [session.userId, session.userId]; }

async function mutation(request: Request, env: Env, session: AuthSession, actorRole: ActorRole, id: string,
  operation: 'patch' | 'revoke-sessions' | 'password-reset' | 'role'): Promise<Response> {
  requireCsrf(request, env, session);
  const expected = revision(request);
  const body = objectBody(await readJson(request, 8192), operation === 'patch' ? ['displayName', 'disabled', 'reason'] : operation === 'role' ? ['role', 'reason'] : ['reason']);
  const reason = safeText(body.reason, 500);
  const db = env.DB.withSession('first-primary');
  const existing = await account(db, session, id);
  if (existing.account_revision !== expected) conflict();
  const manage = canManage(actorRole, session.userId, existing);
  const selfProfile = operation === 'patch' && id === session.userId && 'displayName' in body && !('disabled' in body);
  if (!manage && !selfProfile) protectedAccount();
  let name = existing.display_name;
  let disabled = existing.disabled;
  let action = operation === 'revoke-sessions' ? 'sessions_revoked' : operation === 'password-reset' ? 'password_reset_issued' : 'profile_updated';
  if (operation === 'patch') {
    if (!('displayName' in body) && !('disabled' in body)) invalid();
    if ('displayName' in body) name = safeText(body.displayName, 120);
    if ('disabled' in body) {
      if (typeof body.disabled !== 'boolean') invalid();
      disabled = body.disabled ? 1 : 0;
      if (disabled !== existing.disabled) action = disabled ? 'account_disabled' : 'account_enabled';
    }
    if (name === existing.display_name && disabled === existing.disabled) invalid('Choose a change before saving.');
  }
  if (operation === 'password-reset' && (existing.disabled !== 0 || existing.password_account !== 1)) protectedAccount();
  let desiredRole: 'admin' | 'collector' | null = null;
  if (operation === 'role') {
    if (actorRole !== 'owner') protectedAccount();
    if (!['admin', 'collector'].includes(body.role as string) || existing.disabled !== 0 || body.role === existing.role) invalid();
    desiredRole = body.role as 'admin' | 'collector'; action = 'role_changed';
  }
  const now = epoch();
  const eventId = crypto.randomUUID();
  const rawReset = operation === 'password-reset' ? token() : null;
  const resetHash = rawReset ? await hashToken(rawReset) : null;
  const expiresAt = now + 15 * 60;
  let first: D1PreparedStatement;
  if (operation === 'role') {
    // Allowlist triggers change the indexed role and increment the revision
    // exactly once. Both grant and removal are guarded against an owner target.
    const roleGuard = `u.id = ? AND u.account_revision = ? AND u.disabled = 0 AND ${OWNER_GUARD} AND ${MANAGE_TARGET}`;
    first = desiredRole === 'admin'
      ? db.prepare(`INSERT INTO admin_allowlist(user_id, granted_at, granted_by, role)
        SELECT u.id, ?, ?, 'admin' FROM users u WHERE ${roleGuard}
        AND NOT EXISTS (SELECT 1 FROM admin_allowlist WHERE user_id = u.id)`)
        .bind(now, session.userId, id, expected, ...guardValues(session), ...manageValues(session))
      : db.prepare(`DELETE FROM admin_allowlist WHERE user_id = ? AND role = 'admin'
        AND EXISTS (SELECT 1 FROM users u WHERE ${roleGuard})`)
        .bind(id, id, expected, ...guardValues(session), ...manageValues(session));
  } else {
    const targetGuard = selfProfile ? 'u.id = ?' : MANAGE_TARGET;
    const targetValues = selfProfile ? [session.userId] : manageValues(session);
    first = db.prepare(`UPDATE users AS u SET display_name = ?, disabled = ?, updated_at = ?, account_revision = account_revision + 1
      WHERE u.id = ? AND u.account_revision = ? AND ${ACTOR_GUARD} AND ${targetGuard}
      ${operation === 'password-reset' ? 'AND u.disabled = 0 AND EXISTS (SELECT 1 FROM password_accounts p WHERE p.user_id = u.id)' : ''}`)
      .bind(name, disabled, now, id, expected, ...guardValues(session), ...targetValues);
  }
  const revoke = operation !== 'patch' || disabled === 1;
  const statements = [first,
    db.prepare(`INSERT INTO account_audit(id, target_user_id, actor_user_id, action, reason, before_json, after_json, created_at)
      SELECT ?, u.id, ?, ?, ?, ?, ${SAFE_AUDIT_JSON}, ? FROM users u WHERE u.id = ? AND changes() = 1`)
      .bind(eventId, session.userId, action, reason, JSON.stringify(safeAudit(existing)), now, id),
    db.prepare('DELETE FROM password_resets WHERE (user_id = ? OR (created_by = ? AND ? = 1)) AND EXISTS (SELECT 1 FROM account_audit WHERE id = ? AND target_user_id = ?)').bind(id, id, revoke ? 1 : 0, eventId, id),
  ];
  if (revoke) statements.push(db.prepare('DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM account_audit WHERE id = ? AND target_user_id = ?)').bind(id, eventId, id));
  if (resetHash) statements.push(db.prepare(`INSERT INTO password_resets(token_hash,user_id,created_by,created_at,expires_at)
    SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM account_audit WHERE id = ? AND target_user_id = ?)`)
    .bind(resetHash, id, session.userId, now, expiresAt, eventId, id));
  const detailIndex = statements.length;
  statements.push(detailStatement(db, id, session.userId));
  const results = await db.batch<AccountRow>(statements);
  if (results[1].meta.changes !== 1) {
    const freshActor = await getAdminRole(env, session.userId);
    if (!freshActor) throw new HttpError(403, 'ADMIN_REQUIRED', 'Trusted administrator access is required.');
    if (operation === 'role' && freshActor !== 'owner') protectedAccount();
    const fresh = await account(db, session, id);
    if (!canManage(freshActor, session.userId, fresh) && !selfProfile) protectedAccount();
    conflict();
  }
  const result = detailProjection(results[detailIndex].results[0], actorRole, session.userId);
  const revokedSessionCount = revoke ? results[3].meta.changes : 0;
  if (rawReset) return json({ account: result, resetLink: `${env.APP_ORIGIN}/spinarium/#reset-password=${rawReset}`, expiresAt: iso(expiresAt), revokedSessionCount });
  return json({ ...result, revokedSessionCount });
}

export async function handleAdminAccounts(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/admin/accounts' && !url.pathname.startsWith('/api/admin/accounts/')) return null;
  const session = await requireSession(request, env);
  const actorRole = await getAdminRole(env, session.userId);
  if (!actorRole) throw new HttpError(403, 'ADMIN_REQUIRED', 'Trusted administrator access is required.');
  const db = env.DB.withSession('first-primary');
  if (url.pathname === '/api/admin/accounts') {
    if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
    return directory(db, session, url);
  }
  if (url.pathname === '/api/admin/accounts/summary') {
    queryParameters(url, []);
    if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
    return summary(db, session);
  }
  const match = url.pathname.match(/^\/api\/admin\/accounts\/([^/]+)(?:\/(ownerships|history|revoke-sessions|password-reset|role))?$/);
  if (!match || !UUID.test(match[1])) throw new HttpError(404, 'NOT_FOUND', 'The account endpoint was not found.');
  const id = match[1].toLowerCase(); const section = match[2];
  if (section === 'ownerships' || section === 'history') {
    if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
    return relatedPage(db, session, id, section, url);
  }
  queryParameters(url, []);
  if (!section && request.method === 'GET') return json(detailProjection(await account(db, session, id), actorRole, session.userId));
  const method = !section || section === 'role' ? 'PATCH' : 'POST';
  if (request.method !== method) throw new HttpError(405, 'METHOD_NOT_ALLOWED', `Use ${method} for this endpoint.`);
  return mutation(request, env, session, actorRole, id, (section ?? 'patch') as 'patch' | 'revoke-sessions' | 'password-reset' | 'role');
}
