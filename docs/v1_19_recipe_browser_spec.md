# v1.19 — Recipe Browser & Inventory-Aware Shopping List

**Status:** Draft spec, 2026-05-13 (post-v1.18 submission)
**Owner:** Greg
**Target ship:** ~2 weeks after v1.18 lands in production

---

## 1. Why we're building this

Through v1.18, recipes are a downstream surface — they appear in the morning digest as cards, in the 6pm Smart Cook Night push, and in the Saved Recipes section of Plan. They show up *to* the user; the user doesn't go looking *for* them.

That's a missed opportunity. Recipe-driven cooking is the closest ok2eat gets to a recurring daily reason to open the app. Browsing should be a first-class motion, not a side effect of a notification.

More importantly, ok2eat is the only recipe app that already knows what's in your fridge. Every other recipe app — Mealime, Yummly, AnyList, NYT Cooking — starts from zero. Once you pick a recipe, they tell you to go buy everything. ok2eat can do the opposite: tell you what you already have, then offer to add only the gaps to a shopping list.

The strategic reframe: **ok2eat goes from "track your fridge, eat it before it spoils" to "track your fridge, get cooking ideas, shop only what's missing."** Tighter loop, broader competitive set, same core insight (your fridge is the source of truth).

## 2. User stories

The three primary stories this build serves:

**As Sarah** (existing user, opens the app a few times a week), I want to see a list of recipes I could make tonight using what's already in my fridge, so I don't have to think about dinner.

