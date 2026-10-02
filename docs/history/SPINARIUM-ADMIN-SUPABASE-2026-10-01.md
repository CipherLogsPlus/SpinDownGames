> Historical record, superseded on 2 October 2026. Cloudflare Workers, D1 and R2 are the selected platform. The instructions below must not be used to provision or activate Spinarium. See [the current Cloudflare migration guide](../SPINARIUM-CLOUDFLARE.md).

# Spinarium accounts and protected catalog administration

The website now has an authenticated service adapter and a protected catalog editor foundation. It is **not connected to a live Supabase project yet**: no Supabase management connector, project URL, publishable key, or SQL provisioning access is available in this session. The shipped configuration remains empty. No accounts, administrator grants, catalog entries, ownership, or backend deployment have been created remotely.

## Use a separate project

Create a **new Spinarium Supabase project under the existing Supabase account**, keeping InvoHub in its original project. Do not enable public Spinarium signup against InvoHub. A read-only inspection found a role-check defect in an InvoHub administrative RPC: a NULL role can bypass `NOT IN` rejection and elevate an unauthorized account. This needs its own verified security correction; this Spinarium work does not modify InvoHub.

`supabase/spinarium-schema.sql` intentionally refuses installation when the public schema already contains application tables. Run it once, as the project database owner, in the SQL editor of the new dedicated project. It creates only Spinarium tables/functions, an Auth profile bootstrap trigger, and a private artwork bucket. It contains no production data, demo grants, claim credentials, or unrelated schema changes.

## Configuration and first administrator

1. Install [the initial migration](../../supabase/spinarium-schema.sql) in the new project. Enable email/password Auth and configure confirmation/password-reset redirect URLs for the Spinarium page according to `SPINARIUM-ACCOUNTS.md`.
2. Put that project's HTTPS URL and **publishable key** in the website's public configuration. A legacy `anon` key can also be used. Never place `service_role`, `sb_secret_*`, database passwords, or management tokens in browser code. The adapter rejects elevated legacy JWT keys and secret-key prefixes.
3. Create and confirm your collector account using Spinarium's signup flow. A real profile is created from `auth.users`; its membership date is the account creation date. Signup metadata is display text only and has no role authority.
4. In the dedicated project's SQL editor, identify the confirmed owner's exact Auth user UUID, then seed the private allowlist. Replace the example UUID/email with the verified owner. This operation requires trusted SQL access and is not available from public signup or the browser.

```sql
-- Read the correct confirmed account first; do not guess another user's UUID.
select id, email, email_confirmed_at from auth.users
where email = 'owner@example.com';

-- Run only after verifying the UUID and confirmed email above.
insert into private.spinarium_admins (user_id, note)
values ('11111111-1111-4111-8111-111111111111', 'Initial verified SpinDownGames owner');
```

5. Sign in again and open Spinarium's Admin route. The interface calls the server RPC `is_spinarium_admin()`; network errors, missing schema, absent/expired sessions, and non-true responses deny administrator access. SQL RLS independently authorizes every catalog/artwork action, including calls made outside the interface.

New accounts own zero Veilings and have zero completed collections/awards/discoveries. Empty decorative card slots are layout placeholders, not inventory or undiscovered catalog entries. Merely adding a definition in Admin does not give it to any collector. The read adapter never falls back to the demo dataset when a configured backend fails.

## Editor operations

An authorized administrator can create/update actual Veiling definitions with a name, description/lore, optional character number, configurable rarity text, edition text, and `draft`, `active`, or `retired` status. Number and text limits are validated both in the adapter and in PostgreSQL. Unknown fields cannot mass-assign administrator roles, account ownership, or audit metadata. Primary IDs and system timestamps are server-generated/protected.

Artwork upload accepts PNG, JPEG, or WebP, at most 8 MB. The adapter checks media type and file signatures. The private Storage bucket also enforces MIME and size limits. Objects use `<veiling-uuid>/<random-uuid>.<extension>` paths; original filenames are not retained. Uploads never overwrite an existing file. The editor attaches a successful new upload by updating that Veiling's artwork path. The database checks that the path belongs to its Veiling.

