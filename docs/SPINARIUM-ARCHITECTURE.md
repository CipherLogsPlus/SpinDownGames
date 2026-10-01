# Spinarium foundation

Spinarium is an additive, standalone area of the existing static SpinDownGames site. The current site remains the site entry point; its **View Spinarium** link opens `spinarium/`. Nothing in this milestone requires a game, blockchain, a purchase flow, or a production management system.

## Existing platform and milestone boundary

The repository uses semantic HTML, local CSS, and browser JavaScript, deployed through GitHub Pages with a custom domain. The original site had no authentication service or database. Existing brand assets, locally hosted fonts, the actual Trainer’s Bazaar announcement, and the site's links can be reused. Replacing this working platform with a framework is unnecessary.

The first milestone supplied the dashboard and an isolated demonstration adapter. The account correction removes that adapter from the public application entirely: entry is gated by sign-in/sign-up, new collections start empty, and empty cards are solid black without character art, silhouettes, names or numbers. Historical example assets and fixtures remain preserved but are not live collection content.

Supabase account/catalog adapters and a dedicated-project schema are now prepared. Hosted configuration remains empty until the actual project and policies are installed and verified; account forms fail closed while disconnected. The protected catalog editor is separate from ownership authority. Verified claims, transfers, notifications, 3D assets, InvoHub automation and gameplay remain unavailable. Typing a code must not create ownership, show a successful claim or grant an achievement.

## Code boundaries

| Area                                           | Responsibility                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `spinarium/index.html`                         | Standalone page shell and semantic mount points.                                                                 |
| `spinarium/styles.css`                         | Spinarium-only visual language and responsive layout.                                                            |
| `spinarium/app.js` and `spinarium/components/` | Composition, URL/view state, accessible reusable presentation and interactions.                                  |
| `spinarium/domain/types.js`                    | Versioned public read model and service contract, documented with JSDoc.                                         |
| `spinarium/domain/collection.js`               | Pure collection queries and derived display statistics.                                                          |
| `spinarium/auth/supabase-auth.js`              | Provider-verified account access, confirmation/recovery and memory-only sessions.                                |
| `spinarium/data/supabase-service.js`           | Authenticated collection projection and authorized catalog editing.                                              |
| `spinarium/config.js`                          | Public project URL/key; empty until backend activation.                                                          |
| `supabase/spinarium-schema.sql`                | Dedicated-project identity/profile, catalog, ownership restrictions, private artwork and admin/audit foundation. |
| `spinarium/data/demo-service.js`               | Historical read-only domain fixture; excluded from the public application.                                       |
| `scripts/verify-spinarium-domain.mjs`          | Dependency-free contract and domain verification.                                                                |

The composition root uses the authenticated service. Presentation components receive projected data; they do not import the mock dataset or act as ownership authority. The HTTP adapter validates a versioned `mode: 'live'` response with the verified collector's own records. Missing schema, failed authorization or incompatible data produces an error; it never falls back to demo records or pretends the account loaded successfully.

`queryCollection(snapshot, { search, filter, sort })` expresses collection intent independently of the DOM. At catalog scale, move pagination and queries to the service, retain the same vocabulary, and add cursor-based results. `getVeilingDetail()` derives display data; `getDashboardStats()` derives totals from actual ownership records, never decorative empty slots.

## Public data and visibility

Definitions, editions, variants, and artwork are separate concepts. Artwork has a role (`engraving_art`, `color_art`, `silhouette_art`, `thumbnail`, `potential_3d_asset`, or `variant_art`), asset URL, alternate text, variant association, and editorial status. Lore is localized and versioned. No single-image assumption prevents a later color reveal or variant-specific artwork.

Discovery is global; ownership is personal. A revealed character can be unowned. A collector can own multiple physical instances of the same Veiling. The “Veilings Owned” statistic counts distinct Veilings; physical instance counts are separate. “Discovered” shows all globally revealed characters, including owned ones. “Unowned” includes both revealed unowned characters and undiscovered slots.

