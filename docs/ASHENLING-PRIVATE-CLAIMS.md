# Ashenling #001 — private one-time digital claim pilot

**Status:** Implemented on development branch only. Nothing in production is migrated or enabled by this branch alone.

## What a code represents

- **Veiling catalog number 001** identifies the Ashenling character. It is *not* a production cap and does not mean only 999 copies can exist.
- **Claim ID** is a random server-side UUID identifying one issued claim record. It is **not** the code.
- **Claim code** is a 43-character URL-safe, cryptographically random 256-bit secret, returned only at issuance. The database stores **only SHA-256(secret)**. No printed code or secret can be recovered from the database.
- **Ownership ID** is the distinct UUID for the digital copy created after successful redemption. Identical Ashenling copies may coexist; the application does not need to display copy-specific IDs.

## Pilot's deliberately restrictive boundaries

- The feature is off unless `CLAIMS_ENABLED=true` is explicitly configured **after migration and testing**; default-off routes return 404 and `/api/health` returns `claimsEnabled:false`.
- Issuance requires an authenticated current owner, same-site CSRF, and an **active, non-deleted, unpublished** Veiling named `Ashenling` with catalog number 1, rarity `Legacy`, and edition `Legacy`.
- An already published or historically hidden Veiling is excluded by the pilot, to prevent unintended public exposure. The existing member showcase remains empty while this private Veiling is unlisted.
- The private pilot code can be redeemed **only by the account that issued it and still has owner authority**. This is not the eventual public QR/card claim flow and must not be described as such.
- A successful redemption atomically consumes the code, inserts exactly one `ownerships` row and makes the private Veiling revealed in the owner collection. The owner can issue another distinct code for another copy.
- Reused, expired, revoked, or invalid codes never create new ownerships. Claims remain as immutable rows, preventing accidental resetting; deleting claims through normal SQL is blocked by a trigger. Codes expire after **7 days** if unused.
- Status reads by the owner expose only `issued/redeemed/expired/revoked`, dates, and the ownership ID, not the code or its hash.
- R2 and image uploads are not required; the site has a separate fallback silhouette asset already merged in GitHub.

## API (for automated pilot tests; no end-user claim UI yet)

All endpoints use existing same-origin session cookies; POST requests additionally require `Origin` and `X-CSRF-Token`. No caller-provided account IDs or roles are trusted.

| Method | Route | Use |
| --- | --- | --- |
| POST | `/api/admin/digital-claims` | Owner creates a pilot code: JSON `{"veilingId":"<uuid>"}`. Response includes `claimId`, `claimCode`, `expiresAt` only **once**. |
| POST | `/api/digital-claims/redeem` | Issuing owner claims copy: JSON `{"code":"<43-character-secret>"}`. Returns `ownershipId` on success. |
| GET | `/api/admin/digital-claims/<claimId>` | Owner verifies claim status without ever retrieving code. |
| POST | `/api/admin/digital-claims/<claimId>/revoke` | Owner permanently revokes an unused code. |

## Verification and deployment gates

1. In an isolated local/test database apply migrations through `0007_ashenling_claim_pilot.sql`; run `npm test` from `cloudflare/spinarium-worker`. `test/digital-claims.test.ts` covers issuance, replay, concurrent claims, expiry, revocation, privacy, CSRF, account and visibility guards.
2. Do **not** apply all old migrations blindly. Check the existing staging migration ledger and apply the new migration once; test with a disposable owner and Ashenling. No production accounts or data should be manipulated for test.
3. Before enabling production, address the existing production **Test** draft currently occupying catalog number **001**, preserving its history and other data. A separate owner-directed catalog action is needed to free the number; the pilot does not automatically rename/delete that draft.
4. The Cloudflare Worker deployment currently requires functioning authenticated static-asset upload. A GitHub merge alone does **not** deploy `spindowngames.com`. Deploy the matching verified Worker and frontend assets after staging checks.
5. Only after staging tests, migration, and deployment, set `CLAIMS_ENABLED=true`, then perform one owner-initiated issue/redeem/status check. Re-verify that no anonymous or other-account claims are possible.
6. Keep public claim generation, QR packaging, trading, and general user-facing claim UI disabled until independently reviewed.

**No real claim code, owner cookie, password, or CSRF token belongs in source control, issue comments, or normal application logs.**
