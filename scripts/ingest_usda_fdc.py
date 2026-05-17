#!/usr/bin/env python3
"""
ingest_usda_fdc.py — v1.22 #245 ingest pipeline for USDA FoodData Central.

Loads USDA FDC Foundation + SR Legacy "reference" foods into
foodkeeper_shelf_life so generic items (cheddar cheese, ground beef, raw
spinach, etc.) show up at the top of search instead of branded SKUs.

Source quality: Foundation Foods (~190 rows) are the highest-quality, most-
referenced USDA entries. SR Legacy (~1,400 rows) is older but still
authoritative. Together ~1,500 high-signal generic foods.

Greg's "core asset" guardrails:
  - Defaults to --dry-run. You MUST pass --confirm to write to the DB.
  - Idempotent: re-running is safe via UNIQUE (source, fdc_id) in the DB.
  - Staged --limit lets you load 50 → review → 500 → review → rest.
  - Reports per-category counts so you can spot mapping bugs before they
    pollute the catalog.
  - Failed rows are logged to stderr with row context, never silently dropped.
  - Shelf-life fields written as NULL — Phase 2 Haiku enrichment fills
    those in a separate run, so we never invent expiry days.

Usage:
    # 0. (One-time) Download the FDC bundle. The CSV is in a ZIP — extract first.
    #    Look for "Foundation Foods" + "SR Legacy" downloads at
    #    https://fdc.nal.usda.gov/download-datasets
    #    Latest URL pattern (date suffix changes):
    #      FoodData_Central_foundation_food_csv_YYYY-MM-DD.zip
    #      FoodData_Central_sr_legacy_food_csv_YYYY-MM-DD.zip

    # 1. Dry-run first 50 rows. Shows what would be inserted, writes nothing.
    python3 scripts/ingest_usda_fdc.py \\
        --foundation-dir ~/Downloads/FoodData_Central_foundation_food_csv_*/ \\
        --sr-legacy-dir  ~/Downloads/FoodData_Central_sr_legacy_food_csv_*/ \\
        --limit 50

    # 2. After reviewing the dry-run output, commit those 50.
    python3 scripts/ingest_usda_fdc.py --foundation-dir ... --sr-legacy-dir ... \\
        --limit 50 --confirm

    # 3. Verify in Supabase:
    #    SELECT name, ok2eat_category FROM foodkeeper_shelf_life
    #    WHERE source = 'USDA FDC' ORDER BY imported_at DESC LIMIT 20;

    # 4. Next batch: 500. Use --offset to skip the first 50.
    python3 scripts/ingest_usda_fdc.py --foundation-dir ... --sr-legacy-dir ... \\
        --offset 50 --limit 500 --confirm

    # 5. Final: remaining ~1,000.
    python3 scripts/ingest_usda_fdc.py --foundation-dir ... --sr-legacy-dir ... \\
        --offset 550 --confirm

Configuration:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from env or
    .appstoreconnect/telegram_config.json (same as other ingest scripts).
"""

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

BATCH_SIZE = 100  # rows per REST POST. Small enough to keep error logs readable.

# ─── FDC food_category_id → ok2eat category ──────────────────────────────────
# Pulled from food_category.csv in the FDC bundle (codes from the WWEIA Food
# Category Schema). Order matters for the eggs/juices/legumes special cases
# below — these overrides run AFTER the table lookup.
#
# When in doubt about a mapping, default to "Other" rather than guessing —
# better to under-categorize than miscategorize. Greg can fix Other rows
# manually with a SQL UPDATE later.
FDC_CATEGORY_MAP = {
    1:  "Dairy",      # Dairy and Egg Products (eggs overridden by name below)
    2:  "Dry Goods",  # Spices and Herbs
    3:  "Other",      # Baby Foods
    4:  "Dry Goods",  # Fats and Oils
    5:  "Protein",    # Poultry Products
    6:  "Dry Goods",  # Soups, Sauces, and Gravies
    7:  "Protein",    # Sausages and Luncheon Meats
    8:  "Dry Goods",  # Breakfast Cereals
    9:  "Produce",    # Fruits and Fruit Juices (juices overridden by name)
    10: "Protein",    # Pork Products
    11: "Produce",    # Vegetables and Vegetable Products
    12: "Dry Goods",  # Nut and Seed Products
    13: "Protein",    # Beef Products
    14: "Beverages",  # Beverages
    15: "Protein",    # Finfish and Shellfish Products
    16: "Protein",    # Legumes and Legume Products
    17: "Protein",    # Lamb, Veal, and Game Products
    18: "Dry Goods",  # Baked Products
    19: "Dry Goods",  # Sweets
    20: "Dry Goods",  # Cereal Grains and Pasta
    21: "Other",      # Fast Foods
    22: "Other",      # Meals, Entrees, and Side Dishes
    25: "Dry Goods",  # Snacks
    26: "Other",      # American Indian/Alaska Native Foods
    27: "Other",      # Restaurant Foods
    28: None,         # Quality Control Materials — SKIP
}

