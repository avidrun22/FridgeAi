-- v1.18 — Smart Cook Night user setting + cron-disable column
-- =============================================================================
-- Adds a per-user "what hour should the 6pm dinner-nudge push fire?" knob.
-- Default 18 (6pm) — the canonical hour where "what should we eat tonight?"
-- decision paralysis is at its peak (Reddit research, May 2026). Users can
-- shift +/- in Settings for those who eat earlier (e.g. families with young
-- kids → 17) or later (e.g. solo professionals → 19/20).
--
-- The companion send-smart-cook-night Edge Function uses the same cron
-- pattern as send-daily-digest / send-email-digest: hourly pg_cron job,
-- per-user filter on hourInTimezone(cook_night_timezone) === cook_night_hour.
--
-- Separate column from `digest_hour` (the morning email's hour) so users
-- can tune the two channels independently. Many users want the morning
-- digest at 8/9am but the dinner push at 5/6pm. Same `digest_timezone`
-- gets reused for both — almost nobody lives in two timezones.
--
-- `cook_night_enabled` defaults true and gates the push. Users who only
-- want the morning email turn it off in Settings.
-- =============================================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS cook_night_hour smallint NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS cook_night_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN user_settings.cook_night_hour    IS 'Hour (0-23) in user''s digest_timezone when Smart Cook Night push fires. Default 18 = 6pm.';
COMMENT ON COLUMN user_settings.cook_night_enabled IS 'v1.18 — flip false to skip Smart Cook Night without affecting morning digest.';

-- Sanity bounds on the hour.
ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_cook_night_hour_check,
  ADD CONSTRAINT user_settings_cook_night_hour_check
    CHECK (cook_night_hour >= 0 AND cook_night_hour <= 23);
