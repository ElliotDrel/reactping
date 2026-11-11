# Connection guide: ready to connect

Target state: **ready to connect**, not deployed. This guide covers what must be true locally, what the owner supplies, and the order in which providers are connected once Elliot authorizes it. Nothing here claims the Node.js website/API, the Postgres schema, or the Supabase migration has been verified against a real provider. The technical contract is in [setup](setup.md) and [`.env.example`](../.env.example); `<operator input>` marks values not yet decided or available.

## 1. Architecture being connected

- **Vercel:** one Node.js website and API. No Astro, no Edge/Deno runtime. Vercel's free plan is personal/non-commercial use only; confirm current terms before any public or commercial launch.
- **Supabase:** Auth (email OTP) and Postgres. Free projects can pause after inactivity and have quotas; check current limits and pricing in Supabase's docs rather than relying on this guide.
- **Delivery schedule:** `pg_cron` plus `pg_net` call a protected Node delivery endpoint every minute. No Vercel paid cron is needed. The endpoint rejects requests without the internal cron secret.
- **Slack:** Events API and OAuth hit the exact production URLs. Account login (Supabase email OTP) is separate from authorizing each Slack workspace; a Slack authorization is bound to the signed-in account via one-time OAuth state.
- **Secrets:** server secrets live in Vercel environment variables or Supabase Vault. The browser receives only publishable configuration (`PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY`).

## 2. Local checks required before connecting

All must pass locally with mocks and a disposable local Postgres, with no real credentials. Start the disposable database with `npm run db:test:start`, set `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres` in the shell, then run `npm run check`. Stop it with `npm run db:test:stop`. Never use a hosted database for these tests: the harness creates and drops disposable test databases.

- Format, typecheck, lint, build, and existing tests (`npm run check` today; use whatever the new implementation documents).
- Schema applies cleanly to an empty local Postgres, using `supabase/migrations/20261110000000_reactping.sql`. The hosted-only job in `supabase/cron.template.sql` is a separate provider verification; plain local Postgres does not verify Vault, `pg_cron`, or `pg_net`.
- Account and workspace isolation: one account cannot read or alter another's installations, settings, or deliveries.
- Cross-workspace routing is blocked without explicit consent, and consent is rechecked at delivery.
- Source credentials are stored encrypted only; no token, OAuth code, signing secret, cron secret, or raw message content appears in logs or the browser bundle.
- The delivery endpoint rejects missing or wrong cron secrets and is safe to call twice (deduplicated).
- Slack signature check, expired/reused OAuth state, and revocation handling pass against the mocked Slack API.
- Default install is **disabled** and preview deployments send `noindex`.

**Still unverified with real providers:** Supabase email OTP delivery, custom SMTP, RLS/grants on the hosted project, `pg_cron`/`pg_net` reaching Vercel, Vercel runtime behavior, Slack OAuth and Events against the production URL, and every row of the [live checklist](live-checklist.md) against the new code.

## 3. Inputs the owner supplies later

Secret values belong in provider secret settings, never in Git or chat logs. The public settings below are intentionally included in the browser build.

| Input                                                                                            | Where it goes                                                           |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `PUBLIC_SITE_URL` (production canonical origin; `<operator input>`)                              | Vercel domain, Supabase Auth URLs, Slack app URLs                       |
| `PUBLIC_SUPPORT_EMAIL` (`<operator input>`; do not invent an inbox)                              | Site and email templates                                                |
| `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY`                                      | Browser-safe config                                                     |
| `DATABASE_URL` (Supabase transaction-pooler connection, port 6543; no service-role key required) | Server-only: Vercel env                                                 |
| Slack Client ID, Client Secret, Signing Secret                                                   | Client ID may be public config; secret and signing secret server-only   |
| `ENCRYPTION_KEY` (32 bytes, base64, generated once)                                              | Server-only; losing or rotating it without a plan strands stored tokens |
| `DELIVERY_CRON_SECRET` (at least 32 characters)                                                  | Vercel env and Supabase Vault, used by the `pg_net` call                |
| SMTP provider, host, port, credentials, sender address and name                                  | Supabase Auth custom SMTP                                               |

`DATABASE_CA` is an optional server-only PEM CA certificate. Remote Postgres uses verified TLS; omit SSL query parameters in `DATABASE_URL` and never disable certificate verification.

## 4. Connection order (after Elliot authorizes)

