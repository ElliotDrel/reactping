# Setup and run

ReactPing is one Node 24+ process with a SQLite file. Slack must reach it over public HTTPS.

## 1. Install and verify locally

```sh
npm ci
npm run check   # format:check, typecheck, lint, build, test
```

## 2. Get a public HTTPS URL

Any TLS-terminating tunnel or host works. Examples (not installed by this repo):

- `cloudflared tunnel --url http://localhost:3000`
- `ngrok http 3000`

Copy the `https://…` origin. Quick tunnels change hostname on restart; when that happens, update `BASE_URL` and both URLs in the Slack app.

If Cloudflare inherits an existing configuration and the quick tunnel returns an unexpected 404, use a dedicated YAML config containing only `url: http://localhost:3000`, then run `cloudflared tunnel --config <path-to-that-file> --no-autoupdate --url http://localhost:3000`. Preserve the user's global Cloudflare configuration.

## 3. Create the Slack app

1. Open [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest**.
2. Paste `slack-manifest.template.yaml` with `YOUR_PUBLIC_HOST` replaced by the tunnel host. This configures:
   - Redirect URL: `https://YOUR_PUBLIC_HOST/slack/oauth/callback`
   - Event Request URL: `https://YOUR_PUBLIC_HOST/slack/events`
   - User scope `reactions:read`; bot scope `chat:write`
   - User event `reaction_added`; bot events `app_uninstalled`, `tokens_revoked`
   - Token rotation off (ReactPing does not implement refresh tokens)
3. From **Basic Information**, copy the Client ID, Client Secret, and Signing Secret.
4. To connect a second workspace, enable **Manage Distribution → Activate Public Distribution**. This only allows installs via your own link; it is not a Marketplace listing.

Slack verifies the Request URL when you save it, so the service must be running (step 4) first. If manifest import rejects the event URL, create the app, start the service, then re-save the URL under **Event Subscriptions**.

## 4. Configure and run

```sh
cp .env.example .env    # then fill in values
npm run dev             # runs src/ directly with .env
# or: npm run build && node --env-file=.env dist/index.js
```

Health check: `GET /healthz` → `{"ok":true}`.

Docker (persistent volume for the database):

```sh
docker build -t reactping .
docker run --env-file .env -e DATABASE_PATH=/data/reactping.sqlite -p 3000:3000 -v reactping-data:/data reactping
```

## 5. Use it

1. Open `BASE_URL` in a browser → **Get started**. This creates a ReactPing account tied to that browser session (30 days). There is no email login; clearing cookies means starting over and reconnecting.
2. **Connect a Slack workspace** for each workspace. Each authorization is separate and must be completed in the same browser session.
3. Choose a destination. Default: notifications stay in the workspace where the reaction happened. Sending everything to one workspace requires ticking the cross-workspace consent box.

## Behavior notes

- **Routing:** an event is routed to the connected installation whose `team_id` matches the event and whose Slack user matches `item_user`. The `authorizations` array is not used for routing because Slack includes only one of the installations that can see the event.
- **Filtering:** only `reaction_added` events on the connected user's own messages qualify. Self-reactions are excluded by default. For testing alone, set `INCLUDE_SELF_REACTIONS=true` in `.env` and restart the service; settings show a testing-mode notice. Set it back to `false` and restart to restore the normal behavior. Testing mode still excludes other people's messages and preserves workspace isolation. Messages without `item_user` (e.g. incoming webhooks) are ignored.
- **Delivery:** events are written to SQLite before Slack gets the `200`. A worker drains the outbox every 2 seconds, deduplicated by `(event_id, recipient)`. Transient failures retry with exponential backoff (10 s doubling, capped at 15 min, 8 attempts max). Rate limits from message-link lookup or posting honor the full `Retry-After` and persist a worker pause across restarts. A timeout or network error is ambiguous, so a retry can produce a **duplicate DM**. There is no exactly-once guarantee. Routing and consent are checked again after link lookup; a request already sent to Slack cannot be cancelled.
- **Message link:** fetched at delivery time with the source user's token via `chat.getPermalink`. If that fails, ReactPing falls back to `<workspace url>archives/<channel>/p<ts without dot>`, built from `auth.test`'s workspace URL captured at install. For thread replies the fallback may open the parent channel rather than the thread.
- **Cross-workspace text** says "Someone reacted…" (no `users:read` scope, and the reactor's ID means nothing in another workspace). Same-workspace text mentions the reactor.
- **Revocation:** `tokens_revoked` and `app_uninstalled` wipe the affected tokens and show the workspace as "Revoked — reconnect". Auth errors during message-link lookup or delivery do the same for the affected installation. **Disconnect** removes the local installation immediately, then calls `auth.revoke` on the user token and on the bot token when no other ReactPing user in that workspace still depends on it. If remote revocation fails, the notice explains how to remove the app in Slack.
- **Data kept:** encrypted tokens (AES-256-GCM with a key derived from `ENCRYPTION_KEY`), Slack team/user IDs, workspace name and URL, routing choice, and for `RETENTION_HOURS` the emoji, reactor ID, channel ID, and message timestamp of each delivery. No message text, history, or raw payloads are stored or logged.
- **Not supported in v1:** Enterprise Grid org-wide installs (rejected at OAuth) and token rotation.

## Recovery

- **Restart:** pending deliveries persist in SQLite and resume on boot.
- **Lost `ENCRYPTION_KEY`:** stored tokens can't be decrypted. Delete the database and reconnect every workspace.
- **Changed tunnel host:** update `BASE_URL`, restart the service, and update both the Redirect URL and Event Request URL in Slack. Verify the Event Request URL shows **Verified** with events **On**, then add a fresh reaction and confirm both a queued delivery and its bot DM before testing with others. A healthy `/healthz` alone does not prove Slack is sending to the current host. Reactions missed during downtime are not backfilled by ReactPing.
