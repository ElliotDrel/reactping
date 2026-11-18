# V1 verification

## November 17, 2026: Disconnect and uninstall

- Disconnect: Elliot selected Disconnect on ReactPing's Home tab in a second workspace. Logs showed `installation_disconnected` then `tokens_revoked` (installations 0, already deleted); the workspace's row was gone from `reactping_slack.installations`.
- Uninstall: Elliot then removed ReactPing from both workspaces. The remaining row was deleted and `reactping_slack.activity` recorded `uninstalled` (1 install) for that workspace. Installations table now empty.
- Superseded: the November 15 "lifecycle checks skipped" entry below.

## November 16, 2026: message preview

Elliot reports a real reaction from another person produced a DM with "your message" as the link and the quoted preview of the reacted-to message (owner-confirmed live coverage). This confirms `reactions.get` returns message text with the existing `reactions:read` user token; no new scope was needed. 80 local tests pass.

## November 15, 2026: second-workspace report and accepted idle-pause risk

Elliot reports that adding ReactPing to a second workspace worked and subsequently confirmed receipt of the reaction DM. This is owner-confirmed live installation and normal-mode delivery coverage, not an independently inspected message. Superseded: the earlier second-workspace reaction-DM verification item is complete by owner report. The core v1 pilot path is complete; lifecycle checks stay skipped/unverified and the idle-pause risk remains accepted.

