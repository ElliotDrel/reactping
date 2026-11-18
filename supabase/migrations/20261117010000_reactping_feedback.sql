-- Feedback, kept so Elliot can read it and thank people.
--
-- Slack feedback (a DM to ReactPing) stores the sender's workspace and user ID so they can be thanked.
-- Website feedback stores the optional name and email the person chose to give.
-- Same lockdown as the other tables: RLS on, no policies, no anon/authenticated privileges.

create table reactping_slack.feedback (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  source text not null check (source in ('slack', 'website')),
  team_id text check (team_id ~ '^T[A-Z0-9]{1,31}$'),
  user_id text check (user_id ~ '^[UW][A-Z0-9]{1,31}$'),
  name text check (char_length(name) <= 100),
  email text check (char_length(email) <= 254),
  message text not null check (char_length(message) between 1 and 5000),
  check (source <> 'slack' or (team_id is not null and user_id is not null))
);

alter table reactping_slack.feedback enable row level security;

revoke all on all tables in schema reactping_slack from public, anon, authenticated;
revoke all on all sequences in schema reactping_slack from public, anon, authenticated;
