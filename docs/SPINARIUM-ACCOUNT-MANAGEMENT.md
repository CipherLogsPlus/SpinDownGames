# Spinarium account management

Account administration is live alongside the existing real email/password login. The migration and matching Worker/assets are deployed to staging and production, and each environment passed all 16 actual hosted account/browser checks. The final original-site hosted suite passed all 29 checks. The designated saved account is provisioned as the sole owner. Sign in again, then open **Menu → Accounts**. No shared administrator password or second identity service is introduced. See [VERIFICATION.md](../VERIFICATION.md) for the evidence.

## Access levels

| Role | Account-management authority |
| --- | --- |
| Collector | Own protected collection and session; no account directory or administrative actions. |
| Administrator | Search accounts, inspect permitted account information, and manage collectors. Cannot manage another administrator or the owner. |
| Owner | All administrator capabilities, plus appointing/removing regular administrators and managing their accounts. |

There is one owner. Only a trusted Cloudflare operator can provision or transfer that role. The website cannot create another owner, demote the owner, or give a collector administrative authority through signup or profile metadata. The owner cannot disable, demote, administratively reset, or revoke access to their own account through these management controls. Normal sign-out remains available. Administrators and the owner can change their own display name.

Server authorization uses the current private allowlist and active session on every protected request. Directory role fields and browser controls do not supply authority. Mutations check permissions again within the database operation so an earlier permission check cannot authorize a later action after access is revoked.

## Using the directory

After signing in with an authorized account, open **Menu → Accounts**. The account summary shows totals and access status. Use the search field selector for an email prefix, display-name prefix, or exact account ID; combine it with status and role filters. The UI reads 50 accounts per page; the API permits at most 100. The browser does not download every account to search or filter them. Email search uses the normalized login identifier. Display-name search folds ASCII letters only; non-ASCII case remains significant. Percent and underscore characters are literal prefix characters, not SQL wildcards.

Select an account to inspect its profile, role, access status, creation date, last successful sign-in when recorded, active-session count, collection records, and administrative history. Passwords, password hashes, session tokens, reset credentials already issued, and claim secrets never appear in account projections. Existing accounts can have an unknown historical last-sign-in time until their next successful sign-in.

Supported actions are changing a display name, disabling/restoring access, signing out an account's sessions, issuing a password-reset link, and—only for the owner—appointing or removing a regular administrator. Role changes require an active account; restore a disabled target before changing its role. Each action requires a reason and checks the selected account's revision. A conflicting change requires a fresh account view and a new decision; it must not silently overwrite another administrator's work.

Disabling an account blocks sign-in and revokes its sessions. Restoring it requires a new sign-in; old sessions stay invalid. Role changes, explicit session revocation and reset-link issuance also revoke the target's sessions. Account changes invalidate the target's previous reset link; destructive access changes also invalidate links issued by that account. There is no account deletion, password viewer, account impersonation, or email-identifier change in this release. Account-management actions do not grant Veilings, claims, discoveries, achievements, or production authority.

## Assisted password recovery

Automatic email recovery remains unavailable. An authorized administrator can issue a temporary one-use reset link after checking a support request and establishing that the requester controls the intended account. An unverified email-shaped identifier alone is not proof of ownership. Regular administrators can assist collectors; the owner can also assist regular administrators. Owner recovery requires the trusted operator process.

The reset link is displayed once and expires after 15 minutes. Issuing it signs out the target's current sessions; its password changes only when the link is successfully consumed. Share it privately only with the verified requester; this action does not send an email. The secret is carried in the URL fragment, removed from the address bar by the reset page, and kept out of browser storage and ordinary HTTP request logs. D1 stores only its digest and expiry. A replacement link invalidates the previous link, and account/access changes can invalidate it as well.

The recipient chooses a new password. Successful consumption atomically updates the password hash, consumes the token, revokes every session belonging to the target account, and records completion. It also revokes the browser session supplied with that request, even if it belongs to another account, and clears the browser cookie. The recipient must then sign in; reset does not create a session. A failed reset preserves the existing browser session and cookie. Concurrent submissions cannot consume the same token twice. A previously issued link cannot override a disabled account or a later loss of the issuing administrator's authority.

Never copy a password, session cookie, or reset link into a repository, ordinary logs, or chat. Administrative history records safe account changes, reasons, actors, and times rather than credentials.

## Owner provisioning and operation

The owner explicitly designated the sole account they had just created and could sign into. The trusted operator resolved its real server-generated account ID and creation record, then provisioned that exact active account through a guarded transaction. The owner role, single-owner count and grant audit were verified; existing sessions were revoked so a fresh sign-in is required. The operator did not sign in as the owner. This is a one-time owner-directed grant to that specific account, not an automatic first-signup rule and not a grant based on an unverified email alone.

Before granting access, verify the exact existing account is active, its immutable account/creation identifiers match the designation, and no different owner already exists. Use trusted Cloudflare D1 access to add that exact account to the private allowlist as owner with an attributable grant reason. Do not seed a guessed UUID, publish the owner's identifiers, or create credentials on their behalf. Verify the resulting role and protected API behavior without asking for the owner's password or session cookie.

Apply the account-management migration before deploying the matching Worker. Keep the existing account records, password hashes, sessions, Cloudflare route, GitHub Pages fallback, artwork, and InvoHub service boundary intact. Rollback must preserve D1 data. New public pages and Worker endpoints must be deployed together so reset and administration controls match the backend.

## Scale and verification

Account pages and subpages have explicit limits. Cursor pagination uses a stable indexed ordering rather than increasing SQL offsets. Directory pages default to 50 accounts, while history and ownership subpages default to 25; each API has a maximum of 100. Search modes use matching indexes; cursor values are validated against the selected search and filters. Summary counts are fetched separately from directory pages and are not a production throughput benchmark.

Verify pagination and query plans with a large local fixture, including sparse role/status filters, no matches, repeated creation timestamps, and deep pages. This validates indexing and response bounds; it does not establish production throughput for tens of thousands of simultaneous users. Actual hosted checks use a few isolated test accounts and exercise permissions, revocation, role hierarchy, audit, and one-use reset behavior. Never seed a large fake account population into production.

See [administration](SPINARIUM-ADMIN.md), [accounts](SPINARIUM-ACCOUNTS.md), and [deployment](SPINARIUM-CLOUDFLARE.md). Record local, hosted staging, and hosted production results separately.
