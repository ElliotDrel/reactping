-- Feedback opened from the in-Slack menus (mentions and /reactping) gets its own source.
alter table reactping_slack.feedback drop constraint feedback_source_check;
alter table reactping_slack.feedback
  add constraint feedback_source_check check (source in ('website', 'slack_welcome', 'slack_home', 'slack_menu'));
