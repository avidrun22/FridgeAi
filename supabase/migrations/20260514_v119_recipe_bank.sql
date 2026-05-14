-- v1.19 — Recipe Bank
-- =============================================================================
-- Persistent recipe catalog browsable from the Plan tab. Until now all recipes
-- have been ephemeral — generated on-demand per user, cached for the day,
-- aged out. For a real "browse recipes" surface we need a stable bank.
--
-- The bank is seeded with ~150 broadly-popular dish concepts (sourced by
-- cross-referencing major publisher "best of" lists, then re-written in our
-- own voice by Claude — see scripts/research_recipe_seeds.py +
-- scripts/seed_recipe_bank.py). After the initial seed, the bank grows via:
--   - On-demand recipes from the "generate one for me" search CTA, optionally
--     promoted to the bank after K user saves (v1.20+).
--   - User-imported recipes from URLs/text (v1.20+).
--
-- recipe_bank is the SOURCE OF TRUTH for browseable recipes.
-- daily_recipe_cache stays the per-user/per-day ephemeral cache that drives
-- the morning digest + Smart Cook Night push. They serve different masters
-- and should stay separate.
--
-- When a user hearts a bank recipe, the full recipe JSON gets snapshotted
-- into user_recipes_saved.recipe_data (matching the existing pattern). The
-- bank id is preserved as user_recipes_saved.source_recipe_id for analytics.
-- This means bank edits don't mutate the user's save — see §8.3 of the spec.
-- =============================================================================

CREATE TABLE IF NOT EXISTS recipe_bank (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- URL-safe slug. Used in Universal Links (ok2eat.com/recipes/<slug>) so
  -- bank recipes deep-link the same way daily_recipe_cache ids do.
  slug            TEXT         NOT NULL UNIQUE,
  name            TEXT         NOT NULL,
  emoji           TEXT         NOT NULL DEFAULT '🍳',
  -- Canonical numeric minutes, not the legacy "20 min" string. Lets us filter
  -- "≤30 min" without parsing.
  time_minutes    INT          NULL,
  difficulty      TEXT         NULL,         -- easy | medium | hard
  meal_type       TEXT         NULL,         -- breakfast | lunch | dinner | snack
  cuisine         TEXT         NULL,         -- italian, mexican, american, etc. Free-form.
  dietary_tags    TEXT[]       NOT NULL DEFAULT '{}',   -- vegetarian, vegan, gluten_free, dairy_free, nut_free, low_carb, keto, pescatarian
  description     TEXT         NULL,
  -- DailyRecipe-compatible shape: [{ item, amount }]. Keeps the recipe-sheet
  -- modal generic across bank + cache + saved sources.
  ingredients     JSONB        NOT NULL,
  -- Array of step strings. Matches DailyRecipe.instructions.
  instructions    TEXT[]       NOT NULL,
  tip             TEXT         NULL,
  -- Provenance. seed = one-time research-derived; generated = promoted from
  -- on-demand user search; user_imported = pasted/scanned from elsewhere.
  source          TEXT         NOT NULL DEFAULT 'seed' CHECK (source IN ('seed', 'generated', 'user_imported')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  recipe_bank             IS 'v1.19 — Persistent recipe catalog. Source of truth for browseable recipes in the Plan tab.';
COMMENT ON COLUMN recipe_bank.slug        IS 'URL-safe identifier. Used in Universal Links (ok2eat.com/recipes/<slug>).';
COMMENT ON COLUMN recipe_bank.ingredients IS 'DailyRecipe-shaped JSONB array: [{ item, amount }].';
COMMENT ON COLUMN recipe_bank.source      IS 'seed | generated | user_imported. Lets us measure how the bank grows.';

-- Browse-by-meal-type filter (primary UI filter chip).
CREATE INDEX IF NOT EXISTS recipe_bank_meal_type_idx
  ON recipe_bank (meal_type) WHERE meal_type IS NOT NULL;

-- GIN index for dietary_tags array contains queries: "vegan AND gluten_free"
CREATE INDEX IF NOT EXISTS recipe_bank_dietary_tags_idx
  ON recipe_bank USING gin (dietary_tags);

-- Full-text search on name + description for the Search tab.
CREATE INDEX IF NOT EXISTS recipe_bank_search_idx
  ON recipe_bank USING gin (
    to_tsvector('english', name || ' ' || coalesce(description, ''))
  );

-- Sort by newest for "recently added" sections.
CREATE INDEX IF NOT EXISTS recipe_bank_created_at_idx
  ON recipe_bank (created_at DESC);

-- Auto-touch updated_at on every row mutation. Helpful for incremental
-- syncing if we later add a client-side recipe cache.
CREATE OR REPLACE FUNCTION recipe_bank_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recipe_bank_updated_at_trigger ON recipe_bank;
CREATE TRIGGER recipe_bank_updated_at_trigger
  BEFORE UPDATE ON recipe_bank
  FOR EACH ROW EXECUTE FUNCTION recipe_bank_set_updated_at();

-- RLS — public-read, no writes from app users. The bank is a shared catalog;
-- writes happen via service-role only (seed script, future on-demand promote,
-- future user_imported flow). Anon + authenticated can SELECT, no one but
-- service_role can INSERT/UPDATE/DELETE.
ALTER TABLE recipe_bank ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recipe_bank_select_all ON recipe_bank;
CREATE POLICY recipe_bank_select_all
  ON recipe_bank FOR SELECT
  TO anon, authenticated
  USING (true);
