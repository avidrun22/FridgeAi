-- ─── 20260502_searchable_products.sql ────────────────────────────────────────
--
-- v1.16 Phase 1 — Local product catalog + keyword fuzzy search.
--
-- Builds the foundation for the layered natural-language search architecture:
-- this migration creates the `searchable_products` table, the indexes that
-- make fuzzy + full-text matching fast, and the `search_products(query)`
-- RPC that App.js will call from the AddModal type-ahead.
--
-- Data sources (populated by `scripts/ingest_off_dump.py` and friends):
--   - Open Food Facts (OFF) US-locale subset
--   - USDA FoodData Central branded foods
--   - Our own community-captured scans (future — Phase 2)
--
-- Design notes:
--   - Source + source_id is the natural key. Same product from two sources
--     becomes two rows; deduplication happens at search time via ranking.
--   - search_vector is a STORED generated column so we don't have to manage
--     trigger updates. Postgres recomputes it on any INSERT/UPDATE.
--   - pg_trgm gives us typo tolerance. tsvector gives us tokenized matching.
--     The search RPC combines both for best-of-both ranking.
--   - This table is PUBLIC READ. RLS only restricts writes (service role).

-- Required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.searchable_products (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL CHECK (source IN ('openfoodfacts', 'usda_fdc', 'community')),
  source_id       TEXT NOT NULL,
  barcode         TEXT,
  name            TEXT NOT NULL,
  generic_name    TEXT,
  brand           TEXT,
  category        TEXT,                          -- ok2eat enum: Dairy/Protein/Produce/Dry Goods/Beverages/Other
  emoji           TEXT,
  image_url       TEXT,
  quantity        TEXT,                          -- e.g. "1 L", "12 oz"
  serving_size    TEXT,
  countries_tags  TEXT[],                        -- e.g. ['en:united-states']
  nutriments      JSONB,                         -- normalized: {calories_per_100g, fat_g, ...}
  nutri_score     TEXT,                          -- 'a' through 'e'
  eco_score       TEXT,                          -- 'a' through 'e'
  allergens       TEXT[],                        -- e.g. ['milk', 'nuts']
  ingredients_text TEXT,
  is_organic      BOOLEAN DEFAULT false,
  -- Generated tsvector for full-text search. Weighted A/B/C so name matches
  -- rank highest, then brand, then generic_name. Use 'simple' config so we
  -- don't drop short tokens like "tj" or "oat" via stemming.
  search_vector   TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(brand, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(generic_name, '')), 'C')
  ) STORED,
  imported_at     TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source, source_id)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Trigram fuzzy match on name + brand. Handles typos, partial words,
-- abbreviations. The GIN operator class supports % and similarity().
CREATE INDEX IF NOT EXISTS idx_searchable_name_trgm
  ON public.searchable_products USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_searchable_brand_trgm
  ON public.searchable_products USING GIN (brand gin_trgm_ops)
  WHERE brand IS NOT NULL;

-- Full-text search via the generated tsvector column.
CREATE INDEX IF NOT EXISTS idx_searchable_fts
  ON public.searchable_products USING GIN (search_vector);

-- Fast barcode lookup (covers v1.15 OFF barcode-enrichment use case too).
-- Once the catalog is populated, App.js can query Supabase first and only
-- fall back to OFF's API for cache misses.
CREATE INDEX IF NOT EXISTS idx_searchable_barcode
  ON public.searchable_products (barcode)
  WHERE barcode IS NOT NULL;

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- Public-read, service-role-write. Anyone (including anonymous users) can
-- query the catalog. Only the ingest script (running as service_role) can
-- insert/update rows.
ALTER TABLE public.searchable_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read searchable_products"
  ON public.searchable_products
  FOR SELECT
  USING (true);

-- (No INSERT/UPDATE/DELETE policies → only service_role can mutate.)

-- ─── Search RPC ───────────────────────────────────────────────────────────────
-- The function App.js calls from the AddModal type-ahead.
--
-- Combined ranking:
--   - ts_rank_cd of the full-text match (weighted by name > brand > generic)
--   - similarity(name, query) for trigram score
--   - similarity(brand, query) at half weight
--
-- A row is returned if EITHER the tsvector matches the query OR the trigram
-- similarity exceeds Postgres's default threshold (set_limit, default 0.3).
-- Results are ordered by combined rank, capped at result_limit.
--
-- Input: trim+lowercase happens client-side; we expect a clean query string.
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
      trim(query) AS raw_q,
      websearch_to_tsquery('simple', trim(query)) AS ts_q
  )
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
  ORDER BY rank DESC
  LIMIT result_limit;
$$;

COMMENT ON FUNCTION public.search_products IS
  'v1.16 Phase 1 — fuzzy + full-text search across the local product catalog. '
  'Called from AddModal type-ahead, debounced 300ms client-side. '
  'Returns top-N matches ranked by combined ts_rank + trigram similarity.';

-- ─── Barcode lookup RPC (companion) ───────────────────────────────────────────
-- Fast exact-match by barcode. Used by the scan flow once the catalog
-- includes barcodes (which it will, from OFF and our community captures).
CREATE OR REPLACE FUNCTION public.lookup_product_by_barcode(
  p_barcode TEXT
) RETURNS TABLE (
  id BIGINT,
  name TEXT,
  brand TEXT,
  category TEXT,
  emoji TEXT,
  image_url TEXT,
  nutriments JSONB,
  source TEXT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    sp.id,
    sp.name,
    sp.brand,
    sp.category,
    sp.emoji,
    sp.image_url,
    sp.nutriments,
    sp.source
  FROM public.searchable_products sp
  WHERE sp.barcode = regexp_replace(coalesce(p_barcode, ''), '[^0-9]', '', 'g')
  ORDER BY
    -- Prefer USDA over OFF over community for the same barcode (USDA is
    -- highest-quality, community is least vetted).
    CASE sp.source
      WHEN 'usda_fdc' THEN 0
      WHEN 'openfoodfacts' THEN 1
      WHEN 'community' THEN 2
      ELSE 3
    END,
    sp.updated_at DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.lookup_product_by_barcode IS
  'v1.16 Phase 1 — fast barcode → product lookup against the local catalog. '
  'Caller falls back to lib/openFoodFacts.js (live API) on miss.';

-- ─── Convenience: updated_at auto-bump ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._searchable_products_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_searchable_products_updated_at ON public.searchable_products;
CREATE TRIGGER trg_searchable_products_updated_at
  BEFORE UPDATE ON public.searchable_products
  FOR EACH ROW EXECUTE FUNCTION public._searchable_products_set_updated_at();
