-- v1.26 — generated_recipes_cache
-- =============================================================================
-- The shared cache for Claude-generated Eat-Me-First recipes. Every recipe
-- Claude produces gets stored here tagged with the user's dietary/allergens
-- and the applied filters (cuisine, protein, max_ingredients). On every
-- subsequent call we check the cache FIRST — if we find ≥ 3 compatible recipes
-- whose `uses_items` overlap with the requesting user's top expiring items by
-- ≥ 2, we return those cache hits without calling Claude at all.
--
-- This is the cost-savings lever Greg called out: today every Eat-Me-First
-- "Suggest recipes" tap fires a fresh Claude call (~$0.005-0.01/call). After
-- this lands, identical-inventory taps should be near-free past the first
-- N users. Expected steady-state hit rate after ~100 active users with
-- typical fridges: 50–80% for common cuisines, lower for niche ones.
--
-- Distinct from recipe_bank: that's the curated "browse" catalog. This is
-- the organic, growing-by-use, ingredient-keyed cache of recipes Claude has
-- actually produced for real users. The two CAN merge later (we could
-- promote frequently-served generated recipes into recipe_bank with `source
-- = 'generated'`) — left as a v2 follow-up.
--
-- Counters baked in for v1.27's weekly analytics:
--   - serve_count          : bumped each time the recipe is served (cache hit OR fresh insert)
--   - shopping_list_adds   : bumped when a user adds the recipe's ingredients to a shopping list
--   - favorite_count       : bumped when a user hearts the recipe
-- These power the "most cooked this week" blog + the future "what others
-- are cooking" discovery tab (v2.0 roadmap).
--
-- Privacy: nothing here ties a recipe back to a user. The cache stores the
-- recipe + its diet/allergen safety tags. Counters are global, anonymous.
--
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.generated_recipes_cache (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Full DailyRecipe-shaped recipe payload. Same shape as recipe_bank +
  -- daily_recipe_cache: { name, time, difficulty, emoji, description,
  -- ingredients[{item,amount}], instructions[], tip }. Letting the existing
  -- recipe-sheet modal render this generically.
  recipe              JSONB        NOT NULL,
  -- Normalized lowercase item names this recipe actually uses, excluding
  -- pantry staples (salt, pepper, oil, water). Drives the overlap query
  -- with the user's top expiring items. Populated client-side on cache
  -- insert from the recipe.ingredients[].item field.
  uses_items          TEXT[]       NOT NULL DEFAULT '{}',
  -- Applied filters at generation time. NULL = wildcard (no filter
  -- applied; recipe is generic enough to serve any cuisine/protein).
  cuisine             TEXT         NULL,
  protein             TEXT         NULL,
  max_ingredients     INT          NULL,
  -- Dietary lifestyle tags this recipe is verified to respect. Multi-tag:
  -- a recipe can be both vegetarian + gluten_free. Empty array = no
  -- specific diet honored; recipe should NOT be served to a vegan user.
  dietary             TEXT[]       NOT NULL DEFAULT '{}',
  -- Allergens this recipe is verified safe for (= does NOT contain).
  -- A peanut-free recipe gets 'peanut' in this array. Lookup logic:
  -- serve only if user's allergens ⊆ this array.
  safe_for_allergens  TEXT[]       NOT NULL DEFAULT '{}',
  -- Counters (v1.27 analytics + v2.0 discovery)
  serve_count         INT          NOT NULL DEFAULT 1,
  shopping_list_adds  INT          NOT NULL DEFAULT 0,
  favorite_count      INT          NOT NULL DEFAULT 0,
  -- For freshness ordering (favor recently-served in cache queries).
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_served_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.generated_recipes_cache IS
  'v1.26 — Shared cache of Claude-generated recipes. Indexed by uses_items for ingredient-overlap retrieval. Cuts Claude spend on Eat-Me-First.';
COMMENT ON COLUMN public.generated_recipes_cache.uses_items IS
  'Lowercase ingredient names excluding pantry staples (salt, pepper, oil, water). GIN-indexed for fast overlap queries.';
COMMENT ON COLUMN public.generated_recipes_cache.safe_for_allergens IS
  'Allergens this recipe is verified to NOT contain. Serve to user only if user.allergens ⊆ this array.';

-- GIN index for the ingredient-overlap query (uses_items && user_items).
CREATE INDEX IF NOT EXISTS generated_recipes_cache_uses_items_idx
  ON public.generated_recipes_cache USING gin (uses_items);

-- Filter-narrowing index. Most cache queries will hit a specific
-- (cuisine, protein) tuple — sometimes both NULL for "Any/Any".
CREATE INDEX IF NOT EXISTS generated_recipes_cache_filters_idx
  ON public.generated_recipes_cache (cuisine, protein, max_ingredients);

-- Ordering index for "favor recently-served" in cache results.
CREATE INDEX IF NOT EXISTS generated_recipes_cache_last_served_idx
  ON public.generated_recipes_cache (last_served_at DESC);

-- GIN on safe_for_allergens for the allergens-subset check.
CREATE INDEX IF NOT EXISTS generated_recipes_cache_safe_allergens_idx
  ON public.generated_recipes_cache USING gin (safe_for_allergens);

-- RLS: read open to anon + authenticated (cache is a shared, anonymous
-- catalog). Writes happen only via service_role inside the generate-recipes
-- Edge Function.
ALTER TABLE public.generated_recipes_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS generated_recipes_cache_select_all ON public.generated_recipes_cache;
CREATE POLICY generated_recipes_cache_select_all
  ON public.generated_recipes_cache FOR SELECT
  TO anon, authenticated
  USING (true);

-- Atomic counter helpers. The Edge Function calls these instead of issuing
-- UPDATE … SET serve_count = serve_count + 1 directly, so multi-row bumps
-- happen in one round-trip and we don't risk a race.

CREATE OR REPLACE FUNCTION public.increment_generated_recipes_serve(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.generated_recipes_cache
  SET    serve_count    = serve_count + 1,
         last_served_at = now()
  WHERE  id = ANY(p_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_generated_recipes_shopping_add(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.generated_recipes_cache
  SET    shopping_list_adds = shopping_list_adds + 1
  WHERE  id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_generated_recipes_favorite(p_id uuid, p_delta int DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.generated_recipes_cache
  SET    favorite_count = GREATEST(0, favorite_count + p_delta)
  WHERE  id = p_id;
END;
$$;

-- Tighten function permissions: only service_role and authenticated users
-- can call the bumpers (authenticated for the shopping-list-add path,
-- service_role for the Edge Function's serve bump).
REVOKE ALL ON FUNCTION public.increment_generated_recipes_serve(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_generated_recipes_serve(uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.increment_generated_recipes_shopping_add(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_generated_recipes_shopping_add(uuid) TO service_role, authenticated;

REVOKE ALL ON FUNCTION public.increment_generated_recipes_favorite(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_generated_recipes_favorite(uuid, int) TO service_role, authenticated;

-- Sanity-check (run after applying):
--   SELECT count(*) FROM public.generated_recipes_cache;  -- expect 0
--   \d public.generated_recipes_cache                       -- inspect columns + indexes
--
-- A few useful queries we'll lean on from the Edge Function + future analytics:
--
--   -- 1. Cache hit lookup (the hot path):
--   SELECT id, recipe, uses_items, serve_count
--   FROM   public.generated_recipes_cache
--   WHERE  cardinality(ARRAY(SELECT unnest(uses_items) INTERSECT SELECT unnest($1::text[]))) >= 2
--     AND  (cuisine    = $2 OR ($2 IS NULL))      -- user-applied cuisine filter
--     AND  (protein    = $3 OR ($3 IS NULL))      -- user-applied protein filter
--     AND  ($4::text[] <@ safe_for_allergens)     -- user's allergens are a subset of safe-for
--     AND  ($5::text[] <@ dietary OR $5 = '{}')   -- user's dietary requirements are honored
--   ORDER BY last_served_at DESC, serve_count DESC
--   LIMIT 3;
--
--   -- 2. Bump counters on serve:
--   UPDATE public.generated_recipes_cache
--   SET    serve_count    = serve_count + 1,
--          last_served_at = now()
--   WHERE  id = ANY($1::uuid[]);
--
--   -- 3. v1.27 "most cooked this week":
--   SELECT id, recipe, serve_count, shopping_list_adds, favorite_count
--   FROM   public.generated_recipes_cache
--   WHERE  last_served_at >= now() - interval '7 days'
--   ORDER BY (serve_count + shopping_list_adds * 2 + favorite_count * 3) DESC
--   LIMIT 5;
