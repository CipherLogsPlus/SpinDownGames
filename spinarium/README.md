# Spinarium

Spinarium is live at <https://spindowngames.com/spinarium/> through Cloudflare Worker `spinarium-production`, with direct email/password signup/login and saved D1 accounts. The homepage's **View Spinarium** button opens it. The account-management release passed all 16 actual account/browser checks in each of staging and production; the final original-site hosted suite passed all 29 checks. GitHub Pages and the original DNS origin values remain for rollback.

## Repository development preview

The minimal “Spinarium login” accepts the owner-requested temporary username `admin` and password `1234`. The repository `config.js` intentionally selects the development preview with `previewEnabled: true`. Separately generated staging and active production configs select `previewEnabled: false`, `apiBase: "/api"` and enabled signup, using actual D1 accounts. Source preview switches are not the deployed account configuration. This development preview has no verified identity, administrator authority, backend requests, ownership or claim capability. Sign-out and reload clear its in-memory preview session. Signup/recovery remain unavailable.

Home has two choices: My Collection and Explore Veilings. Collection grid, filters, statistics and selected details live on separate collection/explore routes. Revealed, Uncollected and Upcoming sit inside Explore; secondary destinations sit behind Menu on every screen size. Details open only after selecting a card. Collections remain empty, black slots contain no hidden artwork or invented characters, and Upcoming has an honest empty state. Registration input and submission remain disabled.

The first-entry cinematic begins on black. A centered curved medieval ribbon with triangular ends unfurls from the middle, “Welcome to your Spinarium” appears with browser speech, pauses, then shrinks to the top while content fades in row by row. No Skip button or Escape shortcut is provided. Later entries bypass it through the browser-local `spinarium.preview.introduction.v3` preference. Reduced-motion visitors receive a brief still welcome with automatic entry and no voice/movement. Mute stops speech; blocked or unavailable speech never prevents entry. Timers and speech clear on logout or dialog closure.

The 60-second film is cancelled. The short banner entrance, current artwork and black-and-blue styling remain.

## Cloudflare backend

Cloudflare Workers enforce authentication and permissions, D1 stores authoritative application data, and private R2 is reserved for artwork. `../cloudflare/spinarium-worker/` contains direct password hashing/session management and protected collector/admin APIs. The owner selects direct email/password signup/login through Cloudflare, without external provider dashboard setup. Email-shaped identifiers may be unverified/non-deliverable and have no authority. The frontend selects `authProvider: "password"`. The repository defaults remain disabled; active generated production assets enable `/api` and signup, matching enabled backend flags. `auth/cloudflare-auth.js` and `data/cloudflare-service.js` submit signup/login credentials to the Worker over HTTPS and use protected cookie sessions. Signup/login open the existing Spinarium home and collection interface. Account data and salted scrypt password hashes persist in D1; the welcome-introduction preference remains browser-local. Passwords require at least 15 characters. Administrator-assisted recovery is active and passed actual staging and production account verification. Automatic email recovery remains unavailable. R2 setup is needed for artwork rather than login. The development preview is not account authority.

The active production boundary is same-origin `/api/`. D1 uses its own SQLite migration and Worker authorization rather than copied PostgreSQL policies. The [account-management release](../docs/SPINARIUM-ACCOUNT-MANAGEMENT.md) adds an indexed, paginated **Menu → Accounts** directory. A trusted operator provisioned the owner's exact designated saved account as the sole owner, with an audited grant and prior sessions revoked. Sign in again to open the directory. The owner appoints regular administrators, who can manage collectors only. Catalog creation never grants ownership. Claims, discovery/achievement awards, production operations, transfers and games remain outside this foundation. InvoHub remains a separate service.

`auth/supabase-auth.js`, `data/supabase-service.js` and `../supabase/spinarium-schema.sql` are retained unused historical groundwork. Earlier Supabase setup is superseded; do not configure a Supabase project for Spinarium. `data/demo-service.js` remains an isolated historical fixture and is never imported by the public application.

See [activation](../docs/SPINARIUM-ACTIVATION.md), [migration](../docs/SPINARIUM-CLOUDFLARE.md), [accounts](../docs/SPINARIUM-ACCOUNTS.md), [administration](../docs/SPINARIUM-ADMIN.md), [architecture](../docs/SPINARIUM-ARCHITECTURE.md) and [handoff](../docs/SPINARIUM-HANDOFF.md).

## Ownership records

**Your records** lists individual ownership IDs and acquired dates. Each record has a bookmarkable page, and collection search accepts record IDs. Acquired-date sorting is available. Owned records remain visible when catalog content returns to draft; unfinished catalog details are hidden. Claims and issuance remain disabled, so catalog creation alone does not populate a collection.

## Member showcase and Veiling Studio

The new local workflow is **Create Veiling → Save draft → Publish to Public or Upcoming**. Created Veilings are searchable and filterable. A name is enough to save an initial draft. Saved changes stay private until **Publish changes** is confirmed. Public means signed-in members; anonymous visitors do not receive showcase content.

Upcoming offers **Coming soon** or an optional calendar date. Publishing is always manual. Administrators can move the approved version between Public and Upcoming or hide it without publishing pending edits. Members browse approved content from **Explore Veilings** and **Upcoming**, including with an empty collection. Viewing or publishing a Veiling grants no ownership or discovery.

This update requires migration 0005 and matching Worker/frontend deployment; see [architecture](../docs/SPINARIUM-ARCHITECTURE.md). The cancelled film migration 0004 is not required.

## Run and verify locally

No frontend build or browser dependency is required:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000/spinarium/>. Native modules require an HTTP server. Static verification:

```sh
node scripts/verify-spinarium-domain.mjs
node scripts/verify-spinarium-ownership.mjs
node scripts/verify-spinarium-showcase.mjs
node scripts/verify-spinarium-studio.mjs
node scripts/verify-spinarium-intro.mjs
NODE_PATH=/tmp/spindown-qa/node_modules BROWSER_PATH=/usr/bin/chromium node scripts/verify-spinarium.cjs
NODE_PATH=/tmp/spindown-qa/node_modules BROWSER_PATH=/usr/bin/chromium node scripts/verify.cjs
```

Use Node.js 24 for the verification scripts. The focused browser suites are `scripts/verify-spinarium-ownership-browser.cjs` and `scripts/verify-spinarium-showcase-browser.cjs`, using the same environment settings below. Browser verification requires Playwright and axe-core installed outside the public site; see the root README for setup. `BASE_URL`, `BROWSER_PATH` and `SCREENSHOT_DIR` select the served site, browser and optional screenshots. Backend local commands live with the isolated Worker package. Legacy Supabase adapter/database tests may be run as historical regressions; they do not verify D1 or activate accounts.

Local tests do not prove hosted signup/login, password persistence, cookies, remote D1/R2, DNS, TLS or replacement hosting. Record actual local and hosted outcomes separately in [VERIFICATION.md](../VERIFICATION.md). A push to GitHub `main` deploys static UI through Pages; it does not deploy the Worker or apply the D1 migration.
