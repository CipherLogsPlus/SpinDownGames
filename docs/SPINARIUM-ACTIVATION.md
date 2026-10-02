# Activate Spinarium accounts

The staging site and D1 database are deployed at <https://spinarium-staging.cipherlogsplus.workers.dev/spinarium/>. Login/signup remain disabled while R2 and Auth0 are configured. The production website remains on GitHub Pages.

1. **Enable R2.** Open [R2 in your Cloudflare account](https://dash.cloudflare.com/3c470b1087f06866d9c36d5f588fcbca/r2/overview) and complete its account setup. Cloudflare currently returns error `10042`. Once enabled, the private staging bucket and Worker binding can be completed; no API token needs to pass through chat.

2. **Set up Auth0.** Open [the Auth0 dashboard](https://manage.auth0.com/) and create a **Regular Web Application** for Spinarium staging. Enable only the selected email/password **Database** connection. Use **RS256** ID tokens and credentials **Client Secret (Basic)**. Record the connection's **name**, not its ID.

| Auth0 field | Exact value |
| --- | --- |
| Allowed Callback URLs | `https://spinarium-staging.cipherlogsplus.workers.dev/api/auth/callback` |
| Application Login URI / default login URL | `https://spinarium-staging.cipherlogsplus.workers.dev/spinarium/` |

3. **Save the connection securely.** Open [the staging Worker's settings](https://dash.cloudflare.com/3c470b1087f06866d9c36d5f588fcbca/workers/services/view/spinarium-staging/production/settings), then **Variables and Secrets → Add**. Set the following values directly in Cloudflare, selecting **Secret** for the client secret. Select **Deploy** to save them. Keep `AUTH_ENABLED` and `SIGNUP_ENABLED` false until configuration is checked.

| Worker setting | Value | Type |
| --- | --- | --- |
| `OIDC_ISSUER` | Your Auth0 tenant's exact HTTPS issuer, including its trailing slash. | Text |
| `OIDC_CLIENT_ID` | The regular web application's client ID. | Text |
| `AUTH0_CONNECTION` | The enabled database connection's name. | Text |
| `OIDC_CLIENT_SECRET` | Copy directly from Auth0 into Cloudflare. | **Secret** |

Never put the secret in chat, GitHub, browser configuration or a screenshot. `APP_ORIGIN` is already the staging origin and should remain `https://spinarium-staging.cipherlogsplus.workers.dev`.

4. **Configure production email.** In Auth0's email-provider settings, configure your supported external SMTP/email provider and sender for verification and password reset. Auth0's [built-in sender supports testing, but not production](https://auth0.com/docs/customize/email/smtp-email-providers). Keep email verification enabled and configure provider password/abuse protections.

When these settings are saved, the remaining work is to verify configuration, complete the private R2 binding, test real verified signup/login/reset with a test inbox, and grant administrator access only to the confirmed owner account. Production activation and DNS cutover follow hosted verification. Claims remain disabled.

The [technical migration guide](SPINARIUM-CLOUDFLARE.md) contains the full deployment and verification procedure. No Auth0 tenant, application details or email sender have been supplied yet.
