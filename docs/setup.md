# Setup and architecture

ReactPing is a Next.js App Router app on Vercel: prerendered pages plus one API route handler, backed by Supabase Postgres. This page is the technical contract for running it, including self-hosting.

## Architecture

- **Website:** server components in `src/app/` (`/`, `/connect`, `/how-it-works`, `/security`, `/privacy`, `/feedback`, `/changelog`, and `not-found.tsx` for 404s), all prerendered to static HTML by `next build`. Shared header, footer, and head tags are in `src/app/site.tsx`; the hand-written stylesheet and static files (`assets/`, `sitemap.xml`, `robots.txt`, `llms.txt`, the IndexNow key) are served as-is from `public/`. Scripts are Next's own runtime plus PostHog analytics (`instrumentation-client.ts`: page views, referrers, UTM tags, and `?r=` short links), bundled into Next's chunks; the CSP allows this origin and `*.posthog.com`. PostHog is off unless `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` are set. A completed install is sent to PostHog from the server as `slack_installed`, under the visitor's PostHog ID (`src/analytics.ts`), with no Slack IDs. The pages work without JavaScript. The homepage's JSON-LD is data, generated from the same list as the visible FAQ. `llms.txt` summarizes the site for AI tools. `/changelog` is rendered from `CHANGELOG.md` at build time (`src/app/changelog/page.tsx`). Pages with a canonical URL are indexable and listed in `sitemap.xml`; the rest are `noindex`, and `robots.txt` keeps crawlers out of `/api/`. Every "Add to Slack" link opens `/connect`, which explains workspace choice and admin approval, then continues to `/api/slack/install`. `/security` links its claims to exact source lines; `test/site.test.ts` checks the built pages in `.next/server/app/` and fails if those lines stop matching.
- **API:** one catch-all route, `src/app/api/[...path]/route.ts`, exports `GET` and `POST` that call the shared handler in `src/handler.ts` through `src/vercel.ts`; it is `force-dynamic` (nothing cached) with a 30-second limit. The handler takes its dependencies as arguments, so tests run it directly with a mocked Slack API. Unknown methods and paths return 404.
- **OAuth CSRF:** `state` is a random nonce, mirrored in an HttpOnly, Secure, `SameSite=Lax`, `__Host-` cookie with a 10-minute expiry, HMAC-signed with a key derived from `ENCRYPTION_KEY`. Wrong browser, expiry, or tampering fails. Nothing is stored.
- **Install policy:** Enterprise Grid installs, missing scopes, and unverifiable workspaces are rejected, and the just-issued user grant is revoked unless an existing installation still uses it.
- **Events:** the signature is checked over the raw body (5-minute window, 256 KB limit). `reaction_added` and `app_home_opened` are acknowledged with `200` and processed in `waitUntil`; requests with `X-Slack-Retry-Num` are acknowledged and ignored. `app_uninstalled` and `tokens_revoked` delete rows before the `200`, so their retries are safe.
- **Message links:** `<workspace url>archives/<channel>/p<ts digits>`, built from validated text (the workspace URL comes from `auth.test` at install and must be `https://<name>.slack.com/`). Thread replies may open the parent conversation.
- **Disconnect:** identity comes only from the signed payload's `team.id` and `user.id`. Exactly that row is deleted, then the user's token is revoked and Home shows Not connected. The shared bot token is never revoked by Disconnect; removing the app does that.
- **Slack client:** `@slack/web-api` with retries off, 5-second timeouts, unfurls off, and a silent logger. Logs are allowlisted structured fields only: never tokens, codes, or message content.

Layout: `src/handler.ts` (routes), `src/db.ts` (store), `src/slack.ts` (Slack client), `src/messages.ts` (DM and Home text), `src/pages.ts` (result pages, stats image), `src/oauth-state.ts`, `src/crypto.ts`, `src/config.ts`, `src/vercel.ts` (environment wiring). Tests are in `test/`.

## Data

All tables are in the private `reactping_slack` schema with RLS on, no policies, and no `anon`/`authenticated` privileges. Do not expose the schema to the Data API.

| Table               | Contents                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `installations`     | One row per `(team_id, user_id)`: workspace URL, AES-256-GCM bot and user tokens (associated data binds each to its row and field), times.                  |
| `activity`          | `connected`, `disconnected`, and `uninstalled` per workspace, with time and install count. No user IDs.                                                     |
| `counters`          | `notifications_sent` total.                                                                                                                                 |
| `reaction_outcomes` | Hourly counts of what happened to each reaction event: `sent`, `failed:<Slack error>`, `error:<name>`, `self`, `not_connected`, `ignored`, `retry`. No IDs. |
| `feedback`          | Website form entries: message, optional name and email, `source` (`website`, `slack_welcome`, `slack_home`), `status`, `note`.                              |

