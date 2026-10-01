/**
 * Spinarium public read model, version 1.
 *
 * These contracts are a projection returned by the public Spinarium service,
 * never a direct view of InvoHub's database. Unrevealed names, lore and color
 * asset URLs must be removed by the production server before this projection
 * reaches the browser. Claim credentials never belong in this model.
 *
 * @typedef {'demo'|'live'} DataMode
 * @typedef {'owned'|'discovered'|'undiscovered'} CollectionState
 * @typedef {'all'|'owned'|'discovered'|'unowned'|'undiscovered'} CollectionFilter
 * @typedef {'number'|'name'|'rarity'|'release'} CollectionSort
 * @typedef {'engraving_art'|'color_art'|'silhouette_art'|'thumbnail'|'potential_3d_asset'|'variant_art'} ArtworkRole
 *
 * @typedef {Object} Artwork
 * @property {string} id
 * @property {ArtworkRole} role
 * @property {string} url
 * @property {string} alt
 * @property {string|null} variantId
 * @property {'reference'|'placeholder'|'approved'} status
 * @property {string} [mimeType]
 *
 * @typedef {Object} Lore
 * @property {string} id
 * @property {string} locale
 * @property {string} title
 * @property {string} preview
 * @property {string} text
 * @property {'draft'|'published'} status
 * @property {number} version
 *
 * @typedef {Object} Veiling
 * @property {string} id
 * @property {number} number
 * @property {string|null} name Null for an undiscovered public projection.
 * @property {string|null} type
 * @property {string|null} origin
 * @property {string[]} editionIds
 * @property {Artwork[]} artwork
 * @property {Lore[]} lore
 * @property {string|null} releaseDate
 * @property {'draft'|'published'|'redacted'} contentStatus
 *
 * @typedef {Object} Rarity
 * @property {string} id
 * @property {string} label
 * @property {number} sortOrder Data-driven rank; never an ownership authority.
 * @property {string} accent
 *
 * @typedef {Object} Edition
 * @property {string} id
 * @property {string} veilingId
 * @property {string|null} seriesId
 * @property {string} name
 * @property {'registered'|'legacy'} kind
 * @property {'planned'|'active'|'retired'} status
 * @property {boolean} registrationSupported
 * @property {number|null} productionLimit
 * @property {number|null} finalProduced
 * @property {string|null} retiredAt
 *
 * @typedef {Object} Variant
 * @property {string} id
 * @property {string} editionId
 * @property {string} name
 * @property {string|null} rarityId
 *
 * @typedef {Object} PhysicalCard
 * @property {string} id
 * @property {string} veilingId
 * @property {string} editionId
 * @property {string} variantId
 * @property {string} serial
 *
 * @typedef {Object} Ownership
 * @property {string} id
 * @property {string} userId
 * @property {string} veilingId
 * @property {'physical_claim'|'transfer'|'server_grant'} acquisition
 * @property {string|null} physicalCardId Nullable for authorized digital grants.
 * @property {string} editionId
 * @property {string} variantId
 * @property {string} acquiredAt
 *
 * @typedef {Object} Discovery
 * @property {string} veilingId
 * @property {'undiscovered'|'revealed'} status
 * @property {string|null} firstDiscoveredAt
 * @property {string|null} firstDiscovererId Internal identity only in own-account projection.
 * @property {string|null} publicDiscovererName Subject to discoverer privacy settings.
 * @property {'launch'|'collector'|null} revealKind
 *
 * @typedef {Object} Achievement
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} icon
 * @property {{type:string, [key:string]:unknown}} rule Server-evaluated rule descriptor.
 *
 * @typedef {Object} DashboardSnapshot
 * @property {'1'} schemaVersion
 * @property {DataMode} mode
 * @property {{id:string,displayName:string,memberSince:string,avatarSrc:string|null}} profile
 * @property {Veiling[]} veilings
 * @property {{id:string,name:string}[]} series
 * @property {Edition[]} editions
 * @property {Variant[]} variants
 * @property {Rarity[]} rarities
 * @property {PhysicalCard[]} physicalCards
 * @property {Ownership[]} ownerships
 * @property {Discovery[]} discoveries
 * @property {Achievement[]} achievements
 * @property {{userId:string,achievementId:string,earnedAt:string}[]} userAchievements
 * @property {{id:string,name:string,veilingIds:string[]}[]} collections
 * @property {{id:string,title:string,date:string,status:'draft'|'published',body:string}[]} news
 * @property {{id:string,title:string,subtitle:string,startDate:string,endDate:string,location:string,href:string,image:string,status:'announced'|'draft'}[]} events
 *
 * @typedef {Object} SpinariumCapabilities
 * @property {boolean} authentication
 * @property {boolean} claims
 * @property {boolean} transfers
 * @property {boolean} notifications
 * @property {boolean} threeDimensionalView
 *
 * @typedef {Object} SpinariumReadService
 * @property {(options?:{signal?:AbortSignal}) => Promise<DashboardSnapshot>} getDashboard
 * @property {() => SpinariumCapabilities} getCapabilities
 */

export {};
