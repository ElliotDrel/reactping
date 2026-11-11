-- Every-minute delivery recovery: Supabase pg_cron calls ReactPing's internal delivery endpoint.
--
-- This is a TEMPLATE, not a migration. Run it once in the Supabase SQL editor after the site is deployed
-- and DELIVERY_CRON_SECRET is set in Vercel. Replace the two placeholders in the editor only; never save
-- or commit the filled-in copy. Both values go into Supabase Vault, so the job definition holds no secret.
--
-- Caution (from Supabase's docs): pg_net writes the decrypted header into net.http_request_queue until the
-- request is sent, so any role that can log in to the database can briefly read it. Keep database access
-- limited to the project owner.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://YOUR_SITE_HOST/api/internal/deliver', 'reactping_delivery_url');
select vault.create_secret('YOUR_DELIVERY_CRON_SECRET', 'reactping_delivery_secret');

select cron.schedule(
  'reactping-deliver',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'reactping_delivery_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'reactping_delivery_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Rotate the secret: update Vercel first, redeploy, then
--   select vault.update_secret((select id from vault.secrets where name = 'reactping_delivery_secret'), 'NEW_VALUE');
-- Pause:   select cron.unschedule('reactping-deliver');
-- Inspect: select * from cron.job_run_details order by start_time desc limit 20;
--          select status_code, created from net._http_response order by created desc limit 20;
