import assert from "node:assert/strict";
import { createSpinariumService, SpinariumServiceError } from "../spinarium/data/cloudflare-service.js";
import { getDashboardStats, getVeilingDetail, queryCollection } from "../spinarium/domain/collection.js";
import { releaseLabel, validReleaseDate } from "../spinarium/domain/showcase.js";

// Isolated HTTP doubles and pure domain checks; no account or publication is created.
const config = { backend: "cloudflare", authProvider: "password", apiBase: "/api" };
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const veilingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherVeilingId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const artworkId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const recordId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const csrfToken = "isolated_showcase_csrf_token_1234567890123456789";
const publication = (overrides = {}) => ({ id: veilingId, name: "Approved member name", number: 7,
  description: "Approved member description", rarity: null, edition: null,
  artworkUrl: `/api/artwork/${artworkId}`, visibility: "public", releaseDate: null,
  updatedAt: "2026-10-03T00:00:00.000Z", ...overrides });
const catalogRow = (overrides = {}) => ({ id: veilingId, revision: 8, name: "Working draft name",
  description: "Working draft description", character_number: 7, status: "draft", rarity: null,
  edition: null, artworkUrl: null, publication: { ...publication(), sourceRevision: 3 }, ...overrides });
const envelope = (veilings = [publication()]) => ({ schemaVersion: "1", mode: "live", veilings });
const detailEnvelope = (veiling = publication()) => ({ schemaVersion: "1", mode: "live", veiling });
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});
const publishInput = (overrides = {}) => ({ id: veilingId, revision: 7, visibility: "public",
  releaseDate: null, useSavedDraft: true, ...overrides });
function fixture(responder = () => json(envelope())) {
  let session = { user: { id: userId }, flow: "password" }, csrf = csrfToken;
  const calls = [];
  const auth = { getSession: () => session, getCsrfToken: () => csrf,
    invalidateSession: () => { session = null; csrf = null; } };
  const service = createSpinariumService(config, auth, { fetchImpl: async (path, options) => {
    calls.push({ path, options }); return responder(path, options);
  } });
  return { service, calls, auth, setSession: value => { session = value; }, setCsrf: value => { csrf = value; } };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function rejectCode(promise, code) {
  return assert.rejects(promise, error => {
    assert(error instanceof SpinariumServiceError);
    assert.equal(error.code, code);
    assert.equal(error.message.includes("private-provider-detail"), false);
    assert.equal("cause" in error, false);
    return true;
  });
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("PASS " + name); }

await test("showcase accepts member projections, strips extras, and reads with same-origin credentials", async () => {
  const approved = publication();
  const upcoming = publication({ id: otherVeilingId, visibility: "upcoming", releaseDate: "2028-02-29",
    artworkUrl: null, number: null, description: "" });
  const f = fixture(() => json(envelope([{ ...approved, workingDraft: "private-provider-detail", sourceRevision: 4 }, upcoming])));
  assert.deepEqual(await f.service.getShowcase(), [approved, upcoming]);
  const { path, options } = f.calls[0];
  assert.equal(path, "/api/showcase");
  assert.equal(options.method, "GET");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.mode, "same-origin");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  assert.equal(options.referrerPolicy, "same-origin");
  assert.deepEqual(options.headers, { Accept: "application/json" });
  assert.equal("body" in options, false);
});

await test("showcase requires a password session before reads or publication requests", async () => {
  for (const session of [null, { user: { id: userId }, flow: "preview" }]) {
    const f = fixture(); f.setSession(session);
    await rejectCode(f.service.getShowcase(), "AUTH_REQUIRED");
    await rejectCode(f.service.getShowcaseVeiling(veilingId), "AUTH_REQUIRED");
    await rejectCode(f.service.publishVeiling(publishInput()), "AUTH_REQUIRED");
    assert.equal(f.calls.length, 0);
  }
});

await test("invalid collection envelopes and duplicate member rows fail closed", async () => {
  for (const body of [null, [], { ...envelope(), schemaVersion: "2" }, { ...envelope(), mode: "demo" },
    { ...envelope(), veilings: {} }, envelope([publication(), publication({ name: "Duplicate ID" })])]) {
    await rejectCode(fixture(() => json(body)).service.getShowcase(), "INVALID_PROJECTION");
  }
  assert.deepEqual(await fixture(() => json(envelope([]))).service.getShowcase(), []);
});

