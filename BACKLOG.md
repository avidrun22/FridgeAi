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

- [ ] **v1.0.9 — real-user feedback fixes** — surfaced 2026-04-29 within hours of v1.0.8 going live, when Greg + wife stress-tested the shared-household flow. Three real bugs:
  - **Bug 1 (invite UX confusing)** — when the recipient gets a code, they don't know what to do with it. *Half-fix shipping immediately*: new `/join?code=ABC123` landing page on ok2eat.com that prominently displays the code, has an App Store install button, and clear instructions for "already have the app" path. *v1.0.9 piece*: update the share message in `InviteHouseholdModal` to point to `https://ok2eat.com/join?code=`. Eventual proper fix: Universal Links auto-open the app and prefill the code (already on backlog).
  - **Bug 2 (joining user's old inventory still showed)** — fixed in production 2026-04-29 via migration `20260429_v108_fix_redeem_moves_items.sql`. `redeem_household_invite` now moves the joining user's items into the new household, deletes their now-empty old household, and the migration also one-time-cleaned the existing bad state (used `IS DISTINCT FROM` to also catch NULL household_id from legacy clients). 0 orphaned items remaining. **No app update needed.**
  - **Bug 3 (shopping list not shared)** — the v1.0.8 shopping list was AsyncStorage-only (device-local), pragmatic shortcut to ship faster. v1.0.9 moves it server-side: new `shopping_list_items` table with RLS scoped by household, `PlanScreen` refactor to read/write via Supabase, optional Realtime subscription for instant cross-device sync.
  - **Bug 4 (onboarding forces household creation before invite)** — current flow auto-creates a household on first sign-in via `ensure_household_for_user`, then asks them to name it. New users with an invite code get a junk household first that they have to abandon. v1.0.9 adds a fork as Step 0 of `OnboardingModal`: "Have an invite code?" → redeem flow, OR "Create a new household" → existing 2-step name + container flow. The redeem RPC already handles the no-prior-household case correctly.

---

## 📥 Inbox

> Items captured via Telegram `/idea` land here. Triage into the sections below when you've got time.


---

- [ ] 2026-04-27 — screen record demo to upload to socials and website

- [ ] 2026-04-27 — add instacart reorder in place of Walmart

- [ ] 2026-04-27 — push privacy policy on website to a separate page

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
- [ ] **v1.0.6 release** — bump build, ship cream icon to App Store (current v1.0.5 in review still has dark icon)
- [ ] **App Store Support URL** — paste `https://ok2eat.com/#support` in App Information (reminder scheduled for 2026-04-28 9am)
- [ ] **Git commit website + script changes** — ok2eat.html, security.txt, deploy_website.py, daily_report.py (reminder scheduled for 2026-04-28 9am)
- [ ] **Test daily metrics report** — first auto-fire is 2026-04-27 9pm Pacific
- [ ] **X marketing — engage influencer reply targets** for 2 weeks before mentioning ok2eat (account list drafted in chat history; reminder scheduled for 2026-05-03)

### 🔜 Soon — next 1–2 weeks (continued)

- [ ] **iOS Universal Links for email digest "Open ok2eat" button** — currently linked to App Store URL (one extra tap to land in app). Proper fix: declare `associatedDomains: ["applinks:ok2eat.com"]` in `app.json`'s ios section, host `apple-app-site-association` JSON at `https://ok2eat.com/.well-known/apple-app-site-association` (no extension), update email button to `https://ok2eat.com/open`. iOS will open the app directly when tapped. ~30 min plus a v1.0.X build cycle.
- [ ] **Lawyer-review the privacy policy** — current policy on ok2eat.com (updated 2026-04-27) is conservative best-practice DIY: covers CCPA, GDPR, subprocessors, user rights, data retention. Friend Michael flagged that for real coverage we need an actual privacy lawyer. Priority lifts when (a) we cross ~500 users, (b) we open EU/UK distribution in App Store Connect, or (c) we begin any fundraising. Estimated cost: $500-1,500 one-time review, ongoing $0 unless major changes.

### 🌱 Eventually — next 1–3 months

> Top three are strategic platform expansions, in priority order.

- [ ] **AI recipes: 10/month free + paid tier for more** — gate the AI recipe generation behind a monthly quota. Free users get 10 recipe generations per calendar month; a paid tier unlocks unlimited (or higher quota). Touches: schema (add `subscription_tier` + `recipes_used_this_month` + reset cron on the 1st), Edge Function (`generate-recipes` checks quota before calling Anthropic), App.js (paywall modal when limit hit + settings showing remaining quota), App Store Connect (Apple IAP product — required for iOS digital subs; consider RevenueCat as middleware). Pricing TBD ($1.99–$4.99/mo range typical for utility apps). Free-tier features stay free: tracking, receipt scanning, barcode, push/email digest, reorder.
- [x] 2026-04-28 — **🥇 Shared inventory: iOS UI sprint** — feature-complete in dev build. Tracked under v1.0.8 ship item in *In Progress*.
- [ ] **🥈 Web app — close the parity gap with iOS** — Round 1 (auth + read-only fridge by container) shipped 2026-04-29 to `app.ok2eat.com` (Vite + React + Tailwind, Netlify deploy with `/web` base directory, `app.ok2eat.com` CNAME at Namecheap). Remaining rounds, in priority order:
  - **Round 3 — Item CRUD** *(highest ROI, ~2 hr)*: Add / Edit / Delete / Mark-used / Mark-as-opened modals matching iOS. Right now web is read-only, so this is the single change that takes it from "viewer" to "useful second screen."
  - **Round 4 — Plan tab + Share / Invite** *(~2–3 hr)*: Recipe-search links, manual shopping list with "Order N items" retailer picker, Invite-a-family-member flow that calls `create_household_invite` and `redeem_household_invite`.
  - **Round 5 — Onboarding + Manage Inventory** *(~1–2 hr)*: 2-step name-household / pick-container flow for users who sign up via web; Manage Inventory screen with member list (calls `list_household_members` RPC). Existing iOS users skip onboarding because their `has_seen_household_onboarding` flag is already true.
  - **Round 2 — Layout polish** *(~1 hr, cosmetic)*: Sidebar nav, stats row, category-filter chips, household-name page title. Closes the visual gap to iOS.
  - **Probably won't add to web** (by hardware, not effort): camera-based barcode scanning, receipt OCR, push notifications. All iPhone-primary features.
- [ ] **🥉 Android version of ok2eat** — third priority. Same Expo project should produce an Android build with minimal changes, but the Apple-specific bits (Apple Sign In, App Store affiliate tags) need fallbacks. Then Play Store listing, screenshots, and review.
- [ ] **QR-code handoff: web → phone scanner** — captured 2026-04-29 by Greg. Pattern: web app has no camera, but phone does. Web shows a QR code containing a deep link (e.g. `https://ok2eat.com/scan`). User scans the QR with their phone camera, ok2eat opens directly to the scanner, captures barcode/receipt, and the new item shows up on both screens because of the shared Supabase backend. Pieces: (1) Universal Links setup (already on backlog) so `https://ok2eat.com/scan` opens the app instead of the website. (2) iOS deep-link handler routes `/scan` straight to ScanScreen with camera active. (3) Web app: QR-code generation via a tiny library (qrcode.js or similar, ~3KB), button "Scan with phone" in the Add Item flow. Best-of-both-worlds UX. Probably v1.2.0 because it depends on Universal Links shipping first.
- [ ] **v1.1.0 — Shopping list polish sprint** — surfaced 2026-04-29 from Greg + wife testing v1.0.9. Two related improvements that go together:
  - **Multiple named shopping lists per household.** Today each household has ONE implicit list. Users want to organize by store ("Costco trip", "Trader Joe's", "Whole Foods") or by purpose ("This week", "Birthday party"). Schema: new `shopping_lists` table (id, household_id, name, created_by, created_at, archived_at) + add `list_id` FK to `shopping_list_items`. UI: Plan tab top-level becomes a list-picker (cards with item counts); tapping a list opens the item-edit screen we have today. "Create new list" flow + rename + archive actions. RLS scoped by household same as items. ~3-4 hr.
  - **Creator initials next to items.** Show a small green-text initial (first char of email's local-part) next to each shopping list item (and maybe each list itself), so household members can see who added what. Reuse the `list_household_members` RPC to build a userId→initial map on mount. ~30 min.
  - When tackling these, also reconsider: should "Order N items" pull from across all lists, or only the active one? Probably active only.
- [ ] **Recipe-link UX** — instead of AI-generated recipes in email digest, link out to AllRecipes / NYT Cooking / Epicurious search URLs based on user's inventory (cost-saver vs Anthropic per-user calls)
- [ ] **In-app recipe browsing** — see recipe details inside ok2eat instead of jumping to external sites
- [ ] **Recipe favorites + saving** — save recipes user likes for quick re-access
- [ ] **Receipt-scan accuracy** — improve OCR for low-light, faded, or crumpled receipts
- [ ] **SMS digest via Twilio** — alternative delivery channel for users who don't check email or push
- [ ] **Item-photo capture** — optional photo per item so users can visually confirm what's in the fridge
- [ ] 2026-04-28 — **Search across inventory** — search bar on the fridge home that filters items by name (and possibly category, brand, barcode). Most apps put this above the categories chip row. Lightweight: client-side filter on the already-loaded `items` array, no backend changes. Worth pairing with sort options (alphabetical, by expiry, by date added).
- [ ] 2026-04-28 — **Pending items: ordered but not yet received** — when a user orders from the shopping list (or hits Reorder on an existing item), automatically draft those items into a "Pending" tray. User taps "Mark received" when groceries arrive — that's when the expiry clock starts. Touches: schema (add `status` enum on `fridge_items`: `pending` / `active` / `used`, default `active` for back-compat; or a separate `pending_items` table), UI (new "Pending" section/filter on fridge home, "Mark received" action that transitions status and stamps `added_date = now()`), Plan tab (after tapping "Order N items", offer to draft those into Pending), item detail (after Reorder, offer the same). Solves the common UX gap where "I ordered milk yesterday, when does my fridge know about it?". Also gives us better data on actual buy-through vs intent.

### 🛸 Maybe — someday

- [ ] Integration with Instacart / Whole Foods for low-inventory reorder
- [ ] Barcode→recipe shortcut from iOS Home Screen widget
- [ ] Receipt-history view (past grocery runs as a timeline)

---

## ✅ Done

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
