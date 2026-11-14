# Live Slack coverage checklist

Automated tests use a mocked Slack API. Record the date, workspace, and observed result for each row; change **Unverified** only after seeing the behavior yourself. Hosted Slack testing was authorized on November 14, 2026. Observed results below distinguish self-reaction testing from normal mode.

Live self-reaction round trip verified in the public channel with `INCLUDE_SELF_REACTIONS=true`: [source message](https://example-workspace.slack.com/archives/C0000000000/p1794673987429139), [notification DM](https://example-workspace.slack.com/archives/D0000000000/p1794674234639119). The link opened the original message. Another person's reaction and Disconnect remain pending.

Setup: the Slack-only version deployed at `PUBLIC_SITE_URL`, the manifest applied, Manage Distribution off, and a second Slack user (the "reactor") in Elliot's workspace.

## Install and Home (Slack-only version)

| Check                                                                           | Status     | Notes |
| ------------------------------------------------------------------------------- | ---------- | ----- |
| Event and interactivity Request URLs verify on save                             | Verified   |       | November 14, 2026; live hosted app. |
| Add to Slack completes; result page says connected                              | Verified   |       | November 14, 2026; live hosted app. |
| Welcome DM arrives from ReactPing                                               | Verified   |       | November 14, 2026; live hosted app. |
| Home tab shows Connected with Disconnect                                        | Verified   |       | November 14, 2026; live hosted app. |
| Callback opened in another browser/profile shows "This link expired"            | Unverified |       |
| Reloading a used callback URL fails without creating a second installation      | Unverified |       |
| Install from a workspace other than the app's own is refused (distribution off) | Unverified |       |

## Reaction coverage

React as the reactor to a message authored by the connected user. Expect one bot DM with `<@reactor>`, the emoji, and a working link, with no unfurl.

| Conversation                         | Status     | DM received | Link opens message |
| ------------------------------------ | ---------- | ----------- | ------------------ |
| Public channel                       | Unverified |             |                    |
| Private channel (author is a member) | Unverified |             |                    |
| Thread reply                         | Unverified |             |                    |
| 1:1 DM between reactor and author    | Unverified |             |                    |
| Group DM (MPIM)                      | Unverified |             |                    |
| Slack Connect shared channel         | Unverified |             |                    |

## Filtering

| Check                                                       | Status     | Notes |
| ----------------------------------------------------------- | ---------- | ----- |
| Author reacting to own message sends nothing (default mode) | Unverified |       |
| Reaction on a file sends nothing                            | Unverified |       |
| Reaction on another user's message sends nothing to you     | Unverified |       |
| `reaction_removed` sends nothing                            | Unverified |       |

## Disconnect and lifecycle

| Check                                                                          | Status     | Notes |
| ------------------------------------------------------------------------------ | ---------- | ----- |
| Disconnect: Home shows Not connected; row deleted; user token revoked in Slack | Unverified |       |
| After Disconnect, a new reaction sends nothing                                 | Unverified |       |
| Reinstall after Disconnect works and sends a new welcome DM                    | Unverified |       |
| Revoke the user grant in Slack settings: row deleted (`tokens_revoked`)        | Unverified |       |
| Remove the app from the workspace: all rows deleted (`app_uninstalled`)        | Unverified |       |
| Function logs contain no tokens, codes, or message content                     | Unverified |       |

Not tested by design: Slack retries (ignored), and outage recovery (no backfill).

## Historical (superseded): v1 SQLite service, October 2026

Observed on the old single-process build through a temporary tunnel; not coverage for the current code.

- October 23: Events Request URL verified; OAuth completed in Test Workspace for `U0000000001`; a real self-reaction was ignored in default mode.
- October 24: a real public-channel reaction from Tester A and real self-reactions (testing flag on) each delivered one DM with a working link.
- Private channels, threads, DMs, group DMs, Slack Connect, and cross-workspace routing were never verified. Cross-workspace routing has since been removed from v1.
