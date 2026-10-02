# Spinarium accounts are live

Open <https://spindowngames.com/spinarium/> to sign up or log in. Accounts are handled directly by Cloudflare Workers and saved in D1; no Auth0 or Cloudflare dashboard setup is needed.

Use a display name, an email-shaped login identifier and a password of at least 15 characters. The address may be unverified or non-deliverable. Signup/login opens the preserved Spinarium home and empty collection, with an eight-hour protected session. New accounts receive no demo Veilings or administrator authority.

Account management is live and passed all 16 actual account/browser checks in each of staging and production. The designated saved account is the sole owner. **Sign in again, then open Menu → Accounts** to search accounts, disable/restore access, revoke sessions, issue private single-use reset links and appoint/remove regular administrators. Regular administrators manage collectors; the owner can also manage regular administrators. See [account management](SPINARIUM-ACCOUNT-MANAGEMENT.md).

Automatic email recovery remains unavailable; assisted reset links expire after 15 minutes and are shared privately after checking a support request. R2 is reserved for private artwork and does not block signup/login. Claims remain disabled.

Production was activated October 2, 2026 at 17:30:54 UTC. Hosted production API, account-browser and original-site checks passed. See [VERIFICATION.md](../VERIFICATION.md) for the evidence and [deployment](SPINARIUM-CLOUDFLARE.md) for packaging/rollback.
