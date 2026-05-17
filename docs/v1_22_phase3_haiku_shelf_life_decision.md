# Phase 3 decision: do we spend $5 on Haiku to fill shelf-life for the new 1,250 USDA FDC rows?

> **Status:** decision-pending doc for Greg.
> Phase 1 (loading 1,250 USDA FDC perishables) shipped 2026-05-17.
> All 1,250 rows have NULL in fridge/pantry/freezer/opened shelf-life columns.
> Question: enrich now via Haiku ($3-5), or rely on category defaults ($0)?

## The current state with $0 spent

When a user picks a USDA FDC item from search (e.g. "Cheese, cheddar"),
App.js's `lookupShelfLife()` RPC returns the matching row but with all
day-fields NULL. App.js then falls back to **category defaults** from
`EXPIRY_MAP`:

```js
const EXPIRY_MAP = {
  Dairy:       14,   // days
  Protein:      3,
  Produce:      5,
  "Dry Goods": 180,
  Beverages:    7,
  Other:        7,
};
```

These are *conservative* defaults. They're correct-enough for roughly
60-70% of items, badly wrong for the rest.

## Where category defaults work (no Haiku needed)

These items are well-served by the category default — actual shelf life
matches within a day or two:

| Item                 | Category default | Real shelf life |
|----------------------|------------------|-----------------|
| Fresh chicken breast | 3d Protein       | 3-5d fridge     |
| Raw spinach          | 5d Produce       | 5-7d fridge     |
| Fresh strawberries   | 5d Produce       | 5-7d fridge     |
| Ground beef, raw     | 3d Protein       | 1-2d fridge     |
| Milk, 1%             | 14d Dairy        | 7-14d           |
| Broccoli, raw        | 5d Produce       | 5-7d            |
| Whole carrots        | 5d Produce       | 21-30d (mild loss) |

For these items, the category default is the right ballpark or only
slightly conservative. Users won't notice or complain.

**Estimated share of the 1,250 new rows: ~60-70%** (fresh meats,
fresh raw produce, fresh dairy).

## Where category defaults are badly wrong (Haiku helps)

These items would render misleading "expiring in N days" warnings:

| Item                              | Cat default | Real shelf life          | Severity |
|-----------------------------------|-------------|--------------------------|----------|
| Cheese, cheddar (hard cheese)     | 14d Dairy   | 180d unopened, 28d opened| HIGH — 13× off |
| Cheese, parmesan, hard wedge      | 14d Dairy   | 360d unopened, 28d opened| HIGH — 26× off |
| Salami, hard, dry-cured           | 3d Protein  | 30-60d unopened          | HIGH — 10× off |
| Prosciutto, sliced                | 3d Protein  | 30d unopened, 2-3d opened| HIGH for unopened |
| Pickled vegetables                | 5d Produce  | 365d unopened            | HIGH — 70× off |
| Frozen vegetables                 | 5d Produce  | 240-365d freezer         | HIGH (user expects long) |
| Canned tuna                       | 3d Protein  | 730d unopened, 2-3d open | HIGH for unopened |
| Sun-dried tomatoes                | 5d Produce  | 180d pantry              | HIGH |
| Dried beans, raw                  | 3d Protein  | 365d+ pantry             | HIGH |
| Bone-in pork, frozen              | 3d Protein  | 120d freezer             | HIGH |
| Dried mushrooms                   | 5d Produce  | 365d pantry              | HIGH |

**Estimated share of the 1,250: ~30-40%** (cured, canned, dried, hard
cheeses, frozen items — all of which appear in USDA's Foundation +
SR Legacy as common reference foods).

## Failure modes — what bad data actually does to the user

**Symptom 1: false "expiring soon" urgency.**
Dashboard shows "you have 5 items expiring this week" — but 3 of them
are actually cheese, salami, and pickled jalapeños that last 6+ months.
User opens Eat Me First, sees their hard cheese flagged as urgent, and
either (a) trusts the bad data and tosses fine food, OR (b) loses
faith in the urgency signal and stops trusting all warnings.

**Symptom 2: wasted Eat Me First / Smart Cook Night nudges.**
The 6pm push "you have ground beef expiring tonight" works when it's
ground beef. It looks broken when it's a 6-month-old wedge of parmesan.

**Symptom 3: dual-date "USDA shelf life: 13 days (5+ longer than your
date)" goes silent.**
Currently this banner only shows when `expiry_usda_date > expiry_date
+ 2 days`. With NULL USDA values, the banner never appears for these
items — so users miss the trust-building "your date is conservative,
USDA says it lasts longer" moment that justifies keeping the app open.

## Cost breakdown — what $5 actually buys

- **Anthropic Haiku pricing (May 2026):**
  ~$0.25 per 1M input tokens, ~$1.25 per 1M output tokens
