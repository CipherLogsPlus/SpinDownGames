/** @import {DashboardSnapshot, CollectionFilter, CollectionSort} from './types.js' */

const byNumber = (a, b) => a.number - b.number;
const byName = (a, b) =>
  a.displayName.localeCompare(b.displayName) || byNumber(a, b);

/**
 * Build one presentation object from the public service projection.
 * Discovery is global; ownership belongs to this collector. Owning a card does
 * not define whether everyone else has discovered its character.
 * @param {DashboardSnapshot} snapshot
 * @param {string} id
 */
export function getVeilingDetail(snapshot, id) {
  const veiling = snapshot.veilings.find((item) => item.id === id);
  if (!veiling) return null;

  const discovery =
    snapshot.discoveries.find((item) => item.veilingId === id) ?? null;
  const ownerships = snapshot.ownerships.filter(
    (item) => item.veilingId === id && item.userId === snapshot.profile.id,
  );
  const ownership = ownerships[0] ?? null;
  const isRevealed = discovery?.status === "revealed";
  const status = ownership
    ? "owned"
    : isRevealed
      ? "discovered"
      : "undiscovered";
  const edition =
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
  const artwork = veiling.artwork.filter(
    (item) => isRevealed || item.role === "silhouette_art",
  );
  const asset = (role) => artwork.find((item) => item.role === role) ?? null;
  const lore = isRevealed
    ? (veiling.lore.find((item) => item.locale === "en") ?? null)
    : null;

  return {
    id,
    number: veiling.number,
    name: isRevealed ? veiling.name : null,
    displayName: isRevealed ? (veiling.name ?? "Unknown Veiling") : "???",
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
    description: lore?.preview ?? "This Veiling has yet to be discovered.",
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
 * Search includes revealed names and visible numbers only.
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
    if (filter === "owned" && entry.status !== "owned") return false;
    if (filter === "discovered" && entry.discovery?.status !== "revealed")
      return false;
    if (filter === "unowned" && entry.status === "owned") return false;
    if (filter === "undiscovered" && entry.discovery?.status === "revealed")
      return false;
    return (
      !term ||
      `${String(entry.number).padStart(3, "0")} ${entry.displayName}`
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
