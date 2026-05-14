# v1.18 — App Store Connect copy

Paste these into App Store Connect when v1.18 metadata becomes editable
(when build #25 lands in "Prepare for Submission" state).

Two fields below: **What's New in This Version** (user-facing, ≤4000 chars)
and **Notes for Review** (reviewer-only, ≤4000 chars).

---

## What's New in This Version

Audience: anyone seeing the update screen. Customer-benefit framing,
conversational, no marketing buzzwords.

```
v1.18 — Your daily digest now suggests recipes using what's actually in your fridge. Plus a new 6pm "cook tonight" nudge.

• Daily digest, smarter. Instead of generic recipe-site links, you'll see three dish ideas hand-picked for what's expiring in your fridge today. Tap any one to open the full recipe in the app — ingredients, steps, the works.

• Heart recipes you love. Tap the heart on any recipe and it lives in the new Saved Recipes section in your Plan tab. Find your go-tos without scrolling through old digests.

• Smart Cook Night. Tonight at 6pm we'll send one push: "Cook X tonight" with a hint of which items it'll use. Skip the daily "what should I make?" loop. Tunable in Settings if you eat earlier or later than 6pm — or turn it off entirely.

• Shared fridges talk to each other. If you share a household, you'll get a push when your partner adds milk to the Costco list or crosses off an item.

• Tighter Eat Me First. Longer item names fit cleanly now. Pill and button no longer collide.

Free on iPhone and the web. Reply to any of our emails with anything broken or confusing — read same day.
— Greg
```

Char count ≈ 1,020. Well under the 4000 limit.

---

## Notes for Review

Audience: Apple's app reviewer. Same test plan format as v1.17 — get them
to the right screens fast.

```
Thanks for reviewing v1.18. This build adds three new daily-recipe surfaces (in-app sheet, morning email cards, evening push) and a few quality-of-life fixes. Quick test plan below.

CHANGES SINCE v1.17:

1. Daily recipe deep-link sheet (in-app)
   - Sign in → tap any ok2eat.com/recipes/{id} link in Mail/Messages — app opens to a recipe sheet showing the dish name, time, difficulty, ingredients, steps, and a "uses from your fridge" list.
   - The sheet has a heart toggle in the top-right that saves the recipe to user_recipes_saved.
   - The same sheet appears in-app from Plan tab → Saved Recipes → tap any saved recipe.

2. Saved Recipes (Plan tab)
   - Plan tab now shows a "Saved Recipes" section under shopping lists, listing the user's hearted recipes newest-first.
   - Swipe-to-delete removes from saved.

3. Smart Cook Night (Settings)
   - Settings → "Cook Night reminder" lets the user pick the hour (16/17/18/19/20) the dinner push fires, or toggle off.
   - Backend: hourly pg_cron job invokes send-smart-cook-night Edge Function, which filters to users whose cook_night_hour matches their digest_timezone hour. Push deep-links to ok2eat://recipes/{id} which opens the same recipe sheet.

4. Shopping-list edit notifications (households only)
   - When a household member adds, bulk-adds, checks, or unchecks an item on a shared list, the iOS client calls send-shopping-list-notify which pushes "Greg added milk to Costco trip" to other members.
   - Solo households get nothing (no other members to notify).

5. Daily digest UI changes
   - Recipe section in the morning email is now native cards (dish name + emoji + "uses from your fridge") that deep-link to /recipes/{id}, replacing prior AllRecipes/NYT/Epicurious search buttons.
   - Empty-fridge variant: users with zero items get a "Your fridge is empty — add your first item" CTA instead of being silently skipped.

6. Plan tab cleanup
   - External recipe-search section removed (the daily digest recipes cover the same need with first-party content).

7. Eat Me First row layout
   - The expiry pill now stacks above the "Get recipes" button instead of beside it. Longer item names ("Baby spinach", "Red bell peppers") no longer get truncated.

DEMO ACCOUNT
   - Sign in with Apple works as the fastest path.
   - Or any email signup. The build's daily digest will fire on the next 9am UTC tick to the test address.

KNOWN
   - No private API usage, no new third-party SDKs.
   - Push notification permission is requested on first launch (unchanged from prior versions); Smart Cook Night and shopping-list notifications both ride that same permission.
   - Recipe generation is server-side via the existing generate-recipes Edge Function (no new client-side LLM calls).

Contact: hello@ok2eat.com if anything needs clarification mid-review.
```

Char count ≈ 2,580. Well under the 4000 limit.

---

## Where to paste

App Store Connect → ok2eat → iOS App → v1.18 (new version) → Distribution. Scroll to:

- **"What's New in This Version"** (under Promotional Text)
- **"Notes"** (under App Review Information → bottom of the page)

Both editable up until submit-for-review. Use the Save button after each paste.
