# Setup and architecture

ReactPing is a static website plus six small Vercel Node.js functions, backed by Supabase Postgres. This page is the technical contract for running it, including self-hosting.

## Architecture

- **Website:** static HTML and CSS in `public/` (`/`, `/connect`, `/how-it-works`, `/security`, `/privacy`, `/feedback`, and a 404 page). No scripts and no configuration. Pages with a canonical URL are indexable and listed in `sitemap.xml`; the rest are `noindex`, and `robots.txt` keeps crawlers out of `/api/`. Every "Add to Slack" link opens `/connect`, which explains workspace choice and admin approval, then continues to `/api/slack/install`. `/security` links its claims to exact source lines; `test/site.test.ts` fails if those lines stop matching.
- **Functions:** one file per route in `api/`, each exporting a Web-standard `GET` or `POST` that calls the shared handler in `src/handler.ts`. The handler takes its dependencies as arguments, so tests run it directly with a mocked Slack API. Any other method or path returns 404; there is no health endpoint.
- **OAuth CSRF:** `state` is a random nonce, mirrored in an HttpOnly, Secure, `SameSite=Lax`, `__Host-` cookie with a 10-minute expiry, HMAC-signed with a key derived from `ENCRYPTION_KEY`. Wrong browser, expiry, or tampering fails. Nothing is stored.
- **Install policy:** Enterprise Grid installs, missing scopes, and unverifiable workspaces are rejected, and the just-issued user grant is revoked unless an existing installation still uses it.
- **Events:** the signature is checked over the raw body (5-minute window, 256 KB limit). `reaction_added` and `app_home_opened` are acknowledged with `200` and processed in `waitUntil`; requests with `X-Slack-Retry-Num` are acknowledged and ignored. `app_uninstalled` and `tokens_revoked` delete rows before the `200`, so their retries are safe.
- **Message links:** `<workspace url>archives/<channel>/p<ts digits>`, built from validated text (the workspace URL comes from `auth.test` at install and must be `https://<name>.slack.com/`). Thread replies may open the parent conversation.
- **Disconnect:** identity comes only from the signed payload's `team.id` and `user.id`. Exactly that row is deleted, then the user's token is revoked and Home shows Not connected. The shared bot token is never revoked by Disconnect; removing the app does that.
- **Slack client:** `@slack/web-api` with retries off, 5-second timeouts, unfurls off, and a silent logger. Logs are allowlisted structured fields only: never tokens, codes, or message content.

Layout: `src/handler.ts` (routes), `src/db.ts` (store), `src/slack.ts` (Slack client), `src/messages.ts` (DM and Home text), `src/pages.ts` (result pages, stats image), `src/oauth-state.ts`, `src/crypto.ts`, `src/config.ts`, `src/vercel.ts` (environment wiring). Tests are in `test/`.

## Data

All tables are in the private `reactping_slack` schema with RLS on, no policies, and no `anon`/`authenticated` privileges. Do not expose the schema to the Data API.

| Table           | Contents                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `installations` | One row per `(team_id, user_id)`: workspace URL, AES-256-GCM bot and user tokens (associated data binds each to its row and field), times. |
| `activity`      | `connected`, `disconnected`, and `uninstalled` per workspace, with time and install count. No user IDs.                                    |
| `counters`      | `notifications_sent` total.                                                                                                                |
| `feedback`      | Website form entries: message, optional name and email, `source` (`website`, `slack_welcome`, `slack_home`), `status`, `note`.             |

`GET /api/stats` renders the workspace and notification totals as an edge-cached SVG for the homepage. Feedback `source` comes from the UTM tags in the form page's Referer. Edit feedback `status` (`new`, `viewed`, `resolved`, `declined`) and `note` in the Supabase Table Editor; a trigger maintains `status_at`.

## Run locally