Current collector responses contain only owned Veilings. Empty and unowned slots display no metadata or silhouette. Any later global discovery projection must redact unrevealed names, numbers, lore, release details and artwork **on the server**. CSS visibility does not protect secrets. Private object storage restricts artwork access to authorized administrators or the current owner; short-lived signed URLs remain bearer capabilities until expiration.

Private serials, claim dates, owned card instances, and private discoverer identities require authentication and object-level authorization. A public catalog response should not contain another collector's private records. The first discoverer can be shown only according to their privacy settings; internal provenance is retained independently.

## Proposed authoritative storage

These are long-term backend boundaries. The prepared catalog/profile/ownership schema is a narrower initial implementation, not a claim that a hosted database or the complete roadmap has been deployed. Edition/rarity editor labels are provisional catalog metadata; production management must introduce normalized edition/variant/batch relations through later migrations. See the accounts and admin guides for actual activation requirements.

| Entity                                                  | Key relationship or invariant                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| User / UserProfile                                      | Authentication identity and public/privacy settings are separate.                            |
| Veiling / VeilingLore / VeilingArtwork                  | Stable character definition with versioned content and multiple assets.                      |
| Series / Edition / Variant / Rarity                     | Edition belongs to a Veiling; variant belongs to an edition; rarity is configurable data.    |
| ProductionBatch                                         | Belongs to an edition/variant and records production/audit status.                           |
| PhysicalCard                                            | Belongs to one batch; globally unique physical serial; serial is not a claim secret.         |
| ClaimCredential                                         | Exactly one physical card; unique secure digest, issuance, revocation, and redemption state. |
| Ownership                                               | Current ownership projection; supports physical cards and authorized digital grants.         |
| OwnershipEvent / OwnershipTransfer                      | Immutable internal provenance and atomic transfer lifecycle.                                 |
| Discovery                                               | One global first discovery per Veiling, independent of ownership.                            |
| Collection / Achievement / UserAchievement              | Data-driven definitions and server-awarded, idempotent earned records.                       |
| Event / News                                            | Editorial publication state; drafts are not release announcements.                           |
| ClaimAttempt / SecurityEvent / AdministrativeAuditEvent | Protected, minimal, policy-retained abuse and administrative records.                        |

A physical ownership references a physical card. A future server-granted digital item references an authorized grant and may have no physical card; this is represented by nullable `physicalCardId` and an explicit acquisition source in the read contract. Do not invent a serial or fake claim for a digital grant. This supports future product options without implementing Warpling or any selection system.

Legacy editions have `kind: 'legacy'` and `registrationSupported: false`. They may contain documented production totals and retirement information when available. There is no fabricated ownership verification, claim credential, or retroactive claim flow for Legacy in this milestone.

Gameplay definitions, abilities, balance versions, digital artifacts, and manifestation events can later reference a stable Veiling ID. They should be separate optional models. No gameplay field is required to display, collect, or verify a Veiling. Any future manifestation affects presentation only: it cannot delete, block, or damage purchased ownership and must offer a free suppression mechanism.

## Public service and InvoHub

The public browser talks to a Spinarium service, not directly to an InvoHub database or manufacturing endpoints. InvoHub owns administrative definitions, batches, physical instances, credential generation, manufacturing and sales status, edition retirement, and review/audit workflows. Spinarium owns authenticated collection reads, verified claims, public discovery projections, and eventual transfers.

Use a versioned authenticated internal API or durable event/outbox integration between these services. Events such as `card.issued`, `edition.retired`, and `veiling.published` need stable event IDs, idempotent consumers, retries, and explicit versioning. InvoHub credentials must never ship to the browser. Avoid duplicating ownership authority in both systems; define one source of truth and expose projections to the other.

## Authentication and claim security before enabling registration

