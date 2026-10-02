# Spinarium protected administration

Workers enforce Spinarium administrator authority. D1 stores the private allowlist and catalog audit; R2 holds protected artwork. Catalog creation and editing never grant collector ownership. No Cloudflare Spinarium resource, verified owner account or administrator grant has been created remotely.

The former PostgreSQL/Supabase instructions are preserved [as superseded history](history/SPINARIUM-ADMIN-SUPABASE-2026-10-01.md). D1 needs its own migration and Worker authorization; do not install the PostgreSQL schema or assume RLS exists in D1.

## Trusted administrator provisioning

First create and verify the owner's real staging OIDC identity. Read its actual D1 profile and confirm the issuer/subject and owner identity through the protected operator workflow. Provision that verified profile through trusted D1 SQL using the checked-in schema and a clear grant reason. Never guess a user ID, seed an email alone, or automatically promote the first signup.

Allowlist changes require trusted account/operator access and an attributable operational record. Public routes expose no administrator setter. An absent membership denies access; browser state, OIDC metadata and a collector's own profile fields cannot override that decision. D1 administrative access can change the database, so restrict operators and retain change records. The application audit covers catalog operations and does not replace Cloudflare operator access controls.

The D1 table is `admin_allowlist(user_id, granted_at, granted_by)`, referencing `users.id`. Read the actual owner's `users` row and confirm its stored issuer/subject first. Through protected operator SQL, add that exact active ID with a current timestamp and identifiable operator in `granted_by`. Record a reason in the operational change record. There is deliberately no copy-and-run example with a fabricated owner ID.

See [the Cloudflare migration guide](SPINARIUM-CLOUDFLARE.md) for staging setup. Only configure the public frontend after the actual hosted allowlist and denial checks pass. The preview `admin` username is unrelated to the allowlist.

## Catalog and artwork

The protected API validates accepted fields and server-generated IDs. Administrators can manage Veiling catalog descriptions, status and labels independently of ownership. Catalog status is editorial metadata; it is not an enforceable batch retirement or production limit. Those operations remain outside this milestone. Draft content is currently withheld from collector projections; an approved content/revision policy is required before issuing real ownership so catalog edits cannot hide purchased content.

Artwork is stored in a private R2 binding and served only after Worker authorization. Collectors need ownership of the corresponding non-draft, revealed Veiling and may read only its currently attached artwork; administrators need an actual allowlist entry. Keep existing public concept art unchanged. Do not enable an R2 public bucket or expose its development URL for private collector assets. An object key is not permission.

Uploads accept PNG, JPEG or WebP with matching signatures, up to 8 MiB. Random object keys preserve previous uploads rather than overwriting them; administrators may inspect historical artwork. R2 and D1 cannot share a transaction. A failed database attachment/audit triggers cleanup of the new object; failed cleanup can leave a private inaccessible orphan for later operator review. The initial administrator list is capped at 200 rows and has no pagination yet.

Catalog writes append an audit event in the same D1 operation batch. Audit details identify the actor and target and retain catalog before/after snapshots, including editorial descriptions, without copying passwords, provider tokens, artwork contents or claim secrets. Audit update/delete triggers protect records from application mutation. Catalog changes and artwork attachment require a matching revision through `If-Match`; stale edits fail rather than overwriting newer content. Application endpoints offer no ownership issuance, authority setter or audit mutation. Failures produce safe responses, never raw credential-bearing provider errors.

Send the returned numeric revision as a quoted `If-Match` value for PATCH and artwork attachment. The revision is not an editable catalog body field. Missing revision returns 428; a stale revision returns 409. Reload the current row and resolve the edit before retrying.

## Required hosted checks

- A fresh collector is empty and cannot read another collector's data.
- Unauthenticated, expired-session and non-admin requests cannot administer the catalog or artwork, even when made directly outside the UI.
- Metadata/body tampering cannot promote a collector or change ownership.
- The verified administrator can create/edit catalog content and upload/read authorized artwork; each mutation produces the expected audit record.
- Creating or publishing a Veiling changes catalog records only and grants no collector ownership.
- An owner can read its authorized artwork, while an unowned collector and unauthenticated requester cannot retrieve it.
- Same-origin and CSRF checks reject unauthorized mutations; disabled authentication does not allow preview cookies or usernames to access protected APIs.

Local isolated checks and hosted staging checks must be recorded separately. Account activation, claims, production authority, discoveries, achievements, transfers, mystery purchases and games remain unavailable. InvoHub continues behind a separate service boundary with no shared credentials or database binding.