await test("invalid member content, visibility, dates and unsafe artwork fail in both read routes", async () => {
  const invalid = [
    { id: "not-a-uuid" }, { name: "" }, { name: "x".repeat(121) }, { description: null },
    { description: "x".repeat(20001) }, { number: 0 }, { number: 1.5 }, { number: 1000000 },
    { visibility: "private" }, { visibility: "draft" }, { releaseDate: "2026-11-20" },
    { visibility: "upcoming", releaseDate: "2026-02-29" },
    { visibility: "upcoming", releaseDate: "0000-01-01" },
    { visibility: "upcoming", releaseDate: "2026-10-03T00:00:00Z" },
    { rarity: "" }, { rarity: "x".repeat(81) }, { edition: "x".repeat(121) }, { updatedAt: "tomorrow" },
    ...["https://example.invalid/art.png", "//example.invalid/art.png", "javascript:alert(1)",
      "data:image/png;base64,AA==", `/api/artwork/${artworkId}?draft=1`,
      `/api/artwork/${artworkId}/extra`, "/assets/unfinished.png", 7].map(artworkUrl => ({ artworkUrl })),
  ];
  for (const fields of invalid) {
    await rejectCode(fixture(() => json(envelope([publication(fields)]))).service.getShowcase(), "INVALID_PROJECTION");
    await rejectCode(fixture(() => json(detailEnvelope(publication(fields)))).service.getShowcaseVeiling(veilingId), "INVALID_PROJECTION");
  }
});

await test("detail IDs are normalized, checked before requests, and matched against the returned record", async () => {
  const f = fixture(() => json(detailEnvelope()));
  assert.deepEqual(await f.service.getShowcaseVeiling(veilingId.toUpperCase()), publication());
  assert.equal(f.calls[0].path, `/api/showcase/${veilingId}`);
  for (const id of [null, "", "../admin/veilings", `${veilingId}?preview=1`])
    await rejectCode(f.service.getShowcaseVeiling(id), "INVALID_INPUT");
  assert.equal(f.calls.length, 1);
  for (const body of [{ ...detailEnvelope(), schemaVersion: "2" }, { ...detailEnvelope(), mode: "preview" },
    detailEnvelope(publication({ id: otherVeilingId })), { schemaVersion: "1", mode: "live", veiling: null }])
    await rejectCode(fixture(() => json(body)).service.getShowcaseVeiling(veilingId), "INVALID_PROJECTION");
});

await test("publishing sends only visibility/date/source intent with CSRF and the quoted revision", async () => {
  const f = fixture(() => json(catalogRow()));
  const saved = await f.service.publishVeiling(publishInput({ id: veilingId.toUpperCase(),
    name: "unsaved form text", description: "unsaved text", userId, ownerships: [{ id: recordId }],
    status: "active", publication: publication({ name: "unreviewed override" }) }));
  assert.deepEqual(saved, catalogRow());
  const { path, options } = f.calls[0];
  assert.equal(path, `/api/admin/veilings/${veilingId}/publication`);
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.mode, "same-origin");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  assert.deepEqual(options.headers, { Accept: "application/json", "Content-Type": "application/json",
    "x-csrf-token": csrfToken, "If-Match": '"7"' });
  assert.deepEqual(JSON.parse(options.body), { visibility: "public", releaseDate: null, useSavedDraft: true });
});

await test("visibility-only changes preserve the approved projection independently from pending draft edits", async () => {
  const f = fixture((_path, options) => {
    const body = JSON.parse(options.body);
    return json(catalogRow({ publication: body.visibility === "private" ? null : {
      ...publication(), sourceRevision: 3, visibility: body.visibility, releaseDate: body.releaseDate,
    } }));
  });
  for (const [visibility, releaseDate] of [["upcoming", "2026-11-20"], ["upcoming", null], ["public", null], ["private", null]]) {
    const saved = await f.service.publishVeiling(publishInput({ visibility, releaseDate, useSavedDraft: false }));
    assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { visibility, releaseDate, useSavedDraft: false });
    assert.equal(saved.name, "Working draft name");
    if (visibility === "private") assert.equal(saved.publication, null);
    else {
      assert.equal(saved.publication.name, "Approved member name");
      assert.equal(saved.publication.sourceRevision, 3);
      assert.equal(saved.publication.visibility, visibility);
      assert.equal(saved.publication.releaseDate, releaseDate);
    }
  }
});

