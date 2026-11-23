-- Workspace bot grants survive individual disconnects; no user grants are stored here.
create table reactping_slack.workspace_bots (
  team_id text primary key check (team_id ~ '^T[A-Z0-9]{1,31}$'),
  app_id text check (app_id ~ '^A[A-Z0-9]{2,31}$'),
  bot_token text not null
);
alter table reactping_slack.workspace_bots enable row level security;
-- Keyed digests only, no message content or response URLs.
create table reactping_slack.engagement_receipts (
  digest text primary key,
  expires_at timestamptz not null
);
create index on reactping_slack.engagement_receipts (expires_at);
alter table reactping_slack.engagement_receipts enable row level security;
revoke all on reactping_slack.workspace_bots, reactping_slack.engagement_receipts from public, anon, authenticated;
