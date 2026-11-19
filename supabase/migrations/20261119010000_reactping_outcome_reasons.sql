-- Keep the reason with each failure (Slack's error code or the thrown error's name) and count Slack retries, so the
-- hourly totals say why DMs failed, not only that they did. Still no workspace, user, channel, or message data.

alter table reactping_slack.reaction_outcomes drop constraint reaction_outcomes_outcome_check;
alter table reactping_slack.reaction_outcomes add constraint reaction_outcomes_outcome_check check (
  outcome ~ '^(sent|self|not_connected|ignored|retry|failed:[a-z0-9_]{1,60}|error:[A-Za-z]{1,60})$'
);
