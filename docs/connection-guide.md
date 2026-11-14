# Connection guide: Slack-only version

Current state (November 13, 2026): the Slack-only version is deployed and its non-Slack hosted checks pass. Post-deploy cleanup removed the old schema, cron job and history, two Vault secrets, and six unused Vercel settings. Supabase email Auth is disabled/reset. Superseded by November 14: Slack app configuration, installation, welcome DM, Home, and a self-reaction round trip are now verified; Tester B's real public-channel reactions in normal mode are also verified. Disconnect/reconnect and lifecycle checks remain pending. Superseded: the previous not-deployed status and the email/SMTP launch blocker. The technical contract is in [setup](setup.md) and [`.env.example`](../.env.example); dated evidence is in [verification](verification.md).

## 1. What changes for providers

- **Vercel:** static `public/` plus four functions in `api/` (Node 24). No Build Output API output, no cron.
- **Supabase:** Postgres only. One new private table, `reactping_slack.installations`. Supabase Auth, SMTP, Vault, `pg_cron`, and `pg_net` are no longer needed by ReactPing.
- **Slack:** OAuth is the only identity. Home tab, interactivity, and three bot events are added to the app configuration.

## 2. Deployment order (migration safety)

The sequence below was completed for the connected project. Keep it for upgrades of an existing account-backed deployment. The old migration `20261110000000_reactping.sql` remains unchanged. Apply the additive migration first; the destructive cleanup comes last. Do not run an unrestricted `supabase db push` against an old running version now that the cleanup migration is also in the repository.

1. **Apply the additive migration** `20261113000000_reactping_slack_installations.sql`. The running old version ignores the new schema.
2. **Deploy this commit.** Keep `PUBLIC_SITE_URL`, `DATABASE_URL`, `DATABASE_CA`, the three Slack values, `ENCRYPTION_KEY`, and `INCLUDE_SELF_REACTIONS=false`. Delete the removed variables (listed in [setup](setup.md)) after deploying; they are ignored meanwhile.
3. **Hosted checks without Slack calls:**
   - `/` and `/privacy` return 200 with the `vercel.json` security headers and `X-Robots-Tag: noindex`; an unknown path returns the 404 page.
   - `GET /api/slack/install` returns 302 to `slack.com/oauth/v2/authorize` with a `__Host-` HttpOnly Secure Lax cookie. Do not follow it.
   - `GET /api/slack/oauth/callback?state=x&code=y` without the cookie returns 400 "This link expired" and makes no Slack call.
   - `POST /api/slack/events` and `/api/slack/interactions` without a signature, or with an invalid one, return 401.
4. **Post-deploy cleanup:** after step 3 passes, unschedule `reactping-deliver`, delete its two verified Vault secrets, and apply `20261114000000_remove_account_backend.sql`. It explicitly drops the five legacy tables and their schema without `CASCADE`. Never apply it before the new version is live. Then remove unused Vercel variables and redeploy.
5. **Supabase Auth:** email provider disabled, public signups closed, Auth Site URL reset to `http://localhost:3000`, redirect allow-list cleared, OTP length restored to 8. No email templates or custom SMTP had been successfully changed. ReactPing no longer uses Auth.

## 3. Slack app configuration (after Elliot authorizes live Slack work)

1. Open [the ReactPing Slack app](https://api.slack.com/apps/A0CBVN3467K) → **App Manifest**. Replace `YOUR_SITE_HOST` in [the template](../slack-manifest.template.yaml) with `reactping.vercel.app`, then save it when Slack configuration/testing is authorized. Slack verifies the event URL on save. This enables Home, interactivity, and the lifecycle events on the hosted app; it does not need more OAuth scopes.
2. In the same app, **Manage Distribution** → **Share Your App with Other Workspaces**: leave **Activate Public Distribution** off. [Slack documents that undistributed apps stay in their associated workspace](https://docs.slack.dev/app-management/distribution/).
3. After Elliot authorizes real Slack testing, use **Add to Slack** and follow the [live checklist](live-checklist.md). Record dated results in [verification](verification.md). Welcome DM, Home, reaction DM, Disconnect, and lifecycle cleanup are still unverified live.

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
