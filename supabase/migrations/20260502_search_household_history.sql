-- ─── 20260502_search_household_history.sql ─────────────────────────────────
--
-- v1.16 Phase 1 — Layer 1 of the natural-language search architecture.
--
-- "Most grocery searches are repeats of items the user has bought before."
-- This RPC fuzzy-searches the household's own fridge_items history before
-- the global catalog. Returns deduplicated names ordered by recency-weighted
-- frequency: items the household buys often AND recently rank highest.
--
-- Layered search order in AddModal:
--   1. search_household_items(query)   ← THIS RPC. Resolves ~70-80% of queries.
--   2. search_products(query)           ← Falls through to global catalog.
--   3. (v1.17) semantic search via pgvector.
--   4. (v1.18) LLM query expansion.
--
-- Why fridge_items as the source vs. a separate "search_history" table:
--   We already have everything the user has ever added (by name, with
--   category, emoji, etc.). No new schema, no new write paths to maintain.
--   Trigram fuzzy index on name.

-- pg_trgm already created in 20260502_searchable_products.sql
-- (CREATE EXTENSION IF NOT EXISTS pg_trgm; — no-op if already present)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram fuzzy index on fridge_items.name for fast personal-history search.
-- Scoped to the household via the WHERE clause in the RPC, but we need the
-- index to make the trigram match itself fast.
CREATE INDEX IF NOT EXISTS idx_fridge_items_name_trgm
  ON public.fridge_items USING GIN (name gin_trgm_ops);

-- ─── search_household_items(query) RPC ────────────────────────────────────────
--
-- Returns one row per UNIQUE name in the household's history (not one row per
-- fridge_item — duplicates dedupe). Picks the most-recent example of each
-- name to inherit category/emoji/unit/quantity defaults.
--
-- Ranking signals:
--   - Trigram similarity to the query  (how relevant)
--   - times_added                       (how often)
--   - last_added recency                (how lately)
--
-- Combined as: similarity * 1.0 + log(times_added + 1) * 0.3 + recency_boost
-- where recency_boost decays over 90 days.
--
-- Safety: the household_id filter is enforced at the SQL level via
-- household_members membership. Caller doesn't pass a household_id; we
-- derive it from auth.uid(). Same pattern as our other multi-tenant RPCs.
CREATE OR REPLACE FUNCTION public.search_household_items(
  query TEXT,
  result_limit INT DEFAULT 5
) RETURNS TABLE (
  name           TEXT,
  category       TEXT,
  emoji          TEXT,
  unit           TEXT,
  quantity       INT,
  times_added    INT,
  last_added_at  TIMESTAMPTZ,
  rank           REAL
)
LANGUAGE sql STABLE
AS $$
  WITH user_households AS (
    SELECT household_id
    FROM public.household_members
    WHERE user_id = auth.uid()
  ),
  q AS (
    SELECT trim(query) AS raw_q
  ),
  -- Aggregate the household's history: one row per distinct name.
  -- Pick the most-recent fridge_item for each name to inherit defaults
  -- (the template item user expects when they re-add this name).
  history AS (
    SELECT DISTINCT ON (lower(fi.name))
      fi.name,
      fi.category,
      fi.emoji,
      fi.unit,
      fi.quantity,
      fi.added_date AS last_added_at,
      (SELECT count(*)::INT FROM public.fridge_items fi2
        WHERE fi2.household_id = fi.household_id
          AND lower(fi2.name) = lower(fi.name)) AS times_added
    FROM public.fridge_items fi
    WHERE fi.household_id IN (SELECT household_id FROM user_households)
      AND fi.name IS NOT NULL
      AND length(trim(fi.name)) > 0
    ORDER BY lower(fi.name), fi.added_date DESC
  )
  SELECT
    h.name,
    h.category,
    h.emoji,
    h.unit,
    h.quantity,
    h.times_added,
    h.last_added_at,
    (
      similarity(h.name, (SELECT raw_q FROM q)) * 1.0
      + ln(h.times_added + 1) * 0.3
      + GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (now() - h.last_added_at)) / (86400.0 * 90.0)) * 0.4
    )::REAL AS rank
  FROM history h, q
  WHERE
    -- Use pg_trgm similarity match (the % operator). Default threshold
    -- is 0.3 — caller can adjust globally with set_limit() if needed.
    h.name % q.raw_q
    -- ALSO accept exact substring matches even if trigram score is below
    -- threshold (for short queries like "milk" that wouldn't otherwise hit).
    OR lower(h.name) LIKE '%' || lower(q.raw_q) || '%'
  ORDER BY rank DESC
  LIMIT result_limit;
$$;

COMMENT ON FUNCTION public.search_household_items IS
  'v1.16 Phase 1 — Layer 1 of the search architecture. Fuzzy-searches the '
  'authenticated user''s household history (fridge_items). Returns deduped '
  'names ranked by similarity * recency * frequency. Falls through to '
  'search_products() in the AddModal cascade when no high-confidence hits.';

-- ─── Permissions ──────────────────────────────────────────────────────────────
-- Authenticated users can call (their own household_id is auto-derived from
-- auth.uid() inside the function — see user_households CTE). The function is
-- STABLE so PostgREST handles caching appropriately.
GRANT EXECUTE ON FUNCTION public.search_household_items TO authenticated;
