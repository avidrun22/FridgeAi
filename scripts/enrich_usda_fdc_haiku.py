#!/usr/bin/env python3
"""
enrich_usda_fdc_haiku.py — v1.22 #245 Phase 3 shelf-life enrichment.

Reads NULL-shelf-life rows from foodkeeper_shelf_life where source='USDA FDC',
asks Claude Haiku to fill in per-item shelf life days (fridge/pantry/freezer
× opened/unopened) + a short tip, validates against the schema, then UPDATEs
the row in Supabase.

Why this matters: USDA Foundation + SR Legacy give us 1,250 great generic
names (Cheese cheddar, Beef ground raw, Broccoli raw, etc.) but ZERO shelf-
life data. Without enrichment, every USDA FDC row falls back to category
defaults (Dairy=14d, Protein=3d, Produce=5d). That's wrong for hard cheeses
(actual 180d), cured meats (30-60d), dried/canned/frozen items, etc.

Same pattern as scripts/expand_shelf_life.py but operates on EXISTING DB rows
instead of generating new ones from a candidate list.

Must run from Greg's terminal — the Claude sandbox proxy rejects user-owned
Anthropic API keys with 401.

Usage:

    # Dry-run first 20 rows. Prints Haiku output, no DB writes.
    python3 scripts/enrich_usda_fdc_haiku.py --limit 20

    # If dry-run looks good, write those 20.
    python3 scripts/enrich_usda_fdc_haiku.py --limit 20 --confirm

    # Spot-check via SQL:
    #   SELECT name, subtitle, fridge_max_days, freezer_max_days, tips
    #   FROM foodkeeper_shelf_life
    #   WHERE source = 'USDA FDC' AND fridge_max_days IS NOT NULL
    #   ORDER BY imported_at DESC LIMIT 20;

    # Scale to remaining ~1,230 rows
    python3 scripts/enrich_usda_fdc_haiku.py --confirm

Configuration:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, anthropic_api_key from
    .appstoreconnect/telegram_config.json (same file as other scripts).

Safety:
    - Defaults to dry-run; --confirm required for writes.
    - Idempotent: only enriches rows where shelf_life is still NULL. Re-runs
      skip already-enriched rows automatically.
    - Validates Haiku output before writing (bad rows stay NULL — safer than
      polluting the catalog with hallucinated days).
    - Per-row UPDATEs (not bulk) so a single bad row doesn't fail the batch.
    - Conservative day cap: 3650 (10 years). Anything higher is rejected.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# ─── Paths + config ──────────────────────────────────────────────────────────
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CONFIG_PATH = ROOT / ".appstoreconnect" / "telegram_config.json"

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"
ANTHROPIC_VERSION = "2023-06-01"
BATCH_SIZE = 10        # candidates per Haiku call — same as expand_shelf_life.py
MAX_RETRIES = 3
RETRY_BACKOFF_S = 5

# Day-range sanity caps. Matches expand_shelf_life.py.
MAX_DAYS = 3650
MIN_DAYS = 0

DAY_FIELDS = [
    "pantry_min_days", "pantry_max_days",
    "pantry_open_min_days", "pantry_open_max_days",
    "fridge_min_days", "fridge_max_days",
    "fridge_open_min_days", "fridge_open_max_days",
    "freezer_min_days", "freezer_max_days",
]

# Fields we expect Haiku to return per item. Subset of the full schema —
# we don't ask for name/subtitle/category (already in DB) or source (always
# USDA FDC for our purposes).
REQUIRED_KEYS = set(DAY_FIELDS) | {"tips"}


# ─── Credentials ─────────────────────────────────────────────────────────────
def load_creds():
    """Read Supabase + Anthropic credentials from env or telegram_config.json."""
    supa_url = os.environ.get("SUPABASE_URL")
    supa_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    anth_key = os.environ.get("ANTHROPIC_API_KEY")
    if not (supa_url and supa_key and anth_key) and CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
        supa_url = supa_url or cfg.get("supabase_url") or cfg.get("SUPABASE_URL")
        supa_key = supa_key or cfg.get("supabase_service_role_key") or cfg.get("SUPABASE_SERVICE_ROLE_KEY")
        anth_key = anth_key or cfg.get("anthropic_api_key") or cfg.get("ANTHROPIC_API_KEY")
    if not supa_url:
        sys.exit("ERROR: SUPABASE_URL missing (env or telegram_config.json)")
    if not supa_key:
        sys.exit("ERROR: SUPABASE_SERVICE_ROLE_KEY missing")
    if not anth_key:
        sys.exit("ERROR: ANTHROPIC_API_KEY missing")
    return supa_url, supa_key, anth_key


# ─── Supabase: fetch + update ────────────────────────────────────────────────
def fetch_null_rows(supa_url: str, supa_key: str, limit: int | None) -> list[dict]:
    """Pull USDA FDC rows that still have NULL shelf-life across ALL three
    container types. These are the candidates for Haiku enrichment."""
    # PostgREST filter syntax: source=eq.X & fridge_max_days=is.null & ...
    # Using and= to combine the IS NULL checks across all three containers,
    # so we only enrich rows that are 100% empty (not partially populated).
    qs = (
        "source=eq.USDA%20FDC"
        "&and=(fridge_max_days.is.null,pantry_max_days.is.null,freezer_max_days.is.null)"
        "&select=id,name,subtitle,ok2eat_category"
        "&order=id"
    )
    if limit:
        qs += f"&limit={limit}"
    url = f"{supa_url}/rest/v1/foodkeeper_shelf_life?{qs}"
    req = urllib.request.Request(
        url,
        headers={
            "apikey": supa_key,
            "Authorization": f"Bearer {supa_key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def update_row(supa_url: str, supa_key: str, row_id: int, fields: dict) -> tuple[bool, str | None]:
    """PATCH a single row's shelf-life fields. Returns (ok, err_msg)."""
    url = f"{supa_url}/rest/v1/foodkeeper_shelf_life?id=eq.{row_id}"
    body = json.dumps(fields).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="PATCH",
        headers={
            "apikey": supa_key,
            "Authorization": f"Bearer {supa_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return (resp.status in (200, 201, 204), None)
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")[:300]
        return (False, f"HTTP {e.code} — {err}")
    except Exception as e:
        return (False, str(e))


# ─── Haiku prompt + call ─────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are a food-safety data curator. Your knowledge sources, in order of authority, are:
1. US FDA Refrigerator & Freezer Storage Chart
2. USDA FSIS food-safety bulletins
3. National Center for Home Food Preservation (University of Georgia)
4. Cooperative Extension Service publications (Penn State, Clemson, UMaine, NC State, Cornell, UMass, Nebraska-Lincoln)
5. Standard manufacturer best-before guidance for packaged categories

You are given a batch of foods (with USDA-style "name, subtitle" descriptors) and must return shelf-life days for each. Use the CONSERVATIVE (shorter) end of any published range. If you're not confident about a value, return null — never invent.

Schema per item (all keys required, exact names):
{
  "pantry_min_days":      int | null,
  "pantry_max_days":      int | null,
  "pantry_open_min_days": int | null,
  "pantry_open_max_days": int | null,
  "fridge_min_days":      int | null,
  "fridge_max_days":      int | null,
  "fridge_open_min_days": int | null,
  "fridge_open_max_days": int | null,
  "freezer_min_days":     int | null,
  "freezer_max_days":     int | null,
  "tips":                 string | null     // 1-2 sentences; direct, practical; no marketing fluff
}

Rules:
- Day fields are integers 0–3650. min_days <= max_days within each channel.
- For "Beef, raw" / "Chicken, raw" / "Spinach, raw" — populate fridge_min/max AND freezer_min/max. Skip pantry (raw fresh foods don't belong at room temp).
- For "Cheese, cheddar" / "Cheese, parmesan" — hard cheeses last 6+ months unopened in fridge, 3-4 weeks opened. Populate fridge fields AND fridge_open fields AND freezer fields.
- For "Tuna, canned" / "Beans, snap, canned" — pantry-stable until opened (populate pantry_min/max with 3-5 years), fridge_open after opening (3-4 days).
- For "Milk, fluid, 2% milkfat" — fridge fields only (7-14 days), brief freezer (90 days), skip pantry.
- For frozen-only items (e.g., "Fish, frozen") — freezer fields only, others null.
- For items USDA's metadata is unclear about (e.g., a vague "Soup, beef and vegetable"), return what you can confidently support and null the rest. Better to leave a field null than to guess wrong.
- At least one storage channel (fridge/pantry/freezer) MUST have data — if you cannot confidently fill ANY channel, return all-null fields and a tip explaining why ("Spoilage timing varies widely by preparation; check product label.").
- Brand voice for tips: direct, useful, no fluff. Examples: "Refrigerate after opening. Color may darken without indicating spoilage." NOT: "This versatile product is a kitchen essential!"

Return ONLY a JSON array of objects, same order as the input list, no prose, no markdown fences. Array length must equal input length."""


def call_haiku(api_key: str, rows: list[dict]) -> list[dict]:
    """One round-trip to Haiku for a batch of rows. Returns parsed list."""
    # Compose human-readable descriptors so Haiku sees both name AND subtitle.
    def descriptor(r):
        if r.get("subtitle"):
            return f"{r['name']}, {r['subtitle']}"
        return r["name"]

    user_msg = "Generate shelf-life data for these USDA foods, in order:\n" + \
               "\n".join(f"{i+1}. {descriptor(r)}  (category: {r['ok2eat_category']})"
                         for i, r in enumerate(rows))
    body = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 4096,
        "temperature": 0.0,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_msg}],
    }
    req = urllib.request.Request(
        ANTHROPIC_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read())
    text = "".join(
        b.get("text", "") for b in payload.get("content", []) if b.get("type") == "text"
    ).strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    arr = json.loads(text)
    if not isinstance(arr, list):
        raise ValueError(f"Haiku returned non-list: {type(arr).__name__}")
    if len(arr) != len(rows):
        raise ValueError(f"length mismatch: expected {len(rows)}, got {len(arr)}")
    return arr


def call_haiku_with_retry(api_key: str, rows: list[dict]) -> list[dict]:
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return call_haiku(api_key, rows)
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8", errors="replace")[:200]
            print(f"  [haiku http {e.code}] attempt {attempt}: {err}", file=sys.stderr)
            if e.code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF_S * attempt)
                continue
            raise
        except (json.JSONDecodeError, ValueError) as e:
            print(f"  [haiku parse error] attempt {attempt}: {e}", file=sys.stderr)
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF_S)
                continue
            raise


# ─── Validation ──────────────────────────────────────────────────────────────
def validate_haiku_row(row: dict) -> tuple[bool, str | None]:
    """Returns (valid, reason_if_invalid). Invalid rows are skipped (left NULL)."""
    missing = REQUIRED_KEYS - set(row.keys())
    if missing:
        return (False, f"missing keys: {sorted(missing)}")
    # Day fields: int|null, in [0, 3650], min<=max per channel
    for f in DAY_FIELDS:
        v = row[f]
        if v is None:
            continue
        if not isinstance(v, int) or v < MIN_DAYS or v > MAX_DAYS:
            return (False, f"bad day value {f}={v!r}")
    for chan in ("pantry", "pantry_open", "fridge", "fridge_open", "freezer"):
        mn = row.get(f"{chan}_min_days")
        mx = row.get(f"{chan}_max_days")
        if mn is not None and mx is not None and mn > mx:
            return (False, f"{chan} min > max ({mn} > {mx})")
    # At least one channel must have data — otherwise category default is just
    # as useful and we shouldn't pollute the row with all-NULL Haiku output.
    if all(row.get(f) is None for f in DAY_FIELDS):
        return (False, "all day fields null — leave row at category default")
    # tips must be string or null
    if row.get("tips") is not None and not isinstance(row["tips"], str):
        return (False, f"tips not string: {type(row['tips']).__name__}")
    return (True, None)


# ─── Main ────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--confirm",  action="store_true",
                        help="Actually write to Supabase. Default is dry-run.")
    parser.add_argument("--limit",    type=int, default=None,
                        help="Cap at N rows. Use for staging (20 → spot-check → rest).")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE,
                        help=f"Rows per Haiku call (default {BATCH_SIZE}).")
    args = parser.parse_args()

    supa_url, supa_key, anth_key = load_creds()

    mode = "WRITE" if args.confirm else "DRY-RUN"
    print(f"=== USDA FDC shelf-life enrichment ({mode}) ===", flush=True)
    print(f"  target:    {supa_url}", flush=True)
    print(f"  filter:    source='USDA FDC' AND all 3 shelf_life containers IS NULL", flush=True)
    print(f"  limit:     {args.limit or 'no limit'}", flush=True)
    print(f"  batch:     {args.batch_size} rows per Haiku call", flush=True)
    print(f"  model:     {ANTHROPIC_MODEL}", flush=True)
    print("", flush=True)

    print("Fetching NULL-shelf-life rows from Supabase…", flush=True)
    rows = fetch_null_rows(supa_url, supa_key, args.limit)
    print(f"  → {len(rows)} candidates to enrich", flush=True)
    if not rows:
        print("  Nothing to do. Exiting.", flush=True)
        return

    if args.confirm:
        try:
            ack = input("  Proceed with Haiku calls + DB writes? Type 'yes' to continue: ").strip().lower()
        except EOFError:
            ack = ""
        if ack != "yes":
            sys.exit("Aborted by user.")

    started = time.time()
    enriched = 0     # successfully validated + written (or would-write in dry-run)
    rejected = 0     # validation failed → left NULL
    api_failures = 0 # haiku call failed entirely → batch skipped
    db_failures = 0  # haiku returned good data, DB UPDATE failed

    for i in range(0, len(rows), args.batch_size):
        batch = rows[i:i + args.batch_size]
        print(f"  batch {i // args.batch_size + 1}: ids {batch[0]['id']}-{batch[-1]['id']}", flush=True)
        try:
            haiku_results = call_haiku_with_retry(anth_key, batch)
        except Exception as e:
            api_failures += len(batch)
            print(f"    HAIKU FAIL: {e}", file=sys.stderr, flush=True)
            continue

        for row, hk in zip(batch, haiku_results):
            ok, reason = validate_haiku_row(hk)
            if not ok:
                rejected += 1
                print(f"    [reject id={row['id']}] {row['name']}: {reason}", file=sys.stderr, flush=True)
                continue
            update_fields = {k: hk[k] for k in REQUIRED_KEYS}
            if args.confirm:
                ok2, err = update_row(supa_url, supa_key, row["id"], update_fields)
                if ok2:
                    enriched += 1
                else:
                    db_failures += 1
                    print(f"    [db fail id={row['id']}] {row['name']}: {err}", file=sys.stderr, flush=True)
            else:
                enriched += 1  # would-write counter in dry-run mode
                # Print a sample for dry-run inspection (first 5 only)
                if enriched <= 5:
                    print(f"    [dry id={row['id']}] {row['name']}{', ' + row['subtitle'] if row.get('subtitle') else ''}", flush=True)
                    print(f"        fridge {hk['fridge_min_days']}-{hk['fridge_max_days']}d, "
                          f"open {hk['fridge_open_min_days']}-{hk['fridge_open_max_days']}d, "
                          f"freezer {hk['freezer_min_days']}-{hk['freezer_max_days']}d, "
                          f"pantry {hk['pantry_min_days']}-{hk['pantry_max_days']}d", flush=True)
                    if hk.get("tips"):
                        print(f"        tip: {hk['tips'][:120]}", flush=True)

    elapsed = time.time() - started
    print("", flush=True)
    print("=== Summary ===", flush=True)
    print(f"  fetched:        {len(rows):,}", flush=True)
    print(f"  enriched ({'wrote' if args.confirm else 'would write'}): {enriched:,}", flush=True)
    print(f"  rejected:       {rejected:,} (validation failed — row left NULL, category default still applies)", flush=True)
    if api_failures:
        print(f"  haiku failures: {api_failures:,} (batches that never got through — re-run to retry)", flush=True)
    if db_failures:
        print(f"  db failures:    {db_failures:,} (haiku ok, Supabase UPDATE failed)", flush=True)
    print(f"  elapsed:        {elapsed:.1f}s", flush=True)
    print("", flush=True)
    if not args.confirm:
        print("  → DRY RUN. Re-run with --confirm to actually update Supabase.", flush=True)
    else:
        print("  → Verify in SQL Editor:", flush=True)
        print("    SELECT name, subtitle, fridge_max_days, freezer_max_days, tips", flush=True)
        print("    FROM foodkeeper_shelf_life", flush=True)
        print("    WHERE source = 'USDA FDC' AND fridge_max_days IS NOT NULL", flush=True)
        print("    ORDER BY imported_at DESC LIMIT 20;", flush=True)


if __name__ == "__main__":
    main()
