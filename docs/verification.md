# Verification

Automated tests mock Slack. This page records what was observed live on the hosted app at [reactping.com](https://reactping.com). Change a row to Verified only after seeing the behavior yourself, and add a dated log entry.

## Live coverage

| Check                                                                       | Status     | Evidence                        |
| --------------------------------------------------------------------------- | ---------- | ------------------------------- |
| Slack verifies the event and interactivity URLs                             | Verified   | Nov 14                          |
| Add to Slack completes; welcome DM arrives; Home shows Connected            | Verified   | Nov 14                          |
| Another person's reaction in a public channel sends one DM with a link      | Verified   | Nov 14; Nov 17 (four reactors)  |
| DM includes the message preview                                             | Verified   | Nov 16 (owner report)           |
| Self-reaction notifies only in workspaces listed in `SELF_REACTION_TEAMS`   | Verified   | Nov 19 (on, Next.js production) |
| Second workspace: install and reaction DM                                   | Verified   | Nov 15 (owner report)           |
| Disconnect: row deleted, user token revoked, Home shows Not connected       | Verified   | Nov 17                          |
| Remove the app: all the workspace's rows deleted, `uninstalled` logged      | Verified   | Nov 17                          |
| Reinstall after removal works                                               | Verified   | Nov 17                          |
| Feedback form saves, with Slack source attribution                          | Verified   | Nov 17                          |
| Private channel, thread reply, 1:1 DM, group DM, Slack Connect              | Unverified |                                 |
| Own reaction (default mode), file reaction, `reaction_removed` send nothing | Unverified |                                 |
| Revoking the user grant in Slack deletes the row (`tokens_revoked`)         | Unverified |                                 |
| Callback replay or another browser shows "This link expired"                | Unverified |                                 |
| Function logs contain no tokens, codes, or message content                  | Unverified |                                 |

## Mobile acceptance checks (pending)

Run these on iOS (Safari) and Android (Chrome), using a signed-in Slack workspace:

- Open `/connect` in the browser, approve the requested scopes, and confirm the connected page and welcome DM.
- Tap Open Slack app and verify the correct workspace and ReactPing Messages tab open. Verify the HTTPS fallback separately, including when the app is absent.
- Connect on desktop and confirm the same account receives reaction DMs on mobile without another connection.
- Enable immediate mobile notifications in Slack, allow OS notifications, and test a real reaction with desktop Slack active. Confirm the push opens the DM and its message link opens the original message.
- Disconnect via the Home tab and verify further reactions do not notify. Confirm cancelling or changing browsers during OAuth still fails safely.

See [Slack deep linking](https://docs.slack.dev/interactivity/deep-linking/) and [notification preferences](https://slack.com/help/articles/201355156-Configure-your-Slack-notifications).

Not tested by design: Slack retries (ignored) and outage recovery (no backfill).

## Log

**November 19, 2026: Next.js migration and per-workspace self-testing.** After `v1.2.0` (Next.js) deployed, every page, `/api/health`, `/api/stats`, the old-host redirect, and Add to Slack (302 to Slack with the `__Host-` cookie) checked out; an unsigned event POST returned 401. With `SELF_REACTION_TEAMS` set to the development workspace and a redeploy, a self-reaction in `#home` produced a DM with the message preview, `reaction_outcomes` logged `sent`, and the Home tab showed "Testing mode is on". This also confirms Slack events reach the Next.js API in production.

**November 19, 2026: Slack alerts and poll totals.** A separate "ReactPing Alerts" app posts to a private `#reactping-alerts` channel in the development workspace. Verified live: a website feedback entry posted there (no `alert_failed`), and a `net.http_post` from Supabase using the Vault secret returned 200. The `reactping-no-events` pg_cron job runs daily at 14:00 UTC. After the deploy, a real reaction logged `outcome: sent`, and `/api/health` reported 2 sent, 1 not connected, and 1 self.

**November 19, 2026: overnight gap, then outcome logging.** A user reported reaction DMs that never came between about 1:30am and 9:30am ET, and confirmed a missed reaction in that window. Vercel request logs (12-hour retention) show only one reaction event from Slack between 1:38am and 9:37am (at 4:01am), all answered 200, with no Slack retries; the database had no errors and Slack posted no incident. Conclusion: Slack did not send those events; the cause on Slack's side is unknown. DMs on reactping.com were confirmed working (the notification total rose from 13 to 26 after the move). Added `reaction_outcomes`, `/api/health`, and an hourly `health` workflow (superseded the same day by Slack alerts and a Supabase daily check) so the next gap shows whether Slack sent events and why any DM failed.

**November 17, 2026: moved to reactping.com.** Slack verified `https://reactping.com/api/slack/events` (signed challenge) and saved the new events and interactivity URLs; the reactping.com OAuth redirect URL was added beside the old one. Live: `reactping.vercel.app` pages and `www.reactping.com` 308 to `reactping.com`, `/api/` on the old host still answers (unsigned events 401, install redirects to the new host), and `/api/slack/install` sends Slack `redirect_uri=https://reactping.com/api/slack/oauth/callback`. A real reaction on the new host is not yet observed; the multi-person test covers it.

**November 17, 2026: demo recording, reinstall, and multiple reactors.** After the app was removed and reinstalled in Elliot's workspace, four other people reacted to one public-channel message; each reaction produced its own DM. After `INCLUDE_SELF_REACTIONS` was turned off and redeployed, the Home tab no longer showed the testing notice.

**November 17, 2026: Disconnect and uninstall.** Disconnect on the Home tab in a second workspace logged `installation_disconnected` then `tokens_revoked`, and the row was gone. Elliot then removed ReactPing from both workspaces; the remaining row was deleted and `activity` recorded `uninstalled`.

**November 17, 2026: feedback form.** Two website entries (with and without name and email) saved as `website`; one sent from the Home tab's link saved as `slack_home`, so the UTM tags reached the handler through the Referer. Setting `status` stamped `status_at`. The live app requests bot `chat:write` only.

**November 16, 2026: message preview.** Elliot reports a reaction DM showing "your message" as the link and a quoted preview. `reactions.get` returns the text with the existing `reactions:read` token; no new scope.

**November 15, 2026: second workspace.** Unlisted distribution enabled. Elliot installed ReactPing in a second workspace and received a reaction DM there (owner report).

**November 14, 2026: first live Slack tests.** Slack verified the URLs; OAuth, the welcome DM, and Home worked. With `INCLUDE_SELF_REACTIONS=true`, Elliot's own reaction produced a DM whose link opened the message. In normal mode, Tester B's two reactions each produced a correct DM.

**November 13, 2026: Slack-only version deployed.** Hosted checks without Slack calls passed: pages and security headers, 404s for removed routes, install redirect with a Secure HttpOnly cookie, callback without a cookie 400, unsigned or badly signed Slack requests 401. The previous account-backed backend (Supabase Auth, delivery cron, Vault secrets, unused Vercel variables) was then removed.

Earlier builds (an October SQLite service and a November account-backed version) are in git history.
