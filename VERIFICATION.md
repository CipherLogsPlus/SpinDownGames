# Website verification — September 26, 2026

## Collector card Discord link

Changed the "One more for the binder / Talk cards with us" card to the same owner-supplied Discord invite as the bottom Contact button. Its screen-reader destination now says Discord; the visible card content and appearance are unchanged.

- Compared all 19 anchors against the preceding release: only the collector card changed. The bottom Discord link and all four remaining Instagram links are retained.
- Tapped the visible "Talk cards with us" text in a mobile browser check and confirmed the new tab requested <https://discord.gg/CK7rKFJVPX>.
- Retained safe new-tab attributes and updated the existing external-link assertion to include the collector card. JavaScript syntax and diff checks passed.

## Discord contact update

The bottom "Want to talk TCGs?" section now links to the owner-supplied invite, <https://discord.gg/CK7rKFJVPX>, with a "Join us on Discord" button and community label. Discord's public invite endpoint returned HTTP 200 for the SpinDown Games server, with no expiration listed, at verification time.

- Compared all 19 anchors against the preceding release: only the bottom contact destination changed; all five other Instagram links and every anchor's new-tab attributes are retained.
- Visually reviewed the mobile contact section and verified keyboard focus, the exact invite URL, and a touch target exceeding 44 by 44 pixels.
- Updated the existing external-link check for the specific Discord destination. All checks in `scripts/verify.cjs` passed, including responsive layouts, accessibility, interactions, and fallbacks.

## Blue theme update

Changed the purple and lavender interface accents to blue, including panels, focus states, the favicon, and the coin's accent lighting. The real card images, supplied logo, page layout, and interactions are retained. Versioned stylesheet, favicon, and coin-script URLs refresh the changed assets for returning visitors.

- Visually reviewed desktop and mobile screenshots.
- Re-ran `scripts/verify.cjs`: all checks passed, including responsive layouts at normal and 200% text, navigation, dice, coin, no-JavaScript and rendering fallbacks, and both automated accessibility scans.
- Compared all 19 anchors against the prior version: every destination and attribute is unchanged, including all six Instagram links.
- At this release, the bottom contact button's Discord destination was pending the owner's invite URL; it is supplied in the subsequent update above.

## Real-card hero update

Replaced the generated fantasy hero with actual Goldspan Dragon, Pikachu, and Blue-Eyes Alternative White Dragon images. Pikachu is centered, with Magic on the left and Yu-Gi-Oh! on the right. Source details and printing references are in `ARTWORK.md`. The previous generated files were removed from the current tree, and the social preview uses the existing logo.

- Visually reviewed desktop and mobile card layouts and verified all three card files load.
- Re-ran `scripts/verify.cjs`: all checks passed, including 320–1920px layouts at normal and 200% text, both accessibility scans, navigation, dice, coin, and fallback behavior.
- Verified the versioned stylesheet URL returns HTTP 200, so returning visitors can load the updated card layout.
- No JavaScript behavior, private inventory, or hosting configuration changed.

## Initial redesign verification

Validated the final public-site redesign locally using Chromium 148, Playwright, and axe-core. `scripts/verify.cjs` completed with all checks passing.

- Layouts at 320, 360, 390, 768, 1024, 1440, and 1920 pixels fit without horizontal overflow at 100% and 200% text size.
- Mobile menu opens, closes with Escape, restores keyboard focus, and navigates to the selected section.
- All internal navigation targets exist. Outbound calls to action use the confirmed Instagram URL with safe new-tab attributes.
- Past-event plans expand and collapse. The expired “This Saturday” promotion is gone.
- Controlled D20/D6 endpoint rolls, result announcements, the five-roll history limit, reduced motion, and repeated-click protection passed.
- The coin model is deferred until the visitor approaches. Rotation, pause, keyboard controls, and reduced-motion behavior passed.
- JavaScript-disabled navigation, expandable event content, coin poster, unavailable WebGL, and missing-model fallbacks passed.
- Automated WCAG 2.1 AA scans reported zero violations at 390px and 1440px. These checks do not replace a complete human accessibility audit.
- No JavaScript page errors or failed runtime asset requests occurred. All runtime resources are served from the site itself.
- Desktop and mobile screenshots were visually reviewed, including the original logo, generated hero, event archive, dice panel, and loaded coin.
- JavaScript syntax and `git diff --check` passed.

The existing HTML was 5,258,351 bytes because assets were embedded. The redesigned HTML is 21,329 bytes. The initial desktop resource files total roughly 793 KB before transport compression, excluding the deferred coin model. These are file-size measurements, not a network-speed benchmark or Core Web Vitals score.

The source STL was not added. Existing coin geometry and its poster are unchanged. InvoHub and other repositories were not modified.
