-- v1.18 pg_cron schedule: invoke send-smart-cook-night every hour at :20.
--
-- Job staggering (alongside existing crons):
--   :00 — ok2eat-daily-digest         (push)
--   :05 — ok2eat-email-digest         (email)
--   :15 — ok2eat-onboarding-emails    (D0/D2/D5/D10 + behavioral)
--   :20 — ok2eat-smart-cook-night     (this — 6pm dinner nudge push)
--
-- The function dedupes nothing of its own — it relies on
-- hourInTimezone(digest_timezone) === cook_night_hour to fire once per
-- user per day. If pg_cron ticks twice within an hour (rare; transient
-- db blip), the second tick still matches the same hour-window, so the
-- function would re-send. Acceptable risk — the chance of a double-push
-- inside a single hour is very low, and the impact (a single duplicate
-- dinner-time push) is minor.
--
-- Apply AFTER:
--   1. Deploying the send-smart-cook-night Edge Function:
--        supabase functions deploy send-smart-cook-night
--   2. Setting these env vars on the function (Supabase dashboard or CLI):
--        SUPABASE_URL              = (already set globally)
--        SUPABASE_SERVICE_ROLE_KEY = (already set globally)
--        ANTHROPIC_API_KEY         = (reuse the existing key)
--        ANTHROPIC_MODEL           = (optional) "claude-haiku-4-5-20251001"
--        CRON_SECRET               = (same value as the other jobs)
--   3. Applying 20260513_v118_smart_cook_night.sql (adds cook_night_hour col).
--   4. Applying 20260513_v118_daily_recipe_cache.sql (recipe cache table).
--
-- If `current_setting('app.cron_secret', true)` returns NULL (Postgres-level
-- setting unconfigured), the function 403s. Fix by either:
--   (a) Setting the secret at DB level:
--         ALTER DATABASE postgres SET app.cron_secret = '...';
--   (b) Inlining the secret literal in the headers block below (matches
--       the inline-fix approach taken for the onboarding-emails cron).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop any prior version of this job before re-creating it.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ok2eat-smart-cook-night';

SELECT cron.schedule(
  'ok2eat-smart-cook-night',
  '20 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/send-smart-cook-night',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-cron-secret', current_setting('app.cron_secret', true)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);

-- Sanity-check (manual; run separately):
--   SELECT jobid, jobname, schedule, active FROM cron.job
--   WHERE jobname IN (
--     'ok2eat-daily-digest', 'ok2eat-email-digest',
--     'ok2eat-onboarding-emails', 'ok2eat-smart-cook-night'
--   )
--   ORDER BY jobname;
