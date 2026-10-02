# Spinarium accounts are live

Open <https://spindowngames.com/spinarium/> to sign up or log in. Accounts are handled directly by Cloudflare Workers and saved in D1; no Auth0 or Cloudflare dashboard setup is needed.

Use a display name, an email-shaped login identifier and a password of at least 15 characters. The address may be unverified or non-deliverable. Signup/login opens the preserved Spinarium home and empty collection, with an eight-hour protected session. New accounts receive no demo Veilings or administrator authority.

Password reset is unavailable for every account until email delivery and secure recovery are implemented. R2 is reserved for private artwork and does not block signup/login. Claims remain disabled.

Production was activated October 2, 2026 at 17:30:54 UTC. Hosted production API, account-browser and original-site checks passed. See [VERIFICATION.md](../VERIFICATION.md) for the evidence and [deployment](SPINARIUM-CLOUDFLARE.md) for packaging/rollback.
