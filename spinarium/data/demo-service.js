/** @import {DashboardSnapshot, SpinariumReadService} from '../domain/types.js' */

const assetPath = "../assets/spinarium/";
const demoUser = "demo-collector";

/** Art and lore here are replaceable preview content, not approved canon. */
const revealedVeiling = (
  number,
  name,
  type,
  origin,
  preview,
  text,
  releaseDate,
) => {
  const id = name.toLowerCase();
  return {
    id,
    number,
    name,
    type,
    origin,
    editionIds: [`${id}-series-one`],
    releaseDate,
    contentStatus: "draft",
    artwork: [
      {
        id: `${id}-color`,
        role: "color_art",
        url: `${assetPath}${id}.webp`,
        alt: `Concept artwork for ${name}`,
        variantId: null,
        status: "placeholder",
        mimeType: "image/webp",
      },
      {
        id: `${id}-thumbnail`,
        role: "thumbnail",
        url: `${assetPath}${id}.webp`,
        alt: `Concept artwork for ${name}`,
        variantId: null,
        status: "placeholder",
        mimeType: "image/webp",
      },
    ],
    lore: [
      {
        id: `${id}-lore-en`,
        locale: "en",
        title: "Lore preview",
        preview,
        text,
        status: "draft",
        version: 1,
      },
    ],
  };
};

// An undiscovered production response must look like this: no secret name,
// release date, type, lore, or color-art URL shipped to the browser.
const undiscoveredVeiling = (number) => ({
  id: `unknown-${number}`,
  number,
  name: null,
  type: null,
  origin: null,
  editionIds: [],
  artwork: [],
  lore: [],
  releaseDate: null,
  contentStatus: "redacted",
});

const veilings = [
  revealedVeiling(
    1,
    "Ashenling",
    "Ember Veiling",
    "The Veil",
    "From ash, a spark.\nFrom stillness, a beginning.",
    "Ashenling are drawn to places where endings and beginnings overlap. They are calm, curious, and fiercely loyal to those who give them purpose.",
    "2026-01-14",
  ),
  undiscoveredVeiling(2),
  revealedVeiling(
    3,
    "Duskspore",
    "Woodland Veiling",
    "The Duskwood",
    "A quiet light beneath the canopy.",
    "A draft woodland concept. Its story and character identity are awaiting approval.",
    "2026-02-03",
  ),
  revealedVeiling(
    4,
    "Lumenkit",
    "Radiant Veiling",
    "The Glade",
    "Small footsteps. A lingering light.",
    "A draft luminous woodland concept. Its story and character identity are awaiting approval.",
    "2026-02-10",
  ),
  revealedVeiling(
    5,
    "Crysthale",
    "Frost Veiling",
    "The High Peaks",
    "Where silence gathers, crystal wakes.",
    "A draft crystalline concept. Its story and character identity are awaiting approval.",
    "2026-03-04",
  ),
  undiscoveredVeiling(6),
  revealedVeiling(
    7,
    "Embercoil",
    "Ember Veiling",
    "The Cinder Hollow",
    "A circle of embers, never quite extinguished.",
    "A draft ember-serpent concept. Its story and character identity are awaiting approval.",
    "2026-03-21",
  ),
  undiscoveredVeiling(8),
  revealedVeiling(
    9,
    "Zephyryn",
    "Wind Veiling",
    "The Silver Reach",
    "The wind remembers every wing.",
    "A draft winged concept. Its story and character identity are awaiting approval.",
    "2026-04-08",
  ),
  undiscoveredVeiling(10),
];

const rarityByVeiling = {
  ashenling: "common",
  duskspore: "rare",
  lumenkit: "uncommon",
  crysthale: "rare",
  embercoil: "legendary",
  zephyryn: "rare",
};
const ownedIds = [
  "ashenling",
  "duskspore",
  "lumenkit",
  "embercoil",
  "zephyryn",
];
const acquiredDates = [
  "2026-01-14",
  "2026-02-03",
  "2026-02-10",
  "2026-03-21",
  "2026-04-08",
];

