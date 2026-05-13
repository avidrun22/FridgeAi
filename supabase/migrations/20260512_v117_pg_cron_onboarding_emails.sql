-- v1.17 pg_cron schedule: invoke send-onboarding-emails every hour at :15.
--
-- Runs ALONGSIDE the existing ok2eat-daily-digest (push at :00) and
-- ok2eat-email-digest (email at :05) jobs. We stagger so the three jobs
-- don't compete for outbound throughput.
--
-- Apply AFTER:
--   1. Deploying the send-onboarding-emails Edge Function
--        supabase functions deploy send-onboarding-emails
--   2. Setting env vars on the function (Supabase dashboard or CLI):
--        RESEND_API_KEY      = re_...  (reuse the existing key)
--        CRON_SECRET         = (same value used by send-email-digest)
--        ONBOARDING_FROM     = (optional) "Greg from ok2eat <hello@ok2eat.com>"
--        ONBOARDING_REPLY_TO = (optional) "hello@ok2eat.com"
--        PUBLIC_APP_URL      = (optional) "https://ok2eat.com"
--   3. Applying 20260512_v117_onboarding_emails.sql (creates user_email_sends).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop any prior version of this job before re-creating it.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ok2eat-onboarding-emails';

-- Schedule: minute 15 of every hour. The Edge Function dedupes against
-- user_email_sends so we won't double-send if a job ticks twice in a row
-- (which can happen during transient db blips). The dedupe is also why we
-- can keep this on a one-hour granularity — even if a user signs up at 11:59
-- and we evaluate at 12:15, they'll get the D0 email within ~16 minutes.
SELECT cron.schedule(
  'ok2eat-onboarding-emails',
  '15 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/send-onboarding-emails',
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
--   WHERE jobname IN ('ok2eat-daily-digest', 'ok2eat-email-digest', 'ok2eat-onboarding-emails')
--   ORDER BY jobname;
