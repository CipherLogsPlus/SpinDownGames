# Spinarium

Spinarium lives at `/spinarium/` inside the static SpinDownGames™ website. The homepage's **View Spinarium** button opens it. The site still deploys through GitHub Pages; A Cloudflare staging Worker/static site and D1 database are deployed at <https://spinarium-staging.cipherlogsplus.workers.dev/spinarium/>. Production hosting/DNS remain unchanged, and real account activation is disabled.

## Current static preview

The minimal “Spinarium login” accepts the owner-requested temporary username `admin` and password `1234`. The repository/production `config.js` explicitly selects `previewEnabled: true`. The separately generated staging config selects `previewEnabled: false`, with empty `apiBase` and disabled signup, so staging account entry remains unavailable. This is a public frontend preview with no verified identity, administrator authority, backend requests, ownership or claim capability. Sign-out and reload clear its in-memory preview session. Signup/recovery remain unavailable.

Home has two choices: My Collection and Explore Veilings. Collection grid, filters, statistics and selected details live on separate collection/explore routes. Revealed, Uncollected and Upcoming sit inside Explore; secondary destinations sit behind Menu on every screen size. Details open only after selecting a card. Collections remain empty, black slots contain no hidden artwork or invented characters, and Upcoming has an honest empty state. Registration input and submission remain disabled.

The first-entry cinematic begins on black. A centered curved medieval ribbon with triangular ends unfurls from the middle, “Welcome to your Spinarium” appears with browser speech, pauses, then shrinks to the top while content fades in row by row. No Skip button or Escape shortcut is provided. Later entries bypass it through the browser-local `spinarium.preview.introduction.v3` preference. Reduced-motion visitors receive a brief still welcome with automatic entry and no voice/movement. Mute stops speech; blocked or unavailable speech never prevents entry. Timers and speech clear on logout or dialog closure.

The current artwork and black-and-blue styling remain. Future art direction does not authorize replacing any asset before the owner's draft arrives.

## Cloudflare backend

Cloudflare Workers enforce authentication and permissions, D1 stores authoritative application data, and private R2 stores artwork. `../cloudflare/spinarium-worker/` contains the isolated OIDC/session and protected collector/admin API foundation. Auth0 Universal Login with email/password is selected. Authentication and signup default to disabled; browser `signupEnabled` is false and `apiBase` is empty. Prepared `auth/cloudflare-auth.js` and `data/cloudflare-service.js` adapters use Worker cookie sessions without handling passwords. The preview is not connected to it; do not switch `previewEnabled` until hosted backend and frontend verification have passed.

The intended production boundary is same-origin `/api/`. D1 uses its own SQLite migration and Worker authorization rather than copied PostgreSQL policies. Administrator membership requires trusted server-side provisioning of a verified profile. Catalog creation never grants ownership. Claims, discovery/achievement awards, production operations, transfers and games remain outside this foundation. InvoHub remains a separate service.

`auth/supabase-auth.js`, `data/supabase-service.js` and `../supabase/spinarium-schema.sql` are retained unused historical groundwork. Earlier Supabase setup is superseded; do not configure a Supabase project for Spinarium. `data/demo-service.js` remains an isolated historical fixture and is never imported by the public application.

See [activation](../docs/SPINARIUM-ACTIVATION.md), [migration](../docs/SPINARIUM-CLOUDFLARE.md), [accounts](../docs/SPINARIUM-ACCOUNTS.md), [administration](../docs/SPINARIUM-ADMIN.md), [architecture](../docs/SPINARIUM-ARCHITECTURE.md) and [handoff](../docs/SPINARIUM-HANDOFF.md).

## Run and verify locally

No frontend build or browser dependency is required:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000/spinarium/>. Native modules require an HTTP server. Static verification:

```sh
node scripts/verify-spinarium-domain.mjs
node scripts/verify-spinarium-intro.mjs
NODE_PATH=/tmp/spindown-qa/node_modules BROWSER_PATH=/usr/bin/chromium node scripts/verify-spinarium.cjs
NODE_PATH=/tmp/spindown-qa/node_modules BROWSER_PATH=/usr/bin/chromium node scripts/verify.cjs
```

Browser verification requires Playwright and axe-core installed outside the public site; see the root README for setup. `BASE_URL`, `BROWSER_PATH` and `SCREENSHOT_DIR` select the served site, browser and optional screenshots. Backend local commands live with the isolated Worker package. Legacy Supabase adapter/database tests may be run as historical regressions; they do not verify D1 or activate accounts.

Local tests do not prove hosted identity, provider lifecycle, cookies, remote D1/R2, DNS, TLS or replacement hosting. Record actual local and hosted outcomes separately in [VERIFICATION.md](../VERIFICATION.md). A push to GitHub `main` deploys static UI through Pages; it does not deploy the Worker or apply the D1 migration.
