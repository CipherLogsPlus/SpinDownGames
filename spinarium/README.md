# Spinarium

## Current static preview

The logged-in home is a two-choice hub: My Collection and Explore Veilings.
The collection grid, filters, statistics, and selected details live on separate
collection/explore routes. Revealed, Uncollected, and Upcoming are nested inside
Explore; other destinations sit behind the Menu disclosure on every screen size.
The collection filter uses one dropdown rather than five buttons. Details open
only after a card selection. Registration stays in My Collection and remains
unavailable until a secure claim backend exists. Upcoming has an honest empty
state, with no invented releases. Administrator permissions remain unchanged.

The entry screen intentionally stays minimal: “Spinarium login,” username,
password, and Log in. Atmospheric artwork and collection details appear after
entry, preserving the first-login cinematic surprise.

The owner requested a temporary static login: username `admin`, password `1234`.
`config.js` explicitly selects `previewEnabled: true`. This is a public UI preview,
not authentication or protection of private information. It opens an empty
dashboard, grants no Veilings, makes no backend requests, and has no administrator
or claim authority. Sign-out and reload clear the in-memory preview session.
Signup and recovery are unavailable in this mode.

The first preview login fades into a black screen. A curved scroll unfurls at
center, “Welcome to your Spinarium” fades in alongside browser-generated speech,
then the scroll pauses, shrinks and moves to the top as the dashboard appears.
The docked ribbon remains above the collection. Dashboard sections fade in from
top to bottom, with collection cards sharing a delay when they occupy the same
responsive grid row. The stagger runs only for this introduction, and animation
state clears on logout. There is no Skip button or Escape shortcut; the one-time
introduction completes automatically. Reduced-motion visitors get a brief still
welcome that automatically opens the dashboard without voice or movement.

Voice is provisional browser speech (when supported/permitted), not recorded
character audio. Mute stops it; unavailable or blocked speech never prevents
entry. All timers and speech clear on logout or dialog closure.
Completion uses only `spinarium.preview.introduction.v3`, a browser-local seen
preference. The revised sequence gets its own version so earlier preview visitors
can see it once. Real per-account onboarding remains a future backend feature.

Run `node scripts/verify-spinarium-intro.mjs` for deterministic timeline,
interruption, focus restoration, preference, and reduced-motion checks.

To connect real accounts later, set `previewEnabled: false` and configure the
dedicated Supabase project using the account setup guide. The provider adapters
remain intact; provider failures never automatically fall back to preview access.
The historical account-activation notes below describe that provider mode.

Spinarium lives at `/spinarium/` inside the static SpinDownGames™ site. The original website retains its existing content, assets, scripts and GitHub Pages deployment. Its **View Spinarium** button is the entry point.

The entry now requires sign-in or account creation. No demonstration characters, silhouettes, character numbers, invented users or ownership grants appear. Empty slots are plain black decorative cards, not catalog records. A new authenticated collector starts with zero ownership records.

**Account activation is pending.** `config.js` contains no project URL or public key, so the account forms are visibly unavailable. The interface cannot create an account until a dedicated Supabase project, its database/storage policies, email confirmation and public configuration have been installed and verified. See [account setup](../docs/SPINARIUM-ACCOUNTS.md) and [admin setup](../docs/SPINARIUM-ADMIN.md).

## Run locally

No build step or browser dependency is required:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/spinarium/`. Hash routes include `#signin`, `#signup`, `#reset`, `#dashboard`, `#collection`, `#achievements`, `#discoveries` and `#admin`. Collection and administrator routes require verified identity; the admin route also requires backend authorization.

## Boundaries

- `index.html`, `styles.css`: accessible page shell and Spinarium-only responsive design.
- `app.js`: authentication, routing, view state and interaction composition.
- `auth/supabase-auth.js`: Supabase REST authentication, confirmation, recovery and memory-only sessions. Reload requires signing in again.
- `config.js`: public project configuration only; secret/service-role keys are prohibited.
- `data/supabase-service.js`: authenticated collection reads and protected catalog editing. Missing or invalid backend responses fail visibly rather than substituting a demo collection.
- `components/`, `domain/`: reusable safe DOM rendering, collection queries and API projections.
- `data/demo-service.js`: isolated historical fixture used by domain verification; never imported by the public application.
- `../supabase/spinarium-schema.sql`: dedicated-project profiles, catalog, ownership read restrictions, private artwork, administrator allowlist and audit foundation. This file does not mean a hosted database has been installed.
- `../docs/SPINARIUM-ARCHITECTURE.md`: broader service and domain direction.

The protected Admin Studio can add/edit Veiling names, descriptions, publication status, optional character numbers, edition/rarity labels and artwork once the backend is connected. Catalog publication never grants ownership. Admin rights are seeded through protected server-side SQL; no signup, browser flag or user metadata can grant them. Internal InvoHub remains separate.

Physical-card registration, transfers, notifications, 3D viewing, production automation and game systems remain unavailable. Registration input/submission stays disabled; there is no simulated claim success or browser ownership write.

## Verify

```sh
node scripts/verify-spinarium-domain.mjs
node scripts/verify-spinarium-auth.mjs
npm install --prefix /tmp/spinarium-db-check --no-audit --no-fund @electric-sql/pglite@0.5.8
SPINARIUM_PGLITE_MODULE=/tmp/spinarium-db-check/node_modules/@electric-sql/pglite/dist/index.js node scripts/verify-spinarium-backend.mjs
NODE_PATH=/tmp/spindown-qa/node_modules BROWSER_PATH=/usr/bin/chromium node scripts/verify-spinarium.cjs
```

Browser verification requires a served repository root and Playwright/axe-core installed outside the repository. `BASE_URL`, `BROWSER_PATH` and `SCREENSHOT_DIR` select the site, browser and optional screenshots. Mock provider/database responses exist only in the test harness. Hosted identity, email delivery and RLS settings require separate real-project validation before activation.

GitHub Pages deploys the repository root from `main`. A merge publishes static UI changes; it cannot install Supabase schema or activate account infrastructure.
