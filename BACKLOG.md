# ok2eat backlog

Capture, triage, ship. Two ways to add items:

1. **Edit this file directly** when you're at the computer — drop items into any section, reorder, prune.
2. **Telegram `/idea <your idea>`** when you're away — appends to Inbox below with today's date.

Read it back from anywhere with **`/backlog`** (or open the file).

> Convention: `[ ]` = open, `[x]` = done. Date prefix is when the item was captured. Strike through items as you ship by moving them to **Done**.

Last reviewed: 2026-05-01 (cleaned stale items: v1.12 hotfix duplicate, privacy-page, Universal-Links, v1.0.12 date picker, money-saved v1.1.0 cruft. Added: demo videos plan, ASC screenshot refresh, push notif infra audit, OFF integration v1.15 milestone, Misfits subscription, vendor + SKU lookup on receipt scan).

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
- [ ] **Demo videos — 3 short clips for website + socials** (originally captured 2026-04-27 as "Screen-record demo," expanded 2026-05-01 with concrete plan). Record once at high quality, repurpose for website hero / IG Reels / TikTok / YouTube Shorts / X. Three storyboards:
  1. **"The save"** (~20s) — open Alerts tab, see expiring item, tap → recipe link. Closes the core value loop. Best for website hero (autoplay muted loop).
  2. **"One list, two phones"** (~25s) — split-screen of two phones in same household. Person A adds "eggs" to shared list → appears in real time on Person B's phone → tap "Order N items" → Instacart opens with everything pre-loaded. Hero v1.1.0 collaboration feature.
  3. **"Receipt to fridge in 10 seconds"** (~15s) — point camera at receipt → items populate. Most visually striking for cold social audiences who don't know receipt-scanning exists.

  **Tools:** iOS Simulator + `xcrun simctl io booted recordVideo` for clean output (no battery indicator, perfect frame), or real iPhone screen recording for tap-feel. iMovie for website edits, CapCut for vertical/social with auto-captions. **Non-negotiables:** captions baked in (most viewers watch muted), hook in first 1.5s, real-feeling data (eggs/milk/avocados, not "Test Item"), 1 CTA at the end.

  **Distribution:** website hero replaces nothing existing (adds visual proof above the fold); embed full 60s tour on `/blog/` and `/#how`; vertical 9:16 cuts to IG/TikTok/YT Shorts; native video upload to X (no YT links — algorithm penalty). High-leverage content for Impact's "growing follower base" gate. Realistic time budget: 4 hours total.
- [ ] **Swap Walmart → Instacart in the reorder picker** (Inbox 2026-04-27). Walmart links don't earn commission anyway (Impact gated). Instacart 1st in the picker is already done; this would move Walmart out entirely or replace with another retailer.

### 🔜 Soon — next 1–2 weeks (continued)

- [ ] **App Store Connect listing screenshots refresh** (captured 2026-05-01). Current ASC screenshots are from much earlier (pre-v1.0.8 / pre-shared-household era). With v1.13's eight features adding multi-add, past lists, recently-added chips, etc., the listing's promotional surface area is stale. Refresh: capture clean Simulator screenshots for the 5 store slots showing (1) fridge with real-feeling data, (2) AddModal with receipt-scan/barcode tiles, (3) shared shopping list with creator initials, (4) past lists with reuse CTA, (5) Order-via-retailer picker. Use the same iPhone 6.5" device family Apple wants. ~1 hr in Simulator + ASC upload. Pairs naturally with the demo videos work since both need clean staged data.

- [ ] **Push notification infrastructure audit** (captured 2026-05-01, prerequisite for v1.14 push notif feature). Before building "notify household when a list is created," verify the existing push-token flow is bulletproof: (1) confirm `Notifications.getExpoPushTokenAsync()` is being called and stored on user_settings (it was wired up for the email digest, but never load-tested for cold-start / re-permissioning); (2) confirm tokens persist across reinstalls and OS updates; (3) verify the Edge Function can read tokens with the right RLS scope; (4) test sending a push from a stub Edge Function to a TestFlight build. ~1-2 hrs investigation. If anything's broken, we'd find out before sinking time into the list-created notification feature itself.

