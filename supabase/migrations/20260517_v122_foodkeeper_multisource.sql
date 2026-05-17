-- ─── 20260517_v122_foodkeeper_multisource.sql ───────────────────────────────
--
-- v1.22 #245 — Extend foodkeeper_shelf_life to support multi-source ingest.
--
-- Greg called out the search catalog as a "core asset of my platform" so
-- this migration leans hard on idempotency, dedup safety, and provenance
-- tracking. The pattern: every row knows where it came from, and re-running
-- an ingest is a no-op via UNIQUE (source, fdc_id).
--
-- Adds columns:
--   source        TEXT         — origin tag. (PRE-EXISTING column; this migration
--                                only adds defaults + NOT NULL constraint.)
--                                Actual values in production (verified 2026-05-17):
--                                  'USDA FoodKeeper' — original FSIS load (660 rows)
--                                  'Extension'       — PSU Extension articles (199 rows)
--                                  'Manufacturer'    — vendor-published guidelines (109)
--                                  'FDA'             — FDA publications (10)
--                                  'FSIS'            — FSIS articles (9)
--                                  'NCHFP'           — National Center for Home Food Preservation (2)
--                                  'USDA FDC'        — USDA FoodData Central (NEW, added by ingest_usda_fdc.py)
--   fdc_id        INTEGER      — original ID at the source system. NULL for FSIS / Haiku rows.
--   display_name  TEXT         — Haiku-normalized friendly name. NULL = fall back to "name, subtitle".
--                                Backfilled later in a separate Haiku pass (deferred to v1.24).
--   imported_at   TIMESTAMPTZ  — when this row was loaded. NULL on legacy rows.
--
-- Adds infrastructure:
--   - Sequence foodkeeper_id_seq starting at 100,000 for auto-generated ids
--     on new inserts. Existing rows keep their explicit ids.
--   - UNIQUE (source, fdc_id) — re-running an ingest is idempotent.
--   - Index on source for source-segmented queries.
--   - Index on imported_at DESC for "what got loaded most recently" queries.
--
-- Backfills (kept for environments where source might be NULL — in production
-- these were already populated by the original data import, so the UPDATEs
-- are no-ops there):
--   - source IS NULL AND id < 10000   → source = 'USDA FoodKeeper'
--   - source IS NULL AND id >= 10000  → source = 'Extension'
--
-- Updates the search_products RPC to prefer display_name when set. The
-- existing "name, subtitle" concatenation stays as the fallback so this is
-- backwards-compatible — no behavior change until display_name rows start
-- appearing.
--
-- This migration is fully idempotent: re-running it does nothing harmful.

-- ─── Phase 1: Add columns ────────────────────────────────────────────────
ALTER TABLE public.foodkeeper_shelf_life
  ADD COLUMN IF NOT EXISTS source       TEXT,
  ADD COLUMN IF NOT EXISTS fdc_id       INTEGER,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS imported_at  TIMESTAMPTZ;

-- ─── Phase 2: Backfill source for existing rows ──────────────────────────
-- Safe to re-run: only updates rows where source is still NULL.
-- Defensive backfill for fresh environments. In production these are no-ops
-- because the original data import already populated source with values like
-- 'USDA FoodKeeper' / 'Extension' / etc. Values here match what would be the
-- closest existing analogue if we were re-loading from CSV.
UPDATE public.foodkeeper_shelf_life
SET source = 'USDA FoodKeeper'
WHERE source IS NULL AND id < 10000;

UPDATE public.foodkeeper_shelf_life
SET source = 'Extension'
WHERE source IS NULL AND id >= 10000;

-- ─── Phase 3: Tighten source constraint ──────────────────────────────────
-- After backfill, source can be NOT NULL. New inserts that forget to set
-- it default to 'unknown' which is grep-able for auditing.
DO $$ BEGIN
  ALTER TABLE public.foodkeeper_shelf_life
    ALTER COLUMN source SET DEFAULT 'unknown';
