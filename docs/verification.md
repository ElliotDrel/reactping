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

## Awaiting Slack sign-in and live setup

Slack app management in Chrome required sign-in. No app, OAuth grant, live reaction test, public deployment, or release tag has been created. No real Slack messages have been sent.

Next: sign in to Slack in Chrome, create the app from the manifest, configure a public HTTPS endpoint and local secrets, then run [the live coverage checklist](live-checklist.md). Public/private channels, threads, DMs, group DMs, and Slack Connect remain unverified.

See [setup](setup.md) for configuration and the test procedure. Live authorization remains subject to the selected workspace's app policy.
