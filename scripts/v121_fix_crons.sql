-- v1.21 hotfix — Supabase rotated the legacy JWT signing secret 2026-05-15.
-- The old anon key (iat 1745864655 / 2025-04-28) is now rejected with
-- UNAUTHORIZED_LEGACY_JWT. New legacy anon key has iat 1774667658.
-- All ok2eat crons that auth'd with the old key were silently failing
-- (cron.job_run_details says "succeeded" because net.http_post itself
-- returned, but pg_net._http_response shows 401 from the function gateway).
--
-- This script:
--   1. Rewrites the 4 broken crons with the new legacy anon key
--   2. Reverts the 66 users' digest_hour back to 9 (was temporarily
--      bumped to 10 for a force-send attempt that didn't fire)
--   3. Manually invokes send-email-digest once with new key + digest_hour=10
--      flip so today's 66 users get their digest before we revert
--
-- Run order matters — the manual fire BEFORE the revert, so user_settings
-- still shows digest_hour=10 (matching the current PT hour) when the
-- function evaluates `hourInTimezone(LA) === digest_hour`.

-- ─── Step 1 — rewrite the 4 broken crons ────────────────────────────────────

SELECT cron.unschedule('ok2eat-email-digest');
SELECT cron.schedule('ok2eat-email-digest', '5 * * * *', $$
SELECT net.http_post(
  url := 'https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/send-email-digest',
  headers := jsonb_build_object(
    'content-type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlbWFyaHZnZXV6aGx3eWJtYmllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2Njc2NTgsImV4cCI6MjA5MDI0MzY1OH0.ejYeJkucIwAWZ7Rf0hcmpIENSnnmXMh4V_nhjXlDQk4',
    'x-cron-secret', 'k7Mq3vP9xT2nL5wB8cR4yH6jE1fD0aZs'
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 60000
);
$$);

SELECT cron.unschedule('ok2eat-daily-digest');
SELECT cron.schedule('ok2eat-daily-digest', '0 * * * *', $$
SELECT net.http_post(
  url := 'https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/send-daily-digest',
  headers := jsonb_build_object(
    'content-type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlbWFyaHZnZXV6aGx3eWJtYmllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2Njc2NTgsImV4cCI6MjA5MDI0MzY1OH0.ejYeJkucIwAWZ7Rf0hcmpIENSnnmXMh4V_nhjXlDQk4',
    'x-cron-secret', 'k7Mq3vP9xT2nL5wB8cR4yH6jE1fD0aZs'
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 30000
);
$$);

SELECT cron.unschedule('ok2eat-onboarding-emails');
SELECT cron.schedule('ok2eat-onboarding-emails', '15 * * * *', $$
SELECT net.http_post(
  url := 'https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/send-onboarding-emails',
  headers := jsonb_build_object(
    'content-type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlbWFyaHZnZXV6aGx3eWJtYmllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2Njc2NTgsImV4cCI6MjA5MDI0MzY1OH0.ejYeJkucIwAWZ7Rf0hcmpIENSnnmXMh4V_nhjXlDQk4',
    'x-cron-secret', 'k7Mq3vP9xT2nL5wB8cR4yH6jE1fD0aZs'
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 60000
);
$$);

SELECT cron.unschedule('ok2eat-smart-cook-night');
SELECT cron.schedule('ok2eat-smart-cook-night', '20 * * * *', $$
SELECT net.http_post(
  url := 'https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/send-smart-cook-night',
  headers := jsonb_build_object(
    'content-type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlbWFyaHZnZXV6aGx3eWJtYmllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2Njc2NTgsImV4cCI6MjA5MDI0MzY1OH0.ejYeJkucIwAWZ7Rf0hcmpIENSnnmXMh4V_nhjXlDQk4',
    'x-cron-secret', 'k7Mq3vP9xT2nL5wB8cR4yH6jE1fD0aZs'
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 60000
);
$$);

-- ─── Step 2 — fire today's digest manually with new key ─────────────────────
-- The 66 users still have digest_hour=10 from the earlier attempt; current
-- PT hour is 10:xx so this hour matches and the function will send to them.

SELECT net.http_post(
  url := 'https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/send-email-digest',
  headers := jsonb_build_object(
    'content-type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlbWFyaHZnZXV6aGx3eWJtYmllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2Njc2NTgsImV4cCI6MjA5MDI0MzY1OH0.ejYeJkucIwAWZ7Rf0hcmpIENSnnmXMh4V_nhjXlDQk4',
    'x-cron-secret', 'k7Mq3vP9xT2nL5wB8cR4yH6jE1fD0aZs'
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
) AS request_id;

-- ─── Step 3 — wait ~3 minutes, then revert digest_hour ──────────────────────
-- Run this AFTER you confirm last_email_sent_at is updated for the 66 users
-- (or after ~3 min — function processes ~3-5 sec per user, 66 users ≈ 4 min).
--
--   UPDATE user_settings
--   SET digest_hour = 9
--   WHERE email_digest_enabled = true
--     AND digest_hour = 10
--     AND digest_timezone = 'America/Los_Angeles';
--
--   -- Verify
--   SELECT COUNT(*) FILTER (WHERE last_email_sent_at >= now() - interval '10 minutes') AS sent_just_now
--   FROM user_settings WHERE email_digest_enabled = true;
