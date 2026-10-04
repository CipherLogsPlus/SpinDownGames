import assert from "node:assert/strict";
import { demoSpinariumService } from "../spinarium/data/demo-service.js";
import { parseRoute } from "../spinarium/domain/routing.js";
import {
  getDashboardStats,
  getVeilingDetail,
  queryCollection,
  withUnavailableVeiling,
} from "../spinarium/domain/collection.js";

const snapshot = await demoSpinariumService.getDashboard();
assert.equal(snapshot.mode, "demo");
assert.deepEqual(demoSpinariumService.getCapabilities(), {
  authentication: false,
  claims: false,
  transfers: false,
  notifications: false,
  threeDimensionalView: false,
});
assert.equal("claim" in demoSpinariumService, false);
assert.deepEqual(getDashboardStats(snapshot), {
  veilingsOwned: 5,
  physicalCardsOwned: 5,
  collectionsCompleted: 1,
  achievements: 3,
  firstDiscoveries: 1,
  memberSince: "2026",
  totalVeilings: 10,
  discovered: 6,
  undiscovered: 4,
});

assert.equal(queryCollection(snapshot, { filter: "owned" }).length, 5);
assert.equal(queryCollection(snapshot, { filter: "discovered" }).length, 6);
assert.equal(queryCollection(snapshot, { filter: "unowned" }).length, 5);
assert.equal(queryCollection(snapshot, { filter: "undiscovered" }).length, 4);
assert.deepEqual(
  queryCollection(snapshot, { search: " ASHEN " }).map((item) => item.id),
  ["ashenling"],
);
assert.deepEqual(
  queryCollection(snapshot, { search: "002" }).map((item) => item.id),
  ["unknown-2"],
);
assert.equal(
  queryCollection(snapshot, { filter: "unowned", search: "Ashenling" }).length,
  0,
);
assert.equal(queryCollection(snapshot, { sort: "rarity" })[0].id, "embercoil");
assert.equal(queryCollection(snapshot, { sort: "release" })[0].id, "zephyryn");
assert.deepEqual(
  queryCollection(snapshot).map((item) => item.number),
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
);

const ashenling = getVeilingDetail(snapshot, "ashenling");
assert.equal(ashenling.status, "owned");
assert.equal(ashenling.physicalCard.serial, "A001-000184");
assert.equal(ashenling.lore.status, "draft");
assert.equal(getVeilingDetail(snapshot, "crysthale").status, "discovered");
assert.equal(getVeilingDetail(snapshot, "crysthale").ownership, null);
assert.equal(getVeilingDetail(snapshot, "does-not-exist"), null);

for (const unknown of snapshot.veilings.filter(
  (item) => item.contentStatus === "redacted",
)) {
  assert.equal(unknown.name, null);
  assert.equal(unknown.origin, null);
  assert.equal(unknown.type, null);
  assert.equal(unknown.releaseDate, null);
  assert.deepEqual(unknown.artwork, []);
  assert.deepEqual(unknown.lore, []);
  assert.deepEqual(unknown.editionIds, []);
  const detail = getVeilingDetail(snapshot, unknown.id);
  assert.equal(detail.displayName, "???");
  assert.equal(detail.rarity, null);
  assert.equal(detail.colorArt, null);
  assert.equal(detail.lore, null);
}

// Consumer mutation must never persist simulated claims or alter later reads.
snapshot.ownerships.length = 0;
const fresh = await demoSpinariumService.getDashboard();
assert.equal(getDashboardStats(fresh).veilingsOwned, 5);
const cancellation = new AbortController();
cancellation.abort();
await assert.rejects(
  demoSpinariumService.getDashboard({ signal: cancellation.signal }),
  { name: "AbortError" },
);

// A distinct Veiling count differs from physical instance count. Optional
// authorized digital grants need no fabricated physical card or claim secret.
fresh.ownerships.push({
  ...fresh.ownerships[0],
  id: "second-instance",
  physicalCardId: "second-card",
});
assert.equal(getDashboardStats(fresh).veilingsOwned, 5);
assert.equal(getDashboardStats(fresh).physicalCardsOwned, 6);
fresh.ownerships.push({
  id: "authorized-grant",
  userId: fresh.profile.id,
  veilingId: "crysthale",
  acquisition: "server_grant",
  physicalCardId: null,
  editionId: "crysthale-series-one",
  variantId: "crysthale-standard",
  acquiredAt: "2026-10-01T12:00:00Z",
});
assert.equal(getVeilingDetail(fresh, "crysthale").status, "owned");
assert.equal(getVeilingDetail(fresh, "crysthale").physicalCard, null);
assert.equal(getDashboardStats(fresh).physicalCardsOwned, 6);
assert.equal(getDashboardStats(fresh).veilingsOwned, 6);
assert.equal(
  fresh.editions.find((edition) => edition.kind === "legacy")
    .registrationSupported,
  false,
);
assert.equal(
  fresh.ownerships.some(
    (ownership) => ownership.editionId === "ashenling-legacy",
  ),
  false,
);

