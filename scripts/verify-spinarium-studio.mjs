import assert from "node:assert/strict";
import { hasSavedDraftChanges, publicationPlan, validateStudioArtwork } from "../spinarium/components/veiling-studio.js";

// Isolated policy/validation checks. No account or publication is created.
const draft = () => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", revision: 4, name: "Saved draft name", character_number: 7,
  description: "Saved draft text", rarity: null, edition: null, artworkUrl: "/api/artwork/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  publication: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Member version name", number: 7,
    description: "Member version text", rarity: null, edition: null, artworkUrl: null,
    visibility: "public", releaseDate: null, updatedAt: "2026-10-03T00:00:00Z", sourceRevision: 2,
  },
});
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("PASS " + name); }

await test("visibility changes preview approved content and never adopt pending draft edits", () => {
  const row = draft();
  const plan = publicationPlan(row, { visibility: "upcoming", releaseDate: "2026-11-20", useSavedDraft: false });
  assert.equal(plan.content.name, row.publication.name);
  assert.equal(plan.content.description, row.publication.description);
  assert.equal(plan.content.artworkUrl, null);
  assert.deepEqual(plan.input, { id: row.id, revision: 4, visibility: "upcoming", releaseDate: "2026-11-20", useSavedDraft: false });
});
await test("Publish changes captures exactly the saved draft and revision for its preview", () => {
  const row = draft();
  const plan = publicationPlan(row, { visibility: "public", releaseDate: null, useSavedDraft: true });
  row.name = "A later edit"; row.description = "A later change"; row.revision++;
  assert.equal(plan.content.name, "Saved draft name");
  assert.equal(plan.content.description, "Saved draft text");
  assert.equal(plan.input.revision, 4);
  assert(Object.isFrozen(plan.input)); assert(Object.isFrozen(plan.content));
});
await test("unsaved changes and missing saved/member versions cannot be silently published", () => {
  assert.throws(() => publicationPlan(draft(), { visibility: "public", useSavedDraft: true }, true), /Save or discard/);
  assert.throws(() => publicationPlan(null, { visibility: "public", useSavedDraft: true }), /Save a draft/);
  assert.throws(() => publicationPlan({ ...draft(), publication: null }, { visibility: "upcoming", useSavedDraft: false }), /no member version/);
  const row = { ...draft(), publication: null, description: "", artworkUrl: null, character_number: null };
  const plan = publicationPlan(row, { visibility: "public", useSavedDraft: true });
  assert.equal(plan.content.name, row.name);
  assert.equal(plan.content.description, "");
  assert.equal(plan.content.artworkUrl, null);
});
await test("Public and private transitions clear dates; Upcoming supports exact date or Coming soon", () => {
  const row = draft();
  for (const visibility of ["public", "private"])
    assert.equal(publicationPlan(row, { visibility, releaseDate: "2026-11-20", useSavedDraft: false }).input.releaseDate, null);
  assert.equal(publicationPlan(row, { visibility: "upcoming", releaseDate: null, useSavedDraft: false }).input.releaseDate, null);
  assert.equal(publicationPlan(row, { visibility: "upcoming", releaseDate: "2028-02-29", useSavedDraft: false }).input.releaseDate, "2028-02-29");
  for (const releaseDate of ["", "2026-02-29", "2026-13-01", "tomorrow", "2026-01-01T00:00:00Z"])
    assert.throws(() => publicationPlan(row, { visibility: "upcoming", releaseDate, useSavedDraft: false }), /valid calendar date/);
});
await test("draft-change labels compare saved content rather than publication revisions", () => {
  const row = draft();
  assert.equal(hasSavedDraftChanges(row), true);
  Object.assign(row.publication, { name: row.name, description: row.description, artworkUrl: row.artworkUrl });
  row.revision = 20;
  row.publication.sourceRevision = 2;
  row.publication.visibility = "upcoming";
  row.publication.releaseDate = "2026-11-20";
  assert.equal(hasSavedDraftChanges(row), false);
  row.publication.edition = "Previously approved edition";
  assert.equal(hasSavedDraftChanges(row), true);
  assert.equal(hasSavedDraftChanges({ ...row, publication: null }), false);
});
await test("artwork validation accepts matching image signatures before any draft write", async () => {
  await validateStudioArtwork(null);
  await validateStudioArtwork(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" }));
  await validateStudioArtwork(new Blob([new Uint8Array([255, 216, 255, 0])], { type: "image/jpeg" }));
  await validateStudioArtwork(new Blob(["RIFF0000WEBP"], { type: "image/webp" }));
});
await test("bad types, empty or oversized files and mismatched image contents are rejected", async () => {
  for (const file of [new Blob(["<svg/>"], { type: "image/svg+xml" }), new Blob([], { type: "image/png" }),
    { type: "image/png", size: 8388609 }, new Blob(["not an image"], { type: "image/png" }), new Blob(["RIFF0000FAIL"], { type: "image/webp" })])
    await assert.rejects(validateStudioArtwork(file));
});
console.log(`PASS ${passed} Veiling Studio draft/publication policy checks`);
