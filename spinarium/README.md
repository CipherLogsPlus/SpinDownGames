# Spinarium first milestone

Spinarium lives at `/spinarium/` inside the existing static SpinDownGames™ site. The original site has one additive homepage link; it retains its existing design, content, scripts, assets, policies, and GitHub Pages configuration.

No build step or runtime dependency is required. Serve the repository root:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/spinarium/`. Hash routes work directly on GitHub Pages, including `/spinarium/#collection`, `#achievements`, `#discoveries`, `#collections`, `#events`, `#news`, `#transfers`, and `#settings`. Collection selection updates the detail panel; mobile revealed-card selection opens a native accessible detail dialog.

## Boundaries

- `index.html`: semantic page shell, navigation, forms, dialogs, and a JavaScript-disabled explanation.
- `styles.css`: Spinarium-only responsive design, focus and reduced-motion rules.
- `app.js`: service selection, UI state, routing and interaction orchestration.
- `components/`: reusable safe DOM rendering and trusted icons.
- `domain/`: collection queries, view projections, and documented data types.
- `data/demo-service.js`: isolated, read-only, structured sample API data. Components do not import it. Replace the adapter in `app.js` when an authenticated backend is ready.
- `../assets/spinarium/`: replaceable original concept artwork, with provenance and non-canonical status documented beside it.
- `../docs/SPINARIUM-ARCHITECTURE.md`: backend boundary, domain relationships, identity and claim-security requirements.

The preview shows ten sample Veilings: five owned, six globally revealed, four undiscovered. Stats derive from those records. Artwork, lore, sample serials, rarity assignments and ownership dates are not product commitments. Undiscovered records contain no concealed names, lore, or color-art URLs. The events panel links to the existing confirmed Trainer’s Bazaar event.

Accounts, claiming, transfers, notifications and 3D viewing are unavailable. Registration explains the eventual flow; its code field and submission button are disabled. There are no claim requests, claim secrets, ownership writes, credential storage, or simulated successful registrations. The preview creates no account or persistent collection data.

Replacing the read adapter also requires validated live responses, authenticated profile/preview UI, and explicitly implemented action handlers. A server capability flag alone must never enable an unfinished claim, transfer, notification, or 3D action. Registration stays disabled until the secure backend and its full client flow exist.

Desktop and mobile review images are in [docs/screenshots](../docs/screenshots/).

## Verification

```sh
node scripts/verify-spinarium-domain.mjs
npm install --prefix /tmp/spindown-qa --no-audit --no-fund playwright axe-core
node /tmp/spindown-qa/node_modules/playwright/cli.js install chromium
NODE_PATH=/tmp/spindown-qa/node_modules node scripts/verify-spinarium.cjs
```

Use `BROWSER_PATH` for an existing Chromium executable; `BASE_URL` and `SCREENSHOT_DIR` select the served site and optional screenshots. Browser verification covers source preservation, search/filter/sort, selection, dialogs, hash routes, disabled registration, mobile navigation, responsive layout, self-hosted assets and automated accessibility checks. Automated checks do not establish complete accessibility conformance.

GitHub Pages currently deploys the repository root from `main`. Review this feature branch before merging; a merge to `main` publishes it. A secure backend and updated practices/policies are required before enabling collector accounts or registrations.
