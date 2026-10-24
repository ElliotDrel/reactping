# V1 verification

Verified October 23, 2026. Application code is on `feat/v1`; the primary checkout remains on `main`.

## Completed

- `npm run check`: formatting, TypeScript checks, ESLint, production build, and 54 tests pass.
- `npm audit --omit=dev --audit-level=high`: no known runtime dependency vulnerabilities reported.
- Docker image builds and serves `/healthz` with HTTP 200 on Node 24.22.1, running as the non-root `node` user. Disposable smoke container stopped and removed.
- Chrome browser: welcome page, browser session creation, settings page, and saving the same-workspace destination work. Preview used dummy credentials and no connected Slack workspaces.
- Claude Opus 5.5 at medium effort helped implement the service and performed a separate read-only review. Its two token-cleanup findings were fixed and covered by regression tests.
- Independent review added coverage for mid-delivery revocation, consent changes, account transfer, persisted rate-limit pauses through a real SQLite reopen, immediate local disconnect, and graceful worker shutdown.
- Browser testing caught and fixed `Referrer-Policy: no-referrer` causing form submissions to send `Origin: null`; the service now uses `strict-origin-when-cross-origin`.

## Slack setup

The earlier sign-in blocker is superseded: Elliot signed in to Chrome, and ReactPing was created in Test Workspace (`T0000000000`), app ID `A0CBVN3467K`. The minimal manifest was saved and Slack reports the Events API Request URL as **Verified** and events **On**.

Credentials are in ignored `.env` and the SQLite database is ignored. A temporary isolated Cloudflare tunnel forwards to local port `37131`. Its hostname changes on restart; it is a test connection, not a production deployment.

The earlier OAuth approval wait is superseded: Elliot approved the installation, OAuth completed, and ReactPing settings show the workspace **Active** for Slack user `U0000000001`.

## Live results

- A clearly labeled connection-test DM was accepted by Slack and read back in the Chrome Slack UI: [connection-test message](https://example-workspace.slack.com/archives/D0000000000/p1792814058864929).
- A [test message](https://example-workspace.slack.com/archives/C0000000000/p1792814219778789) was posted as Elliot in the default public channel. Elliot's own white-check-mark reaction was visible in Slack. The real signed callback produced `event_processed` with outcome `ignored`, and the live database had zero deliveries, as expected for a self-reaction.
- A **synthetic** event was passed through the real author filter, deduplication, message-link lookup, and delivery worker using the authorized tokens. First receipt returned `enqueued`, repeated receipt returned `duplicate`, and exactly one DM was sent. The [resulting DM](https://example-workspace.slack.com/archives/D0000000000/p1792814297446249) is explicitly labeled synthetic; no actual bot reaction was added to the source message. This test used an isolated in-memory queue, not fabricated production events.
- Added secret-safe event outcome logging; the full 54-test check suite still passes.

The default channel has one member. A positive alert from another person's real Slack reaction remains unverified, as do private channels, threads, DMs, group DMs, Slack Connect, and cross-workspace routing. The app remains limited to its creation workspace; public distribution was not activated. No release tag or permanent hosting deployment has been created.

Next: have another Slack member react to the test message and follow [the live coverage checklist](live-checklist.md). The local service and temporary tunnel remain running for that test; stopping them makes the test URL unavailable.

See [setup](setup.md) for configuration and the test procedure. Live authorization remains subject to the selected workspace's app policy.
