import { requireCsrf, requireSession, type AuthSession } from './auth';
import { HttpError, json, readJson } from './http';
import { getAdminRole } from './admin-accounts';
import type { Env } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTOR = `EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
  JOIN admin_allowlist a ON a.user_id=u.id
  WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>? AND u.disabled=0 AND a.role IN ('admin','owner'))`;

export interface PublicationRow {
  veiling_id: string; name: string; description: string; character_number: number | null;
  rarity: string | null; edition: string | null; artwork_id: string | null;
  visibility: 'public' | 'upcoming'; release_date: string | null; source_revision: number; updated_at: number;
}
export interface CatalogRow {
  id: string; name: string; description: string; character_number: number | null;
  status: 'draft' | 'active' | 'retired'; rarity: string | null; edition: string | null; artwork_id: string | null;
  revision: number; created_by: string; updated_by: string; created_at: number; updated_at: number;
  publication_json?: string | null;
}
function snapshotJson(alias: string): string {
  return `json_object('veiling_id',${alias}.veiling_id,'name',${alias}.name,'description',${alias}.description,
    'character_number',${alias}.character_number,'rarity',${alias}.rarity,'edition',${alias}.edition,
    'artwork_id',${alias}.artwork_id,'visibility',${alias}.visibility,'release_date',${alias}.release_date,
    'source_revision',${alias}.source_revision,'updated_at',${alias}.updated_at)`;
}
export const PUBLICATION_COLUMN = `CASE WHEN p.veiling_id IS NOT NULL THEN ${snapshotJson('p')} ELSE NULL END AS publication_json`;
export const CATALOG_WITH_PUBLICATION = `SELECT v.*, ${PUBLICATION_COLUMN} FROM catalog_veilings v
  LEFT JOIN veiling_publications p ON p.veiling_id=v.id`;
