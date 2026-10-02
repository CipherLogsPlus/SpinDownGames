# Spinarium Cloudflare migration

Decision recorded 2 October 2026: Cloudflare Workers for backend APIs and server-side permissions, D1 for authoritative application data, and private R2 for artwork. The owner selected Auth0 Universal Login with email/password. Real account/signup activation requires verified OIDC authentication and server sessions. Supabase setup instructions are superseded; legacy adapters/schema remain preserved but unused.

The live static site remains on GitHub Pages with Cloudflare DNS. Preserve `CNAME`, the current Pages configuration, public asset paths and working DNS until replacement hosting has been verified. The isolated backend lives in `cloudflare/spinarium-worker/`. Following the owner's request to make it live, a dedicated staging D1 database and disabled Worker have now been deployed. R2 and Auth0 remain blocked; no production route or DNS cutover has occurred. The staging static site has also been deployed; hosted browser verification is pending.

## Access actually verified

Installing the plugin was not treated as account access. Tool discovery exposed `cloudflare_docs` (documentation search), `cloudflare_search` (OpenAPI schema search), and `cloudflare_execute` (Cloudflare API requests). The initial foundation used read-only requests rather than assuming installation granted access. After the owner authorized making it live, authenticated connector writes successfully created the staging D1 database, applied its migration and deployed a staging Worker. Initial discovery established:

| Check | Observed result | Limit |
| --- | --- | --- |
| Cloudflare account listing | One account returned successfully. | Establishes connector authentication for this request, not every permission or CLI identity. |
| Zone listing | `spindowngames.com` returned as active. | DNS hosting is present; no DNS record was changed. |
| Initial D1 database listing | Empty list before deployment work. | A dedicated staging database has since been created; see the current status below. |
| Existing Worker listing | An unrelated contact-form Worker exists. | Preserve it; it is not Spinarium infrastructure. |
| R2 bucket listing | Cloudflare error `10042` requests enabling R2 in the dashboard. | R2 account setup is a real prerequisite; no bucket was created. |

The cloud environment exposed no injected Cloudflare secrets or outbound Cloudflare identity. Connector authentication is separate from Wrangler authentication. Wrangler 4.147.0 `whoami` reported “Not authenticated.” Verify the current CLI identity before any CLI remote command; never infer CLI authorization from a successful connector request. Do not ask for API tokens or secrets in chat. Use interactive OAuth or the environment's secure credential configuration.

## Current staging deployment — 2 October 2026

