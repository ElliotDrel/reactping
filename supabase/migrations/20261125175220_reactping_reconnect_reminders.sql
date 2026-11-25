-- Tracks which workspaces still lack scopes added after they installed, and the reconnect reminders sent.
--
-- bot_scopes: the workspace bot's scopes as Slack last reported them (null until checked). Bot scopes belong to the
-- workspace, so every row of a workspace holds the same value. reconnect_prompts / reconnect_prompted_at: how many
-- reconnect DMs this person got and when the last one went out (at most two, a week apart). All of it is deleted
-- with the row on Disconnect or uninstall.
alter table reactping_slack.installations
  add column bot_scopes text[],
  add column reconnect_prompts smallint not null default 0 check (reconnect_prompts >= 0),
  add column reconnect_prompted_at timestamptz;
