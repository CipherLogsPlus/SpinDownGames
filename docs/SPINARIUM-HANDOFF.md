# Spinarium handoff — 1 October 2026

This file preserves the project context for a new Codex chat. It is repository documentation, not a promise that a new chat has conversation memory or Supabase access. Inspect the latest GitHub `main`, deployment status and working tree before continuing; preserve any uncommitted work.

## Project and owner instructions

- Repository: `CipherLogsPlus/SpinDownGames`; live website: <https://spindowngames.com/>; Spinarium: <https://spindowngames.com/spinarium/>.
- The existing site is static HTML/CSS/browser JavaScript on GitHub Pages, publishing the repository root from `main`. Keep that infrastructure. Preserve all original pages, products, content, branding, assets and policies. The existing homepage has an additive **View Spinarium** entry button.
- Spinarium is the companion to premium engraved metal cards called **Veilings**, with digital artwork, lore, ownership, discovery and achievements. A future game is optional and must not be required for collecting to work.
- The supplied visual reference is a dark cinematic fantasy dashboard: top navigation, left sidebar, castle/mountain hero, elegant serif title/names, muted cyan/silver borders, five-column desktop collection, selected-detail panel, responsive mobile layout. Use actual components, not a screenshot background.
- The owner corrected the first preview: **no demo characters on the live page**. Every new collector starts with zero ownership. Undiscovered/empty cards must be **fully black**, without silhouettes, names, numbers or fake artwork. Do not grant sample cards.
- Clicking View Spinarium must enter **login/sign-up first**. These must use actual provider authentication, never browser flags or fake successful account creation.
- The owner needs a protected administrator account to create/edit Veiling artwork and descriptions. Creating a catalog character makes it available to the system; it does not give it to every collector. Administrator rights must be granted through a trusted backend, never signup metadata or a first-user shortcut.
- The owner authorized publishing Spinarium and its requested corrections. Preserve the original website and verify changes before deployment. Do not invent a working backend because the interface looks complete.

## Code and completed foundation

