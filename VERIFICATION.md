# Website and Spinarium verification

## Production activation — 2 October 2026, 17:30:54 UTC

Worker `spinarium-production` and its 43 public assets are active on route `spindowngames.com/*` (route ID `0689578f458d4124809042de5d84fe40`), backed by D1 `spinarium-production` (`ce02e866-1b5b-4495-bf8b-38719a47b344`) with both migrations and the ledger applied. Generated production configuration disables preview and enables `/api` password signup; no administrator or ownership grant was created.

All four apex A records are proxied while retaining their original GitHub Pages IP values. `www` stays a DNS-only CNAME, and Pages/CNAME remain for rollback. Always Use HTTPS is enabled; active Full SSL is unchanged. Initial stale-DNS requests reached Pages before propagation; fresh health returned HTTP 200 with accounts enabled and claims disabled.

Completed actual hosted checks:

- Production API checks passed 13 requests: signup/save/session/empty ownership; collector admin denial; wrong-origin logout denial; valid logout/revocation; normalized-email relogin returning the same account/profile; matching generic failures for wrong password and unknown account; Secure/HttpOnly/SameSite=Lax cookie and no-store responses.
- The original-site hosted browser suite passed all 29 checks. Thirteen served assets, including the existing hero artwork, matched repository bytes. Apex HTTP, `www` HTTP and `www` HTTPS returned 301 redirects to the HTTPS apex, which returned 200. Private backend/Git paths returned 404.
- Staging passed 14 actual account browser checks, including saved-account persistence, signup/login, mobile Menu and keyboard logout. Only the two specifically identified QA accounts were removed with identifier/email guards and no-admin/no-ownership checks; dependent credential/session rows cascaded. Staging users, credentials, sessions, ownership and administrators were verified empty afterward. The updated local Spinarium suite passed 57 checks; the direct Worker suite remains 40/40 and the adapter suite 18 checks.
- The reproducible enabled production asset package and production dry run passed locally; the dry run made no remote changes.

Final actual production account browser verification is still in progress. These API/original-site results do not assert that pending suite passed. Password reset is unavailable for all accounts; R2 artwork and claims remain disabled.

## Direct password accounts — 2 October 2026

The latest owner instruction superseded Auth0 setup and verified-email requirements. Direct Cloudflare signup/login now saves a normalized, unverified email-shaped identifier, profile and salted scrypt password hash in D1, while preserving Spinarium Home, Collection, Explore and the cinematic. R2 is not a signup/login prerequisite; password reset is unavailable for all accounts until email delivery and secure recovery are implemented.

Completed checks for this new implementation:

- The Worker suite passed 40/40 local tests: 11 direct-password tests, 18 retained legacy identity-provider tests, seven data/permission tests and four HTTP/router tests.
- `scripts/verify-spinarium-cloudflare.mjs` passed 18 adapter checks; `scripts/verify-spinarium.cjs` passed 56 local browser checks. These are local tests rather than hosted browser evidence.
- Staging is deployed with password provider, authentication and signup enabled. Migration `0002_password_accounts.sql` plus its index is applied. Generated static configuration enables `/api` signup and disables preview.
- An actual hosted staging signup returned HTTP 201; saved-profile, session and empty-dashboard reads worked against D1. The real browser signup/login/reload round trip is still in progress in this record.
- Production D1 `spinarium-production`, ID `ce02e866-1b5b-4495-bf8b-38719a47b344`, was created with foundation/password migrations and the migration ledger applied. It is empty. Production Worker/DNS activation is not yet verified in this record.

The repository frontend intentionally retains development preview defaults. Enabled staging/production assets are generated separately. Production-ready privacy/terms now describe direct credential handling, unverified identifiers, Cloudflare hosting, eight-hour sessions and unavailable recovery; they are prepared for the upcoming production asset bundle.

Prior foundation and staging results below preserve the earlier decisions and tests. Their Auth0 prerequisites and disabled deployment state are historical; they do not override the current direct-password implementation or establish production activation.

## Cloudflare migration foundation — 2 October 2026

