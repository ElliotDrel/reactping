# Setup and run

ReactPing is a static website plus one Node.js API function on Vercel, with Supabase Postgres and Supabase Auth. Superseded: the previous single `node:http` process with SQLite, a tunnel, and Docker. Step-by-step account connection lives in [the connection guide](connection-guide.md); this page is the technical contract it follows.

## 1. Install and verify locally

```sh
npm ci
npm run db:test:start
export TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres
npm run check   # format:check, typecheck, lint, build, test
npm run db:test:stop
```

`npm run dev` builds the site and serves it with the API at `http://localhost:3000` (`PORT` to change). It reads `.env` when present. With no configuration the site works, `/app` reports "Setup not connected", and the API fails closed with `503 not_configured`. The dev server also calls the delivery endpoint every minute when `DELIVERY_CRON_SECRET` is set, standing in for pg_cron.

A full local sign-in needs a Supabase Auth endpoint: a hosted project, or the Supabase CLI local stack (`supabase start`, which captures sign-in emails locally). Apply `supabase/migrations/` to that database and point `DATABASE_URL` at it. `http://localhost` is accepted for `PUBLIC_SITE_URL`; Slack itself requires HTTPS for its redirect and event URLs.

## 2. Environment contract

All names are in [`.env.example`](../.env.example).

| Variable                          | Where                | Purpose                                                                                     |
| --------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| `PUBLIC_SITE_URL`                 | build + API          | Canonical origin. OAuth redirect, install origin check, canonical links, sitemap.           |
| `PUBLIC_SUPABASE_URL`             | build + API          | Supabase project URL. Browser sign-in; API token verification.                              |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | build + API          | Publishable (or legacy anon) key. The build and API reject secret or service-role keys.     |
| `PUBLIC_INSTALL_ENABLED`          | build                | Website shows installs as open. Does not enable installs.                                   |
| `PUBLIC_SITE_INDEXABLE`           | build                | Allow indexing; needs `PUBLIC_SITE_URL`; ignored when `VERCEL_ENV` is not `production`.     |
| `PUBLIC_SUPPORT_EMAIL`            | build                | Optional support address; empty shows "Support contact not published yet".                  |
| `DATABASE_URL`                    | API (secret)         | Supabase Postgres, transaction pooler (port 6543), verified TLS. Omit SSL query parameters. |
| `SLACK_CLIENT_ID`                 | API                  | Slack app client ID.                                                                        |
| `SLACK_CLIENT_SECRET`             | API (secret)         | Slack OAuth code exchange.                                                                  |
| `SLACK_SIGNING_SECRET`            | API (secret)         | Verifies Slack event requests.                                                              |
| `ENCRYPTION_KEY`                  | API (secret)         | 32 bytes, base64. Encrypts Slack tokens at rest.                                            |
| `DELIVERY_CRON_SECRET`            | API (secret) + Vault | Bearer secret for `POST /api/internal/deliver`; at least 32 characters.                     |
| `REACTPING_INSTALLS_ENABLED`      | API (operator flag)  | Allows new Slack installs. Default `false`.                                                 |
| `INCLUDE_SELF_REACTIONS`          | API (operator flag)  | Testing only. Default `false`.                                                              |

The build reads only `PUBLIC_*` and `VERCEL_ENV`; a test builds with secret-looking values set and checks none reach the output. If any API variable is missing or invalid, the API logs the variable names (never values) and fails closed.

URLs under `PUBLIC_SITE_URL`:

- Slack OAuth redirect URL: `/api/slack/oauth/callback`
- Slack Events API request URL: `/api/slack/events`
- Delivery endpoint for pg_cron: `/api/internal/deliver`
- Health: `/api/health` → `{"ok":true,"ready":true|false,...}`

Remote database connections always use TLS with certificate verification. If system trust does not validate the provider certificate, set server-only `DATABASE_CA` to the provider's PEM CA certificate. Do not put `ssl`, `sslmode`, `sslcert`, `sslkey`, or `sslrootcert` in `DATABASE_URL`: those parameters override node-postgres TLS options. Local loopback Postgres uses no TLS. Idle connection errors are logged without connection details.

## 3. Supabase

- Apply `supabase/migrations/20261110000000_reactping.sql` (SQL editor or `supabase db push`). It creates the private `reactping` schema; do not add it to the Data API's exposed schemas.
- Auth: enable the Email provider. Change the "Magic Link" email template to send the code (`{{ .Token }}`) instead of a link; the app asks for a 6-digit code (it accepts 6 to 10 digits). Public users need **custom SMTP**; Supabase's built-in sender only reaches project team members at a low rate. The connected free project also rejects email-template changes without custom SMTP or an upgrade, and its default template contains a magic link rather than a code. Configure SMTP before testing this app's code-entry flow; do not assume the built-in sender is sufficient.
- After deployment, run `supabase/cron.template.sql` in the SQL editor with the real URL and `DELIVERY_CRON_SECRET` typed into the editor only. Secrets go into Vault; the job calls the endpoint every minute.
- Account deletion removes the Supabase Auth user with `delete from auth.users` over `DATABASE_URL`. Actual deletion was tested against a local stand-in for `auth.users`. On November 13, hosted `postgres` was confirmed to have DELETE privilege on `auth.users`, but no real hosted identity has been deleted. If hosted Supabase refuses it, the ReactPing data is still deleted and the app tells the user the sign-in email was not removed.

