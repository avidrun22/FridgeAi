#!/usr/bin/env python3
"""
ingest_off_dump.py — v1.16 Phase 1 ingest pipeline.

Downloads the Open Food Facts daily JSONL dump, filters to US-relevant
products, normalizes to ok2eat's `searchable_products` schema, and bulk-
upserts into Supabase.

Designed to run on a weekly cron (Sunday night) or manually. Streams the
dump rather than loading it into memory — the full file is ~30GB raw.

Usage:
    # Dry-run: download and count what would be inserted, no DB writes.
    python3 scripts/ingest_off_dump.py --dry-run

    # Full sync (default behavior).
    python3 scripts/ingest_off_dump.py

    # Limit to first N products (for testing).
    python3 scripts/ingest_off_dump.py --limit 5000

    # Use a local dump file instead of downloading (faster iteration).
    python3 scripts/ingest_off_dump.py --local-file /tmp/off.jsonl.gz

Configuration (read from .appstoreconnect/telegram_config.json — same file
the deploy script uses, since it already lives outside the repo):
    SUPABASE_URL              — your project URL
    SUPABASE_SERVICE_ROLE_KEY — for INSERT/UPDATE permissions on
                                 searchable_products

Or set as env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
"""

import argparse
import gzip
import io
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

# OFF publishes the daily dump here. The .gz file is ~10-15GB; uncompressed
# JSONL is ~30-50GB. We stream-decompress so we don't need that much disk.
OFF_DUMP_URL = "https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz"

# US-relevant filter. We accept any product where countries_tags contains
# either of these tags. OFF uses both 'en:united-states' and 'en:usa' depending
# on submitter; we match either.
US_TAGS = {"en:united-states", "en:usa"}

# Category mapping mirrors lib/openFoodFacts.js. Keep these in sync — if you
# change one, change the other. (Long-term we should generate one from the
# other; for now just keep them aligned.)
CATEGORY_PATTERNS = [
    (re.compile(r":dairie?s|:milks|:yogurts|:cheeses|:butters|:creams\b", re.I), "Dairy"),
    (re.compile(r":meats|:poultry|:fish|:seafoods|:eggs|:tofu|:legumes|:sausages|:hams|:bacons", re.I), "Protein"),
    (re.compile(r":vegetables|:fruits|:fresh|:salads|:produce|:plant-based-foods\b", re.I), "Produce"),
    (re.compile(r":beverages|:waters|:juices|:sodas|:teas|:coffees|:wines|:beers|:smoothies|:plant-based-beverages", re.I), "Beverages"),
    (re.compile(r":cereals|:rices|:pastas|:breads|:bakery|:snacks|:chips|:crackers|:condiments|:spices|:oils|:sugars|:sauces|:spreads|:breakfasts|:chocolates?|:cocoa|:candies|:confectioneries|:desserts|:cookies|:biscuits|:flours|:nuts|:seeds|:dried", re.I), "Dry Goods"),
]

EMOJI_MAP = {
    "Dairy":     "🥛",
    "Protein":   "🍗",
    "Produce":   "🥬",
    "Dry Goods": "🥣",
    "Beverages": "🍶",
    "Other":     "📦",
}

# Supabase has a per-row size limit and JSON-payload upload sweet spot around
# 1000 rows. Tune if you see 413 Payload Too Large errors.
BATCH_SIZE = 500

# How often to print progress.
PROGRESS_EVERY = 10_000


