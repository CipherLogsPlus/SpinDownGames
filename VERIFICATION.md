# Redesign verification — September 26, 2026

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