## 4. Vercel

- Import the repository with framework preset "Other". `vercel.json` sets `npm ci` and `npm run build`; the build emits `.vercel/output` (Build Output API), so dashboard output-directory and function settings are not used. The function runs on `nodejs24.x` with a 30-second limit.
- Set the variables above for Production. Preview deployments are noindex and cannot complete Slack OAuth (the redirect and cookie belong to the canonical host); leave installs off there.
- Slack and pg_cron must reach the production URL without Vercel Deployment Protection challenges.
- Hobby plans are for personal, non-commercial use. Commercial use needs a plan that allows it; public availability alone does not determine whether a project qualifies.
- Choose the domain before configuring Slack; changing `PUBLIC_SITE_URL` later means updating the Slack app URLs and rebuilding.

## 5. Slack app

Paste `slack-manifest.template.yaml` with `YOUR_SITE_HOST` replaced. It configures user scope `reactions:read`, bot scope `chat:write`, the user event `reaction_added`, bot events `app_uninstalled` and `tokens_revoked`, and token rotation off. Slack verifies the event URL when saved, so deploy first. To connect a second workspace, enable **Manage Distribution → Activate Public Distribution** (this is not a Marketplace listing).

## Behavior notes

- **Routing:** an event goes to the connected installation whose `team_id` matches and whose Slack user matches `item_user`. The `authorizations` array is not used because Slack lists only one of the installations that can see the event.
- **Filtering:** only `reaction_added` on the connected user's own messages. Self-reactions are skipped unless `INCLUDE_SELF_REACTIONS=true`, which still excludes other people's messages and keeps workspace isolation. Messages without `item_user` (for example incoming webhooks) are ignored.
- **Delivery:** the event is committed to Postgres before Slack gets the `200`; a database failure returns `500` so Slack retries. Delivery is attempted immediately after the response and recovered by the every-minute cron call. Rows are deduplicated by `(event_id, recipient)`, claimed with `for update skip locked` and a 60-second lease, and the attempt count rises at claim time. Transient failures retry with backoff (10 s doubling, capped at 15 min, 8 attempts; retries after the first run on the cron's one-minute cadence). Slack rate limits honor the full `Retry-After` through a pause stored in Postgres. A timeout, network error, or crash mid-send is ambiguous, so a retry can produce a **duplicate DM**; there is no exactly-once guarantee. Routing, authorization, and consent are rechecked after the message-link lookup.
- **Message link:** `chat.getPermalink` with the source user's token, falling back to `<workspace url>archives/<channel>/p<ts without dot>`. For thread replies the fallback may open the parent channel.
- **Cross-workspace text** says "Someone reacted…"; same-workspace text mentions the reactor.
- **Connection test DM:** labelled as connectivity only, at most once a minute per workspace.
- **Revocation:** `tokens_revoked` and `app_uninstalled` wipe the affected tokens and show the workspace as Revoked with a Reconnect button. Auth errors during delivery or a test DM do the same. **Disconnect** deletes the installation first, then revokes the user token and, when no other ReactPing user in that workspace depends on it, the bot token.
- **Account deletion** requires typing `delete`, removes all ReactPing rows, attempts to delete the Supabase Auth user before concurrently revoking the Slack credentials. Incomplete remote revocation or identity deletion is reported explicitly.
- **Data kept:** see the privacy page. Delivery records older than 48 hours and expired OAuth state are purged by the cron call; deletion can be delayed if that job is unavailable (`RETENTION_HOURS` in `src/config.ts`, shown on the privacy page; the old `RETENTION_HOURS` environment variable is superseded).
- **Not supported:** Enterprise Grid organization-wide installs (rejected at OAuth) and token rotation.

## Recovery

- **Missed deliveries:** pending rows stay in Postgres and are retried by the next cron call. Check `cron.job_run_details` and `net._http_response` if nothing is being sent.
- **Lost `ENCRYPTION_KEY`:** stored tokens can't be decrypted. Delete the `reactping.installations` rows and have every workspace reconnect.
- **Changed domain:** update `PUBLIC_SITE_URL`, redeploy, update both Slack URLs and the Vault `reactping_delivery_url`, then verify a fresh reaction end to end. Reactions missed during downtime are not backfilled.
