# ReactPing

A Slack app that DMs you when someone reacts to your messages.

Status (November 13, 2026): the Slack-only version is deployed at [reactping.vercel.app](https://reactping.vercel.app). Non-Slack hosted checks pass, and the old account schema, delivery job, Vault secrets, and unused Vercel variables are removed. Supabase email Auth is disabled; no SMTP setup is needed. Local checks pass with 66 tests against disposable Postgres. Slack configuration, installation, welcome DM, App Home, and a real self-reaction round trip are verified. A second person's reaction in normal mode and lifecycle checks remain pending; see the dated evidence below. See [verification](docs/verification.md), [setup](docs/setup.md), and [the connection guide](docs/connection-guide.md). Superseded: the separate account, cross-workspace inbox, dashboard, and durable outbox.

## V1

- **Add to Slack** from the website. Slack OAuth is the only identity: a person is their Slack workspace ID plus user ID. There is no separate account, email, or password.
- Authorize with user `reactions:read` and bot `chat:write`.
- Notify only when `item.type` is `message`, `item_user` is a connected user in that same workspace, and the reactor is someone else (unless the testing flag `INCLUDE_SELF_REACTIONS` is on).
- Deliver in the same workspace only: a bot DM with the reactor mention, the emoji, and a link to the message. No message text, no history, no unfurls.
- A welcome DM on install; ReactPing's Slack **Home** tab shows the status and a **Disconnect** button.
- Best effort: Slack's request is acknowledged immediately and the DM is sent right after. Slack retries are ignored, and nothing is queued, retried, or backfilled, so an occasional notification can be lost. The website says so.
- Store no reaction, event, or delivery records.

Deferred to v2: a single inbox across workspaces (with explicit consent). Also deferred: billing, analytics, digests, per-emoji filters, message previews, backfill, Marketplace submission, and organization-wide (Enterprise Grid) installs.

## Architecture

TypeScript on Node 24, deployed to Vercel with Supabase Postgres. Superseded: the Build Output API generator, Supabase Auth, pg_cron/pg_net/Vault delivery recovery, and the SQLite service before that.

- **Website:** plain static HTML and CSS in `public/` (`/` and `/privacy`, plus a 404 page). No JavaScript, no configuration, no browser auth. "Add to Slack" is the relative link `/api/slack/install`. Security headers, clean URLs, and `noindex` come from `vercel.json`.
- **Functions:** standard Vercel filesystem functions in `api/`, one per Slack URL, each exporting a Web-standard `GET` or `POST` that calls one shared handler (`src/handler.ts`). The handler takes its dependencies as arguments, so tests run it directly with a mocked Slack API.
  - `GET /api/slack/install` sets the OAuth state cookie and redirects to Slack.
  - `GET /api/slack/oauth/callback` completes OAuth and shows a small result page.
  - `POST /api/slack/events` takes Slack events.
  - `POST /api/slack/interactions` takes the Home tab's Disconnect button.
- **OAuth CSRF:** the `state` is a random nonce. The browser holds an HttpOnly, Secure, `SameSite=Lax`, `__Host-` cookie carrying the same nonce and a 10-minute expiry, HMAC-signed with a key derived from `ENCRYPTION_KEY` for this purpose only. Wrong browser, expiry, or tampering fails. Nothing is stored.
- **Install policy:** there is no install flag. ReactPing stays closed while Slack's **Manage Distribution** is off (only the app's own workspace can install). Enterprise Grid installs, missing scopes, or an unverifiable workspace are rejected, and the just-issued user grant is revoked unless an existing installation still uses it.
- **Events:** the signature is checked over the raw body (5-minute timestamp window, 256 KB limit). `reaction_added` and `app_home_opened` are acknowledged with `200` first and processed with Vercel `waitUntil`; requests carrying `X-Slack-Retry-Num` are acknowledged and ignored. `app_uninstalled` and `tokens_revoked` delete rows before the `200` (idempotent, so Slack retries are accepted for them).
- **Links:** `auth.test` at install provides the workspace URL, which must be `https://<name>.slack.com/`. Message links are `<workspace>/archives/<channel>/p<seconds><microseconds>`, built from validated text with no float conversion and no `chat.getPermalink` call.
- **Disconnect:** identity comes only from the signed payload's `team.id` and `user.id`, never the button. Exactly that row is deleted before the response; then the user's own token is revoked and the Home tab shows Not connected. The workspace's bot token is shared, so it is never revoked by Disconnect; removing the app in Slack does that.
- **Database:** one private table, `reactping_slack.installations`, keyed by `(team_id, user_id)`: workspace URL, AES-256-GCM bot and user tokens (associated data binds each to its table, row, and field), and timestamps. RLS on, no policies, no `anon`/`authenticated` privileges. Remote connections require verified TLS (optional `DATABASE_CA`); SSL URL overrides are refused. The original `reactping` schema was removed by a new post-deploy cleanup migration; the old migration remains unchanged.
- **Slack client:** `@slack/web-api` with retries off, 5-second timeouts, unfurls off, and a silent logger. Logs are structured, allowlisted fields only: never tokens, codes, or message content.

