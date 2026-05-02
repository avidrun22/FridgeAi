# Natural-language product search — architecture

> **Status:** v1.16 Phase 1 prototyping (2026-05-02). Schema + RPC + ingest script staged. Not yet integrated into App.js.

## The problem we're solving

Barcode scanning works for ~60-70% of grocery items. The remaining 30-40% — produce, deli, bulk bins, restaurant takeout, anything in a ziploc — has no barcode. Users need to type a name and have ok2eat find the product (with image, nutrition, expiration default) without making them fill out a form.

OFF's text search API is too brittle to ship as the primary surface. So we build our own search layer.

## The architecture (layered)

Each layer fires only when the previous returns no high-confidence hit. Most queries resolve at Layer 1 or 2.

```
User types "tj's oat milk" in AddModal
     │
     ├─ Layer 1 (~50ms): Personal/household history
     │     SELECT * FROM fridge_items
     │     WHERE household_id = ? AND name ILIKE %query%
     │     Most queries are repeats. Highest relevance for "stuff this user actually buys."
     │
     ├─ Layer 2 (~200ms): Local product catalog                      ◀── v1.16 Phase 1 (this branch)
     │     SELECT * FROM search_products('tj''s oat milk', 10)
     │     pg_trgm fuzzy + tsvector full-text via Supabase RPC.
     │     ~1M US-locale products: OFF + USDA FDC + community.
     │
     ├─ Layer 3 (~500ms): Semantic search                            ◀── v1.17
     │     pgvector cosine similarity on pre-computed embeddings.
     │     Handles paraphrases, abbreviations, synonyms.
     │
     └─ Layer 4 (~1-2s): LLM query expansion                         ◀── v1.18
          Claude Haiku rewrites "tj's oat milk" → "Trader Joe's Oat Milk"
          Re-run Layers 2 + 3 on the expanded query.
```

## Phase 1 — what's in this branch

### `supabase/migrations/20260502_searchable_products.sql`

- **`searchable_products` table.** Source-tagged catalog with name, brand, category, barcode, nutriments, image. UNIQUE on (source, source_id) so OFF + USDA can both hold rows for the same product.
- **`pg_trgm` GIN indexes** on `name` and `brand` for fuzzy match (typos, partial words).
- **Generated `search_vector` tsvector** with weighted A/B/C (name > brand > generic_name) and a GIN index for tokenized full-text matching. Uses 'simple' config so short tokens like "tj" and "oat" aren't stemmed away.
- **Public read RLS** (`USING (true)`) so any authenticated *or anonymous* user can search. Writes restricted to service role.
- **`search_products(query, result_limit)` RPC** — combined ranker. Returns rows where EITHER tsvector matches OR trigram similarity exceeds threshold. Ranks by `ts_rank_cd * 2 + name_similarity + brand_similarity * 0.5`.
- **`lookup_product_by_barcode(barcode)` RPC** — fast exact-match for scan flow. Prefers USDA > OFF > community when multiple sources have the same barcode.

### `scripts/ingest_off_dump.py`

- Streams the OFF JSONL.gz dump (~10-15GB compressed, ~30-50GB raw) without buffering.
- Filters to US-relevant products (`countries_tags` contains `en:united-states` or `en:usa`). Expected survivors: ~500K-1M rows.
- Normalizes each product to the table schema using the same logic as `lib/openFoodFacts.js` (so single-source-of-truth for category mapping, brand fallback, etc.).
- Bulk-upserts via Supabase REST in batches of 500 (`Prefer: resolution=merge-duplicates`). Idempotent via the (source, source_id) unique constraint.
- Reads credentials from `.appstoreconnect/telegram_config.json` (same pattern as the deploy script) or env vars.

### `lib/openFoodFacts.js`

