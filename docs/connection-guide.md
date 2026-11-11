# Connection guide: ready to connect

Target state: **ready to connect**, not deployed. This guide covers what must be true locally, what the owner supplies, and the order in which providers are connected once Elliot authorizes it. Nothing here claims the Node.js website/API, the Postgres schema, or the Supabase migration has been verified against a real provider. Exact file names, scripts, and variable names come from the implementation; `<operator input>` marks values not yet decided or available.

## 1. Architecture being connected

- **Vercel:** one Node.js website and API. No Astro, no Edge/Deno runtime. Vercel's free plan is personal/non-commercial use only; confirm current terms before any public or commercial launch.
- **Supabase:** Auth (email OTP) and Postgres. Free projects can pause after inactivity and have quotas; check current limits and pricing in Supabase's docs rather than relying on this guide.
- **Delivery schedule:** `pg_cron` plus `pg_net` call a protected Node delivery endpoint every minute. No Vercel paid cron is needed. The endpoint rejects requests without the internal cron secret.
- **Slack:** Events API and OAuth hit the exact production URLs. Account login (Supabase email OTP) is separate from authorizing each Slack workspace; a Slack authorization is bound to the signed-in account via one-time OAuth state.
- **Secrets:** server secrets live in Vercel environment variables or Supabase Vault. The browser receives only publishable configuration (Supabase project URL and publishable key).

## 2. Local checks required before connecting

All must pass locally with mocks and a disposable local Postgres, with no real credentials:

- Format, typecheck, lint, build, and existing tests (`npm run check` today; use whatever the new implementation documents).
- Schema applies cleanly to an empty local Postgres, including the `pg_cron`/`pg_net` job definition (or its local stand-in).
- Account and workspace isolation: one account cannot read or alter another's installations, settings, or deliveries.
- Cross-workspace routing is blocked without explicit consent, and consent is rechecked at delivery.
- Source credentials are stored encrypted only; no token, OAuth code, signing secret, cron secret, or raw message content appears in logs or the browser bundle.
- The delivery endpoint rejects missing or wrong cron secrets and is safe to call twice (deduplicated).
- Slack signature check, expired/reused OAuth state, and revocation handling pass against the mocked Slack API.
- Default install is **disabled** and preview deployments send `noindex`.

**Still unverified with real providers:** Supabase email OTP delivery, custom SMTP, RLS/grants on the hosted project, `pg_cron`/`pg_net` reaching Vercel, Vercel runtime behavior, Slack OAuth and Events against the production URL, and every row of the [live checklist](live-checklist.md) against the new code.

## 3. Inputs the owner supplies later

No values go in this repository or in chat logs.

| Input                                                                                                | Where it goes                                                           |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Production domain / canonical host (`<operator input>`; buying a domain is not a coding blocker)     | Vercel domain, Supabase Auth URLs, Slack app URLs                       |
| Support contact (`<operator input>`; do not invent an inbox)                                         | Site and email templates                                                |
| Supabase project URL and publishable key                                                             | Browser-safe config                                                     |
| Supabase service-role/secret key and/or database connection string, only as the implementation needs | Server-only: Vercel env                                                 |
| Slack Client ID, Client Secret, Signing Secret                                                       | Client ID may be public config; secret and signing secret server-only   |
| Stable 32-byte encryption key, generated once                                                        | Server-only; losing or rotating it without a plan strands stored tokens |
| Internal cron secret (long random value)                                                             | Vercel env and Supabase Vault, used by the `pg_net` call                |
| SMTP provider, host, port, credentials, sender address and name                                      | Supabase Auth custom SMTP                                               |

## 4. Connection order (after Elliot authorizes)

1. **Supabase project:** create or select it; apply the migration; confirm tables have RLS/grants as designed; set Auth Site URL and redirect allow-list to the exact production host. Add preview URLs only if needed, kept separate.
2. **Custom SMTP:** Supabase's built-in email is only for team/testing and is heavily limited; email OTP for general users requires custom SMTP with a verified sender domain (SPF/DKIM per the provider). Test with one owner-controlled address.
3. **Vercel:** import the repository, set env vars (server secrets server-only; only publishable values exposed to the browser), keep the install **disabled** and previews `noindex`, deploy a preview.
4. **Preview vs production URLs:** Slack and Supabase Auth must use the exact production origin for Redirect URL (OAuth callback) and Event Request URL. Preview URLs change per deployment and must not be registered as production Slack URLs.
5. **Cron:** store the cron secret in Vault, create the `pg_cron` job that uses `pg_net` to call the delivery endpoint every minute with the secret. Check `cron.job_run_details` and the response status.
6. **Slack app:** set the production URLs, scopes (user `reactions:read`, bot `chat:write`), and credentials per [setup](setup.md). Slack verifies the Event Request URL on save, so the service must be live first.
7. **Launch flip:** enable installs only after steps 1–6 pass and Elliot explicitly declares launch readiness; then allow indexing on production only.

## 5. Read-only, bounded provider tests

Run only after Elliot authorizes; stop at the first surprise.

- Auth: request an OTP to an owner-controlled address, sign in, sign out. Confirm the browser bundle and network responses contain no server secret.
- Database: read-only checks (tables exist, RLS enabled, Supabase advisors clean, `pg_cron` job present).
- Cron: call the delivery endpoint once with the correct secret (expect success on an empty queue) and once without (expect rejection). Then observe one scheduled run.
- Health: `GET` health route on the production host returns healthy.
- **No live Slack action** (no OAuth, no reactions, no DMs) until Elliot separately authorizes the live checklist.

## 6. Existing SQLite installation

- Treat the current SQLite file, its `ENCRYPTION_KEY`, and the Slack tokens it holds as sensitive. Do not delete, overwrite, or commit them, and keep them until the operator chooses a path.
- Choose one explicitly:
  - **Reconnect (default):** users reauthorize each workspace in the new service. Simplest and needs no key transfer. Then revoke or disconnect the old installation deliberately.
  - **Supported migration:** only if the implementation ships a documented, tested importer. Do not assume stored tokens can be moved automatically, or that the old key derivation matches the new encryption scheme.
- The old and new services must not both receive the same Slack Request URL; Slack allows one.

## 7. Live verification after migration

Historical results in [verification](verification.md) and the [live checklist](live-checklist.md) were observed against the old SQLite service and are **not coverage for the new code**. After migration and only with Elliot's authorization, rerun the full checklist (install, OAuth state rejection, reaction coverage, filtering, cross-workspace consent, restart/retry, revocation, log hygiene) against the production deployment and record fresh dates and results. Until then, every row for the new service is unverified.