// Groups remain Veilings, while each ownership record retains its own identity.
const records = await demoSpinariumService.getDashboard();
records.veilings = records.veilings.slice(0, 4);
records.veilings[0].number = null;
records.ownerships = [
  { id: "record-a-early", veilingId: records.veilings[0].id, acquiredAt: "2026-01-01T00:00:00Z" },
  { id: "record-a-late", veilingId: records.veilings[0].id, acquiredAt: "2026-09-30T00:00:00Z" },
  { id: "record-b", veilingId: records.veilings[1].id, acquiredAt: "2026-06-15T00:00:00Z" },
  { id: "record-c", veilingId: records.veilings[2].id, acquiredAt: "2026-03-15T00:00:00Z" },
  { id: "record-missing-date", veilingId: records.veilings[3].id, acquiredAt: "" },
].map(record => ({ ...record, userId: records.profile.id, physicalCardId: null }));
records.ownerships.push({ id: "foreign-record", userId: "another-account", veilingId: records.veilings[1].id, acquiredAt: "2020-01-01T00:00:00Z" });
assert.deepEqual(queryCollection(records, { sort: "acquired-newest" }).map(entry => entry.id), records.veilings.map(entry => entry.id));
assert.deepEqual(queryCollection(records, { sort: "acquired-oldest" }).map(entry => entry.id), [0, 2, 1, 3].map(index => records.veilings[index].id));
assert.deepEqual(getVeilingDetail(records, records.veilings[0].id).ownerships.map(record => record.id), ["record-a-late", "record-a-early"]);
assert.deepEqual(queryCollection(records, { search: " RECORD-A-EARLY " }).map(entry => entry.id), [records.veilings[0].id]);
assert.equal(queryCollection(records, { search: "foreign-record" }).length, 0);
assert.equal(queryCollection(records, { search: "null" }).length, 0);
assert.equal(queryCollection(records, { search: "000" }).length, 0);
assert.equal(queryCollection(records, { sort: "number" }).at(-1).id, records.veilings[0].id);
assert.deepEqual(parseRoute("#ownership/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", true), {
  name: "ownership", ownershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", filter: "owned",
});
assert.deepEqual(parseRoute("#collection?filter=owned", true), { name: "collection", filter: "owned" });
assert.equal(parseRoute("#ownership/../../settings", true).name, "ownership");
assert.equal(parseRoute("#ownership", true).ownershipId, "");

// Content availability does not revoke ownership or rewrite discovery history.
const unavailableSnapshot = await demoSpinariumService.getDashboard();
unavailableSnapshot.ownerships[0].id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const unavailableId = unavailableSnapshot.ownerships[0].veilingId;
const unavailableVeiling = unavailableSnapshot.veilings.find(veiling => veiling.id === unavailableId);
Object.assign(unavailableVeiling, { contentStatus: "unavailable", number: null, name: null,
  type: null, origin: null, releaseDate: null, editionIds: [], artwork: [], lore: [] });
unavailableSnapshot.discoveries = unavailableSnapshot.discoveries.filter(discovery => discovery.veilingId !== unavailableId);
const unavailableDetail = getVeilingDetail(unavailableSnapshot, unavailableId);
assert.equal(unavailableDetail.status, "owned");
assert.equal(unavailableDetail.unavailable, true);
assert.equal(unavailableDetail.displayName, "Unavailable Veiling");
assert.equal(unavailableDetail.description, "Veiling details are currently unavailable.");
assert.equal(unavailableDetail.number, null);
assert.equal(unavailableDetail.colorArt, null);
assert.equal(unavailableDetail.thumbnail, null);
assert.equal(unavailableDetail.lore, null);
assert.equal(unavailableDetail.discovery, null);
assert.equal(unavailableDetail.edition, null);
assert.equal(getDashboardStats(unavailableSnapshot).veilingsOwned, 5);
assert.equal(queryCollection(unavailableSnapshot, { filter: "owned", search: unavailableDetail.ownership.id })[0].id, unavailableId);
assert.equal(queryCollection(unavailableSnapshot, { filter: "owned", search: "Ashenling" }).length, 0);
for (const filter of ["discovered", "undiscovered"])
  assert.equal(queryCollection(unavailableSnapshot, { filter }).some(entry => entry.id === unavailableId), false);
for (const sort of ["name", "number"])
  assert.equal(queryCollection(unavailableSnapshot, { sort }).at(-1).id, unavailableId);

const cached = await demoSpinariumService.getDashboard();
cached.ownerships[0].id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const before = getVeilingDetail(cached, unavailableId);
const refreshed = withUnavailableVeiling(cached, unavailableId);
assert.notEqual(refreshed, cached);
assert.equal(getVeilingDetail(cached, unavailableId).displayName, before.displayName);
assert.equal(refreshed.ownerships, cached.ownerships);
assert.equal(getVeilingDetail(refreshed, unavailableId).displayName, "Unavailable Veiling");
assert.equal(queryCollection(refreshed, { search: before.displayName }).length, 0);
assert.equal(queryCollection(refreshed, { search: String(before.number).padStart(3, "0") }).length, 0);
assert.deepEqual(refreshed.veilings.find(veiling => veiling.id === unavailableId), unavailableVeiling);
assert.equal(refreshed.discoveries.some(discovery => discovery.veilingId === unavailableId), false);

console.log(
  "PASS Spinarium domain, public projection, derived statistics, queries, cancellation, isolated demo reads, and grant/Legacy boundaries",
);
