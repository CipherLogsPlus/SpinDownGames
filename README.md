# SpinDownGames

The public SpinDownGames website: trading cards, events, and competitive TCG gaming. A blue-and-black design with real Pokémon, Magic: The Gathering, and Yu-Gi-Oh! card images, Instagram calls to action, a Discord community link, an interactive D6/D20 roller, and the existing SpinDownGames 3D coin.

Live site: <https://cipherlogsplus.github.io/SpinDownGames/>

## Run locally

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://localhost:8000>. No install, build, account, database, third-party CDN, or runtime dependency is needed. Use an HTTP server so the coin model can load. All assets and fonts are self-hosted. The site remains navigable without JavaScript; the coin has a still-image fallback, and the dice roller explains that JavaScript is required.

## Files

- `index.html`: page content, social metadata, and semantic Cards, Events, Play, Teams, and Contact sections.
- `styles.css`: design, responsive layouts, keyboard focus, and reduced-motion rules.
- `script.js`: mobile navigation and D6/D20 rolls with the last five results, held only in page memory.
- `coin-viewer.js`: the supplied WebGL coin viewer, now loaded as visitors approach its section.
- `assets/cards/*.webp`: actual Goldspan Dragon, Pikachu, and Blue-Eyes Alternative White Dragon card images, arranged in CSS. The selections are for display, not inventory listings.
- `assets/brand.webp`: optimized copy of the existing logo. `brand-original.jpg` preserves the upload extracted from the old page.
- `assets/coin.glb` and `assets/coin-poster.webp`: existing coin geometry and still preview.
- `assets/fonts/`: Anton and DM Sans, distributed with their SIL Open Font Licenses.
- `scripts/verify.cjs`: browser checks for interactions, responsive layout, accessibility, and fallbacks.
- `ARTWORK.md`: card selections, source links, printed credits, and asset provenance.

## Content and publishing

The "Talk cards with us" collector card, "Be part of the conversation" team link, and bottom Contact button use the owner-supplied Discord invite: <https://discord.gg/CK7rKFJVPX>. All other social calls to action retain the confirmed Instagram address: <https://www.instagram.com/spindowngamingco/>. Inventory and team details are still coming soon. Do not add unconfirmed prices, products, dates, locations, affiliations, or contact details.

The next event is **Trainer’s Bazaar Pokémon & TCG Trade Show**, October 17–18, 2026 at Scene75, 3688 Center Road, Brunswick, OH 44212. Saturday hours are 10 AM–6 PM; Sunday hours are 10 AM–4 PM. Admission is free. Details come from the owner-supplied flyer; the year and schedule are corroborated by the [event listing](https://www.tcdb.com/CardShows.cfm?ID=32373&MODE=VIEW&VIEW=Calendar). The unchanged flyer is available in an expandable panel and is served locally from `assets/events/trainers-bazaar-october-2026.jpg`.

The September 19, 2026 Hydro Car, Card & Vendor Show is retained as a **past event**, with its original booth ideas inside an expandable archive. Those ideas are not current offers or claims about activities that actually occurred. Review and archive events after their exact dates rather than using an evergreen “this Saturday” label.

GitHub Pages publishes `main` from the repository root. Pushing to that branch deploys the site; verify the matching Pages build and public assets before calling a release live. This repository is separate from InvoHub and has no connection to private inventory or authentication.

## Coin interaction

The optimized 3.69 MB GLB is fetched only when the visitor comes within 300 pixels of the coin. Autoplay turns around the vertical axis once every 20 seconds. Drag horizontally to turn; a mouse can tilt vertically. On the focused canvas, arrows rotate, Home resets, and Space toggles autoplay. The visible button also starts/stops rotation. Reduced-motion visitors begin paused; scrolling out of view or hiding the tab pauses rendering.

The supplied STL geometry and silver presentation are retained. The custom GLB reader supports the existing single, uncompressed indexed mesh, not arbitrary glTF scenes. Keep the original print STL private and out of this repository. The website GLB is publicly downloadable.

## Browser verification

Use Node 20+ with Playwright and axe-core available. For an isolated test setup that leaves the public site dependency-free:

```sh
npm install --prefix /tmp/spindown-qa --no-audit --no-fund playwright axe-core
node /tmp/spindown-qa/node_modules/playwright/cli.js install chromium
NODE_PATH=/tmp/spindown-qa/node_modules node scripts/verify.cjs
```

Optional environment variables:

- `BASE_URL`: local or deployed website URL (default `http://127.0.0.1:8000`).
- `BROWSER_PATH`: an existing Chrome/Chromium executable; otherwise Playwright uses its installed browser.
- `SCREENSHOT_DIR`: save desktop/mobile full-page and hero screenshots to this directory.

Checks cover widths 320–1920px at normal and 200% text, mobile keyboard navigation, event archive, deterministic dice endpoints, roll history, repeated-click protection, coin controls, deferred model loading, missing WebGL/model, JavaScript-disabled fallbacks, broken assets, external link safety, and automated WCAG 2.1 AA rules. Automated checks complement manual visual review; they do not establish complete accessibility conformance.