EXCEPTION WHEN OTHERS THEN
  -- Default may already be set; ignore.
  NULL;
END $$;

-- Only set NOT NULL if all rows have a source (defensive against backfill misses)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.foodkeeper_shelf_life WHERE source IS NULL) THEN
    ALTER TABLE public.foodkeeper_shelf_life
      ALTER COLUMN source SET NOT NULL;
  END IF;
END $$;

-- ─── Phase 4: Sequence for auto-generated ids ────────────────────────────
-- New ingests (USDA FDC and beyond) don't need to think about id collisions.
-- Starts at 100,000 — well above the existing FSIS range (1-684) and the
-- Phase 2 Haiku range (10000-99999).
CREATE SEQUENCE IF NOT EXISTS public.foodkeeper_id_seq
  START WITH 100000
  INCREMENT BY 1
  NO MAXVALUE
  NO MINVALUE
  CACHE 1;

-- Catch up the sequence in case rows already exist with ids >= 100000
-- (idempotency: re-running shouldn't reset the sequence backwards).
SELECT setval(
  'public.foodkeeper_id_seq',
  GREATEST(
    100000,
    COALESCE((SELECT MAX(id) FROM public.foodkeeper_shelf_life WHERE id >= 100000), 99999) + 1
  ),
  false
);

-- Bind the sequence to id as the default. Explicit ids on INSERT still
-- override (existing rows are unaffected).
ALTER TABLE public.foodkeeper_shelf_life
  ALTER COLUMN id SET DEFAULT nextval('public.foodkeeper_id_seq');

-- ─── Phase 5: Dedup + lookup indexes ─────────────────────────────────────

-- Idempotency for ingest scripts. Same (source, fdc_id) can only exist once.
-- The WHERE clause keeps the index small — only rows with fdc_id participate.
CREATE UNIQUE INDEX IF NOT EXISTS foodkeeper_source_fdcid_unique
  ON public.foodkeeper_shelf_life (source, fdc_id)
  WHERE fdc_id IS NOT NULL;

-- Source-segmented queries (e.g., "show me only USDA FDC rows").
CREATE INDEX IF NOT EXISTS foodkeeper_source_idx
  ON public.foodkeeper_shelf_life (source);

-- "What got loaded most recently?" for ingest audits.
CREATE INDEX IF NOT EXISTS foodkeeper_imported_at_idx
  ON public.foodkeeper_shelf_life (imported_at DESC NULLS LAST);

-- ─── Phase 6: Documentation ──────────────────────────────────────────────
COMMENT ON COLUMN public.foodkeeper_shelf_life.source IS
  'Origin tag for provenance + segmented queries. Pre-existing column, '
  'populated by the original data import. Actual values: '
  'USDA FoodKeeper (660 — original FSIS), Extension (199 — PSU Extension), '
  'Manufacturer (109), FDA (10), FSIS (9), NCHFP (2), '
  'USDA FDC (added by scripts/ingest_usda_fdc.py — USDA FoodData Central).';

COMMENT ON COLUMN public.foodkeeper_shelf_life.fdc_id IS
  'Original ID at the source system (USDA FoodData Central). NULL for FSIS / Haiku rows. '
  'Unique per source via foodkeeper_source_fdcid_unique index — makes ingest re-runs idempotent.';

COMMENT ON COLUMN public.foodkeeper_shelf_life.display_name IS
  'Haiku-normalized friendly display name (e.g., "Cheddar cheese" instead of "Cheese, cheddar"). '
  'NULL = caller should fall back to name + ", " + subtitle. Backfilled in a later Haiku pass.';

COMMENT ON COLUMN public.foodkeeper_shelf_life.imported_at IS
  'When this row was loaded into the table. NULL on legacy rows that pre-date this column.';

-- ─── Phase 7: Update search_products to prefer display_name ──────────────
-- Drop-in replacement for the v1.22 #239 search_products RPC. Only change:
-- the FK display name now COALESCEs to display_name when set, otherwise
-- falls back to the existing "name, subtitle" concatenation. Pure
-- backwards-compatible — no behavior change until display_name rows arrive.

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
  fk_raw AS (
    SELECT
      (-f.id)::BIGINT          AS id,
      -- v1.22 #245 — prefer display_name when set, else fall back to the
      -- v1.22 #239 "name, subtitle" comma format.
      COALESCE(
        f.display_name,
        CASE
          WHEN f.subtitle IS NULL OR f.subtitle = '' THEN f.name
          ELSE f.name || ', ' || f.subtitle
        END
      )                        AS name,
      NULL::TEXT               AS brand,
      f.ok2eat_category        AS category,
      NULL::TEXT               AS emoji,
      NULL::TEXT               AS image_url,
      NULL::TEXT               AS barcode,
      NULL::JSONB              AS nutriments,
      'foodkeeper'::TEXT       AS source,
      (
        CASE
          WHEN lower(f.name || ', ' || COALESCE(f.subtitle, '')) = q.lq THEN 1000.0
          WHEN lower(f.name) = q.lq THEN 950.0
          WHEN q.lq <> '' AND (
            SELECT COALESCE(bool_and(
              position(tok IN lower(
                f.name || ' ' || COALESCE(f.subtitle, '') || ' ' || COALESCE(f.keywords, '')
              )) > 0
            ), false)
            FROM regexp_split_to_table(q.lq, '\s+') AS tok
            WHERE length(tok) > 1
          ) THEN 700.0 - LEAST(50.0, GREATEST(0.0, (length(f.name) - length(q.lq))::numeric))
          WHEN position(q.lq IN lower(f.name)) > 0
            THEN 600.0 - LEAST(50.0, GREATEST(0.0, (length(f.name) - length(q.lq))::numeric))
          WHEN position(q.lq IN lower(COALESCE(f.subtitle, ''))) > 0 THEN 550.0
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
  fk AS (
    SELECT * FROM fk_raw WHERE rank >= 100
  ),
  sp AS (
    SELECT
      sp.id, sp.name, sp.brand, sp.category, sp.emoji, sp.image_url, sp.barcode, sp.nutriments, sp.source,
      (
        ts_rank_cd(sp.search_vector, q.ts_q) * 2.0
        + similarity(sp.name, q.raw_q) * 1.0
        + COALESCE(similarity(sp.brand, q.raw_q), 0) * 0.5
      )::REAL AS rank
    FROM public.searchable_products sp, q
    WHERE sp.search_vector @@ q.ts_q
       OR sp.name % q.raw_q
       OR (sp.brand IS NOT NULL AND sp.brand % q.raw_q)
  )
  SELECT id, name, brand, category, emoji, image_url, barcode, nutriments, source, rank
  FROM (SELECT * FROM fk UNION ALL SELECT * FROM sp) merged
  ORDER BY rank DESC, length(name) ASC
  LIMIT result_limit;
$$;

COMMENT ON FUNCTION public.search_products IS
  'v1.22 #245 — merged search across foodkeeper_shelf_life (generics, now '
  'multi-source via the source column) and searchable_products (OFF + USDA '
  'branded). FK rows prefer display_name when set; otherwise fall back to '
  '"name, subtitle". FK rows scaled to rank above OFF when confident.';

-- ─── Verification queries (run after deploy) ─────────────────────────────
-- SELECT source, COUNT(*) FROM public.foodkeeper_shelf_life GROUP BY source;
--   Expect: fsis_foodkeeper_v128 = 660, extended_haiku = 320
-- SELECT MAX(id) FROM public.foodkeeper_shelf_life;
--   Expect: <= 10358 before USDA ingest, then 100000+ after.
-- SELECT nextval('public.foodkeeper_id_seq');
--   Expect: 100000 (or higher if you've already run it).
