# v1.23+ — Expand the generic foods catalog

> **Status:** plan draft, awaiting Greg's go-ahead.
> Continues #192 (extended_shelf_life Phase 2 — already at ~858 rows) and
> resolves Greg's #245 ask: "Cheddar cheese not in our catalog → search misses
> it. Expand. Priority: categorization → expiration → nutrition."

## Why this matters now

The v1.22 search backend (#239) unions `foodkeeper_shelf_life` (660 rows) on
top of `searchable_products` (OFF + USDA branded SKUs). Generic terms only
surface a clean result if the food has a row in `foodkeeper_shelf_life` —
otherwise the user sees branded Horizon-style SKUs at the top.

Greg's screenshot of "Cheddar cheese" missing from search is the canonical
case: FoodKeeper has "Cheese, Cheddar" only under the parent category, and
nothing matched cleanly. We need more rows.

## What's already done

| Source | Rows | Coverage |
|---|---|---|
| `foodkeeper_shelf_life` (USDA FSIS v128) | 660 | Original load — fridge/pantry/freezer × opened/unopened expiry, per-item tips |
| `shelf_life_extended.json` (Claude-Haiku-enriched) | ~858 | Phase 1 — adds rows missing from FoodKeeper (international/specialty items: smetana, injera, etc.) |

Total: ~1,518 unique generic items addressable by search. Target: **~5,000**
(matches v1.22 backlog item #192).

## Data sources — ranked by signal per row

### Tier 1 — USDA FoodData Central Foundation Foods (PRIMARY)

- **URL:** https://fdc.nal.usda.gov/download-datasets
- **License:** Public domain (US Govt work)
- **Rows:** ~190 reference foods + ~1,400 SR Legacy "Standard Reference" entries
- **What we get FREE:**
  - Standardized food name ("Cheese, cheddar")
  - USDA food category (Dairy and Egg Products / Vegetables and Vegetable Products / …)
  - Full nutrient profile (calories, fat, protein, carbs, fiber, sodium, vitamins) per 100g
  - Often a "common name" / "scientific name" / synonym list
- **What we DON'T get:** shelf life (have to derive from category) and the per-
  container fridge/pantry/freezer days (have to map from category default)
- **Format:** CSV download or REST API (https://api.nal.usda.gov/fdc/v1/)

### Tier 2 — USDA Branded Foods Database (LONG-TAIL)

- **URL:** Same download page; "Branded Foods" file
- **Rows:** ~400K branded SKUs (we already ingest most of this into
  `searchable_products` via `scripts/ingest_off_dump.py` for the OFF mirror,
  but the USDA Branded subset is higher quality + nutrition-complete)
- **Signal:** brand + serving size + complete nutrition
- **Use for v1.23:** Skip for foodkeeper expansion — branded SKUs belong in
  `searchable_products`, not `foodkeeper_shelf_life`. Out of scope.

### Tier 3 — FDA Reference Amounts Customarily Consumed (RACC)

- **URL:** https://www.fda.gov/media/77079/download (PDF), 21 CFR 101.12
- **Rows:** ~150 food categories with standard serving sizes
- **Use:** Lets us assign reasonable amounts to generic foods that don't
  have a serving size in USDA FDC (defaults to category RACC)

### Tier 4 — Claude Haiku enrichment (FILL GAPS)

- Continuation of `scripts/expand_shelf_life.py` Phase 2 pattern
- For items in Tier 1 that lack shelf-life data, ask Haiku to fill in
  fridge/pantry/freezer days using the existing extended-JSON schema
- Validates each row against the schema before append (existing logic)

### Tier 5 — Wikipedia / Wikidata for the very long tail

- Wikidata's "Food" hierarchy has ~30K categorized entries
- Use only for items USDA doesn't cover (specialty/regional foods)
- Out of scope for v1.23 — revisit at v1.24 if 5K target isn't reached

## Phased plan

### Phase 1 — Ingest USDA Foundation + SR Legacy

**Goal:** ~1,500 high-quality reference foods → fills the major gaps
(cheddar cheese, generic chicken breast, fresh basil, etc.)

1. Download FDC Foundation + SR Legacy CSV bundle from
   https://fdc.nal.usda.gov/download-datasets
2. Filter to food types: `foundation_food`, `sr_legacy_food`
3. Map FDC's `food_category_id` → our 6-category enum:
   - 1 (Dairy and Egg Products) → "Dairy" or "Protein" (eggs)
   - 5 (Poultry Products), 7 (Sausages and Luncheon Meats), 10 (Pork
     Products), 13 (Beef Products), 15 (Finfish/Shellfish), 16 (Legumes) → "Protein"
   - 9 (Fruits/Fruit Juices), 11 (Vegetables/Vegetable Products), 12 (Nut/Seed Products) → "Produce"
   - 8 (Baked Products), 18 (Cereal Grains/Pasta), 19 (Snacks), 20 (Soups/Sauces/Gravies) → "Dry Goods"
   - 14 (Beverages) → "Beverages"
   - 22 (Restaurant Foods), 25 (Meals/Entrees/Side Dishes), ... → "Other"
4. For each kept row, derive a category-default shelf life:
   - Use the existing `EXPIRY_MAP` defaults as a starting point
   - Override per-item where the name strongly suggests a specific window
     (e.g., "milk, whole, fresh" → use FoodKeeper Milk-Plain-Or-Flavored
     window; "spinach, raw" → 5d fridge)
5. Schema target: write to `foodkeeper_shelf_life` table with `source = 'usda_fdc'`
   so we can distinguish ingested rows from the FSIS originals
6. Validation: dedupe against existing rows (lower(name) + subtitle exact match)

### Phase 2 — Claude Haiku enrichment

**Goal:** Fill shelf-life gaps for items that came in from USDA without
container-specific days. Cap at ~3K items × Haiku to keep cost <$5.

1. Build candidate list: rows in `foodkeeper_shelf_life` where any of
   `fridge_max_days / pantry_max_days / freezer_max_days` is NULL
2. Run `scripts/expand_shelf_life.py` Phase 3 mode (new — adapted from Phase 2)
   - Reads (name, category, subtitle) tuples
   - Prompts Haiku with the existing schema + few-shot examples from
     FoodKeeper originals
   - Validates response against schema (existing logic)
   - Writes back via `--emit-migration` flag
3. Greg runs from his terminal (sandbox proxy 401s the Anthropic key)

### Phase 3 — Nutrition column (deferred to v1.24+)

USDA FDC includes per-100g nutrients. We currently store nutrition per
*branded barcode* in `searchable_products.nutriments` but not on the
foodkeeper rows. Adding `nutrients JSONB` to `foodkeeper_shelf_life` would
let the AddModal show "approx 113 cal / 8g protein" even for generic items.
Defer to v1.24 — it's a multi-table migration plus AddModal UI change.

## Schema changes needed

```sql
-- Migration: 20260517_v123_foodkeeper_expansion.sql

ALTER TABLE public.foodkeeper_shelf_life
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'fsis_foodkeeper_v128',
  ADD COLUMN IF NOT EXISTS fdc_id INTEGER,
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS foodkeeper_source_idx
  ON public.foodkeeper_shelf_life (source);

CREATE INDEX IF NOT EXISTS foodkeeper_fdc_id_idx
  ON public.foodkeeper_shelf_life (fdc_id)
  WHERE fdc_id IS NOT NULL;
```

No changes needed to `search_products` RPC — it already searches all rows
regardless of source.

## Loader script outline

```python
# scripts/ingest_usda_fdc.py
#
# Streams USDA FDC Foundation + SR Legacy CSV files, filters to food types
# we want, maps FDC category → ok2eat category, derives shelf-life defaults
# per category, dedupes against existing foodkeeper_shelf_life rows, bulk-
# upserts via Supabase REST with source='usda_fdc'.
#
# Same credential pattern as scripts/ingest_off_dump.py:
#   - Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from
#     .appstoreconnect/telegram_config.json (or env vars)
#   - Streams CSV in batches of 500 rows
#   - --dry-run flag to validate the pipeline without writing
#
# Usage:
#   python3 scripts/ingest_usda_fdc.py --dry-run --limit 1000
#   python3 scripts/ingest_usda_fdc.py    # full run, ~5-10 min
```

## Open questions for Greg

1. **Naming convention** — USDA names look like "Cheese, cheddar". Should
   we store as-is for consistency with FSIS FoodKeeper rows ("Milk, Plain
   Or Flavored"), or normalize to "Cheddar cheese"? Current display already
   joins `name + ", " + subtitle`, so as-is is the path of least resistance.
2. **Branded vs generic split** — Confirm the rule: foodkeeper_shelf_life
   only holds generics (no brand); searchable_products holds branded SKUs.
   USDA Foundation has zero brand. USDA SR Legacy is generic. Good fit.
3. **Cost budget** — Phase 2 Haiku enrichment is ~3K items × ~$0.001/call
   = ~$3. Approved?
4. **Timing** — Ship as part of v1.23 (after current v1.22 lands), or break
   into its own v1.22 hotfix? My read: v1.23, since it's data + needs
   testing across iOS/Android/web.

## What Claude will do next (waiting on Greg's nod)

1. Write `scripts/ingest_usda_fdc.py` (mirrors `ingest_off_dump.py` pattern)
2. Write the migration above
3. Phase 1 dry-run from Greg's terminal: validate mapping + dedupe logic
4. Phase 1 full run → ~1,500 rows added
5. Verify via SQL: `SELECT count(*) FROM foodkeeper_shelf_life GROUP BY source;`
6. Smoke-test in app: search "cheddar cheese" should now surface the
   USDA generic at the top (FK rank 950 = exact match)
