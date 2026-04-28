-- v1.0.6 pg_cron schedule: invoke send-email-digest every hour at minute 0.
-- Runs ALONGSIDE the existing ok2eat-daily-digest job (which fires push
-- notifications). Each function fails independently — email failures don't
-- break push, and vice versa.
--
-- Apply AFTER:
--   1. Deploying the send-email-digest Edge Function (supabase functions deploy)
--   2. Setting the env vars on the function in Supabase dashboard:
--        RESEND_API_KEY     = re_...
--        RESEND_FROM_EMAIL  = digest@ok2eat.com
--        CRON_SECRET        = (same value used by send-daily-digest)
--   3. Verifying the Resend domain (status = Verified in dashboard)

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop any prior version of this job before re-creating it.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ok2eat-email-digest';

-- Schedule: top of every hour, 5 minutes after the push digest so we don't
-- both spike at exactly :00. The Edge Function checks per-user digest_hour
-- vs. their timezone and sends only when the hour matches.
--
-- NOTE: if `current_setting('app.cron_secret', ...)` returns NULL (because
-- you couldn't run ALTER DATABASE), inline the secret directly in the
-- jsonb_build_object call below. See the v1.0.5 cron migration for context.
SELECT cron.schedule(
  'ok2eat-email-digest',
  '5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/send-email-digest',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-cron-secret', current_setting('app.cron_secret', true)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

-- Sanity-check (manual; run separately):
--   SELECT jobid, jobname, schedule, active FROM cron.job
--   WHERE jobname IN ('ok2eat-daily-digest', 'ok2eat-email-digest');
