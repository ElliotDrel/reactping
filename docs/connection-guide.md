# Connection guide: Slack-only version

Current state (November 13, 2026): the Slack-only version is committed locally and checked against mocks and disposable local Postgres. Production still runs the previous version (Supabase Auth, outbox, cron) with installs off and zero installations or queued deliveries. Superseded: the email/SMTP launch blocker and the account, consent, and cron steps of the previous guide. The technical contract is in [setup](setup.md) and [`.env.example`](../.env.example); dated evidence is in [verification](verification.md).

## 1. What changes for providers

- **Vercel:** static `public/` plus four functions in `api/` (Node 24). No Build Output API output, no cron.
- **Supabase:** Postgres only. One new private table, `reactping_slack.installations`. Supabase Auth, SMTP, Vault, `pg_cron`, and `pg_net` are no longer needed by ReactPing.
- **Slack:** OAuth is the only identity. Home tab, interactivity, and three bot events are added to the app configuration.

## 2. Deployment order (migration safety)

The old migration `20261110000000_reactping.sql` must stay unchanged. The new migration is additive, so it is safe to apply before or with the deploy; the destructive cleanup comes last, as its own migration.

1. **Apply the additive migration** `20261113000000_reactping_slack_installations.sql`. The running old version ignores the new schema.
2. **Deploy this commit.** Keep `PUBLIC_SITE_URL`, `DATABASE_URL`, `DATABASE_CA`, the three Slack values, `ENCRYPTION_KEY`, and `INCLUDE_SELF_REACTIONS=false`. Delete the removed variables (listed in [setup](setup.md)) after deploying; they are ignored meanwhile.
3. **Hosted checks without Slack calls:**
   - `/` and `/privacy` return 200 with the `vercel.json` security headers and `X-Robots-Tag: noindex`; an unknown path returns the 404 page.
   - `GET /api/slack/install` returns 302 to `slack.com/oauth/v2/authorize` with a `__Host-` HttpOnly Secure Lax cookie. Do not follow it.
   - `GET /api/slack/oauth/callback?state=x&code=y` without the cookie returns 400 "This link expired" and makes no Slack call.
   - `POST /api/slack/events` and `/api/slack/interactions` without a signature, or with an invalid one, return 401.
4. **Post-deploy cleanup migration** (separate, added after step 3 passes): drop the old `reactping` schema. Stop the old Supabase `pg_cron` job and delete its Vault secrets first, since that job calls the now-removed `/api/internal/deliver`. Never apply the cleanup before the new version is live.
5. **Supabase Auth:** with no app use left, its settings can be left closed (public signups off) or tidied; ReactPing does not depend on them.

## 3. Slack app configuration (after Elliot authorizes live Slack work)

1. Paste the manifest with the production host. Slack verifies the event URL on save, so do this after step 2.
2. Keep **Manage Distribution** off.
3. Follow the [live checklist](live-checklist.md) and record dated results in [verification](verification.md).

## 4. Inputs

Secret values belong in provider settings, never in Git or chat logs.

| Input                                          | Where it goes                                     |
| ---------------------------------------------- | ------------------------------------------------- |
| `PUBLIC_SITE_URL` (production origin)          | Vercel env; Slack app URLs                        |
| `DATABASE_URL` (transaction pooler, port 6543) | Vercel env (server-only)                          |
| `DATABASE_CA` (optional PEM)                   | Vercel env (server-only)                          |
| Slack Client ID, Client Secret, Signing Secret | Vercel env                                        |
| `ENCRYPTION_KEY` (32 bytes, base64)            | Vercel env; rotating it means everyone reinstalls |

No import of old credentials is needed: production has zero installations.
