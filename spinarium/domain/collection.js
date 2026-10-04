/** @import {DashboardSnapshot, CollectionFilter, CollectionSort} from './types.js' */

const byNumber = (a, b) =>
  Number(a.unavailable) - Number(b.unavailable) ||
  (a.number ?? Infinity) - (b.number ?? Infinity) || a.id.localeCompare(b.id);
const byName = (a, b) =>
  Number(a.unavailable) - Number(b.unavailable) || a.displayName.localeCompare(b.displayName) || byNumber(a, b);
const acquiredTime = (record) => {
  const value = Date.parse(record.acquiredAt);
  return Number.isFinite(value) ? value : null;
};
const recordDates = (entry) => entry.ownerships.map(acquiredTime).filter(value => value !== null);
function byAcquired(newest) {
  return (a, b) => {
    const aDates = recordDates(a), bDates = recordDates(b);
    if (!aDates.length || !bDates.length)
      return Number(!aDates.length) - Number(!bDates.length) || byNumber(a, b);
    return (newest ? Math.max(...bDates) - Math.max(...aDates) : Math.min(...aDates) - Math.min(...bDates)) || byNumber(a, b);
  };
}

/** Apply a newer protected record response without retaining unavailable content. */
export function withUnavailableVeiling(snapshot, id) {
  return {
    ...snapshot,
    veilings: snapshot.veilings.map(veiling => veiling.id !== id ? veiling : {
      ...veiling, number: null, name: null, type: null, origin: null, editionIds: [],
      artwork: [], lore: [], releaseDate: null, contentStatus: "unavailable",
    }),
    discoveries: snapshot.discoveries.filter(discovery => discovery.veilingId !== id),
  };
}

/**
 * Build one presentation object from the public service projection.
 * Content visibility and discovery are separate from this collector's ownership.
 * An approved member showcase snapshot does not award a discovery.
 * @param {DashboardSnapshot} snapshot
 * @param {string} id
 */
export function getVeilingDetail(snapshot, id) {
  const veiling = snapshot.veilings.find((item) => item.id === id);
  if (!veiling) return null;

  const unavailable = veiling.contentStatus === "unavailable";
  const discovery =
    unavailable ? null : snapshot.discoveries.find((item) => item.veilingId === id) ?? null;
  const ownerships = snapshot.ownerships.filter(
    (item) => item.veilingId === id && item.userId === snapshot.profile.id,
  ).sort((a, b) => (acquiredTime(b) ?? -Infinity) - (acquiredTime(a) ?? -Infinity) || a.id.localeCompare(b.id));
  const ownership = ownerships[0] ?? null;
  const isRevealed = !unavailable && (veiling.contentStatus === "published" || discovery?.status === "revealed");
  const status = ownership
    ? "owned"
    : isRevealed
      ? "discovered"
      : "undiscovered";
  const edition = unavailable ? null :
    snapshot.editions.find(
      (item) => item.id === (ownership?.editionId ?? veiling.editionIds[0]),
    ) ?? null;
  const variant =
    snapshot.variants.find((item) =>
      ownership
        ? item.id === ownership.variantId
        : item.editionId === edition?.id,
    ) ?? null;
  const rarity =
    snapshot.rarities.find((item) => item.id === variant?.rarityId) ?? null;
  const physicalCard =
    snapshot.physicalCards.find(
      (item) => item.id === ownership?.physicalCardId,
    ) ?? null;
  // A display guard aids consumers. It does not replace server-side redaction.
  const artwork = unavailable ? [] : veiling.artwork.filter(
    (item) => isRevealed || item.role === "silhouette_art",
  );
  const asset = (role) => artwork.find((item) => item.role === role) ?? null;
  const lore = isRevealed
    ? (veiling.lore.find((item) => item.locale === "en") ?? null)
    : null;

  return {
    id,
    number: unavailable ? null : veiling.number,
    name: isRevealed ? veiling.name : null,
    displayName: unavailable ? "Unavailable Veiling" : isRevealed ? (veiling.name ?? "Unknown Veiling") : "???",
    unavailable,
    status,
    rarity: isRevealed ? rarity : null,
    edition,
    variant: isRevealed ? variant : null,
    thumbnail:
      asset("thumbnail")?.url ??
      asset("color_art")?.url ??
      asset("silhouette_art")?.url ??
      null,
    colorArt: asset("color_art")?.url ?? null,
    silhouetteArt: asset("silhouette_art")?.url ?? null,
    description: unavailable ? "Veiling details are currently unavailable." : lore?.preview ?? "This Veiling has yet to be discovered.",
    veiling,
    ownership,
    ownerships,
    physicalCard,
    discovery,
    artwork,
    lore,
  };
}