- **Per-row cost** (using `scripts/expand_shelf_life.py` prompt shape):
  - Input: ~500 tokens (row context + schema + few-shot examples)
  - Output: ~150 tokens (validated JSON with day fields + tip)
  - Per row: ~$0.000125 + ~$0.0001875 ≈ **~$0.0003**
- **1,250 rows × $0.0003 = ~$0.38**
- With validation retries (Haiku occasionally returns invalid JSON,
  Phase 2 saw ~5% retry rate) → **~$0.40 real spend**
- The "$5 budget" was set as a ceiling, not a target. Actual cost is
  more like $0.40-1.00.

**Greg's terminal runtime:** ~5-10 minutes at ~3 calls/second
(rate-limited to stay under Anthropic's per-minute caps).

## What Haiku enrichment produces

For each NULL-shelf-life row, Haiku is prompted with:
- The item name + subtitle + ok2eat_category
- The schema: pantry_min/max, fridge_min/max, fridge_open_min/max,
  freezer_min/max, plus a short tips field
- Few-shot examples from the existing 660 FSIS rows to anchor format

Validates output against the schema before writing. Invalid rows are
logged + retried; if they fail twice, they're left NULL (fall back to
category default — same as today's state).

Same script template as the existing `scripts/expand_shelf_life.py`
that produced the Phase 2 320-row enrichment in v1.19. Proven workflow.

## Three options

### A. Spend $0.50 now, ship better data on the next AddModal search

Run the Haiku enrichment from Greg's terminal. ~10 minutes runtime,
~$0.50 actual spend. Every USDA FDC row gets per-item shelf life.
Users opening the app tomorrow see cheddar correctly at 6 months,
salami at 30 days, frozen broccoli at 240 days. Trust signal stays
intact.

**Pro:** Maximum data quality, trivial cost.
**Con:** ~10 minutes of Greg-terminal time. Some Haiku-generated rows
may have surprising values (e.g., underestimate for unusual items) —
spot-check first 20 before committing all 1,250.

### B. Defer until users complain

Leave 1,250 rows with NULL shelf_life. Category defaults handle most
items okay. Watch PostHog for support emails or item_tossed events on
items that have NULL shelf_life — those signal where defaults are
failing. Backfill targeted items via SQL UPDATEs as complaints arrive.

**Pro:** Zero spend, zero risk of Haiku producing surprising values.
**Con:** Wait-and-see means false-urgency for hard cheese / cured meat
/ canned / dried items today. Email digest "items expiring soon" will
flag stuff that isn't actually expiring. Trust erosion is hard to
measure but slow to recover from.

### C. Hybrid — Haiku only the obvious failure modes

Run Haiku ONLY on rows likely to have wrong defaults:
- Name contains "cheese" + subtitle contains "hard|cheddar|parmesan|swiss|gouda"
- Name contains "salami|prosciutto|jerky|pepperoni|chorizo"
- Subtitle contains "canned|pickled|cured|dried|frozen|smoked"

Run pattern: ~200-400 of the 1,250 rows get Haiku-enriched. The rest
stay NULL and use category defaults. Saves ~70% of the spend (already
trivial) but more importantly cuts the QA surface — fewer Haiku rows
to spot-check.

**Pro:** Surgical. Only enriches where defaults are demonstrably wrong.
**Con:** Manual filter list might miss edge cases. The remaining 800-
1,000 rows get category defaults forever (until next backfill pass).

## My recommendation: Option A ($0.50 full Haiku pass)

Three reasons:
1. **The cost is negligible** — $0.50 vs months of subtle trust erosion.
   The "$5 budget" was overly cautious; actual cost is closer to bus
   fare.
2. **The data quality is the product.** ok2eat's whole value prop is
   "your fridge knows what's expiring." Wrong shelf life on common
   items (cheddar, salami, dried beans) is exactly the kind of bug
   that loses users week-by-week without ever generating a support
   email.
3. **The workflow is proven.** Phase 2 already ran this exact script
   on 320 rows for the extended_haiku batch. We have validation, dedup,
   and retry logic that works. This isn't speculative.

Spot-check workflow:
1. Run Haiku on 50 rows first (`--limit 50`)
2. Greg eyeballs the output in SQL Editor:
   `SELECT name, subtitle, fridge_max_days, freezer_max_days, tips`
   `FROM foodkeeper_shelf_life WHERE source = 'USDA FDC' AND fridge_max_days IS NOT NULL LIMIT 50;`
3. If 90%+ look right, run the remaining 1,200
4. If <90% right, iterate the prompt before scaling

## What I need from Greg to proceed

A nod on Option A, B, or C — and if A or C, the actual `ANTHROPIC_API_KEY`
is already in `.appstoreconnect/telegram_config.json` so no setup needed.
I'll write the Phase 3 script (`scripts/enrich_usda_fdc_haiku.py`)
modeled after `scripts/expand_shelf_life.py` and hand off the commands.

Estimated time-to-deliver from "yes": 30 minutes
(15 to write the script + 10 for the spot-check run + 5 for the full
1,200-row enrichment).
