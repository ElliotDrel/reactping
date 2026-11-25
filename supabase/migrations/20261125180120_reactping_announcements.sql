-- Occasional announcements (product updates, holiday notes), DMed once to each connected person by the daily cron.
--
-- Add a row to send one: text (Slack mrkdwn) and an optional send_after. Only the newest due announcement goes out,
-- and only to people connected before it was created. last_announcement_id marks what each person already got;
-- announcements_muted is set by the "Mute announcements" button. Both are deleted with the row on Disconnect.
create table reactping_slack.announcements (
  id bigint generated always as identity primary key,
  text text not null check (char_length(text) between 1 and 3000),
  send_after timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table reactping_slack.announcements enable row level security;
revoke all on reactping_slack.announcements from public, anon, authenticated;

alter table reactping_slack.installations
  add column last_announcement_id bigint not null default 0,
  add column announcements_muted boolean not null default false;