1. Use a server-managed identity/session architecture. Prefer Secure, HttpOnly, appropriately scoped cookies with SameSite protections; apply CSRF protection where cookie-based mutations need it. Define allowed origins and credentialed CORS deliberately. Authentication secrets must not be placed in client source, ordinary logs, or persistent browser storage. Backend authorization must check the authenticated owner on every private card/transfer endpoint.
2. Generate a claim credential using a cryptographic random source with at least 128 bits of entropy. Encode it for human entry with a documented, unambiguous normalization policy. Both the registration QR and printed code represent the same credential. The serial must have no mathematical relationship to the credential. A physical metal card does not need registration markings.
3. Persist a unique secure digest, preferably HMAC-SHA-256 with a separately managed server secret; high-entropy credentials can also use a suitable cryptographic hash. Store the credential's card binding, issuance state, and redemption state. Deliver plaintext only through a tightly controlled registration-printing process; it must not enter ordinary application/security logs. Restrict and audit any protected printing material retained for operational reasons.
4. Accept claim credentials over authenticated HTTPS POST. Never put the secret in analytics, error messages, telemetry, or logged URL paths/query strings. A future QR landing page can use a URL fragment, remove it immediately from visible history, and submit through the secure claim API; its own scripts and telemetry must still be reviewed for secret handling. Hiding QR contents is not a security control.
5. Enforce card binding, unredeemed state, account permissions, risk policy, and rate limits server-side. Give responses that do not enable credential/card enumeration. Do not reveal whether a guessed secret maps to another collector's card. Use XSS-resistant rendering, prepared SQL operations, and object-level authorization.
6. Redeem in one database transaction with a conditional update/row lock on the unused credential, unique current ownership of a physical card, and idempotency support. Create ownership/provenance, claim success, achievement awards, and first-discovery records atomically or with a transactional outbox. A concurrent replay must not produce two owners or two first discoverers.
7. Publish a reveal only after the transaction commits. Use a unique discovery constraint per Veiling and an atomic insert/upsert that preserves the true first claimant. Privacy projection must be resolved before announcing the discoverer.

Claim-attempt logging should record a request/correlation ID, outcome category, timestamp, authenticated account reference, and privacy-appropriate IP/session/device risk references. Do not record submitted plaintext tokens, request bodies containing them, or readily reversible secrets. Protect log access, configure retention, and pseudonymize/minimize personal signals as appropriate.

Use configurable account, IP, and session/device velocity policies. Support escalating warnings, short cooldowns, longer temporary restrictions, challenge/CAPTCHA escalation, suspicious timing and cross-account review, and a separate administrative security review queue. Restrict **claim functionality**, never permanently lock the whole account because of failed claims. Successful claims do not reset accumulated abuse history. Security observations age out according to configured policy. Exact limits/durations belong to policy data, not frontend constants. The frontend can display server-returned claim availability and retry times but cannot lift restrictions.

## Retirement and transfers

Production creation must lock/check the relevant edition in the same transaction that creates physical instances and increments its count. Enforce production limits and retired state server-side, including during concurrent batch requests. Once retired, store the final produced count. An override requires an explicit administrative permission, reason, and immutable audit record, with the count change in the same transaction. A frontend disabled button alone cannot enforce retirement.

Future transfers use a short-lived server-generated transfer credential/session. The authenticated current owner initiates; the intended recipient accepts. Lock or version-check the current ownership, revoke/cancel expired sessions, atomically replace the owner, append provenance, and consume the session. Concurrent acceptance, stale-owner initiation, and replay must fail safely. A credential does not authorize access to other card records. Public provenance honors privacy; internal audit history remains durable.

## Verification and remaining production work

Run the dependency-free domain checks with `node scripts/verify-spinarium-domain.mjs`. Browser checks should additionally cover original site preservation, direct page navigation, search/filter/sort, selected details, unavailable claim submission, keyboard/focus/drawer/dialog behavior, responsive layouts, reduced motion, and console/network errors.

Before activating accounts, install and verify the dedicated Supabase policies, configure confirmation/recovery delivery and provider limits, seed the owner's admin allowlist entry, and verify real collector/admin isolation. The inspected InvoHub migrations contain a fail-open administrator check; do not enable public signup against that internal database. The broader claim/transfer roadmap additionally needs transactional services, official content, security monitoring and concurrency validation. See [accounts](SPINARIUM-ACCOUNTS.md) and [administration](SPINARIUM-ADMIN.md).
