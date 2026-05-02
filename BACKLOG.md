# ok2eat backlog

Capture, triage, ship. Two ways to add items:

1. **Edit this file directly** when you're at the computer — drop items into any section, reorder, prune.
2. **Telegram `/idea <your idea>`** when you're away — appends to Inbox below with today's date.

Read it back from anywhere with **`/backlog`** (or open the file).

> Convention: `[ ]` = open, `[x]` = done. Date prefix is when the item was captured. Strike through items as you ship by moving them to **Done**.

Last reviewed: 2026-04-28

---

## 🎯 In progress

- [ ] **Twice-weekly blog cadence (Tue + Thu)** — strategic move after Impact rejection: build content on ok2eat.com so the site has substance to crawl when reapplying. Scheduled task `ok2eat-blog-post-nudge` (cron `0 9 * * 2,4`) sends a Telegram nudge every Tue/Thu 9am Pacific. Workflow doc lives at `blog/HOWTO.md`.

  **Founder series** (in order, personal voice — track 1):
    1. Why I built ok2eat ✅ live 2026-04-29
    2. How I cut my grocery bill by optimizing what I already have
    3. How I always know what to buy when I'm not at home
    4. What real spending data taught me about my habits

  **Post-founder rotation — 4-post arc explicitly aligned with Impact's 2026-04-30 feedback** (they want "active, high-quality content" + "growing follower base" before reapplying). Each post is SEO-evergreen AND a natural fit for direct-affiliate placements:
    1. **"Sell-by, use-by, best-by: a complete guide to expiration date labels"** — myth-busting, very high search volume on each label term. Internal links to ok2eat. Affiliate angle: pantry/storage products (Vitacost, Thrive Market).
    2. **"The fridge organization guide: where every food group should live (and why)"** — evergreen, visual, screenshot-friendly. Pinterest/Instagram fodder. Affiliate angle: storage containers, ethylene absorbers.
    3. **"I tried Misfits Market for 3 months — here's the real cost and waste data"** — founder-voice review post. Direct affiliate-friendly (Misfits has its own program, bypasses Impact entirely). Authentic and on-brand: their pitch IS food-waste reduction.
    4. **"The 12 foods Americans waste the most (and what they cost in 2026)"** — listicle, shareable, hits ok2eat's core thesis. Cites USDA data. Naturally links to retailers in the app's picker.

  Track 1 builds audience trust (ok2eat as a real founder/product). Track 2 builds search traffic + gives direct-affiliate programs reasons to approve us. Both signals are exactly what Impact named in their 2026-04-30 feedback email.

