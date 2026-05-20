# ok2eat backlog

Capture, triage, ship. Two ways to add items:

1. **Edit this file directly** when you're at the computer — drop items into any section, reorder, prune.
2. **Telegram `/idea <your idea>`** when you're away — appends to Inbox below with today's date.

Read it back from anywhere with **`/backlog`** (or open the file).

> Convention: `[ ]` = open, `[x]` = done. Date prefix is when the item was captured. Strike through items as you ship by moving them to **Done**.

Last reviewed: 2026-05-19 (v1.18→v1.25 — 8 versions, ~7 days of intense shipping. **v1.18 (LIVE)**: Native recipes in daily digest, Smart Cook Night daily 6pm push, Saved Recipes section, household shared-list notify, expiring-window default 3→7. **v1.19 (LIVE)**: Recipe browser with 238 recipes in `recipe_bank`, `match-recipe-inventory` Edge Function, Plan tab Recipes section + InventoryMatchSheet, 4 UX passes including cuisine-first flow, smart emoji inference, site refresh. **v1.20 (LIVE)**: `/demo` no-auth route on app.ok2eat.com, demo-launch reel, Android Chrome + iOS pinch-zoom hotfixes, onboarding email refresh. **v1.21 (LIVE in Google Play closed testing)**: Android version via Expo + Google Play, FCM credentials wired, push tested end-to-end on Pixel 9 emulator, Save heart on EatMeFirst, scan barcode chooser. **v1.22 (LIVE)**: 17 features + 5 hotfixes including Universal share button across all 3 platforms, sort by expiry, EatMeFirst filters, FoodKeeper-primary search, FoodKeeper expanded to 1,250 perishables, item-detail Use/Order/Toss action row, container transfers; marketing sprint with site audit + Lucky Beard-style quiz CTA. **v1.22.1 hotfix**: search natural-language + dedupe by generic. **v1.23 (in Apple review + Google internal testing)**: Password reset across iOS/Android/web with branded Resend email, Android nav padding fix, mobile hamburger nav on marketing site, stripped "free" pricing references, A11y + perf + mobile audit, fixed web household share RPCs, App Store 6.5" screenshots prepared. **v1.24 (code complete, rolled into v1.25 ship)**: Receipt-scan UX overhaul — Edge Function typed errors + JSON retry, client-side image resize to 1600px, rotating loading copy, cancel_stage instrumentation. **v1.25 (code complete, ready to bump+submit)**: Photo-of-items vision flow with 5/day rate limit, onboarding 4-item gate (schema + iOS/Android/web nav greying + floating banner), Fridge UI cleanup, search-RPC fallback for barcode-screen "Search Food Database", Android update prompt fix, nav padding 36→48, version in Settings, tile emoji + label refinements. **Infra shipped this period**: B2B waitlist + daily lead-digest email, honeypot+timetrap captcha on /for-business and web signup, mail-tester 10/10 deliverability validated, Netlify SSL outage diagnosed, Android tester additions, search timeout fix (cheddar cheese 3,390ms→457ms), daily PostHog report enhancements. **Watching now**: confirmation rate, D0/D2 onboarding-email engagement, receipt + photo-of-items scan adoption, onboarding gate unlock rate, Smart Cook Night CTR. Web PostHog instrumentation still pending. **Cohort to measure**: anyone signing up post-v1.25 ship will hit the 4-item gate; expect activation lift on the "actually use Eat First / Dashboard" engagement.)

---

## 🎯 In progress

- [x] **"What do we have to eat?" marketing pivot** (shipped 2026-05-05; supersedes 2026-05-04 ADHD-specific pivot) — broader, more universal framing while preserving founder-voice empathy that resonates with the ADHD audience. Live across: hero h1 + subhead, og/title meta, JSON-LD MobileApplication.description, how-it-works h2 ("From 'what do we want?' to 'what do we have?'"), final CTA h2 ("Stop staring at the fridge."), founder note. Companion blog posts: `/blog/what-do-we-have-to-eat.html` (2026-05-04) + `/blog/cut-grocery-bill-25-percent.html` (2026-05-05). All three URLs submitted to Search Console for priority recrawl. Original ADHD pivot brief preserved at `docs/adhd-marketing-pivot-2026-05-04.md` for reference. Old ADHD-specific draft (`blog/adhd-fridge-blindness.html`) deleted. Twitter/X thread draft saved at `_twitter_thread_draft.txt` (Greg posting manually). Reddit launch deferred to Greg.

- [ ] **Twice-weekly blog cadence (Tue + Thu)** — strategic move after Impact rejection: build content on ok2eat.com so the site has substance to crawl when reapplying. Scheduled task `ok2eat-blog-post-nudge` (cron `0 9 * * 2,4`) sends a Telegram nudge every Tue/Thu 9am Pacific. Workflow doc lives at `blog/HOWTO.md`.

  **Founder series** (in order, personal voice — track 1):
    1. Why I built ok2eat ✅ live 2026-04-29
    2. Dinner used to be "what do we want?" Now it's "what do we have?" ✅ live 2026-05-04
    3. How we cut our grocery bill 25% (without coupons or bulk shopping) ✅ live 2026-05-05
    4. How I always know what to buy when I'm not at home
    5. What real spending data taught me about my habits

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

**2026-05-15 — sky21 web-tester feedback batch** (signed up via demo, multiple
DMs to Greg). Their unfiltered take is gold — captured here verbatim before
triage:

- [ ] **Usage-pattern learning → proactive nudges** ("You usually eat the
  Carrots in 3 days, are they still there?"). Detect each user's
  consumption cadence per item-category and nudge before the fridge_items
  row goes stale. Needs: a `consumption_events` log (item removed /
  marked-used + timestamp), a rolling-window aggregator, and a push/email
  template. Likely a v1.23+ feature; complements expiry-based reminders
  with usage-based ones.

- [ ] **Mark items "used" via fridge photo** (reduces friction vs. tapping
  each row to remove). User snaps a fridge pic; we OCR/vision-compare
  against current fridge_items rows and auto-mark missing ones as used.
  Big UX win for power users. Connects to the "fridge photo" Reddit
  thread sky21 saw — current app only supports receipts, but the
  marketing implied fridge-photo input. Closing this gap removes a
  legitimate user-disappointment vector.

- [ ] **Duplicate-item counter** ("if same name + same description, show
  one row with a counter"). When user adds "milk" twice (e.g. two grocery
  trips a week apart), the fridge tab today shows two rows. Sky21 wants
  one row with quantity=2 and the older expiry on top. Needs: a merge
  rule in `rowToItem` or the AddModal commit path, plus a UI for
  "this expires Tue, the other one Fri" without losing per-unit
  expiry. Tricky to get right — defer until we see the duplicate-row
  pattern in PostHog.

- [ ] **OCR personalization — learn from user's amendments.** Sky21
  scanned an Australian receipt and got cryptic supermarket codes
  ("BNLSS CHK BR" etc.). They want the system to remember their
  amendments so the next "BNLSS CHK BR" on a future receipt
  auto-maps to "Boneless chicken breast" without re-typing. Needs:
  a per-user `receipt_alias` table (code → friendly name), prompt
  augmentation for scan-receipt with this user's aliases, and a
  ratchet-up confidence threshold so the system doesn't auto-apply
  shaky guesses. Same data also unlocks shared aliasing for
  popular chains (Aldi, Trader Joe's, Coles, Woolworths).

- [ ] **Photograph BBDs / expiry dates of individual items** (not the
  full receipt). Tighter scoped scan, lower Claude token cost,
  works for produce/dairy that don't show on receipts. Could be
  the v1.21+ "easier inventory capture" item #218 — they're related.

- [ ] **Receipt-edit screen font size on mobile** is too small per sky21
  on S25 Ultra. Quick win — bump the post-scan edit screen's row
  font to 15px+ on mobile breakpoints.

- [ ] **Android Chrome S25 Ultra layout bugs** — scan button overflows
  screen edge, "My fridge" title + subtitle squeezed into one column
  at narrow viewports. Audit the fridge tab + AddModal CSS at
  ~360-400px viewport widths.

- [ ] **Demo autocomplete doesn't fire on manual add.** sky21 typed into
  the demo's manual-add input and got no suggestions. Verify
  `web/src/components/AddDemoItemModal.jsx` autocomplete state +
  recent-items chip logic.

- [ ] **Cuisine selector for recipes (Italian/Chinese/Thai/Mediterranean)**
  — already in iOS v1.19 as the cuisine-first browser. Just need
  the web parity port (currently in progress as Phase 3 of #187).

- [ ] **Dietary tags on recipes (vegan, reduce-fat etc.) + favorite for
  later** — also already iOS v1.16 (dietary tags) + v1.18 (heart).
  Web parity port (Phase 3 of #187) closes both.

- [ ] **Eat Me First as the dominant home view + recipes as a sibling
  section** rather than embedded in the same flow. sky21's instinct
  matches the iOS v1.16 layout. Web's Eat Me First tab already
  exists; just need the recipes-as-sibling layout once the recipe
  browser ports.

**2026-05-15 (continued) — sky21 follow-up DM with two more ideas + a
pricing-tier hypothesis:**

- [ ] **Weekly menu autopilot.** The app proactively suggests the
  upcoming week's meals based on the user's habits (what they typically
  cook, what they have, what's expiring), and auto-generates the
  shopping list to execute on it. Sky21's framing: "less user, less
  friction — that's where people will pay for it." Moves ok2eat from
  "nice to have" to "need to have" by eliminating the active-planning
  step entirely. Big technical lift: needs a habit-detection layer
  (consumption_events + meal_log table or similar), a constraint
  solver for "what's in stock + what cooks well together + what fits
  the user's dietary preferences," and a UI that shows the proposed
  week before locking it in. Strong candidate for v1.23+ alongside the
  "usage-pattern learning" idea — they share a habit-detection backend.
  Pricing implication: this is likely the wedge that justifies a paid
  tier. Worth a real product-thinking pass before designing.

- [ ] **Family/household pricing tier.** Sky21 sees ok2eat's real value
  in family coordination (vs. solo use). Suggests tiered pricing:
  individual free / couple tier (2 devices) / family tier (4+ devices),
  with the autopilot/weekly-menu features gated behind a paid tier.
  Aligns with the v1.10 household_members infra we already have — the
  data model supports this; it's a packaging + paywall problem, not a
  rebuild. Worth a pricing experiment after we have ≥1000 active
  households and can A/B test conversion.

**Positive validation from sky21 (not action items, but worth keeping):**
"Onboarding very smooth, link to go in, not even a password, welcome email
shortly after. You are doing good man! I like it." — v1.17's
auto-create-user_settings + Resend confirmation flow + onboarding email
sequence are landing well with real users.

---

**2026-05-15 — B2B opportunity surfaced on r/InventoryManagement.**
Post from Darkflame1O (4d ago): "Expiration Date Tracking (With Toast
Retail Integration?)". Small family-run grocery store upscaling their
warehouse inventory, needs:
  - Stock-location tracking in a warehouse
  - Per-case expiration date tracking + reminders before expiry
  - Push sales/promotions on expiring stock
  - Toast Retail POS integration (avoid double-keying SKUs)
  - Open to a 3rd-party tool if Toast can't do it natively

This is a real adjacent market to ok2eat's consumer ICP. Backend
(`fridge_items` + expiry + reminders + FoodKeeper) covers ~60% of the
data model. UI, multi-user roles, location tracking, and POS sync are
the gaps.

**Effort tiers (do NOT pursue mid-Product-Hunt-launch; capture for
post-launch evaluation):**

- [ ] **Tier 1 — B2B-lite pilot (~1 week dev).** CSV import of SKUs +
  expiry dates, Stripe paywall for a Pro tier, simple landing page
  targeting small grocers. Validates demand with 1-2 paying pilots at
  $50-100/mo before any bigger investment. No Toast integration —
  user dual-keys via export from Toast → CSV → ok2eat.

- [ ] **Tier 2 — Real B2B product (~4-6 weeks dev).** Builds on Tier 1
  with: multi-user roles (staff/manager/owner) on top of
  `household_members`, audit log of inventory changes, free-form
  location strings beyond fridge/pantry/freezer, custom reminder
  windows per category, promotion-suggestion engine ("these 12 SKUs
  expire in 3 days, here are markdown prompts"), per-location billing.
  After this, ok2eat stands alone for small grocers / cafes /
  caterers / juice bars without needing POS integration.

- [ ] **Tier 3 — Full Toast Retail integration (~5-7 weeks dev +
  2-4 weeks waiting on Toast partner approval).** What Darkflame1O
  specifically asked for. Requires Toast Developer Partner Program
  approval (free but enforces partner-quality SLAs + security review),
  OAuth + API client, two-way inventory sync, webhook subscriptions
  for real-time updates. Significant commitment with non-trivial
  ongoing maintenance burden (Toast API changes, idempotency,
  retry/DLQ).

**Recommended path (in order):**

1. **Reply to the Reddit post** with a low-effort offer: "ok2eat
   tracks expiry but doesn't integrate with Toast yet — happy to chat
   about your use case." Costs 5 min, surfaces qualified leads.

2. **Add a "B2B interest" Resend audience** + a one-line link on
   ok2eat.com footer or `/for-business` landing page. Capture emails
   from people self-identifying.

3. **Watch the funnel for 4-6 weeks post-Product-Hunt.** If ≥5 small
   grocers volunteer "yes I'd pay $X/mo," Tier 1 becomes worth a
   week of dev time. If crickets, ok2eat stays consumer-focused.

**Strategic risk:** B2B is a completely different go-to-market motion
(cold outreach vs paid social), pricing model ($50-300/mo vs
$0-10/mo), and support burden (a grocery store down at 8am during
inventory is a different incident than a consumer email). Pursuing it
splits the founder's time. Worth pursuing only if signal is strong
post-PH.



---

## 📋 Triaged

> Reorganized 2026-05-12 around **improvement areas** rather than ship cadence. Each item is tagged with the funnel stage or business outcome it moves. Pick what's leakiest this week, not what looks shiniest.

### 🎯 Improvement areas — where the leverage is right now

**🔓 Activation** (signup → confirm → first item)
- v1.17 just shipped the Resend-confirmation fix for the 63%-never-confirm gap. Watch the cohort that signs up post-2026-05-12 for 7 days to measure lift.
- D0 onboarding email open + click rates → if D0 underperforms, rewrite subject lines before iterating layout.
- Behavioral `quick_start` email is gated on signup-without-first-item; eligibility window was extended to 60d. Watch the firing volume + conversion.

**🔁 Retention** (D1 → D7 → D30)
- Eat Me First tab is the new headline retention surface. Need PostHog event for `eat_me_first_viewed` + `eat_me_first_item_tapped` so we can measure if it's actually pulling people back. *Not sure this fired in v1.16 — verify.*
- D1 retention push is live; benchmark vs. v1.15's ~6% D1.
- Smart Cook Night (daily 6pm "make X tonight using Y") still unshipped — single biggest unbuilt retention lever per Reddit research. Targeted at v1.18.

**📈 Growth** (acquisition + viral surface)
- **Product Hunt launch — Sat 2026-05-30 target.** Revived now that v1.16/v1.17 give us a real reposition story + a real video. 18 days to accumulate 100+ "notify me" subs on the Upcoming page. Prep doc at `docs/producthunt-launch.md` needs a refresh pass — see Soon section.
- Blog cadence holding Tue/Thu. Next founder-series post: "How I always know what to buy when I'm not at home" (#4).
- IG carousel + Reel cross-post of launch reel — handoff doc with Greg; un-shipped while v1.17 was the priority. Now feeds directly into PH pre-launch audience-warming.
- Reddit launch still deferred to Greg. Strongest organic acquisition signal in our research; pull the trigger once v1.17 is approved. Pairs well with PH pre-launch window.
- App Store screenshots refreshed with v1.16. ASO keywords also refreshed. Monitor App Store impression → install rate weekly.

**💰 Monetization** (revenue, in priority order)
- Impact affiliate reapply (Instacart + Walmart) — gated on 100+ visits/week + 100+ DAU + 5+ blog posts + direct-program approvals. Tracking below.
- Direct-affiliate programs (Misfits Market is the strongest fit) — un-started. Misfits is the unlock for both reapply evidence and a real on-brand affiliate revenue stream.
- AI recipes paid tier (10/mo free, unlimited paid) — not started. Gated on MAU > 500 or 50+ App Store reviews per Greg's earlier decision.

**🛠 Infra hardening** (technical debt + observability)
- Web app PostHog instrumentation — still zero events flowing. Blocks any web-app retention story.
- Push-notif infra audit — partly addressed by v1.16 enabling D1 push; still no load-test of cold-start re-permissioning + RLS scope.
- v1.17 confirmation-rate measurement plumbing — need a Supabase view + Telegram alert when the confirm-within-24h rate moves week-over-week.

---

### 🔜 Soon — next 1–2 weeks

- [ ] **Product Hunt launch — target Sat 2026-05-30** (revived 2026-05-12 now that v1.16/v1.17 collateral is in place). Prep doc lives at `docs/producthunt-launch.md` but needs a refresh pass before going live — was written pre-reposition. What's changed since the doc was drafted:
  - **New positioning**: tagline + description should lead with v1.16's "what to eat first — before it goes bad," not the old "what do we have to eat?" framing.
  - **Headline UX**: Eat Me First tab + Dashboard tab are the hero features now. Gallery needs screenshots of both.
  - **Real video assets**: launch reel + App Store Preview .mov + 2 YouTube uploads already exist. The doc still tells Greg to record an iPhone screen capture — replace with: link the YouTube full demo + use the App Store Preview .mov as the gallery video.
  - **App Store screenshots already refreshed** (v1.16 ship). Reuse the same 5 for PH gallery — no re-capture needed.
  - **Maker comment** is mostly still good. Update one paragraph to reference Eat Me First explicitly. Drop the "SMS-based shared fridge" line (deferred to v1.19) and replace with "next: Smart Cook Night, daily 6pm dinner nudge" so we don't promise what we haven't built.
  
  **Why 5/30 vs. the doc's original 5/16:** v1.17 is still in Apple review on 5/12, so the earliest realistic launch is 5/23 anyway. Pushing to 5/30 buys 18 days of "Upcoming Products" subscriber accumulation (PH-internal data: 100+ pre-launch subs ≈ top-10 finish), gives time for IG/Reddit cross-post to seed audience, and lets v1.17's confirmation-rate fix have measurable lift to talk about in the maker comment. Saturday rationale (lower competing-launch volume, weekend products stay featured into Monday) still holds.
  
  **Pre-launch checklist** (start within the next week): account setup → schedule via Coming Soon → drop URL into X bio + next newsletter blast + DMs to early users → goal 100+ "notify me" before launch day.

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
- [ ] **X marketing — engage influencer reply targets** for 2 weeks before mentioning ok2eat (account list drafted in chat history). Pre-launch quiet-engagement plan was partly bypassed by the v1.16 launch announcement going live 2026-05-09. Continue weekly: 5-10 thoughtful replies to food-waste / family-cooking / ADHD-cooking voices per week from @ok2eat. Tracking lift via PostHog UTM=x_organic.
- [x] 2026-05-12 — **Demo videos shipped** (originally captured 2026-04-27). Trupeer-recorded full demo processed via ffmpeg into 4 deliverables: 60s launch reel on ok2eat.com homepage, 886×1920 App Store Preview .mov uploaded to v1.17 listing, full-length + receipt-scan demo on @ok2eat YouTube channel with SRT captions, social-format vertical cuts in the queue for IG Reel + carousel cross-post (see task #129).
- [ ] **Swap Walmart out of the reorder picker entirely** (Inbox 2026-04-27, narrowed 2026-05-12). Instacart 1st was already done; Walmart links don't earn commission and Walmart's spot is occupying real estate. Replace with another approved retailer (Amazon Fresh? Direct-affiliate partner if any approve before reapply?) or drop to 2-tile picker. Decide once we have a Misfits affiliate approval — Misfits could slot here for the food-waste-aware audience.

### 🔜 Soon — next 1–2 weeks (continued)

- [x] 2026-05-09 — **App Store Connect listing screenshots refresh shipped with v1.16.** Listing now leads with "ok2eat tells you what to eat first — before it goes bad." 5 fresh screenshots staged through Simulator showing Eat Me First tab, Fridge with real data, AddModal multi-tile, Dashboard, recipe sheet. ASO keywords refreshed for the reposition.

- [ ] **Push notification infrastructure audit** (captured 2026-05-01, partly addressed). v1.16 enabled the D1 retention push successfully, validating the push-token write path end-to-end. Still un-audited: (a) re-permissioning behavior after a user revokes + re-grants notifications, (b) token rotation on iOS reinstalls, (c) RLS scope of Edge Function reads, (d) what happens when a token goes stale (delivery silently fails). Lower priority now that D1 push has real data, but worth a half-day before building "notify household on shared-list edit" (planned for v1.18).

- [ ] **Subscribe to Misfits Market + start the 3-month review post** (captured 2026-05-01). Two-track action: (1) sign up and use Misfits for a real 3-month period, tracking actual cost/waste data in a spreadsheet so the eventual blog post (Track 2 #3 in the blog rotation) has authentic numbers; (2) apply to the Misfits affiliate program in parallel — they have one independent of Impact. Misfits' food-waste-reduction angle is the strongest editorial fit on our affiliate target list, and a published 3-month review gives us a real portfolio piece for that application. This is the action item underneath the broader "Direct-affiliate programs to pursue" entry.

- [ ] **Lawyer-review the privacy policy** — current policy on ok2eat.com (updated 2026-04-27) is conservative best-practice DIY: covers CCPA, GDPR, subprocessors, user rights, data retention. Friend Michael flagged that for real coverage we need an actual privacy lawyer. Priority lifts when (a) we cross ~500 users, (b) we open EU/UK distribution in App Store Connect, or (c) we begin any fundraising. Estimated cost: $500-1,500 one-time review, ongoing $0 unless major changes.

- [ ] **Shelf-life directory expansion — target 5,000 items** (captured 2026-05-13 after v1.19 ship-decision). `ok2eat.com/shelf-life/` currently has 660 per-item pages built from USDA FoodKeeper (`data/foodkeeper.json` → `scripts/build_shelf_life_pages.py` → `shelf-life/{slug}.html`, same data also loaded into the Supabase `foodkeeper_shelf_life` table that the iOS + web add flows query via `lookupShelfLife()`). Every SEO post we ship grows long-tail organic traffic — 660 is the floor, not the ceiling. Goal: ~5,000 items.

  **Hard constraint — NEVER contradict existing FoodKeeper data.** FoodKeeper is authoritative for everything it covers. New sources only add items FoodKeeper doesn't have. Where two new sources disagree, take the conservative (shorter shelf-life) value and cite both. Every new row needs a `sources[]` array in the data model so we can show provenance on the page + audit later.

  **Candidate sources, ranked by trustworthiness:**

  *Tier 1 — US federal / authoritative (use directly, will require minimal sanity-check):*
    - **FSIS fact sheets** (fsis.usda.gov/food-safety) — meat, poultry, eggs, prepared foods. Heavily overlaps FoodKeeper but adds depth on prep-style variations.
    - **FDA Refrigerator & Freezer Storage Chart** — covers some items FoodKeeper doesn't (e.g. specific deli prepared foods).
    - **USDA Complete Guide to Home Canning** (nchfp.uga.edu) — shelf-stable home-canned goods. Different category entirely from FoodKeeper.
    - **CDC food safety guidance pages** — supplementary for specific high-risk items.

  *Tier 2 — Land-Grant University Cooperative Extension Services (peer-reviewed, government-funded, public bulletins):*
    - **National Center for Home Food Preservation** (UGA, nchfp.uga.edu) — extensive preservation database.
    - **Penn State Extension food safety** (extension.psu.edu)
    - **Clemson HGIC food safety**
    - **UMaine Cooperative Extension** — strong on specialty/regional items
    - **NC State Extension** — Southern foodways
    - **Cornell Cooperative Extension** — dairy + produce depth
    - **UMass Extension** — produce focus
    - **University of Nebraska–Lincoln Food Safety**

  *Tier 3 — International public agencies (lower priority; useful for items absent from US sources, especially ethnic/regional ingredients):*
    - **Government of Canada — CFIA** (canada.ca/en/health-canada/services/food-nutrition)
    - **NHS UK food safety**
    - **EU EFSA storage guidance**

  *Skip:* StillTasty (commercial, not redistributable), EatByDate (not authoritative).

  **Approach (not implementation — capture only):**
    1. **Source-by-source extraction.** For each Tier 1+2 source, write a Python script (`scripts/ingest_<source>.py`) that pulls structured shelf-life data into a normalized intermediate JSON: `{ name, slug, category, container ("fridge"|"pantry"|"freezer"), days_unopened, days_opened, source: { name, url, fetched_at } }`. Most Tier 1+2 sources publish in HTML tables — BeautifulSoup is enough. Some publish PDFs — extract via `pdfplumber`. Tier 3 international sources may need Claude to parse non-English source pages.
    2. **Dedup against FoodKeeper.** For every candidate `name+slug`, check the existing `foodkeeper.json`. If present → DROP the candidate (FoodKeeper wins). Maintain a normalization map so "Whole Wheat Bread" and "Bread, whole wheat" dedupe.
    3. **Conflict resolution between new sources.** When two non-FoodKeeper sources cover the same item with different numbers, take the conservative value (shorter) and store both in `sources[]` for audit.
    4. **Volume math.** FoodKeeper 660 → add ~150 from FSIS/FDA → ~3,000 from Extension services (heavy dedup → maybe 2,000 unique) → ~500 international/specialty. Realistic landing: 3,500–4,500. 5,000 is aspirational; if we land at 4,000 we still 6x the directory.
    5. **Per-item page regeneration.** `build_shelf_life_pages.py` is data-driven; just point it at the expanded JSON. Sitemap autogen already handles new URLs.
    6. **Supabase reload.** `foodkeeper_shelf_life` table needs the new rows so the iOS + web `lookupShelfLife()` lookups also benefit. Schema may need a `source_name` column added (migration). Migration must remain idempotent.
    7. **Quality gate.** Spot-check 50 random items end-to-end (page renders, JSON-LD valid, lookupShelfLife returns the expected number). Submit refreshed sitemap to Google Search Console.

  **Risks to track:**
    - **Copyright on Extension bulletins.** Facts (shelf-life numbers) aren't copyrightable, but their prose explanations are. We'll generate original page copy from the data — never copy-paste from sources. Cite each source with a link, which Extension services typically welcome since they want their bulletins discovered.
    - **Stale data.** Extension service bulletins go years between updates. Stamp every row with `fetched_at` so we can re-sweep in 2027 and refresh.
    - **TOS / rate limiting.** Throttle ingestion (1 req/sec per source) + respect robots.txt. If a source rejects scraping, request a data dump directly (many Extension services will share spreadsheets on email request).
    - **SEO dilution.** 5,000 pages is a lot — Google may not crawl them all without authority signals. Submit sitemap in batches (500 URLs/day) to avoid trigger crawl-budget penalties.

  Touches: `data/foodkeeper.json` (or rename to `data/shelf_life.json`), `scripts/build_shelf_life_pages.py`, `scripts/ingest_*.py` (new, one per source), `supabase/migrations/` (add source columns + reload rows), `shelf-life/*.html` (regen), `sitemap.xml`. Estimated effort: 2–3 weeks split across ingestion-script writing + curation review. Defer until v1.19 ships and Product Hunt launch (2026-05-30) is in flight — the SEO compounding from a 5,000-item directory pays back over months, not weeks.

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
- [x] 2026-05-04 — **(originally v1.15) OFF barcode lookup absorbed into v1.14 ship** (captured 2026-05-01, scoped 2026-05-02). `App.js` `lookupBarcode` and `searchProducts` now route through `lib/openFoodFacts.js`: 4s/6s timeout, User-Agent header, empirically tuned category patterns, brand fallback, image_url, and relevance guard on text search. Shipped earlier than planned because the lib was already ready and the ship cycle had room.

- [x] 2026-05-04 — **(originally v1.16) Local product catalog + AddModal type-ahead absorbed into v1.14 ship** (captured 2026-05-02). 855K-row `searchable_products` catalog populated from OFF, `pg_trgm` + tsvector indexes, `search_products(query, result_limit)` RPC, AddModal type-ahead with 300ms debounce. Phase 1 fully shipped. Phase 2/3/4 (semantic + LLM layers) still on backlog as v1.17/v1.18 below.

- [ ] **v1.18 candidate ship — "make weeknight dinner one tap" mega** (re-scoped 2026-05-12 from prior v1.15/v1.16/v1.17 entries; some pieces already shipped under different version banners — see Done). Three retention-leverage features that share infra:
  - **🔥 Smart Cook Night** (killer feature #1 per Reddit research, ~2-3 days) — daily 6pm push: "Make X tonight using what you have. Need Y? Tap to order." Picks ONE recipe from current inventory + ONE missing ingredient + one-tap reorder. The moat: ok2eat is the only app with inventory + recipes + reorder in one stack. Implementation: scheduled push at user-configured time (default 6pm local), Edge Function picks recipe via Anthropic weighted by Eat-Me-First expiry, surfaces in Plan tab with "Order missing ingredient" CTA. Reuses v1.16's recipe enhancements + dietary filter. Research: `docs/reddit-research-2026-05-04.md`.
  - **Pending items status** (~1 day) — `pending` / `active` / `used` enum on `fridge_items`. After "Order N items" or "Reorder," items go to a "Pending" tray. User taps "Mark received" when groceries arrive — that's when the expiry clock starts. Closes "I ordered milk yesterday, when does my fridge know?" gap.
  - **Notify household on shared-list edit** (~1 day) — push to all household members when a shared list is created or edited. Uses v1.16's hardened push infra (verify push-token audit first per task above). Activates the social-loop value of shared lists.
  - **Recipe favorites** (~half day) — `user_recipes_saved` table, heart icon on cards, "Saved Recipes" section in Plan tab. Small, easy retention win — reduces friction of "I liked that one yesterday, where did it go?"

- [ ] **v1.19 candidate ship — SMS Group Fridge** *(killer feature #2 per Reddit research, ~3-5 days)*. Text the household fridge from any phone: "do we have eggs?" → reply with answer. "add 2 gallons milk" → updates. "what's expiring this week" → list. Twilio SMS + Anthropic Claude routes the NL query against `fridge_items`. **Moat:** highly shareable, works without the app, includes non-iPhone family members. **Cost:** Twilio ~$0.0079 per SMS → ~$1.20/user/month at 5 msg/day; gate behind paid tier or limit free-tier to 30 msg/month/household. Build after Smart Cook Night proves the inventory+recipe+action thesis.

- [ ] **Semantic search layer (pgvector embeddings)** *(formerly v1.18, deferred)* (captured 2026-05-02). Adds smart search behind v1.14's keyword foundation. Pre-compute embeddings via `text-embedding-3-small` → pgvector → `search_products_semantic(query_embedding)`. Hybrid: pg_trgm first, fall through to semantic. Handles typos ("tostitoes"), abbreviations ("tj's"), brand aliases ("Coke" → "Coca-Cola"). Effort: 1-2 days. **Depends on usage data showing the keyword layer is missing real queries.** Per Reddit research, semantic search wasn't a top user pain — rebuild only if no-results telemetry justifies it.

- [ ] **LLM query expansion + autocomplete polish** *(formerly v1.19, deferred)*. Final layer: when keyword + semantic both miss, ask Claude Haiku to expand/rewrite the query, then re-search. Plus prefix-match autocomplete + personal-vocabulary boosting. Effort: 1 day. Depends on semantic search being live.

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

- [x] 2026-05-19 — **v1.25 (CODE COMPLETE, ready to bump app.json + EAS submit).** "Photo of items + onboarding gate" mega across all three clients. Backend: new `scan-items` Edge Function (vision prompt for grocery photos, 5/day rate limit via shared `_shared/rate_limit.ts`); `search_products` RPC timeout fix (`OR sp.name % q.raw_q` was forcing 855K-row Seq Scan → dropped trigram OR, added FK-confident short-circuit; cheddar cheese went 3,390ms→457ms); new `user_settings.onboarding_4_items_unlocked_at` column with backfill for existing users. iOS+Android (App.js): `parseItemsImage` + `handleScanItems` mirror the receipt-scan plumbing (resize via expo-image-manipulator, rotating loading copy, typed errorType→actionable Alert routing, cancel_stage telemetry); Snap Items as 4th tile in AddItemModal 2x2 grid with chooser sheet (Take/Upload); BulkAddModal preset modes `scan-items-camera`/`scan-items-library`; tile emoji refinements (🏷️ Scan Barcode, 📷 Snap Items "Watch the magic happen", 📝 "Bulk Add"); onboarding gate `gateUnlocked` state + user_settings load + auto-unlock on 4th item; nav bar greys non-Fridge/Settings tabs when locked + floating accent banner above nav. Web: `ScanItemsModal.jsx` cloned from ScanReceiptModal with items-specific copy; "Snap items 🥬" outline-style button in Fridge.jsx header; `useOnboardingGate` hook + Layout.jsx grey-outs Eat Me First/Plan/Dashboard NavLinks + floating banner. Also in: Android update-prompt skip on Platform.OS==="android" (was sending Android users to iOS App Store); Android nav padding 36→48 (Samsung gesture handle clearance); version-in-Settings on all three (iOS via expo-constants, web via Vite `__APP_VERSION__` build-time replace reading app.json); Fridge UI cleanup (dropped Heads-up banner duplicate of EXPIRING SOON card, dropped "CONTENTS" label, moved Select inline with sort chip); barcode-screen "Search Food Database" switched from flaky Open Food Facts API → Supabase `search_products` RPC primary (OFF as fallback). Migration `20260519_v125_onboarding_4_items_gate.sql` applied live via SQL Editor; `supabase functions deploy scan-items` deployed. Ready for bump → eas build → submit.

- [x] 2026-05-18/19 — **v1.24 (CODE COMPLETE, rolled into v1.25 ship).** Receipt-scan UX overhaul targeting the 50% mid-flow cancel rate + 12.5% hard-fail rate revealed by PostHog recon (`receipt_scan_started=40, cancelled=20, scanned=12, failed=5, no_items=0` over 30 days). Edge Function: typed `error_type` responses (image_too_large / anthropic_transient / anthropic_permanent / bad_model_output / daily_limit / rate_limit_check) + JSON-extraction retry-once with stricter prompt. iOS+Android: new `resizeReceiptForUpload(uri)` helper via expo-image-manipulator (1600px max, JPEG q=0.7) shrinks 12MP iPhone shots from ~3-4MB → 500-800KB; rotating `scanPhase` loading copy ("Reading your receipt…" → "Identifying items…" → "Almost there…") with "Usually takes 4-6 seconds. Don't close the app." subtitle; typed errorType routes to actionable Alert (network slow / try clearer photo / unique-to-cohort) instead of generic "scan failed"; `cancel_stage` telemetry on receipt_scan_cancelled. Web ScanReceiptModal.jsx: same upgrades — Canvas-based resize, MAX_FILE_BYTES bumped 4.5MB → 12MB (since we resize), rotating scanPhase, trackedClose wrapping with cancel_stage. Recon-as-action path validated: would NOT have shipped these if we hadn't pulled the funnel first. Original "tighten the prompt" v1.24 plan was misdirected.

- [x] 2026-05-18 — **v1.23 SUBMITTED to App Store + Google Play (Apple in review, Google internal-testing review).** Password-reset polish + Android catch-up. Auth: `handleForgotPassword` calls `supabase.auth.resetPasswordForEmail` with `redirectTo: app.ok2eat.com/reset-password`; iOS + Android Forgot password? link below Sign In button in login mode; new web `/reset-password` route + `ResetPassword.jsx` component listens for PASSWORD_RECOVERY auth event, exchanges token, sets new password, signs out → fresh sign-in. Supabase email template branded (cream/green Georgia serif, founder signoff); sender swapped `noreply@ok2eat.com` → `hello@ok2eat.com` to clear Gmail's "dangerous mail" classifier. Android nav-bar paddingBottom 24→36 (Samsung gesture handle overlap). Marketing site: mobile hamburger drawer (Lucky Beard-style), hero polish + feature-card screenshots #3/#4/#5, subtitle rewrite (avocado-led "Together, let's reduce food waste"), hero GIF recording handed off to Greg locally (Chrome MCP tab-group bug), "Try the demo" CTA removed from hero, founder signoff "— Greg" → "— Greg, founder". Stripped all "free" pricing references across 980+ shelf-life pages + 8 blog posts + onboarding emails + JSON-LD offers block. Web household share RPCs: fixed `create_household_invite` (added missing `p_household_id`) + `redeem_household_invite` (was `invite_code`, should be `p_code`); split error states so create-errors don't leak to redeem screen. New web `ManageInventoryModal.jsx` mirrors iOS. Mobile web Settings access via gear icon (Greg flagged: overflow-scroll nav pushed Settings off-screen on mobile). A11y + perf + mobile audit pass on ok2eat.html. v1.24+ inventory-capture roadmap evaluated (4 ideas). 6.5" App Store screenshots generated locally (1242x2688 PNGs in `marketing/app_store_screenshots/6_5_inch/`) — Greg uploads via App Store Connect → v1.23 → Previews and Screenshots before "Add for Review" so search-preview tiles render for sub-6.9" iPhone users.

- [x] 2026-05-17 — **v1.22.1 hotfix LIVE.** Search hotfix (natural-language + dedupe by generic). `search_products` rewrites:
  - Token-order independence: "swiss cheese" now matches "Cheese, swiss" via tokens-in-haystack scoring (rank 700 - length penalty); was trigram-only at ~161 before, now hits the right row directly.
  - DISTINCT ON `lower(name)` deduplicates result variety so users see cheddar/swiss/parmesan/gouda instead of 5 variants of "Cheese, swiss".
  - Same function signature + return shape → all three clients (iOS, Android, web) picked it up on apply with zero code changes.

- [x] 2026-05-17 — **v1.22 LIVE — 17 features + 5 hotfixes + marketing sprint.** Cross-platform polish + inventory expansion + universal share. Highlights:
  - **Universal share button** for ephemeral + bank recipes (iOS + Android + web).
  - **"Cooked" status** on fridge_items for leftovers/batch-cooked dishes.
  - **Dashboard "At Risk Now" card** + expiring banner now clickable.
  - **Sort options** on Fridge tab (by expiry date / added / longest / A→Z).
  - **Pre-generated filters** in EatMeFirst (cuisine, protein, ingredient count).
  - **Duplicate item rows** collapsed by name or surface brand.
  - **Pizza shown as "15 count"** fixed — quantity unit handling.
  - **FoodKeeper as primary search source** (generic-first) — was: OFF noise drowning the curated USDA data. Now: FK rank 100-1000 always beats OFF rank 0-5.
  - **Item detail Use/Order/Toss action row** + waste tracking.
  - **Transfer items between containers** (fridge → freezer).
  - 5 hotfixes: duplicate iMessage preview, repeated upgrade popup, Remove button hardcoded to "Fridge", cheddar→milk emoji bug, FoodKeeper expansion to 1,250 perishables (25% of 5K goal).
  - Marketing sprint: site audit + blog + Lucky Beard-style quiz CTA shipped + social posts + value-prop quiz copy + privacy-policy refresh + demo screenshots inline.

- [x] 2026-05-15 — **v1.21 LIVE in Google Play closed testing.** Android version shipped. Same Expo project produces iOS + Android builds from a single App.js; Android-specific shims kept inline (`Platform.OS === "android"` blocks for status bar insets, system camera vs in-app camera, FCM nuances). Phase 2: FCM credentials wired for Android push, dev-client rebuilt, end-to-end push test delivered to Pixel 9 emulator. Also: Save heart on EatMeFirst recipe detail, Add-to-list discoverability on EatMeFirst cards (more inviting CTAs), fix matched ingredients can't be queued to shopping list, item search relevance for "milk" / "whole milk", cancel/back on Scan Barcode camera, chooser before Scan Receipt camera (Take photo / Upload). App-version push notify when new App Store version drops. Fix Android status bar overlap on stack screens. Deploy `generate-recipes` with v1.21 emoji guidance. EAS Transporter manual-upload workaround for free-tier queue (v1.19 Apple submit).

- [x] 2026-05-14 — **v1.20 LIVE.** Demo route + Android Chrome polish. **`/demo` no-auth route on app.ok2eat.com** — anyone can land here and tour the product before signup (target: Reddit / X / PH cold traffic). Demo gates at save/share (build freely, paywall when committing). Demo-launch reel + social drafts + PostHog dashboard setup driven via Chrome MCP. Onboarding emails brand-voice refresh + feature-drift fix. Hotfixes: Android Chrome horizontal scroll on homepage + fridge (Bryan Leboff report), Chrome iOS pinch-zoom + auto-hide nav bars, mobile name truncation on EatMeFirst rows, Demo expiry dates rolling forward (showed everything expired on day 2+). Animated tutorial reel v2 storyboard. Power-users + audience report script. Marketing-site PostHog fix (was syntactically broken since v1.16). v1.19 Apple-approval marketing site bump shipped same day.

- [x] 2026-05-13/14 — **v1.19 LIVE — Recipe Browser + Inventory Match mega.** 10-day sprint:
  - **Day 1**: `recipe_bank` schema (matches DailyRecipe interface shape) + publisher research script.
  - **Day 2**: 238 recipes generated via Claude + loaded into recipe_bank.
  - **Days 3-8**: `recipe-browse` Edge Function (paginated, filterable) + `match-recipe-inventory` Edge Function + match cache table.
  - **Days 9-10**: Plan tab Recipes section + InventoryMatchSheet UI on iOS.
  - **UX passes 1-4**: inline match in RecipeSheet + Saved Recipes always visible; invert tap default + in-stock cards + add-all bulk + Saved-as-tab + merge Browse+Search; cuisine-first flow + saved crash + lists refresh; editable list name + auto-navigate to new list.
  - **Polish**: smart emoji inference for Fridge tab (fixes generic 🥬 on Produce / 🍗 on Protein); receipt-scan demo video + per-user lookup limit + EatFirst recipe redesign.
  - **Site refresh**: replaced stale fridge mockup + rethought homepage messaging.
  - **Hotfix**: `fridge_items.status` column doesn't exist (v1.18 silent bug too).
  - **CLAUDE.md** persistent project conventions doc landed for future Claude sessions.

- [x] 2026-05-13 — **v1.18 LIVE — Daily digest mega + Smart Cook Night.** Killer-feature #1 from Reddit research shipped:
  - **Native recipes in daily digest** — replaced external-site buttons. Recipes render as cards inside the digest email; tap routes to Universal Link → in-app recipe sheet.
  - **Shared `daily_recipes` helper module** in `supabase/functions/_shared/` unblocked digest + Smart Cook Night sharing recipe-gen logic.
  - **Send daily digest to all users** — removed the "must have inventory" gate (was suppressing first-day digests for new signups).
  - **Migration**: `expiring_within_days` default 3 → 7 (more items show in EXPIRING SOON for new users).
  - **iOS recipe deep-link handler + sheet** — `ok2eat.com/recipes/{id}` opens app to the recipe.
  - **Smart Cook Night daily 6pm push** — picks ONE recipe from current inventory + ONE missing ingredient + one-tap reorder. The moat: ok2eat is the only app with inventory + recipes + reorder in one stack.
  - **Saved Recipes section in Plan tab** + heart icon on cards.
  - **Removed external recipe-search links** from Plan tab (in-app recipes are the source of truth now).
  - **Notify household on shared-list edit** — push to all household members.

- [x] 2026-05-12 → 2026-05-19 — **Infra + non-version work shipped across this period:**
  - **B2B waitlist** — `business_waitlist` table + `subscribe-business-waitlist` Edge Function + `/for-business` landing form. Daily lead-digest email to greg@ok2eat.com via `send-business-waitlist-digest` Edge Function + pg_cron at 16:30 UTC (9:30am PT) with spam-heuristic flagging.
  - **Honeypot + 3s time-trap captcha** on `/for-business` form (silent-reject pattern: bot signals → return 200 OK so they don't iterate on bypass).
  - **Same captcha pattern extended to web signup** (`AuthScreen.jsx`). Bot Gmail-dot-trick signups were degrading hello@ok2eat.com sender reputation, which was pushing real users' confirm emails into spam.
  - **Welcome-email deliverability test via mail-tester.com — perfect 10/10**. SpamAssassin "likes you", SPF/DKIM/DMARC all green, no blacklist hits. Diagnosis: content + auth + DNS are clean; sender reputation is the actual concern (addressed via captcha killing bot sends at source).
  - **Netlify SSL outage diagnosed** on app.ok2eat.com: DNS correctly pointing to ok2eat-app.netlify.app, Netlify's cert-provisioning service tripped by their origin-services incident. Not a config issue. Auto-resolved post-incident.
  - **Android tester management** — added ginsengginnie@gmail.com, hello@ok2eat.com, miles.c.06@gmail.com to Play Console internal testers via Chrome MCP.
  - **Search timeout fix** — `search_products` was hitting PostgREST's 3s anon-role statement timeout for queries like "cheddar cheese". Fixed in v1.25 (FK short-circuit + FTS-only SP filter). 3,390ms → 457ms.
  - **Daily PostHog report enhancements** — app-version distribution tracker now in the daily metrics email.
  - **v1.18 cron paused/restored** 5/14-5/15 to prevent duplicate sends during deploy window.

- [x] 2026-05-12 — **v1.17 APPROVED + LIVE** (originally submitted build #24, EAS submission `6d06c917-6464-4297-a73e-086659239445`; Apple-approved within a couple days, in production through v1.18+ wave). Polish + activation-fix ship:
  - **AddModal restructure** — Add a List promoted to peer of Scan Barcode / Scan Receipt (was buried lower); Fridge/Pantry/Freezer chip picker on manual-add drives FoodKeeper window per container; routes new item to the right section.
  - **Recipe sheet UX** — X button top-right + tap-outside backdrop close. No more feeling trapped.
  - **Universal Links** — `applinks:ok2eat.com` wired; AASA at `https://ok2eat.com/.well-known/apple-app-site-association`; ok2eat URLs from Mail/Messages/X open the app to the right screen.
  - **Auth flow** — post-signup lands on "Check your email" screen with Resend Confirmation button (was an Alert that bounced to Sign In); login error for unconfirmed email surfaces inline Resend button. Both call `supabase.auth.resend({ type: 'signup', email })`. Targets the 63%-never-confirm gap.
  - **Onboarding email sequence** — D0/D2/D5/D10 via Supabase Edge Function (`send-onboarding-emails`) + pg_cron at :15 hourly. Behavioral triggers: `quick_start` (signup + no first item, 60d window) and `try_receipt_scan` (manual-add user who hasn't tried receipt scan).
  - **Auto-create user_settings** — auth.users INSERT trigger + 40-user backfill so email-digest defaults apply universally.
  - **DNS hardening** — root SPF added, DMARC upgraded `p=none` → `p=quarantine` on Namecheap. Targets Gmail-side deliverability.
  - **Marketing email aesthetic** — daily-digest styling (`🥑 ok2eat` Georgia header, cream `#F0EADC` background, dark `#1C261C` CTA buttons, DM Mono eyebrows) applied across all 6 onboarding + behavioral templates.

- [x] 2026-05-09 — **v1.16 APPROVED + LIVE — strategic reposition mega-ship.** Six weeks of work shipped in coordinated release. Headline UX move: ok2eat answers "what should I eat first, before it goes bad?"
  - **🔥 Eat Me First tab** — new top-level nav. Priority-sorted by days-until-expiry. Tap any item → 3 recipe suggestions using it + a few others you already have.
  - **📊 Dashboard tab** — new top-level nav. $-saved, lbs-rescued, CO₂ avoided. Week-over-week trends. Cold-start uses aspirational framing ("avg household saves $1,866/yr — yours so far: $X").
  - **Nav consolidation** — final tab set: Fridge / Eat Me First / Plan / Dashboard / Settings. Scan moved to global FAB on every screen. Reminders / Share / HowTo moved into Settings (HowTo → "?" icon on Fridge header).
  - **Dietary preferences** — vegetarian / vegan / gluten-free / dairy-free / nut-free + allergens list on user_profile. `generate-recipes` Edge Function filters.
  - **Household size + portion scaling** — `household_size` integer on user_profile; recipe ingredient quantities scale by N.
  - **Recipe enhancements** — `generate-recipes` uses N most-expiring items together (not one at a time), dietary filter applied.
  - **Container labels on receipt upload** — per-row fridge/pantry/freezer pill in BulkAddModal review with category-aware defaults. iOS + web parity.
  - **D1 retention push enabled** — built in v1.15 (task #56), production-fired in v1.16.
  - **Multi-add bug fix** — receipt-scan tile inside AddModal correctly auto-launches camera.
  - **App Store listing refresh** — title/subtitle/screenshots/description lead with "what to eat first — before it goes bad." ASO keywords refreshed.
  - **Marketing engine launch** — Trupeer demo processed via ffmpeg into 4 deliverables (homepage launch reel, 886×1920 App Store Preview .mov, @ok2eat YouTube channel with 2 captioned videos, social cuts queued). X launch announcement posted. Resend marketing blast to subscribers. Blog post "What to eat first" moved to production with tightened "we" voice (~250 words vs. original ~580).

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