await test("invalid publication intent, date or missing revision is rejected before network activity", async () => {
  const f = fixture();
  for (const fields of [{ id: "bad" }, { visibility: "scheduled" }, { useSavedDraft: undefined },
    { useSavedDraft: "false" }, { visibility: "private", useSavedDraft: true },
    { visibility: "public", releaseDate: "2026-11-20" },
    { visibility: "private", useSavedDraft: false, releaseDate: "2026-11-20" },
    ...["2026-02-29", "2026-04-31", "0000-01-01", "2026-1-01", "tomorrow", ""].map(releaseDate => ({ visibility: "upcoming", releaseDate }))])
    await rejectCode(f.service.publishVeiling(publishInput(fields)), "INVALID_INPUT");
  for (const revision of [undefined, null, 0, -1, 1.5, "7"])
    await rejectCode(f.service.publishVeiling(publishInput({ revision })), "REVISION_REQUIRED");
  for (const csrf of [null, "short", "bad+csrf/token".repeat(4)]) {
    f.setCsrf(csrf);
    await rejectCode(f.service.publishVeiling(publishInput()), "AUTH_REQUIRED");
  }
  assert.equal(f.calls.length, 0);
});

await test("admin publication projections validate identity, source revision and member fields", async () => {
  const invalidPublications = [
    { ...publication(), sourceRevision: 0 }, { ...publication(), sourceRevision: 9 },
    { ...publication(), sourceRevision: "3" }, { ...publication(), sourceRevision: 3, id: otherVeilingId },
    { ...publication(), sourceRevision: 3, visibility: "private" },
    { ...publication(), sourceRevision: 3, artworkUrl: "https://example.invalid/private.png" },
  ];
  for (const publication of invalidPublications) {
    await rejectCode(fixture(() => json([catalogRow({ publication })])).service.listAdminVeilings(), "INVALID_PROJECTION");
    await rejectCode(fixture(() => json(catalogRow({ publication }))).service.publishVeiling(publishInput()), "INVALID_PROJECTION");
  }
  await rejectCode(fixture(() => json(catalogRow({ id: otherVeilingId, publication: null }))).service.publishVeiling(publishInput()), "INVALID_PROJECTION");
  const extra = catalogRow({ secret: "private-provider-detail", publication: {
    ...publication(), sourceRevision: 3, draftDescription: "private-provider-detail",
  } });
  assert.deepEqual(await fixture(() => json([extra])).service.listAdminVeilings(), [catalogRow()]);
});

await test("publication failures expose safe conflict and authorization codes", async () => {
  for (const [status, code, expected] of [[409, "PUBLICATION_REQUIRED", "PUBLICATION_REQUIRED"],
    [409, "NUMBER_IN_USE", "NUMBER_IN_USE"], [409, "untrusted-error", "STALE_REVISION"],
    [403, "untrusted-error", "ACCESS_DENIED"], [428, null, "REVISION_REQUIRED"],
    [429, null, "RATE_LIMITED"], [503, null, "BACKEND_UNAVAILABLE"]]) {
    const f = fixture(() => json({ code, message: "private-provider-detail" }, status));
    await rejectCode(f.service.publishVeiling(publishInput({ useSavedDraft: false })), expected);
    assert(f.auth.getSession());
  }
  const expired = fixture(() => json({ message: "private-provider-detail" }, 401));
  await rejectCode(expired.service.getShowcase(), "AUTH_REQUIRED");
  assert.equal(expired.auth.getSession(), null);
});

const methods = [
  { name: "list", call: (service, signal) => service.getShowcase({ signal }), response: () => envelope() },
  { name: "detail", call: (service, signal) => service.getShowcaseVeiling(veilingId, { signal }), response: () => detailEnvelope() },
  { name: "publication", call: (service, signal) => service.publishVeiling(publishInput({ signal })), response: () => catalogRow() },
];
await test("late read/publication responses cannot cross logout, another account, or a replacement session", async () => {
  for (const method of methods) {
    for (const nextSession of [null, { user: { id: otherVeilingId }, flow: "password" },
      { user: { id: userId }, flow: "password" }]) {
      const fetchGate = deferred();
      const f = fixture(() => fetchGate.promise);
      const pending = method.call(f.service);
      const rejected = rejectCode(pending, "AUTH_REQUIRED");
      f.setSession(nextSession);
      fetchGate.resolve(json(method.response()));
      await rejected;
      assert.equal(f.auth.getSession(), nextSession);
      assert.equal(f.calls.length, 1, method.name);
    }
  }
});

