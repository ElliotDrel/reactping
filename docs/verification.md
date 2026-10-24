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

OAuth is prepared at Slack's final **Allow** screen and awaits action-time user approval. No user grant, live reaction test, or release tag has been completed. No real Slack messages have been sent.

Next: approve the ReactPing installation, then run [the live coverage checklist](live-checklist.md). Public/private channels, threads, DMs, group DMs, and Slack Connect remain unverified.

See [setup](setup.md) for configuration and the test procedure. Live authorization remains subject to the selected workspace's app policy.