def load_supabase_creds():
    """Read Supabase URL + service-role key from local config or env."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if url and key:
        return url, key

    # Fall back to .appstoreconnect/telegram_config.json
    config_path = Path(__file__).resolve().parent.parent / ".appstoreconnect" / "telegram_config.json"
    if config_path.exists():
        with open(config_path) as f:
            cfg = json.load(f)
        url = url or cfg.get("supabase_url") or cfg.get("SUPABASE_URL")
        key = key or cfg.get("supabase_service_role_key") or cfg.get("SUPABASE_SERVICE_ROLE_KEY")

    if not (url and key):
        sys.exit(
            "Missing Supabase credentials. Set SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY env vars, or add them to "
            ".appstoreconnect/telegram_config.json as supabase_url + "
            "supabase_service_role_key."
        )
    return url, key


def infer_category(categories_tags):
    """Map OFF's categories_tags array to ok2eat's category enum."""
    for tag in categories_tags or []:
        for pattern, category in CATEGORY_PATTERNS:
            if pattern.search(tag):
                return category
    return "Other"


def is_us_relevant(product):
    """Return True if the product is tagged for US distribution."""
    countries = product.get("countries_tags") or []
    return any(c in US_TAGS for c in countries)


def normalize_product(product):
    """Convert an OFF product dict to a searchable_products row.

    v1.16 Phase 1 (lean variant, 2026-05-02 v2): The first attempt's filter
    was too strict (required name AND brand AND categorizable AND image AND
    barcode — dropped 100% of the first 150K rows). This relaxed version
    keeps anything with a usable NAME and BARCODE — which is the minimum
    needed for either search or scan-time lookup. Brand/image/category are
    populated when available, null otherwise.

    Storage approach: skip the bloat columns (ingredients_text, allergens,
    eco_score, generic_name, serving_size, quantity, countries_tags) so each
    row is ~300-500 bytes instead of ~1.5 KB. That's the win — not the
    aggressive row filter.

    Returns None for products with no usable name OR no barcode.
    """
    name = (product.get("product_name") or product.get("generic_name") or "").strip()
    if not name or len(name) < 3:
        return None  # OFF has tons of empty/garbage rows; drop them

    barcode_raw = product.get("code") or ""
    barcode_digits = re.sub(r"[^0-9]", "", barcode_raw)
    if not barcode_digits:
        return None  # barcode is the natural key for scan-time lookup

    # Brand (best-effort): brands field → brand_owner → first capitalized
    # word in the name. Null if none of those produce something.
    brand = (product.get("brands") or "").split(",")[0].strip()
    if not brand:
        brand = (product.get("brand_owner") or "").strip()
    if not brand:
        first_word = name.split()[0] if name else ""
        if len(first_word) > 2 and first_word[0].isupper():
            brand = first_word

    category = infer_category(product.get("categories_tags") or [])

    # 2026-05-02 v3.2 — full nutrient panel restored after Supabase Pro
    # upgrade (8 GB ceiling instead of 500 MB). Pulls a useful subset of the
    # standard nutrition label, per-100g (OFF's normalized form). Each
    # populated field adds ~15-20 bytes to the JSONB; ~50-70% of OFF rows
    # have complete nutriments. Image_url + emoji still dropped per Greg's
    # preference — those weren't useful for ok2eat's UX.
    n = product.get("nutriments") or {}
    nutriments = {}
    for off_key, our_key in [
        ("energy-kcal_100g",   "calories_per_100g"),
        ("fat_100g",           "fat_g"),
        ("saturated-fat_100g", "saturated_fat_g"),
        ("carbohydrates_100g", "carbs_g"),
        ("sugars_100g",        "sugar_g"),
        ("fiber_100g",         "fiber_g"),
        ("proteins_100g",      "protein_g"),
        ("salt_100g",          "salt_g"),
        ("sodium_100g",        "sodium_g"),
    ]:
        val = n.get(off_key)
        if val is not None:
            nutriments[our_key] = val
    if not nutriments:
        nutriments = None  # avoid storing empty {} → null saves a few bytes

    return {
        "source":     "openfoodfacts",
        "source_id":  barcode_raw,
        "barcode":    barcode_digits,
        "name":       name,
        "brand":      brand or None,
        "category":   category,
        # emoji + image_url: explicitly dropped 2026-05-02 v3 per Greg.
        # Storage savings: ~120 bytes/row from image URLs; emoji is computed
        # client-side from category in the search-result UI.
        "nutriments": nutriments,
        # Other columns (generic_name, quantity, serving_size, countries_tags,
        # nutri_score, eco_score, allergens, ingredients_text, is_organic)
        # left unset → null in DB → ~0 bytes overhead per row.
    }


def open_jsonl_stream(local_file=None):
    """Yield JSONL lines, decoded from utf-8, from either a local file or
    a streamed download. Decompresses gzip on the fly."""
    if local_file:
        opener = gzip.open if local_file.endswith(".gz") else open
        with opener(local_file, "rt", encoding="utf-8", errors="replace") as f:
            for line in f:
                yield line
        return

    print(f"Downloading + streaming {OFF_DUMP_URL} (this is large; expect 5-15 min)…", flush=True)
    req = urllib.request.Request(
        OFF_DUMP_URL,
        headers={"User-Agent": "ok2eat-ingest/1.0 (greg@ok2eat.com)"},
    )
    with urllib.request.urlopen(req) as resp:
        # Stream-decompress without buffering the whole file in memory.
        with gzip.GzipFile(fileobj=resp) as gz:
            text = io.TextIOWrapper(gz, encoding="utf-8", errors="replace")
            for line in text:
                yield line


def upsert_batch(batch, supabase_url, service_key, dry_run=False):
    """Upsert a batch of rows via Supabase REST. Idempotent on
    (source, source_id) thanks to the UNIQUE constraint."""
    if dry_run or not batch:
        return
    url = f"{supabase_url}/rest/v1/searchable_products?on_conflict=source,source_id"
    body = json.dumps(batch).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status not in (200, 201, 204):
                print(f"  warn: upsert returned status {resp.status}", flush=True)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  ERROR upserting batch: HTTP {e.code} — {body[:200]}", flush=True)
        # Don't bail the whole run — log and continue. Next sync will retry.
    except Exception as e:
        print(f"  ERROR upserting batch: {e}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="Don't write to Supabase; just count.")
    parser.add_argument("--limit", type=int, default=None, help="Stop after N normalized rows.")
    parser.add_argument("--local-file", type=str, default=None, help="Path to a local .jsonl(.gz) dump.")
    args = parser.parse_args()

    if args.dry_run:
        supabase_url, service_key = "(dry-run)", "(dry-run)"
    else:
        supabase_url, service_key = load_supabase_creds()

    started_at = time.time()
    seen = 0
    us_kept = 0
    written = 0
    batch = []

    for line in open_jsonl_stream(args.local_file):
        seen += 1
        if seen % PROGRESS_EVERY == 0:
            elapsed = time.time() - started_at
            rate = int(seen / elapsed) if elapsed > 0 else 0
            print(f"  scanned {seen:>10,}  US-kept {us_kept:>7,}  written {written:>7,}  ({rate:,}/s)", flush=True)

        try:
            product = json.loads(line)
        except json.JSONDecodeError:
            continue

        if not is_us_relevant(product):
            continue

        normalized = normalize_product(product)
        if not normalized:
            continue
        us_kept += 1

        batch.append(normalized)
        if len(batch) >= BATCH_SIZE:
            upsert_batch(batch, supabase_url, service_key, dry_run=args.dry_run)
            written += len(batch)
            batch = []

        if args.limit and us_kept >= args.limit:
            break

    if batch:
        upsert_batch(batch, supabase_url, service_key, dry_run=args.dry_run)
        written += len(batch)

    elapsed = time.time() - started_at
    print(
        f"\nDone in {elapsed:.0f}s. "
        f"Scanned {seen:,} OFF products → kept {us_kept:,} US-relevant → "
        f"{'would have written' if args.dry_run else 'wrote'} {written:,} rows.",
        flush=True,
    )


if __name__ == "__main__":
    main()