**Accepted availability risk (November 15, 2026):** Supabase Free projects may pause after about a week of low activity. Removing the every-minute delivery cron also removed that regular background traffic. If this project pauses, ReactPing cannot access its database and notifications stop until the project is restored from the [Supabase dashboard](https://supabase.com/dashboard/project/ykrdmgewztwzksgwbjue). Reactions missed while paused are not backfilled. Elliot accepts this risk: do not add a keep-alive. Superseded: the old idle-week availability check is no longer a remaining launch requirement. See [Supabase availability guidance](https://supabase.com/docs/guides/deployment/going-into-prod#availability).

## November 15, 2026: lifecycle checks skipped; unlisted distribution enabled

Elliot explicitly chose skip for live Disconnect, reinstall, revocation, and uninstall. All remain skipped/unverified; no production installation was disconnected, reinstalled, revoked, or uninstalled. This supersedes earlier requests for approval and pending-lifecycle wording. Superseded: the tag decision was initially pending. Elliot approved v0.1.0 on November 15 with these checks explicitly skipped/unverified.

At Elliot's request, enabled unlisted public distribution in Slack after checking the OAuth/HTTPS checklist and confirming no hard-coded workspace credentials in the runtime. Slack now shows Share Your App with Any Workspace and Deactivate Public Distribution. The existing installation stays active. Second-workspace behavior is not yet verified. Use https://reactping.vercel.app/api/slack/install so the CSRF cookie is set; do not distribute Slack's raw authorization link.

Superseded: November 13 README status wording that incorporated November 14 observations. The dated sections below remain historical evidence.

## November 14, 2026: another person's reaction, normal mode

After `INCLUDE_SELF_REACTIONS=false` was redeployed, Tester B reacted to Elliot's [public-channel test message](https://example-workspace.slack.com/archives/C0000000000/p1794673987429139). Read two real ReactPing DMs in Elliot's Slack: [eyes at 16:50:01](https://example-workspace.slack.com/archives/D0000000000/p1794693001935549) and [white check mark at 16:50:18](https://example-workspace.slack.com/archives/D0000000000/p1794693018454269). Both mention Tester B and link to the same correct source message. The default public-channel reaction-to-author notification path is verified.

App Home still shows Connected without the testing-mode notice. No installation was removed. Automatic approval review blocked the attempted Disconnect test because removing/revoking the working production installation was not clearly authorized. Disconnect/reconnect and lifecycle coverage remain pending explicit approval. Superseded: the earlier pending-second-person statements below.

## November 14, 2026: live Slack install and self-reaction test

Configured the existing Slack app with the production callback, events, and interactivity URLs, Home enabled, and distribution still off. Slack verified the event URL. Completed real OAuth; an expired approval flow was rejected first, then a fresh flow succeeded. Read the [welcome DM](https://example-workspace.slack.com/archives/D0000000000/p1794673880859179) in Slack and confirmed Home shows Connected with Disconnect.

With Elliot's explicit approval, temporarily enabled `INCLUDE_SELF_REACTIONS=true` and deployed. A real eyes reaction by Elliot to the [labelled test message](https://example-workspace.slack.com/archives/C0000000000/p1794673987429139) produced a [real notification DM](https://example-workspace.slack.com/archives/D0000000000/p1794674234639119); its link opened the original message. This verifies self-reaction testing only, not a second person in default mode. The flag was then set back to false for the normal-mode deployment.

Elliot will ask Tester A to react to that test message next. Leave the installation connected for that test. Disconnect, reinstall, revocation, uninstall, and other conversation types remain unverified. Superseded: prior statements that Slack configuration or live testing was still awaiting authorization. Temporary screenshots were removed during the authorized November 15 local cleanup; the Slack message permalinks above retain the live evidence.

## November 13, 2026: Slack-only production and provider cleanup

Deployed `70b62e664656cf6a7ea70e9ca6c28f93d2d5f674` to [production](https://reactping.vercel.app) as [deployment `dpl_2ZvWj1DaHky59cCKtF1BogjLtimw`](https://vercel.com/elliot-drels-projects/reactping/2ZvWj1DaHky59cCKtF1BogjLtimw). Vercel built four standard Node 24 functions. Before cleanup, hosted checks passed: `/` and `/privacy` 200 with security headers/noindex; removed pages, old API routes, and an unknown path 404; install 302 to Slack with a Secure/HttpOnly cookie (redirect not followed); callback with no state cookie 400; events/interactions with missing or invalid signatures 401. No request went to Slack.

Only after these checks:

- Inspected legacy objects: five `reactping` tables, their indexes/owned sequence, and no functions. Account, installation, OAuth state, delivery, and Auth user counts were all zero. The one cron job and both Vault values matched this ReactPing deployment.
- Unscheduled `reactping-deliver`, removed its run history, and deleted Vault secrets `reactping_delivery_url` and `reactping_delivery_secret`.
- Applied new migration `20261114000000_remove_account_backend.sql`, explicitly dropping the old tables and schema without `CASCADE`. Read-back confirms no old schema/job/secrets and an intact `reactping_slack.installations` table. Original migration unchanged. Supabase-managed schemas/extensions were not dropped.
- Deleted six unused Vercel production variables: `DELIVERY_CRON_SECRET`, `PUBLIC_INSTALL_ENABLED`, `REACTPING_INSTALLS_ENABLED`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `PUBLIC_SITE_INDEXABLE`. Retained the eight Slack/Postgres settings in `.env.example`.
- Disabled the Supabase email provider; kept signups closed; reset Auth Site URL to `http://localhost:3000`, cleared the redirect allow-list, and restored OTP length to its prior 8. No custom SMTP or email template had been successfully configured, and no Auth identities needed deletion.

Independent local checks pass: format, typecheck, lint, build, **66/66 tests** against disposable Postgres, including cleanup with an encrypted Slack installation preserved. Production dependency audit: zero vulnerabilities. Corrected pilot copy to say installs are limited to the app's own workspace; confirmed the distribution policy and `app_redirect` syntax in [Slack's distribution](https://docs.slack.dev/app-management/distribution/) and [deep-link documentation](https://docs.slack.dev/interactivity/deep-linking/).

Remaining: apply the Slack manifest and run the live checklist only after authorization. No real OAuth, welcome/reaction DM, Home interaction, Disconnect, or lifecycle event has been tested on the simplified version. The following local-only and account-backed sections are superseded history.

## November 13, 2026: Slack-only simplification (local only)

Committed on `main`; not pushed or deployed. Removed Supabase Auth and email codes, the `/app` dashboard and browser client, cross-workspace routing and consent, the Postgres outbox (leases, backoff, persisted rate-limit pauses, retention purge), `/api/internal/deliver`, `/api/health`, the cron template, the install flags, and the Build Output API generator with its multi-page site. Added Slack OAuth identity, a signed stateless OAuth state cookie, App Home with Disconnect, welcome DM, lifecycle-event cleanup, and one additive table `reactping_slack.installations`.

- Checks with disposable local Postgres 17 (`TEST_DATABASE_URL` on 127.0.0.1): formatting, typecheck, lint, build, and the new suite pass; see the commit message for the exact counts. Each database suite applies the role shim, the original migration, then the new one.
- `npm audit --omit=dev`: 0 vulnerabilities, with `@vercel/functions` pinned to 3.10.6 (3.10.5 and earlier pull an `@vercel/oidc` with a high `zod` advisory).
- `vercel build` (CLI 65.14.0) on a scratch copy with offline placeholder project settings and no credentials: completed, emitting one `nodejs24.x` function per `api/` file with `.ts` imports rewritten to `.js`. The compiled events function loaded under Node and answered `503 not_configured` without environment variables.
- Retained guarantees and their tests: Slack signatures and the 5-minute window; body limits; OAuth state tamper, expiry, and wrong-browser rejection; OAuth identity, scope, Enterprise, and workspace-URL validation with rejected-grant revocation that spares an existing installation; workspace/user isolation; self-reaction filtering; text-only archive links; immediate acknowledgement with deferred work and ignored retries; lifecycle cleanup; Disconnect identity from the signed payload only, deleting exactly one row and never the shared bot token; RLS and grants; AES-GCM associated data binding tokens to row and field; verified remote TLS. Dropped with their mechanisms: the 85 tests for accounts, consent, outbox leases, backoff, rate-limit pauses, cron, test DMs, account deletion, and the site generator.
- Not verified: anything hosted, and every Slack behavior on this code. See the [live checklist](live-checklist.md).

## November 13, 2026: hosted connection, Slack testing withheld

Superseded by the Slack-only simplification above, including the email blocker and the remaining-work list in this section. Superseded: the November 11 locally checked, not-deployed status. Deployed implementation `1a07de3ad8e6c12a39641af13fb610ece2e6498c` to [Vercel production](https://reactping.vercel.app), deployment `dpl_5H7NMrxou21S6FRZbG3nSAjZ2M8T` ([deployment details](https://vercel.com/elliot-drels-projects/reactping/5H7NMrxou21S6FRZbG3nSAjZ2M8T)). The Vercel project uses Node 24 and the generated Build Output API function. The private repository remains private.

- Applied migration `20261110000000_reactping.sql` to the new [Supabase project](https://supabase.com/dashboard/project/ykrdmgewztwzksgwbjue). All five private tables have RLS enabled, with zero table grants to `anon`, `authenticated`, or `PUBLIC`. The client-to-pooler TLS connection verifies successfully using the Supabase CA in server-only `DATABASE_CA`; certificate verification was never disabled.
- Configured production environment variables, Supabase Auth site URL, six-digit OTP length, and closed public signups. `REACTPING_INSTALLS_ENABLED`, `PUBLIC_INSTALL_ENABLED`, `PUBLIC_SITE_INDEXABLE`, and `INCLUDE_SELF_REACTIONS` are all `false`. No old SQLite records or Slack grants were imported or revoked.
- All eight website routes return 200; an unknown route returns 404. The site sends `X-Robots-Tag: noindex` and robots.txt disallows crawling. `/api/health` returns 200 with `ready: true`, installs disabled, and testing mode off; anonymous `/api/me` returns 401.
- Confirmed zero installations and zero deliveries before the delivery smoke check. The internal delivery endpoint returns 401 without its secret and 200 with `processed: 0` when authorized. Vault and an active every-minute `pg_cron`/`pg_net` job are configured; two scheduled calls returned HTTP 200 with `processed: 0` at 03:19 and 03:20 UTC on November 14 (November 13 local time).
- Hosted `postgres` has DELETE privilege on `auth.users`; actual deletion of a hosted identity remains untested. No OTP email, Slack OAuth, Slack API call, reaction, or DM was sent.

**Email blocker:** the Auth configuration API returned HTTP 400 with `entitlement_required` when setting the code email template: email-template modification is unavailable on free projects with the default sender unless custom SMTP is configured or the plan upgraded. The existing default template contains `ConfirmationURL`, not `Token`. Supabase Auth remains the identity provider; a custom SMTP sender is still required for this code-entry UI. Public signups stay closed. No provider subscription or domain was purchased.

The local recheck exposed a test-only race when parallel suites create cluster-wide mock roles. The shim now tolerates both duplicate-role error forms, preserving parallel coverage. Application code is unchanged. Formatting, typecheck, lint, production build, and all 85 tests pass. The full check after dropping the disposable cluster roles passes 85/85, exercising fresh concurrent role creation.

Remaining: custom SMTP and owner-code sign-in; final domain/support contact and policy approval; the accepted free-tier idle-pause risk documented above (supersedes the idle-week availability check); hosted account cleanup; and the full hosted Slack checklist only after separate authorization.

## November 11, 2026: integration verification (local only)

Integrated the Opus implementation and Sonnet connection guide in `feat/v1`. Independent checks pass: formatting, typecheck, lint, production build, and **85/85 tests**, including real SQL against disposable local Postgres 17. Production dependency audit reports zero vulnerabilities. Superseded: the initial builder suite below had 80 tests.

Sonnet review round 1 found no blockers and identified hardening issues. Fixed verified database TLS with optional provider CA, idle pool errors, runtime budgets, concurrent deletion cleanup, callback notice lookup, effective destination settings, and policy wording. Sonnet review round 2 checked the fixes and returned **ready to connect**, with no blockers or further required code fixes. The optional provider-CA documentation note was incorporated. The optional account-deletion heading suggestion was left as-is: the screen already signs out the local session and explicitly reports incomplete identity or token cleanup. Exactly two code-review rounds were used. Provider verification is still pending. No real Slack events, provider accounts, deployments, or credentials were used.

## November 10, 2026: website and Vercel + Supabase migration (local only)

Built in worktree branch `t3/fd07a5d9`; not pushed, deployed, or live-tested.

- `npm run check` with a disposable local Postgres 17 container (`TEST_DATABASE_URL`): formatting, typecheck, lint, production build, and 80 tests pass. Without the database, 18 tests pass and the 4 Postgres suites report as skipped. The test-migration note mapping the 57 v1 tests to that suite has since been removed with the suite it described.
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
