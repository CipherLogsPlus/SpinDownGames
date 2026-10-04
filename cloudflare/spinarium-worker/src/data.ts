import { requireCsrf, requireSession, type AuthSession } from './auth';
import { HttpError, json, readBytes, readJson } from './http';
import type { Env } from './types';
import { getAdminRole, handleAdminAccounts } from './admin-accounts';
import { CATALOG_WITH_PUBLICATION, PUBLICATION_COLUMN, handleShowcase, publicationOf, publicationProjection,
  publishPublication, type CatalogRow } from './showcase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const INPUT_FIELDS = new Set(['name', 'description', 'number', 'status', 'rarity', 'edition']);
const ADMIN_EXISTS = `EXISTS (
  SELECT 1 FROM admin_allowlist a JOIN users u ON u.id = a.user_id
  WHERE a.user_id = ? AND u.disabled = 0
)`;
const AUDIT_JSON = `json_object(
  'id', id, 'name', name, 'description', description,
  'number', character_number, 'status', status, 'rarity', rarity,
  'edition', edition, 'artworkId', artwork_id, 'revision', revision
)`;

interface OwnershipRow {
  id: string;
  user_id: string;
  veiling_id: string;
  acquisition: 'server_grant';
  acquired_at: number;
}

interface DiscoveryRow {
  veiling_id: string;
  status: 'undiscovered' | 'revealed';
  first_discovered_at: number | null;
  first_discoverer_id: string | null;
  reveal_kind: 'launch' | 'collector' | null;
}

interface ArtworkRow {
  id: string;
  veiling_id: string;
  object_key: string;
  content_type: string;
  byte_length: number;
}

type CatalogInput = Pick<CatalogRow, 'name' | 'description' | 'status' | 'rarity' | 'edition'> & { number: number | null };

export async function isAdmin(env: Env, userId: string): Promise<boolean> {
  const result = await env.DB.withSession('first-primary').prepare(`SELECT 1 AS permitted WHERE ${ADMIN_EXISTS}`).bind(userId).first();
  return result !== null;
}

async function requireAdmin(env: Env, session: AuthSession): Promise<void> {
  if (!(await isAdmin(env, session.userId))) {
    throw new HttpError(403, 'ADMIN_REQUIRED', 'Trusted administrator access is required.');
  }
}

function invalidInput(message = 'Check the Veiling fields and try again.'): never {
  throw new HttpError(400, 'INVALID_INPUT', message);
}

function text(value: unknown, maximum: number, required = false): string {
  if (typeof value !== 'string') invalidInput();
  const normalized = value.trim();
  if (normalized.length > maximum || (required && !normalized) || normalized.includes('\0')) invalidInput();
  return normalized;
}

function nullableText(value: unknown, maximum: number): string | null {
  return value === null ? null : text(value, maximum) || null;
}

function parseInput(value: unknown, existing?: CatalogRow): CatalogInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidInput();
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (!keys.length || keys.some((key) => !INPUT_FIELDS.has(key))) invalidInput();
  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);
  if (!existing && !has('name')) invalidInput('A Veiling name is required.');
  const result: CatalogInput = {
    name: has('name') ? text(input.name, 120, true) : existing!.name,
    description: has('description') ? text(input.description, 20000) : existing?.description ?? '',
    number: has('number') ? input.number as number | null : existing?.character_number ?? null,
    status: has('status') ? input.status as CatalogRow['status'] : existing?.status ?? 'draft',
    rarity: has('rarity') ? nullableText(input.rarity, 80) : existing?.rarity ?? null,
    edition: has('edition') ? nullableText(input.edition, 120) : existing?.edition ?? null,
  };
  if (result.number !== null && (!Number.isSafeInteger(result.number) || result.number < 1 || result.number > 999999)) {
    invalidInput('The character number must be a whole number from 1 to 999999.');
  }
  if (!['draft', 'active', 'retired'].includes(result.status)) invalidInput('Choose a valid publication status.');
  return result;
}

function adminProjection(row: CatalogRow) {
  const publication = publicationOf(row);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    character_number: row.character_number,
    status: row.status,
    rarity: row.rarity,
    edition: row.edition,
    revision: row.revision,
    created_at: new Date(row.created_at * 1000).toISOString(),
    updated_at: new Date(row.updated_at * 1000).toISOString(),
    artworkUrl: row.artwork_id ? `/api/artwork/${row.artwork_id}` : null,
    publication: publication ? { ...publicationProjection(publication), sourceRevision: publication.source_revision } : null,
  };
}

