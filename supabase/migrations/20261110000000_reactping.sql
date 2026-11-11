-- ReactPing schema for Supabase Postgres.
--
-- Everything lives in the private `reactping` schema, which is not exposed through the Supabase Data API.
-- The browser never queries these tables: it only talks to Supabase Auth and to ReactPing's own /api.
-- The Node API connects with DATABASE_URL as the table owner. Row level security is enabled with no
-- policies, and every privilege is revoked from anon/authenticated, so a leaked publishable key or a
-- user JWT cannot read tokens or metadata even if the schema is exposed later by mistake.

create schema if not exists reactping;
revoke all on schema reactping from public, anon, authenticated;

-- One ReactPing account per Supabase Auth user. Deleting the auth user deletes everything below.
create table reactping.accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  destination_installation_id uuid,
  cross_workspace_consent_at timestamptz,
  created_at timestamptz not null default now()
);

-- One-time Slack OAuth state. Both values are SHA-256 hashes: `nonce_hash` of the `state` parameter
-- and `browser_hash` of the HttpOnly cookie set on the browser that started the install.
create table reactping.oauth_states (
  nonce_hash text primary key,
  user_id uuid not null references reactping.accounts (user_id) on delete cascade,
  browser_hash text not null,
  expires_at timestamptz not null
);
create index oauth_states_expires on reactping.oauth_states (expires_at);

-- A Slack identity (workspace + Slack user) linked to one account. Tokens are AES-256-GCM ciphertext.
create table reactping.installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references reactping.accounts (user_id) on delete cascade,
  team_id text not null,
  team_name text not null,
  team_url text,
  slack_user_id text not null,
  bot_user_id text,
  user_token text,
  bot_token text,
  status text not null check (status in ('active', 'revoked')),
  last_test_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (team_id, slack_user_id)
);
create index installations_user on reactping.installations (user_id);

alter table reactping.accounts
  add constraint accounts_destination_fk
  foreign key (destination_installation_id) references reactping.installations (id) on delete set null;

-- Durable outbox. Minimal metadata only: no message text. Rows are purged after the retention window.
create table reactping.deliveries (
  id bigint generated always as identity primary key,
  event_id text not null,
  source_installation_id uuid not null references reactping.installations (id) on delete cascade,
  reactor_id text not null,
  reaction text not null,
  channel_id text not null,
  message_ts text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null,
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null,
  unique (event_id, source_installation_id)
);
create index deliveries_due on reactping.deliveries (next_attempt_at) where status = 'pending';
create index deliveries_created on reactping.deliveries (created_at);

-- Global Slack rate-limit pause, persisted so every serverless instance honors Retry-After.
create table reactping.delivery_control (
  id integer primary key check (id = 1),
  paused_until timestamptz not null default '-infinity'
);
insert into reactping.delivery_control (id) values (1);

alter table reactping.accounts enable row level security;
alter table reactping.oauth_states enable row level security;
alter table reactping.installations enable row level security;
alter table reactping.deliveries enable row level security;
alter table reactping.delivery_control enable row level security;

revoke all on all tables in schema reactping from public, anon, authenticated;
revoke all on all sequences in schema reactping from public, anon, authenticated;
alter default privileges in schema reactping revoke all on tables from public, anon, authenticated;
alter default privileges in schema reactping revoke all on sequences from public, anon, authenticated;
