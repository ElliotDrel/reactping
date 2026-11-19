-- Hourly totals of what happened to each reaction event, for outage alerts (GET /api/health).
--
-- Only the hour, the outcome, and a count: no workspace, user, channel, or message.
-- Same lockdown as the other tables: RLS on, no policies, no anon/authenticated privileges.

create table reactping_slack.reaction_outcomes (
  hour timestamptz not null check (hour = date_trunc('hour', hour)),
  outcome text not null check (outcome in ('sent', 'failed', 'error', 'self', 'not_connected', 'ignored')),
  count integer not null default 0 check (count >= 0),
  primary key (hour, outcome)
);

alter table reactping_slack.reaction_outcomes enable row level security;

revoke all on all tables in schema reactping_slack from public, anon, authenticated;
