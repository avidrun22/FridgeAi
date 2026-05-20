-- ─── 20260519_v125_onboarding_4_items_gate.sql ───────────────────────────
--
-- v1.25 #284 — Onboarding gate. New users (and existing users with empty
-- fridges) can't navigate to Eat Me First / Plan / Dashboard until they've
-- added 4+ items. Without items, every other surface in the app is an empty
-- state — first-run experience drops off a cliff. The gate forces users to
-- experience the load-the-fridge moment, which then makes Eat Me First /
-- recipes / digest emails immediately meaningful.
--
-- One column: timestamp of when the user FIRST reached 4 items. NULL = still
-- locked; non-NULL = unlocked permanently (never re-locks even if they delete
-- items down to 0 later — punishing existing users for cleanup would feel
-- hostile).
--
-- We store the timestamp (not just a boolean) so we can:
--   1. Measure time-to-unlock in PostHog (signup → 4 items)
--   2. Identify users who unlocked within 5 min (high intent) vs days
--      (low engagement) for cohort analysis
--   3. Backfill: any existing user with >=4 items today gets the timestamp
--      set to now() so they don't suddenly see a gate on their next app load.
--
-- Idempotent.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS onboarding_4_items_unlocked_at timestamptz;

-- ─── Backfill ────────────────────────────────────────────────────────────
-- Anyone with 4+ items right now should NOT see the gate. Set their
-- unlock timestamp to the timestamp of their 4th item (best-effort —
-- ordering by created_at, taking the 4th).
WITH item_counts AS (
  SELECT
    user_id,
    COUNT(*) AS n,
    (
      SELECT created_at FROM public.fridge_items fi2
      WHERE fi2.user_id = fi1.user_id
      ORDER BY created_at ASC
      OFFSET 3 LIMIT 1
    ) AS fourth_item_at
  FROM public.fridge_items fi1
  GROUP BY user_id
)
UPDATE public.user_settings us
SET    onboarding_4_items_unlocked_at = COALESCE(us.onboarding_4_items_unlocked_at, ic.fourth_item_at, now())
FROM   item_counts ic
WHERE  ic.user_id = us.user_id
  AND  ic.n >= 4
  AND  us.onboarding_4_items_unlocked_at IS NULL;

-- ─── Sanity-check queries (run manually after apply) ─────────────────────
-- Locked users (would see the gate if they opened the app now):
--   SELECT count(*) FROM public.user_settings WHERE onboarding_4_items_unlocked_at IS NULL;
--
-- Unlocked users (have crossed the 4-item threshold at some point):
--   SELECT count(*) FROM public.user_settings WHERE onboarding_4_items_unlocked_at IS NOT NULL;
--
-- Time-to-unlock distribution (for users with both signup + unlock timestamps):
--   SELECT
--     CASE
--       WHEN onboarding_4_items_unlocked_at - u.created_at < INTERVAL '1 hour'  THEN '< 1h'
--       WHEN onboarding_4_items_unlocked_at - u.created_at < INTERVAL '1 day'   THEN '< 1d'
--       WHEN onboarding_4_items_unlocked_at - u.created_at < INTERVAL '7 days'  THEN '< 1w'
--       ELSE                                                                          '>= 1w'
--     END AS bucket,
--     count(*)
--   FROM public.user_settings us
--   JOIN auth.users u ON u.id = us.user_id
--   WHERE us.onboarding_4_items_unlocked_at IS NOT NULL
--   GROUP BY 1
--   ORDER BY 1;
