-- v1.23 — pg_cron schedule: invoke send-business-waitlist-digest daily at 16:30 UTC
--
-- Why 16:30 UTC: 9:30am Pacific / 12:30pm Eastern — lands in Greg's inbox
-- right around the start of a typical workday. Off-slot from the other crons
-- so concurrent outbound traffic stays staggered:
--   :00 — ok2eat-daily-digest         (push)
--   :05 — ok2eat-email-digest         (email)
--   :15 — ok2eat-onboarding-emails    (email)
--   :20 — ok2eat-smart-cook-night     (push)
--   16:30 UTC daily — ok2eat-business-waitlist-digest (email) — this
--   17:00 UTC daily — ok2eat-app-version-notify (push)
--
-- The Edge Function dumps the FULL business_waitlist table on every run, so
-- there's no dedupe / state to worry about. A misfire just sends the same
-- daily digest twice — annoying but not destructive.
--
-- Cron secret is inlined per CLAUDE.md (current_setting('app.cron_secret')
-- isn't configured at the DB level; every existing cron uses the literal).
--
-- Idempotent — unschedule any previous job with the same name before
-- creating the new one, so re-runs are no-ops.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ok2eat-business-waitlist-digest';

SELECT cron.schedule(
  'ok2eat-business-waitlist-digest',
  '30 16 * * *',
  $$
    SELECT net.http_post(
      url := 'https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/send-business-waitlist-digest',
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
--   WHERE jobname = 'ok2eat-business-waitlist-digest';
--
-- Smoke-test the function on demand (run from terminal, not SQL Editor):
--   curl -X POST \
--     -H "x-cron-secret: k7Mq3vP9xT2nL5wB8cR4yH6jE1fD0aZs" \
--     -H "content-type: application/json" \
--     -d '{}' \
--     https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/send-business-waitlist-digest
