-- ─── 20260502_recategorize_other_rows.sql ────────────────────────────────────
--
-- v1.16 Phase 1 — One-shot re-categorization of existing catalog rows.
--
-- Background: the initial OFF ingest used tag-based category inference only.
-- Empirically that left 63% of rows with category="Other" because OFF tags
-- many products with super-generic categories like en:groceries or
-- en:processed-foods that don't map to ok2eat's 5 categories.
--
-- This migration applies the SAME name-keyword fallback that's now in the
-- Python ingest script (scripts/ingest_off_dump.py) — so existing rows get
-- the benefit without a full re-ingest.
--
-- Order matters: the nut-butter exclusion fires FIRST so "almond butter"
-- lands in Dry Goods, not Dairy. Each subsequent UPDATE only touches rows
-- still flagged "Other", so categories don't get clobbered by later rules.
--
-- Postgres regex notes: \m = start of word, \M = end of word (Postgres
-- equivalent of Python's \b boundary). `~*` is case-insensitive match.

-- ─── Lift the statement timeout for this session ─────────────────────────────
-- The Dairy and Dry Goods catch-all UPDATEs need to scan ~500K "Other" rows,
-- which exceeds Supabase's default 30-second statement_timeout. Disabling
-- it here lets each UPDATE run to completion; it resets when the session
-- ends, so this doesn't affect any other query.
SET statement_timeout = 0;

-- ─── 1. Nut butters → Dry Goods (must run BEFORE Dairy) ──────────────────────
UPDATE public.searchable_products
SET category = 'Dry Goods'
WHERE category = 'Other'
  AND name ~* '\m(peanut|almond|cashew|hazelnut|sunflower|pumpkin seed|tahini|nut)\s*butter\M';

-- ─── 2. Dairy ─────────────────────────────────────────────────────────────────
UPDATE public.searchable_products
SET category = 'Dairy'
WHERE category = 'Other'
  AND name ~* '\m(milks?|yogurts?|yoghurts?|kefir|cheeses?|butters?|creams?|cottage|sour\s+cream|half[\s-]and[\s-]half|ghee|whey|ice\s+cream|gelato)\M';

-- ─── 3. Protein ───────────────────────────────────────────────────────────────
UPDATE public.searchable_products
SET category = 'Protein'
WHERE category = 'Other'
  AND name ~* '\m(chicken|beef|pork|turkey|lamb|salmon|tuna|cod|tilapia|shrimp|crab|lobster|fish|hams?|bacon|sausages?|hot\s?dogs?|jerky|tofu|tempeh|seitan|eggs?|protein\s+bars?)\M';

-- ─── 4. Produce ───────────────────────────────────────────────────────────────
UPDATE public.searchable_products
SET category = 'Produce'
WHERE category = 'Other'
  AND name ~* '\m(apples?|bananas?|oranges?|grapes?|berries|berry|strawberr|blueberr|raspberr|blackberr|lemons?|limes?|peaches?|pears?|plums?|melons?|watermelon|cantaloupe|pineapples?|mangoe?s?|kiwi|avocados?|tomatoes?|lettuce|spinach|kale|arugula|cabbages?|broccoli|cauliflower|carrots?|celery|cucumbers?|zucchini|squash|pumpkins?|peppers?|onions?|garlic|potatoes?|sweet\s+potatoes?|mushrooms?|herbs?|cilantro|parsley|basil)\M';

-- ─── 5. Beverages ─────────────────────────────────────────────────────────────
UPDATE public.searchable_products
SET category = 'Beverages'
WHERE category = 'Other'
  AND name ~* '\m(water|juices?|sodas?|cola|pepsi|coke|sprite|fanta|teas?|coffees?|espresso|latte|cappuccino|wines?|beers?|ciders?|cocktails?|kombucha|smoothies?|shakes?|drinks?|seltzers?|sparkling)\M';

-- ─── 6. Dry Goods (catch-all for pantry items) ────────────────────────────────
UPDATE public.searchable_products
SET category = 'Dry Goods'
WHERE category = 'Other'
  AND name ~* '\m(bread|bagels?|tortillas?|pitas?|wraps?|crackers?|chips?|pretzels?|popcorn|cookies?|cakes?|brownies?|cereals?|granolas?|oats?|oatmeal|pastas?|noodles?|rice|quinoa|barley|flours?|sugars?|salt|pepper|spices?|seasonings?|sauces?|ketchup|mustard|mayo|mayonnaise|dressings?|vinegar|oils?|olive\s+oil|jams?|jellies?|honey|syrups?|chocolates?|candy|gum|nuts?|almonds?|peanuts?|cashews?|walnuts?|pistachios?|seeds?|beans?|lentils?|soups?|broths?|stocks?|canned|jars?|cans?|pickles?|relish|salsa|hummus|spreads?)\M';

-- ─── Verify the impact ────────────────────────────────────────────────────────
-- Run this after to see what changed:
--   SELECT category, count(*) FROM public.searchable_products
--   GROUP BY category ORDER BY count(*) DESC;
