# ReactPing

A Slack app that DMs you when someone reacts to your messages. Free and open source under MIT.

**[Add ReactPing to Slack](https://reactping.vercel.app)** · [How it works](https://reactping.vercel.app/how-it-works) · [Security](https://reactping.vercel.app/security) · [Privacy](https://reactping.vercel.app/privacy) · [19-second demo](media/launch-video/reactping-launch.mp4)

## What it does

When someone else reacts to a message you wrote, ReactPing's bot DMs you the emoji, who reacted, a link to the message, and a one-line preview of it. It asks for two permissions: user `reactions:read` and bot `chat:write`.

- **Same workspace only.** A reaction notifies only that workspace's connected author. There is no cross-workspace routing.
- **Slack is the account.** You are your Slack workspace ID plus user ID. No email or password.
- **Stores no messages.** The preview is fetched when the DM is sent and never stored or logged. ReactPing stores encrypted tokens per connected person, workspace-level connect and disconnect events, and a total of notifications sent.
- **Best effort.** Slack's request is acknowledged immediately and the DM is sent right after. Nothing is queued, retried, or backfilled, so an occasional notification can be lost.
- **Disconnect anytime** from ReactPing's Home tab in Slack, or remove the app from the workspace.

## Scope

V1 is the above, plus a welcome DM, the Home tab, and a website feedback form. Deferred: a single inbox across workspaces, digests, per-emoji filters, backfill, billing, and Enterprise Grid installs.

Ship criteria (all met November 17, 2026): the hosted app works end to end in more than one workspace, Disconnect and uninstall delete the person's or workspace's data, and no message content is collected. Live coverage is in [verification](docs/verification.md).

## How it's built

TypeScript on Node 24: a static site in `public/` and six Vercel functions in `api/` sharing one handler (`src/handler.ts`), with Supabase Postgres for storage. [Setup](docs/setup.md) covers the architecture, environment, and self-hosting.

## Development

Requires Node 24+ and Docker for the database tests.

```sh
npm ci
npm run db:test:start                 # disposable Postgres on 127.0.0.1:54329
export TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres
npm run check                         # format:check, typecheck, lint, build (tsc), test
npm run db:test:stop
```

The tests mock Slack, create and drop their own databases, and refuse remote hosts. Without `TEST_DATABASE_URL` the Postgres suites are skipped.

## Contributing, security, license

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Released under the [MIT License](LICENSE).
