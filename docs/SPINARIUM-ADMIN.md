# Spinarium protected administration

Workers enforce Spinarium administrator authority. D1 stores the private allowlist and account/catalog audit; R2 is reserved for protected artwork. Catalog creation and editing never grant collector ownership. Production password accounts are active through the Cloudflare Worker, and GitHub Pages remains fallback. Account management is deployed and passed all 16 actual account/browser checks in each of staging and production. The owner's exact designated saved account is the sole owner; sign in again and open **Menu → Accounts**. See [account management](SPINARIUM-ACCOUNT-MANAGEMENT.md) and [VERIFICATION.md](../VERIFICATION.md). R2 remains unconfigured.

The former PostgreSQL/Supabase instructions are preserved [as superseded history](history/SPINARIUM-ADMIN-SUPABASE-2026-10-01.md). D1 needs its own migration and Worker authorization; do not install the PostgreSQL schema or assume RLS exists in D1.

## Trusted administrator provisioning

First create the owner's real password account through Spinarium. Read its actual D1 profile and confirm the exact account ID belongs to the owner through the protected operator workflow. The email-shaped identifier is unverified and cannot establish that authority. Provision that verified profile as the sole owner through trusted D1 SQL using the checked-in schema and a clear grant reason. Revoke existing sessions so the owner signs in again before using elevated access. Never guess a user ID, seed an email alone, or automatically promote the first signup.

Allowlist changes require trusted authority and an attributable record. Only the owner can appoint or remove regular administrators through the protected management API; no website endpoint grants or transfers the owner role. An absent membership denies access; browser state, email text and a collector's own profile fields cannot override that decision. D1 administrative access can change the database, so restrict operators and retain change records. Application audits do not replace Cloudflare operator access controls.

The account-management migration extends `admin_allowlist(user_id, granted_at, granted_by)` with `role`, restricted to `owner` or `admin`, and enforces a single owner. Read the actual owner's `users` row and confirm the stable account ID first; neither an email string nor a display name proves it. Through protected operator SQL, add that exact active ID as owner with a current timestamp and identifiable operator in `granted_by`. Record the reason in the operational change record. There is deliberately no copy-and-run example with a fabricated owner ID.

The account-management directory is behind **Menu → Accounts** and uses indexed server pagination, explicit search fields and role/status filters. The owner can manage regular administrators and collectors. Regular administrators can manage collectors only. Self/owner access controls prevent accidental lockout; self display-name changes remain allowed. Account changes use reasons, revision checks, current session/role checks and immutable audit records. Disabling, role changes, session revocation and password reset invalidate the relevant access credentials. See the [complete account-management guide](SPINARIUM-ACCOUNT-MANAGEMENT.md).

See [the Cloudflare deployment guide](SPINARIUM-CLOUDFLARE.md). R2 setup blocks private artwork operations but does not block account signup/login. Assisted recovery lets an authorized administrator issue a 15-minute single-use link after checking a support request. It sends no email and never reveals the current password. The flow passed actual staging and production account verification. Automatic email recovery remains unavailable. The preview `admin` username is unrelated to the allowlist.

## Catalog and artwork

The protected API validates accepted fields and server-generated IDs. Administrators can manage Veiling catalog descriptions, status and labels independently of ownership. Catalog status is editorial metadata; it is not an enforceable batch retirement or production limit. Those operations remain outside this milestone. Draft content is currently withheld from collector projections; an approved content/revision policy is required before issuing real ownership so catalog edits cannot hide purchased content.

Artwork is stored in a private R2 binding and served only after Worker authorization. Collectors need ownership of the corresponding non-draft, revealed Veiling and may read only its currently attached artwork; administrators need an actual allowlist entry. Keep existing public concept art unchanged. Do not enable an R2 public bucket or expose its development URL for private collector assets. An object key is not permission.

Uploads accept PNG, JPEG or WebP with matching signatures, up to 8 MiB. Random object keys preserve previous uploads rather than overwriting them; administrators may inspect historical artwork. R2 and D1 cannot share a transaction. A failed database attachment/audit triggers cleanup of the new object; failed cleanup can leave a private inaccessible orphan for later operator review. The existing Veiling catalog list is capped at 200 rows and has no pagination yet; the separate account directory is paginated.

Catalog writes append an audit event in the same D1 operation batch. Audit details identify the actor and target and retain catalog before/after snapshots, including editorial descriptions, without copying passwords, provider tokens, artwork contents or claim secrets. Audit update/delete triggers protect records from application mutation. Catalog changes and artwork attachment require a matching revision through `If-Match`; stale edits fail rather than overwriting newer content. Catalog endpoints offer no ownership issuance, authority setter or audit mutation. Failures produce safe responses, never raw credential-bearing provider errors.

Send the returned numeric revision as a quoted `If-Match` value for PATCH and artwork attachment. The revision is not an editable catalog body field. Missing revision returns 428; a stale revision returns 409. Reload the current row and resolve the edit before retrying.

## Required hosted checks

- A fresh collector is empty and cannot read another collector's data.
- Unauthenticated, expired-session and non-admin requests cannot administer the catalog or artwork, even when made directly outside the UI.
- Metadata/body tampering cannot promote a collector or change ownership.
- The verified administrator can create/edit catalog content and upload/read authorized artwork; each mutation produces the expected audit record.
- Creating or publishing a Veiling changes catalog records only and grants no collector ownership.
- An owner can read its authorized artwork, while an unowned collector and unauthenticated requester cannot retrieve it.
- Same-origin and CSRF checks reject unauthorized mutations; disabled authentication does not allow preview cookies or usernames to access protected APIs.
- Collector, administrator and owner access levels remain distinct, including direct API calls, concurrent role changes, protected owner/self controls and session revocation.
- Reset links expire, work only once, die after relevant access changes, and cannot bypass a disabled account or loss of issuer authority. Successful reset revokes sessions and requires a new sign-in.

Local isolated checks and hosted staging checks must be recorded separately. Accounts are active; claims, production authority, discoveries, achievements, transfers, mystery purchases and games remain unavailable. InvoHub continues behind a separate service boundary with no shared credentials or database binding.
