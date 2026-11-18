# Verification

Automated tests mock Slack. This page records what was observed live on the hosted app at [reactping.com](https://reactping.com). Change a row to Verified only after seeing the behavior yourself, and add a dated log entry.

## Live coverage

| Check                                                                       | Status     | Evidence                                 |
| --------------------------------------------------------------------------- | ---------- | ---------------------------------------- |
| Slack verifies the event and interactivity URLs                             | Verified   | Nov 14                                   |
| Add to Slack completes; welcome DM arrives; Home shows Connected            | Verified   | Nov 14                                   |
| Another person's reaction in a public channel sends one DM with a link      | Verified   | Nov 14; Nov 17 (four reactors)           |
| DM includes the message preview                                             | Verified   | Nov 16 (owner report)                    |
| Self-reaction notifies only with `INCLUDE_SELF_REACTIONS=true`              | Verified   | Nov 14 (on); Nov 17 (off after redeploy) |
| Second workspace: install and reaction DM                                   | Verified   | Nov 15 (owner report)                    |
| Disconnect: row deleted, user token revoked, Home shows Not connected       | Verified   | Nov 17                                   |
| Remove the app: all the workspace's rows deleted, `uninstalled` logged      | Verified   | Nov 17                                   |
| Reinstall after removal works                                               | Verified   | Nov 17                                   |
| Feedback form saves, with Slack source attribution                          | Verified   | Nov 17                                   |
| Private channel, thread reply, 1:1 DM, group DM, Slack Connect              | Unverified |                                          |
| Own reaction (default mode), file reaction, `reaction_removed` send nothing | Unverified |                                          |
| Revoking the user grant in Slack deletes the row (`tokens_revoked`)         | Unverified |                                          |
| Callback replay or another browser shows "This link expired"                | Unverified |                                          |
| Function logs contain no tokens, codes, or message content                  | Unverified |                                          |

Not tested by design: Slack retries (ignored) and outage recovery (no backfill).

## Log

**November 17, 2026: demo recording, reinstall, and multiple reactors.** After the app was removed and reinstalled in Elliot's workspace, four other people reacted to one public-channel message; each reaction produced its own DM. After `INCLUDE_SELF_REACTIONS` was turned off and redeployed, the Home tab no longer showed the testing notice.

**November 17, 2026: Disconnect and uninstall.** Disconnect on the Home tab in a second workspace logged `installation_disconnected` then `tokens_revoked`, and the row was gone. Elliot then removed ReactPing from both workspaces; the remaining row was deleted and `activity` recorded `uninstalled`.

**November 17, 2026: feedback form.** Two website entries (with and without name and email) saved as `website`; one sent from the Home tab's link saved as `slack_home`, so the UTM tags reached the handler through the Referer. Setting `status` stamped `status_at`. The live app requests bot `chat:write` only.

**November 16, 2026: message preview.** Elliot reports a reaction DM showing "your message" as the link and a quoted preview. `reactions.get` returns the text with the existing `reactions:read` token; no new scope.

**November 15, 2026: second workspace.** Unlisted distribution enabled. Elliot installed ReactPing in a second workspace and received a reaction DM there (owner report).

**November 14, 2026: first live Slack tests.** Slack verified the URLs; OAuth, the welcome DM, and Home worked. With `INCLUDE_SELF_REACTIONS=true`, Elliot's own reaction produced a DM whose link opened the message. In normal mode, Tester B's two reactions each produced a correct DM.

**November 13, 2026: Slack-only version deployed.** Hosted checks without Slack calls passed: pages and security headers, 404s for removed routes, install redirect with a Secure HttpOnly cookie, callback without a cookie 400, unsigned or badly signed Slack requests 401. The previous account-backed backend (Supabase Auth, delivery cron, Vault secrets, unused Vercel variables) was then removed.

Earlier builds (an October SQLite service and a November account-backed version) are in git history.
