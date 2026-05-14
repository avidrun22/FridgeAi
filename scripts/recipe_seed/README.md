# Recipe Bank Seed — v1.19

Two-step seed pipeline that populates the `recipe_bank` table with ~150
broadly-popular dish concepts:

```
[publisher research] → recipe_seed_concepts.json → [Claude generation] → recipe_bank
       (Day 1)              (this folder)              (Day 2)
```

## Day 1 — publisher research (done)

The goal was to identify ~150 recipe concepts that show up across multiple
major recipe publishers' "best of" / "most popular" lists. The dishes that
recur across publishers are the ones with broad cross-cuisine, cross-skill
appeal — exactly what we want in a starter bank.

Publishers consulted (May 2026):

- **NYT Cooking** — 10-year anniversary top-50 list. Source for italian classics, comfort food, and globally-influenced staples (Buttermilk Brined Chicken, Bo Ssam, Garlic Noodles, Mississippi Roast).
- **Allrecipes** — top-100 + top-15-ever lists. Source for crowd-pleasers (World's Best Lasagna, Banana Bread, Chicken Pot Pie, Pancakes).
- **Food Network** — top 100 + top 50 fan favorites. Source for entertaining staples (Chocolate Cake, Beef Stroganoff, Baked Salmon).
- **Bon Appétit** — Test Kitchen favorites + reader picks. Source for upmarket weeknight (Spiced Lamb Burgers, Brown Butter Chocolate Chip Cookies).
- **Serious Eats** — 2025 top recipes + all-time favorites. Source for technique-driven dishes (Chicken Saltimbocca, Crispy Roast Potatoes, Prime Rib).
- **Smitten Kitchen** — Deb Perelman's reader-favorite roundups. Source for trusted weeknight staples (Martha's Mac & Cheese, Lasagna Bolognese, Chicken Chili).
- **BBC Good Food** + **The Kitchn** + **RecipeTin Eats** — supplementary, used for international cuisine balance (Vietnamese, Thai, Indian, Mediterranean).

Cross-referencing methodology:

1. Pull the named recipes / dish concepts from each publisher's list.
2. Tally how many publishers feature each concept (or near-equivalents — "Garlic Lemon Chicken" and "Chicken with Lemon and Garlic" count once).
3. Concepts appearing in ≥3 publishers are auto-included.
4. Concepts in 1–2 publishers are included only if they fill a coverage gap (a meal type, cuisine, or dietary tag underrepresented in the top tier).
5. Balance the final list across meal types, cuisines, and dietary tags.

Final list lives in `recipe_seed_concepts.json` — 150 concepts, ready to
hand to Claude for recipe-text generation in Day 2.

## Why not actually scrape the publishers?

Two reasons:

1. **Brittleness.** Each publisher's "top recipes" page is its own HTML
   shape and changes frequently. A scraper would be high-maintenance for a
   one-time job.
2. **Recipe copyright.** Recipe ingredient lists + instructions are
   copyrighted as creative expression even though the underlying facts
   aren't. By limiting ourselves to dish CONCEPTS (names + meal type) and
   having Claude write our own original version of each recipe, we avoid
   reproducing any publisher's protected text.

So Day 1 is research via WebSearch + judgment, not scraping. The artifact
is the curated JSON, not a re-runnable scraper.

## Day 2 — Claude generation

For each concept in `recipe_seed_concepts.json`, Claude generates:

- A recipe name (may match the concept name or refine it)
- An ingredients array with quantities for 4 servings
- A step-by-step instructions array (5-10 steps typical)
- A "chef's tip" one-liner
- Cuisine tag, time estimate, difficulty

Output is loaded into `recipe_bank` with `source='seed'` via batch insert.

Run order:

```bash
# Day 2 — generate + load
python scripts/recipe_seed/seed_recipe_bank.py --dry-run    # spot-check 20
python scripts/recipe_seed/seed_recipe_bank.py              # full 150
```

Cost estimate: 150 × ~2k output tokens × Haiku 4.5 pricing = ~$0.50-1.00
one-time. Cheap insurance against a thin-looking bank on launch day.
