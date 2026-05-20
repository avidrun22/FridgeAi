-- v1.25 — pg_cron schedule: invoke check-ai-spend-alert daily at 14:30 UTC
--
-- Why 14:30 UTC: 7:30am Pacific / 10:30am Eastern. Late enough that
-- yesterday's UTC ai_usage counters are fully baked (UTC midnight was
-- 14.5 hours ago), early enough that the Telegram ping is the first
-- thing in front of Greg when he sits down. Off-slot from every other
-- cron so concurrent outbound traffic stays staggered:
--   :00 — ok2eat-daily-digest         (push)
--   :05 — ok2eat-email-digest         (email)
--   :15 — ok2eat-onboarding-emails    (email)
--   :20 — ok2eat-smart-cook-night     (push)
--   14:30 UTC daily — ok2eat-ai-spend-alert        (telegram) — this
--   16:30 UTC daily — ok2eat-business-waitlist-digest (email)
--   17:00 UTC daily — ok2eat-app-version-notify   (push)
--
-- The Edge Function is idempotent and self-throttling: it only POSTs to
-- Telegram when (a) yesterday's estimated spend ≥ AI_SPEND_DAILY_ALERT_USD,
-- or (b) any feature's count is ≥ SPIKE_MULTIPLIER × its 7-day average
-- AND ≥ SPIKE_MIN_VOLUME, or (c) AI_SPEND_ALWAYS_REPORT=1. A misfire just
-- sends the same status ping twice — annoying but never destructive.
--
-- Cron secret is inlined per CLAUDE.md (current_setting('app.cron_secret')
-- isn't configured at the DB level; every existing cron uses the literal).
--
-- Idempotent — unschedule any previous job with the same name before
-- creating the new one, so re-runs are no-ops.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ok2eat-ai-spend-alert';

SELECT cron.schedule(
  'ok2eat-ai-spend-alert',
  '30 14 * * *',
  $$
    SELECT net.http_post(
      url := 'https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/check-ai-spend-alert',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-cron-secret', 'k7Mq3vP9xT2nL5wB8cR4yH6jE1fD0aZs'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

-- Sanity-check (run manually after applying):
--   SELECT jobid, jobname, schedule, active
--   FROM cron.job
--   WHERE jobname = 'ok2eat-ai-spend-alert';
--
-- Smoke-test the function on demand (run from terminal, not SQL Editor;
-- pings Telegram immediately if anything tripped):
--   curl -X POST \
--     -H "x-cron-secret: k7Mq3vP9xT2nL5wB8cR4yH6jE1fD0aZs" \
--     -H "content-type: application/json" \
--     -d '{}' \
--     https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/check-ai-spend-alert
--
-- Smoke-test with forced daily ping (returns full breakdown to Telegram
-- whether or not thresholds tripped — handy for end-to-end verification):
--   supabase secrets set AI_SPEND_ALWAYS_REPORT=1
--   <fire the curl above>
--   supabase secrets unset AI_SPEND_ALWAYS_REPORT