function auditProjection(row: CatalogRow) {
  return {
    id: row.id, name: row.name, description: row.description,
    number: row.character_number, status: row.status, rarity: row.rarity,
    edition: row.edition, artworkId: row.artwork_id, revision: row.revision,
  };
}

async function catalogRow(env: Env, id: string): Promise<CatalogRow> {
  const row = await env.DB.withSession('first-primary').prepare(`${CATALOG_WITH_PUBLICATION} WHERE v.id = ?`).bind(id).first<CatalogRow>();
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'The Veiling was not found.');
  return row;
}

function catalogDatabaseError(error: unknown): never {
  if (error instanceof Error && error.message.includes('UNIQUE constraint failed: catalog_veilings.character_number')) {
    throw new HttpError(409, 'NUMBER_IN_USE', 'This character number is already in use.');
  }
  throw error;
}

async function dashboard(env: Env, session: AuthSession): Promise<Response> {
  const db = env.DB.withSession('first-primary');
  // Every query binds the session's identity. No request identity, role, or
  // metadata grants visibility. Definitions are limited to this collection.
  const results = await db.batch<CatalogRow | OwnershipRow | DiscoveryRow>([
    db.prepare(`${CATALOG_WITH_PUBLICATION}
      WHERE EXISTS (
        SELECT 1 FROM ownerships o WHERE o.user_id = ? AND o.veiling_id = v.id
      ) ORDER BY p.veiling_id IS NULL AND v.status = 'draft',
        CASE WHEN p.veiling_id IS NOT NULL THEN p.character_number WHEN v.status != 'draft' THEN v.character_number END, v.id`).bind(session.userId),
    db.prepare(`SELECT o.* FROM ownerships o
      WHERE o.user_id = ? ORDER BY o.acquired_at, o.id`).bind(session.userId),
    db.prepare(`SELECT d.* FROM discoveries d JOIN catalog_veilings v ON v.id = d.veiling_id
      WHERE (v.status != 'draft' OR EXISTS(SELECT 1 FROM veiling_publications p WHERE p.veiling_id=v.id)) AND EXISTS (
        SELECT 1 FROM ownerships o WHERE o.user_id = ? AND o.veiling_id = d.veiling_id
      )`).bind(session.userId),
  ]);
  const veilings = results[0].results as CatalogRow[];
  const ownerships = results[1].results as OwnershipRow[];
  const discoveries = results[2].results as DiscoveryRow[];
  const discovered = new Map(discoveries.map((row) => [row.veiling_id, row]));
  return json({
    schemaVersion: '1',
    mode: 'live',
    profile: { id: session.userId, displayName: session.displayName, memberSince: session.memberSince, avatarSrc: null },
    veilings: veilings.map((row) => {
      const publication = publicationOf(row);
      const unavailable = !publication && row.status === 'draft';
      const revealed = Boolean(publication) || !unavailable && discovered.get(row.id)?.status === 'revealed';
      const name = publication ? publication.name : row.name;
      const description = publication ? publication.description : row.description;
      const artworkId = publication ? publication.artwork_id : row.artwork_id;
      return {
        id: row.id, number: unavailable ? null : publication ? publication.character_number : row.character_number,
        name: revealed ? name : null, type: null, origin: null,
        editionIds: [],
        artwork: revealed && artworkId ? [{
          id: artworkId, role: 'color_art', url: `/api/artwork/${artworkId}`,
          alt: name, variantId: null, status: 'approved',
        }] : [],
        lore: revealed ? [{
          id: row.id, locale: 'en', title: name, preview: description,
          text: description, status: 'published', version: publication ? publication.source_revision : row.revision,
        }] : [],
        releaseDate: null, contentStatus: unavailable ? 'unavailable' : revealed ? 'published' : 'redacted',
      };
    }),
    ownerships: ownerships.map((row) => ({
      id: row.id, userId: session.userId, veilingId: row.veiling_id,
      acquisition: row.acquisition, physicalCardId: null, editionId: '', variantId: '',
      acquiredAt: new Date(row.acquired_at * 1000).toISOString(),
    })),
    discoveries: discoveries.map((row) => ({
      veilingId: row.veiling_id, status: row.status,
      firstDiscoveredAt: row.first_discovered_at === null ? null : new Date(row.first_discovered_at * 1000).toISOString(),
      firstDiscovererId: row.first_discoverer_id === session.userId ? session.userId : null,
      publicDiscovererName: null, revealKind: row.reveal_kind,
    })),
    series: [], editions: [], variants: [], rarities: [], physicalCards: [],
    achievements: [], userAchievements: [], collections: [], news: [], events: [],
  });
}

