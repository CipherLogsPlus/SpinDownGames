# Spinarium handoff — 2 October 2026

Repository: `CipherLogsPlus/SpinDownGames`. Website: <https://spindowngames.com/>. Spinarium: <https://spindowngames.com/spinarium/>. Inspect the current GitHub `main`, deployment and working tree before continuing. Preserve uncommitted work and the live site. This session inspected main at `a7e1dad` before changes; this is a starting revision, not a claim that the new backend is published.

## Selected platform and access

Cloudflare Workers, D1 and R2 replace the prior Supabase recommendation. The site still uses static HTML/CSS/native JavaScript modules on GitHub Pages; Cloudflare manages DNS. Preserve this infrastructure until replacement hosting has passed hosted checks. Supabase files remain unused historical groundwork. [The older handoff](history/SPINARIUM-HANDOFF-SUPABASE-2026-10-01.md) is explicitly superseded.

The Cloudflare plugin provides documentation search, OpenAPI schema search and authenticated general API execution. Read-only requests successfully returned one account, the active `spindowngames.com` zone, an empty D1 database list, and an unrelated existing contact-form Worker that must be preserved. R2 returned error `10042`, requiring dashboard enablement. Installation alone was not accepted as account access. Wrangler 4.147.0 `whoami` reported “Not authenticated.” Connector access does not establish Wrangler identity, and write permissions were not exercised. No Spinarium Cloudflare resources have been created or deployed. See [the migration guide](SPINARIUM-CLOUDFLARE.md).

## Current UI to preserve

- Minimal “Spinarium login”; explicit frontend-only `admin` / `1234` preview. It grants no real identity, administrator authority or demo Veilings.
- Empty collection; My Collection and Explore Veilings form the home choices. Secondary sections sit behind Menu, and detail appears after selecting a card. Registration is disabled.
- First-entry black-screen cinematic: centered curved medieval ribbon with triangular ends unfurls from the middle, “Welcome to your Spinarium” appears with browser speech, pauses, then shrinks to the top while content appears by row. No Skip button. Later entries bypass it; reduced motion is supported. Completion is browser-local.
- Black-and-blue styling matches the main site. Keep artwork unchanged until the owner supplies a replacement draft. A purple space vortex called the Veil replacing the moon, without a cube, is a planned direction only.

## Backend foundation

`cloudflare/spinarium-worker/` isolates the new TypeScript Worker from the existing site. It uses a D1-native schema, private R2 access, OIDC authorization code with PKCE via `oauth4webapi`, and server-managed opaque cookie sessions. The owner confirmed Auth0 Universal Login with email/password. `AUTH_ENABLED`, `SIGNUP_ENABLED` and browser `signupEnabled` default false; `AUTH0_CONNECTION` and `apiBase` are empty. Frontend Cloudflare adapters prepare login/signup/session and protected reads without connecting the public preview. The backend requires RS256, confidential-client `client_secret_basic`, advertised PKCE S256, a fixed Auth0 database connection and verified email before collector/session creation.

Worker permissions enforce authenticated own-collection reads and trusted allowlist-only catalog/artwork administration. Catalog creation never grants ownership. Signup/profile/provider metadata cannot promote collectors. Auditable catalog writes and protected object access are part of the foundation; public role setters and ownership issuance are absent. D1 does not inherit PostgreSQL RLS, roles or triggers from the retained Supabase schema.

Auth0 is selected, but no Auth0 application/connection has been configured by this work, verified owner identity seeded, account activated or remote resource deployed. Local verification is recorded separately in [VERIFICATION.md](../VERIFICATION.md). Mocked provider tests are not hosted authentication verification.

## Next work

Follow [the incremental Cloudflare runbook](SPINARIUM-CLOUDFLARE.md): verify credentials/account identity, resolve R2 enablement, provision dedicated staging D1/R2, configure a dedicated Auth0 regular web application/database connection, securely configure and deploy staging, then verify real sessions, CSRF, collector/admin isolation, empty signup, audit and artwork permissions. Verify the prepared frontend Cloudflare service and login/signup adapters against the hosted backend before activating them. Update existing policies for actual processing before enabling accounts.

Verify the complete replacement static site on a staging hostname before changing production DNS or disabling Pages. Confirm asset paths, routes, TLS, apex/`www`, original-site behavior and the exact deployed revision. No deployment claim should rely on local tests or a build/dry run.

The current product is a premium engraved metal collectible plus a digital collection entry. A separate registration card carries a QR and the same one-time claim secret; the physical serial identifies the collectible and is not that secret. Final credential format/security still needs definition. Claims stay disabled until secure issuance/redemption and authoritative provenance are verified.

InvoHub remains isolated behind a future authenticated service boundary. Do not share database credentials or enable public collector signup against it. Do not implement games, transfers, mystery purchases or other future roadmap features. Never ask the owner to paste secrets into chat; use secure configuration or interactive authentication.
