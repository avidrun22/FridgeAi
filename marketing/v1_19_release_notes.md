# v1.19 — App Store release notes

**Submission date:** 2026-05-14
**Build:** 1.19 (23)
**Status:** Drafted

---

## "What's New in This Version" (visible to users in the App Store)

Better recipe browsing — and your shopping list builds itself.

- Tap any recipe → see exactly which ingredients are already in your fridge. The missing ones are the only ones we add to your shopping list. No more buying spinach you already have.
- "What are you craving tonight?" — pick a cuisine (Italian, Mexican, Thai, and 9 more) and Tonight's recipes filter to match.
- Eat Me First recipes get the same shopping-list flow as Plan tab recipes. Open a recipe, tap missing items, send them to a new list with one button.
- Smarter emoji on fridge items: 🐟 salmon, 🌿 cilantro, 🥩 ground beef. No more generic 🍗 for everything in Protein.
- New version notifications — opt in and get a heads-up when ok2eat updates land in the App Store.
- Quieter manual search: shows the 4 best matches instead of overwhelming you with 10.
- Several small bug fixes around the daily digest email and shared shopping lists.

Reply to any of our emails with anything broken or confusing — read same day. — Greg

---

## Notes for Apple Review (visible only to App Store reviewers, not users)

No new entitlements or APIs since v1.18.

Two unchanged review accounts continue to work:
- reviewer@ok2eat.com
- 9to5demo@ok2eat.com

(Both pre-confirmed; no email verification step required.)

This release is feature-only — no privacy policy, age rating, or content changes.

The receipt-scan flow + Sign in with Apple were both fully exercised in v1.16/v1.17 review. v1.19 keeps both intact and adds:
- Inventory-aware recipe browsing in the Plan tab (free, no IAP)
- Cuisine filter in the recipe picker
- Push notifications opt-in for new-version alerts (uses existing remote notification entitlement)

No regulated content. No financial transactions. No subscriptions yet.

---

## Internal changelog (not for submission)

**Headline shipped:**
- Recipe browser in Plan tab with cuisine-first picker + inline ingredient match against fridge inventory + "add missing to shopping list" bulk flow.
- Eat Me First recipe detail flow — same inline-match + add-to-list UX as Plan tab, but for the AI-generated recipes that use your top expiring items.
- App-version push notification cron — daily check against iTunes Lookup, push to opt-in users when a new version drops, dedupe via app_version_notifications table.

**v1.19 polish + papercuts:**
- Smart emoji inference (FOOD_EMOJI_RULES) — 80+ patterns mapping common food names to contextual emoji, applied at view time in Fridge + Eat First + AddModal preview + ItemDetailModal. Inferred emoji is persisted on save so the DB gradually heals as users interact.
- Type-ahead manual-add capped at 4 results (was 5) in both iOS App.js and web/src/components/AddItemModal.jsx.
- Receipt-scan video card re-added to ok2eat.com homepage (with YouTube embed for pFgzb1ZEBGc).
- Homepage version pill bumped from v1.16 → v1.18 (will reflect v1.19 only after Apple approves this submission).

**v1.19 bug fixes:**
- `fridge_items.status` column-doesn't-exist silent failure in `_shared/daily_recipes.ts` — caused every digest's recipe section to silently hide. SELECT clause cleaned up. Fix landed in both send-email-digest and send-smart-cook-night via the shared module.
- Multiple Eat First recipe sheet UX papercuts: invert tap default for missing ingredients, in-stock cards visually distinct, "+ Add all N missing" bulk action, editable list name on "+ New list", auto-navigate to newly-created list after queue.

**v1.19 infrastructure additions:**
- Server-side PostHog capture in send-email-digest Edge Function — fires `email_digest_sent` per recipient with `is_apple_relay` boolean (after registering ok2eat.com as approved sender in Apple Developer's Email Communication settings).
- recipe_bank table + 238 seeded recipes via Claude Haiku (Day 1 + Day 2 of v1.19 sprint).
- recipe-browse + match-recipe-inventory Edge Functions for the in-app recipe picker.
- 122 new shelf-life items added to foodkeeper_shelf_life table (FDA, FSIS, NCHFP, Cooperative Extension Service sources) — total now 782.
- Self-pruning build_shelf_life_pages.py so orphan pages from past dedup churn auto-clean.

**Strategic decisions:**
- "Web ships in lockstep with iOS" rule codified in CLAUDE.md — v1.20+ feature work always lands in web/src/ in the same version as App.js, no more iOS-first/web-later.
- App Store submission checklist codified in CLAUDE.md — every `eas submit` triggers a website hero badge + JSON-LD softwareVersion update.

---

## Deploy checklist for Greg

- [x] Bump app.json: 1.18 → 1.19, buildNumber 22 → 23
- [ ] `eas build --platform ios --profile production` (Greg's terminal — needs Apple Keychain)
- [ ] `eas submit --platform ios --profile production`
- [ ] Once approved by Apple: update marketing site hero badge + JSON-LD softwareVersion to v1.19 (per CLAUDE.md ritual)
- [ ] Send email blast to subscribers announcing v1.19 (optional — depends on whether deliverability has fully recovered post-spam-fix)
