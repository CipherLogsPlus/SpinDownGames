# Spinarium handoff — 2 October 2026

Repository: `CipherLogsPlus/SpinDownGames`. Website: <https://spindowngames.com/>. Spinarium: <https://spindowngames.com/spinarium/>. Inspect current GitHub `main`, deployments and uncommitted work before continuing. Preserve working pages, DNS, artwork and the GitHub Pages rollback path.

The latest owner instruction prioritizes actual signup, saved user data and login without owner setup in provider dashboards. Preserve the Spinarium Home, My Collection, Explore Veilings, Menu and cinematic; successful signup/login opens that interface. Direct Cloudflare email/password accounts replace the earlier Auth0 choice. Unverified or non-deliverable email-shaped identifiers are allowed and have no permission authority. No Auth0 application/client secret or email sender is required to deliver this account milestone.

## Existing deployment and next verification

The Cloudflare connector authenticated successfully and performed actual staging writes, independently of the unauthenticated Wrangler CLI. D1 `spinarium-staging` (`1cfc3d12-1047-4cb7-8448-a30aff02d3d0`) received `0001_foundation.sql` with 10 application tables, two immutable-audit triggers and a Wrangler ledger. Worker/static staging with 43 public assets and `_headers` metadata was deployed at <https://spinarium-staging.cipherlogsplus.workers.dev/>. Earlier health/denial checks verified an intentionally disabled account deployment.

The direct-password backend is now deployed on staging with provider/auth/signup flags enabled, `0002_password_accounts.sql` plus index applied, and generated signup `/api` frontend assets without preview. Actual signup returned HTTP 201; saved profile, session and empty-dashboard reads worked. Staging passed 14 actual browser checks including mobile Menu, keyboard logout and account persistence. Production Worker `spinarium-production` and D1 `spinarium-production` (`ce02e866-1b5b-4495-bf8b-38719a47b344`) were activated October 2, 2026 at 17:30:54 UTC, with both migrations/ledger and the same 43 public assets. Route `spindowngames.com/*` is active. The four apex A records are proxied with their original GitHub IP values preserved; `www` CNAME stays DNS-only. Always Use HTTPS is enabled; Full SSL and Pages/CNAME are retained. Production API checks passed 13 requests and the original-site hosted suite passed 29 checks; final production browser verification is in progress. No administrator or ownership grant exists. Refer to [VERIFICATION.md](../VERIFICATION.md) for actual local and hosted results; earlier OIDC tests do not prove the new account flow.

R2 returns `10042`, with no artwork bucket. Email-service access returned `2036 Unauthorized`. R2 does not block signup/login; password reset is unavailable for all accounts until email delivery and secure recovery exist. Do not require the owner to configure Auth0 or an email sender before implementing accounts.

## Account and permission contract

- `POST /api/auth/signup` accepts email, password and display name; the Worker saves an empty collector and creates a session. `POST /api/auth/login` checks saved email/password credentials.
- Email identifiers are trimmed/lowercased with no alias stripping, saved uniquely and left unverified. They cannot promote a collector, link another account or prove owner identity.
- Passwords contain 15–128 Unicode code points, at most 512 UTF-8 bytes. Store a versioned scrypt hash with a random 16-byte salt, 32-byte output, `N=32768`, `r=8`, `p=3`. Verify hosted runtime performance; never store/log plaintext.
- Eight-hour opaque cookie sessions use Secure/HttpOnly/SameSite, D1 token digests, current account checks, origin and CSRF protection. Signup/login return `{user, csrfToken, expiresAt}`. Profile data persists in D1; introduction completion remains browser-local.
- Administrator membership requires a trusted operator to confirm and allowlist the exact account ID. Signup, email, browser flags and the first user cannot grant it. Catalog creation grants no ownership; no claim/award/production/transfer API exists.

Verify hosted signup/login and the preserved Spinarium interface, saved rows, empty ownership, rate limits, reload/logout/expiry and direct permission denial after deployed changes. Preserve D1 records and the Pages origin rollback path. Update policies for the actual credential handling and explicitly unavailable reset. Keep InvoHub separate. See [accounts](SPINARIUM-ACCOUNTS.md), [activation](SPINARIUM-ACTIVATION.md) and [deployment](SPINARIUM-CLOUDFLARE.md).

## Presentation and product to preserve

The repository development preview remains a frontend-only `admin` / `1234` experience. Active generated production assets use actual password accounts instead. It grants no identity, administrator authority or demo Veilings. Collections are empty; My Collection and Explore Veilings are the two home choices, secondary sections sit behind Menu, and details open only after selecting a card. Current artwork stays until the owner supplies a replacement draft.

Preserve the black-and-blue theme and first-entry ribbon cinematic, browser speech, automatic completion, no Skip button and reduced-motion support. Introduction completion is browser-local. Planned purple Veil artwork without a cube is not an instruction to replace assets now.

The product is a premium engraved metal collectible plus a digital collection entry. A separate registration card carries a QR and the same one-time claim secret; the physical serial identifies the collectible and is not the secret. Claims and final credential format/security remain separate pending work. Do not add games, transfers, mystery purchases or other roadmap features. Never ask the owner to paste passwords or administrative secrets into chat.

The [older Supabase handoff](history/SPINARIUM-HANDOFF-SUPABASE-2026-10-01.md) is historical and superseded. Earlier Auth0 setup is superseded by the latest account instruction; prior verified results remain in the verification record rather than duplicated archives.
