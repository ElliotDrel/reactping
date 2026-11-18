# Setup and run

ReactPing is a static website plus four small Vercel Node.js functions, with one Supabase Postgres table. Superseded: the Build Output API generator, Supabase Auth email codes, the `/app` dashboard, and the pg_cron delivery job. Step-by-step provider work lives in [the connection guide](connection-guide.md); this page is the technical contract it follows.

## 1. Install and verify locally

```sh
npm ci
npm run db:test:start
export TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres
npm run check   # format:check, typecheck, lint, build, test
npm run db:test:stop
```

`npm run build` is a TypeScript check; Vercel compiles the functions in `api/` itself and serves `public/` as static files. `npm run dev` runs `vercel dev`, which needs the Vercel CLI and a linked project. Slack requires HTTPS for every URL, so live Slack testing uses the deployed site.

## 2. Environment contract

All names are in [`.env.example`](../.env.example). Every variable is server-only; the website reads none.

| Variable                 | Purpose                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `PUBLIC_SITE_URL`        | Canonical origin. OAuth redirect URL; installs started on another host are redirected here first.           |
| `DATABASE_URL`           | Supabase Postgres, transaction pooler (port 6543), verified TLS. SSL query parameters are refused.          |
| `DATABASE_CA`            | Optional PEM CA when system trust does not validate the provider certificate.                               |
| `SLACK_CLIENT_ID`        | Slack app client ID.                                                                                        |
| `SLACK_CLIENT_SECRET`    | Slack OAuth code exchange.                                                                                  |
| `SLACK_SIGNING_SECRET`   | Verifies Slack event and interactivity requests.                                                            |
| `ENCRYPTION_KEY`         | 32 bytes, base64. Separate keys are derived for token encryption (`installation-tokens`) and `oauth-state`. |
| `INCLUDE_SELF_REACTIONS` | Testing only. Default `false`.                                                                              |

Removed from the contract: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `PUBLIC_INSTALL_ENABLED`, `REACTPING_INSTALLS_ENABLED`, `PUBLIC_SITE_INDEXABLE`, `PUBLIC_SUPPORT_EMAIL`, and `DELIVERY_CRON_SECRET`. All six that existed in the connected Vercel project were deleted after the Slack-only deployment passed hosted checks; `PUBLIC_SUPPORT_EMAIL` was never set.

If any variable is missing or invalid, the function logs the variable names (never values) and every route returns `503 not_configured`.

URLs under `PUBLIC_SITE_URL`:

| Route                           | Slack setting                           |
| ------------------------------- | --------------------------------------- |
| `GET /api/slack/install`        | none; `/connect`'s "Continue to Slack"  |
| `GET /api/slack/oauth/callback` | OAuth & Permissions → Redirect URL      |
| `POST /api/slack/events`        | Event Subscriptions → Request URL       |
| `POST /api/slack/interactions`  | Interactivity & Shortcuts → Request URL |

Each file in `api/` exports only its route's method, and the shared handler returns 404 for any other method or path. There is no health endpoint.

## 3. Supabase

- For a new, empty project, `supabase db push --remote --yes` applies the migration history and leaves only `reactping_slack.installations`. Do not expose that private schema to the Data API.
- For an existing account-backed deployment, apply only additive `20261113000000_reactping_slack_installations.sql` first. Deploy and check the Slack-only version before applying cleanup `20261114000000_remove_account_backend.sql`; follow [the ordered connection guide](connection-guide.md). Do not apply all pending migrations while the old version is running.
- The original `20261110000000_reactping.sql` stays unchanged. Its schema was inspected and removed after deployment; existing rows were not imported (there were none).
- Supabase Auth, SMTP, Vault, `pg_cron`, and `pg_net` are no longer used by ReactPing. Its job and Vault secrets were deleted and email Auth disabled. Supabase-managed schemas and extensions were retained; no unrelated or platform-owned objects were dropped.

## 4. Vercel

- Framework preset **Other**. `vercel.json` sets `npm ci`, `npm run build`, output directory `public`, clean URLs, security headers, and a 30-second limit for `api/**/*.ts`. Node version comes from `engines` (`24.x`).
- Functions use `waitUntil` from `@vercel/functions` to send DMs after acknowledging Slack, and `attachDatabasePool` for the pg pool.
- Set the variables above for Production. Preview deployments cannot complete OAuth (the redirect and cookie belong to the canonical host).
- Slack must reach the production URLs without Vercel Deployment Protection challenges.
- Hobby plans are for personal, non-commercial use.

## 5. Slack app

Paste `slack-manifest.template.yaml` with `YOUR_SITE_HOST` replaced. It configures:

- user scope `reactions:read` and bot scopes `chat:write` and `im:history` (`im:history` plus the `message.im` event and a writable Messages tab let people DM feedback; App Home and `views.publish` need no extra scope);
- the user event `reaction_added`, and the bot events `app_home_opened`, `app_uninstalled`, `tokens_revoked`, and `message.im`;
- the Home tab and a Messages tab people can write in (superseded November 17: read-only);
- interactivity at `/api/slack/interactions`;
- token rotation and org-wide deployment off.

Slack verifies the event URL when it is saved, so deploy first. Unlisted public distribution is enabled for second-workspace pilots as of November 15. Workspace installation policies still apply; the app is not submitted to the Marketplace.

## Behavior notes

- **Identity:** `team.id` and `authed_user.id` from `oauth.v2.access`, checked against `auth.test`. Reinstalling replaces that row's tokens; nothing else changes.
- **Filtering:** only `reaction_added` on a `message` whose `item_user` has an installation in the event's own workspace, from someone else (unless `INCLUDE_SELF_REACTIONS=true`). Messages without `item_user` are ignored.
- **Delivery:** `200` first, then `chat.postMessage` in `waitUntil`, with no SDK retries. Requests with `X-Slack-Retry-Num` are acknowledged and ignored, so a reaction is delivered at most once per Slack delivery attempt and can be lost if the first attempt fails. Slack auth errors (`token_revoked`, `invalid_auth`, `account_inactive`, …) delete that installation unless it was reinstalled meanwhile.
- **Message link:** `<workspace url>archives/<channel>/p<ts digits>`. For thread replies this may open the parent conversation.
- **Home tab:** `app_home_opened` publishes the connected view for connected users. Users who never connected see Slack's default Home.
- **Lifecycle:** `app_uninstalled` deletes every row for the workspace; `tokens_revoked` deletes the listed users' rows, or the whole workspace when the bot token is revoked.
- **Not supported:** Enterprise Grid (rejected at OAuth) and token rotation.

## Recovery

**Accepted availability risk (November 15, 2026):** Supabase Free projects may pause after about a week of low activity. Removing the every-minute delivery cron also removed that regular background traffic. If this project pauses, ReactPing cannot access its database and notifications stop until the project is restored from the [Supabase dashboard](https://supabase.com/dashboard/project/ykrdmgewztwzksgwbjue). Reactions missed while paused are not backfilled. Elliot accepts this risk: do not add a keep-alive. Superseded: the old idle-week availability check is no longer a remaining launch requirement. See [Supabase availability guidance](https://supabase.com/docs/guides/deployment/going-into-prod#availability).

- **Missed notifications:** expected occasionally and never backfilled. Check the function logs for `notify_failed` or `background_failed`.
- **Lost `ENCRYPTION_KEY`:** stored tokens can't be decrypted. Delete the `reactping_slack.installations` rows; everyone adds ReactPing to Slack again.
- **Changed domain:** update `PUBLIC_SITE_URL`, redeploy, update the three Slack URLs, then verify a fresh reaction end to end.
