-- ─── 20260519_v125_smart_cook_night_default_off.sql ─────────────────────
--
-- v1.25 — Flip the cook_night_enabled column default from true → false
-- for FUTURE users only. Existing users keep their current setting.
--
-- Why default-off going forward: Smart Cook Night fires a 6pm push (and a
-- Claude call to pick the recipe) for every enabled user every day.
-- Default-on meant every new signup got opted into a daily LLM call from
-- day one — fine when we were just iterating, but as user count grows and
-- with v1.25's onboarding gate driving more confirmations, it's better to
-- have users explicitly opt IN to a daily push + a daily Claude call.
--
-- Important: this ALTER COLUMN ... SET DEFAULT changes the default for
-- INSERTs going forward. It does NOT touch any existing rows. So:
--   - User signed up yesterday (cook_night_enabled=true) → stays true.
--   - User signs up tomorrow → defaults to false; opts in via Settings.
--
-- The "opt in via Settings" UI already exists from v1.18 (the same
-- settings panel where users toggle daily digest hour, notifications,
-- etc.). No client changes needed for this migration to take effect.
--
-- Idempotent.

ALTER TABLE public.user_settings
  ALTER COLUMN cook_night_enabled SET DEFAULT false;

-- ─── Sanity-check queries (run manually after apply) ─────────────────
--
-- Confirm the new default takes effect for future inserts (should show false):
--   SELECT column_default FROM information_schema.columns
--   WHERE table_name = 'user_settings' AND column_name = 'cook_night_enabled';
--
-- Confirm existing users were NOT changed (count of enabled should match pre-migration):
--   SELECT cook_night_enabled, count(*) FROM public.user_settings GROUP BY 1;
