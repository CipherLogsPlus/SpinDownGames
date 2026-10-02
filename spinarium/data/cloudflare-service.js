/**
 * Protected Worker APIs, separate from the UI and InvoHub. Every read and
 * mutation is authorized by the Worker; browser routes never grant permission.
 */
import { cloudflareConnection } from "../auth/cloudflare-auth.js";
import { createAdminAccountService } from "./admin-account-service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARTWORK = /^\/api\/artwork\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ARRAY_FIELDS = ["veilings", "series", "editions", "variants", "rarities",
  "physicalCards", "ownerships", "discoveries", "achievements", "userAchievements",
  "collections", "news", "events"];
const MESSAGES = Object.freeze({
  CONFIGURATION_REQUIRED: "Spinarium’s secure backend is not configured yet.",
  AUTH_REQUIRED: "Your session changed or ended. Sign in and try again.",
  ACCESS_DENIED: "This account cannot perform that action.",
  INVALID_INPUT: "Check the submitted fields and try again.",
  INVALID_PROJECTION: "The backend returned an incompatible collection record.",
  NOT_FOUND: "The Veiling could not be found. Reload the catalog and try again.",
  NETWORK_ERROR: "Spinarium could not reach its backend. Please try again.",
  RATE_LIMITED: "Too many requests. Please wait before trying again.",
  BACKEND_UNAVAILABLE: "The secure Spinarium service is not available yet.",
  BACKEND_ERROR: "The backend could not complete that action. No changes have been confirmed.",
  CANCELLED: "The request was cancelled.",
  REVISION_REQUIRED: "Reload this Veiling before saving or uploading artwork.",
  STALE_REVISION: "This Veiling has changed. Reload the catalog before saving again.",
  NUMBER_IN_USE: "This character number is already in use. Choose another number.",
  ACCOUNT_CHANGED: "This account has changed. Review its current details and confirm the action again.",
  PROTECTED_ACCOUNT: "This account is protected from that action.",
});
export class SpinariumServiceError extends Error {
  constructor(code) {
    super(MESSAGES[code] || MESSAGES.BACKEND_ERROR);
    this.name = "SpinariumServiceError";
    this.code = code in MESSAGES ? code : "BACKEND_ERROR";
  }
}
function requireId(id) {
  if (typeof id !== "string" || !UUID.test(id)) throw new SpinariumServiceError("INVALID_INPUT");
  return id.toLowerCase();
}
function textInput(value, maximum, required = false) {
  if (value != null && typeof value !== "string") throw new SpinariumServiceError("INVALID_INPUT");
  const text = (value || "").trim();
  if (text.length > maximum || (required && !text)) throw new SpinariumServiceError("INVALID_INPUT");
  return text;
}
function artworkUrl(value) {
  if (value == null) return null;
  if (typeof value !== "string" || !ARTWORK.test(value)) throw new SpinariumServiceError("INVALID_PROJECTION");
  return value;
}
function catalogRow(row) {
  if (!row || typeof row !== "object" || !UUID.test(row.id) ||
    typeof row.name !== "string" || !row.name || row.name.length > 120 ||
    typeof row.description !== "string" || row.description.length > 20000 ||
    !["draft", "active", "retired"].includes(row.status) ||
    !Number.isSafeInteger(row.revision) || row.revision < 1 ||
    (row.character_number != null && (!Number.isSafeInteger(row.character_number) || row.character_number < 1 || row.character_number > 999999)) ||
    (row.rarity != null && (typeof row.rarity !== "string" || row.rarity.length > 80)) ||
    (row.edition != null && (typeof row.edition !== "string" || row.edition.length > 120)))
    throw new SpinariumServiceError("INVALID_PROJECTION");
  return {
    id: row.id, revision: row.revision, name: row.name, description: row.description,
    character_number: row.character_number ?? null, status: row.status,
    rarity: row.rarity ?? null, edition: row.edition ?? null,
    artworkUrl: artworkUrl(row.artworkUrl),
  };
}

