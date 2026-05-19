-- ─── 20260518_v123_search_timeout_fix.sql ───────────────────────────────
--
-- v1.23 #275 — search_products() was timing out under anon role's 3s
-- statement timeout, returning HTTP 500 (code 57014 "canceling statement
-- due to statement timeout") to every client. Greg surfaced it as
-- "cheddar cheese returns no results" — but it's much broader: any query
-- that didn't hit the SP fast path was failing for real users.
--
-- Observed live: 3,390ms anon-role round-trip for 'cheddar cheese'
-- against PostgREST. SQL Editor (postgres role, no timeout) returns the
-- same query in ~2s, so the function "works" in introspection but dies
-- for the actual app. Classic split-brain.
--
-- Root cause: the searchable_products UNION (855,288 rows from OFF +
-- USDA branded catalog). The previous WHERE clause:
--
--     WHERE sp.search_vector @@ q.ts_q
--        OR sp.name % q.raw_q                    -- ← trigram OR
--        OR (sp.brand IS NOT NULL AND sp.brand % q.raw_q)
--
-- ORing a trigram operator with another condition defeats the GIN
-- index path on search_vector. The planner falls back to a Seq Scan +
-- per-row similarity() computation across 855K rows. That's the budget.
--
-- Two-part fix:
--
--   1. Drop the trigram OR in the SP WHERE clause — keep ONLY the
--      FTS predicate (sp.search_vector @@ q.ts_q). This uses the
--      GIN tsvector index in the only path planner picks. Trigram
--      similarity still contributes to the SP rank score, but it no
--      longer gates row selection.
--
--   2. Short-circuit SP entirely when FK already has confident matches.
--      FK ranks 100-1000 always beat SP ranks 0-5, so if FK returned
--      ANY row with rank >= 500, the SP rows would be filtered out of
--      the top-N anyway. Just don't compute them.
--
-- Trade-off accepted: typo-tolerance for OFF branded products
-- ('cheeze' → 'cheese') gets weaker. But the FK side still has full
-- trigram fallback against 1,250+ generic foods, which is where the
-- typo-tolerance value lives anyway. Brand-typo recovery is a v1.24+
-- problem if it ever surfaces in real PostHog data.
--
-- Idempotent: CREATE OR REPLACE. Same function signature and same
-- return shape as v1.22.1 #248 → zero client changes required. All
-- three clients (iOS, Android, web) get the fix on apply.

CREATE OR REPLACE FUNCTION public.search_products(
  query TEXT,
  result_limit INT DEFAULT 10
) RETURNS TABLE (
  id BIGINT,
  name TEXT,
  brand TEXT,
  category TEXT,
  emoji TEXT,
  image_url TEXT,
  barcode TEXT,
  nutriments JSONB,
  source TEXT,
  rank REAL
)
LANGUAGE sql STABLE
AS $$
  WITH q AS (
    SELECT
      trim(query)                                                AS raw_q,
      lower(trim(query))                                         AS lq,
      regexp_split_to_array(lower(trim(query)), '\s+')           AS tokens,
      websearch_to_tsquery('simple', trim(query))                AS ts_q
  ),
  -- ── FoodKeeper / USDA generics ──────────────────────────────────────
  fk_base AS (
    SELECT
      (-f.id)::BIGINT  AS id,
      f.name           AS raw_name,
      f.subtitle       AS raw_subtitle,
      CASE
        WHEN f.subtitle IS NULL OR f.subtitle = '' THEN f.name
        ELSE f.name || ', ' || f.subtitle
      END              AS composed_name,
      lower(f.name)    AS name_lc,
      lower(
        f.name || ' '
        || COALESCE(f.subtitle, '') || ' '
        || COALESCE(f.keywords, '')
      )                AS hay,
      f.ok2eat_category AS category
    FROM public.foodkeeper_shelf_life f
  ),
  fk_scored AS (
    SELECT
      b.id,
      b.composed_name AS name,
      b.name_lc,
      NULL::TEXT      AS brand,
      b.category,
      NULL::TEXT      AS emoji,
      NULL::TEXT      AS image_url,
      NULL::TEXT      AS barcode,
      NULL::JSONB     AS nutriments,
      'foodkeeper'::TEXT AS source,
      (
        CASE
          WHEN lower(b.composed_name) = q.lq THEN 1000.0
          WHEN b.name_lc = q.lq THEN 950.0
          WHEN q.lq <> '' AND (
            SELECT COALESCE(bool_and(position(tok IN b.hay) > 0), false)
            FROM unnest(q.tokens) AS tok
            WHERE length(tok) >= 2
          ) THEN 700.0 - LEAST(
            50.0,
            GREATEST(0.0, (length(b.composed_name) - length(q.lq))::numeric)
          )
          WHEN position(q.lq IN lower(b.composed_name)) > 0
            THEN 600.0 - LEAST(
              50.0,
              GREATEST(0.0, (length(b.composed_name) - length(q.lq))::numeric)
            )
          WHEN position(q.lq IN b.hay) > 0 THEN 500.0
          ELSE similarity(b.hay, q.lq) * 300.0
        END
      )::REAL AS rank
    FROM fk_base b, q
    WHERE
      b.hay % q.lq
      OR b.hay LIKE '%' || q.lq || '%'
      OR EXISTS (
        SELECT 1
        FROM unnest(q.tokens) AS tok
        WHERE length(tok) >= 2
          AND position(tok IN b.hay) > 0
      )
  ),
  fk_filtered AS (
    SELECT * FROM fk_scored WHERE rank >= 100
  ),
  fk_deduped AS (
    SELECT DISTINCT ON (name_lc)
      id, name, brand, category, emoji, image_url, barcode, nutriments, source, rank
    FROM fk_filtered
    ORDER BY name_lc, rank DESC, length(name) ASC, id ASC
  ),
  -- v1.23 #275 — Short-circuit guard. If FK has any confident match
  -- (rank >= 500), SP rows would never make the top-N anyway because
  -- SP ranks max out around 5. Skipping SP saves the 855K-row scan
  -- and pulls anon-role runtime back well under the 3s ceiling.
  fk_top AS (
    SELECT COALESCE(MAX(rank), 0)::REAL AS top_rank FROM fk_deduped
  ),
  -- ── OFF + USDA branded catalog ──────────────────────────────────────
  -- v1.23 #275 — FTS-only filter. The previous version ORed
  -- `sp.name % q.raw_q` into this WHERE, which defeated the GIN index
  -- on search_vector and forced a Seq Scan over 855K rows. The
  -- trigram similarity now contributes ONLY to the rank score, not to
  -- the row filter. GIN index on search_vector is the only path.
  sp AS (
    SELECT
      sp.id,
      sp.name,
      sp.brand,
      sp.category,
      sp.emoji,
      sp.image_url,
      sp.barcode,
      sp.nutriments,
      sp.source,
      (
        ts_rank_cd(sp.search_vector, q.ts_q) * 2.0
        + similarity(sp.name, q.raw_q) * 1.0
        + COALESCE(similarity(sp.brand, q.raw_q), 0) * 0.5
      )::REAL AS rank
    FROM public.searchable_products sp, q, fk_top
    WHERE
      fk_top.top_rank < 500   -- short-circuit when FK already confident
      AND sp.search_vector @@ q.ts_q
  )
  SELECT id, name, brand, category, emoji, image_url, barcode, nutriments, source, rank
  FROM (
    SELECT * FROM fk_deduped
    UNION ALL
    SELECT * FROM sp
  ) merged
  ORDER BY rank DESC, length(name) ASC
  LIMIT result_limit;
$$;

COMMENT ON FUNCTION public.search_products IS
  'v1.23 #275 — Timeout fix. Drops the trigram OR in SP WHERE (was '
  'forcing 855K-row Seq Scan), short-circuits SP when FK has confident '
  'rank>=500 matches. Same signature + return shape as v1.22.1 #248.';

-- ─── Smoke tests — run after apply ─────────────────────────────────────
-- All of these must return rows AND complete in well under 3s for the
-- anon role to not hit the PostgREST timeout.
--
-- SELECT name, rank FROM public.search_products('cheddar cheese', 4);
--   Expect: "Cheese, cheddar" at rank 699, plus 3 other cheese variants.
--
-- SELECT name, rank FROM public.search_products('swiss cheese', 4);
--   Expect: "Cheese, swiss" at top.
--
-- SELECT name, rank FROM public.search_products('whole milk', 4);
--   Expect: Milk variants.
--
-- SELECT name, rank FROM public.search_products('salmon', 4);
--   Expect: Salmon at top, then other Fish-family generics.
--
-- SELECT name, rank FROM public.search_products('coca cola', 4);
--   Expect: SP branded results (this query has no FK match, so FK is
--   empty → short-circuit skipped, SP runs with FTS-only filter).