**As Mark** (new user, has been adding items but hasn't cooked from ok2eat), I want to scroll through recipe ideas and tap one that looks good, knowing the app will sort out what I already have vs. what I need to buy.

**As any user** picking a recipe with missing ingredients, I want one tap to add the gaps to a shopping list — without having to manually transcribe each item.

Non-goals for this build: step-by-step cook mode, timers, video, nutritional info, calorie tracking, scaling beyond what household_size already gives us. Those are v1.20 territory.

## 3. UX flow

### 3a. Plan tab structure (after)

Plan tab currently has two sections: Shopping Lists and Saved Recipes. After this build it has three:

```
Plan
├─ Recipes          ← NEW. Primary surface for discovery.
├─ Shopping Lists   ← unchanged
└─ Saved Recipes    ← unchanged, but reachable from Recipes too via the heart
```

The Recipes section is the new headline. Saved Recipes stays as a subsection — once you've hearted things, they live there.

### 3b. Recipes section — default state

Top of the Recipes section, three horizontal tabs:

- **Tonight** *(default)* — 3-6 recipes that lean heavily on what's expiring in your fridge today. Same generation backbone as the daily digest's 3 picks, but more of them and refreshed on pull-to-refresh.
- **Browse** — recipe bank organized by meal type (breakfast / lunch / dinner / snack) + filter chips (≤30 min, vegetarian, etc.).
- **Search** — text search across the bank, plus an "or generate one for me" CTA at the bottom that calls Claude with the user's query.

The Tonight tab is what most users see most days. Browse and Search are there for when "what's in my fridge" isn't the question.

### 3c. Recipe detail (reuses v1.18 sheet)

Tapping any recipe opens the same `RecipeSheet` modal that v1.18 already wired in (`/recipes/{id}` deep-link handler). That sheet already shows name, time, difficulty, ingredients, steps, uses-from-fridge, and a heart. The only addition for v1.19 is a new button at the bottom of the sheet:

> **[ + Make this — set up shopping list ]**

Tapping it opens the inventory-match flow.

### 3d. Inventory-match flow

This is the differentiating piece. When the user taps "Make this" on a recipe, we run a match between the recipe's `ingredients` array and the user's current `fridge_items`. The result is a confirmation sheet:

```
You already have:
  ☑ Chicken breast      (matched: "Chicken breasts, boneless")
  ☑ Garlic               (matched: "Garlic, 1 head")
  ☑ Olive oil            (matched: "EVOO")
  ☐ Onion                (we couldn't find this — mark if you have it)

We'll add to shopping list:
  ☑ Lemon, 1
  ☑ Parsley, 1 bunch
  ☑ Parmesan, ½ cup grated
  ☑ Breadcrumbs, ¾ cup

[ Add to list: Costco Trip ▾ ]   [ Add 4 items ]
```

Key principles:
- Matched items are pre-checked but **user-editable** — they can uncheck "I actually used the last of that yesterday" or check the row we missed.
- Missing items are pre-checked for addition — they can uncheck anything they don't want on the list.
- The target list defaults to the user's most recent active shopping list, falls back to "+ New list named '\<recipe-name\>'".
- One tap of "Add N items" → items land on the list → close sheet → toast.

### 3e. Match algorithm

The hard part. Three options considered, in order of confidence required from us:

1. **Exact string match.** Fast, brittle. "red onion" ≠ "Onion" ≠ "Sweet onion". Will frustrate users on day one. Reject.

2. **Claude-judged.** For each recipe ingredient, ask Claude "does any of this list of fridge items satisfy this ingredient?" Reliable, but ~$0.001-0.005 per recipe pick at Haiku 4.5 pricing — totally fine economically, and the cache means we only pay once per (recipe × user × fridge-state).

3. **Curated synonym table + fallback to Claude.** Maintain a `ingredient_aliases` table mapping canonical names to common variants ("scallion" → "green onion", "EVOO" → "olive oil"). Fast path for the 80% of pairs that hit the table; Claude for the long tail.

**Recommendation:** Start with option 2 (Claude-judged, cached). Single source of truth, no synonym table to maintain. If cost or latency becomes a problem at scale, layer option 3 underneath later.

The match runs server-side via a new `match-recipe-inventory` Edge Function. Returns:

```json
{
  "matched": [
    { "ingredient": "Chicken breast", "fridge_item_id": "uuid", "fridge_item_name": "Chicken breasts" }
  ],
  "missing": [
    { "ingredient": "Lemon", "amount": "1" }
  ]
}
```

The client renders the confirmation sheet from this payload. User edits are local-only — we don't re-call the match function on each toggle.

## 4. Data model

### 4a. New: `recipe_bank`

Until now all recipes have been ephemeral — generated, cached for a day, then aged out. For a browsable bank we need persistent recipes.

```sql
CREATE TABLE recipe_bank (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,              -- "garlic-lemon-chicken"
  name            TEXT NOT NULL,
  emoji           TEXT NOT NULL DEFAULT '🍳',
  time_minutes    INT,                                -- canonical, not "20 min" string
  difficulty      TEXT,                               -- easy | medium | hard
  meal_type       TEXT,                               -- breakfast | lunch | dinner | snack
  cuisine         TEXT,                               -- italian, mexican, etc. (free text)
  dietary_tags    TEXT[] DEFAULT '{}',                -- vegetarian, vegan, gluten_free, etc.
  description     TEXT,
  ingredients     JSONB NOT NULL,                     -- [{ item, amount }]
  instructions    TEXT[] NOT NULL,
  tip             TEXT,
  source          TEXT NOT NULL DEFAULT 'seed',       -- seed | generated | user_imported
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX recipe_bank_meal_type_idx ON recipe_bank (meal_type);
CREATE INDEX recipe_bank_dietary_tags_idx ON recipe_bank USING gin (dietary_tags);
-- For text search:
CREATE INDEX recipe_bank_search_idx ON recipe_bank
  USING gin (to_tsvector('english', name || ' ' || coalesce(description, '')));
```

**Seeding strategy:** 150 recipes, seeded once via a script. Source list derived from cross-referencing the top "must-make" lists across major recipe publishers (NYT Cooking, Bon Appétit, Allrecipes, Serious Eats, BBC Good Food, Smitten Kitchen, Food Network). The recipes that appear across multiple publishers' lists are the safest bets — broad appeal, well-known dish concepts. Then Claude writes ok2eat's own original version of each concept (name, ingredients with amounts, instructions, tip) so we're not copying any publisher's actual recipe text. Each recipe tagged with our meal_type, cuisine, dietary_tags. Stored as `source='seed'`. ~$1-2 one-time cost at Haiku 4.5.

Future: user-imported recipes (v1.20+) would use `source='user_imported'`. On-demand recipes from the "or generate one for me" CTA could be promoted to the bank with `source='generated'` after K users save them — v1.20+ idea.

### 4b. Existing tables, mostly unchanged

- `daily_recipe_cache` — keeps doing what it does (3 per user per day for digest + Smart Cook Night). Conceptually separate from the bank; over time these could converge but no need to force it now.
- `user_recipes_saved` — already polymorphic enough (`recipe_data` is the full JSON). When a user hearts a `recipe_bank` row, we copy the bank row's data into `recipe_data` and set `source_recipe_id` to the bank id. Same model as today.
- `fridge_items`, `shopping_lists`, `shopping_list_items` — no changes.

### 4c. Optional: `recipe_inventory_match_cache`

If we want to avoid re-paying Claude for the same (recipe, fridge-state) pair within a session:

```sql
CREATE TABLE recipe_inventory_match_cache (
  user_id          UUID NOT NULL,
  recipe_id        TEXT NOT NULL,                    -- bank slug OR daily_recipe_cache id
  fridge_hash      TEXT NOT NULL,                    -- hash of user's fridge item names sorted
  match_result     JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recipe_id, fridge_hash)
);
-- TTL via a daily cleanup cron — rows older than 7 days get pruned.
```

Probably worth it from day one. Match calls land near a meal time when the user is impatient.

## 5. Backend changes

Two new Edge Functions, one existing function lightly extended:

### 5a. New: `recipe-browse`

```
GET /functions/v1/recipe-browse?tab=tonight|browse|search&q=&meal_type=&dietary=
```

Returns a page of recipes. For `tab=tonight`, calls `getDailyRecipesForUser()` plus fetches extra picks from `recipe_bank` ranked by overlap with expiring fridge items. For `tab=browse`, straight bank query with filters. For `tab=search`, full-text search against the bank + a "generate one for me" hint if results are sparse.

### 5b. New: `match-recipe-inventory`

```
POST /functions/v1/match-recipe-inventory
{ "recipe_id": "garlic-lemon-chicken" }
```

Loads the recipe (bank or daily cache), loads the caller's fridge_items via service role + JWT-verified user_id, calls Claude with a structured prompt ("for each ingredient below, return whether any of these fridge items satisfies it, with the matched item name"), caches the result keyed by `(user_id, recipe_id, fridge_hash)`, returns the JSON.

### 5c. Extended: `generate-recipes`

Add an option to write the generated recipes into `recipe_bank` (with `source='generated'`) when explicitly requested by the user via the search-tab CTA. Default behavior stays user-facing (per-user, ephemeral).

## 6. Frontend changes (App.js)

Roughly six pieces:

1. **PlanScreen restructure.** Add a `RecipesSection` component above `ShoppingListsSection`. The section has its own header + three sub-tabs (Tonight, Browse, Search).
2. **Recipe-card list.** Reuses the visual style from the daily digest's recipe cards — emoji, name, time, difficulty, "uses X from your fridge" subtitle when applicable.
3. **Filter chips.** Above the Browse list. Meal type + dietary tags + ≤30 min.
4. **Search bar.** Above the Search list. Debounced 300ms. Empty-results state shows "Don't see what you want? **[ Generate a recipe ]**" — calls generate-recipes with the user's query as seed.
5. **RecipeSheet enhancement.** Existing v1.18 sheet gains a "Make this — set up shopping list" button at the bottom.
6. **InventoryMatchSheet.** New modal. Renders the match result, lets the user toggle rows, has a target-list picker, and on "Add N items" tap, performs the shopping_list_items inserts + closes.

PostHog events to add:

- `recipe_browse_tab_view` (tab: tonight | browse | search)
- `recipe_pick` (recipe_id, source: bank | daily_cache | generated, position)
- `recipe_make_tapped` (recipe_id)
- `inventory_match_result` (recipe_id, matched_count, missing_count)
- `shopping_list_generated` (recipe_id, target_list_id, item_count)

These let us answer: are people browsing? are they choosing recipes that lean on their fridge? does the match flow convert to a real shopping list? what's the abandonment rate at the confirmation sheet?

## 7. Out of scope for v1.19

Saying these out loud so we don't scope-creep:

- Cook mode (step-by-step, timers, voice control) — v1.20.
- Quantity-aware matching ("recipe wants 1 lb, you have 8 oz, that's half-enough") — too brittle without measured fridge items. Maybe v1.21+.
- Nutritional info — separate problem.
- User-imported recipes (paste a URL → parse the recipe) — appealing but each parser is its own can of worms. v1.20+.
- Recipe ratings, reviews, community — way later.
- Multi-recipe meal planning across a week — totally separate product surface. Maybe never.

## 8. Decisions (resolved 2026-05-13)

1. **Bank seeding.** Seed 150 recipes one-time, don't rely on organic growth. **To source the list:** scrape/research the most-published "top 150 dinner/lunch/breakfast" lists across major recipe publishers (NYT Cooking, Bon Appétit, Allrecipes, Serious Eats, BBC Good Food, etc.). Cross-reference for the recipes that appear repeatedly — those are the ones with broad appeal across cuisines and skill levels. Then have Claude write our own original versions of those concepts (name, ingredients, steps, tip) tagged with our meal_type / cuisine / dietary fields. Source field stays `seed`. Stored in `recipe_bank` via a one-time seed script, not via the daily Claude calls. Cost is ~$1-2 one-time for all 150 via Haiku 4.5.

2. **Tonight tab dedup.** Overlap with the morning digest's 3 picks. If you saw "Spinach yogurt bowl" in your 9am email, it should still be there at 5pm when you actually decide. The Tonight tab adds bank picks ranked by fridge-overlap on top of those 3, so the list is fuller.

3. **Heart-from-bank semantics.** Snapshot. When a user hearts a bank recipe, we copy the full recipe JSON into `user_recipes_saved.recipe_data` and set `source_recipe_id` to the bank slug. Consistent with how saved recipes already behave (survives bank edits, survives bank deletes).

4. **Empty fridge.** Tonight tab still loads, with an empty state at the top: "Add items to your fridge to get personalized picks" + a CTA button that opens AddModal. Below that empty state, show a few high-fridge-utilization bank recipes anyway (so the screen isn't blank). Browse and Search work normally even with an empty fridge.

5. **Generation cost ceiling.** Keep the existing generate-recipes rate limit (5/day/user). Guiding principle: anytime we make a Claude call, balance per-call cost against the value loss if we ration it. For Smart Cook Night and the daily digest the calls are cron-driven and bounded, so we don't gate them. For user-initiated "generate me a recipe" taps in Search, 5/day is generous enough that no real user hits it but it caps abuse.

**§3e match algorithm:** Confirmed Claude-judged (option 2), cached per (user_id, recipe_id, fridge_hash). Synonym table can layer in later if we find Claude is unreliable on a class of pairs.

## 9. Rough sequencing

If we kick off Friday and aim for a 2-week build:

- **Day 1:** Bank schema migration. Research script that hits 5-7 major recipe publisher "best of" lists, extracts recipe names, cross-references for overlap, produces a deduped target list of ~150 recipe concepts.
- **Day 2:** Seed script — for each of the 150 concepts, Claude generates ok2eat's own version (name, ingredients, instructions, tip, tags). Load into `recipe_bank` via batch insert. Manual spot-check the first 20 for quality before running the rest.
- **Day 3-5:** `recipe-browse` Edge Function + Recipes section UI scaffolding + Tonight/Browse/Search tabs.
- **Day 6-8:** `match-recipe-inventory` Edge Function + InventoryMatchSheet UI.
- **Day 9-10:** Shopping-list integration (target picker + bulk insert). Plumb the "Make this" button.
- **Day 11-12:** PostHog events, polish, empty states, edge cases.
- **Day 13-14:** Beta on Greg's account + 1-2 friendly users, gather feedback, ship to TestFlight.

That gets v1.19 in front of users ~2 weeks after v1.18 clears Apple review.

---

**Next step:** Read this through, mark up anything you want to change, then we kick off the bank schema + seed script Friday morning.
