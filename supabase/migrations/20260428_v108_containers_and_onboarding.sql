-- v1.0.8 part 2: containers + onboarding gate
--
-- Two small additions on top of 20260428_v108_shared_households.sql:
--
-- 1. fridge_items.container — which physical bin an item lives in.
--    Fixed list for v1.0.8 (fridge / pantry / freezer). If users ask for
--    custom containers later, we promote this to a real `containers` table
--    without breaking existing rows.
--
-- 2. user_settings.has_seen_household_onboarding — flag flipped to true
--    after a user finishes the household-onboarding flow (name household
--    + pick first container) so they don't see it twice.
--
-- Apply via Supabase SQL Editor any time. Both changes are additive and
-- backwards-compatible — v1.0.7 clients ignore the new columns.


-- ─── 1. fridge_items.container ─────────────────────────────────────────────

ALTER TABLE public.fridge_items
  ADD COLUMN IF NOT EXISTS container text NOT NULL DEFAULT 'fridge';

-- Constrain to the v1.0.8 enum values. NOT VALID + VALIDATE pattern keeps
-- the constraint-add cheap on a large table — the existing rows are all
-- already 'fridge' (column default), so VALIDATE is essentially free.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fridge_items_container_check'
  ) THEN
    ALTER TABLE public.fridge_items
      ADD CONSTRAINT fridge_items_container_check
      CHECK (container IN ('fridge', 'pantry', 'freezer')) NOT VALID;
    ALTER TABLE public.fridge_items
      VALIDATE CONSTRAINT fridge_items_container_check;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fridge_items_container
  ON public.fridge_items(household_id, container);


-- ─── 2. user_settings.has_seen_household_onboarding ───────────────────────

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS has_seen_household_onboarding boolean NOT NULL DEFAULT false;


-- ─── 3. Sanity-checks (manual; run separately if desired) ────────────────
--
--   SELECT container, count(*) FROM fridge_items GROUP BY container;
--     -- should show all rows under 'fridge' until users start moving them
--
--   SELECT has_seen_household_onboarding, count(*)
--   FROM user_settings GROUP BY 1;
--     -- all existing users start at false; flipped to true after they
--     -- complete onboarding in v1.0.8