- [ ] **v1.13 — three bug fixes + three shopping-list features** (queued 2026-05-01, scope expanded after Greg requested rolling v1.14 work in). Six things in one ship:

  *Bug fixes from real-user feedback:*
  1. **Swipe-to-delete regression on FridgeScreen rows.** Worked in v1.0.10, broke (silently) by v1.11. Root cause: the inner `TouchableOpacity` claimed the responder on touch, leaving our outer `PanResponder` to fight a bubble-phase `onMoveShouldSetPanResponder` it kept losing. Fixes: (a) added `onMoveShouldSetPanResponderCapture` so the parent claims the gesture in the capture phase, before the child Touchable; (b) routed `onSwipeRight`/`onSwipeLeft`/`disabled` through refs that update on every render (the `useRef(PanResponder.create(...))` pattern captures first-render closure values, which goes stale once props change); (c) added `onPanResponderTerminationRequest: () => false` so a parent ScrollView can't take the gesture mid-swipe.
  2. **AddModal Cancel button.** Tapping outside the modal sheet already closed it via the overlay `onPress=onClose`, but users reported feeling stuck. Added an explicit "Cancel" button below "Add to Fridge", styled as a low-emphasis text link.
  3. **Numeric keyboard coverage + dismissibility.** Two issues bundled: (a) iOS keyboard covered the focused input on AddModal — fixed by adding `automaticallyAdjustKeyboardInsets={true}` and `contentInsetAdjustmentBehavior="automatic"` to AddModal's ScrollView (same pattern v1.11 applied to PlanScreen). (b) iOS number-pad keyboards have no Return key — users had no obvious way to dismiss. Wired up an `InputAccessoryView` (nativeID `"addModalDone"`) with a green "Done" button → `Keyboard.dismiss()`. Attached via `inputAccessoryViewID` to the Amount field and the DayStepper inputs. iOS only; Android numeric keyboards already have a back/done affordance.

  *Shopping list polish (originally queued for v1.14, rolled into v1.13 per Greg):*
  4. **Multi-add to shopping list.** New "Add multiple items" link below the single-add row opens a modal with a multiline text input. Users type or paste one item per line; on Save, all items batch-insert into Supabase via new `bulkAddItems()` function with optimistic UI (temp IDs replaced by real DB rows on success, pessimistic refetch on failure). Modal has v1.13 keyboard fix + Cancel button. Replaces the pain point of typing+saving 15 items individually for a Costco run.
  5. **Checked items collapse to bottom.** List render splits into pending (always shown) + checked (collapsed by default into a "Got N items" group with chevron). Tap the group to expand/collapse. When everything is checked, an empty state appears: "🎉 All caught up — nothing left to grab." No DB schema change; split is purely client-side off the existing `checked` column.
  6. **Recently-added chips on shopping list.** Mirrors the fridge AddModal pattern. New `loadRecentShoppingNames()` queries the household's most recent unique item names (across all lists, archived included), capped at 6, deduped case-insensitively. Chips render above the add-input row; tap a chip to re-add that name to the current list. Optimistic local update keeps the chip row fresh after each add.
  7. **Past lists — save completed lists for reuse.** Archived lists now show in a collapsed-by-default "PAST LISTS · N" section at the bottom of the list-picker view. Tap a past list → confirm dialog → `cloneArchivedList()` creates a new active list with the same items copied (check state stripped, names preserved). New list name auto-generated as `<old name> · <month day>` so users can tell clones apart. No schema change — uses existing `archived_at` column on `shopping_lists`. Item counts pulled via PostgREST relation embedding (`shopping_list_items(count)`).
  8. **"Save & start fresh" CTA + always-show Archive.** Two pieces of UX glue around past-lists. (a) When a user has checked everything on a list, the empty-state card now leads with a green "Save & start fresh" button that archives the current list (it then re-appears in PAST LISTS, ready to clone). (b) The "Archive this list" link, previously gated on `lists.length > 1` because archiving the only list left users stuck, is now always visible — past-lists provides a clone-back escape hatch.

  Bumped 1.12/15 → 1.13/17 (build 16 was skipped to leave headroom). Single-file change (App.js + app.json). Build cycle: `prebuild --clean → sed MARKETING_VERSION=1.13 → sed CURRENT_PROJECT_VERSION=17 → archive → upload → submit`.

  *Test plan in TestFlight:*
  - Fridge: horizontal swipe right on a row triggers "Use it all"; swipe left triggers Delete confirm.
  - AddModal: Cancel button closes modal; tap Amount field → Done toolbar appears above number-pad keyboard, tapping Done dismisses it.
  - Plan: tap "Add multiple items" → modal opens, paste 5 lines, save → all 5 appear on the list. Check 3 items → they collapse into "Got 3 items" group at bottom; tap to expand. Add a couple items → recently-added chips populate; tap a chip → that name jumps to top of list. Archive a list (when 2+ exist) → it appears in PAST LISTS at the bottom of the picker view; tap it, confirm "Reuse" → new active list created with all items.

  *Deferred to v1.14:* drag-to-reorder (needs new native dep `react-native-draggable-flatlist`); push notifications when a household member creates a list (needs Edge Function + APNs wiring).

- [ ] **v1.12 hotfix — update prompt loop fix** (queued 2026-05-01). Two bugs caught from real-user screenshot:
  1. **`APP_VERSION` was hardcoded to `"1.0.9"`** and never bumped through the 1.0.10 or 1.11 ships, so the in-app update modal compared the wrong local version against Apple and fired for users already on the latest. Fixed by pulling `APP_VERSION` from `expo-constants` (`Constants.expoConfig.version`) so it auto-syncs with `app.json` going forward — no manual bump needed on future ships.
  2. **Modal version display was misformatted.** `formatVersion("1.10")` rendered as `"1.10.0"` in the modal because the parser padded 2-segment versions to 3. Compounding this: Apple's iTunes Lookup API can return versions in normalized 2-segment form (`"X.YZ"` instead of `"X.Y.Z"`), and our `compareVersions` got confused mixing 2- and 3-segment shapes. Fixed by rewriting `compareVersions` to fold both sides through `_appleNormalize()` (concat 3-segment → 2-segment) before comparing — eliminates the ambiguity. Also dropped Apple's value from the modal text entirely; now reads "A new version of ok2eat is on the App Store. You're on X.YZ."

  **Versioning correction**: prior conversation referred to ships as "1.0.10" and "1.1.0", but App Store Connect actually has them stored as `"1.10"` and `"1.11"` (literal 2-segment strings — likely from a `sed` quirk during the build cycle that flattened the dot). Apple compares versions numerically segment-by-segment, so `"1.1.1"` would be `[1, 1, 1] < [1, 11]` → rejected. Bumping to `"1.12"` (= `[1, 12]`) which Apple accepts as the next patch.

  Bumped `1.11/14` → `1.12/15`. Single-file change (App.js + app.json). Build cycle: prebuild --clean → sed MARKETING_VERSION/CURRENT_PROJECT_VERSION → archive → upload → submit. Test plan in TestFlight: open app on a 1.11 install, confirm modal does NOT fire.

  Going forward: use 2-segment `1.13`, `1.14`, etc. for patches. Bump to `2.0` (or `2.0.0`) when we want a clean major-version reset.