/**
 * Pure filtering/sorting for this milestone. A production adapter may apply the
 * same query server-side for pagination without changing component intent.
 * Search includes revealed names, visible numbers and this account's record IDs.
 * Acquired sorts use each Veiling's latest or earliest recorded acquisition.
 * @param {DashboardSnapshot} snapshot
 * @param {{search?:string,filter?:CollectionFilter,sort?:CollectionSort}} [query]
 */
export function queryCollection(
  snapshot,
  { search = "", filter = "all", sort = "number" } = {},
) {
  const term = search.trim().toLocaleLowerCase();
  const entries = snapshot.veilings.map((veiling) =>
    getVeilingDetail(snapshot, veiling.id),
  );
  const visible = entries.filter((entry) => {
    if (entry.unavailable && (filter === "discovered" || filter === "undiscovered")) return false;
    if (filter === "owned" && entry.status !== "owned") return false;
    if (filter === "discovered" && entry.discovery?.status !== "revealed")
      return false;
    if (filter === "unowned" && entry.status === "owned") return false;
    if (filter === "undiscovered" && entry.discovery?.status === "revealed")
      return false;
    return (
      !term ||
      `${entry.number == null ? "" : String(entry.number).padStart(3, "0")} ${entry.displayName} ${entry.ownerships.map(record => record.id).join(" ")}`
        .toLocaleLowerCase()
        .includes(term)
    );
  });
  const compare =
    {
      number: byNumber,
      name: byName,
      rarity: (a, b) =>
        (b.rarity?.sortOrder ?? -1) - (a.rarity?.sortOrder ?? -1) ||
        byNumber(a, b),
      release: (a, b) =>
        (b.veiling.releaseDate ?? "").localeCompare(
          a.veiling.releaseDate ?? "",
        ) || byNumber(a, b),
      "acquired-newest": byAcquired(true),
      "acquired-oldest": byAcquired(false),
    }[sort] ?? byNumber;
  return visible.sort(compare);
}

/** Collection statistics are derived from the service snapshot, never artwork. */
export function getDashboardStats(snapshot) {
  const currentOwnerships = snapshot.ownerships.filter(
    (item) => item.userId === snapshot.profile.id,
  );
  const ownedIds = new Set(currentOwnerships.map((item) => item.veilingId));
  const achievements = snapshot.userAchievements.filter(
    (item) => item.userId === snapshot.profile.id,
  );
  return {
    veilingsOwned: ownedIds.size,
    physicalCardsOwned: currentOwnerships.filter(
      (item) => item.physicalCardId !== null,
    ).length,
    collectionsCompleted: snapshot.collections.filter(
      (collection) =>
        collection.veilingIds.length > 0 &&
        collection.veilingIds.every((id) => ownedIds.has(id)),
    ).length,
    achievements: achievements.length,
    firstDiscoveries: snapshot.discoveries.filter(
      (item) => item.firstDiscovererId === snapshot.profile.id,
    ).length,
    memberSince: snapshot.profile.memberSince.slice(0, 4),
    totalVeilings: snapshot.veilings.length,
    discovered: snapshot.discoveries.filter(
      (item) => item.status === "revealed",
    ).length,
    undiscovered: snapshot.discoveries.filter(
      (item) => item.status === "undiscovered",
    ).length,
  };
}