async function ownershipDetail(env: Env, session: AuthSession, id: string): Promise<Response> {
  const row = await env.DB.withSession('first-primary').prepare(`
    SELECT o.id, o.user_id, o.veiling_id, o.acquisition, o.acquired_at,
      v.character_number, v.name, v.description, v.artwork_id, v.status AS catalog_status,
      d.status AS discovery_status, ${PUBLICATION_COLUMN}
    FROM ownerships o JOIN catalog_veilings v ON v.id = o.veiling_id
    LEFT JOIN veiling_publications p ON p.veiling_id=v.id
    LEFT JOIN discoveries d ON d.veiling_id = v.id
    WHERE o.id = ? AND o.user_id = ?
  `).bind(id, session.userId).first<OwnershipRow & {
    character_number: number | null; name: string; description: string;
    artwork_id: string | null; discovery_status: DiscoveryRow['status'] | null; catalog_status: CatalogRow['status']; publication_json: string | null;
  }>();
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'The ownership was not found.');
  const publication = publicationOf(row);
  const unavailable = !publication && row.catalog_status === 'draft';
  const revealed = Boolean(publication) || !unavailable && row.discovery_status === 'revealed';
  const artworkId = publication ? publication.artwork_id : row.artwork_id;
  return json({
    schemaVersion: '1',
    mode: 'live',
    ownership: {
      id: row.id, userId: session.userId, veilingId: row.veiling_id,
      acquisition: row.acquisition, acquiredAt: new Date(row.acquired_at * 1000).toISOString(),
      physicalCardId: null,
    },
    veiling: {
      id: row.veiling_id, number: unavailable ? null : publication ? publication.character_number : row.character_number,
      name: revealed ? publication ? publication.name : row.name : null,
      description: revealed ? publication ? publication.description : row.description : null,
      artworkUrl: revealed && artworkId ? `/api/artwork/${artworkId}` : null,
      contentStatus: unavailable ? 'unavailable' : revealed ? 'published' : 'redacted',
    },
  });
}

async function createVeiling(request: Request, env: Env, session: AuthSession): Promise<Response> {
  const db = env.DB.withSession('first-primary');
  requireCsrf(request, env, session);
  const input = parseInput(await readJson(request, 100000));
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  let results: D1Result<CatalogRow>[];
  try {
    results = await db.batch<CatalogRow>([
      db.prepare(`INSERT INTO catalog_veilings
        (id, name, description, character_number, status, rarity, edition, created_by, updated_by, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${ADMIN_EXISTS}`)
        .bind(id, input.name, input.description, input.number, input.status, input.rarity, input.edition,
          session.userId, session.userId, now, now, session.userId),
      db.prepare(`INSERT INTO catalog_audit (id, veiling_id, actor_user_id, action, before_json, after_json, created_at)
        SELECT ?, id, ?, 'create', NULL, ${AUDIT_JSON}, ? FROM catalog_veilings WHERE id = ? AND changes() = 1`)
        .bind(crypto.randomUUID(), session.userId, now, id),
      db.prepare(`${CATALOG_WITH_PUBLICATION} WHERE v.id = ?`).bind(id),
    ]);
  } catch (error) { catalogDatabaseError(error); }
  if (results![0].meta.changes !== 1) throw new HttpError(403, 'ADMIN_REQUIRED', 'Trusted administrator access is required.');
  return json(adminProjection(results![2].results[0] as CatalogRow), 201);
}