export function createSpinariumService(config, auth, { fetchImpl = globalThis.fetch, origin = globalThis.location?.origin } = {}) {
  const connection = cloudflareConnection(config);
  function captureIdentity() {
    if (connection.error) throw new SpinariumServiceError("CONFIGURATION_REQUIRED");
    const session = auth.getSession();
    if (!session?.user?.id || session.flow !== "password") throw new SpinariumServiceError("AUTH_REQUIRED");
    return session;
  }
  function assertIdentity(identity) {
    if (auth.getSession() !== identity) throw new SpinariumServiceError("AUTH_REQUIRED");
  }
  async function request(path, { method = "GET", body, binary = false, contentType,
    signal, revision, identity = captureIdentity() } = {}) {
    assertIdentity(identity);
    const mutating = method !== "GET";
    const csrfToken = mutating ? auth.getCsrfToken?.() : null;
    if (mutating && (typeof csrfToken !== "string" || !/^[a-zA-Z0-9_-]{32,256}$/.test(csrfToken)))
      throw new SpinariumServiceError("AUTH_REQUIRED");
    let response;
    try {
      response = await fetchImpl(`${connection.base}${path}`, {
        method, credentials: "same-origin", mode: "same-origin", cache: "no-store",
        redirect: "error", referrerPolicy: "same-origin",
        headers: {
          Accept: "application/json",
          ...(mutating ? { "Content-Type": binary ? contentType : "application/json", "x-csrf-token": csrfToken } : {}),
          ...(revision != null ? { "If-Match": `"${revision}"` } : {}),
        },
        ...(mutating ? { body: binary ? body : JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch { throw new SpinariumServiceError(signal?.aborted ? "CANCELLED" : "NETWORK_ERROR"); }
    assertIdentity(identity);
    if (!response || typeof response.ok !== "boolean") throw new SpinariumServiceError("BACKEND_ERROR");
    if (response.status === 401) {
      auth.invalidateSession?.();
      throw new SpinariumServiceError("AUTH_REQUIRED");
    }
    const failure = { 400: "INVALID_INPUT", 403: "ACCESS_DENIED", 404: "NOT_FOUND",
      409: "STALE_REVISION", 428: "REVISION_REQUIRED", 429: "RATE_LIMITED", 503: "BACKEND_UNAVAILABLE" };
    if (!response.ok) {
      if (response.status === 409 || response.status === 403) {
        let errorCode;
        try { errorCode = (await response.json())?.code; } catch { /* Only known codes are read. */ }
        assertIdentity(identity);
        if (errorCode === "NUMBER_IN_USE") throw new SpinariumServiceError("NUMBER_IN_USE");
        if (errorCode === "ACCOUNT_CHANGED") throw new SpinariumServiceError("ACCOUNT_CHANGED");
        if (errorCode === "PROTECTED_ACCOUNT") throw new SpinariumServiceError("PROTECTED_ACCOUNT");
      }
      throw new SpinariumServiceError(failure[response.status] || "BACKEND_ERROR");
    }
    let result;
    try { result = await response.json(); }
    catch { throw new SpinariumServiceError("INVALID_PROJECTION"); }
    assertIdentity(identity);
    if (signal?.aborted) throw new SpinariumServiceError("CANCELLED");
    return result;
  }
  async function getAdminAccess({ signal } = {}) {
    try {
      const result = await request("/admin/access", { signal });
      return result?.admin === true;
    } catch { return false; }
  }
  async function getAdminContext({ signal } = {}) {
    const result = await request("/admin/access", { signal });
    if (typeof result?.admin !== "boolean" || ![null, "admin", "owner"].includes(result.role) ||
      result.admin !== (result.role === "admin" || result.role === "owner"))
      throw new SpinariumServiceError("INVALID_PROJECTION");
    return { admin: result.admin, role: result.role };
  }
  async function getDashboard({ signal } = {}) {
    const identity = captureIdentity();
    const data = await request("/dashboard", { identity, signal });
    const userId = identity.user.id;
    if (data?.schemaVersion !== "1" || data.mode !== "live" || data.profile?.id !== userId ||
      ARRAY_FIELDS.some((field) => !Array.isArray(data[field])) ||
      data.ownerships.some((item) => item?.userId !== userId) ||
      data.userAchievements.some((item) => item?.userId !== userId))
      throw new SpinariumServiceError("INVALID_PROJECTION");
    const ownedIds = new Set(data.ownerships.map((item) => item.veilingId));
    for (const veiling of data.veilings) {
      if (!veiling || !UUID.test(veiling.id) || !ownedIds.has(veiling.id) || !Array.isArray(veiling.artwork))
        throw new SpinariumServiceError("INVALID_PROJECTION");
      for (const artwork of veiling.artwork) {
        if (!artwork || !artworkUrl(artwork.url)) throw new SpinariumServiceError("INVALID_PROJECTION");
      }
    }
    return data;
  }
  async function listAdminVeilings({ signal } = {}) {
    const rows = await request("/admin/veilings", { signal });
    if (!Array.isArray(rows)) throw new SpinariumServiceError("INVALID_PROJECTION");
    return rows.map(catalogRow);
  }
  async function saveVeiling(input) {
    const identity = captureIdentity();
    if (!input || typeof input !== "object") throw new SpinariumServiceError("INVALID_INPUT");
    const id = input.id ? requireId(input.id) : null;
    if (id && (!Number.isSafeInteger(input.revision) || input.revision < 1))
      throw new SpinariumServiceError("REVISION_REQUIRED");
    const number = input.number == null || input.number === "" ? null : Number(input.number);
    if ((number != null && (!Number.isSafeInteger(number) || number < 1 || number > 999999)) ||
      !["draft", "active", "retired"].includes(input.status)) throw new SpinariumServiceError("INVALID_INPUT");
    const body = {
      name: textInput(input.name, 120, true), description: textInput(input.description, 20000),
      number, status: input.status, rarity: textInput(input.rarity, 80) || null,
      edition: textInput(input.edition, 120) || null,
    };
    // System IDs, roles and ownership fields are never submitted in the body.
    const row = await request(`/admin/veilings${id ? `/${id}` : ""}`, {
      method: id ? "PATCH" : "POST", body, identity,
      ...(id ? { revision: input.revision } : {}),
    });
    const saved = catalogRow(row);
    if (id && saved.id.toLowerCase() !== id) throw new SpinariumServiceError("INVALID_PROJECTION");
    return saved;
  }
  async function uploadArtwork({ veilingId, file, revision } = {}) {
    const identity = captureIdentity();
    const id = requireId(veilingId);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new SpinariumServiceError("REVISION_REQUIRED");
    if (!IMAGE_TYPES.has(file?.type) || !Number.isSafeInteger(file.size) ||
      file.size <= 0 || file.size > MAX_ARTWORK_BYTES || typeof file.slice !== "function")
      throw new SpinariumServiceError("INVALID_INPUT");
    let bytes;
    try { bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer()); }
    catch { throw new SpinariumServiceError("INVALID_INPUT"); }
    assertIdentity(identity);
    const matches = file.type === "image/png"
      ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
      : file.type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
          String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    if (!matches) throw new SpinariumServiceError("INVALID_INPUT");
    const saved = catalogRow(await request(`/admin/veilings/${id}/artwork`, {
      method: "POST", body: file, binary: true, contentType: file.type, identity, revision,
    }));
    if (saved.id.toLowerCase() !== id) throw new SpinariumServiceError("INVALID_PROJECTION");
    return saved;
  }
  return Object.freeze({
    configured: !connection.error,
    getDashboard, getAdminAccess, getAdminContext, listAdminVeilings, saveVeiling, uploadArtwork,
    ...createAdminAccountService({ request, ErrorClass: SpinariumServiceError, origin }),
    getCapabilities: () => ({ authentication: !connection.error, claims: false,
      transfers: false, notifications: false, threeDimensionalView: false }),
  });
}
