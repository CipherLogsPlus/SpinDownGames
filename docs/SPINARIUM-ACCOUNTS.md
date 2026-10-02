# Spinarium accounts

Cloudflare Workers own Spinarium sessions and server-side permissions. D1 is the authoritative application store and R2 holds artwork. Real account and signup activation remain disabled. The owner selected Auth0 Universal Login with email/password. The static `admin` / `1234` login is an explicit preview; it creates no account, administrator authority, Veilings or ownership.

The Supabase-era setup is preserved [for history](history/SPINARIUM-ACCOUNTS-SUPABASE-2026-10-01.md). Do not provision Supabase or activate its retained adapters for Spinarium. See [Cloudflare migration](SPINARIUM-CLOUDFLARE.md) for verified access and deployment prerequisites.

## Server authentication foundation

`cloudflare/spinarium-worker/` implements an OIDC authorization-code flow with PKCE through `oauth4webapi`. The selected Auth0 regular web application uses a fixed email/password database connection. RS256 ID tokens, `client_secret_basic` and advertised PKCE S256 are required. The Worker requests `openid profile email` and requires `email_verified: true` before creating a profile/session. New profiles have no ownership. `SIGNUP_ENABLED: "false"` also blocks new-profile creation through a login callback; it permits only existing active D1 collectors to sign in. Provider tokens stay server-side and do not confer application administrator permission.

The browser receives an opaque Secure, HttpOnly, SameSite session cookie; D1 stores the server session representation. The Worker validates issuer/audience, callback, state and nonce, enforces an eight-hour session expiry and ten-minute login/signup attempts, and validates same-origin/CSRF protection for cookie-based mutations. Reload persistence comes from a valid server session, never a browser role flag. Logout revokes the application session; the Auth0 session may remain. Auth0 password reset does not automatically revoke existing eight-hour D1 sessions. Verify provider logout, reset and trusted session revocation/account-disable procedures before activation.

`AUTH_ENABLED` and `SIGNUP_ENABLED` are false by default. `AUTH0_CONNECTION` is empty; browser `signupEnabled` is false and `apiBase` is empty. The frontend Cloudflare login/signup/session adapters are prepared behind these switches. The Worker is not connected to the public preview, and no hosted account, provider registration or session has been created by this work. Auth0 manages password collection, email verification, password reset and identity abuse protections through Universal Login. The Worker never accepts passwords. The separate `/api/auth/signup` entry is gated, uses Auth0's signup screen hint and the fixed database connection, and still requires a verified email before a collector/session exists. Those settings and supported account lifecycle must be confirmed before activation; local protocol mocks do not establish them.

## Activation gates

1. Follow the [Auth0 dashboard setup](SPINARIUM-CLOUDFLARE.md#auth0-emailpassword-setup) for a dedicated staging regular web application and email/password database connection. Register the exact HTTPS callback, configure issuer/client/connection and the required secret securely, and verify email delivery, password reset, password policy and abuse limits.
2. Provision isolated staging D1 and private R2 resources, bind them to the staging Worker, and apply only the D1 migration. Keep authentication disabled until configuration validation passes. Never reuse InvoHub credentials or database bindings.
3. Verify the actual hosted login/callback/logout flow, expired/replayed state, wrong issuer/audience, cookie properties, session expiry/revocation and CSRF denial. Test real provider failure paths, not only successful login.
4. Verify a fresh collector has zero owned Veilings and cannot access another collector's records, catalog writes, role changes or private unowned artwork. Verify the trusted allowlisted administrator separately. Catalog creation must leave every collector's ownership unchanged.
5. Describe actual account processing, provider/hosting processors, retention and support in the existing privacy/account terms before account activation. Do not invent a business email, retention period or legal entity.
6. Verify the prepared frontend Cloudflare adapters and same-origin hosting boundary before replacing preview access. Enable signup only after hosted verified-email registration and reset checks pass. Disable preview and set the API base only after the replacement backend and hosted UI are verified. Claims remain disabled.

Public account/signup activation remains disabled until hosted staging checks pass. Enable the server flags only on isolated staging when configuration is ready for those tests; browser production `signupEnabled` stays false until verified activation. Do not put provider secrets, Cloudflare API tokens, cookie/session material or InvoHub credentials in `spinarium/config.js`, GitHub Pages or chat. Secure configuration can use interactive Wrangler OAuth and Worker secret commands after account access is verified.

## Administrator and ownership boundary

Only a trusted operator can add a verified profile to the backend administrator allowlist. Email strings, OIDC role metadata, self-selected profile fields and the first account do not grant authority. There is no public promotion route. See [administration](SPINARIUM-ADMIN.md).

The current APIs cannot create ownership, redeem claims, award discoveries/achievements, manage production, perform transfers or run games. Collector data derives from authenticated ownership records. Empty slots remain presentation, never evidence of undiscovered catalog entries or owned cards.

## Verification limits

Worker tests exercise local session and permission behavior with an isolated D1 environment and test-only identity responses. Existing `verify-spinarium-auth.mjs` covers the retained Supabase adapter as a legacy regression only. Neither check creates real accounts or proves deployed provider configuration. Hosted verification and account activation are pending; record completed checks in [VERIFICATION.md](../VERIFICATION.md).