export function publicationOf(row: { publication_json?: string | null }): PublicationRow | null {
  return row.publication_json ? JSON.parse(row.publication_json) as PublicationRow : null;
}
export function publicationProjection(row: PublicationRow) {
  return { id: row.veiling_id, name: row.name, number: row.character_number, description: row.description,
    rarity: row.rarity, edition: row.edition, artworkUrl: row.artwork_id ? `/api/artwork/${row.artwork_id}` : null,
    visibility: row.visibility, releaseDate: row.release_date, updatedAt: new Date(row.updated_at * 1000).toISOString() };
}
function invalid(message = 'Check the publication settings and try again.'): never {
  throw new HttpError(400, 'INVALID_INPUT', message);
}
function conflict(): never { throw new HttpError(409, 'CATALOG_CHANGED', 'The catalog changed. Reload before saving again.'); }
function inputRevision(request: Request): number {
  const header = request.headers.get('If-Match');
  if (!header) throw new HttpError(428, 'REVISION_REQUIRED', 'Reload the catalog before publishing this Veiling.');
  const match = /^"([1-9][0-9]{0,15})"$/.exec(header);
  if (!match || !Number.isSafeInteger(Number(match[1]))) invalid('Send a valid catalog revision.');
  return Number(match[1]);
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export async function publishPublication(request: Request, env: Env, session: AuthSession, id: string): Promise<CatalogRow> {
  requireCsrf(request, env, session);
  const expected = inputRevision(request);
  const value = await readJson(request, 2048);
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 3 || Object.keys(body).some(key => !['visibility', 'releaseDate', 'useSavedDraft'].includes(key)) ||
      !['public', 'upcoming', 'private'].includes(body.visibility as string) || typeof body.useSavedDraft !== 'boolean' ||
      (body.releaseDate !== null && !validDate(body.releaseDate)) ||
      (body.visibility !== 'upcoming' && body.releaseDate !== null) ||
      (body.visibility === 'private' && body.useSavedDraft)) invalid();
  const visibility = body.visibility as 'public' | 'upcoming' | 'private';
  const releaseDate = body.releaseDate as string | null;
  const useDraft = body.useSavedDraft;
  const db = env.DB.withSession('first-primary');
  const current = await db.prepare(`${CATALOG_WITH_PUBLICATION} WHERE v.id=?`).bind(id).first<CatalogRow>();
  if (!current) throw new HttpError(404, 'NOT_FOUND', 'The Veiling was not found.');
  if (current.revision !== expected) conflict();
  if (!useDraft && !publicationOf(current))
    throw new HttpError(409, 'PUBLICATION_REQUIRED', 'Approve the saved draft before changing its member visibility.');
  const eventId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const before = `(SELECT ${snapshotJson('p')} FROM veiling_publications p WHERE p.veiling_id=v.id)`;
  const after = visibility === 'private' ? 'NULL' : useDraft
    ? `json_object('veiling_id',v.id,'name',v.name,'description',v.description,'character_number',v.character_number,
        'rarity',v.rarity,'edition',v.edition,'artwork_id',v.artwork_id,'visibility',?,'release_date',?,
        'source_revision',v.revision+1,'updated_at',?)`
    : `(SELECT json_set(${snapshotJson('p')},'$.visibility',?,'$.release_date',?,
        '$.source_revision',CASE WHEN p.source_revision=v.revision THEN v.revision+1 ELSE p.source_revision END,
        '$.updated_at',?) FROM veiling_publications p WHERE p.veiling_id=v.id)`;
  const action = visibility === 'private' ? 'hide' : useDraft ? 'approve_draft' : 'change_visibility';
  const marker = `EXISTS(SELECT 1 FROM publication_audit e WHERE e.id=? AND e.veiling_id=?)`;
  const first = db.prepare(`INSERT INTO publication_audit
    (id,veiling_id,actor_user_id,action,before_json,after_json,catalog_revision,created_at)
    SELECT ?,v.id,?,?,${before},${after},v.revision+1,? FROM catalog_veilings v
    WHERE v.id=? AND v.revision=? AND ${ACTOR}
      ${!useDraft ? 'AND EXISTS(SELECT 1 FROM veiling_publications p WHERE p.veiling_id=v.id)' : ''}`)
    .bind(eventId, session.userId, action, ...(visibility === 'private' ? [] : [visibility, releaseDate, now]), now,
      id, expected, session.sessionTokenHash, session.userId, now);
  // One transactional audit marker captures current authority, session and CAS.
  // Every subsequent change requires that marker; any failure rolls all back.
  const statements = [first,
    db.prepare(`UPDATE catalog_veilings SET revision=revision+1,updated_by=?,updated_at=?
      WHERE id=? AND revision=? AND ${marker}`).bind(session.userId, now, id, expected, eventId, id),
  ];
  if (visibility === 'private') {
    statements.push(db.prepare(`DELETE FROM veiling_publications WHERE veiling_id=? AND ${marker}`).bind(id, eventId, id));
  } else if (useDraft) {
    statements.push(db.prepare(`INSERT INTO veiling_publications
      (veiling_id,name,description,character_number,rarity,edition,artwork_id,visibility,release_date,source_revision,updated_at)
      SELECT id,name,description,character_number,rarity,edition,artwork_id,?,?,revision,? FROM catalog_veilings
      WHERE id=? AND ${marker}
      ON CONFLICT(veiling_id) DO UPDATE SET name=excluded.name,description=excluded.description,
        character_number=excluded.character_number,rarity=excluded.rarity,edition=excluded.edition,artwork_id=excluded.artwork_id,
        visibility=excluded.visibility,release_date=excluded.release_date,source_revision=excluded.source_revision,updated_at=excluded.updated_at`)
      .bind(visibility, releaseDate, now, id, eventId, id));
  } else {
    statements.push(db.prepare(`UPDATE veiling_publications SET visibility=?,release_date=?,updated_at=?,
      source_revision=CASE WHEN source_revision=? THEN ? ELSE source_revision END WHERE veiling_id=? AND ${marker}`)
      .bind(visibility, releaseDate, now, expected, expected + 1, id, eventId, id));
  }
  statements.push(db.prepare(`${CATALOG_WITH_PUBLICATION} WHERE v.id=?`).bind(id));
  let results: D1Result<CatalogRow>[];
  try { results = await db.batch<CatalogRow>(statements); }
  catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed: veiling_publications.character_number'))
      throw new HttpError(409, 'NUMBER_IN_USE', 'This character number is already in use.');
    throw error;
  }
  if (results[0].meta.changes !== 1) {
    await requireSession(request, env);
    if (!(await getAdminRole(env, session.userId))) throw new HttpError(403, 'ADMIN_REQUIRED', 'Trusted administrator access is required.');
    conflict();
  }
  return results[3].results[0];
}

export async function handleShowcase(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const match = /^\/api\/showcase\/([^/]*)$/.exec(path);
  if (path !== '/api/showcase' && !match) return null;
  await requireSession(request, env);
  if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
  const db = env.DB.withSession('first-primary');
  if (match) {
    if (!UUID.test(match[1])) throw new HttpError(404, 'NOT_FOUND', 'The showcase Veiling was not found.');
    const row = await db.prepare('SELECT * FROM veiling_publications WHERE veiling_id=?').bind(match[1].toLowerCase()).first<PublicationRow>();
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'The showcase Veiling was not found.');
    return json({ schemaVersion: '1', mode: 'live', veiling: publicationProjection(row) });
  }
  const rows = await db.prepare(`SELECT * FROM veiling_publications
    ORDER BY visibility='upcoming', character_number IS NULL, character_number, veiling_id`).all<PublicationRow>();
  return json({ schemaVersion: '1', mode: 'live', veilings: rows.results.map(publicationProjection) });
}