The session inspected GitHub main at `a7e1dad` before preparing the isolated Worker backend and dormant frontend Cloudflare adapters. GitHub Pages, `CNAME`, live DNS and current artwork were preserved. At the end of the local foundation milestone, no Cloudflare Spinarium resources, Auth0 application/connection, real accounts, administrator grants or ownership had been created or deployed. The subsequent hosted staging deployment is recorded separately below.

Read-only hosted access checks confirmed that the Cloudflare plugin connector could list one account and the active `spindowngames.com` zone. D1 returned an empty database list. An unrelated contact-form Worker exists and was preserved. R2 returned error `10042`, requiring dashboard enablement. Wrangler 4.147.0 `whoami` reported “Not authenticated.” Successful connector access does not establish CLI credentials.

Completed local checks reported in this session:

- `scripts/verify.cjs`: all 29 original-site browser checks passed against the locally served site.
- `scripts/verify-spinarium-domain.mjs`, `scripts/verify-spinarium-auth.mjs` and `scripts/verify-spinarium-intro.mjs` passed. The Auth test covers the retained legacy Supabase adapter only.
- Worker types generation, TypeScript check and build passed. `npm audit --omit=dev` reported zero production dependency vulnerabilities.
- The combined Worker suite passed all 29 tests using local D1/R2 and a test-only signed OIDC issuer. Checks cover signature/issuer/audience/nonce/expiry, browser-bound and concurrent callback replay, verified-email registration, closed-registration bypass attempts, opaque sessions, revocation/CSRF, collector/admin isolation, protected artwork, stale revisions, immutable audit and rollback. The service-boundary admin-revocation race test uses actual local D1/R2 with a test-only intercepted upload.
- `scripts/verify-spinarium-cloudflare.mjs` passed all 16 isolated browser-adapter contract checks.
- `scripts/verify-spinarium.cjs` passed all 47 local browser checks, including the preserved preview/cinematic/reduced-motion behavior, empty collections, disabled claims, accessibility, cookie sessions, signup/error notices, CSRF logout, server-admin denial, owned card details, stale catalog revisions and form protection during saves. Account scenarios use test-only API fixtures, not hosted Auth0 or Cloudflare.
- Wrangler applied all 21 statements of the final D1 migration to a fresh local database and completed `deploy --dry-run`. These commands did not provision D1 or deploy a Worker remotely.

Auth0 Universal Login with email/password is selected. The backend requires a fixed database connection, PKCE S256, RS256 ID-token validation, verified email and server sessions; authentication/signup remain disabled. Prepared adapters do not activate hosted accounts. Remote login/signup/verification/reset, cookies, CSRF, permissions, R2 access, replacement hosting, DNS and TLS remain unverified. A health endpoint flag, local tests and a dry run are not hosted verification. Follow [the migration runbook](docs/SPINARIUM-CLOUDFLARE.md).

## Hosted staging deployment — 2 October 2026

After the owner explicitly requested making Spinarium live, authenticated Cloudflare connector writes provisioned staging infrastructure without changing production hosting or DNS:

