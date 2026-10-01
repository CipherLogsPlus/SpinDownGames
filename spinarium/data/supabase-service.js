/**
 * Authenticated Spinarium read/editor adapter. This talks only to the separate
 * Spinarium Supabase project. RLS/RPC authorization is the authority; neither
 * user metadata nor a visible admin route grants access.
 */
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpeg"],
  ["image/webp", "webp"],
]);
const ARRAY_FIELDS = [
  "veilings",
  "series",
  "editions",
  "variants",
  "rarities",
  "physicalCards",
  "ownerships",
  "discoveries",
  "achievements",
  "userAchievements",
  "collections",
  "news",
  "events",
];

export class SpinariumServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SpinariumServiceError";
    this.code = code;
  }
}

function configuration(config) {
  const key = config?.supabasePublishableKey?.trim() ?? "";
  try {
    const url = new URL(config?.supabaseUrl ?? "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/?$/.test(url.pathname)
    )
      throw new Error();
    if (!key || key.startsWith("sb_secret_")) throw new Error();
    // Reject an accidentally pasted legacy elevated JWT key. Publishable keys
    // are intentionally public; service-role credentials must never ship here.
    if (key.split(".").length === 3) {
      const encoded = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(
        atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
      );
      if (payload.role !== "anon") throw new Error();
    }
    return { url: url.origin, key };
  } catch {
    return null;
  }
}

function requireId(id) {
  if (typeof id !== "string" || !UUID.test(id))
    throw new SpinariumServiceError(
      "INVALID_INPUT",
      "Select a valid Veiling first.",
    );
  return id.toLowerCase();
}

function inputText(value, maximum, { required = false } = {}) {
  if (typeof value !== "string" && value != null)
    throw new SpinariumServiceError(
      "INVALID_INPUT",
      "Check the Veiling fields and try again.",
    );
  const text = (value ?? "").trim();
  if (text.length > maximum || (required && !text))
    throw new SpinariumServiceError(
      "INVALID_INPUT",
      "Check the Veiling fields and try again.",
    );
  return text;
}

/**
 * @param {{supabaseUrl:string,supabasePublishableKey:string}} config
 * @param {{getAccessToken:()=>string|null,getSession:()=>{user:{id:string}}|null}} auth
 * @param {{fetchImpl?:typeof fetch}} [options]
 */
