-- ─── 20260516_v122_search_generic_first.sql ──────────────────────────────────
--
-- v1.22 #239 — Make AddModal search return generic items first.
--
-- The problem: search_products() queries searchable_products, which is
-- populated entirely from OFF + USDA FDC — both branded SKU catalogs. Type
-- "whole milk" and you get 10 branded variants ("Horizon Organic Whole Milk
-- Half Gallon Refrigerated Carton", "Trader Joe's Whole Milk Quart") but
-- never a plain "Whole Milk" generic — because that doesn't exist in the
-- source data. The v1.21 scorer rewards no-brand results, but it can't
-- surface a generic that isn't in the candidate pool.
--
-- The fix: UNION foodkeeper_shelf_life (660 curated generic entries) into
-- the same RPC, scaled to ALWAYS rank above branded variants when there's
-- a confident match. So "whole milk" returns:
--   1. Milk, Whole (FoodKeeper generic)             ← brand-less, top result
--   2. Horizon Organic Whole Milk … (OFF)           ← brand variant below
--   3. Trader Joe's Whole Milk … (OFF)
--   …
-- For "horizon whole milk" → FK has no rows with "horizon" in name/keywords
-- so it returns nothing, OFF rows surface as usual with brand-token bonus.
--
-- Same function NAME + same return shape → zero client changes required.
-- handlePickResult on iOS/Android/web treats FK rows like any other; the
-- subsequent lookupShelfLife() call resolves the FK row by name and pulls
-- the shelf-life days from the same table.
--
-- Score scale:
--   FoodKeeper rank: 100-1000 (boosted into a band well above OFF's 0-5)
--     - exact name (case-insensitive)              → 1000
--     - all query tokens appear in name            →  700 − length-penalty
--     - query is substring of name                 →  600 − length-penalty
--     - query is substring of keywords             →  500
--     - trigram fuzzy (variants/typos)             →  similarity × 300
--   OFF/USDA rank: 0-5 (unchanged — ts_rank_cd × 2 + sim + brand_sim × 0.5)
--
-- FK rows with rank < 100 are dropped (low-confidence trigram-only matches
-- shouldn't dominate over decent OFF matches).
--
-- Idempotent: CREATE OR REPLACE replaces the existing function definition.
-- No table or index changes — both source tables already exist.

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
      trim(query)                                  AS raw_q,
      lower(trim(query))                           AS lq,
      websearch_to_tsquery('simple', trim(query))  AS ts_q
  ),
  -- ── FoodKeeper generics ─────────────────────────────────────────────────
  -- The data shape: name = short product family ("Milk", "Almond Milk"),
  -- subtitle = disambiguator ("Plain Or Flavored", "Lactose-free", "Whole"),
  -- keywords = comma-separated synonyms ("Milk,plain,flavored,UHT"). Match
  -- across name + subtitle + keywords so query tokens land regardless of
  -- which column the term is in. Return display name = "name, subtitle"
  -- so the user can pick the right variant ("Milk, Plain Or Flavored").
  --
  -- Negative IDs (-f.id) avoid collision with searchable_products.id space
  -- so callers using the id as a key see a stable, non-overlapping namespace.
  fk_raw AS (
    SELECT
      (-f.id)::BIGINT          AS id,
      CASE
        WHEN f.subtitle IS NULL OR f.subtitle = '' THEN f.name
        ELSE f.name || ', ' || f.subtitle
      END                      AS name,
      NULL::TEXT               AS brand,
      f.ok2eat_category        AS category,
      NULL::TEXT               AS emoji,
      NULL::TEXT               AS image_url,
      NULL::TEXT               AS barcode,
      NULL::JSONB              AS nutriments,
      'foodkeeper'::TEXT       AS source,
      (
        CASE
          -- Exact match against composite "name, subtitle" or just name.
          WHEN lower(f.name || ', ' || COALESCE(f.subtitle, '')) = q.lq THEN 1000.0
          WHEN lower(f.name) = q.lq THEN 950.0
          -- All query tokens appear somewhere in name+subtitle+keywords —
          -- handles "whole milk" vs "Milk, Whole", "almond milk" vs "Almond Milk",
          -- "chicken thighs" vs "Chicken, Thighs".
          WHEN q.lq <> '' AND (
            SELECT COALESCE(bool_and(
              position(tok IN lower(
                f.name || ' ' || COALESCE(f.subtitle, '') || ' ' || COALESCE(f.keywords, '')
              )) > 0
            ), false)
            FROM regexp_split_to_table(q.lq, '\s+') AS tok
            WHERE length(tok) > 1
          ) THEN 700.0 - LEAST(50.0, GREATEST(0.0, (length(f.name) - length(q.lq))::numeric))
          -- Substring of query inside name.
          WHEN position(q.lq IN lower(f.name)) > 0
            THEN 600.0 - LEAST(50.0, GREATEST(0.0, (length(f.name) - length(q.lq))::numeric))
          -- Substring inside subtitle.
          WHEN position(q.lq IN lower(COALESCE(f.subtitle, ''))) > 0 THEN 550.0
          -- Substring inside keywords.
          WHEN position(q.lq IN lower(COALESCE(f.keywords, ''))) > 0 THEN 500.0
          ELSE similarity(lower(f.name), q.lq) * 300.0
        END
      )::REAL AS rank
    FROM public.foodkeeper_shelf_life f, q
    WHERE
      lower(f.name) % q.lq
      OR lower(f.name) LIKE '%' || q.lq || '%'
      OR lower(COALESCE(f.subtitle, '')) LIKE '%' || q.lq || '%'
      OR lower(COALESCE(f.keywords, '')) LIKE '%' || q.lq || '%'
      OR EXISTS (
        SELECT 1
        FROM regexp_split_to_table(q.lq, '\s+') AS tok
        WHERE length(tok) > 1
          AND position(tok IN lower(
            f.name || ' ' || COALESCE(f.subtitle, '') || ' ' || COALESCE(f.keywords, '')
          )) > 0
      )
  ),
  -- Keep only confident FoodKeeper matches. Trigram-only matches at < 100
  -- shouldn't outrank decent branded variants.
  fk AS (
    SELECT * FROM fk_raw WHERE rank >= 100
  ),
  -- ── OFF + USDA branded catalog ──────────────────────────────────────────
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
    SELECT * FROM fk
    UNION ALL
    SELECT * FROM sp
  ) merged
  ORDER BY rank DESC, length(name) ASC
  LIMIT result_limit;
$$;

COMMENT ON FUNCTION public.search_products IS
  'v1.22 #239 — merged search across foodkeeper_shelf_life (generics) and '
  'searchable_products (OFF + USDA branded). FK rows are scaled to rank '
  'above OFF when confident, so generic items ("Milk, Whole") surface above '
  'branded variants ("Horizon Organic Whole Milk Half Gallon"). For brand-'
  'specific queries ("horizon whole milk"), FK returns nothing and OFF wins.';

-- ─── Smoke tests (verified 2026-05-16, all returning generics on top) ────
-- SELECT name, brand, source, rank FROM public.search_products('almond milk', 8);
--   Verified: "Almond Milk" (FK, 950), "Almond milk, refrigerated" (FK, 950).
-- SELECT name, brand, source, rank FROM public.search_products('milk', 8);
--   Verified: 5 "Milk, …" variants at FK exact-name rank 950.
-- SELECT name, brand, source, rank FROM public.search_products('whole milk', 5);
--   Verified: 5 "Milk, …" variants (FK trigram, ~136), then OFF branded.
--   FoodKeeper has no row literally named "Whole Milk"; generics live as
--   "Milk, Plain Or Flavored" so trigram is the path. Still beats OFF rank.
-- SELECT name, brand, source, rank FROM public.search_products('cream cheese', 5);
--   Verified: "Cream Cheese" (FK, 950) → Mascarpone → Vegan cream cheese.
-- SELECT name, brand, source, rank FROM public.search_products('chicken thighs', 5);
--   Verified: "Chicken Parts, Legs Or Thighs" (FK, 700 via all-tokens match).
-- SELECT name, brand, source, rank FROM public.search_products('horizon whole milk', 5);
--   Verified: all branded "Horizon Organic Whole Milk" from OFF, NO FK noise
--   (FK has no "horizon" in name/subtitle/keywords anywhere).