/** @type {DashboardSnapshot} */
const demoSnapshot = {
  schemaVersion: "1",
  mode: "demo",
  profile: {
    id: demoUser,
    displayName: "Collector",
    memberSince: "2026-01-14T12:00:00Z",
    avatarSrc: null,
  },
  veilings,
  series: [{ id: "series-one", name: "Series One" }],
  editions: [
    ...veilings
      .filter((item) => item.name)
      .map((item) => ({
        id: `${item.id}-series-one`,
        veilingId: item.id,
        seriesId: "series-one",
        name: "Series One",
        kind: "registered",
        status: "planned",
        registrationSupported: true,
        productionLimit: null,
        finalProduced: null,
        retiredAt: null,
      })),
    {
      id: "ashenling-legacy",
      veilingId: "ashenling",
      seriesId: null,
      name: "Legacy",
      kind: "legacy",
      status: "planned",
      registrationSupported: false,
      productionLimit: null,
      finalProduced: null,
      retiredAt: null,
    },
  ],
  variants: veilings
    .filter((item) => item.name)
    .map((item) => ({
      id: `${item.id}-standard`,
      editionId: `${item.id}-series-one`,
      name: "Standard",
      rarityId: rarityByVeiling[item.id],
    })),
  rarities: [
    { id: "common", label: "Common", sortOrder: 1, accent: "silver" },
    { id: "uncommon", label: "Uncommon", sortOrder: 2, accent: "cyan" },
    { id: "rare", label: "Rare", sortOrder: 3, accent: "violet" },
    { id: "legendary", label: "Legendary", sortOrder: 4, accent: "gold" },
  ],
  physicalCards: ownedIds.map((id, index) => ({
    id: `demo-card-${id}`,
    veilingId: id,
    editionId: `${id}-series-one`,
    variantId: `${id}-standard`,
    serial: `A${String(veilings.find((item) => item.id === id).number).padStart(3, "0")}-${String(184 + index).padStart(6, "0")}`,
  })),
  ownerships: ownedIds.map((id, index) => ({
    id: `demo-ownership-${id}`,
    userId: demoUser,
    veilingId: id,
    acquisition: "physical_claim",
    physicalCardId: `demo-card-${id}`,
    editionId: `${id}-series-one`,
    variantId: `${id}-standard`,
    acquiredAt: `${acquiredDates[index]}T12:00:00Z`,
  })),
  discoveries: veilings.map((item) => ({
    veilingId: item.id,
    status: item.name ? "revealed" : "undiscovered",
    firstDiscoveredAt: item.name ? `${item.releaseDate}T12:00:00Z` : null,
    firstDiscovererId: item.id === "duskspore" ? demoUser : null,
    publicDiscovererName: item.id === "duskspore" ? "Collector" : null,
    revealKind: item.name
      ? item.id === "duskspore"
        ? "collector"
        : "launch"
      : null,
  })),
  achievements: [
    {
      id: "first-steps",
      name: "First Steps",
      description: "Claim your first Veiling.",
      icon: "spark",
      rule: { type: "claim_count", minimum: 1 },
    },
    {
      id: "series-complete",
      name: "The Ember Within",
      description: "Complete the Ember collection.",
      icon: "collection",
      rule: { type: "collection_complete", collectionId: "ember-collection" },
    },
    {
      id: "first-discovery",
      name: "First Discovery",
      description: "Be the first collector to discover a Veiling.",
      icon: "discovery",
      rule: { type: "first_discovery_count", minimum: 1 },
    },
    {
      id: "collector",
      name: "Collector",
      description: "Own 10 distinct Veilings.",
      icon: "collection",
      rule: { type: "distinct_owned_count", minimum: 10 },
    },
  ],
  userAchievements: [
    {
      userId: demoUser,
      achievementId: "first-steps",
      earnedAt: "2026-01-14T12:00:00Z",
    },
    {
      userId: demoUser,
      achievementId: "first-discovery",
      earnedAt: "2026-02-03T12:00:00Z",
    },
    {
      userId: demoUser,
      achievementId: "series-complete",
      earnedAt: "2026-03-21T12:00:00Z",
    },
  ],
  collections: [
    {
      id: "ember-collection",
      name: "The Ember Collection",
      veilingIds: ["ashenling", "embercoil"],
    },
  ],
  news: [
    {
      id: "preview-world",
      title: "A larger world is taking shape",
      date: "2026-10-01",
      status: "draft",
      body: "Spinarium brings physical artifacts, digital artwork, and stories together. This is an editorial preview awaiting publication.",
    },
    {
      id: "preview-discovery",
      title: "Some things are meant to be found",
      date: "2026-10-01",
      status: "draft",
      body: "Discovery stories will appear here when a verified collector reveals a new Veiling. This is sample content, not a release announcement.",
    },
    {
      id: "preview-legacy",
      title: "Before the Spinarium: Legacy",
      date: "2026-10-01",
      status: "draft",
      body: "A home for early Veiling editions, without inventing verified digital ownership. Final edition details have not been announced.",
    },
  ],
  events: [
    {
      id: "trainers-bazaar-october-2026",
      title: "Trainer’s Bazaar",
      subtitle: "Pokémon & TCG Trade Show",
      startDate: "2026-10-17",
      endDate: "2026-10-18",
      location: "Scene75 · Brunswick, Ohio",
      href: "../index.html#events",
      image: "../assets/events/trainers-bazaar-october-2026.jpg",
      status: "announced",
    },
  ],
};

const capabilities = Object.freeze({
  authentication: false,
  claims: false,
  transfers: false,
  notifications: false,
  threeDimensionalView: false,
});

/**
 * Read-only preview adapter. Replace at the composition root with an HTTP
 * adapter when a secure backend exists; components must not import this data.
 * Each read is isolated so consumer mutations cannot persist demo "ownership".
 * @type {SpinariumReadService}
 */
export const demoSpinariumService = Object.freeze({
  async getDashboard({ signal } = {}) {
    signal?.throwIfAborted();
    return structuredClone(demoSnapshot);
  },
  getCapabilities() {
    return { ...capabilities };
  },
});
