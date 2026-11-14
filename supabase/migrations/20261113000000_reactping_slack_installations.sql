-- Slack-only ReactPing: one private table of Slack installations.
--
-- Additive. The earlier `reactping` schema (accounts, OAuth state, outbox) is left untouched here and is no
-- longer read by the app; it is removed by a separate cleanup migration only after this version is deployed.
--
-- One row per Slack user who added ReactPing in a workspace, keyed by Slack's own identity (team ID + user ID).
-- No accounts, emails, events, or delivery records. Tokens are AES-256-GCM ciphertext bound to the row.
-- The Node API connects with DATABASE_URL as the table owner. Row level security is enabled with no policies
-- and every privilege is revoked from anon/authenticated, so the Supabase Data API can never read it.

create schema if not exists reactping_slack;
revoke all on schema reactping_slack from public, anon, authenticated;

create table reactping_slack.installations (
  team_id text not null check (team_id ~ '^T[A-Z0-9]{1,31}$'),
  user_id text not null check (user_id ~ '^[UW][A-Z0-9]{1,31}$'),
  -- https://<workspace>.slack.com/ from auth.test, used to build message links without extra Slack calls.
  workspace_url text not null check (workspace_url ~ '^https://[a-z0-9-]+(\.[a-z0-9-]+)*\.slack\.com/$'),
  bot_token text not null,
  user_token text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (team_id, user_id)
);

alter table reactping_slack.installations enable row level security;

revoke all on all tables in schema reactping_slack from public, anon, authenticated;
alter default privileges in schema reactping_slack revoke all on tables from public, anon, authenticated;
alter default privileges in schema reactping_slack revoke all on sequences from public, anon, authenticated;
