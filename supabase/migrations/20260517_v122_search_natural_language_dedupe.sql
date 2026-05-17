-- ─── 20260517_v122_search_natural_language_dedupe.sql ────────────────────
--
-- v1.22.1 #248 — Two search-quality bugs Greg reported in the field:
--
--   1. "swiss cheese" returned trigram-only matches (rank ~161), but
--      "Cheese, swiss" worked. Tokens matter — users type the natural
--      "<modifier> <noun>" order, USDA stores the inverted "Cheese, swiss"
--      shape. The existing all-tokens branch in #239 either wasn't deployed
--      or wasn't firing. Rewrite cleanly so token order doesn't matter.
--
--   2. Top 4 results showed two identical-looking "Cheese, swiss" rows
--      (USDA FDC has duplicate (name, subtitle) pairs at ids 100023 +
--      100084, plus low-sodium / low-fat variants competing for slots).
--      Dedupe at SEARCH TIME by lower(name) so each generic family
--      gets exactly one representative in the result set — surfacing
--      variety (cheddar / swiss / parmesan / gouda) instead of clusters.
--
-- Same function NAME + same return shape → zero client changes required.
-- All three clients (iOS in App Store, Android in Google Play closed
-- testing, web at app.ok2eat.com) get the new search behavior immediately
-- on apply.
--
-- Score scale:
--   FK rank: 100-1000 (always above OFF's 0-5 when confident)
--     1000 — exact match on composite "name, subtitle" or just name
--      950 — exact match on name alone
--      700 — every query token (length >= 2) appears somewhere in
--            name+subtitle+keywords haystack, regardless of order.
--            This is the path "swiss cheese" → "Cheese, swiss" takes.
--      600 — full query is a contiguous substring of name
--      500 — full query is a contiguous substring of subtitle/keywords
--      <500 — trigram similarity × 300 (typo/variant tolerance)
--
-- Idempotent: CREATE OR REPLACE.

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
  -- Pre-compute haystack and composed display name once, then score
  -- and dedupe in successive CTEs.
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
          -- Exact composite match.
          WHEN lower(b.composed_name) = q.lq THEN 1000.0
          -- Exact name match.
          WHEN b.name_lc = q.lq THEN 950.0
          -- All-tokens match (the natural-language path). Every query
          -- token of length >= 2 must appear in the haystack. Order
          -- doesn't matter, so "swiss cheese" matches "cheese swiss …".
          WHEN q.lq <> '' AND (
            SELECT COALESCE(bool_and(position(tok IN b.hay) > 0), false)
            FROM unnest(q.tokens) AS tok
            WHERE length(tok) >= 2
          ) THEN 700.0 - LEAST(
            50.0,
            GREATEST(0.0, (length(b.composed_name) - length(q.lq))::numeric)
          )
          -- Whole-query substring inside composed name.
          WHEN position(q.lq IN lower(b.composed_name)) > 0
            THEN 600.0 - LEAST(
              50.0,
              GREATEST(0.0, (length(b.composed_name) - length(q.lq))::numeric)
            )
          -- Whole-query substring inside keywords.
          WHEN position(q.lq IN b.hay) > 0 THEN 500.0
          -- Trigram fallback for typos / fuzzy matches.
          ELSE similarity(b.hay, q.lq) * 300.0
        END
      )::REAL AS rank
    FROM fk_base b, q
    WHERE
      -- Filter early: at least one signal must be present, otherwise the
      -- function would scan/score every row in the table for every query.
      b.hay % q.lq
      OR b.hay LIKE '%' || q.lq || '%'
      OR EXISTS (
        SELECT 1
        FROM unnest(q.tokens) AS tok
        WHERE length(tok) >= 2
          AND position(tok IN b.hay) > 0
      )
  ),
  -- Confident matches only — trigram-only at <100 shouldn't dominate.
  fk_filtered AS (
    SELECT * FROM fk_scored WHERE rank >= 100
  ),
  -- v1.22.1 #248 — DEDUPE BY GENERIC. One representative per lower(name).
  -- Tiebreaker: highest rank wins, then shortest composed display name
  -- (prefers the unqualified variant — "Cheese, swiss" beats
  -- "Cheese, swiss, low sodium" when user typed plain "swiss cheese").
  fk_deduped AS (
    SELECT DISTINCT ON (name_lc)
      id, name, brand, category, emoji, image_url, barcode, nutriments, source, rank
    FROM fk_filtered
    ORDER BY name_lc, rank DESC, length(name) ASC, id ASC
  ),
  -- ── OFF + USDA branded catalog ──────────────────────────────────────
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
    FROM public.searchable_products sp, q
    WHERE
      sp.search_vector @@ q.ts_q
      OR sp.name % q.raw_q
      OR (sp.brand IS NOT NULL AND sp.brand % q.raw_q)
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
  'v1.22.1 #248 — Natural-language search + dedupe by generic. Tokens in '
  'any order match (swiss cheese → Cheese, swiss). DISTINCT ON (lower(name)) '
  'collapses near-duplicates so result variety surfaces (cheddar / swiss / '
  'parmesan / gouda) instead of repeats of the same generic. Replaces #239.';

-- ─── Smoke tests — run after apply ─────────────────────────────────────
-- SELECT name, rank FROM public.search_products('swiss cheese', 5);
--   Expect: "Cheese, swiss" at rank ≥ 700, plus 4 OTHER cheese variants
--   (no duplicate "Cheese, swiss" rows).
--
-- SELECT name, rank FROM public.search_products('whole milk', 5);
--   Expect: Milk-family rows, distinct variants only.
--
-- SELECT name, rank FROM public.search_products('chicken breast', 5);
--   Expect: Chicken breast at top, then thigh / wing / whole — variety.
--
-- SELECT name, rank FROM public.search_products('salmon', 5);
--   Expect: Salmon at top, then other Fish-family generics.
--
-- SELECT name, rank FROM public.search_products('cheese', 5);
--   Expect: 5 different cheese types, NOT 5 variants of one.
