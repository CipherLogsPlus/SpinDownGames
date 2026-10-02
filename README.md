# SpinDownGames™

The public SpinDownGames™ website: trading cards, events, and competitive TCG gaming. A blue-and-black design with real Pokémon, Magic: The Gathering, and Yu-Gi-Oh! card images, Instagram calls to action, a Discord community link, an interactive D6/D20 roller, and the existing SpinDownGames™ 3D coin.

Live site: <https://spindowngames.com/>

## Brand name

Use **SpinDownGames™** in website copy, page titles, sharing metadata, and public labels. The header and footer wordmarks place a small superscript **™** after GAMES. Keep this convention when adding new pages or branded text. Domain names, URLs, social handles, repository names, and file paths keep their existing spelling.

## Run locally

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://localhost:8000>. No install, build, account, database, third-party CDN, or runtime dependency is needed. Use an HTTP server so the coin model can load. All assets and fonts are self-hosted. The site remains navigable without JavaScript; the coin has a still-image fallback, and the dice roller explains that JavaScript is required.

## Files

- `index.html`: page content, social metadata, and semantic Cards, Events, Play, Teams, and Contact sections.
- `styles.css`: design, responsive layouts, keyboard focus, and reduced-motion rules.
- `privacy.html` and `terms.html`: public Privacy Policy and Website Terms, linked from every page’s footer.
- `legal.css`: readable policy-page typography and layout; policy pages require no JavaScript.
- `script.js`: mobile navigation, automatic event directions links, and D6/D20 rolls with the last five results, held only in page memory.
- `coin-viewer.js`: the supplied WebGL coin viewer, now loaded as visitors approach its section.
- `assets/cards/*.webp`: actual Goldspan Dragon, Pikachu, and Blue-Eyes Alternative White Dragon card images, arranged in CSS. The selections are for display, not inventory listings.
- `assets/brand.webp`: optimized copy of the existing logo. `brand-original.jpg` preserves the upload extracted from the old page.
- `assets/coin.glb` and `assets/coin-poster.webp`: existing coin geometry and still preview.
- `assets/fonts/`: Anton and DM Sans, distributed with their SIL Open Font Licenses.
- `scripts/verify.cjs`: browser checks for interactions, responsive layout, accessibility, and fallbacks.
- `spinarium/`: separate cinematic collection area at `/spinarium/`, with reusable native modules, an explicit empty development preview (`admin` / `1234`) in repository configuration, plain black slots, and disabled physical-card registration. Preview access is not real authentication or administrator authority. The homepage's **View Spinarium** button is its entry point.
- `cloudflare/spinarium-worker/`: isolated Worker backend foundation with D1-native migrations, direct email/password authentication and server sessions, protected collector/admin APIs, and private R2 artwork. The production Worker/static site and dedicated D1 database are active. Direct signup/login and saved-data APIs passed hosted checks; final production browser verification is in progress. Private R2 artwork remains unconfigured; GitHub Pages and original DNS values remain available for rollback.
- `docs/SPINARIUM-ACTIVATION.md`: current account activation status: direct Cloudflare signup/login, unverified identifiers, saved D1 records, no provider dashboard setup, and unavailable password recovery.
- `docs/SPINARIUM-CLOUDFLARE.md`: the selected Cloudflare platform, actually verified connector/CLI access, and incremental staging/hosting migration gates. Retained Supabase adapters/schema and historical setup documents are superseded unused groundwork.
- `docs/SPINARIUM-ARCHITECTURE.md`: Spinarium service boundary, domain relationships, and requirements for future authenticated ownership and secure claiming.
- `assets/spinarium/`: replaceable original concept artwork with provenance; these images and the sample lore are not finalized canon.
- `scripts/verify-spinarium-domain.mjs` and `scripts/verify-spinarium.cjs`: Spinarium domain/browser checks and original-site preservation checks. See `spinarium/README.md` for setup.
- `ARTWORK.md`: card selections, source links, printed credits, and asset provenance.

## Content and publishing

The "Talk cards with us" collector card, "Be part of the conversation" team link, and bottom Contact button use the owner-supplied Discord invite: <https://discord.gg/CK7rKFJVPX>. All other social calls to action retain the confirmed Instagram address: <https://www.instagram.com/spindowngamingco/>. Inventory and team details are still coming soon. Do not add unconfirmed prices, products, dates, locations, affiliations, or contact details.