- D1 `spinarium-staging` was created with ID `1cfc3d12-1047-4cb7-8448-a30aff02d3d0`. Migration `0001_foundation.sql` was applied remotely through the authenticated connector. Verification found 10 application tables, two immutable-audit triggers, and zero users, ownerships or administrators. The Wrangler `d1_migrations` ledger records the migration.
- Worker `spinarium-staging` was deployed using the tested `695b65a` bundle from [draft PR #3](https://github.com/CipherLogsPlus/SpinDownGames/pull/3). Its workers.dev hostname is <https://spinarium-staging.cipherlogsplus.workers.dev/>. Authentication and signup remain disabled.
- Hosted curl requests returned HTTP 200 from `/api/health` with `accountsEnabled: false` and `claimsEnabled: false`; protected authentication routes returned 503 with accounts disabled. Worker settings confirmed authentication/signup disabled, no client-secret or R2 binding, query redaction enabled and automatic invocation logs disabled. A Python user-agent request received Cloudflare error 1010. The successful health response verifies routing/configuration only; it does not verify login, permissions or artwork.
- The staging static site was deployed through Cloudflare's direct asset upload API: 43 public assets, with `_headers` applied through asset metadata. The generated staging configuration sets `previewEnabled: false`, `apiBase: ""` and `signupEnabled: false`, keeping the UI unavailable until secure accounts are connected. All 29 original-site browser checks and 29 direct hosted Spinarium smoke checks passed. Real Auth0 account flows remain unverified. The production site remains on GitHub Pages; its DNS and `CNAME` are preserved.
- R2 still returns error `10042`; no private artwork bucket exists. Auth0 application/connection/secret and a production email sender are still missing. No real account or ownership has been created.

The unchanged production DNS baseline is four unproxied apex A records (`185.199.108.153` through `185.199.111.153`) and an unproxied `www` CNAME to `cipherlogsplus.github.io`, all with automatic TTL. GitHub main remains `a7e1dad`. No production Worker route was added.

Continue from these actual resources; do not create a duplicate staging database or replay the initial migration blindly. Preserve the existing unrelated Worker and InvoHub.

## Local backend foundation

The backend uses a D1-native SQLite migration and Worker authorization rather than PostgreSQL policies. Authentication and signup default to disabled. The Auth0 regular web application uses RS256 ID tokens, `client_secret_basic`, advertised PKCE S256 and a fixed email/password database connection. Verified email is required before creating a collector/session. The Worker issues an opaque Secure, HttpOnly session cookie with an eight-hour lifetime; login/signup attempts expire after ten minutes. D1 session state and trusted administrator membership remain private behind Worker bindings.

Collector endpoints read the authenticated collector's own records. Administrator endpoints validate membership server-side, accept only catalog fields and append attributable audit records. Catalog writes never issue ownership. R2 artwork passes the same object-level permission checks; no public bucket is required. Claims, discovery awards, achievement awards, production operations and public role setters are absent or disabled.

The checked-in default `wrangler.jsonc` remains local preparation only: no account, production routes or domains, `workers_dev: false`, `preview_urls: false`, a sentinel all-zero D1 ID, local resource names, empty origin/issuer/client/connection, and disabled authentication/signup. Do not deploy it as a production configuration. The separate staging configuration records actual returned resource IDs; it does not change the local defaults.

From the repository root, local commands are:

```sh
cd cloudflare/spinarium-worker
npm ci
npm run types
npm run check
npm test
npm run db:migrate:local
npm run dry-run
```

`npm run dev` starts the local Worker. `npm run db:migrate:local` applies migrations only to Wrangler's local database; `npm run dry-run` bundles without deploying. None establishes remote D1/R2 or Auth0 behavior. See [VERIFICATION.md](../VERIFICATION.md) for completed checks. Do not run a remote deployment or migration using the local sentinel configuration.

| API | Permission and behavior |
| --- | --- |
| `GET /api/health` | Reports configuration flags; it is not a hosted authentication/readiness check. Claims always report disabled. |
| `GET /api/auth/login` | Begins Auth0 login with state/nonce, browser binding and PKCE. |
| `GET /api/auth/signup` | Begins Auth0 signup only when server signup is enabled; same fixed database connection and verified-email requirement. |
| `GET /api/auth/callback` | Consumes a valid one-time attempt and verified provider response; creates a server session and, only when signup is enabled, an empty collector. |
| `GET /api/auth/session` | Returns the current verified session projection and CSRF token, with no provider token. |
| `POST /api/auth/logout` | Revokes the application session with same-origin/CSRF protection. |
| `GET /api/dashboard` | Authenticated own-collection projection; non-draft definitions and server-controlled discovery redaction. |
| `GET /api/admin/access` | Checks the trusted allowlist; cannot change it. |
| `GET, POST /api/admin/veilings` | Allowlisted catalog read/create; creation never grants ownership. |
| `PATCH /api/admin/veilings/:id` | Allowlisted, CSRF-protected edit with a matching revision; auditable D1 write. |
| `POST /api/admin/veilings/:id/artwork` | Allowlisted, CSRF-protected upload/attachment with a matching revision. |
| `GET /api/artwork/:artworkId` | Administrator or authorized owner of the current non-draft, revealed asset; private no-store response. |

There is no claim, ownership issuance, discovery award, achievement award, production or authority mutation API.

## Auth0 email/password setup

Auth0 is selected; installing the Cloudflare plugin does not configure Auth0 or establish Auth0 account access. No Auth0 application or connection has been created by this work. For a short dashboard handoff, see [Activate Spinarium accounts](SPINARIUM-ACTIVATION.md). Complete these steps through the authenticated Auth0 dashboard and secure configuration; never paste a client secret into chat.

For the deployed staging Worker, use these exact public configuration values:

| Setting | Value |
| --- | --- |
| Auth0 Allowed Callback URL | `https://spinarium-staging.cipherlogsplus.workers.dev/api/auth/callback` |
| Auth0 Application Login URI / default login URL | `https://spinarium-staging.cipherlogsplus.workers.dev/spinarium/` |
| Worker `APP_ORIGIN` | `https://spinarium-staging.cipherlogsplus.workers.dev` |
| Worker `OIDC_ISSUER` | The HTTPS issuer from the actual Auth0 tenant discovery metadata. |
| Worker `OIDC_CLIENT_ID` | The Auth0 regular web application's client ID. |
| Worker `AUTH0_CONNECTION` | The selected email/password database connection **name**. |

To transfer the client secret safely, open Cloudflare **Workers & Pages → spinarium-staging → Settings → Variables and Secrets → Add**, select **Secret**, name it `OIDC_CLIENT_SECRET`, enter the Auth0 application's client secret directly, and select **Deploy**. Enter the public issuer/client/connection values as variables in the same Worker. Keep `AUTH_ENABLED` and `SIGNUP_ENABLED` false while configuration is checked. Do not put secrets in chat, repository files or browser configuration. [Cloudflare's secret instructions](https://developers.cloudflare.com/workers/configuration/secrets/) confirm secret values become hidden after being stored.

Auth0's built-in email sender can support staging checks but [does not support production use](https://auth0.com/docs/customize/email/smtp-email-providers). Production verification/password reset requires an external SMTP or supported email provider with a real sender and verified delivery. Auth0 account/dashboard setup, this sender, R2 enablement and real inbox verification remain the user-operated prerequisites; installing Cloudflare does not complete them.

1. Create a dedicated **Regular Web Application** for staging Spinarium. Use a separate production registration/configuration when production is verified. Set the application to OIDC authorization code with **RS256** ID-token signing and application credentials **Client Secret (Basic)** (`client_secret_basic`). Confirm this application-specific credential setting rather than relying on discovery's supported methods. Confirm the issuer discovery metadata advertises PKCE `S256`; the Worker rejects a provider without it.
2. Create or select a dedicated **Database** connection for email/password and enable it for this application. Record its exact **connection name**, not its connection ID, for `AUTH0_CONNECTION`. Enable only this connection on the application; disable every other database, social, enterprise and passwordless connection. The authorize request's `connection` parameter selects the UI route but can be changed by a requester, so it is not the security boundary. Verify the application connection configuration independently. Initially keep self-service signup disabled in the connection and Worker while preparing the application; enable it only on the isolated staging host for registration verification.
3. Set **Allowed Callback URLs** to the exact staging HTTPS origin followed by `/api/auth/callback`. Avoid wildcard callbacks. The Worker always redirects a completed login to that origin's `/spinarium/`. Register production callback URLs only for the actual production registration. Set the application/tenant **Default Login URL / Application Login URI** to the staging origin's `/spinarium/` landing page, rather than `/api/auth/login`: Auth0 verification/reset links may arrive cross-site, and direct cross-site authentication-entry requests are rejected by the backend. Ignore appended `iss` or other landing-page query values for identity/redirect authority; login comes from the fixed configured issuer. Local HTTP development does not verify secure hosted callbacks or cookies.
4. Configure provider-enforced password policy and applicable breached-password, brute-force/bot and signup protections. Configure a production email sender and verification/password-reset templates, then verify delivery to a real test inbox. Universal Login owns password entry, verification and its built-in reset flow; Spinarium never receives or stores the password. The callback rejects an unverified email before creating the D1 collector/session; sending a default verification email alone does not enforce verification. Universal Login uses the configured application/tenant default login route for reset/verification round trips; changing an email-template Redirect URL is not sufficient. Verify the actual link returns to the `/spinarium/` landing page and the visitor can begin login there.
5. In a separate staging Worker configuration set `APP_ORIGIN` to the exact HTTPS origin (no path), `OIDC_ISSUER` to the issuer from Auth0 discovery, `OIDC_CLIENT_ID` to the application client ID, and `AUTH0_CONNECTION` to the database connection name. Store `OIDC_CLIENT_SECRET` using secure Worker secret configuration. These are backend settings; no client secret goes into the public frontend.
6. After resources/configuration validation, enable `AUTH_ENABLED` only on isolated staging. Enable `SIGNUP_ENABLED` and the Auth0 connection's signup only for the registration checks, then verify fresh signup, unverified denial, verified login, password reset, rate limits and safe failure paths. With `SIGNUP_ENABLED: "false"`, an existing active D1 collector may sign in, but a login callback cannot create a new collector through the provider's signup screen. The production/repository preview remains enabled; the generated staging frontend has `previewEnabled: false`, `apiBase: ""`, `signupEnabled: false` and stays unavailable until hosted account setup is verified. For verified account UI activation use `apiBase: "/api"`, disable preview and deliberately enable signup in both layers. Claims stay disabled.

Auth0 reference: [default login routes](https://auth0.com/docs/authenticate/login/auth0-universal-login/configure-default-login-routes), [authorization code setup](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow/add-login-auth-code-flow), [Universal Login behavior](https://auth0.com/docs/authenticate/login/auth0-universal-login/universal-login-vs-classic-login/universal-experience), [application credentials](https://auth0.com/docs/get-started/applications/credentials), [connection configuration](https://auth0.com/docs/authenticate/connection-settings-best-practices) and [email verification](https://auth0.com/docs/manage-users/user-accounts/verify-emails).

Application logout currently revokes the Spinarium session and clears its cookie. Auth0's own login session may remain; verify the resulting next-login behavior and decide provider-wide logout policy before production activation. A password reset also does not automatically revoke existing eight-hour D1 application sessions; verify account lifecycle and trusted session revocation/disable procedures before activation. Do not describe application logout or password reset as revoking all sessions.

## Incremental staging runbook

1. **Keep the current release working.** Inspect the latest GitHub `main`, working tree and Pages deployment before remote changes. Record the existing DNS/Pages configuration so it can be restored. Preserve unrelated Workers and InvoHub. Never repurpose an existing database or project by assuming its name proves ownership.
2. **Verify the chosen Cloudflare account and permissions.** Repeat read-only account/zone checks through the intended tool, verify Wrangler separately if it will perform the work, and enable R2 through the Cloudflare dashboard when required. Confirm staging resource names and bindings are dedicated to Spinarium.
3. **Provision an isolated staging backend.** Create a staging D1 database and private R2 bucket, record their returned identifiers in staging configuration, and apply only the D1 migration. Do not copy the Supabase schema or enable public R2 access. Do not add a production `/api/` route yet.
4. **Configure Auth0 identity.** Follow the dashboard setup above for a dedicated regular web application and email/password database connection. Register the exact staging HTTPS callback and configure issuer, client ID, connection and required secret securely. Verify email delivery, verification, password reset, policy and provider abuse limits. Leave authentication/signup disabled until configuration is complete; no public collector UI activation follows automatically.
5. **Deploy and test staging.** Verify disabled endpoints first, then enable authentication on the isolated staging host and test actual login/callback/logout, replay/expiry, wrong issuer/audience, Secure/HttpOnly/SameSite cookie properties, session revocation and CSRF failures. Confirm fresh signup produces zero ownership. Independently verify non-admin denial, other-owner denial, trusted admin catalog/artwork operations, audit records and no ownership change from catalog creation. Verify R2 denial for unauthenticated and unowned requests. Do not treat mocked OIDC or local D1 tests as these checks.
6. **Verify the prepared frontend adapters.** Connect `auth/cloudflare-auth.js` and `data/cloudflare-service.js` through the existing boundary to the verified Worker APIs, preserve native modules and every existing page/asset path, and keep claims disabled. Real accounts require a deliberate UI transition from preview login to Auth0; gated signup must also pass verification/reset tests. Update existing privacy/account terms for the actual hosting, provider, cookies, processing and support before activation.
7. **Verify replacement static hosting before cutover.** Use a Cloudflare staging hostname with the complete existing site, `/spinarium/`, policy pages, model/fonts/artwork, relative links, deep routes and same-origin `/api/` boundary. Run the static/browser checks against that hosted URL. Verify cache behavior, missing assets, HTTP redirects, TLS/certificates, security headers, privacy text and original-site interactions. Preserve the current public artwork and cinematic.
8. **Cut over only after hosted checks pass.** Configure the production host/routes using the verified deployment, confirm the intended apex and `www` behavior, and then update DNS and hosting configuration. Do not remove `CNAME`, disable Pages or replace live DNS first. Verify production TLS, apex/`www` redirects, all pages/assets, real identity sessions and permissions against the exact deployed revision. Keep a recorded rollback path to the working Pages deployment until production verification completes.

The staging D1/disabled Worker deployment above is complete. R2 enablement, Auth0 configuration, static staging verification and production cutover remain pending. No hosted account or claim availability should be announced until the corresponding gates pass. Changing `previewEnabled` or hiding Admin in the browser cannot enforce permissions.

## Administrator operation

Verify the actual OIDC-created profile before granting authority. Use trusted D1 operator SQL against the confirmed staging database and the checked-in schema; record the operator, profile, reason and result. There is no first-user shortcut or public promotion API. Test a normal collector and the allowlisted owner separately, including direct API requests made outside the UI. The preview username `admin` conveys no server authority.

## Claim and InvoHub boundaries

Final claim credential encoding and normalization remain pending. The separate printed registration QR and human-readable credential must contain the same one-time secret; the physical serial is an identifier. Secure issuance, hashing, atomic redemption, provenance and abuse controls must be designed and verified before claim activation. Do not generate live credentials or add browser ownership writes in this migration.

InvoHub stays behind a separate service boundary. No shared database credential, public collector signup into InvoHub, or service integration is configured. A future authenticated integration must define authority, versioning, idempotency and audit without exposing manufacturing endpoints to browsers. Games, transfers, mystery purchases and other future roadmap work are outside this migration.

## Historical material

[Architecture](history/SPINARIUM-ARCHITECTURE-SUPABASE-2026-10-01.md), [accounts](history/SPINARIUM-ACCOUNTS-SUPABASE-2026-10-01.md), [administration](history/SPINARIUM-ADMIN-SUPABASE-2026-10-01.md) and [handoff](history/SPINARIUM-HANDOFF-SUPABASE-2026-10-01.md) preserve the earlier Supabase foundation. They document history and local tests, not the selected platform or instructions to provision a project.
