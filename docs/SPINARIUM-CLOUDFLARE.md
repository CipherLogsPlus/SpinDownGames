# Spinarium Cloudflare deployment

Cloudflare Workers enforce backend authentication and permissions; D1 stores authoritative application data, and private R2 is reserved for artwork. The latest owner instruction selects direct email/password accounts, including unverified or non-deliverable email-shaped identifiers. Signup, saved data and login must work without owner setup in provider dashboards. The existing Spinarium dashboard, navigation and cinematic stay in place. Earlier Auth0 setup requirements are superseded. No external identity-provider setup is required for the current account milestone.

Production Worker `spinarium-production` serves <https://spindowngames.com/> and its account API, activated October 2, 2026 at 17:30:54 UTC. Hosted production API, account-browser and original-site checks passed. Preserve `CNAME`, the Pages fallback and original DNS values for rollback. The isolated backend lives in `cloudflare/spinarium-worker/`; InvoHub stays separate.

## Verified account access and prior staging

Tool discovery exposed `cloudflare_docs`, `cloudflare_search` and authenticated `cloudflare_execute`. Read-only requests verified one Cloudflare account and the active `spindowngames.com` zone rather than assuming plugin installation granted access. Wrangler 4.147.0 was not authenticated; connector access is separate and successfully performed subsequent staging writes.

D1 `spinarium-staging`, ID `1cfc3d12-1047-4cb7-8448-a30aff02d3d0`, was created. Initial migration `0001_foundation.sql` was applied remotely, with 10 application tables, two immutable-audit triggers, zero users/ownership/admins, and a Wrangler migration ledger. Worker `spinarium-staging` and 43 public static assets were deployed at <https://spinarium-staging.cipherlogsplus.workers.dev/> with `_headers` asset metadata.

The earlier disabled deployment returned HTTP 200 from `/api/health`, with accounts/claims false, and 503 from protected authentication routes. Its generated frontend disabled preview/API/signup. Worker settings disabled automatic invocation logs and enabled query redaction. These checks establish the prior staging foundation, not verification of the new password-account flow. That disabled deployment has since been replaced on staging: password provider and signup flags are enabled, `0002_password_accounts.sql` plus its index are applied, and the generated frontend enables `/api` signup without preview. Actual staged signup returned HTTP 201, with saved profile, session and empty-dashboard reads verified. Staging passed 14 actual browser checks, including signup/login/persistence and mobile Menu/keyboard logout; see [VERIFICATION.md](../VERIFICATION.md).

Production D1 `spinarium-production` (`ce02e866-1b5b-4495-bf8b-38719a47b344`) has also been created with foundation/password migrations and ledger applied. It received both migrations and now backs the active production Worker. Route `spindowngames.com/*` (ID `0689578f458d4124809042de5d84fe40`) is active with 43 public assets and `_headers` metadata. The four apex A records are proxied but retain `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`; `www` remains a DNS-only CNAME to `cipherlogsplus.github.io`. Always Use HTTPS is enabled; the active Full SSL mode, repository `CNAME` and Pages deployment are preserved. Initial stale-DNS requests reached the old Pages response before propagation; fresh health requests returned HTTP 200 with accounts enabled and claims disabled.

R2 still returns `10042`; no bucket exists. Email-service access returned `2036 Unauthorized`. Neither blocks saving accounts or password login. R2 blocks private artwork work; absent email delivery means password reset is unavailable for every account. Preserve the unrelated existing Worker and InvoHub.

## Direct credential backend

Migration `0002_password_accounts.sql` adds `password_accounts`, referencing the server-generated user ID. It stores a unique normalized email-shaped identifier and versioned salted scrypt hash. Email normalization trims and lowercases without stripping aliases. Email is unverified and never supplies administrator authority or links to a legacy provider account.

The server accepts passwords of 15–128 Unicode code points and at most 512 UTF-8 bytes. Scrypt uses a random 16-byte salt, 32-byte output and `N=32768`, `r=8`, `p=3`. Native hosted hashing supported the successful staged signup; production signup/login and saved-account persistence passed 12 actual browser checks. Plaintext passwords are neither stored nor logged.

Sessions use an opaque Secure, HttpOnly cookie, a D1 token digest, eight-hour expiry, same-origin checks and CSRF protection. The Worker validates the current account/session on private requests. The browser cannot choose its owner, role, awards or catalog permissions. Introduction completion remains browser-local.

| API | Behavior |
| --- | --- |
| `GET /api/health` | Configuration flags only; not proof of account readiness. Claims remain disabled. |
| `POST /api/auth/signup` | Saves `{email, password, displayName}` and creates an empty collector/session when signup is enabled. |
| `POST /api/auth/login` | Checks `{email, password}` against saved credentials and creates a server session. |
| `GET /api/auth/session` | Returns the current account projection, CSRF token and expiry. |
| `POST /api/auth/logout` | Revokes the session with origin/CSRF protection. |
| `GET /api/dashboard` | Authorized collector-only projection for the existing Spinarium dashboard. |
| `GET /api/admin/access` | Checks the trusted allowlist without changing it. |
| `GET, POST /api/admin/veilings` | Administrator catalog read/create; creation never grants ownership. |
| `PATCH /api/admin/veilings/:id` | Administrator edit with CSRF and matching `If-Match` revision. |
| `POST /api/admin/veilings/:id/artwork` | Administrator artwork upload/attachment; private R2 required. |
| `GET /api/artwork/:artworkId` | Administrator or authorized owner of current non-draft/revealed artwork. |