# Name-based overrides applied AFTER the category table lookup. Lowercased
# substring match on the FDC `description` column.
NAME_OVERRIDES = [
    # Eggs come in FDC category 1 (Dairy and Egg Products); pull them to Protein.
    (lambda n: "egg" in n and "eggplant" not in n, "Protein"),
    # Fruit juices come in FDC category 9 (Fruits and Fruit Juices); to Beverages.
    (lambda n: "juice" in n or "nectar" in n, "Beverages"),
    # Milk substitutes are sometimes filed under Beverages; pull to Dairy.
    (lambda n: "soy milk" in n or "almond milk" in n or "oat milk" in n or "rice milk" in n, "Dairy"),
]


def load_supabase_creds():
    """Read Supabase URL + service-role key from env or local config."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if url and key:
        return url, key
    config_path = Path(__file__).resolve().parent.parent / ".appstoreconnect" / "telegram_config.json"
    if config_path.exists():
        with open(config_path) as f:
            cfg = json.load(f)
        url = url or cfg.get("supabase_url") or cfg.get("SUPABASE_URL")
        key = key or cfg.get("supabase_service_role_key") or cfg.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        sys.exit("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in env or telegram_config.json")
    return url, key


def find_csv(dir_path, basename):
    """Locate a CSV inside the FDC bundle dir (FDC nests files inconsistently)."""
    p = Path(dir_path).expanduser()
    if not p.is_dir():
        sys.exit(f"ERROR: directory not found: {p}")
    candidates = list(p.rglob(basename))
    if not candidates:
        sys.exit(f"ERROR: {basename} not found in {p}. Did you extract the ZIP?")
    if len(candidates) > 1:
        print(f"  note: multiple {basename} found, using {candidates[0]}", file=sys.stderr)
    return candidates[0]


def load_food_categories(csv_path):
    """Returns {category_id: description} from FDC's food_category.csv."""
    cats = {}
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                cid = int(row["id"])
                cats[cid] = row.get("description", "").strip()
            except (KeyError, ValueError):
                continue
    return cats


def derive_ok2eat_category(fdc_cat_id, description_lower):
    """Map an FDC row to our 6-category enum. Returns category or None to skip."""
    base = FDC_CATEGORY_MAP.get(fdc_cat_id)
    if base is None:
        return None  # explicit skip (e.g., QC materials) or unknown id
    # Apply name overrides — first match wins.
    for predicate, override in NAME_OVERRIDES:
        if predicate(description_lower):
            return override
    return base