The adapter offers **no deletion methods**. Replacing artwork preserves the previous source object. If an upload succeeds but attaching the path fails, an unused private object can remain; report/review it administratively rather than silently deleting content. There is no automatic cleanup in this milestone.

Every definition insert/update records the authenticated actor, target ID, action, timestamp, and changed column names in a private audit table. Descriptions, artwork contents, passwords, access tokens, and claim secrets are not copied into audit details. Ordinary application roles cannot read or mutate administrator authority/audit tables, and a trigger rejects audit row updates/deletes. Trusted database-owner access remains an operational responsibility.

The initial SQL administrator grant records its grant date, granting user when supplied, and note in the protected allowlist. It does not create a separate immutable authority-change audit event. Before introducing routine administrative role management or ownership issuance/transfers, add authoritative audit/provenance transactions for those operations; the current immutable audit covers catalog edits only.

## Read and ownership boundary

`createSpinariumService(config, auth)` uses the real in-memory Auth access token to call Supabase REST, RPC, and private Storage endpoints. Requests omit cookies, prohibit redirects, and disable cache persistence. Data errors do not copy raw backend messages or credential-bearing URLs into application logs. No elevated server credential is used.

`spinarium_dashboard()` returns a versioned `schemaVersion: '1'`, `mode: 'live'` projection using the authenticated user ID, not a user ID supplied by a request body. It returns only that collector's ownership and corresponding Veiling definitions. Hidden/unowned character names, numbers, artwork paths, and descriptions never enter that response. A separate admin catalog read is protected by allowlist-backed RLS. Private assets are opened with short-lived signed URLs (five minutes); their bearer nature and expiry must be considered when adding telemetry. Signed URLs must not be logged or made public.

`spinarium_ownerships` has read-own policies and no browser insert/update/delete grant, **including for catalog administrators**. Neither the editor, signup flow, nor read adapter grants ownership. There is no claim redemption implementation. Physical-card instances/serials, credential generation, verified ownership issuance, and production automation remain future trusted backend work; the current physical-card projection is empty rather than invented.

Global first discovery is stored independently in `spinarium_discoveries`. It has no browser writes. A future verified claim transaction must atomically create ownership and the appropriate first-discovery record before publishing a reveal. Other collectors' private discoverer IDs are not exposed; only a permitted public discoverer name is projected. No achievements are fabricated: achievement and collection arrays are currently empty until authoritative definitions/award services exist.

The current editor uses rarity/edition labels on a definition and one primary artwork path. The read projection maps them to the existing edition/variant/artwork component contract; those projected IDs do not represent manufactured edition/batch records. Rarity sorting is alphabetical until a configurable ranked rarity catalog is added. Publication/retirement status currently describes the catalog definition, not an enforceable manufacturing count. Dedicated production/edition models must enforce retirement/count limits before production tools are enabled.

Draft status is editorial metadata, not a separate publication access barrier in this schema. An administrator can read all definitions, and an authorized owner can read their definition/artwork even if its status is draft or retired. There is currently no ownership issuance flow. Before issuing actual owned cards, implement a versioned publication/reveal policy and transactional ownership provenance; do not silently reinterpret a status edit as a secure release or production-retirement operation.

## Local verification and handoff

The backend checks exercise adapter error handling, fail-closed admin access, owned-only projections, private artwork upload rules, and the actual migration in an isolated PostgreSQL-compatible PGlite database. They do **not** connect to or change a hosted Supabase project.

```sh
# Development-only test dependency; it is not shipped to visitors.
npm install --prefix /tmp/spinarium-db-check @electric-sql/pglite@0.5.8
SPINARIUM_PGLITE_MODULE=/tmp/spinarium-db-check/node_modules/@electric-sql/pglite/dist/index.js node scripts/verify-spinarium-backend.mjs
```

The isolated database stubs only Supabase's platform roles/Auth/Storage tables, then executes the unchanged checked-in migration. Tests verify actual role grants/RLS behavior, NULL-role rejection, metadata spoof rejection, catalog and artwork isolation, no browser ownership grant, profile bootstrap, immutable audit rows, and real empty-member projections. A final live smoke test remains necessary after project provisioning: real confirmed signup/signin/reset, SQL allowlist grant, admin create/update/upload, non-admin denial, private Storage signing, and zero collection counts for new users.