1. **Supabase project:** create or select it; apply the migration; confirm tables have RLS/grants as designed; set Auth Site URL and redirect allow-list to the exact production host. Add preview URLs only if needed, kept separate.
2. **Custom SMTP and signup controls:** Before exposing sign-in publicly, configure Supabase Auth CAPTCHA and its matching browser integration, or restrict signups to invited pilot accounts. Closing Slack installs alone does not close Supabase signups. **Custom SMTP:** Supabase's built-in email is only for team/testing and is heavily limited; email OTP for general users requires custom SMTP with a verified sender domain (SPF/DKIM per the provider). Test with one owner-controlled address.
3. **Vercel:** import the repository, set env vars (server secrets server-only; only publishable values exposed to the browser), keep the install **disabled** and previews `noindex`, deploy a preview.
4. **Preview vs production URLs:** Slack and Supabase Auth must use the exact production origin for Redirect URL (OAuth callback) and Event Request URL. Preview URLs change per deployment and must not be registered as production Slack URLs.
5. **Cron:** store the cron secret in Vault, create the `pg_cron` job that uses `pg_net` to call the delivery endpoint every minute with the secret. Check `cron.job_run_details` and the response status.
6. **Slack app:** set the production URLs, scopes (user `reactions:read`, bot `chat:write`), and credentials per [setup](setup.md). Slack verifies the Event Request URL on save, so the service must be live first.
7. **Launch flip:** enable installs only after steps 1–6 pass and Elliot explicitly declares launch readiness; then allow indexing on production only.

## 5. Bounded provider smoke tests (some change state)

Run only after Elliot authorizes; stop at the first surprise. OTP sign-in/sign-out creates authentication state, and the delivery endpoint can send any queued notifications. For the delivery smoke test, use an isolated test project and verify its queue is empty first.

- Auth: request an OTP to an owner-controlled address, sign in, sign out. Confirm the browser bundle and network responses contain no server secret.
- Database: read-only checks (tables exist, RLS enabled, Supabase advisors clean, `pg_cron` job present).
- Cron: call the delivery endpoint once with the correct secret (expect success on an empty queue) and once without (expect rejection). Then observe one scheduled run.
- Health: `GET` health route on the production host returns healthy.
- **No live Slack action** (no OAuth, no reactions, no DMs) until Elliot separately authorizes the live checklist.

## 6. Existing SQLite installation

- Treat the current SQLite file, its `ENCRYPTION_KEY`, and the Slack tokens it holds as sensitive. Do not delete, overwrite, or commit them, and keep them until the operator chooses a path.
- Choose one explicitly:
  - **Reconnect (default):** users reauthorize each workspace in the new service. Simplest and needs no key transfer. Do not blindly revoke tokens in the old service after reconnecting: Slack bot grants can be shared with the new installation. Stop the old worker and protect its data; reconcile the actual shared grants before deliberately retiring credentials.
  - **Supported migration:** only if the implementation ships a documented, tested importer. Do not assume stored tokens can be moved automatically, or that the old key derivation matches the new encryption scheme.
- Slack has one configured Events Request URL for this app. Switch it deliberately after the new deployment is ready; stop the old worker so it cannot continue draining previously queued notifications.

## 7. Live verification after migration

Historical results in [verification](verification.md) and the [live checklist](live-checklist.md) were observed against the old SQLite service and are **not coverage for the new code**. After migration and only with Elliot's authorization, rerun the full checklist (install, OAuth state rejection, reaction coverage, filtering, cross-workspace consent, restart/retry, revocation, log hygiene) against the production deployment and record fresh dates and results. Until then, every row for the new service is unverified.

## 8. Exact launch flags and routes

- `PUBLIC_INSTALL_ENABLED` changes website presentation only; `REACTPING_INSTALLS_ENABLED` enables new Slack connections on the server. Both default to `false`.
- `PUBLIC_SITE_INDEXABLE` controls production indexing; Vercel previews stay `noindex`. `INCLUDE_SELF_REACTIONS` is testing only and defaults to `false`.
- Callback: `/api/slack/oauth/callback`; events: `/api/slack/events`; protected delivery: `/api/internal/deliver`; health: `/api/health`.
- The email template sends `{{ .Token }}` as a code. No email link callback is required for this OTP flow.
- The Node build emits `.vercel/output` with the static site and a bundled `nodejs24.x` API function. Configure Vercel as framework preset **Other**; see [setup](setup.md).
- Account deletion also attempts deletion from `auth.users` using the owner database connection. Hosted permissions remain unverified; a partial outcome is reported explicitly rather than claiming the login identity was deleted.
