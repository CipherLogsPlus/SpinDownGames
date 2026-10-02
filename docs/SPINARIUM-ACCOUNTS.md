# Spinarium accounts

The latest owner instruction selects direct email/password signup and login through Cloudflare Workers, with D1 saving account data. Unverified or non-deliverable email-shaped identifiers are allowed. They do not prove identity or grant permissions. The earlier Auth0 setup requirement is superseded; no Auth0 account, application or secret is needed for this flow.

The current milestone is signup, saved account data and login directly through Spinarium, without owner setup in provider dashboards. Successful signup/login opens the existing Home, My Collection and Explore Veilings interface and preserves its cinematic. New accounts own zero Veilings. Production was activated October 2, 2026 at 17:30:54 UTC. Hosted API signup/login, saved-profile/session/empty-dashboard, cookie and denial checks passed. Production passed 12 actual account-browser checks; staging passed 14; see [verification](../VERIFICATION.md).

## Saved accounts and sessions

`POST /api/auth/signup` accepts `{email, password, displayName}`; the browser also asks for password confirmation before submitting. The Worker validates the input, generates the account ID and saves the user plus credentials in D1. `POST /api/auth/login` accepts `{email, password}` and checks the stored password hash. Signup and successful login return the verified application session projection `{user, csrfToken, expiresAt}`; the user contains only `id`, `displayName` and `memberSince`.

The email-shaped login identifier is trimmed and lowercased, with no alias stripping. It is unique in `password_accounts.email_normalized`. Its address need not receive email, and it is never a verified identity, account-linking shortcut or administrator role. Password accounts use their own server-generated IDs; matching an old provider email does not link accounts.

Passwords must contain 15–128 Unicode code points and at most 512 UTF-8 bytes. The Worker stores a versioned scrypt hash with a fresh 16-byte random salt and 32-byte output (`N=32768`, `r=8`, `p=3`) rather than plaintext. Native Worker hashing supported hosted staging and production signup/login. Production signup/login and saved-account persistence also passed 12 actual browser checks. Passwords, cookies and credential request bodies must not enter ordinary logs.

The browser receives an opaque Secure, HttpOnly, SameSite session cookie with an eight-hour lifetime. D1 stores the session-token digest and server expiry. `GET /api/auth/session` verifies the current active account/session. `POST /api/auth/logout` revokes it with same-origin and CSRF checks. Browser flags, submitted user IDs and email text cannot establish identity. Account data survives reload/sign-out; access requires a valid server session or the password.

Introduction completion remains browser-local. No per-account introduction field is stored in D1. Claims, ownership issuance, discoveries, achievements and production authority have no account-flow write endpoint.

## Recovery and artwork limits

The production login release has no password reset, including for accounts using a real mailbox. An account-management update adds administrator-assisted recovery through a private, 15-minute single-use reset link. Its migration is applied to staging; hosted verification, production deployment and owner provisioning remain pending. See [account management](SPINARIUM-ACCOUNT-MANAGEMENT.md). Automatic email recovery remains unavailable: email sending is not configured, and an email-service access check returned `2036 Unauthorized`. Supplying a real email does not enable automatic recovery.

R2 setup remains unavailable with error `10042`. This blocks private artwork administration, not signup, login or saving accounts in D1. The empty-collection account milestone does not need an artwork bucket or email sender.

## Authorization and verification

The account-management update defines one operator-provisioned owner and regular administrators. Only the owner may appoint or remove regular administrators; administrators manage collectors, while the owner may also manage regular administrators. These features and the designation of the owner's existing account are pending deployment and verification. Signup never promotes a collector; email, profile text, browser flags and the first account do not grant authority. Catalog creation never creates ownership. InvoHub remains a separate service.

Keep verifying real hosted signup, failed login, reload persistence, expiry/logout, duplicate-account behavior, CSRF/origin rejection, rate limits and collector/admin denial against deployed changes. Local tests and prior OIDC fixtures are separate evidence. Preserve the Pages rollback path and D1 account data during updates. See [activation](SPINARIUM-ACTIVATION.md), [Cloudflare deployment](SPINARIUM-CLOUDFLARE.md) and [administration](SPINARIUM-ADMIN.md).

The [Supabase-era account guide](history/SPINARIUM-ACCOUNTS-SUPABASE-2026-10-01.md) is historical only. Do not provision Supabase or follow the earlier Auth0 dashboard instructions for this milestone. Never paste secrets or passwords into chat.
