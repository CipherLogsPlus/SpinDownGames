import assert from "node:assert/strict";
import { demoSpinariumService } from "../spinarium/data/demo-service.js";
import {
  getDashboardStats,
  getVeilingDetail,
  queryCollection,
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

console.log(
  "PASS Spinarium domain, public projection, derived statistics, queries, cancellation, isolated demo reads, and grant/Legacy boundaries",
);
