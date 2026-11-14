-- Post-deploy cleanup for the Slack-only version. Apply only after that version is live and checked.
-- The old schema was inspected: these five tables, their indexes and owned sequence, and no functions.
-- Drop the mutually referencing tables together. RESTRICT (the default) refuses unexpected dependencies;
-- no CASCADE is used, so unrelated objects and the new reactping_slack.installations remain untouched.
drop table if exists
  reactping.oauth_states,
  reactping.deliveries,
  reactping.delivery_control,
  reactping.accounts,
  reactping.installations;

drop schema if exists reactping;