There is no reset, claim, ownership issuance, discovery award, achievement award, production or role-mutation endpoint in this milestone.

## Local and hosted verification

From the Worker package, `npm ci`, `npm run types`, `npm run check`, `npm test`, `npm run db:migrate:local` and `npm run dry-run` prepare and check local code. The default configuration remains local-only. Local migration/dry-run commands do not provision or activate hosted accounts. Use the dedicated staging configuration with actual resources for remote work.

The staging and production migrations are applied; verify the current ledger before further changes and never replay the original schema blindly. Verify hosted hashing, signup, saved profile/credential rows, empty ownership, login failure, reload persistence, logout/expiry, origin/CSRF denial, rate limits and administrator/collector separation. Keep request bodies, passwords, cookies and account secrets out of ordinary logs.

The frontend lets the user register and sign in through Spinarium, then opens the preserved Home, My Collection and Explore Veilings interface. No owner setup in an Auth0 or Cloudflare dashboard is required for account registration. Production is active; verify it against the deployed backend after changes. Confirm the existing website, policy pages, asset paths, TLS and redirects continue working. Production DNS/hosting changes must retain a rollback path and follow actual hosted verification; do not announce activation from local tests or health flags.

See [accounts](SPINARIUM-ACCOUNTS.md), [activation](SPINARIUM-ACTIVATION.md), [administration](SPINARIUM-ADMIN.md) and [verification](../VERIFICATION.md).

Production account verification passed 13 API requests and 12 actual browser checks; the original-site hosted suite passed 29 checks. Saved QA profiles/password hashes survived logout and relogin. Only the exact guarded test accounts were removed afterward, with credential/session cascade and empty account/admin/ownership counts verified; no real user data or blanket session collection was deleted. Temporary credential/cookie/request files were removed.

## Reproduce the active production package

From the repository root:

```sh
cd cloudflare/spinarium-worker
npm ci
npm run check
npm test
npm run prepare:production
npm run dry-run:production
```

`prepare:production` runs `node scripts/prepare-staging-assets.mjs --production --accounts-enabled --signup-enabled`. It generates `.production-assets` with preview disabled, `/api` enabled, signup enabled and no credentials. The allowlist excludes backend source, migrations, documentation, dependencies, legacy/demo adapters and Git metadata. The generated package contains 43 served files plus `_headers`; the active production configuration enables password/auth/signup and uses the production D1 ID and apex route.

`dry-run:production` prepares those assets and runs `wrangler deploy --config wrangler.production.jsonc --dry-run`. It passed locally and is included in CI; it does not change hosted resources. To deploy a verified update through an authenticated CLI, check `npx wrangler whoami`, then use `npx wrangler deploy --config wrangler.production.jsonc`. This session deployed through the authenticated connector; its authorization does not authenticate Wrangler. Never deploy the default local configuration to production, and inspect migration state before applying any pending remote migration.

## Rollback without losing accounts

Keep D1 databases, password/profile rows, ownership records, audit history, migrations and server sessions. A Worker/static rollback changes code and routing; it must not delete or recreate the database. Existing session expiry continues normally.

For a code problem, restore a known compatible Worker version and matching generated assets while retaining the same D1 binding. To pause registrations, disable server `SIGNUP_ENABLED` and the generated signup UI while retaining authenticated login for existing accounts. Disable `AUTH_ENABLED` only when all account access must be paused; preserve its records.

For a full return to Pages hosting, detach the production apex Worker route and restore the four apex A records to DNS-only using their retained GitHub IP values. Keep `www` CNAME, `CNAME`, Pages domain/HTTPS setup, Full SSL and Always Use HTTPS. Verify apex/`www`, HTTP redirects and the restored site. Account endpoints are unavailable while Worker routing is removed, but saved accounts remain in D1 for restoration. Do not delete D1 data or blanket-clear sessions as part of hosting rollback.

## Scope and earlier decisions

Auth0 Universal Login was an earlier preparation choice in this session. The owner's later instruction supersedes its dashboard/client-secret/email-verification prerequisites; its earlier local OIDC tests remain historical results. Supabase adapters/schema and [historical guides](history/SPINARIUM-ACCOUNTS-SUPABASE-2026-10-01.md) remain unused groundwork. D1 uses its own SQLite schema and Worker authorization, not PostgreSQL RLS.

Claims remain disabled. The separate registration QR and printed credential must represent the same future one-time secret, independently of the physical serial. Final credential format, issuance, hashing and atomic redemption remain separate work. Games, transfers, mystery purchases and other roadmap features are outside this milestone. No shared InvoHub database credential or integration is configured.