await test("identity is checked again after asynchronous body parsing, including late error bodies", async () => {
  for (const method of methods) {
    const bodyGate = deferred(), bodyStarted = deferred();
    const f = fixture(() => ({ ok: true, status: 200, json() { bodyStarted.resolve(); return bodyGate.promise; } }));
    const pending = method.call(f.service);
    const rejected = rejectCode(pending, "AUTH_REQUIRED");
    await bodyStarted.promise;
    const next = { user: { id: userId }, flow: "password" };
    f.setSession(next);
    bodyGate.resolve(method.response());
    await rejected;
    assert.equal(f.auth.getSession(), next);
  }
  const bodyGate = deferred(), bodyStarted = deferred();
  const f = fixture(() => ({ ok: false, status: 409, json() { bodyStarted.resolve(); return bodyGate.promise; } }));
  const pending = f.service.publishVeiling(publishInput());
  const rejected = rejectCode(pending, "AUTH_REQUIRED");
  await bodyStarted.promise;
  f.setSession(null);
  bodyGate.resolve({ code: "PUBLICATION_REQUIRED" });
  await rejected;
});

await test("cancelled showcase and publication results stay cancelled even when transport resolves late", async () => {
  for (const method of methods) {
    const controller = new AbortController(), bodyGate = deferred(), bodyStarted = deferred();
    const f = fixture(() => ({ ok: true, status: 200, json() { bodyStarted.resolve(); return bodyGate.promise; } }));
    const identity = f.auth.getSession();
    const pending = method.call(f.service, controller.signal);
    const rejected = rejectCode(pending, "CANCELLED");
    await bodyStarted.promise;
    controller.abort();
    bodyGate.resolve(method.response());
    await rejected;
    assert.equal(f.calls[0].options.signal, controller.signal);
    assert.equal(f.auth.getSession(), identity);
  }
  const controller = new AbortController(), transport = deferred();
  const f = fixture(() => transport.promise);
  const rejected = rejectCode(f.service.getShowcase({ signal: controller.signal }), "CANCELLED");
  controller.abort();
  transport.resolve(Promise.reject(new Error("private-provider-detail")));
  await rejected;
});

await test("calendar labels validate real dates and never infer publication from a past date", async () => {
  for (const value of ["0001-01-01", "2028-02-29", "2026-12-31"]) assert.equal(validReleaseDate(value), true, value);
  for (const value of [null, "0000-01-01", "2026-02-29", "2026-04-31", "2026-13-01", "2026-01-00",
    "2026-1-01", "2026-01-01T00:00:00Z", " 2026-01-01"]) assert.equal(validReleaseDate(value), false, String(value));
  assert.equal(releaseLabel(null), "Coming soon");
  assert.equal(releaseLabel("2028-02-29"), "February 29, 2028");
  const row = publication({ visibility: "upcoming", releaseDate: "2001-01-01" });
  assert.deepEqual(await fixture(() => json(envelope([row]))).service.getShowcase(), [row]);
});

await test("approved collection content displays without creating ownership, discovery, or achievement records", () => {
  const snapshot = { schemaVersion: "1", mode: "live",
    profile: { id: userId, displayName: "Test member", memberSince: "2026-10-01T00:00:00Z", avatarSrc: null },
    veilings: [{ id: veilingId, number: 7, name: "Approved member name", type: null, origin: null,
      editionIds: [], artwork: [{ id: artworkId, role: "color_art", url: `/api/artwork/${artworkId}` }],
      lore: [{ locale: "en", preview: "Approved member description", body: "Approved member description" }],
      releaseDate: null, contentStatus: "published" }],
    ownerships: [{ id: recordId, userId, veilingId, physicalCardId: null,
      acquisition: "server_grant", acquiredAt: "2026-10-02T12:00:00Z" }],
    discoveries: [], achievements: [], userAchievements: [], collections: [], physicalCards: [],
    editions: [], variants: [], rarities: [], series: [], news: [], events: [],
  };
  const before = structuredClone(snapshot);
  const detail = getVeilingDetail(snapshot, veilingId);
  assert.equal(detail.displayName, "Approved member name");
  assert.equal(detail.colorArt, `/api/artwork/${artworkId}`);
  assert.equal(detail.description, "Approved member description");
  assert.equal(detail.status, "owned");
  assert.equal(detail.discovery, null);
  assert.equal(detail.ownerships.length, 1);
  assert.equal(detail.ownerships[0].id, recordId);
  assert.deepEqual(queryCollection(snapshot, { filter: "owned", search: "approved member" }).map(row => row.id), [veilingId]);
  assert.deepEqual(queryCollection(snapshot, { filter: "discovered" }), []);
  const stats = getDashboardStats(snapshot);
  assert.equal(stats.veilingsOwned, 1);
  assert.equal(stats.physicalCardsOwned, 0);
  assert.equal(stats.discovered, 0);
  assert.equal(stats.firstDiscoveries, 0);
  assert.equal(stats.achievements, 0);
  assert.deepEqual(snapshot, before);
});

console.log(`PASS ${passed} member showcase adapter/domain checks`);
