# Spinarium accounts

Spinarium now has a real Supabase Auth adapter and an account-gated entry. It has no demo login, invented users, pre-owned characters, or browser-only ownership grants. A newly created collector account starts with zero ownership records. Creating or publishing a Veiling is independent from giving someone verified ownership.

## Connection status

`spinarium/config.js` deliberately ships with an empty project URL and publishable key. Until a real project is connected, account forms must show that registration/sign-in are unavailable and must not fabricate successful accounts or allow entry into a personal collection.

InvoHub's repository uses Supabase, but this session has no configured Supabase administrative connection and the repository contains no hosted project URL/public key. An existing hosted project may exist outside the repository. Its existence and access cannot be inferred from the local setup instructions.

Use a **new, dedicated Spinarium Supabase project in the existing Supabase account**. The inspected InvoHub database migrations contain an administrator authorization problem: a missing actor role can pass a `NOT IN` authorization check. Local verification showed an unprivileged user could promote themselves. Do not enable public collector signup against that database or reuse its privileged administration functions. Repairing InvoHub is a separate change; Spinarium's database uses an independent, explicit administrator allowlist and fails closed when a role is missing.

## Connect the project

1. In the Supabase dashboard, select the new dedicated Spinarium project. Do not select the internal InvoHub project.
2. Run [the Spinarium schema](../supabase/spinarium-schema.sql) using the project's SQL editor, following [the administration setup](SPINARIUM-ADMIN.md). It defines collector profiles, catalog projections, ownership restrictions, administrator authorization, and audit records. Review/install the policies before publishing project configuration.
3. Enable the Email provider and **Confirm email**. Configure password requirements to require at least 12 characters; enable available compromised-password checks. The browser's 12-character requirement is only input guidance; the provider must enforce password policy.
4. Set the Auth **Site URL** to `https://spindowngames.com/spinarium/`. Add that exact URL to the allowed redirects. Use separate explicit local/test URLs when needed, and avoid wildcard production redirects. Signup/forgot-password calls rely on this configured Site URL; authentication links return to the Spinarium entry, not InvoHub.
5. Configure a production email sender for confirmation and recovery. Verify delivery, expiration, and link behavior with a real test inbox. The browser never claims an email was delivered; a signup result asks the user to check their inbox if the address can be registered.
6. Copy the project's URL and **publishable key** from its public API settings into `spinarium/config.js`, preserving the two existing field names. A legacy `anon` key is also supported. These are public project configuration, not administrative credentials.
7. Before activating the public configuration, update the site's existing privacy/account terms to accurately describe the new account data, Supabase processing, retention and account-support process. Then deploy the static site, create and confirm the owner's account, and seed its administrator allowlist entry using the protected SQL process in the administration guide. Signing up never automatically makes anyone an administrator. Editing `user_metadata`, frontend state, a profile display name, or a JavaScript flag cannot grant administrative access.
8. Verify the real account and policy scenarios below before announcing account availability. Keep existing physical-card claims unavailable until the transactional claim service is deployed.

**Never place a Supabase `service_role` key, `sb_secret_` key, database password, personal Supabase access token, or InvoHub administrative credential in this repository's browser configuration.** The adapter rejects secret/service-role keys. The publishable key is safe to expose only when database and storage policies correctly restrict every operation.

Provider account creation and recovery limits must be configured server-side. The adapter translates HTTP 429 into a safe cooldown message and optional `Retry-After` seconds; changing browser state cannot remove provider limits. It also recognizes provider CAPTCHA failure. A provider CAPTCHA widget/challenge UI is not implemented in this milestone; integrate the chosen provider's supported widget before enabling mandatory CAPTCHA on these forms. Claim abuse restrictions are a separate future backend policy and must restrict claims rather than permanently lock collector accounts.

## Authentication contract

