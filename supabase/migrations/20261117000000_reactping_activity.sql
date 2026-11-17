-- Usage counts without tracking people or messages.
--
-- activity: one row per connection change, keyed by workspace only. No user IDs, so a disconnected person's
-- identity is not retained after their installation row is deleted.
-- counters: running totals. notifications_sent is incremented once per delivered reaction DM; nothing about the
-- DM (who, what, where) is recorded.
-- Same lockdown as installations: RLS on, no policies, no anon/authenticated privileges.

create table reactping_slack.activity (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  team_id text not null check (team_id ~ '^T[A-Z0-9]{1,31}$'),
  event text not null check (event in ('connected', 'disconnected', 'uninstalled')),
  installs integer not null default 1 check (installs > 0)
);

create table reactping_slack.counters (
  name text primary key check (name in ('notifications_sent')),
  value bigint not null default 0 check (value >= 0)
);

insert into reactping_slack.counters (name) values ('notifications_sent');

alter table reactping_slack.activity enable row level security;
alter table reactping_slack.counters enable row level security;

revoke all on all tables in schema reactping_slack from public, anon, authenticated;
revoke all on all sequences in schema reactping_slack from public, anon, authenticated;
