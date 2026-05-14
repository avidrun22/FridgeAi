-- v1.18 — Recipe favorites (saved recipes)
-- =============================================================================
-- Users heart a recipe → it persists here. The Plan tab gets a "Saved
-- Recipes" section that lists them all, and the recipe-cache deep-link
-- modal gets a heart toggle in its header.
--
-- recipe_data is the full DailyRecipe JSON (name, emoji, time, difficulty,
-- description, ingredients, instructions, tip, uses_items). Stored
-- denormalized rather than referencing daily_recipe_cache.recipes[i]
-- because cache rows roll off — but a saved recipe shouldn't disappear
-- just because the day it was generated has passed. Trades a bit of
-- storage for "this recipe is yours, even if it's no longer on the
-- daily list" durability.
--
-- We index `recipe_data->>'name'` so duplicate-save detection ("you've
-- already saved 'Spinach yogurt bowl'") can fire client-side via a
-- pre-save query without scanning everything.
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_recipes_saved (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Foreign-ish reference back to daily_recipe_cache for analytics ("how
  -- many saves come from the morning email vs. in-app browsing?"). Nullable
  -- so the column doesn't gate saves from screens that don't track origin.
  source_recipe_id TEXT    NULL,
  recipe_data JSONB        NOT NULL,
  saved_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  user_recipes_saved             IS 'v1.18 — recipes the user has favorited. Plan tab surfaces these.';
COMMENT ON COLUMN user_recipes_saved.recipe_data IS 'Full DailyRecipe JSON. Denormalized so saved recipes survive cache rolls.';
COMMENT ON COLUMN user_recipes_saved.source_recipe_id IS 'Optional. Recipe id from daily_recipe_cache at save time. Analytics-only.';

-- Common lookups: user's full list ordered newest-first.
CREATE INDEX IF NOT EXISTS user_recipes_saved_user_saved_at_idx
  ON user_recipes_saved (user_id, saved_at DESC);

-- Dedup helper: pre-save check by name so the iOS UI can grey out the
-- heart for recipes already saved. Uses an expression index on the
-- normalized name so a JSONB extraction in the WHERE clause is fast.
CREATE INDEX IF NOT EXISTS user_recipes_saved_user_name_idx
  ON user_recipes_saved (user_id, lower(recipe_data->>'name'));

-- RLS — read + write only your own saves. Service role bypasses RLS for
-- any future server-side surfacing (e.g. "recipes you saved last week"
-- in the weekly digest).
ALTER TABLE user_recipes_saved ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_recipes_saved_select_own
  ON user_recipes_saved FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY user_recipes_saved_insert_own
  ON user_recipes_saved FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_recipes_saved_delete_own
  ON user_recipes_saved FOR DELETE TO authenticated
  USING (user_id = auth.uid());
