-- v1.18 — raise default `expiring_within_days` from 3 → 7
-- =============================================================================
--
-- Why:
--   The 3-day default was too tight in practice. Users with normal grocery
--   cycles (one shop/week) buy items with 5-10 day shelf lives, which
--   silently fell outside the daily-digest's "expiring within window" gate.
--   greg.h.goldberg@gmail.com hadn't received a digest in 7 days because
--   his only at-risk item was 4-5 days out — within the 5-day digest scan
--   the function does, but outside his per-user `expiring_within_days = 3`
--   filter on the items query. Bumping the default to 7 catches the typical
--   weekly-shop user without forcing them to find the setting.
--
--   v1.18 also removes the "skip when both empty" function-level gate so
--   the gate-bug pattern doesn't recur. Two layers of defense.
--
-- Migration scope:
--   1. Column default: existing rows on the OLD default of 3 are migrated
--      to 7. We deliberately do NOT touch rows where the user has actively
--      set a different value (e.g. some users may have lowered to 1 for
--      tight-window alerts; others may have raised to 14). The UPDATE
--      WHERE clause filters to exactly 3.
--   2. Future signups get the new default automatically via the ALTER
--      COLUMN ... SET DEFAULT statement.
-- =============================================================================

-- 1) New default for future inserts.
ALTER TABLE user_settings
  ALTER COLUMN expiring_within_days SET DEFAULT 7;

-- 2) Migrate existing users sitting on the old default. Preserves users
--    who intentionally configured a different value.
UPDATE user_settings
  SET expiring_within_days = 7,
      updated_at = now()
  WHERE expiring_within_days = 3;

-- 3) Audit log so we can see how many rows moved when the migration ran.
DO $$
DECLARE migrated_count int;
BEGIN
  SELECT count(*) INTO migrated_count
  FROM user_settings
  WHERE expiring_within_days = 7;
  RAISE NOTICE 'v1.18 expiring_within_days: % users now on the new 7-day default', migrated_count;
END $$;
