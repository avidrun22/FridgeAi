-- v1.19 — pg_cron schedule: invoke send-app-version-notify daily at 17:00 UTC
--
-- Why 17:00 UTC: 9am Pacific / 12pm Eastern — a reasonable time of day for a
-- "new version is live" notification to land on a user's lock screen.
-- Avoiding early-morning or late-night so we don't wake anyone up.
--
-- Job staggering with existing crons (so concurrent outbound traffic
-- doesn't bunch up):
--   :00 — ok2eat-daily-digest         (push) — hourly
--   :05 — ok2eat-email-digest         (email) — hourly
--   :15 — ok2eat-onboarding-emails    (email) — hourly
--   :20 — ok2eat-smart-cook-night     (push) — hourly
--   17:00 UTC daily — ok2eat-app-version-notify (push) — this
--
-- Dedupe is via app_version_notifications PK (platform, version). Even if
-- this fires multiple times before iTunes flips to a new version, the
-- function short-circuits after the first detection — so a misfire or
-- stuck cron won't re-spam users.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ok2eat-app-version-notify';

SELECT cron.schedule(
  'ok2eat-app-version-notify',
  '0 17 * * *',
  $$
    SELECT net.http_post(
      url := 'https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/send-app-version-notify',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-cron-secret', 'k7Mq3vP9xT2nL5wB8cR4yH6jE1fD0aZs'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

-- Sanity-check (manual; run separately):
--   SELECT jobid, jobname, schedule, active FROM cron.job
--   WHERE jobname IN (
--     'ok2eat-daily-digest', 'ok2eat-email-digest',
--     'ok2eat-onboarding-emails', 'ok2eat-smart-cook-night',
--     'ok2eat-app-version-notify'
--   )
--   ORDER BY jobname;