async function updateVeiling(request: Request, env: Env, session: AuthSession, id: string): Promise<Response> {
  const db = env.DB.withSession('first-primary');
  requireCsrf(request, env, session);
  const existing = await catalogRow(env, id);
  requireRevision(request, existing.revision);
  const input = parseInput(await readJson(request, 100000), existing);
  const now = Math.floor(Date.now() / 1000);
  let results: D1Result<CatalogRow>[];
  try {
    results = await db.batch<CatalogRow>([
      db.prepare(`UPDATE catalog_veilings SET name = ?, description = ?, character_number = ?, status = ?,
        rarity = ?, edition = ?, updated_by = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND ${ADMIN_EXISTS}`)
        .bind(input.name, input.description, input.number, input.status, input.rarity, input.edition,
          session.userId, now, id, existing.revision, session.userId),
      db.prepare(`INSERT INTO catalog_audit (id, veiling_id, actor_user_id, action, before_json, after_json, created_at)
        SELECT ?, id, ?, 'update', ?, ${AUDIT_JSON}, ? FROM catalog_veilings WHERE id = ? AND changes() = 1`)
        .bind(crypto.randomUUID(), session.userId, JSON.stringify(auditProjection(existing)), now, id),
      db.prepare(`${CATALOG_WITH_PUBLICATION} WHERE v.id = ?`).bind(id),
    ]);
  } catch (error) { catalogDatabaseError(error); }
  if (results![0].meta.changes !== 1) {
    await requireAdmin(env, session);
    throw new HttpError(409, 'CATALOG_CHANGED', 'The catalog changed. Reload before saving again.');
  }
  return json(adminProjection(results![2].results[0] as CatalogRow));
}

function requireRevision(request: Request, current: number): void {
  const header = request.headers.get('If-Match');
  if (!header) throw new HttpError(428, 'REVISION_REQUIRED', 'Reload the catalog before editing this Veiling.');
  const match = header.match(/^"([1-9][0-9]{0,15})"$/);
  if (!match || !Number.isSafeInteger(Number(match[1]))) invalidInput('Send a valid catalog revision.');
  if (Number(match[1]) !== current) throw new HttpError(409, 'CATALOG_CHANGED', 'The catalog changed. Reload before saving again.');
}

function imageExtension(contentType: string, bytes: Uint8Array): string {
  if (contentType === 'image/png' && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return 'png';
  if (contentType === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (contentType === 'image/webp' && bytes.length >= 12 &&
      String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'webp';
  invalidInput('Choose a PNG, JPEG, or WebP image with a matching file signature.');
}

async function uploadArtwork(request: Request, env: Env, session: AuthSession, id: string): Promise<Response> {
  const db = env.DB.withSession('first-primary');
  requireCsrf(request, env, session);
  const existing = await catalogRow(env, id);
  requireRevision(request, existing.revision);
  const contentType = request.headers.get('content-type') ?? '';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) invalidInput('Choose a PNG, JPEG, or WebP image.');
  const bytes = await readBytes(request, MAX_ARTWORK_BYTES);
  const extension = imageExtension(contentType, bytes);
  const artworkId = crypto.randomUUID();
  const objectKey = `veilings/${id}/${artworkId}.${extension}`;
  const now = Math.floor(Date.now() / 1000);
  const stored = await env.ARTWORK.put(objectKey, bytes, {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType, cacheControl: 'private, no-store' },
  });
  if (!stored) throw new HttpError(409, 'ARTWORK_CONFLICT', 'The artwork could not be stored. Try again.');
  let results: D1Result<CatalogRow>[];
  try {
    results = await db.batch<CatalogRow>([
      db.prepare(`INSERT INTO artwork (id, veiling_id, object_key, content_type, byte_length, created_by, created_at)
        SELECT ?, id, ?, ?, ?, ?, ? FROM catalog_veilings WHERE id = ? AND revision = ? AND ${ADMIN_EXISTS}`)
        .bind(artworkId, objectKey, contentType, bytes.byteLength, session.userId, now, id, existing.revision, session.userId),
      db.prepare(`UPDATE catalog_veilings SET artwork_id = ?, updated_by = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM artwork WHERE id = ?) AND ${ADMIN_EXISTS}`)
        .bind(artworkId, session.userId, now, id, existing.revision, artworkId, session.userId),
      db.prepare(`INSERT INTO catalog_audit (id, veiling_id, actor_user_id, action, before_json, after_json, created_at)
        SELECT ?, id, ?, 'artwork', ?, ${AUDIT_JSON}, ? FROM catalog_veilings WHERE id = ? AND changes() = 1`)
        .bind(crypto.randomUUID(), session.userId, JSON.stringify(auditProjection(existing)), now, id),
      db.prepare(`${CATALOG_WITH_PUBLICATION} WHERE v.id = ?`).bind(id),
    ]);
    if (results[1].meta.changes !== 1) {
      await requireAdmin(env, session);
      throw new HttpError(409, 'CATALOG_CHANGED', 'The catalog changed. Reload before uploading again.');
    }
  } catch (error) {
    // R2 and D1 cannot share a transaction. Failed attachment removes the new
    // object; a failed cleanup leaves an inaccessible orphan for later upkeep.
    await env.ARTWORK.delete(objectKey).catch(() => undefined);
    throw error;
  }
  return json(adminProjection(results[3].results[0] as CatalogRow));
}

async function artwork(env: Env, session: AuthSession, id: string): Promise<Response> {
  const row = await env.DB.withSession('first-primary').prepare(`SELECT a.* FROM artwork a JOIN catalog_veilings v ON v.id = a.veiling_id
    WHERE a.id = ? AND (${ADMIN_EXISTS} OR EXISTS(
      SELECT 1 FROM veiling_publications p WHERE p.veiling_id=v.id AND p.artwork_id=a.id
    ) OR (
      v.status != 'draft' AND v.artwork_id = a.id
      AND NOT EXISTS(SELECT 1 FROM veiling_publications p WHERE p.veiling_id=v.id)
      AND EXISTS (SELECT 1 FROM discoveries d WHERE d.veiling_id = v.id AND d.status = 'revealed')
      AND EXISTS (
        SELECT 1 FROM ownerships o WHERE o.user_id = ? AND o.veiling_id = a.veiling_id
      )
    ))`).bind(id, session.userId, session.userId).first<ArtworkRow>();
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'The artwork was not found.');
  const object = await env.ARTWORK.get(row.object_key);
  if (!object) throw new HttpError(404, 'NOT_FOUND', 'The artwork was not found.');
  return new Response(object.body, { headers: {
    'Content-Type': row.content_type,
    'Content-Length': String(row.byte_length),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  } });
}