See [Development](../README.md#development). `npm run build` is a TypeScript check; Vercel compiles `api/` itself and serves `public/`. `npm run dev` runs `vercel dev` (needs the Vercel CLI and a linked project). Slack requires HTTPS, so live Slack testing uses a deployed site.

## Environment

All names are in [`.env.example`](../.env.example). Every variable is server-only.

| Variable                 | Purpose                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `PUBLIC_SITE_URL`        | Canonical origin. OAuth redirect base; installs started on another host are redirected here first. |
| `DATABASE_URL`           | Supabase Postgres, transaction pooler (port 6543), verified TLS. SSL query parameters are refused. |
| `DATABASE_CA`            | Optional PEM CA when system trust does not validate the provider certificate.                      |
| `SLACK_CLIENT_ID`        | Slack app client ID.                                                                               |
| `SLACK_CLIENT_SECRET`    | Slack OAuth code exchange.                                                                         |
| `SLACK_SIGNING_SECRET`   | Verifies Slack event and interactivity requests.                                                   |
| `ENCRYPTION_KEY`         | 32 bytes, base64. Separate keys are derived for token encryption and the OAuth state cookie.       |
| `INCLUDE_SELF_REACTIONS` | Testing only: also notify about your own reactions. Any value other than `true` means off.         |

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

## Self-hosting

1. **Supabase:** create a project and run `supabase db push` to apply `supabase/migrations/` in order. Copy the transaction pooler connection string into `DATABASE_URL`.
2. **Vercel:** import the repository with framework preset **Other**; `vercel.json` sets the install and build commands, output directory `public`, clean URLs, security headers, and a 30-second function limit. Set the variables above for Production; preview deployments cannot complete OAuth. Slack must reach production without Deployment Protection challenges. Hobby plans are for personal, non-commercial use.
3. **Slack:** create an app from [`slack-manifest.template.yaml`](../slack-manifest.template.yaml) with `YOUR_SITE_HOST` replaced. Deploy first: Slack verifies the event URL on save. The manifest sets user scope `reactions:read`, bot scope `chat:write`, the user event `reaction_added`, bot events `app_home_opened`, `app_uninstalled`, and `tokens_revoked`, the Home tab, interactivity, and token rotation off. It can't set the icon: upload `slack-app-icon.png` (1024 px) under **Basic Information → Display Information**. To allow other workspaces, enable **Manage Distribution → Share Your App with Other Workspaces**, and share `<PUBLIC_SITE_URL>/api/slack/install` (or the site), never Slack's raw authorize link, so the state cookie is set.
4. **Verify:** add the app, check for the welcome DM and the Home tab, then have someone else react to your message. Record what you observe in [verification](verification.md).

## Operations

- **Missed notifications:** expected occasionally and never backfilled. Check the function logs for `notify_failed` or `background_failed`.
- **Supabase idle pause (accepted risk, November 15, 2026):** Free projects may pause after about a week of low activity. Notifications then stop until the project is restored from the Supabase dashboard, and missed reactions are not backfilled. Elliot accepts this risk: do not add a keep-alive. See [Supabase availability guidance](https://supabase.com/docs/guides/deployment/going-into-prod#availability).
- **Lost `ENCRYPTION_KEY`:** stored tokens can't be decrypted. Delete the `installations` rows; everyone adds ReactPing again.
- **Changed domain:** update `PUBLIC_SITE_URL`, redeploy, update the three Slack URLs, then verify a fresh reaction end to end. Also update the host and key file in `scripts/submit-indexnow.mjs`.
- **IndexNow:** `.github/workflows/indexnow.yml` waits for the deploy after any push to `main` that changes `public/`, then `scripts/submit-indexnow.mjs` sends every sitemap URL to IndexNow (Bing and others; Google doesn't use it). Run it by hand from the Actions tab. A 200 or 202 means received, not indexed.
- **Search consoles:** reactping.com is a Domain property in Google Search Console, verified by a Cloudflare TXT record (keep it), and imported into Bing Webmaster Tools from there. Both have `sitemap.xml`.
- **Not supported:** Enterprise Grid and token rotation.

## References

Reviewed November 13, 2026: [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js), [`@vercel/functions`](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package), [Events API](https://docs.slack.dev/apis/events-api/), [`app_home_opened`](https://docs.slack.dev/reference/events/app_home_opened/), [`views.publish`](https://docs.slack.dev/reference/methods/views.publish/). Reviewed October 23, 2026: [`reaction_added`](https://docs.slack.dev/reference/events/reaction_added/), [OAuth scopes](https://docs.slack.dev/authentication/installing-with-oauth/), [`chat.postMessage`](https://docs.slack.dev/reference/methods/chat.postMessage/), [distribution](https://docs.slack.dev/app-management/distribution/).