The first dashboard milestone was merged in [PR #1](https://github.com/CipherLogsPlus/SpinDownGames/pull/1). This handoff accompanies its account/empty-collection correction.

- `spinarium/index.html`, `styles.css`, `app.js`: account-gated page, login/signup/reset UI, responsive dashboard, plain black empty slots, protected catalog editor and honest disabled physical registration.
- `spinarium/auth/supabase-auth.js`: real Supabase REST authentication, provider-verified confirmed identities, email confirmation/recovery, sanitized errors, expiry and logout. Tokens stay only in memory; reload requires signing in again. Callback secrets are removed from the URL before requests.
- `spinarium/data/supabase-service.js`: authenticated versioned collection RPC, backend administrator check, protected catalog writes and private artwork uploads/signing. No claim, delete or ownership-grant method.
- `spinarium/domain/` and `components/`: separate domain queries/API types and safe text-node rendering. Counts derive from ownership, not black decorative slots.
- `spinarium/data/demo-service.js` and old concept assets are historical fixtures only. The public application never imports the demonstration service or requests character/silhouette concept assets.
- `supabase/spinarium-schema.sql`: **not yet applied to a hosted project**. Dedicated-project profile/catalog/ownership-read/discovery foundation, private artwork, explicit administrator allowlist, RLS and immutable catalog audit. No client can grant ownership, including the catalog administrator. Manual role grants and future ownership issuance need a separate immutable audit/provenance extension. `draft` is descriptive for an already-owned definition; a later workflow needs versioned approved content and unpublished revisions.
- `spinarium/config.js`: **both public configuration values are empty**. Forms deliberately stay unavailable; no real account can be created through the live page until activation.
- Current account-entry review images: `docs/screenshots/spinarium-signin-desktop.png` and `spinarium-signin-mobile.png`. Older dashboard images document the historical sample preview, not live user ownership.

## Supabase access blocker

The owner installed/connected the **Supabase plugin**. Plugin search confirmed it was installed, but this chat had **no callable Supabase project tools**. A normal CLI project-list check also reported no access token. Installation alone did not verify account access.

**First action in the new chat:** discover the actually available Supabase tools, then list projects read-only and verify authenticated account/project access. A fresh chat may load the connection, but this is not guaranteed. Do not claim project access until a real request succeeds. Do not ask the owner to post service-role keys, database passwords or personal access tokens.

The owner believes an **InvoHub** project already exists in their Supabase account. Its hosted project identity was not verified. The private GitHub repository `CipherLogsPlus/InvoHub` was inspected read-only at `/workspace/InvoHub-inspect`. It uses React 19, TypeScript 5.9, Vite 7 and supabase-js; ordinary checked-in configuration has no hosted project URL or public key. This does **not** prove the hosted project does not exist.

**Use a separate Spinarium Supabase project under the same account. Do not enable public collector signup in InvoHub.** A real isolated database test of InvoHub's existing migrations confirmed a fail-open administrator authorization check: an absent role can bypass `NOT IN`, and an unprivileged user could promote itself through `manage_user`. Several permission checks also need NULL-safe rejection. No hosted InvoHub data or code was changed. Its repair is a separate security task; do not silently modify it while installing Spinarium.

## Next work, in order

1. Verify Supabase account/project access. Inspect existing projects without changing InvoHub. Select or create the dedicated Spinarium project, confirming its identity and isolation before any schema write.
2. Read [account setup](SPINARIUM-ACCOUNTS.md), [admin setup](SPINARIUM-ADMIN.md), the SQL and [architecture](SPINARIUM-ARCHITECTURE.md). Review/install the schema only in a new dedicated project; its empty-public-schema guard intentionally rejects an existing populated database.
3. Configure confirmed-email authentication, server-enforced password policy, production confirmation/recovery sender, exact site/redirect URL `https://spindowngames.com/spinarium/` and provider abuse limits. Verify delivery with a real inbox.
4. Update the existing privacy/account terms accurately for the actual new account processing before activation. Fill `spinarium/config.js` with **only the project URL and public publishable key** after policies are installed and verified. Never put a secret/service-role key in GitHub Pages.
5. Create/confirm the owner's account and grant its verified user UUID administrator access through the protected server-side allowlist instructions. The owner has not supplied a verified account UUID; do not invent an admin identity.
6. Verify hosted behavior: new account sees zero owned Veilings and plain black cards; another collector's private data is inaccessible; normal users cannot administer or promote themselves; the allowlisted owner can add/edit content/artwork; catalog creation never grants ownership; logout/recovery/session expiry behave correctly. Local mock tests are not proof of hosted policies or email delivery.
7. Publish configuration only after real verification, then verify the matching GitHub Pages deployment and live original-site/Spinarium behavior.

Physical-card claiming remains a separate next milestone. Its token must be cryptographically random, non-sequential, one-use, securely hashed and linked server-side to one physical card. QR and human-readable code represent the same token; serial numbers do not derive it. Claims require atomic redemption, ownership and first-discovery rules plus configurable account/IP/device abuse controls. Failed attempts restrict claims temporarily, not the entire account. Never log plaintext claim secrets.

Do not implement transfers, production automation, randomized paid products, Warpling, manifestations, battles or game systems now. Do not mint ownership from the frontend. Legacy cards have no invented verification. InvoHub integration must later use a clean service/API boundary.

## Local verification and publishing notes

```sh
python3 -m http.server 8000 --bind 127.0.0.1
node scripts/verify-spinarium-domain.mjs
node scripts/verify-spinarium-auth.mjs
npm install --prefix /tmp/spinarium-db-check --no-audit --no-fund @electric-sql/pglite@0.5.8
SPINARIUM_PGLITE_MODULE=/tmp/spinarium-db-check/node_modules/@electric-sql/pglite/dist/index.js node scripts/verify-spinarium-backend.mjs
NODE_PATH=/tmp/spindown-qa/node_modules BROWSER_PATH=/usr/bin/chromium node scripts/verify-spinarium.cjs
NODE_PATH=/tmp/spindown-qa/node_modules BROWSER_PATH=/usr/bin/chromium node scripts/verify.cjs
```

Browser tests cover the account gate, no runtime demos, solid-black slots, direct-route/storage-tampering denial, verified empty accounts through test-only provider responses, administrator denial, disabled claims, responsive layouts and accessibility. Backend verification includes actual isolated SQL/RLS behavior as well as adapter contracts. Run the required checks on the final code; do not report hosted verification when only local checks ran.

GitHub access worked through the connector and authenticated `gh api`. Normal git push returned HTTP 401 in this session; REST Git blob/tree/commit/ref creation worked and verified the remote tree matched local files. `/tmp/publish-spinarium-branch.py` documents that workaround but contains the **old foundation branch name**; inspect/adapt it rather than running blindly. Git fetch and PR creation worked. Match the verified PR head when merging, wait for its Pages deployment and check the live page. Do not reset or delete existing repository work to publish.