export function createSpinariumService(
  config,
  auth,
  { fetchImpl = globalThis.fetch } = {},
) {
  const settings = configuration(config);

  function access() {
    if (!settings)
      throw new SpinariumServiceError(
        "CONFIGURATION_REQUIRED",
        "Spinarium’s dedicated backend is not configured yet.",
      );
    const token = auth.getAccessToken();
    if (!token)
      throw new SpinariumServiceError(
        "AUTH_REQUIRED",
        "Sign in to open your Spinarium.",
      );
    return token;
  }

  function captureIdentity() {
    const token = access();
    const userId = auth.getSession()?.user?.id;
    if (!userId)
      throw new SpinariumServiceError(
        "AUTH_REQUIRED",
        "Sign in to open your Spinarium.",
      );
    return { token, userId };
  }

  function assertIdentity(identity) {
    if (
      auth.getAccessToken() !== identity.token ||
      auth.getSession()?.user?.id !== identity.userId
    )
      throw new SpinariumServiceError(
        "AUTH_REQUIRED",
        "Your session changed. Sign in and try again.",
      );
  }

  async function request(
    path,
    {
      method = "POST",
      body = {},
      signal,
      identity,
      token = identity?.token ?? access(),
      binary = false,
      headers = {},
    } = {},
  ) {
    if (identity) assertIdentity(identity);
    let response;
    try {
      response = await fetchImpl(`${settings.url}${path}`, {
        method,
        signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: {
          apikey: settings.key,
          Authorization: `Bearer ${token}`,
          ...(binary ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        ...(method === "GET"
          ? {}
          : { body: binary ? body : JSON.stringify(body) }),
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new SpinariumServiceError(
        "NETWORK_ERROR",
        "Spinarium could not reach its backend. Please try again.",
      );
    }
    let result;
    try {
      result = await response.json();
    } catch {
      result = null;
    }
    if (!response.ok) {
      if (response.status === 401)
        throw new SpinariumServiceError(
          "AUTH_REQUIRED",
          "Your session ended. Sign in again.",
        );
      if (response.status === 403)
        throw new SpinariumServiceError(
          "ACCESS_DENIED",
          "This account cannot perform that action.",
        );
      if (["PGRST202", "PGRST205", "42P01", "42883"].includes(result?.code))
        throw new SpinariumServiceError(
          "SCHEMA_REQUIRED",
          "The Spinarium backend schema has not been installed.",
        );
      // Never copy a server error/request payload into user-visible errors or
      // logs: Storage responses can contain signed URLs and credential data.
      throw new SpinariumServiceError(
        "BACKEND_ERROR",
        "The backend could not complete that action. No local changes were saved.",
      );
    }
    return result;
  }

  async function getAdminAccess(options = {}) {
    try {
      const identity = options.identity ?? captureIdentity();
      const result = await request("/rest/v1/rpc/is_spinarium_admin", {
        identity,
      });
      assertIdentity(identity);
      return result === true;
    } catch {
      return false;
    }
  }

  async function requireAdmin(identity) {
    assertIdentity(identity);
    const permitted = await getAdminAccess({ identity });
    assertIdentity(identity);
    if (!permitted)
      throw new SpinariumServiceError(
        "ACCESS_DENIED",
        "Spinarium administrator access is required.",
      );
  }

  async function signedArtwork(path, identity, signal) {
    if (
      typeof path !== "string" ||
      !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpeg|webp)$/.test(path)
    )
      throw new SpinariumServiceError(
        "INVALID_PROJECTION",
        "The artwork record is invalid.",
      );
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const result = await request(
      `/storage/v1/object/sign/spinarium-artwork/${encoded}`,
      { body: { expiresIn: 300 }, identity, signal },
    );
    assertIdentity(identity);
    const signed = result?.signedURL ?? result?.signedUrl;
    if (typeof signed !== "string")
      throw new SpinariumServiceError(
        "INVALID_PROJECTION",
        "The artwork could not be opened.",
      );
    const url = new URL(
      signed.startsWith("/object/") ? `/storage/v1${signed}` : signed,
      settings.url,
    );
    if (
      url.origin !== settings.url ||
      !url.pathname.startsWith("/storage/v1/object/sign/spinarium-artwork/")
    )
      throw new SpinariumServiceError(
        "INVALID_PROJECTION",
        "The artwork could not be opened.",
      );
    return url.href;
  }

  async function withArtwork(row, identity, signal) {
    assertIdentity(identity);
    let artworkUrl = null;
    let artworkPreviewUnavailable = false;
    if (row.artwork_path) {
      try {
        artworkUrl = await signedArtwork(row.artwork_path, identity, signal);
      } catch (error) {
        if (error?.code === "AUTH_REQUIRED" || error?.name === "AbortError")
          throw error;
        assertIdentity(identity);
        // Preview signing failure does not undo a committed save. Return the
        // authoritative saved row so a retry cannot accidentally duplicate it.
        artworkPreviewUnavailable = true;
      }
    }
    return { ...row, artworkUrl, artworkPreviewUnavailable };
  }

  async function getDashboard({ signal } = {}) {
    const identity = captureIdentity();
    const { userId } = identity;
    const snapshot = await request("/rest/v1/rpc/spinarium_dashboard", {
      identity,
      signal,
    });
    assertIdentity(identity);
    if (
      snapshot?.schemaVersion !== "1" ||
      snapshot.mode !== "live" ||
      !userId ||
      snapshot.profile?.id !== userId ||
      ARRAY_FIELDS.some((field) => !Array.isArray(snapshot[field]))
    )
      throw new SpinariumServiceError(
        "INVALID_PROJECTION",
        "The backend returned an incompatible collection record.",
      );
    // Reject a mistaken broader projection instead of exposing another user's
    // collection. This guard complements (and never replaces) database RLS.
    if (snapshot.ownerships.some((ownership) => ownership.userId !== userId))
      throw new SpinariumServiceError(
        "INVALID_PROJECTION",
        "The backend returned an incompatible collection record.",
      );
    const ownedIds = new Set(
      snapshot.ownerships.map((ownership) => ownership.veilingId),
    );
    if (snapshot.veilings.some((veiling) => !ownedIds.has(veiling.id)))
      throw new SpinariumServiceError(
        "INVALID_PROJECTION",
        "The backend returned an incompatible collection record.",
      );
    const urls = new Map();
    for (const veiling of snapshot.veilings) {
      if (!Array.isArray(veiling.artwork))
        throw new SpinariumServiceError(
          "INVALID_PROJECTION",
          "The backend returned an incompatible artwork record.",
        );
      for (const artwork of veiling.artwork) {
        if (!artwork.storagePath)
          throw new SpinariumServiceError(
            "INVALID_PROJECTION",
            "The backend returned an incompatible artwork record.",
          );
        assertIdentity(identity);
        if (!urls.has(artwork.storagePath))
          urls.set(
            artwork.storagePath,
            signedArtwork(artwork.storagePath, identity, signal),
          );
        artwork.url = await urls.get(artwork.storagePath);
        delete artwork.storagePath;
      }
    }
    assertIdentity(identity);
    return snapshot;
  }

  async function listAdminVeilings({ signal } = {}) {
    const identity = captureIdentity();
    await requireAdmin(identity);
    const rows = await request(
      "/rest/v1/spinarium_veilings?select=*&order=character_number.asc.nullslast,created_at.desc",
      { method: "GET", identity, signal },
    );
    assertIdentity(identity);
    if (!Array.isArray(rows))
      throw new SpinariumServiceError(
        "INVALID_PROJECTION",
        "The backend returned an incompatible catalog.",
      );
    return Promise.all(rows.map((row) => withArtwork(row, identity, signal)));
  }

  async function saveVeiling(input) {
    const identity = captureIdentity();
    const id = input.id ? requireId(input.id) : null;
    const number =
      input.number === "" || input.number == null ? null : Number(input.number);
    if (
      number !== null &&
      (!Number.isSafeInteger(number) || number < 1 || number > 999999)
    )
      throw new SpinariumServiceError(
        "INVALID_INPUT",
        "The character number must be a whole number from 1 to 999999.",
      );
    if (!["draft", "active", "retired"].includes(input.status))
      throw new SpinariumServiceError(
        "INVALID_INPUT",
        "Choose a valid publication status.",
      );
    const row = {
      name: inputText(input.name, 120, { required: true }),
      description: inputText(input.description, 20000),
      character_number: number,
      status: input.status,
      rarity: inputText(input.rarity, 80) || null,
      edition: inputText(input.edition, 120) || null,
    };
    await requireAdmin(identity);
    const result = await request(
      `/rest/v1/spinarium_veilings${id ? `?id=eq.${id}` : ""}`,
      {
        method: id ? "PATCH" : "POST",
        body: row,
        identity,
        headers: { Prefer: "return=representation" },
      },
    );
    if (!Array.isArray(result) || result.length !== 1)
      throw new SpinariumServiceError(
        "NOT_FOUND",
        "The Veiling could not be saved. Reload the catalog and try again.",
      );
    return withArtwork(result[0], identity);
  }

  async function uploadArtwork({ veilingId, file }) {
    const identity = captureIdentity();
    const id = requireId(veilingId);
    const extension = IMAGE_TYPES.get(file?.type);
    if (
      !extension ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0 ||
      file.size > MAX_ARTWORK_BYTES ||
      typeof file.slice !== "function"
    )
      throw new SpinariumServiceError(
        "INVALID_INPUT",
        "Choose a PNG, JPEG, or WebP image of 8 MB or less.",
      );
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    assertIdentity(identity);
    const headerMatches =
      extension === "png"
        ? [137, 80, 78, 71, 13, 10, 26, 10].every(
            (byte, index) => bytes[index] === byte,
          )
        : extension === "jpeg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : bytes.length >= 12 &&
            String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
            String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    if (!headerMatches)
      throw new SpinariumServiceError(
        "INVALID_INPUT",
        "The file does not match its image type.",
      );
    await requireAdmin(identity);
    const path = `${id}/${crypto.randomUUID()}.${extension}`;
    await request(`/storage/v1/object/spinarium-artwork/${path}`, {
      method: "POST",
      body: file,
      binary: true,
      identity,
      headers: { "Content-Type": file.type, "x-upsert": "false" },
    });
    const rows = await request(`/rest/v1/spinarium_veilings?id=eq.${id}`, {
      method: "PATCH",
      body: { artwork_path: path },
      identity,
      headers: { Prefer: "return=representation" },
    });
    if (!Array.isArray(rows) || rows.length !== 1)
      throw new SpinariumServiceError(
        "NOT_FOUND",
        "The upload completed, but the artwork could not be attached. Reload the catalog before retrying.",
      );
    return withArtwork(rows[0], identity);
  }

  return Object.freeze({
    configured: Boolean(settings),
    getDashboard,
    getAdminAccess,
    listAdminVeilings,
    saveVeiling,
    uploadArtwork,
    getCapabilities() {
      return {
        authentication: Boolean(settings),
        claims: false,
        transfers: false,
        notifications: false,
        threeDimensionalView: false,
      };
    },
  });
}
