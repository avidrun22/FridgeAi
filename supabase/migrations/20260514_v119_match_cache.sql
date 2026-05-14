-- v1.19 — Recipe Inventory Match Cache
-- =============================================================================
-- Caches the result of the match-recipe-inventory Edge Function so re-taps
-- within the same fridge state are free. Cache key is the triple
-- (user_id, recipe_id, fridge_hash); when the user adds/removes/renames a
-- fridge item their fridge_hash changes and subsequent taps will repay Claude.
--
-- Why bake it into Postgres rather than memoize in the function:
--
--   1. Edge Function instances are ephemeral — each cold start would wipe
--      an in-memory LRU. Postgres survives invocations and deploys.
--   2. Multi-device users (iOS + web) share the same cache.
--   3. Quick-glance analytics: "how often do users actually re-tap within
--      the same fridge state?" is a SELECT on this table.
--
-- TTL is enforced lazily in the Edge Function (rows older than 7 days are
-- treated as miss). A nightly cleanup cron prunes physically — see
-- 20260514_v119_match_cache_cleanup_cron.sql for the schedule (TBD).
-- =============================================================================

CREATE TABLE IF NOT EXISTS recipe_inventory_match_cache (
  user_id       UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- bank slug OR daily_recipe_cache id (YYYYMMDD-{uid12}-{position}).
  recipe_id     TEXT         NOT NULL,
  -- SHA-256(sorted lowercase fridge item names), first 16 hex chars.
  fridge_hash   TEXT         NOT NULL,
  -- Full match result JSON. Shape:
  --   { matched: [{ ingredient, amount, fridge_item }],
  --     missing: [{ ingredient, amount }],
  --     unmatched_fridge_items: [string] }
  match_result  JSONB        NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recipe_id, fridge_hash)
);

COMMENT ON TABLE  recipe_inventory_match_cache              IS 'v1.19 — Cache of match-recipe-inventory Edge Function results, keyed by (user, recipe, fridge state).';
COMMENT ON COLUMN recipe_inventory_match_cache.fridge_hash  IS 'SHA-256(sorted lowercase fridge item names), first 16 hex chars. Changes invalidate the cache.';
COMMENT ON COLUMN recipe_inventory_match_cache.match_result IS 'JSONB: { matched, missing, unmatched_fridge_items }. Mirrors the Edge Function response.';

-- For nightly TTL cleanup ("DELETE WHERE created_at < now() - 7d").
CREATE INDEX IF NOT EXISTS recipe_inventory_match_cache_created_at_idx
  ON recipe_inventory_match_cache (created_at);

-- RLS — users can read/write only their own rows. Service role bypasses RLS,
-- so the Edge Function (which uses service role) can manage the cache for
-- any user without these policies getting in the way.
ALTER TABLE recipe_inventory_match_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recipe_inventory_match_cache_select_own ON recipe_inventory_match_cache;
CREATE POLICY recipe_inventory_match_cache_select_own
  ON recipe_inventory_match_cache FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS recipe_inventory_match_cache_insert_own ON recipe_inventory_match_cache;
CREATE POLICY recipe_inventory_match_cache_insert_own
  ON recipe_inventory_match_cache FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS recipe_inventory_match_cache_delete_own ON recipe_inventory_match_cache;
CREATE POLICY recipe_inventory_match_cache_delete_own
  ON recipe_inventory_match_cache FOR DELETE TO authenticated
  USING (user_id = auth.uid());