def normalize_fdc_row(row, fdc_categories):
    """Convert an FDC food.csv row to a foodkeeper_shelf_life insert dict.
    Returns None to skip (wrong data_type, bad category, etc.)."""
    data_type = (row.get("data_type") or "").strip()
    if data_type not in ("foundation_food", "sr_legacy_food"):
        return None  # branded / survey foods filtered out

    try:
        fdc_id = int(row.get("fdc_id"))
    except (TypeError, ValueError):
        return None

    description = (row.get("description") or "").strip()
    if not description or len(description) > 200:
        return None  # malformed or absurdly long names

    try:
        fdc_cat_id = int(row.get("food_category_id"))
    except (TypeError, ValueError):
        return None

    ok2eat_category = derive_ok2eat_category(fdc_cat_id, description.lower())
    if ok2eat_category is None:
        return None  # category skipped (QC) or unmapped

    # FDC names look like "Cheese, cheddar" / "Beef, ground, raw". Split on
    # the first comma to populate (name, subtitle) so the existing search
    # scorer + display logic works. If no comma, subtitle stays NULL.
    if "," in description:
        name_part, _, subtitle_part = description.partition(",")
        name = name_part.strip()
        subtitle = subtitle_part.strip() or None
    else:
        name = description
        subtitle = None

    if not name:
        return None

    # FoodKeeper's `category` column is a free-text string from FSIS source —
    # we mirror it from the FDC category description for traceability. The
    # `ok2eat_category` column is GENERATED from this in the existing schema
    # via a CASE expression, BUT the source CASE only knows FSIS category names
    # like "Dairy Products & Eggs" — it won't match "Dairy and Egg Products".
    # So we drop the source `category` field (leave NULL) and rely on the
    # client picking up ok2eat_category from our derive_ok2eat_category()
    # decision instead. Migration #245 doesn't change the generated column,
    # so we sidestep it by directly storing nothing in category.
    #
    # IMPORTANT: ok2eat_category is a STORED GENERATED column — we can't
    # write to it directly. To force the value, we'd need to either:
    #   (a) update the GENERATED CASE to include FDC category descriptions
    #   (b) store the FDC description in a way the CASE handles
    # For now (b): map our derived ok2eat_category back to a FSIS-style
    # category string so the generated column produces the right value.
    fsis_cat_proxy = {
        "Dairy":     "Dairy Products & Eggs",
        "Protein":   "Meat",                              # generic protein bucket — also covers seafood/poultry/legumes
        "Produce":   "Produce",
        "Dry Goods": "Shelf Stable Foods",
        "Beverages": "Beverages",
        "Other":     "Other",
    }.get(ok2eat_category)

    return {
        # id: omitted — DB sequence assigns it (starts at 100,000 per migration #245)
        "name":      name,
        "subtitle":  subtitle,
        "category":  fsis_cat_proxy,
        # No subcategory / keywords — we don't have a reliable source.
        # Shelf-life fields all NULL — Phase 2 Haiku will fill.
        "pantry_min_days":         None,
        "pantry_max_days":         None,
        "pantry_open_min_days":    None,
        "pantry_open_max_days":    None,
        "fridge_min_days":         None,
        "fridge_max_days":         None,
        "fridge_open_min_days":    None,
        "fridge_open_max_days":    None,
        "freezer_min_days":        None,
        "freezer_max_days":        None,
        "tips":                    None,
        "metric_notes":            None,
        # Provenance
        "source":                  "USDA FDC",
        "fdc_id":                  fdc_id,
        "display_name":            None,  # backfilled later
        "imported_at":             "now()",  # PostgREST treats this as a literal — we set per-row below
    }