- [ ] **Money saved counter Stage 2** — re-visit when receipt-scan flow can attach a real `value_cents` per item at insert time. Schema is already in place: `fridge_items.value_cents` + `money_saved_events` table with RLS. Then revive the Fridge banner + Alerts card from v1.1.0's draft (commit history has the JSX). Numbers will have ground truth from receipts so the dollar figures actually mean something.

---

## 📥 Inbox

> Items captured via Telegram `/idea` land here. Triage into the sections below when you've got time.

*(empty — last triaged 2026-05-01: of the 6 items from Greg's May 1 batch feedback, all 6 rolled into v1.13 (3 bug fixes + multi-add + checked-collapse + recently-added chips). Drag-to-reorder, household-create push notification, save-completed-lists deferred to v1.14 — see Eventually section. Database strategy (Open Food Facts) also captured under Eventually.)*



---

## 📋 Triaged

### 🔜 Soon — next 1–2 weeks

- [ ] **Impact affiliate (Instacart + Walmart) — DECLINED, reapply in 4–8 weeks with feedback addressed** — application 7243988 declined on 2026-04-28. Support ticket [#815632] response landed 2026-04-30 from Compliance Team / Siska Marvel with concrete feedback (good — way more actionable than the original blanket rejection):
  > "At this time the traffic on your domain, and/or your business strategies doesn't quite meet the minimum requirements just yet for Impact.com Marketplace approval. We highly recommend that you apply to some campaigns directly to increase your traffic and marketing presence and then reapply to the Impact.com Marketplace, once traffic and marketing presence have increased. Please note that approval to the Impact.com Marketplace does not automatically mean Brands will approve you on the Platform. […] Brands generally look for active, high-quality content and a growing follower base."

  **Translation of what they want before approval:**
    1. ok2eat.com getting real Google search traffic (not just an iOS landing page).
    2. "Active, high-quality content" — the blog cadence is exactly this signal.
    3. "Growing follower base" — iOS user count + any social presence we can point to.
    4. *Two gates*: getting into Marketplace ≠ Brands approving us inside it. We need to look like a real publisher, not just an app dev.

  **Plan (4–8 weeks):**
    - Continue Tue/Thu blog cadence — see "Twice-weekly blog cadence" above for the 4-post arc explicitly designed for this.
    - Apply to direct-affiliate programs that bypass Impact (see "Direct-affiliate programs to pursue" below). Each one we get approved into is evidence of "marketing presence" when we reapply to Impact.
    - Watch Plausible/PostHog. Reapply target: ok2eat.com averaging 100+ unique visits/week, 100+ iOS DAU, 5+ blog posts published, 1–2 direct-affiliate program approvals in hand.
    - When reapplying, include the traffic numbers + active user count + published post list as evidence in the new application.

  Walmart and Instacart both run exclusively through Impact, so no alternative network for those two specific retailers. Until reapply: Instacart and Walmart links still open the right pages, just don't earn commission. Amazon Associates (tag `ok2eat-20`) is approved and earning. Retailer order in the picker stays: Instacart 1st, Amazon 2nd, Walmart 3rd.

- [ ] **Direct-affiliate programs to pursue (bypass Impact)** — Impact themselves told us 2026-04-30 to "apply to campaigns directly" first. The food-waste angle is on-brand for several programs that run their own affiliate platforms outside Impact. In rough priority order:
  - **Misfits Market** — their pitch IS food-waste reduction. Strongest editorial fit. Has its own affiliate program. Apply at misfitsmarket.com/affiliate. Plan: subscribe + write the 3-month review post (Track 2 #3 in the blog rotation), apply with that post as a portfolio piece.
  - **Imperfect Foods** — same angle as Misfits, also runs its own program. Some evidence they merged with another service in 2025; verify program is still active before applying.
  - **Thrive Market** — pantry/clean-food subscription, has own affiliate program. Less waste-angle but big affiliate budgets and good $/conversion.
  - **Hungryroot** — meal planning, food-waste-aware (chooses recipes from what you have). Direct fit with ok2eat's planning tab.
  - **Vitacost / iHerb** — pantry staples; broad selection. Lower fit on brand but easy approval bars.
  - **ButcherBox / Crowd Cow** — protein subscriptions; ok2eat's freezer/expiry tracking is a natural complement.

  Each direct-program approval = one more piece of evidence we're "actively building marketing presence" when we reapply to Impact for Walmart/Instacart. Captured 2026-04-30 from Impact's response email.
- [x] 2026-04-29 — **Hosting strategy decided: Netlify Personal ($19/mo, 1,000 credits/mo)**. Upgraded after the v1.0.8 / v1.0.9 sprint kicked deploy frequency past the free tier's ~20/month limit. Roughly $0.30 per deploy at this rate; safe ceiling for the next 4–8 weeks of bug fixes + twice-weekly blog cadence + iteration. Revisit the downgrade-to-Cloudflare-Pages option when deploys settle to <20/month.
- [ ] **X marketing — engage influencer reply targets** for 2 weeks before mentioning ok2eat (account list drafted in chat history; reminder scheduled for 2026-05-03)
- [ ] **Screen-record demo for socials + website** (Inbox 2026-04-27). High-leverage content for Impact's "growing follower base" gate. ~30 min to record, edit in iMovie, post to YouTube + embed on ok2eat.com.
- [ ] **Push privacy policy to a separate page** (Inbox 2026-04-27). Currently at `ok2eat.com/#privacy`. Move to `/privacy` for cleaner App Store / lawyer review. ~10 min.
- [ ] **Swap Walmart → Instacart in the reorder picker** (Inbox 2026-04-27). Walmart links don't earn commission anyway (Impact gated). Instacart 1st in the picker is already done; this would move Walmart out entirely or replace with another retailer.

### 🔜 Soon — next 1–2 weeks (continued)

- [ ] **iOS Universal Links for email digest "Open ok2eat" button** — currently linked to App Store URL (one extra tap to land in app). Proper fix: declare `associatedDomains: ["applinks:ok2eat.com"]` in `app.json`'s ios section, host `apple-app-site-association` JSON at `https://ok2eat.com/.well-known/apple-app-site-association` (no extension), update email button to `https://ok2eat.com/open`. iOS will open the app directly when tapped. ~30 min plus a v1.0.X build cycle.
- [ ] **Lawyer-review the privacy policy** — current policy on ok2eat.com (updated 2026-04-27) is conservative best-practice DIY: covers CCPA, GDPR, subprocessors, user rights, data retention. Friend Michael flagged that for real coverage we need an actual privacy lawyer. Priority lifts when (a) we cross ~500 users, (b) we open EU/UK distribution in App Store Connect, or (c) we begin any fundraising. Estimated cost: $500-1,500 one-time review, ongoing $0 unless major changes.

### 🌱 Eventually — next 1–3 months

> Top three are strategic platform expansions, in priority order.

- [ ] **AI recipes: 10/month free + paid tier for more** — gate the AI recipe generation behind a monthly quota. Free users get 10 recipe generations per calendar month; a paid tier unlocks unlimited (or higher quota). Touches: schema (add `subscription_tier` + `recipes_used_this_month` + reset cron on the 1st), Edge Function (`generate-recipes` checks quota before calling Anthropic), App.js (paywall modal when limit hit + settings showing remaining quota), App Store Connect (Apple IAP product — required for iOS digital subs; consider RevenueCat as middleware). Pricing TBD ($1.99–$4.99/mo range typical for utility apps). Free-tier features stay free: tracking, receipt scanning, barcode, push/email digest, reorder.
- [x] 2026-04-28 — **🥇 Shared inventory: iOS UI sprint** — feature-complete in dev build. Tracked under v1.0.8 ship item in *In Progress*.
- [ ] **🥈 Web app — close the parity gap with iOS** — Round 1 (auth + read-only fridge) and Round 3 (item CRUD) both shipped 2026-04-29. `app.ok2eat.com` is now linked from ok2eat.com (hero CTA + final CTA section, post-2026-05-01 copy refresh). Pending rounds — Greg confirmed both "surface web app on marketing" AND "continue building web app features" 2026-05-01:
  - **Round 4 — Plan tab + Share / Invite** *(~2–3 hr)*: Recipe-search links, **multi-list shopping list (matches iOS v1.1.0 — must read from `shopping_lists` table + filter `shopping_list_items` by `list_id`)**, "Order N items" retailer picker (Instacart, Amazon, Walmart), Invite-a-family-member flow that calls `create_household_invite` and `redeem_household_invite`. Most important sub-piece: shopping list parity, since iOS v1.1.0 shipped multi-list and the web schema is already there.
  - **Round 5 — Onboarding + Manage Inventory** *(~1–2 hr)*: 2-step name-household / pick-container flow for users who sign up via web; Manage Inventory screen with member list (calls `list_household_members` RPC). Existing iOS users skip onboarding because their `has_seen_household_onboarding` flag is already true.
  - **Round 2 — Layout polish** *(~1 hr, cosmetic)*: Sidebar nav, stats row, category-filter chips, household-name page title. Closes the visual gap to iOS.
  - **Probably won't add to web** (by hardware, not effort): camera-based barcode scanning, receipt OCR, push notifications. All iPhone-primary features.
- [ ] **🥉 Android version of ok2eat** — third priority. Same Expo project should produce an Android build with minimal changes, but the Apple-specific bits (Apple Sign In, App Store affiliate tags) need fallbacks. Then Play Store listing, screenshots, and review.
- [ ] **QR-code handoff: web → phone scanner** — captured 2026-04-29 by Greg. Pattern: web app has no camera, but phone does. Web shows a QR code containing a deep link (e.g. `https://ok2eat.com/scan`). User scans the QR with their phone camera, ok2eat opens directly to the scanner, captures barcode/receipt, and the new item shows up on both screens because of the shared Supabase backend. Pieces: (1) Universal Links setup (already on backlog) so `https://ok2eat.com/scan` opens the app instead of the website. (2) iOS deep-link handler routes `/scan` straight to ScanScreen with camera active. (3) Web app: QR-code generation via a tiny library (qrcode.js or similar, ~3KB), button "Scan with phone" in the Add Item flow. Best-of-both-worlds UX. Probably v1.2.0 because it depends on Universal Links shipping first.
- [ ] **v1.0.12 — Pick a specific date when adding an item** — surfaced 2026-04-30 from real-user feedback. Today AddModal only takes "lasts X days from today" via DayStepper, which forces the user to do mental date math. After an item is in inventory the ItemDetailModal already lets you pick a real date — extend the same to AddModal. Implementation: below the existing DayStepper, show the resolved date as a hint ("Goes bad May 4, 2026") that's tappable. Tap reveals an inline TextInput in YYYY-MM-DD format that, when edited, computes days-from-today and updates `closedDays`. Two-way bound: stepper changes update the date hint; date edits update the stepper. No new native dep — keeps the build cycle simple. ~45 min including QA. Lower-priority alternative for v1.1.0+: install `@react-native-community/datetimepicker` for a proper iOS calendar picker.

- [ ] **v1.1.0 — "Money saved" counter (engagement loop)** — captured 2026-04-30 from Greg's "testers say they like the tool but aren't incentivized to keep using it" feedback. The honest answer to that gap: show users the dollar value of food they didn't throw out. Each time an item is marked "used" (or quantity drops to zero) before its expiry, credit the user an estimated $ value (from receipt scan price if known, otherwise category-based default). Surface it in three places: top of Fridge tab ("Saved $47 this month"), Alerts tab ("Lifetime: $312"), email digest ("Last week's saves: $14 across 6 items"). Aggregate-of-all-users total is killer marketing copy ("Our community saved $X,XXX from the trash this month") for blog + Impact reapply.

  **Why this lands before real cashback:** unit economics — Amazon affiliate commission is ~$1.50 per converted reorder, so even at 1k DAU the per-user monthly cashback is well below any practical payout threshold ($5 standard). "Money saved" has the same engagement loop (visible accumulating number that goes up when you use the app) without the payout pipeline complexity. Real cashback queues in "Maybe — someday" and gets unlocked when DAU crosses ~10k.

  Schema: new `value_cents` field on fridge_items (nullable, set from receipt price when scanned, otherwise null). New `money_saved_events` table (user_id, household_id, item_id, item_name, value_cents, saved_at) — written when a user marks an item used. Aggregate views computed on the client from this table or precomputed via a daily Edge Function for the email digest.

- [ ] **Price comparison — featured retailers + local stores within 5 miles** — captured 2026-05-01 from Greg. When a user is about to reorder a low-stock item, show side-by-side prices across (a) the retailers we already integrate with (Instacart, Amazon, Walmart) and (b) local grocery stores within a 5-mile radius of their home address. Two-part feature: feature retailers part is mostly UI + price-API integration; local stores is a real product (geolocation permission, store-locator API, price source — likely scraped or partner data). Feels like the highest-value follow-on to "One-Tap Reorder" because it shifts ok2eat from "nudge to buy" to "spend smarter." Probably v1.3.0 or later — needs serious data sourcing investigation first. Open questions: which price API (Basket, ShopSavvy, Fetch?), how to handle locality privacy (zip-code-only opt-in vs precise lat/long?), whether to rank by price or distance.
- [ ] **Product database — community scans + Open Food Facts integration** (captured 2026-05-01 from Greg's feedback). Today scan accuracy depends on whatever external barcode service we hit; coverage has gaps and we don't accumulate data across users. Two parallel paths, both valuable:

  **Path A — Integrate Open Food Facts as primary lookup.** OFF is a free, open, crowdsourced database with ~3M+ products, barcodes, ingredients, nutrition, allergens, eco-score. Free API (no key needed), Apache-2.0 licensed. Integration is straightforward: barcode → `https://world.openfoodfacts.org/api/v2/product/{barcode}.json` → parse name, brand, category, image_url, nutriments. This dramatically expands coverage day 1 — likely covers 80%+ of US grocery items already. Also gives us nutrition data "for free" which unlocks the calorie/nutrition tracking Greg called out.

  **Path B — Capture our own scans into a community table.** New `community_products` table (barcode PK, name, category, brand, image_url, scan_count, first_seen_at, last_seen_at, source). Every successful scan writes a row (or increments scan_count if exists). Two values: (1) fallback when OFF doesn't have it, (2) we can submit our entries back to OFF (they accept community contributions) which is good karma + builds publisher cred for Impact reapply.

  **Recommended path:** ship A first (instant coverage upgrade, ~half a day of work), then layer B underneath as a fallback + analytics layer (couple more days). Don't build a proprietary DB without OFF as the floor — that's months of wasted bootstrap time on coverage that's already free.

  **Natural-language search angle Greg called out:** OFF supports text-search via `https://world.openfoodfacts.org/cgi/search.pl?search_terms=...`. Could add a "Search Open Food Facts" button on AddModal alongside barcode/receipt scan. User types "cheerios original," gets a list of matches with images, taps one → fully populated entry. This is the killer UX for items without a scanned barcode (produce, deli, anything in a ziploc).

  **Privacy note:** community-table writes should be opt-out-able and never store PII (just barcode + product metadata). The barcode itself isn't PII.

  **Cost angle Greg mentioned:** OFF doesn't have prices. For "cost of goods consumed" we'd need a separate price-history layer — reasonable from receipts (Stage 2 of money-saved counter) or via the price-comparison feature already in this section. OFF + receipt prices = nutrition × spend, which is a real analytics product.

- [ ] **Recipe-link UX** — instead of AI-generated recipes in email digest, link out to AllRecipes / NYT Cooking / Epicurious search URLs based on user's inventory (cost-saver vs Anthropic per-user calls)
- [ ] **In-app recipe browsing** — see recipe details inside ok2eat instead of jumping to external sites
- [ ] **Recipe favorites + saving** — save recipes user likes for quick re-access
- [ ] **Receipt-scan accuracy** — improve OCR for low-light, faded, or crumpled receipts
- [ ] **SMS digest via Twilio** — alternative delivery channel for users who don't check email or push
- [ ] **Item-photo capture** — optional photo per item so users can visually confirm what's in the fridge
- [ ] 2026-04-28 — **Pending items: ordered but not yet received** — when a user orders from the shopping list (or hits Reorder on an existing item), automatically draft those items into a "Pending" tray. User taps "Mark received" when groceries arrive — that's when the expiry clock starts. Touches: schema (add `status` enum on `fridge_items`: `pending` / `active` / `used`, default `active` for back-compat; or a separate `pending_items` table), UI (new "Pending" section/filter on fridge home, "Mark received" action that transitions status and stamps `added_date = now()`), Plan tab (after tapping "Order N items", offer to draft those into Pending), item detail (after Reorder, offer the same). Solves the common UX gap where "I ordered milk yesterday, when does my fridge know about it?". Also gives us better data on actual buy-through vs intent.

### 🛸 Maybe — someday

- [ ] **Real cashback (Stage 2 of "Money saved" counter)** — once "Money saved" is live and DAU is in the ~10k range, plug actual affiliate revenue into the same UI. Per-user Amazon Associates sub-tags (already supported via `tag=ok2eat-20-{userid}` pattern), daily ingest of the Amazon affiliate CSV report to credit each user's account, monthly Amazon gift-card payouts at $5 threshold via Tremendous or Tango Card APIs. Apple App Store rules allow cashback flows (see Rakuten, Honey) as long as it's real-world value — can't be in-app currency. FTC: disclose affiliate relationships. IRS: 1099-MISC if any user crosses $600/yr (unlikely at our scale for a long time but tracked). Capture from 2026-04-30 brainstorm with Greg about user incentives.
- [ ] Integration with Instacart / Whole Foods for low-inventory reorder
- [ ] Barcode→recipe shortcut from iOS Home Screen widget
- [ ] Receipt-history view (past grocery runs as a timeline)

---

## ✅ Done

- [x] 2026-05-01 — **v1.12 APPROVED + LIVE.** Single-purpose hotfix: in-app update prompt was looping for users on the latest build. Two root causes — `APP_VERSION` was hardcoded to `"1.0.9"` and never bumped through 1.10/1.11 ships (causing every user on every newer build to fail the version compare); and Apple's iTunes Lookup API normalizes `"X.Y.Z"` to `"X.YZ"` (concatenating last two segments), which broke the parser on multi-digit forms like `"1.10"`. Fixes: `APP_VERSION` now reads from `expo-constants` at runtime (auto-syncs with app.json forever); `compareVersions` rewritten to fold both sides through `_appleNormalize()` before comparing, sidestepping the parsing ambiguity entirely; modal text dropped Apple's normalized version number, now reads "A new version of ok2eat is on the App Store. You're on X.YZ." Naming correction logged: prior conversation referred to ships as "1.0.10" and "1.1.0" but App Store Connect actually has them stored as `"1.10"` and `"1.11"` (literal 2-segment strings, likely from a `sed` quirk during the build cycle that flattened the dot). Going forward: 2-segment patches `1.13`, `1.14`, etc.

- [x] 2026-05-01 — **v1.1.0 APPROVED + LIVE.** Four things shipped (Money-Saved scope cut after Greg's QA pass):
  1. **PlanScreen keyboard fix** — `automaticallyAdjustKeyboardInsets`, `contentInsetAdjustmentBehavior="automatic"`, `keyboardShouldPersistTaps="handled"` on the ScrollView. Real-user complaint was that the keyboard covered the shopping-list input.
  2. **Date picker on AddModal** — new `ExpiryDateField` component renders a tappable date hint below the DayStepper. Tap flips into a YYYY-MM-DD editor; on commit, parses date and updates `closedDays` two-way. Lets users say "expires May 4" instead of "lasts 4 days." Direct user feedback.
  3. **Multiple shopping lists + creator initials** — schema migration adds `shopping_lists` table + `list_id` FK on `shopping_list_items`. Default list backfilled per household. PlanScreen renders a picker view when 2+ lists exist (auto-selects single-list users into the default). "+ New list" button always visible in the in-list header so single-list users can create additional lists without bouncing through the picker. Member initials via `list_household_members` RPC.
  4. **Universal Links for digest** — `associatedDomains: ["applinks:ok2eat.com"]` in `app.json`. `apple-app-site-association` JSON at `/.well-known/` (Netlify `_headers` sets `Content-Type: application/json`). `_redirects` falls back `/open` to App Store for non-installed users. `send-email-digest` Edge Function URL changed from App Store URL to `https://ok2eat.com/open`.

  **Cut from v1.1.0:** Money saved counter. The category-based fallback values ($4 dairy, $8 protein, etc.) are wild guesses with no real-world calibration; a "money saved" number that's wrong by 2-3x is worse than no number. Schema (value_cents column + money_saved_events table) stayed applied — harmless, no UI references it. Stage 2 happens when receipt-scan prices are wired into item creation.

  Bumped 1.0.10/12 → 1.1.0/14. Migrations live under `supabase/migrations/20260430_v110_*.sql`. Companion website refresh shipped same day: privacy moved to `/privacy/`, hero copy + feature cards updated for shared lists + retailer reorder, blog post #3 ("One fridge, one list, no group chat"), Log in nav link added across all pages, deploy script relocated from `.appstoreconnect/` to versioned `scripts/`.

- [x] 2026-04-30 — **v1.0.10 APPROVED + LIVE.** "Fewer taps everywhere" release. Ships: inventory search, swipe-right-to-use / swipe-left-to-delete (PanResponder, no new native dep), recently-added quick-add chips in AddModal, receipt-scan promoted to a peer of barcode-scan (was buried; testers didn't realize it existed), first-run 3-card tour, full-screen "How To" tab (replaced HelpSheet + took Share's nav slot), Share moved into the global app bar, navBar restructure extends white through the home-indicator zone (Messages-app style). Plus web AuthScreen now defaults to magic-link for Apple-Sign-In iOS users.
- [x] 2026-04-30 — **Inventory search bar shipped in v1.0.10.** Sticky search above section tabs in the fridge screen, case-insensitive substring filter on item name. Empty-state for no matches with a Clear button. Originally 2026-04-28 backlog item.
- [x] 2026-04-30 — **v1.0.9 APPROVED + LIVE.** Real-user-feedback fixes from launch-day testing of v1.0.8: invite UX (`/join?code=` landing page on ok2eat.com), redeem migration that moves items into joined household, server-side shopping list with Realtime sync (replaces AsyncStorage-only), onboarding fork ("have an invite code?" before creating a household). Plus polish: editable DayStepper, simplified UseItemModal, AddModal expiration UI, packaged-categories opened-vs-closed shelf life.
- [x] 2026-04-29 — **v1.0.8 APPROVED + LIVE.** Shared household inventory (households / household_members / household_invites tables, RLS via `user_household_ids()` SECURITY DEFINER helper, four RPCs: ensure_household_for_user, create_household_invite, redeem_household_invite, list_household_members). `fridge_items.container` enum (fridge / pantry / freezer); `user_settings.has_seen_household_onboarding` flag. UI: bottom-nav rename to Fridge / Alerts / Plan / Share, OnboardingModal, ManageInventoryModal, InviteHouseholdModal, ShareScreen restructure, PlanScreen replaces RecipesScreen (recipe-search links + manual shopping list + Order-N-items retailer picker). Bundles all the v1.0.7 friend-feedback fixes (LIVE badge, OUT button, demo data, font scaling, NUTRI), open/closed expiry tracking, editable expiry stepper, Walmart→Instacart swap, and the v1.0.7 manual-add bug fixes (section prop, integer coercion, unit dropdown). Shipped under one combined submission to skip the wait for two reviews.
- [x] 2026-04-29 — **Newsletter signup + ok2eat.com blog launch.** `/blog/` section on the marketing site, first founder-series post live, email-signup form on homepage and at the end of every post, `subscribe-newsletter` Edge Function adds subscribers to Resend audience. Twice-weekly Tue+Thu 9am Pacific Telegram nudge scheduled.
- [x] 2026-04-29 — **app.ok2eat.com web app — Round 1 (auth + read-only fridge).** Vite + React + Tailwind SPA, deployed to Netlify with `web/` base directory, custom domain via Namecheap CNAME. Same Supabase backend as iOS so users sign in with one credential and see the same household inventory.
- [x] 2026-04-29 — **v1.0.8 hotfix migration shipped same-day** — `redeem_household_invite` now moves the joining user's items into the new household; cleanup migration moved 13 orphaned items + deleted empty households. Bug 2 from real-user testing fully resolved without an app update.
- [x] 2026-04-27 — Daily Supabase + PostHog metrics report (9pm Pacific via launchd)
- [x] 2026-04-27 — `#support` section on ok2eat.com
- [x] 2026-04-27 — `security.txt` at `/.well-known/`
- [x] 2026-04-27 — 8 Google Workspace email aliases (support, privacy, security, press, legal, partnerships, greg, noreply, digest)
- [x] 2026-04-27 — **Daily email digest LIVE.** Resend domain verified, both Edge Functions deployed (`send-email-digest`, `unsubscribe-email-digest`), schema + cron migrations applied, test email sent and rendered correctly. Cron fires hourly at :05; per-user `digest_hour` gating. Backfilled `user_settings` for all 7 existing users (digest_hour=9 default). RFC 8058 one-click unsubscribe wired up.
- [x] 2026-04-27 — **Open vs closed expiry tracking** built into v1.0.7. Two stepper inputs at add-time for packaged categories (Beverages, Dry Goods, Other); fresh categories (Dairy, Produce, Protein) keep the single closed-expiry input. "Mark as opened" button on item detail recalculates expiry; undo restores original closed expiry. Schema migration `20260427_v107_open_closed_expiry.sql` adds `is_opened`, `opened_at`, `expiry_opened_days`, `expiry_unopened` to `fridge_items`.
- [x] 2026-04-27 — In-app update prompt added to v1.0.6 (iTunes lookup → soft modal on launch).
- [x] 2026-04-27 — Disabled Xcode Cloud workflow (was generating noise emails on every commit)
- [x] 2026-04-26 — Cream rebrand (icon, splash, website)
- [x] 2026-04-26 — `/deploy` Telegram command (Netlify API, ~15s deploys)
- [x] 2026-04-26 — Edge Functions deployed (scan-receipt, generate-recipes)
- [x] 2026-04-26 — Telegram bot + Claude API agent live
- [x] 2026-04-28 — **v1.0.6 build 7 APPROVED + LIVE.** Email digest toggle in Reminders, in-app update prompt, stats-row cleanup, privacy/support sections. Ship date: 2026-04-28.
- [x] 2026-04-27 — v1.0.5 build 6 **APPROVED + LIVE on the App Store** (cream icon, multi-select bulk delete, expired filter, push digest, security.txt support page). Ship date: 2026-04-27 11:47 AM.
- [x] 2026-04-26 — v1.0.5 build 6 uploaded to App Store Connect
