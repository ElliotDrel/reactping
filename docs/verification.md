# V1 verification

## November 13, 2026: hosted connection, Slack testing withheld

Superseded: the November 11 locally checked, not-deployed status. Deployed implementation `1a07de3ad8e6c12a39641af13fb610ece2e6498c` to [Vercel production](https://reactping.vercel.app), deployment `dpl_5H7NMrxou21S6FRZbG3nSAjZ2M8T` ([deployment details](https://vercel.com/elliot-drels-projects/reactping/5H7NMrxou21S6FRZbG3nSAjZ2M8T)). The Vercel project uses Node 24 and the generated Build Output API function. The private repository remains private.

- Applied migration `20261110000000_reactping.sql` to the new [Supabase project](https://supabase.com/dashboard/project/ykrdmgewztwzksgwbjue). All five private tables have RLS enabled, with zero table grants to `anon`, `authenticated`, or `PUBLIC`. The client-to-pooler TLS connection verifies successfully using the Supabase CA in server-only `DATABASE_CA`; certificate verification was never disabled.
- Configured production environment variables, Supabase Auth site URL, six-digit OTP length, and closed public signups. `REACTPING_INSTALLS_ENABLED`, `PUBLIC_INSTALL_ENABLED`, `PUBLIC_SITE_INDEXABLE`, and `INCLUDE_SELF_REACTIONS` are all `false`. No old SQLite records or Slack grants were imported or revoked.
- All eight website routes return 200; an unknown route returns 404. The site sends `X-Robots-Tag: noindex` and robots.txt disallows crawling. `/api/health` returns 200 with `ready: true`, installs disabled, and testing mode off; anonymous `/api/me` returns 401.
- Confirmed zero installations and zero deliveries before the delivery smoke check. The internal delivery endpoint returns 401 without its secret and 200 with `processed: 0` when authorized. Vault and an active every-minute `pg_cron`/`pg_net` job are configured; two scheduled calls returned HTTP 200 with `processed: 0` at 03:19 and 03:20 UTC on November 14 (November 13 local time).
- Hosted `postgres` has DELETE privilege on `auth.users`; actual deletion of a hosted identity remains untested. No OTP email, Slack OAuth, Slack API call, reaction, or DM was sent.

**Email blocker:** the Auth configuration API returned HTTP 400 with `entitlement_required` when setting the code email template: email-template modification is unavailable on free projects with the default sender unless custom SMTP is configured or the plan upgraded. The existing default template contains `ConfirmationURL`, not `Token`. Supabase Auth remains the identity provider; a custom SMTP sender is still required for this code-entry UI. Public signups stay closed. No provider subscription or domain was purchased.

The local recheck exposed a test-only race when parallel suites create cluster-wide mock roles. The shim now tolerates both duplicate-role error forms, preserving parallel coverage. Application code is unchanged. Formatting, typecheck, lint, production build, and all 85 tests pass. The full check after dropping the disposable cluster roles passes 85/85, exercising fresh concurrent role creation.

Remaining: custom SMTP and owner-code sign-in; final domain/support contact and policy approval; an actual idle-week availability check; hosted account cleanup; and the full hosted Slack checklist only after separate authorization.

## November 11, 2026: integration verification (local only)

Integrated the Opus implementation and Sonnet connection guide in `feat/v1`. Independent checks pass: formatting, typecheck, lint, production build, and **85/85 tests**, including real SQL against disposable local Postgres 17. Production dependency audit reports zero vulnerabilities. Superseded: the initial builder suite below had 80 tests.

Sonnet review round 1 found no blockers and identified hardening issues. Fixed verified database TLS with optional provider CA, idle pool errors, runtime budgets, concurrent deletion cleanup, callback notice lookup, effective destination settings, and policy wording. Sonnet review round 2 checked the fixes and returned **ready to connect**, with no blockers or further required code fixes. The optional provider-CA documentation note was incorporated. The optional account-deletion heading suggestion was left as-is: the screen already signs out the local session and explicitly reports incomplete identity or token cleanup. Exactly two code-review rounds were used. Provider verification is still pending. No real Slack events, provider accounts, deployments, or credentials were used.

## November 10, 2026: website and Vercel + Supabase migration (local only)

Built in worktree branch `t3/fd07a5d9`; not pushed, deployed, or live-tested.

- `npm run check` with a disposable local Postgres 17 container (`TEST_DATABASE_URL`): formatting, typecheck, lint, production build, and 80 tests pass. Without the database, 18 tests pass and the 4 Postgres suites report as skipped. See [test migration](test-migration.md) for how the 57 v1 tests map to the new suite.
- `npm audit --omit=dev`: 0 vulnerabilities. `@vercel/functions` was evaluated and not used because its dependency tree carried high-severity advisories; `waitUntil` is read from Vercel's request context directly. Dev-only ESLint tooling still reports moderate `minimatch` advisories.
- The built site was served by `npm run dev` with no configuration and checked with headless Chrome (desktop, and an emulated 375 px phone): no horizontal overflow on any route, the mobile menu opens, `/app` shows "Setup not connected", unknown paths return the 404 page, and `/api/health` reports `ready: false`. Screenshots are in ignored `local-evidence/`.
- Not verified: Vercel routing and the `nodejs24.x` runtime on a real deployment, Supabase Auth email codes, deleting `auth.users` on hosted Supabase, pg_cron/pg_net/Vault, and any Slack behavior on this code. Those need the owner's accounts.

Superseded: the sections below describe the v1 SQLite service, including its Docker image (now removed).

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
