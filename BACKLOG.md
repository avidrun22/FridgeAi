# ok2eat backlog

Capture, triage, ship. Two ways to add items:

1. **Edit this file directly** when you're at the computer — drop items into any section, reorder, prune.
2. **Telegram `/idea <your idea>`** when you're away — appends to Inbox below with today's date.

Read it back from anywhere with **`/backlog`** (or open the file).

> Convention: `[ ]` = open, `[x]` = done. Date prefix is when the item was captured. Strike through items as you ship by moving them to **Done**.

Last reviewed: 2026-04-28

---

## 🎯 In progress

- [ ] **Build & upload v1.0.7 to App Store Connect** — bundles friend-feedback fixes (LIVE badge, OUT button, demo data, font scaling, NUTRI), editable expiry stepper, open/closed expiry feature, email-button URL fix, Walmart→Instacart swap. Build 8. Run new SQL migration first (`20260427_v107_open_closed_expiry.sql`), then `npx expo prebuild --clean`, then archive in Xcode, upload, submit.

- [ ] **Ship v1.0.8 — shared household inventory** — feature-complete in dev build as of 2026-04-28. App.js wired to the new schema (`households`, `household_members`, `household_invites`, `fridge_items.container`, `user_settings.has_seen_household_onboarding`). New components: `OnboardingModal` (2-step name + container), `ManageInventoryModal` (containers + members + invite CTA), `InviteHouseholdModal` (6-char code generate / share / redeem with destructive confirmation). `ShareScreen` restructured (Spread the word + Your household). `PlanScreen` replaces `RecipesScreen` for the Plan tab — recipe-search links (AllRecipes / NYT Cooking / Epicurious) + manual shopping list in AsyncStorage + "Order N items" CTA that opens the existing `RETAILERS` picker (Amazon / Target / Instacart) with the unchecked items as a single search query — preserves affiliate tags. Bottom nav now Fridge / Alerts / Plan / Share. `dbAddItem` writes `household_id` + `container`, mirrors `section` for v1.0.7-client back-compat; `rowToItem` prefers `container`. Three migrations live (20260428_v108_shared_households.sql, 20260428_v108_containers_and_onboarding.sql, 20260428_v108_member_list_and_container_backfill.sql). **Next:** commit, bump to v1.0.8 in app.json + APP_VERSION, then archive + upload to App Store after v1.0.7 finishes review.

---

## 📥 Inbox

> Items captured via Telegram `/idea` land here. Triage into the sections below when you've got time.


---

- [ ] 2026-04-27 — screen record demo to upload to socials and website

- [ ] 2026-04-27 — add instacart reorder in place of Walmart

- [ ] 2026-04-27 — push privacy policy on website to a separate page

## 📋 Triaged

### 🔜 Soon — next 1–2 weeks

- [ ] **Set up Impact affiliate accounts for Target + Instacart** — earnings on Target and Instacart reorder clicks are currently $0 because their tracking IDs are placeholders. Sign up at [impact.com](https://impact.com) as an affiliate partner (free, ~3-7 days approval). Apply to **Instacart** and **Target** programs from the marketplace. Once approved, replace the placeholder query params in `App.js` `RETAILERS` array (search "RETAILERS" — three rows). Track all commissions in one Impact dashboard. Amazon stays separate via Amazon Associates (already live, tag `ok2eat-20`).
- [ ] **Decide on website hosting strategy by May 7** — Netlify charges 15 credits per deploy on the free tier (300/month = ~20 deploys/month). Today's heavy deploy day burned 50% of monthly budget. Three options:
  - **A) Batch deploys** (free, discipline) — queue 3–5 changes per deploy instead of one-tweak-per-deploy
  - **B) Migrate to Cloudflare Pages** (free, ~30 min one-time) — no per-deploy cost; update DNS A record at Namecheap; rewrite `deploy_website.py` against Cloudflare API
  - **C) Netlify Pro at $19/mo** — 1,000 credits = ~66 deploys/month
  - Decision point: May 7 (when April–May cycle resets). Default to **A** until then. If usage projections are high, lean **B** for indie-friendly economics.
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
- [ ] **🥈 Desktop version of ok2eat** — second priority. Web-based or native desktop app for managing the fridge from a computer. Decision needed: Electron vs PWA vs Tauri vs pure web. Likely the path of least resistance is a responsive web app served from ok2eat.com using the existing Supabase backend.
- [ ] **🥉 Android version of ok2eat** — third priority. Same Expo project should produce an Android build with minimal changes, but the Apple-specific bits (Apple Sign In, App Store affiliate tags) need fallbacks. Then Play Store listing, screenshots, and review.
- [ ] **Recipe-link UX** — instead of AI-generated recipes in email digest, link out to AllRecipes / NYT Cooking / Epicurious search URLs based on user's inventory (cost-saver vs Anthropic per-user calls)
- [ ] **In-app recipe browsing** — see recipe details inside ok2eat instead of jumping to external sites
- [ ] **Recipe favorites + saving** — save recipes user likes for quick re-access
- [ ] **Receipt-scan accuracy** — improve OCR for low-light, faded, or crumpled receipts
- [ ] **SMS digest via Twilio** — alternative delivery channel for users who don't check email or push
- [ ] **Item-photo capture** — optional photo per item so users can visually confirm what's in the fridge

### 🛸 Maybe — someday

- [ ] Integration with Instacart / Whole Foods for low-inventory reorder
- [ ] Barcode→recipe shortcut from iOS Home Screen widget
- [ ] Receipt-history view (past grocery runs as a timeline)

---

## ✅ Done

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
