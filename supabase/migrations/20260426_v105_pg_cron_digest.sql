-- v1.0.5 pg_cron schedule: invoke send-daily-digest every hour at minute 0.
-- Apply AFTER you've deployed the send-daily-digest Edge Function and set
-- the CRON_SECRET on both the function (as an env var) and below in this SQL.

-- Required extensions (enable via Supabase Dashboard → Database → Extensions
-- if not already on). Idempotent CREATE EXTENSION calls are safe.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop any prior version of this job before re-creating it.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ok2eat-daily-digest';

-- Schedule: top of every hour. The Edge Function checks per-user
-- digest_hour vs. their timezone and sends only when the hour matches.
SELECT cron.schedule(
  'ok2eat-daily-digest',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/send-daily-digest',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-cron-secret', current_setting('app.cron_secret', true)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $$
);

-- Set the cron secret at the database level so the SQL above can read it.
-- Replace REPLACE_ME with the same value you set as CRON_SECRET on the
-- send-daily-digest Edge Function.
-- (You can run this line separately whenever you rotate the secret.)
ALTER DATABASE postgres SET app.cron_secret TO 'REPLACE_ME';
