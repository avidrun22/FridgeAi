-- v1.26 — weekly_meal_plans
-- =============================================================================
-- Persistent store for "Plan for the week" — the new top-level mode in the
-- Plan tab that lets a household generate 5 dinners for Monday-Friday at
-- once, scaled to a specific serving count, drawn from a set of cuisines
-- they pre-select.
--
-- Why persist (vs. session-only): Greg wants a "Previous Plans" section
-- (mirrors the "Past Lists" pattern on shopping lists). Users can scroll
-- their history, peek at a past week, and tap "Reactivate this plan" to
-- clone it into a fresh active plan. Repeat-a-good-week is the value moment.
--
-- Auto-save model: every time the user taps "Generate plan" in week mode,
-- we INSERT a new row here. The most recent row per household IS the active
-- plan; everything else is "Previous Plans". No separate active/archived
-- flag — ordering by created_at desc gives us "current" for free, and a
-- soft archived_at is reserved for explicit "delete from history" later.
--
-- Per-household scope (not per-user): a meal plan is a household artifact.
-- Anyone in the household sees the same active plan.
--
-- Counterpart to weekly_meal_plans is NOT generated_recipes_cache —
-- those are two separate caches:
--   - generated_recipes_cache: shared, anonymous, ingredient-keyed cache of
--     individual Claude-generated recipes. Hit-rate optimization.
--   - weekly_meal_plans: per-household, identified, 5-recipe collections.
--     Persistence + history.
-- A weekly plan CAN populate from generated_recipes_cache hits at gen-time
-- (cost savings), but once saved it lives in its own row independent of
-- whether the underlying cache entries change.
--
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.weekly_meal_plans (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID         NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  created_by   UUID         NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Serving count the recipes were scaled to. Asked fresh every generation
  -- (no default-from-household_size), so we store what the user chose for
  -- this specific plan rather than inferring it back.
  servings     INT          NOT NULL CHECK (servings BETWEEN 1 AND 20),
  -- Cuisines the user multi-selected. Empty array = "any cuisine, surprise
  -- me" (Claude varies across all). Otherwise Claude draws from this set.
  cuisines     TEXT[]       NOT NULL DEFAULT '{}',
  -- The 5 recipe objects, indexed 0..4 = Mon..Fri. Shape matches
  -- DailyRecipe (same as recipe_bank rows + daily_recipe_cache): name,
  -- time, difficulty, emoji, description, ingredients[], instructions[],
  -- tip, uses_items. Same shape lets the existing RecipeSheet modal render
  -- weekly recipes generically without a new code path.
  recipes      JSONB        NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Reserved for an explicit "delete from history" future feature. NULL =
  -- visible in Previous Plans; set = hidden. The Edge Function + queries
  -- below already filter on this so the column is wired even if no UI ships.
  archived_at  TIMESTAMPTZ  NULL
);

COMMENT ON TABLE  public.weekly_meal_plans IS
  'v1.26 — Persistent weekly meal plans (5 dinners Mon-Fri). Most recent per household = active plan; rest = Previous Plans history.';
COMMENT ON COLUMN public.weekly_meal_plans.recipes IS
  'JSONB array of 5 DailyRecipe-shaped objects, indexed 0..4 = Monday..Friday.';
COMMENT ON COLUMN public.weekly_meal_plans.cuisines IS
  'User-selected cuisines for this plan. Empty array = no constraint, Claude varies across all.';

-- Hot-path lookup: load the active plan + previous plans for a household
-- in created_at-desc order. Single composite index covers both queries.
CREATE INDEX IF NOT EXISTS weekly_meal_plans_household_created_idx
  ON public.weekly_meal_plans (household_id, created_at DESC);

-- RLS: household-scoped reads + writes. Mirrors the shopping_lists policy
-- pattern — anyone in the household can see + create plans, only the
-- creator can soft-archive (held for future delete-from-history feature).
ALTER TABLE public.weekly_meal_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weekly_meal_plans_select ON public.weekly_meal_plans;
CREATE POLICY weekly_meal_plans_select
  ON public.weekly_meal_plans FOR SELECT
  TO authenticated
  USING (
    household_id IN (
      SELECT household_id FROM public.household_members
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS weekly_meal_plans_insert ON public.weekly_meal_plans;
CREATE POLICY weekly_meal_plans_insert
  ON public.weekly_meal_plans FOR INSERT
  TO authenticated
  WITH CHECK (
    household_id IN (
      SELECT household_id FROM public.household_members
      WHERE user_id = auth.uid()
    )
    AND (created_by = auth.uid() OR created_by IS NULL)
  );

DROP POLICY IF EXISTS weekly_meal_plans_update ON public.weekly_meal_plans;
CREATE POLICY weekly_meal_plans_update
  ON public.weekly_meal_plans FOR UPDATE
  TO authenticated
  USING (
    household_id IN (
      SELECT household_id FROM public.household_members
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    household_id IN (
      SELECT household_id FROM public.household_members
      WHERE user_id = auth.uid()
    )
  );

-- Sanity-check (run after applying):
--   SELECT count(*) FROM public.weekly_meal_plans;     -- expect 0
--   \d public.weekly_meal_plans                          -- inspect schema
--
-- Useful queries the app + future analytics will lean on:
--
--   -- 1. Load active plan for a household (most recent, non-archived):
--   SELECT * FROM public.weekly_meal_plans
--   WHERE household_id = $1 AND archived_at IS NULL
--   ORDER BY created_at DESC LIMIT 1;
--
--   -- 2. List previous plans (everything except the most recent):
--   SELECT id, servings, cuisines, created_at,
--          (recipes->0->>'name') AS first_recipe_name
--   FROM   public.weekly_meal_plans
--   WHERE  household_id = $1 AND archived_at IS NULL
--   ORDER BY created_at DESC
--   OFFSET 1 LIMIT 20;
--
--   -- 3. Clone a previous plan as a new active plan (Reactivate this plan):
--   INSERT INTO public.weekly_meal_plans (household_id, created_by, servings, cuisines, recipes)
--   SELECT household_id, $1, servings, cuisines, recipes
--   FROM   public.weekly_meal_plans
--   WHERE  id = $2;