- Created D1 `spinarium-staging`, ID `1cfc3d12-1047-4cb7-8448-a30aff02d3d0`, and applied `0001_foundation.sql` remotely. Remote inspection verified 10 application tables, two immutable-audit triggers and zero users, ownerships and administrators. The Wrangler `d1_migrations` ledger records the applied migration.
- Deployed Worker `spinarium-staging` from the tested `695b65a` bundle in [draft PR #3](https://github.com/CipherLogsPlus/SpinDownGames/pull/3), enabled its workers.dev hostname, and verified `https://spinarium-staging.cipherlogsplus.workers.dev/api/health` returned HTTP 200 through curl. Its response reports accounts disabled and claims disabled. Protected authentication routes returned 503 with accounts disabled. Remote settings confirm authentication/signup disabled, no client-secret or R2 binding, query redaction enabled and automatic invocation logs disabled. A Python user-agent request received Cloudflare error 1010; the successful curl probe is not a browser test.
- Deployed the staging static site through Cloudflare's direct asset upload API with 43 public assets; `_headers` is applied through asset metadata. Generated staging config has `previewEnabled: false`, `apiBase: ""`, `signupEnabled: false`. Production GitHub Pages, `CNAME`, DNS and artwork remain preserved.
- The original website's 29 browser checks passed against the hosted staging origin. The environment's session proxy was also supplied to Playwright's Node request path for fallback tests; no repository runner change was required.
- All 29 direct hosted Spinarium smoke checks passed without API fixtures: disabled account entry, actual health/protected API responses, private source/config probes returning 404, current artwork/fonts/styles, mobile/desktop accessibility, layouts at 100%/200% text, and noindex headers. These checks did not perform an Auth0 login.
- Follow-up local verification passed all 49 Spinarium browser checks, including real-mode first-entry/reentry/reduced-motion cinematic behavior with test-only account fixtures, and all 16 adapter contracts after correcting duplicate-number error parsing. Staging packaging and its deployment dry run passed. Privacy/terms updates passed local accessibility and mobile checks and were uploaded to staging.
- R2 still returns error `10042`; no artwork bucket exists. Auth0 application/connection/secret remain unconfigured, and no real accounts or owner allowlist membership exist. Authentication/signup/claims remain disabled. Auth0 also requires a supported external production email sender before public verification/reset activation.

These are actual remote D1, static-hosting and disabled-Worker checks, distinct from the local test results above. They do not verify hosted OIDC signup/login/verification/reset, authenticated sessions/CSRF, administrator/collector isolation, private R2 artwork or production cutover. The [activation handoff](docs/SPINARIUM-ACTIVATION.md) and [migration guide](docs/SPINARIUM-CLOUDFLARE.md#auth0-emailpassword-setup) provide the exact staging URLs and direct dashboard secret setup; secrets must never enter chat.

Earlier results below record previous website releases. They do not establish verification of the new Cloudflare backend or account activation.

## Earlier website verification — September 26, 2026

## Privacy Policy and Website Terms

Added `privacy.html` and `terms.html` with shared branding, a dedicated reading stylesheet, homepage footer links, cross-links, and a return-home link. The policies describe the current informational website and use the supplied Discord/Instagram contact channels; the owner confirmed there is no business email yet.

- Reviewed both page texts against the existing code and GitHub’s published Pages logging disclosure. No registered entity, address, email, guaranteed retention period, sales conditions, or mandatory dispute forum was assumed.
- Both pages passed automated accessibility checks at 390px and 1440px and fit at 320, 390, 768, and 1440px with 100% and 200% text.
- All local links returned HTTP 200. Navigation from the homepage footer to each policy, between policies, and back home worked with JavaScript disabled.
- The policy pages load no JavaScript, set no cookies or browser-storage entries in the local browser check, and make no third-party runtime requests. No page errors occurred.
- The full existing `scripts/verify.cjs` suite passed after updating its navigation check for the two internal policy links. Desktop and mobile policy screenshots were reviewed.

## Trainer’s Bazaar next event

Added the owner-supplied October 17–18, 2026 show at Scene75 in Brunswick as the next event. The event card includes separate Saturday/Sunday hours, the address, free admission, and the flyer’s main attractions and presenters. The unchanged flyer opens in a native disclosure. The September 19 event remains intact inside a separate past-event disclosure.

- The dates and hours match the supplied flyer and the [2026 event listing](https://www.tcdb.com/CardShows.cfm?ID=32373&MODE=VIEW&VIEW=Calendar).
- Reviewed desktop and mobile event screenshots; verified that the flyer loads at its original dimensions.
- All checks in `scripts/verify.cjs` passed, including layouts from 320–1920px at 100%/200% text, keyboard navigation, archive expansion, both accessibility scans, dice/coin interactions, and no-JavaScript/rendering fallbacks.
- Additional checks confirmed the old event’s text is preserved and the expanded flyer plus archive fit at 200% text on 320, 390, 768, and 1440px viewports.
- Existing social destinations are unchanged. No event registration, table booking, organizer contact, or invented booth details were added.

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
