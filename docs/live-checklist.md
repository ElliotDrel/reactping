# Live Slack coverage checklist

Automated tests use a mocked Slack API. The endpoint verification below was also observed in the real Slack app settings. Record the date, workspace, and observed result for each row; change **Unverified** only after you see the behavior yourself.

Setup: two workspaces (A, B), both connected from one ReactPing session. A second Slack user (the "reactor") in each workspace.

## Install and linking

| Check                                                        | Status     | Notes                                                                    |
| ------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------ |
| Request URL verifies on save in Slack                        | Verified   | October 23, 2026; Test Workspace; Slack shows Verified and events On. |
| Workspace A OAuth completes; settings show Active            | Verified   | October 23, 2026; approved by Elliot; workspace Active for U0000000001.  |
| Workspace B OAuth completes (public distribution on)         | Unverified |                                                                          |
| OAuth callback opened in another browser/profile is rejected | Unverified |                                                                          |
| Reloading a used callback URL is rejected                    | Unverified |                                                                          |

## Reaction coverage (same-workspace destination)

October 24: public-channel positive result used Elliot as reactor with `INCLUDE_SELF_REACTIONS=true`; a different user is still needed to verify the normal-mode positive path. React as the reactor to a message authored by the connected user. Expect one bot DM with emoji, `<@reactor>`, workspace name, and a working link.

| Conversation                         | Status                | DM received | Link opens message                     |
| ------------------------------------ | --------------------- | ----------- | -------------------------------------- |
| Public channel                       | Verified in test mode | Yes         | Correct original-message URL read back |
| Private channel (author is a member) | Unverified            |             |                                        |
| Thread reply                         | Unverified            |             |                                        |
| 1:1 DM between reactor and author    | Unverified            |             |                                        |
| Group DM (MPIM)                      | Unverified            |             |                                        |
| Slack Connect shared channel         | Unverified            |             |                                        |

## Filtering

| Check                                                       | Status     | Notes                                                                                              |
| ----------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| Author reacting to own message sends nothing (default mode) | Verified   | October 23, 2026; real white-check-mark reaction; signed callback ignored; zero queued deliveries. |
| Reaction on a file (not a message) sends nothing            | Unverified |                                                                                                    |
| Reaction on another user's message sends nothing to you     | Unverified |                                                                                                    |
| `reaction_removed` sends nothing                            | Unverified |                                                                                                    |
| DM has no link/media unfurl                                 | Unverified |                                                                                                    |

## Component smoke checks

- Real connection-test bot DM delivered and read back in Slack.
- Explicitly labeled synthetic reaction passed filtering, deduplication, real permalink lookup, and real DM delivery. Duplicate submission produced one notification. This does not verify a second person's actual reaction.
- October 24: real self-reaction with the explicit test override delivered one bot DM; live queue shows `sent`, one attempt, no error. Tester A has joined, but his earlier reaction did not reach the queue while Slack pointed at the expired tunnel URL. Another-person positive delivery remains **Unverified**.

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