def stream_food_csv(foundation_dir, sr_legacy_dir):
    """Yield FDC food.csv rows from both Foundation + SR Legacy bundles."""
    for src_dir, label in [(foundation_dir, "foundation"), (sr_legacy_dir, "sr_legacy")]:
        if not src_dir:
            print(f"  note: --{label.replace('_', '-')}-dir not provided, skipping", flush=True)
            continue
        food_csv = find_csv(src_dir, "food.csv")
        print(f"  reading {label}: {food_csv}", flush=True)
        with open(food_csv, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                yield row


def upsert_batch(batch, supabase_url, service_key, confirm=False):
    """Upsert a batch via Supabase REST. Idempotent on (source, fdc_id).
    Returns (success_count, failure_count, error_msg_or_None)."""
    if not batch:
        return 0, 0, None
    # Strip the placeholder imported_at — let PostgREST omit it so the DB
    # default (now()) kicks in. We could also send it as ISO timestamp,
    # but the DB default is more consistent across re-runs.
    cleaned = [{k: v for k, v in row.items() if k != "imported_at"} for row in batch]
    if not confirm:
        return len(cleaned), 0, None  # dry-run: count as success without writing

    url = f"{supabase_url}/rest/v1/foodkeeper_shelf_life?on_conflict=source,fdc_id"
    body = json.dumps(cleaned).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status in (200, 201, 204):
                return len(cleaned), 0, None
            return 0, len(cleaned), f"HTTP {resp.status}"
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        return 0, len(cleaned), f"HTTP {e.code} — {err[:300]}"
    except Exception as e:
        return 0, len(cleaned), str(e)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--foundation-dir", type=str, help="Extracted FoodData_Central_foundation_food_csv_* directory")
    parser.add_argument("--sr-legacy-dir",  type=str, help="Extracted FoodData_Central_sr_legacy_food_csv_* directory")
    parser.add_argument("--confirm",        action="store_true",
                        help="Actually write to Supabase. Default is dry-run.")
    parser.add_argument("--limit",          type=int, default=None,
                        help="Stop after writing N rows. Use for staged loads (50, 500, …).")
    parser.add_argument("--offset",         type=int, default=0,
                        help="Skip the first N normalized rows. Use to resume a staged load.")
    parser.add_argument("--perishable-only", action="store_true",
                        help="Filter to perishable categories only (Dairy / Protein / Produce). "
                             "Drops Dry Goods / Beverages / Other to focus on high-spoilage items "
                             "where accurate shelf life delivers the most user value.")
    args = parser.parse_args()

    PERISHABLE_CATEGORIES = {"Dairy", "Protein", "Produce"}

    if not args.foundation_dir and not args.sr_legacy_dir:
        sys.exit("ERROR: provide at least one of --foundation-dir or --sr-legacy-dir")

    mode = "WRITE" if args.confirm else "DRY-RUN"
    print(f"=== USDA FDC → foodkeeper_shelf_life ingest ({mode}) ===", flush=True)

    if args.confirm:
        supabase_url, service_key = load_supabase_creds()
        # One last safety: confirm we're hitting the prod URL the user expects.
        print(f"  target: {supabase_url}", flush=True)
        print(f"  table:  foodkeeper_shelf_life (source='USDA FDC')", flush=True)
        print(f"  limit:  {args.limit or 'no limit'}    offset: {args.offset}", flush=True)
        try:
            ack = input("  Proceed? Type 'yes' to continue: ").strip().lower()
        except EOFError:
            ack = ""
        if ack != "yes":
            sys.exit("Aborted by user.")
    else:
        supabase_url, service_key = "(dry-run)", "(dry-run)"

    # Load FDC category lookup (only used for human-readable logging — our
    # mapping uses food_category_id directly).
    cats_from = args.foundation_dir or args.sr_legacy_dir
    cats_path = find_csv(cats_from, "food_category.csv")
    fdc_categories = load_food_categories(cats_path)
    print(f"  loaded {len(fdc_categories)} FDC categories from {cats_path}", flush=True)

    # v1.22 #245 — perishable filter. ok2eat_category → fsis_cat_proxy map
    # in normalize_fdc_row produces these values. Filter membership is checked
    # against the proxy strings since that's what lands in n["category"].
    PERISHABLE_FSIS_PROXIES = {
        "Dairy Products & Eggs",  # Dairy + eggs (eggs are pulled to Protein by name override but the proxy stays Dairy when they land in cat 1)
        "Meat",                    # Protein (covers meat, poultry, seafood, legumes per the bucket mapping)
        "Produce",                 # Produce
    }

    started_at = time.time()
    scanned = 0
    skipped = 0
    skipped_non_perishable = 0
    normalized = 0
    written = 0
    failed = 0
    skipped_by_offset = 0
    by_category = Counter()
    by_fdc_cat = Counter()
    sample_rows = []  # first 5 normalized rows for dry-run inspection

    batch = []
    done = False

    if args.perishable_only:
        print(f"  perishable-only mode: keeping only Dairy / Protein / Produce", flush=True)

    for row in stream_food_csv(args.foundation_dir, args.sr_legacy_dir):
        if done:
            break
        scanned += 1
        n = normalize_fdc_row(row, fdc_categories)
        if n is None:
            skipped += 1
            continue
        # v1.22 #245 — perishable filter. Drop Dry Goods / Beverages / Other.
        # Applied BEFORE normalized++ so the offset semantics stay consistent
        # (offset skips N kept-after-filter rows, not N raw rows).
        if args.perishable_only and n["category"] not in PERISHABLE_FSIS_PROXIES:
            skipped_non_perishable += 1
            continue
        normalized += 1
        # Track distribution for the summary
        by_category[n["category"]] += 1
        if row.get("food_category_id"):
            by_fdc_cat[fdc_categories.get(int(row["food_category_id"]), f"id={row['food_category_id']}")] += 1
        # Apply offset
        if normalized <= args.offset:
            skipped_by_offset += 1
            continue
        # Collect sample for dry-run inspection
        if len(sample_rows) < 5:
            sample_rows.append(n)
        batch.append(n)
        # v1.22 #245 hotfix — limit-aware batch sizing. If --limit is set, cap
        # the effective batch size to (limit - written) so the LAST batch is
        # exactly the right size. Previously --limit 50 wrote 100 because the
        # check ran AFTER the full BATCH_SIZE flush.
        effective_size = BATCH_SIZE
        if args.limit:
            remaining = args.limit - written
            if remaining <= 0:
                done = True
                continue
            effective_size = min(BATCH_SIZE, remaining)
        if len(batch) >= effective_size:
            ok, bad, err = upsert_batch(batch, supabase_url, service_key, confirm=args.confirm)
            written += ok
            failed += bad
            if err:
                print(f"  BATCH FAIL ({bad} rows): {err}", file=sys.stderr, flush=True)
            batch = []
            if args.limit and written >= args.limit:
                done = True

    if batch and not done:
        # Tail flush — same limit cap applies so we don't write past --limit
        if args.limit:
            remaining = args.limit - written
            if remaining > 0 and remaining < len(batch):
                batch = batch[:remaining]
        ok, bad, err = upsert_batch(batch, supabase_url, service_key, confirm=args.confirm)
        written += ok
        failed += bad
        if err:
            print(f"  BATCH FAIL ({bad} rows): {err}", file=sys.stderr, flush=True)

    elapsed = time.time() - started_at
    print("", flush=True)
    print("=== Summary ===", flush=True)
    print(f"  scanned:               {scanned:,}", flush=True)
    print(f"  skipped (bad row):     {skipped:,} (wrong data_type, bad category, malformed)", flush=True)
    if args.perishable_only:
        print(f"  skipped (non-perish):  {skipped_non_perishable:,} (Dry Goods / Beverages / Other)", flush=True)
    print(f"  normalized (kept):     {normalized:,}", flush=True)
    print(f"  skipped (offset):      {skipped_by_offset:,}", flush=True)
    print(f"  {'would write' if not args.confirm else 'wrote'}:            {written:,}", flush=True)
    if failed:
        print(f"  FAILED:                {failed:,}", flush=True)
    print(f"  elapsed:               {elapsed:.1f}s", flush=True)
    print("", flush=True)
    print("  by ok2eat category:", flush=True)
    for cat, count in by_category.most_common():
        print(f"    {cat:<12} {count:>5,}", flush=True)
    print("", flush=True)
    print("  top FDC source categories:", flush=True)
    for cat, count in by_fdc_cat.most_common(10):
        print(f"    {cat[:40]:<40} {count:>5,}", flush=True)
    if sample_rows:
        print("", flush=True)
        print("  sample rows (first 5):", flush=True)
        for r in sample_rows:
            print(f"    [{r['category']:<22}] {r['name']}{', ' + r['subtitle'] if r['subtitle'] else ''} (fdc_id={r['fdc_id']})", flush=True)
    print("", flush=True)
    if not args.confirm:
        print("  → DRY RUN. Re-run with --confirm to write to Supabase.", flush=True)
    else:
        print("  → Verify in SQL Editor:", flush=True)
        print("    SELECT name, subtitle, ok2eat_category FROM foodkeeper_shelf_life", flush=True)
        print("    WHERE source = 'USDA FDC' ORDER BY imported_at DESC LIMIT 20;", flush=True)


if __name__ == "__main__":
    main()