The next event is **Trainer’s Bazaar Pokémon & TCG Trade Show**, October 17–18, 2026 at Scene75, 3688 Center Road, Brunswick, OH 44212. Saturday hours are 10 AM–6 PM; Sunday hours are 10 AM–4 PM. Admission is free. Details come from the owner-supplied flyer; the year and schedule are corroborated by the [event listing](https://www.tcdb.com/CardShows.cfm?ID=32373&MODE=VIEW&VIEW=Calendar). The unchanged flyer is available in an expandable panel and is served locally from `assets/events/trainers-bazaar-october-2026.jpg`.

Every event’s **Get directions** button is generated from its displayed street address when the page loads. It opens Google Maps; the origin and travel mode are left to the visitor. The website has no embedded map, Maps API key, or location permission request.

When adding or updating an event, use this location markup inside its `.event-card` and fill in the confirmed venue and full postal address. No separate Maps URL needs updating. The same behavior applies to upcoming and archived events. Missing or empty addresses get no directions button; without JavaScript, the address remains readable.

```html
<span class="event-location">
  <strong>Venue name</strong><br />
  <span class="event-address">Street address · City, State ZIP</span>
</span>
```

The September 19, 2026 Hydro Car, Card & Vendor Show is retained as a **past event**, with its original booth ideas inside an expandable archive. Those ideas are not current offers or claims about activities that actually occurred. Review and archive events after their exact dates rather than using an evergreen “this Saturday” label.

Cloudflare Worker `spinarium-production` serves the apex website and `/api/` accounts. GitHub Pages still publishes `main` from the repository root as fallback; pushing there does not deploy the production Worker. Use the separately generated production assets/configuration and verify the actual Worker revision after deployment. This repository is separate from InvoHub and has no connection to private inventory or authentication.

Cloudflare Workers, D1 and R2 are the selected replacement infrastructure. Keep the existing Pages configuration, `CNAME` and original DNS values for rollback until the complete replacement site and backend have passed hosted checks. The isolated backend package does not deploy through a Pages push. Direct password accounts were activated on October 2, 2026 at 17:30:54 UTC. Hosted API and original-site checks passed; final production browser checks are in progress. Claims and administrator grants remain inactive; repository preview access creates no ownership.

### Custom domain

`CNAME` preserves the GitHub Pages fallback domain `spindowngames.com`. Keep this file and the Pages deployment for rollback. Canonical URLs and share metadata use `https://spindowngames.com/`; page, stylesheet, script, and asset links remain relative so they work at the domain root.

Cloudflare manages DNS. The four apex A records are now **Proxied** (orange cloud), routing `spindowngames.com/*` to the production Worker while retaining the original GitHub Pages IP values. `www` remains **DNS only** (gray cloud). TTL remains Auto; Always Use HTTPS is enabled and the active Full SSL mode is unchanged. These retained origin values support rollback:

| Type | Name | Content |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | cipherlogsplus.github.io |

Do not turn the live apex records gray as part of routine edits. For a deliberate rollback, preserve D1 account/session data, restore the original site through the retained Pages origin, and follow [the deployment/rollback guide](docs/SPINARIUM-CLOUDFLARE.md). Keep the GitHub domain-verification TXT record and Pages HTTPS configuration. The original [GitHub custom-domain instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) describe fallback setup.

## Website policies

The policies describe the informational site, hosting, browser-only dice history, links to external platforms and the active direct credential service, including saved email-shaped identifiers/password hashes and unavailable recovery. Contact uses the existing Instagram and Discord channels because no business email has been supplied. No registered entity name, postal address, retention deadline, governing jurisdiction, arbitration clause, or checkout/refund policy has been invented.

Keep these pages aligned with actual practices. Revisit them before adding accounts, analytics, contact forms, newsletters, a shop, different hosting, or new data-sharing practices. Business-wide privacy duties and any future sales terms need a separate review of the relevant business details; publishing these pages is not a legal-compliance certification.

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

Checks cover widths 320–1920px at normal and 200% text, mobile keyboard navigation, event archive, directions for existing and newly added event addresses, deterministic dice endpoints, roll history, repeated-click protection, coin controls, deferred model loading, missing WebGL/model, JavaScript-disabled fallbacks, broken assets, external link safety, and automated WCAG 2.1 AA rules. Automated checks complement manual visual review; they do not establish complete accessibility conformance.
