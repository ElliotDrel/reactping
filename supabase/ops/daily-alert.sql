-- Daily at 14:00 UTC (9 or 10am ET): post to the alerts channel when no reaction events arrived in 24 hours, which
-- means Slack stopped sending them. Failed DMs and new feedback are alerted by the app itself (ALERT_WEBHOOK_URL).
--
-- Not a migration: local test databases have no pg_cron, pg_net, or Vault. Apply once to the hosted project with
-- `supabase db query --remote -f supabase/ops/daily-alert.sql`, after storing the webhook URL in Vault:
--   select vault.create_secret('<webhook url>', 'reactping_alert_webhook');
-- Re-running replaces the job (cron.schedule upserts by name).

select cron.schedule(
  'reactping-no-events',
  '0 14 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'reactping_alert_webhook'),
    body := jsonb_build_object(
      'text',
      'ReactPing: no reaction events in 24 hours, so Slack may have stopped sending them. '
        || 'Check https://reactping.com/api/health and "When DMs go missing" in docs/setup.md.'
    )
  )
  where not exists (
    select 1 from reactping_slack.reaction_outcomes where hour > now() - interval '24 hours'
  );
  $$
);
