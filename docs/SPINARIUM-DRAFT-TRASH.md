# Draft Trash and artwork readiness

This change is prepared for review. Do not treat repository code, local tests, or a draft PR as hosted activation. Migration 0006 and the matching Worker/frontend must be released together after approval. R2 account enablement and private buckets are a separate activation prerequisite for uploads.

## Studio workflow

An eligible, saved draft has **Trash draft**. Save or discard unsaved changes first. The confirmation names the saved draft and explains that it can be restored. **Trash** has a read-only view and **Restore** returns the same draft to the normal list. Requests are guarded against repeat clicks, session changes and stale revisions.

Trash is reversible: the catalog row, assigned character number, artwork files, metadata and audit history remain in place. Assigned numbers stay reserved. There is no permanent-delete endpoint, empty-trash action, automatic retention period, or R2 object deletion from this feature.

Only unused, unpublished drafts are eligible. The backend rejects any current or historical publication, active/retired status history, ownership record or discovery record. Hiding a published Veiling does not turn it into a deletable draft. Shared artwork references are safe because the files and references are retained.

## Backend and migration

- `GET /api/admin/veilings`: existing active catalog list with `canTrash` and nullable `trashedAt`.
- `GET /api/admin/veilings?trashed=true`: only trashed drafts, same projection.
- `POST /api/admin/veilings/:id/trash` and `/restore`: empty body, exact quoted `If-Match` revision, current administrator session, Origin and CSRF token. Returns the updated row.
- `GET /api/admin/artwork-status`: current administrator-only capability read, returning `available`, `maxBytes` and `acceptedTypes`.
- Uploads without an `ARTWORK` binding return actionable `ARTWORK_UNAVAILABLE`; saving text-only drafts still works.

`0006_draft_trash.sql` adds nullable trash columns, an index, separate append-only trash/restore audit, and database guards. It backfills or deletes no content and does not modify the existing immutable audit tables. Guards block publication, ownership, discovery, artwork attachment and content edits for trashed drafts, including attempts by older code. A restore clears only the trash markers and advances the revision; it does not publish anything.

Trash eligibility, the exact active session, live administrator role and expected revision are checked inside the same D1 batch as the update and audit. Failed audits roll back the complete operation. Replaced artwork and failed-upload orphan handling remain unchanged.

## Release checkpoint

1. Confirm the reviewed commit and all Worker, contract, asset-packaging and browser CI checks. Inspect the target D1 migration ledger before any write.
2. After authorization, apply only reviewed migration 0006 to staging. Do not replay foundation migrations or the cancelled 0004 cinematic migration. Verify saved accounts and existing catalog/publication/ownership/history counts are unchanged.
3. Deploy matching staging Worker and generated static assets. Use disposable staging fixtures to verify trash/restore, stale revisions, published/owned rejection, session loss and missing-storage behavior. Do not trash a real user draft as a smoke test.
4. After the production checkpoint, apply 0006 and deploy the same verified code/assets to production. Read-only checks establish availability; any production fixture writes need explicit approval.
5. Keep D1, audit, artwork and all account data for rollback. Older code can still operate on non-trashed rows, but may list trashed drafts because it does not filter them; database guards reject their edits. Prefer a compatible code rollback that understands Trash, or pause Studio mutations until a fix is deployed. Never drop the columns/table or restore a database over saved user work as a routine rollback.

## Private artwork activation

The latest storage check still returned Cloudflare error 10042 requiring R2 activation in the dashboard. Both hosted configs intentionally omit `ARTWORK`; this PR must not add a binding to a bucket that has not been created.

Once account activation, any required billing agreement and provisioning are authorized:

- Create private Standard buckets `spinarium-staging-artwork` and `spinarium-production-artwork`.
- Add `r2_buckets: [{ binding: "ARTWORK", bucket_name: "spinarium-staging-artwork" }]` to the staging config, and the corresponding production bucket to production only after staging verification.
- Keep r2.dev public access and public custom domains off. Existing authenticated same-origin Worker routes need no public bucket, CORS opening, S3 access key, or new application secret.
- Upload limits remain PNG/JPEG/WebP with matching file signature, 8 MiB maximum. Replaced versions are immutable and retained, so storage usage includes previous images.
- Verify staging authenticated upload/read and anonymous/member denial for a private draft. Publish a disposable staging snapshot to verify member access and draft-replacement isolation. No production image or real draft is needed for preparation tests.
- Update the privacy disclosure that R2 is unconfigured only when actual activation has been verified.

References: [R2 Worker bindings](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [Workers binding deployment permissions](https://developers.cloudflare.com/workers/authorization/workers/#bindings).