`GET /api/stats` renders the workspace and notification totals as an edge-cached SVG for the homepage. Feedback `source` comes from the UTM tags in the form page's Referer. Edit feedback `status` (`new`, `viewed`, `resolved`, `declined`) and `note` in the Supabase Table Editor; a trigger maintains `status_at`.

## Run locally

See [Development](../README.md#development). `npm run build` runs `next build`, and the site tests read its output, so build before `npm test` (`npm run check` does). `npm run dev` runs `next dev` and `npm start` serves the build; the API routes need the environment below. Slack requires HTTPS, so live Slack testing uses a deployed site.

## Environment

All names are in [`.env.example`](../.env.example). Every variable is server-only except the two `NEXT_PUBLIC_POSTHOG_*` ones, which Next builds into the browser bundle and are public by design.

| Variable                            | Purpose                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_SITE_URL`                   | Canonical origin. OAuth redirect base; installs started on another host are redirected here first.                |
| `DATABASE_URL`                      | Supabase Postgres, transaction pooler (port 6543), verified TLS. SSL query parameters are refused.                |
| `DATABASE_CA`                       | Optional PEM CA when system trust does not validate the provider certificate.                                     |
| `SLACK_CLIENT_ID`                   | Slack app client ID.                                                                                              |
| `SLACK_CLIENT_SECRET`               | Slack OAuth code exchange.                                                                                        |
| `SLACK_SIGNING_SECRET`              | Verifies Slack event and interactivity requests.                                                                  |
| `ENCRYPTION_KEY`                    | 32 bytes, base64. Separate keys are derived for token encryption and the OAuth state cookie.                      |
| `SELF_REACTION_TEAMS`               | Testing only: workspace IDs, comma-separated, where your own reactions also notify you. Anything else is ignored. |
| `ALERT_WEBHOOK_URL`                 | Optional Slack incoming webhook for operator alerts. Anything but a `hooks.slack.com` URL means off.              |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | Optional PostHog project token (public). Unset means no website analytics and no install event.                   |
| `NEXT_PUBLIC_POSTHOG_HOST`          | PostHog ingest host, e.g. `https://us.i.posthog.com`. Required with the token.                                    |

If a required variable is missing or invalid, the function logs the variable names (never values) and every route returns `503 not_configured`.

## Routes

| Route                           | Used by                                 |
| ------------------------------- | --------------------------------------- |
| `GET /api/slack/install`        | `/connect`'s "Continue to Slack"        |
| `GET /api/slack/oauth/callback` | OAuth & Permissions → Redirect URL      |
| `POST /api/slack/events`        | Event Subscriptions → Request URL       |
| `POST /api/slack/interactions`  | Interactivity & Shortcuts → Request URL |
| `POST /api/feedback`            | The `/feedback` form                    |
| `GET /api/stats`                | The homepage stats image                |
| `GET /api/health`               | Outage summary (runbook)                |

## Self-hosting

1. **Supabase:** create a project and run `supabase db push` to apply `supabase/migrations/` in order. Copy the transaction pooler connection string into `DATABASE_URL`.
2. **Vercel:** import the repository with framework preset **Next.js**; `vercel.json` sets the framework, security headers, and old-host redirects (headers and redirects apply only on Vercel, not under `next start`); the API route sets a 30-second limit. Leave the output directory at its default. Set the variables above for Production; preview deployments cannot complete OAuth. Slack must reach production without Deployment Protection challenges. Hobby plans are for personal, non-commercial use.
3. **Slack:** create an app from [`slack-manifest.template.yaml`](../slack-manifest.template.yaml) with `YOUR_SITE_HOST` replaced. Deploy first: Slack verifies the event URL on save. The manifest sets user scope `reactions:read`, bot scopes `chat:write`, `app_mentions:read`, and `commands`, the user event `reaction_added`, bot events `app_mention`, `app_home_opened`, `app_uninstalled`, and `tokens_revoked`, the Home tab, interactivity, and token rotation off. It can't set the icon: upload `slack-app-icon.png` (1024 px) under **Basic Information → Display Information**. To allow other workspaces, enable **Manage Distribution → Share Your App with Other Workspaces**, and share `<PUBLIC_SITE_URL>/api/slack/install` (or the site), never Slack's raw authorize link, so the state cookie is set.
4. **Verify:** add the app, check for the welcome DM and the Home tab, then have someone else react to your message. Record what you observe in [verification](verification.md).

## Operations

- **Missed notifications:** expected occasionally and never backfilled. Check the function logs for `notify_failed` or `background_failed`.
- **Supabase idle pause (accepted risk, November 15, 2026):** Free projects may pause after about a week of low activity. Notifications then stop until the project is restored from the Supabase dashboard, and missed reactions are not backfilled. Elliot accepts this risk: do not add a keep-alive. See [Supabase availability guidance](https://supabase.com/docs/guides/deployment/going-into-prod#availability).
- **Lost `ENCRYPTION_KEY`:** stored tokens can't be decrypted. Delete the `installations` rows; everyone adds ReactPing again.
- **Changed domain:** update `PUBLIC_SITE_URL`, redeploy, update the three Slack URLs, then verify a fresh reaction end to end. Also update the host and key file in `scripts/submit-indexnow.mjs`.
- **IndexNow:** `.github/workflows/indexnow.yml` waits for the deploy after any push to `main` that changes `public/`, `src/app/`, or `CHANGELOG.md`, then `scripts/submit-indexnow.mjs` sends every sitemap URL to IndexNow (Bing and others; Google doesn't use it). Run it by hand from the Actions tab. A 200 or 202 means received, not indexed.
- **Outage alerts:** every reaction event logs one `reaction` line with its outcome and adds to `reaction_outcomes`. Alerts go to a private Slack channel through an incoming webhook (a separate "ReactPing Alerts" app, so ReactPing's own scopes don't change): the app posts each new feedback and each failed DM (the same failure at most once per 30 minutes per instance), and a daily Supabase cron job (`supabase/ops/daily-alert.sql`, pg_cron + pg_net, webhook URL in Vault as `reactping_alert_webhook`) posts when no reaction events arrived in 24 hours. `GET /api/health` summarizes the last 24 hours by outcome. Vercel keeps runtime logs for only an hour on the Hobby plan, so check soon after an alert.
- **Search consoles:** reactping.com is a Domain property in Google Search Console, verified by a Cloudflare TXT record (keep it), and imported into Bing Webmaster Tools from there. Both have `sitemap.xml`.
- **Not supported:** Enterprise Grid and token rotation.

### When DMs go missing

1. **[`/api/health`](https://reactping.com/api/health)** shows the last 24 hours by outcome. `failed:<code>` is Slack's refusal (for example `failed:channel_not_found`); `error:<name>` is a bug or database failure; many `retry` means responses took over 3 seconds.
2. **Hour by hour:** `select hour, outcome, count from reactping_slack.reaction_outcomes where hour > now() - interval '2 days' order by hour;` An hour with no rows means Slack sent no reaction events then. Compare against the time the person says a reaction was missed: no row means Slack never sent it (check [Slack status](https://slack-status.com/)); `not_connected` or `self` means it was skipped by design; `failed`/`error` is ours to fix.
3. **Details within the hour:** `vercel logs --since 1h` has one `reaction` line per event with the workspace ID and outcome, plus `notify_failed` and `notify_error`. Vercel Hobby keeps runtime logs for 1 hour and request logs (`vercel logs requests`) for 12.

## References

Reviewed November 13, 2026: [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js), [`@vercel/functions`](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package), [Events API](https://docs.slack.dev/apis/events-api/), [`app_home_opened`](https://docs.slack.dev/reference/events/app_home_opened/), [`views.publish`](https://docs.slack.dev/reference/methods/views.publish/). Reviewed October 23, 2026: [`reaction_added`](https://docs.slack.dev/reference/events/reaction_added/), [OAuth scopes](https://docs.slack.dev/authentication/installing-with-oauth/), [`chat.postMessage`](https://docs.slack.dev/reference/methods/chat.postMessage/), [distribution](https://docs.slack.dev/app-management/distribution/).

## Engagement rollout

Apply `supabase/migrations/20261123000000_reactping_engagement.sql` before deploying. Update the Slack manifest, including the /reactping command URL, bot event and scopes. Existing workspace admins may have to approve the new bot scopes; have a member reauthorize in each workspace. The workspace bot grant is encrypted separately so unconnected users can get help even after the last individual disconnects; uninstall or bot revocation deletes that grant. Existing rows supply the legacy bot token until reauthorization. Commands and button requests use Slack signatures and short-lived keyed replay digests. Response URLs are not stored or logged. OAuth links carry only a workspace hint, bound to signed browser state; a different workspace is rejected. Slack controls consent, admin approval and ephemeral visibility. For modal sharing Slack controls submit placement and clipboard access: show a selectable installation link and use its native Share ReactPing submit button.