## Ship criteria

1. Done: deploy the Slack-only version; hosted checks without Slack calls pass (static pages and headers, malformed callback, unsigned and invalid-signature requests rejected).
2. Done: apply the post-deploy cleanup migration for the old `reactping` schema and remove unused provider configuration.
3. With Elliot's authorization, configure the Slack app from [the manifest](slack-manifest.template.yaml) and complete the [live checklist](docs/live-checklist.md) in Elliot's workspace: install, welcome DM, Home, a real reaction DM from another person, Disconnect, and uninstall.

Ship criterion: Elliot's workspace works end to end on the hosted app with documented coverage and no message-content collection. Then tag v0.1.0. Public distribution and Marketplace submission are later releases; this repository stays private until Elliot requests otherwise.

## Development

Requires Node 24+ and, for the database tests, Docker.

```sh
npm ci
npm run db:test:start                 # disposable Postgres on 127.0.0.1:54329
export TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres
npm run check                         # format:check, typecheck, lint, build (tsc), test
npm run db:test:stop
npm run format                        # prettier --write --ignore-unknown
npm run dev                           # vercel dev (needs the Vercel CLI and a linked project)
```

`TEST_DATABASE_URL` must point at local Postgres; the tests create and drop their own databases and refuse remote hosts. Without it the Postgres suites report as skipped. Each database suite applies the Supabase role shim, the original migration, and then the new one, in production order.

Layout: `public/` (site), `api/` (Vercel entry points), `src/handler.ts` (routes), `src/db.ts` (installations store), `src/slack.ts` (Slack client), `src/messages.ts` (DM and Home text, links), `src/oauth-state.ts` (state cookie), `src/vercel.ts` (environment wiring, `waitUntil`), `supabase/migrations/`. Tests live in `test/`.

Environment contract: [`.env.example`](.env.example). Slack URLs under `PUBLIC_SITE_URL`: OAuth redirect `/api/slack/oauth/callback`, events `/api/slack/events`, interactivity `/api/slack/interactions`.

## Verified references

Reviewed November 13, 2026:

- [Vercel Node.js functions in `api/`](https://vercel.com/docs/functions/runtimes/node-js) and [`@vercel/functions` (`waitUntil`, `attachDatabasePool`)](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)
- [Events API: 3-second acknowledgement, `x-slack-retry-num`, retry schedule](https://docs.slack.dev/apis/events-api/)
- [`app_home_opened` (no scope; needs a bot user)](https://docs.slack.dev/reference/events/app_home_opened/) and [`views.publish` (no scope)](https://docs.slack.dev/reference/methods/views.publish/)

Reviewed October 23, 2026:

- [Reaction events and author fields](https://docs.slack.dev/reference/events/reaction_added/)
- [OAuth bot and user scopes](https://docs.slack.dev/authentication/installing-with-oauth/)
- [Bot DM delivery and unfurl settings](https://docs.slack.dev/reference/methods/chat.postMessage/)
