-- v1.18 — daily-recipe cache
-- =============================================================================
--
-- Memoizes the generate-recipes output per user per day, so that:
--   1. send-email-digest can call it when rendering today's digest email
--   2. send-smart-cook-night can reuse the same recipes for the 6pm push
--   3. Cron retries (a few minutes apart, by design) don't multiply Claude
--      cost — the second call hits the cache instead of re-prompting.
--
-- The cache is intentionally per-user-per-day, not per-user-rolling. Two
-- reasons:
--   - "Today's recipe" is a meaningful unit. If the user opens the digest
--     in the morning and the Smart Cook Night push at 6pm, they should
--     see the SAME recipes — otherwise the system feels inconsistent.
--   - Fridge contents can shift over a day (items used / added), but the
--     recipes-for-today only refresh at the daily cron tick. This avoids
--     "my fridge changed mid-day and now I have different recipes than
--     I was just looking at." Acceptable trade.
--
-- The row gets invalidated naturally by the date-key — tomorrow's cron
-- writes a new row with a new for_date. We don't delete old rows; they
-- accumulate for analytics ("how often does the same recipe re-surface
-- for the same user?"). A monthly pg_cron job will prune > 30 days.
-- =============================================================================

CREATE TABLE IF NOT EXISTS daily_recipe_cache (
  user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  for_date    DATE         NOT NULL,
  -- recipes shape: [{ id, title, uses_items, prep_minutes, missing_ingredients }]
  -- id is a stable per-recipe slug we generate so the iOS app's Universal
  -- Link handler can route /recipes/{id} to the right detail screen.
  recipes     JSONB        NOT NULL,
  -- which items were expiring when the recipes were generated. Persisted
  -- for "did the user use these items in the next 24h?" analytics.
  source_items JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- which user_profile state (diet + household size) the cache was
  -- generated against. If the user changes their dietary prefs, we
  -- invalidate by checking this on read.
  profile_hash TEXT        NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, for_date)
);

COMMENT ON TABLE  daily_recipe_cache       IS 'v1.18 — memoizes generate-recipes output per user per day for digest + Smart Cook Night reuse.';
COMMENT ON COLUMN daily_recipe_cache.recipes      IS '[{ id, title, uses_items, prep_minutes, missing_ingredients }] — 1-3 entries.';
COMMENT ON COLUMN daily_recipe_cache.source_items IS 'Snapshot of which fridge_items were used as input. For "did the user actually eat these?" analytics.';
COMMENT ON COLUMN daily_recipe_cache.profile_hash IS 'Hash of dietary prefs + household size at generation time. Used to invalidate cache when prefs change.';

CREATE INDEX IF NOT EXISTS daily_recipe_cache_for_date_idx
  ON daily_recipe_cache (for_date);

-- RLS — users can read their own cache rows; service role writes them.
ALTER TABLE daily_recipe_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_recipe_cache_select_own
  ON daily_recipe_cache
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Service-role-only writes — never the user. The Edge Function uses the
-- service role key when populating the cache, so no INSERT/UPDATE policy
-- is needed for `authenticated`.
