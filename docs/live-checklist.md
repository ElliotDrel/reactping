# Live Slack coverage checklist

Automated tests use a mocked Slack API. The endpoint verification below was also observed in the real Slack app settings. Record the date, workspace, and observed result for each row; change **Unverified** only after you see the behavior yourself.

Setup: two workspaces (A, B), both connected from one ReactPing session. A second Slack user (the "reactor") in each workspace.

## Install and linking

| Check                                                        | Status     | Notes                                                                    |
| ------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------ |
| Request URL verifies on save in Slack                        | Verified   | October 23, 2026; Test Workspace; Slack shows Verified and events On. |
| Workspace A OAuth completes; settings show Active            | Unverified |                                                                          |
| Workspace B OAuth completes (public distribution on)         | Unverified |                                                                          |
| OAuth callback opened in another browser/profile is rejected | Unverified |                                                                          |
| Reloading a used callback URL is rejected                    | Unverified |                                                                          |

## Reaction coverage (same-workspace destination)

React as the reactor to a message authored by the connected user. Expect one bot DM with emoji, `<@reactor>`, workspace name, and a working link.

| Conversation                         | Status     | DM received | Link opens message |
| ------------------------------------ | ---------- | ----------- | ------------------ |
| Public channel                       | Unverified |             |                    |
| Private channel (author is a member) | Unverified |             |                    |
| Thread reply                         | Unverified |             |                    |
| 1:1 DM between reactor and author    | Unverified |             |                    |
| Group DM (MPIM)                      | Unverified |             |                    |
| Slack Connect shared channel         | Unverified |             |                    |

## Filtering

| Check                                                   | Status     | Notes |
| ------------------------------------------------------- | ---------- | ----- |
| Author reacting to own message sends nothing            | Unverified |       |
| Reaction on a file (not a message) sends nothing        | Unverified |       |
| Reaction on another user's message sends nothing to you | Unverified |       |
| `reaction_removed` sends nothing                        | Unverified |       |
| DM has no link/media unfurl                             | Unverified |       |

## Cross-workspace routing

| Check                                                                                 | Status     | Notes |
| ------------------------------------------------------------------------------------- | ---------- | ----- |
| Destination B without consent box: save rejected                                      | Unverified |       |
| Destination B with consent: reaction in A arrives in B's bot DM as "Someone reacted…" | Unverified |       |
| Reaction in B still arrives in B with reactor mention                                 | Unverified |       |

## Reliability and revocation

| Check                                                                     | Status     | Notes |
| ------------------------------------------------------------------------- | ---------- | ----- |
| Stop the service, react, restart within ~5 min: Slack retry delivers once | Unverified |       |
| Kill the process between receipt and send: delivery resumes after restart | Unverified |       |
| Remove the app from workspace A in Slack: settings show A revoked         | Unverified |       |
| Revoke from Slack account settings (user token): settings show revoked    | Unverified |       |
| Disconnect in ReactPing: app's user token revoked in Slack                | Unverified |       |
| Logs contain no tokens, codes, or message content                         | Unverified |       |
