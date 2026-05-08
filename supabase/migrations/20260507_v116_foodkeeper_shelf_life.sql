-- v1.16 — FoodKeeper shelf-life reference table
-- Source: USDA FSIS FoodKeeper Data v128, pulled 2026-05-07
-- https://catalog.data.gov/dataset/fsis-foodkeeper-data
--
-- Per-item shelf life replaces the flat EXPIRY_MAP[category] default in
-- App.js (5 days for everything in Produce, 14 for everything in Dairy).
-- 660 items with min/max ranges for pantry, fridge, freezer, and after
-- opening for each. All time fields are normalized to days; NULL means
-- the source had no numeric value (use category default fallback).
--
-- Apply order:
--   1. Run this migration to create the table + indexes + RLS.
--   2. Bulk-load `data/foodkeeper.csv` via the Supabase Table Editor
--      (or `\copy` if running psql directly).
--   3. Verify with: SELECT count(*) FROM foodkeeper_shelf_life; (expect 660)
--   4. Confirm the lookup RPC works: SELECT * FROM lookup_shelf_life('whole milk');

create table if not exists public.foodkeeper_shelf_life (
    id                       integer primary key,
    name                     text    not null,
    subtitle                 text,
    category                 text,
    subcategory              text,
    keywords                 text,                                   -- comma-separated, source as-is
    pantry_min_days          numeric,
    pantry_max_days          numeric,
    pantry_open_min_days     numeric,
    pantry_open_max_days     numeric,
    fridge_min_days          numeric,
    fridge_max_days          numeric,
    fridge_open_min_days     numeric,
    fridge_open_max_days     numeric,
    freezer_min_days         numeric,
    freezer_max_days         numeric,
    tips                     text,
    metric_notes             text,
    -- ok2eat-side category mapping. Computed once at import time so the
    -- runtime lookup doesn't have to translate FoodKeeper categories to
    -- ok2eat's 6-category enum on every query.
    ok2eat_category          text generated always as (
        case
          when category = 'Dairy Products & Eggs'                                    then 'Dairy'
          when category in ('Meat', 'Poultry', 'Seafood', 'Vegetarian Proteins')     then 'Protein'
          when category = 'Produce'                                                  then 'Produce'
          when category in ('Baked Goods', 'Grains, Beans & Pasta',
                            'Shelf Stable Foods')                                    then 'Dry Goods'
          when category = 'Beverages'                                                then 'Beverages'
          else 'Other'
        end
    ) stored
);

create extension if not exists pg_trgm;

-- Lookup-path indexes:
-- 1. lower(name) for exact-ish match.
create index if not exists foodkeeper_name_lower_idx
    on public.foodkeeper_shelf_life (lower(name));

-- 2. trigram for fuzzy matching ("whole milkk" -> "Milk, Whole").
create index if not exists foodkeeper_name_trgm_idx
    on public.foodkeeper_shelf_life
    using gin (lower(name) gin_trgm_ops);

-- 3. ok2eat_category for category-default fallback.
create index if not exists foodkeeper_ok2eat_category_idx
    on public.foodkeeper_shelf_life (ok2eat_category);

-- 4. full-text on name + subtitle + keywords. Used by the website
--    /shelf-life/?q=... search.
create index if not exists foodkeeper_search_idx
    on public.foodkeeper_shelf_life
    using gin (to_tsvector('english',
        coalesce(name, '') || ' ' ||
        coalesce(subtitle, '') || ' ' ||
        coalesce(keywords, '')));

-- Read-only RLS. Reference data — no user mutations.
alter table public.foodkeeper_shelf_life enable row level security;

create policy "foodkeeper read"
    on public.foodkeeper_shelf_life
    for select
    using (true);

comment on table public.foodkeeper_shelf_life is
    'USDA FSIS FoodKeeper v128 shelf-life reference. Static lookup; '
    'no user-state. All time fields are in days; NULL means source had '
    'no numeric value (see metric_notes for categorical fallback).';

-- ─── Lookup RPC ──────────────────────────────────────────────────────────
-- Single function the iOS + web clients call. Three-tier match:
--   1. Exact name (case-insensitive) → score 100
--   2. Substring match in name OR keywords → score 50–80 by length
--   3. pg_trgm similarity (handles typos / variants) → score = similarity * 40
-- Returns the top 3 candidates by score; client picks #1 unless score < 30,
-- in which case it falls back to the category default.

create or replace function public.lookup_shelf_life(query text)
returns table (
    id              integer,
    name            text,
    subtitle        text,
    ok2eat_category text,
    keywords        text,
    pantry_min_days numeric, pantry_max_days numeric,
    pantry_open_min_days numeric, pantry_open_max_days numeric,
    fridge_min_days numeric, fridge_max_days numeric,
    fridge_open_min_days numeric, fridge_open_max_days numeric,
    freezer_min_days numeric, freezer_max_days numeric,
    tips            text,
    score           integer
)
language sql
stable
parallel safe
as $$
    with q as (
        select trim(lower(query)) as q
    ),
    scored as (
        select
            f.id, f.name, f.subtitle, f.ok2eat_category, f.keywords,
            f.pantry_min_days, f.pantry_max_days,
            f.pantry_open_min_days, f.pantry_open_max_days,
            f.fridge_min_days, f.fridge_max_days,
            f.fridge_open_min_days, f.fridge_open_max_days,
            f.freezer_min_days, f.freezer_max_days,
            f.tips,
            case
                when lower(f.name) = q.q then 100
                when position(q.q in lower(f.name)) > 0 then
                    50 + greatest(0, 30 - abs(length(f.name) - length(q.q)))
                when position(q.q in lower(coalesce(f.keywords, ''))) > 0 then 60
                else (similarity(lower(f.name), q.q) * 40)::int
            end as score
        from public.foodkeeper_shelf_life f, q
        where lower(f.name) % q.q
           or lower(f.name) like '%' || q.q || '%'
           or lower(coalesce(f.keywords, '')) like '%' || q.q || '%'
    )
    select * from scored
    where score >= 20
    order by score desc, length(name) asc
    limit 3;
$$;

comment on function public.lookup_shelf_life is
    'Look up shelf-life data for a free-text item name. Returns top 3 '
    'candidates by relevance score. Caller should accept score >= 30 as '
    'a confident match and fall back to category default below that.';
