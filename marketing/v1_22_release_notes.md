# v1.22 — Release Notes

Paste the body of "App Store version notes" into App Store Connect →
this version → "What's New in This Version". The character limit is
~4000 chars; the v1.22 draft below is well under.

---

## App Store version notes

What's new in v1.22:

• Your fridge knows more food. We added 1,200+ common items (hard
  cheeses, cured meats, frozen vegetables, dried beans, canned goods)
  so search finds them by name instead of buried under branded SKUs.
  Each one has shelf-life data tuned per item — cheddar lasts 6 months,
  not 14 days.

• Save your leftovers. After you mark something as used, you'll see
  "Save leftovers?" — tap Save and a cooked row appears in your fridge,
  good for 4 days. Stops those Tuesday-night "wait, when did I cook
  this" moments.

• Use / Order / Toss. Open any item and you'll see three clear actions.
  Toss tracks the waste so a future Dashboard can show you what you're
  losing month-over-month. Order opens online retailers or adds the
  item to your shopping list.

• Move items between containers. Realized something belongs in the
  freezer? Transfer it without re-adding — the expiry window updates
  automatically.

• Sort your fridge by expiry. New Fridge-tab sort options surface
  what's closest to going bad. Pairs with the Dashboard's At Risk
  Now tile, which is now tap-through to the right place.

• Polish. Share-sheet duplicate link preview fixed. Upgrade prompt
  no longer reappears after you dismiss it. Cheddar finally gets a
  cheese emoji.

Reply to any of our emails with anything broken or confusing — read
same day. — Greg

---

## App Store Connect — internal release notes (App Review team)

For Apple's reviewers, in the "Notes" field on the version page:

```
v1.22 — Expanded food catalog, leftovers tracking, item actions.

No new permissions, no new account types. Same auth + same data
access pattern as v1.21. To verify the new flows:

1. Sign in with the existing demo account (provided in App Review
   credentials field).

2. Search expansion (Fridge tab → Add Item → type a generic name
   like "cheddar cheese" or "salami"): the top result is now a clean
   generic item with per-item USDA shelf life, not a branded SKU.

3. Cooked leftovers (Fridge tab → tap any item → Use → enter an
   amount → confirm): an alert asks "Save leftovers?" Tap Save and
   a "Cooked …" row is created with a 4-day expiry.

4. Use / Order / Toss (Fridge tab → tap any item): the three-action
   row appears at the bottom of the detail sheet. Toss logs a
   waste-tracking event then deletes the item.

5. Container transfer (Fridge tab → tap any item → "Move to freezer"
   below the action row): item moves containers and expiry updates
   based on the new storage method.

No external APIs added. Shelf-life data is bundled in our Supabase
database (foodkeeper_shelf_life table) and was enriched offline
using public USDA FoodData Central reference foods.
```

---

## Promotional text (optional, 170 char limit)

```
We added 1,200+ foods with per-item shelf life — cheddar lasts 6
months, not 14 days. Plus: save leftovers, sort by expiry, move
to freezer.
```

(167 chars)

---

## Brand voice checklist (from CLAUDE.md)

- ✅ Benefit-led ("Your fridge knows more food" not "Expanded food catalog")
- ✅ Second-person ("After you mark something as used", "Move items")
- ✅ Em-dashes preserved
- ✅ Closes with "Reply to any of our emails… — Greg" signoff
- ✅ No buzzwords ("revolutionary", "game-changing")
- ✅ No emoji-stuffed bullets
- ✅ Specific numbers (1,200+ items, 6 months vs 14 days, 4 days)
  over vague claims ("a lot of items", "much longer shelf life")

---

## Post-approval ritual (per CLAUDE.md)

Once Apple approves v1.22 and it goes live in the App Store:

1. Update `ok2eat.html` hero badge: `<div class="hero-badge">v1.22 · iOS + web</div>`
   (currently around line 1094).

2. Update `ok2eat.html` JSON-LD `softwareVersion` to `"1.22"`
   (currently around line 978).

3. Deploy the marketing site: `python3 scripts/deploy_website.py`
   (or the Telegram `/deploy` shortcut).

DO NOT bump the hero badge or JSON-LD before approval — the badge
must always reflect what's actually live in the App Store, not what's
pending. Visitors who tap "Download on the App Store" get whatever
Apple is serving.

---

## What's in this build (for our reference, not the App Store)

Tasks closed in v1.22 (from #232 onward):

- #232 Recipe + Shopping List share: duplicate link preview fix
- #233 Cooked status for leftovers (this version)
- #234 Dashboard "At Risk Now" card + expiring banner clickable
- #235 Fridge tab sort options (by expiry date)
- #236 Pre-generate filters in EatMeFirst (cuisine, protein, etc.)
- #237 Duplicate item rows: collapse by name or surface brand
- #238 Pizza shown as "15 count" — quantity unit handling
- #239 Generic-first search (FoodKeeper above branded SKUs)
- #240 Universal share button (ephemeral + bank recipes)
- #241 Repeated upgrade popup bug on iOS (this version)
- #242 Remove button hardcoded to "Fridge" hotfix
- #243 Transfer items between containers (fridge → freezer)
- #244 Cheddar cheese gets milk emoji hotfix
- #245 USDA FDC perishables expansion (~1,250 rows, Haiku-enriched)
- #247 Item detail Use/Order/Toss row + waste tracking