[supabase-auth.js](../spinarium/auth/supabase-auth.js) implements the documented [Supabase Auth REST API](https://github.com/supabase/auth/blob/master/openapi.yaml) with `fetch`, without adding a package dependency:

| Operation            | Provider request                                                                 | Result                                                                             |
| -------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Sign up              | `POST /auth/v1/signup`                                                           | Pending email confirmation creates no authenticated local session.                 |
| Sign in              | `POST /auth/v1/token?grant_type=password`, then `GET /auth/v1/user`              | A provider-verified, email-confirmed identity.                                     |
| Confirm/recover link | Consume and immediately remove recognized URL fragment, then `GET /auth/v1/user` | Confirmed identity; recovery is a distinct flow requiring a password update.       |
| Request reset        | `POST /auth/v1/recover`                                                          | A generic result independent of whether an account exists.                         |
| Update password      | `PUT /auth/v1/user`, then current-session logout                                 | Password update followed by a cleared local session and normal sign-in.            |
| Sign out             | `POST /auth/v1/logout?scope=local`                                               | Local state clears immediately, including when provider revocation is unreachable. |

`createAuthClient(config, {fetchImpl})` exposes `configured`, `configurationError`, `signIn`, `signUp`, `signOut`, `getCurrentUser`, `getSession`, `getAccessToken`, `consumeAuthCallback`, `requestPasswordReset`, `updatePassword`, and `onAuthStateChange`. Callers receive safe `AuthError` codes/messages, never raw provider error bodies or submitted secrets.

`getSession()` is synchronous and returns `null` or `{user, expiresAt, flow}`. The user contains only a provider-verified ID, email, creation time, and email-confirmation indicator. It carries no roles, user metadata, access token, refresh token, or ownership. `getAccessToken()` is reserved for the data-service adapter's HTTPS bearer requests. Each database/storage operation still requires authoritative backend authorization.

`onAuthStateChange(listener)` passes the public session or `null` and returns an unsubscribe function. An operation version prevents late sign-in verification from restoring a session after logout or replacing a newer login. The adapter expires sessions early and does not attempt to extend a session based on a local flag.

## Session and secret handling

Tokens are held only in module-closure memory. There is no local storage, session storage, IndexedDB, or synthetic authentication cookie. Refresh tokens are discarded. Page reload and session expiration require sign-in again. This is an explicit limitation of the static-hosted milestone; durable secure login should use a later server-managed session/BFF with Secure, HttpOnly cookies, appropriate SameSite/CSRF protections, and deliberately scoped CORS.

Authentication callback fragments are removed with `history.replaceState` **before any provider request or auth-state notification**. They are not route names, log messages, analytics data, or UI text. Invalid or expired callback links fail safely. `GET /user` validates the bearer token; decoding a JWT, reading an account ID from a fragment, or hiding the dashboard in CSS cannot verify identity. A legacy API key's public `anon` role is decoded solely to reject unsafe configuration, never to authorize a user.

The UI must clear password fields after submission and recovery transitions. Render provider/catalog text through text nodes, never interpolate it as HTML. Keep token-bearing requests out of ordinary request-body/error/analytics logs. Maintain a restrictive resource policy and a no-referrer policy; a later server session layer reduces exposure to browser-script compromise.

No raw password, token, provider response, or privileged metadata enters application logs. Provider errors that may contain submitted data are replaced with fixed user-safe messages. Requests use HTTPS, omit cookies, disable caching, and reject redirects so credentials are not forwarded to another endpoint.

## Verification

Run `node scripts/verify-spinarium-auth.mjs`. It uses test-only provider responses to verify disabled configuration, rejection of server keys, provider validation, pending confirmation, token-free public sessions, privilege-metadata removal, immediate callback scrubbing, recovery, generic account-existence responses, safe errors, rate limits, sign-out failure, expiration, and sign-in/sign-out races. It does not create real accounts or prove a hosted project's settings.

After connecting the real dedicated project, verify:

- A fresh account must confirm email and then sees an empty personal collection, zero ownership statistics, and only approved public catalog information.
- Bad credentials, expired confirmation/recovery links, and excessive requests fail safely. No authentication token remains in the address bar or browser persistent storage.
- A normal collector cannot access catalog-administration writes or promote themselves, including by altering metadata. The owner allowlist account can manage catalog content through the protected admin interface.
- Creating/publishing a character updates the administrator catalog without granting ownership. Collectors cannot enumerate unowned definitions or retrieve their private artwork. The initial editor's `draft` status is descriptive: an existing owner can still read its definition and artwork. A later publication workflow must separate approved owned content from unpublished revisions rather than silently hiding purchased content.
- Another collector's private profile/ownership data cannot be read or changed. No account, including the catalog administrator, can mint claimed ownership through browser table writes.
- Signing out and session expiration return to the login gate. InvoHub and the original SpinDownGames pages retain their existing behavior.

Claims, transfers, production automation, randomized products, Warpling, and game systems remain outside this account/catalog milestone.
