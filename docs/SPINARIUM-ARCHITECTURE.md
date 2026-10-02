# Spinarium architecture

Cloudflare is the selected platform: Workers enforce authentication and permissions, D1 stores authoritative application records, and R2 stores protected artwork. The existing static HTML/CSS/native-module site still runs on GitHub Pages. Migration must preserve that working deployment until replacement hosting has been verified. No Cloudflare Spinarium resource has been created or deployed.

The former Supabase architecture is preserved in [the historical document](history/SPINARIUM-ARCHITECTURE-SUPABASE-2026-10-01.md). Its provisioning and activation instructions are superseded; retained Supabase adapters and SQL are unused groundwork.

## Current presentation

`/spinarium/` opens the minimal “Spinarium login” screen. `admin` / `1234` is an explicit frontend preview, with no verified identity or administrative authority. The dashboard contains My Collection and Explore Veilings; other sections sit behind Menu. Collections start empty, decorative slots are black, and details open only after a card selection. Registration remains disabled. Catalog creation must never create ownership.

The first-entry ribbon cinematic and browser speech remain. Later entries bypass it through a browser-local preference; reduced motion is supported. Real account onboarding state is not implemented. Keep current artwork until the owner supplies a replacement draft. The planned space scene with a large purple Veil and no cube does not authorize an artwork change now.

## Code and service boundaries

| Area | Responsibility |
| --- | --- |
| `spinarium/index.html`, `styles.css`, `components/` | Static shell, black-and-blue styling, accessible views and introduction. |
| `spinarium/app.js` | UI composition and routing; UI state cannot establish backend authority. |
| `spinarium/domain/` | Collection read contracts and pure display queries. |
| `spinarium/data/preview-service.js` | Explicit empty frontend preview; no account, claim or ownership authority. |
| `spinarium/config.js` | Public UI configuration; preview stays enabled, API access and signup stay disabled until backend and hosting checks pass. |
| `spinarium/auth/cloudflare-auth.js`, `spinarium/data/cloudflare-service.js` | Cookie-session and protected API adapters, prepared without hosted activation. |
| `cloudflare/spinarium-worker/` | Isolated Worker backend, D1 migrations, OIDC sessions, protected collector/admin APIs and R2 access. |
| `spinarium/auth/supabase-auth.js`, `spinarium/data/supabase-service.js`, `supabase/` | Retained legacy groundwork; not the selected production backend. |
| `spinarium/data/demo-service.js` | Historical domain fixture, excluded from the public application. |

The intended production boundary is same-origin `/api/` behind a Worker. D1 is private to trusted bindings, not exposed as a browser database API. D1 has its own SQLite schema; PostgreSQL roles, RLS policies and Supabase triggers are not portable permission enforcement. The Worker checks the session and administrator allowlist on each protected request, validates object access and accepted fields, and uses prepared SQL. Hiding UI controls is only presentation.

Collectors receive their own non-draft ownership and corresponding definitions. Names/lore/artwork are redacted until the server records discovery as revealed. Drafts are currently withheld; an approved revision/publication policy is required before real ownership issuance so catalog edits cannot hide purchased content. Unowned definitions, private serials and artwork are not supplied as hidden browser metadata. Administrators may manage the catalog and artwork but cannot issue ownership through catalog APIs. Discovery, achievements, claims and production authority require later dedicated server operations; no current browser endpoint awards them.

## Authentication and administration

The owner selected Auth0 Universal Login with an email/password database connection. The isolated backend uses OIDC authorization code with PKCE and a server-managed opaque session. Authentication and signup are disabled by default; browser login/signup adapters are prepared but dormant. Tokens and provider credentials stay server-side; the browser receives a scoped Secure, HttpOnly cookie. Cookie mutations require same-origin/CSRF checks. OIDC issuer, audience, callback, state, nonce and verified identity are checked by the server using the maintained protocol library. The supported Auth0 configuration uses RS256 ID tokens, a confidential client with `client_secret_basic`, advertised PKCE S256, a fixed database connection and verified email before collector/session creation.

Trusted operators provision administrator membership from an actually verified account in D1. Signup claims, email text, a first-user shortcut, profile metadata and browser flags cannot promote a collector. Account activation requires hosted provider/session verification and appropriate abuse limits; see [accounts](SPINARIUM-ACCOUNTS.md), [administration](SPINARIUM-ADMIN.md) and [migration](SPINARIUM-CLOUDFLARE.md).

## Product and authoritative records

The current product is a premium engraved metal collectible plus a digital collection entry. A separate printed registration card contains a QR code and the same one-time claim credential. The physical serial identifies the collectible; it is not the secret. Final credential format and normalization remain undecided. No claim credentials, redemption or ownership issuance are implemented.

| Record | Required boundary |
| --- | --- |
| Identity / Profile / Session | Verified provider identity is separate from public profile and administrator authority. |
| Veiling / Artwork | Catalog content and protected assets do not imply collector ownership. |
| Ownership | Belongs to the authenticated collector; server-issued provenance is required before future writes. |
| Administrator / Audit | Trusted operator membership and attributable catalog operations; no public role setters. |
| PhysicalCard / ClaimCredential | Future card binding, independent serial and one-use secure credential. |
| Discovery / Achievement | Future server-awarded records, independent of decorative empty slots. |
| Edition / Variant / Batch | Future normalized production rules, limits and retirement; catalog labels confer no production authority. |

Only implement later models when their milestone is authorized. The current foundation must not add games, transfers, mystery purchases or other roadmap features. A future approved ownership operation must enforce account permissions and concurrency server-side; requests must never be trusted to choose their owner or award themselves achievements.

## Future claim requirements

Before enabling claims, define a cryptographically random, high-entropy credential and unambiguous human-entry normalization. Store only a secure digest with card binding and issuance/revocation/redemption state. The QR and printed code represent the same secret, independently of the serial. Plaintext belongs only in a controlled printing workflow and must never enter ordinary logs, URLs, analytics or error messages.

Redemption requires authenticated HTTPS, generic failure responses, configurable account/IP/session risk limits, and an atomic conditional redemption with unique ownership and first-discovery constraints. D1 implementations must use D1-supported transactional/batch semantics and concurrency verification rather than copying PostgreSQL row-lock instructions. A concurrent replay must not create multiple owners. Abuse restrictions apply to claims rather than permanently disabling the whole account. This is a design requirement, not a working claim endpoint.

## InvoHub isolation

Spinarium and InvoHub remain separate services. The browser never receives InvoHub database or administrative credentials. No shared database, service binding or integration has been created. Any later integration requires a narrowly authenticated API or service binding with versioned requests, idempotency and auditable authority. Choose one source of truth for issuance and ownership before connecting them; do not duplicate authority across both systems.

## Verification

Local Worker/D1 tests verify the implementation only in an isolated environment. Static browser checks verify the preview and preservation of the existing site. Neither proves hosted OIDC configuration, remote D1/R2 permissions, email delivery, DNS, certificates or replacement hosting. The [migration guide](SPINARIUM-CLOUDFLARE.md) lists staging and cutover gates; [VERIFICATION.md](../VERIFICATION.md) records actual completed checks separately from pending hosted work.