- [ ] **Subscribe to Misfits Market + start the 3-month review post** (captured 2026-05-01). Two-track action: (1) sign up and use Misfits for a real 3-month period, tracking actual cost/waste data in a spreadsheet so the eventual blog post (Track 2 #3 in the blog rotation) has authentic numbers; (2) apply to the Misfits affiliate program in parallel — they have one independent of Impact. Misfits' food-waste-reduction angle is the strongest editorial fit on our affiliate target list, and a published 3-month review gives us a real portfolio piece for that application. This is the action item underneath the broader "Direct-affiliate programs to pursue" entry.

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
- [ ] **Price comparison — featured retailers + local stores within 5 miles** — captured 2026-05-01 from Greg. When a user is about to reorder a low-stock item, show side-by-side prices across (a) the retailers we already integrate with (Instacart, Amazon, Walmart) and (b) local grocery stores within a 5-mile radius of their home address. Two-part feature: feature retailers part is mostly UI + price-API integration; local stores is a real product (geolocation permission, store-locator API, price source — likely scraped or partner data). Feels like the highest-value follow-on to "One-Tap Reorder" because it shifts ok2eat from "nudge to buy" to "spend smarter." Probably v1.3.0 or later — needs serious data sourcing investigation first. Open questions: which price API (Basket, ShopSavvy, Fetch?), how to handle locality privacy (zip-code-only opt-in vs precise lat/long?), whether to rank by price or distance.
- [ ] **v1.15 — OFF barcode lookup (modest scope)** (captured 2026-05-01, scoped down 2026-05-02 after testing OFF text search and finding it brittle). Just barcode → product enrichment. Replaces our current third-party barcode service with OFF as the primary, normalized through `lib/openFoodFacts.js` (already prototyped + manually tested 2026-05-02). Shipping signals: (a) scan a barcode that wasn't recognized before and watch ok2eat populate name/category/image/nutrition; (b) the existing scan flow gracefully falls back when OFF returns null. **No text search in v1.15** — the OFF text-search API is too brittle to ship as the primary product-discovery surface (see v1.16+ for the right approach). One-day implementation: `App.js` scan handler imports `lookupByBarcode`, replaces the existing third-party call, falls back to current behavior on null.

- [ ] **v1.16 — Local product catalog + keyword fuzzy search** (captured 2026-05-02 after Greg called out that natural-language search is the load-bearing feature, not barcode scanning). Build the keyword-search foundation in our own infrastructure so we don't depend on OFF's brittle search API. Architecture is layered (each subsequent layer fires only when the previous doesn't return confident results):

  *Layer 1 — Personal/household history (~50ms):* Search items the household has ever scanned/typed/added. Highest-relevance first because "most grocery searches are repeats of items you've bought before." Stored in Supabase, indexed by household_id + product name. Probably resolves 70-80% of queries on its own once a user has a few weeks of history.

  *Layer 2 — Local product catalog (~200ms):* New `searchable_products` table in Supabase, populated by a weekly cron that pulls (a) Open Food Facts dump (filtered to US locale, ~500K-1M products after filter), (b) USDA FoodData Central branded-foods download (~500K products, US-curated, very high quality nutrition data), (c) our own community-captured scans. Postgres `pg_trgm` extension for fuzzy match (typos, partial words, multi-token). Combined fuzzy + full-text ranking via a `search_products(query)` RPC.

  *Layer 3 (deferred to v1.17) — Semantic search via pgvector:* Pre-computed embeddings for the catalog. Handles paraphrases, abbreviations ("tj's almnd mlk" → "Trader Joe's Almond Milk"), brand aliases. Adds ~4GB to the DB at our catalog size. One-time embedding cost ~$60 via OpenAI's `text-embedding-3-small`, or free via self-hosted MiniLM in an Edge Function.

  *Layer 4 (deferred to v1.18) — LLM query expansion fallback:* When Layers 1-3 all miss, ask Claude Haiku to rewrite the query ("oat milk pls" → "oat milk"). Cheap (~$0.001/query), only fires on ~5% of queries. Cache aggressively.

  **Why this beats just-using-OFF-search:** OFF's `cgi/search.pl` is community-edited, not optimized for retrieval. Multi-word queries fail. No locale weighting. No typo tolerance. No semantic understanding. Their team's focus is data ingestion, not search. We need our own search layer regardless of their data quality, and once we have it, we can plug in any other data source (USDA, community catalog, vendor APIs).

  **Storage cost:** ~3-4GB in Supabase Pro (inside the 8GB limit). Compute cost: $0 for pg_trgm searches, $0 for the weekly OFF sync (their dumps are public).

  **v1.16 scope (Phase 1 prototype landing 2026-05-02):**
  - Migration `supabase/migrations/20260502_searchable_products.sql`: table schema + pg_trgm index + `search_products(query)` RPC.
  - Ingest script `scripts/ingest_off_dump.py`: downloads OFF JSONL dump, filters to US, batch-inserts via Supabase REST.
  - Personal-history layer: query existing `fridge_items` filtered to household_id, ordered by most-recent-add.
  - AddModal UI: type-ahead text input that calls `search_products` RPC, debounced 300ms, shows top 5 results with image + brand + category. Tap a result to populate the form.
  - Schedule the OFF sync as a Supabase scheduled task (weekly Sunday night).

- [ ] **v1.17 — Semantic search layer (pgvector embeddings)** (captured 2026-05-02). Adds the second-tier "smart" search behind v1.16's keyword foundation. Pre-compute embeddings for every product in the catalog using OpenAI `text-embedding-3-small` (or self-hosted MiniLM). Store as 384-dim vectors via pgvector. New RPC `search_products_semantic(query_embedding)` for cosine similarity. The AddModal search becomes hybrid: pg_trgm first, fall through to semantic if no high-confidence keyword hits. Handles typos ("tostitoes"), abbreviations ("tj's"), brand aliases ("Coke" → "Coca-Cola"), and natural-language variants ("the chocolate one" → match against ingredients). Effort: 1-2 days. Depends on v1.16 catalog being live.

- [ ] **v1.18 — LLM query expansion + autocomplete polish** (captured 2026-05-02). Final layer: when keyword + semantic both miss, ask Claude Haiku to expand/rewrite the query, then re-search. Plus prefix-match autocomplete in the AddModal text input (suggest "milk" while user types "mil"). Plus personal-vocabulary boosting: if a household has bought "Trader Joe's Almond Beverage" 5 times, it ranks higher in their search results for "almond milk" than someone who's never bought it. Effort: 1 day. Depends on v1.16+v1.17 being live.

- [ ] **(superseded) Product database — community scans + Open Food Facts integration** (captured 2026-05-01 from Greg's feedback). Today scan accuracy depends on whatever external barcode service we hit; coverage has gaps and we don't accumulate data across users. Two parallel paths, both valuable:

  **Path A — Integrate Open Food Facts as primary lookup.** OFF is a free, open, crowdsourced database with ~3M+ products, barcodes, ingredients, nutrition, allergens, eco-score. Free API (no key needed), Apache-2.0 licensed. Integration is straightforward: barcode → `https://world.openfoodfacts.org/api/v2/product/{barcode}.json` → parse name, brand, category, image_url, nutriments. This dramatically expands coverage day 1 — likely covers 80%+ of US grocery items already. Also gives us nutrition data "for free" which unlocks the calorie/nutrition tracking Greg called out.

  **Path B — Capture our own scans into a community table.** New `community_products` table (barcode PK, name, category, brand, image_url, scan_count, first_seen_at, last_seen_at, source). Every successful scan writes a row (or increments scan_count if exists). Two values: (1) fallback when OFF doesn't have it, (2) we can submit our entries back to OFF (they accept community contributions) which is good karma + builds publisher cred for Impact reapply.

  **Recommended path:** ship A first (instant coverage upgrade, ~half a day of work), then layer B underneath as a fallback + analytics layer (couple more days). Don't build a proprietary DB without OFF as the floor — that's months of wasted bootstrap time on coverage that's already free.

  **Natural-language search angle Greg called out:** OFF supports text-search via `https://world.openfoodfacts.org/cgi/search.pl?search_terms=...`. Could add a "Search Open Food Facts" button on AddModal alongside barcode/receipt scan. User types "cheerios original," gets a list of matches with images, taps one → fully populated entry. This is the killer UX for items without a scanned barcode (produce, deli, anything in a ziploc).

  **Privacy note:** community-table writes should be opt-out-able and never store PII (just barcode + product metadata). The barcode itself isn't PII.

  **Cost angle Greg mentioned:** OFF doesn't have prices. For "cost of goods consumed" we'd need a separate price-history layer — reasonable from receipts (Stage 2 of money-saved counter) or via the price-comparison feature already in this section. OFF + receipt prices = nutrition × spend, which is a real analytics product.

- [ ] **Vendor + SKU lookup on receipt scan** (captured 2026-05-01 from Greg). When the receipt scanner extracts a vendor name (Trader Joe's, Whole Foods, Costco, etc.) AND per-item SKUs/UPCs, layer in vendor-specific catalog lookups to enrich each item with accurate metadata: real expiration windows for THAT specific product (not category default), nutrition facts, allergens, brand, image. Makes receipt-scan adds dramatically more accurate than the current "category default 7 days" heuristic. Pairs with OFF integration (OFF first, vendor catalog as fallback / overlay).

  **Three implementation tiers, in order of feasibility:**
  - **Tier 1 — public catalog APIs** where they exist. Some vendors expose product data via partner APIs (Instacart Connect, Walmart Open API, Kroger Catalog API). Limited coverage but real data. Apply for keys, plug in as additional lookup sources.
  - **Tier 2 — community-built vendor catalogs.** Path B from the OFF entry already proposes a `community_products` table keyed on barcode. Extend the schema to also store `vendor_sku` + `vendor_name`, so when one user scans a Trader Joe's receipt with TJ-specific SKUs, that data accrues into a shared catalog the next user benefits from. Best-of-both-worlds: no per-vendor partnership needed, accuracy improves with scale.
  - **Tier 3 — vendor-website scraping or partner integration.** Legally murky for scraping (TOS varies by vendor). Partner integrations are the right long-term path but require business development. Defer until Tiers 1-2 are exhausted.

  **Critical product question:** receipts often have abbreviated names (e.g. "TJ ALMD MILK 32OZ") rather than full product names. The vendor + SKU pairing is what unlocks reliable identification — abbreviated text alone is noisy. So this feature isn't just a "lookup" but also "use SKU to disambiguate when text is ambiguous."

  **Privacy note:** vendor + SKU isn't PII. Persisting it to a community catalog is fine without user consent UX — the privacy ask is about the receipt photo itself, not the items extracted.

  **Probably ships in v1.16 or later** — depends on (a) the OFF integration milestone landing first to establish the lookup pattern, (b) at least one Tier 1 partner API approval (Walmart Open API has a public application form; Instacart Connect requires a BD conversation).

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

- [x] 2026-05-02 — **v1.13 APPROVED + LIVE.** Eight things in one ship — three bug fixes (swipe-to-delete on FridgeScreen rows, AddModal Cancel button, numeric-keyboard insets + InputAccessoryView Done button) plus five shopping-list features rolled in from the original v1.14 queue (multi-add via paste-many-lines modal, checked items collapse to "Got N items" group at bottom, recently-added chips above the input row pulled from household history, past-lists section with `cloneArchivedList()` for reuse on similar trips, "Save & start fresh" CTA when all items are checked + always-visible Archive link). All shipped via the standard `prebuild --clean → sed MARKETING_VERSION=1.13 → sed CURRENT_PROJECT_VERSION=17 → archive → upload → submit` cycle. Build 16 was skipped to leave headroom (build 17 was the actual upload).

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