export async function handleData(request: Request, env: Env): Promise<Response | null> {
  const showcaseResponse = await handleShowcase(request, env);
  if (showcaseResponse) return showcaseResponse;
  const accountResponse = await handleAdminAccounts(request, env);
  if (accountResponse) return accountResponse;
  const path = new URL(request.url).pathname;
  const veilingMatch = path.match(/^\/api\/admin\/veilings\/([^/]+)(\/artwork|\/publication)?$/);
  const artworkMatch = path.match(/^\/api\/artwork\/([^/]+)$/);
  const ownershipMatch = path.match(/^\/api\/ownerships\/([^/]*)$/);
  const isKnown = ['/api/dashboard', '/api/admin/access', '/api/admin/veilings'].includes(path) || veilingMatch || artworkMatch || ownershipMatch;
  if (!isKnown) return null;
  const session = await requireSession(request, env);
  if (path === '/api/dashboard') {
    if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
    return dashboard(env, session);
  }
  if (ownershipMatch) {
    if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
    if (!UUID.test(ownershipMatch[1])) throw new HttpError(404, 'NOT_FOUND', 'The ownership was not found.');
    return ownershipDetail(env, session, ownershipMatch[1].toLowerCase());
  }
  if (path === '/api/admin/access') {
    if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
    const role = await getAdminRole(env, session.userId);
    return json({ admin: role !== null, role });
  }
  if (artworkMatch) {
    if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
    if (!UUID.test(artworkMatch[1])) throw new HttpError(404, 'NOT_FOUND', 'The artwork was not found.');
    return artwork(env, session, artworkMatch[1].toLowerCase());
  }
  await requireAdmin(env, session);
  if (path === '/api/admin/veilings') {
    if (request.method === 'GET') {
      const rows = await env.DB.withSession('first-primary').prepare(`${CATALOG_WITH_PUBLICATION} ORDER BY v.character_number IS NULL, v.character_number, v.created_at DESC, v.id LIMIT 200`).all<CatalogRow>();
      return json(rows.results.map(adminProjection));
    }
    if (request.method === 'POST') return createVeiling(request, env, session);
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use GET or POST for this endpoint.');
  }
  const id = veilingMatch![1].toLowerCase();
  if (!UUID.test(id)) invalidInput('Select a valid Veiling.');
  if (veilingMatch![2] === '/publication') {
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST for this endpoint.');
    return json(adminProjection(await publishPublication(request, env, session, id)));
  }
  if (veilingMatch![2]) {
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST for this endpoint.');
    return uploadArtwork(request, env, session, id);
  }
  if (request.method !== 'PATCH') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use PATCH for this endpoint.');
  return updateVeiling(request, env, session, id);
}