Already prototyped in a prior session. Stays as the LIVE-API fallback for cache misses. Two functions:
- `lookupByBarcode(barcode)` — for items not in our catalog yet
- `searchByText(query)` — best-effort, with a relevance guard (won't return junk results)

## How to run Phase 1

### One-time: apply the migration

```bash
# Via Supabase SQL Editor (paste the migration file).
# Or via supabase CLI:
supabase db push
```

### One-time: dry-run the ingest to validate the pipeline

```bash
cd ~/fridgeai-native
python3 scripts/ingest_off_dump.py --dry-run --limit 5000
```

Expected output: scans ~5K-50K rows, keeps a few hundred US-relevant after filter, prints "would have written N rows" without touching the DB.

### Full sync (~30-60 min the first time, ~10 min on incremental runs)

```bash
python3 scripts/ingest_off_dump.py
```

Streams the OFF dump, filters to US, upserts ~500K-1M rows. Network-bound on the download phase, batch-size-bound on the upload phase.

### Test the search RPC

```sql
-- In Supabase SQL Editor:
SELECT * FROM search_products('oat milk', 5);
SELECT * FROM search_products('tostitos', 5);
SELECT * FROM search_products('nutella', 5);
SELECT * FROM lookup_product_by_barcode('3017620422003');
```

### Schedule the weekly sync

Once the manual run is validated, add a Supabase scheduled task (or a cron entry on the Mac mini) that fires `python3 scripts/ingest_off_dump.py` every Sunday at 02:00 UTC. OFF refreshes their dump daily, but weekly is plenty for our use case.

## Storage + cost estimates

| Resource | Estimate at 1M US products |
|---|---|
| Table rows | ~1M |
| Average row size (after JSONB nutriments) | ~1.5KB |
| Total table size | ~1.5GB |
| pg_trgm indexes (name + brand) | ~600MB |
| FTS GIN index | ~400MB |
| **Total Postgres footprint** | **~2.5GB** |
| Supabase Pro plan storage | 8GB included |

## What's deferred

- **USDA FoodData Central ingest.** The OFF script is Phase 1; a parallel USDA script is Phase 1.5. Same table, source='usda_fdc'.
- **Community catalog.** Path B from the original OFF backlog entry — every successful scan writes a row with source='community'. Schema already supports it; needs an Edge Function trigger on `fridge_items` insert.
- **Semantic search (pgvector).** v1.17.
- **LLM query expansion (Claude Haiku).** v1.18.
- **Personal-history layer integration.** Sits in App.js, not in this branch — query existing `fridge_items` filtered to household_id with a fuzzy match. Glues into the layered cascade once the AddModal type-ahead UI is built.

## App.js integration — STAGED 2026-05-02

Type-ahead UI is wired into AddModal. Watches the existing "Item name" field, debounces 300ms, calls `search_products()` for queries ≥ 2 chars, renders a result dropdown directly below the input. Tapping a result populates name + category + emoji + expiry defaults. The `suppressSearch` flag prevents the post-pick `setName()` from immediately re-firing the search.

Result row layout:
- 36×36 product image (or category emoji fallback)
- Product name (bold, single-line)
- Brand · category subtitle (muted)
- Tap target on the whole row, plus a green + icon affordance

Tracking: `addmodal_search_result_picked` event with `source` (openfoodfacts/usda_fdc/community), `has_image`, `has_brand` for analytics.

Code lives in `App.js` inside `AddModal`:
- Added imports: `Image`
- New state: `searchResults`, `searching`, `suppressSearch`
- New `useEffect` debounced search on `[name, visible]`
- New `handlePickResult(result)` populates form
- Result dropdown JSX renders between the name TextInput and the Amount/Unit row

**Not yet bumped to v1.16 in app.json** — the catalog ingest is running but unverified. Once we run a few real searches via the App and confirm hit quality, we bump `app.json` to `1.16/18` and ship.

## Open questions / known issues

- **OFF data quality.** Some barcodes in OFF map to wrong products (Coca-Cola UPC → Sprite, Evian UPC → Cristaline). Community contributions are inconsistent. The ranking + USDA-prefer-when-conflict logic mitigates but doesn't eliminate. Long-term solution is the community catalog (source='community') accumulating ground-truth data from real ok2eat user receipts.
- **Search 'simple' vs 'english' tsvector config.** Using 'simple' to avoid stemming short tokens. Tradeoff: lose plural-handling. Revisit during real-user testing — if "milks" doesn't match "milk," switch to 'english'.
- **Embeddings cost (v1.17).** OpenAI's `text-embedding-3-small` is ~$60 one-time for 1M products. Self-hosted MiniLM via a Supabase Edge Function is free but adds ops complexity. Decide when v1.17 starts.
