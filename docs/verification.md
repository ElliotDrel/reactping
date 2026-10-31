# V1 verification

Updated October 31, 2026. The latest v1 implementation (`ae03de1`) has been fast-forwarded and pushed to `main`; the primary checkout remains on `main`. Superseded: the implementation was previously available only on `feat/v1`.

October 31 takeover verification: formatting, typecheck, lint, production build, and all 57 tests passed again against `ae03de1`. The remote `main` SHA matched the local checkout, and the repository remained private. Historical live Slack results below were not rerun during this takeover.

## Completed

- `npm run check`: formatting, TypeScript checks, ESLint, production build, and 57 tests pass.
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
- Added secret-safe event outcome logging; the full 57-test check suite passes after adding the explicit self-reaction testing flag.

Superseded: the default channel originally had one member; Tester A has now joined and a second white-check-mark reaction is visible. A positive alert from another person's real Slack reaction is now verified below. Private channels, threads, DMs, group DMs, Slack Connect, and cross-workspace routing remain unverified. The app remains limited to its creation workspace; public distribution was not activated. No release tag or permanent hosting deployment has been created.

Next: have another Slack member add a fresh reaction to the test message and follow [the live coverage checklist](live-checklist.md). The local service and temporary tunnel remain running for that test; stopping them makes the test URL unavailable.

See [setup](setup.md) for configuration and the test procedure. Live authorization remains subject to the selected workspace's app policy.

## October 24: missing notification and recovery

- The temporary tunnel was replaced while Slack still pointed to its old hostname. No deliveries were recorded in the live queue. Tester A's reaction is visible on the source message, but its callback was not observed; it is not counted as delivered.
- Updated both Slack manifest URLs to the replacement tunnel host and reverified the Events API endpoint. Slack shows **Verified** and events **On**. The installation remains active.
- Enabled `INCLUDE_SELF_REACTIONS=true` in the ignored local `.env` for testing. The committed default remains `false`; both modes only notify about the connected user's own messages.
- Added a real eyes reaction as Elliot to the test message. A signed Slack callback was logged as `enqueued`; delivery `Ev0CBCHSRCGP` reached `sent` in one attempt with no error. Read back the [real notification DM](https://example-workspace.slack.com/archives/D0000000000/p1792816251770189) in Chrome, including the eyes emoji, Elliot mention, and original-message link. This supersedes the earlier absence of a positive real-reaction test; another person's successful delivery was subsequently verified below.
- Restarting a quick tunnel requires updating both Slack URLs and verifying a new real reaction before declaring testing ready. This local session remains dependent on the service, tunnel, and computer staying running. Permanent hosting remains pending.

## October 24: repeat self-reaction and second-person verification

- Added a fresh real tada reaction as Elliot through Chrome. Event `Ev0CBXLY5RM2` produced exactly one delivery, `sent` in one attempt with no error. Read back the [self-reaction notification](https://example-workspace.slack.com/archives/D0000000000/p1792816965603799) in Slack. Self-reaction testing is working and remains enabled locally.
- Also read back [Tester A's real white-check-mark notification](https://example-workspace.slack.com/archives/D0000000000/p1792816343696819). Event `Ev0CBXKKAY2G` records reactor `U0000000002`, `sent` in one attempt with no error. This supersedes the earlier unverified second-person delivery status.
