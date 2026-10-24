# ReactPing

Bot DMs when someone reacts to your Slack messages, with an optional single inbox across connected workspaces.

Status: v1 implemented and covered by automated tests against a mocked Slack API. A real public-channel reaction has delivered a bot DM. Broader live coverage and permanent deployment are pending; see [the live checklist](docs/live-checklist.md).

## V1

- Authorize each source workspace with user-level `reactions:read`.
- Select one connected workspace as the destination, or deliver within each source workspace.
- Notify only when `item.type` is `message`, `item_user` matches a connected user in that workspace, and the reactor is someone else.
- Send the reaction, source workspace, and a link to the original message. No message excerpts, history ingestion, or content storage. Disable link/media unfurls.
- Link workspace identities through a signed-in session and one-time OAuth state; never infer account ownership from matching display names or email addresses.
- Provide disconnect and deletion of stored credentials.

Each workspace requires authorization under its own app policies. Connecting a source to another workspace exports reaction metadata, even without message text: make routing explicit and default to same-workspace delivery.

## Smallest architecture

One TypeScript/Node service using the Slack Web API client (`@slack/web-api`), a small `node:http` receiver for OAuth and the Events API over public HTTPS, and SQLite (`node:sqlite`) on a persistent volume. Bolt was not needed: session-bound OAuth state and acknowledge-after-durable-write are simpler to implement directly. (Superseded: earlier drafts named Slack Bolt.) One process can accept events and drain a durable delivery table; no separate queue service, dashboard framework, or microservices.

Store encrypted installation credentials, linked workspace/user IDs, routing preferences, and short-lived event/delivery records. Acknowledge events after durable receipt, deduplicate by Slack event ID and recipient, retry transient failures with backoff, honor rate limits, and surface revoked credentials. Do not promise exactly-once delivery after an ambiguous Slack API timeout.

Start with user `reactions:read` and bot `chat:write`. Resolve original-message links with the source user's token; verify required scopes and behavior in the live spike. Prefer source user mentions for same-workspace alerts; use a neutral actor label across workspaces until name lookup is explicitly justified. Add no history scopes for previews.

## Today's shipping sequence

1. Prove the risky integration first: a real user-authorized reaction event and a bot DM, then public/private channels, thread replies, 1:1 DMs, and group DMs. Record observed coverage rather than assuming it.
2. Build workspace authorization, secure account linking, destination selection, and disconnect.
3. Build verified request handling, durable deduplication/delivery, filtering, minimal notification formatting, token encryption, and secret-safe logs.
4. Test retries, duplicate events, wrong authors, self-reactions, workspace isolation, invalid signatures, expired OAuth state, and revoked authorization.
5. Deploy one HTTPS service with persistent storage; verify reactions from two authorized workspaces reach the chosen bot DM, including restart/retry behavior. Document installation, supported coverage, scopes, retention, and recovery. Tag v0.1.0 after the live pilot passes.

Ship criterion: a hosted pilot works end to end for Elliot across two workspaces with documented coverage and no message-content collection. Public distribution and Marketplace submission are subsequent releases; this repository stays private until Elliot requests otherwise.

## Deferred

Billing, analytics dashboards, digests, per-emoji filters, message previews, historical backfill, Marketplace submission, and organization-wide deployment.

## Development setup

Normal behavior excludes your own reactions to your messages. For solo testing, set `INCLUDE_SELF_REACTIONS=true` in `.env` and restart; the settings page displays a testing notice. The flag defaults to `false` and never enables notifications about other people's messages.

Requires Node 24+. See [setup and run](docs/setup.md) for the Slack app, tunnel, and environment.

```sh
npm ci
npm run check    # format:check, typecheck, lint, build, test
npm run format   # prettier --write
npm run dev      # run src/ with .env
```

Layout: `src/web.ts` (routes, sessions, CSRF, OAuth), `src/events.ts` (signature check, filtering, routing), `src/delivery.ts` (durable outbox worker), `src/db.ts` (SQLite schema and storage), `src/slack.ts` (Slack client and error mapping). Tests live in `test/`.

## Verified references

Reviewed October 23, 2026:

- [Reaction events and author fields](https://docs.slack.dev/reference/events/reaction_added/)
- [Events API authorization, subscriptions, and delivery](https://docs.slack.dev/apis/events-api/)
- [OAuth bot and user scopes](https://docs.slack.dev/authentication/installing-with-oauth/)
- [Bot DM delivery and unfurl settings](https://docs.slack.dev/reference/methods/chat.postMessage/)
