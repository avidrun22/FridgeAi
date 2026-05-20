# v1.25 — Release Notes

Paste the body of "App Store version notes" into App Store Connect →
this version → "What's New in This Version". Paste Google Play version
notes into the Play Console release page. The reviewer-notes blocks go
into the "Notes" / "Reviewer instructions" fields.

v1.25 is the biggest user-visible release since v1.22 — bundles the
photo-of-items vision flow, the 4-item onboarding gate, receipt-scan
UX overhaul (technically v1.24 code, rolled in to skip a release),
search reliability fix, and Android-specific bug fixes. Notable as a
"foundational inventory" release: every change makes it easier to get
items into the fridge or makes the search/scan flows more reliable.

---

## App Store version notes (iOS users see this)

What's new in v1.25:

• **Snap a photo of your groceries.** New "Snap Items" tile on the Add
  screen. Point your camera at items spread on the counter (or pick a
  saved photo) — we identify each one and pre-fill your fridge in
  seconds. 5 photos per day.

• **Receipt scans are faster and more forgiving.** Photos shrink
  automatically before upload — much faster on cellular, and big
  photos no longer fail. New friendlier loading messages tell you
  what's happening (no more silent spinner). Errors finally explain
  themselves: "Connection slow — try again" vs "Try a clearer photo"
  instead of one vague message.

• **Manual search returns results reliably.** Fixed the bug where
  "cheddar cheese" (and other common queries) sometimes returned
  nothing. ~7x faster too.

• **Your version + cleaner fridge view.** App version now shows at the
  bottom of Settings (helpful for support requests). Fridge view drops
  the duplicate "Heads up" banner and tightens the layout.

Quiet polish under the hood: tile icons + labels updated, better
emoji on the new flows, more breathing room above the system gesture
handle on newer iPhones.

Reply to any of our emails with anything broken or confusing — read
same day. — Greg, founder

---

## Google Play version notes (Android users see this)

What's new in v1.25:

• **Snap a photo of your groceries.** New "Snap Items" tile on the Add
  screen. Point your camera at items spread on the counter (or pick a
  saved photo) — we identify each one and pre-fill your fridge in
  seconds. 5 photos per day.

• **Receipt scans are faster and more forgiving.** Photos shrink
  automatically before upload — much faster on cellular, and big
  photos no longer fail. Errors now explain themselves clearly.

• **Manual search returns results reliably.** Fixed the bug where
  "cheddar cheese" sometimes returned nothing.

• **Update prompt fixed for Android.** Android users were being told
  to update via the iOS App Store — that's gone. Auto-update via Play
  Store handles it from here.

• **Bottom nav bar no longer hugs the gesture handle** on Pixel 9 +
  Samsung S-series devices.

• **App version + cleaner fridge view.** Version now shows at the
  bottom of Settings. Fridge view drops the duplicate "Heads up"
  banner.

Reply to any of our emails with anything broken or confusing — read
same day. — Greg, founder

---

## App Store Connect — internal release notes (App Review team)

For Apple's reviewers, in the "Notes" field on the version page:

```
v1.25 — Photo of items vision flow + receipt-scan reliability
improvements + onboarding gate + UI polish.

No new permissions vs v1.23. The new "Snap Items" flow uses the
existing Camera + Photo Library permissions that already power the
Scan Receipt flow (same NSCameraUsageDescription +
NSPhotoLibraryUsageDescription strings, unchanged). No new external
APIs, no new account types, no new data collection.

To verify the new Snap Items flow:

1. Sign in with the demo email in App Review credentials.
2. From the Fridge tab, tap "+ Add Item".
3. On the Add Item screen, tap "Snap Items" (4th tile, bottom-left).
4. Choose "Take Photo" or "Upload from Photos".
5. For Upload: pick any food photo (groceries on a counter, fridge
   interior, etc.). For Take Photo: camera opens normally.
6. Items are identified by Claude vision in 4-6 seconds, then a review
   screen pre-fills with each item where you can edit before
   committing.

Daily limit: 5 photo-scans/day per user (5/day for Snap Items,
separate from the existing 10/day for Scan Receipt). Rate-limiting
is server-side via Supabase.

Onboarding gate: brand-new users (and any existing user with an
empty fridge) see Eat Me First / Plan / Dashboard tabs greyed out
until they add 4+ items. Fridge + Settings always tappable. This
prevents the empty-state experience that was dropping new users
before they saw the value moment. To verify: sign in as the demo
user, delete inventory items if needed to get below 4, observe
greyed tabs + bottom banner; add items to cross 4 and watch tabs
unlock.

Other changes in this build are below the surface (search query
optimization, image-resize before upload, typed error responses,
PostHog telemetry refinements). No content or rating impact.
```

---

## Google Play — internal release notes (Play Console reviewers)

For Google Play's reviewers, in the "Release notes for reviewers"
field on the closed-testing or production track:

```
v1.25 — Photo-of-items vision flow + receipt UX overhaul + Android
update-prompt fix + onboarding gate + nav-padding fix.

Changes since v1.23 (Play Console's last reviewed version):

1. NEW: "Snap Items" tile on the Add Item screen. Camera or photo-
   library picker → Claude vision identifies food items → user
   reviews/edits → bulk insert to fridge_items. Uses the existing
   CAMERA permission, no new permissions. 5 photos/day per user
   server-side limit.

2. Receipt scan UX overhaul (same flow, just better): photos are
   resized client-side before upload (faster on mobile data, fewer
   failures), loading copy rotates instead of showing a static
   spinner, errors are typed and explain themselves.

3. FIX: in-app update prompt was firing on Android users and sending
   them to the iOS App Store (the version check used iTunes Lookup
   which returns iOS data regardless of platform). Now skips entirely
   on Android. Play Store auto-update handles upgrades from here.

4. FIX: bottom navigation bar bottom-padding bumped from 36px → 48px
   on Android only. Greg's Samsung Galaxy screenshot showed the
   gesture handle still riding against the tab labels at 36px;
   48px gives proper clearance on Pixel 9 (gesture-nav inset ~30px)
   and Samsung S-series.

5. NEW: onboarding gate for users with empty fridge. Eat Me First /
   Plan / Dashboard tabs disabled with greyed-out icons + floating
   banner until 4+ items are added. Settings stays accessible.
   Unlocks permanently once threshold crossed; never re-locks if
   user deletes items later.

6. UX polish: version number shown in Settings footer (useful for
   support requests), Fridge tab "Heads up!" banner removed
   (was duplicated with the stats card above), Select button moved
   inline with the sort chip.

No new permissions, no new external APIs, no Data Safety section
changes. Same auth, same data access pattern as v1.23.

To verify Snap Items: sign in, tap + Add Item, tap "Snap Items"
(4th tile), pick any food photo from device gallery. Review screen
populates with identified items, user commits to fridge.
```

---

## Promotional text (optional, 170 char limit)

For the App Store's separately-editable promotional text field
(does NOT require an Apple review when changed):

```
Snap a photo of your groceries — we identify every item and fill
your fridge in seconds. Receipt scans now faster + more reliable.
```

(149 chars)

---

## Brand voice checklist (from CLAUDE.md)

- ✅ Benefit-led ("Snap a photo of your groceries" not "Added a vision API for item identification")
- ✅ Second-person ("Point your camera", "we identify", "your fridge")
- ✅ Em-dashes preserved
- ✅ Closes with "Reply to any of our emails… — Greg, founder" signoff
- ✅ No buzzwords ("revolutionary", "industry-leading", "AI-powered")
- ✅ No emoji-stuffed bullets
- ✅ Specific where helpful (Pixel 9 + Samsung S-series, 5 photos per day, 4-6 second wait time, "cheddar cheese" example) over vague claims

---

## Post-approval ritual (per CLAUDE.md)

Once Apple approves v1.25 and it goes live in the App Store:

1. Update `ok2eat.html` hero badge:
   `<div class="hero-badge">v1.25 · iOS + web</div>`

2. Update `ok2eat.html` JSON-LD `softwareVersion` to `"1.25"`

3. Deploy the marketing site:
   `python3 scripts/deploy_website.py`

DO NOT bump the hero badge or JSON-LD before approval — the badge
must always reflect what's actually live in the App Store, not what's
pending. Visitors who tap "Download on the App Store" get whatever
Apple is serving.

If v1.23 has not yet been approved when v1.25 ships for review, the
marketing site stays on v1.22 (the last approved version). The badge
catches up when v1.25 is the new live version.

---

## What's in this build (for our reference, not the App Store)

Tasks closed in v1.25 (rolled-in v1.24 work in italics):

- #284 — Onboarding 4-item gate (iOS+Android+web with new
  `user_settings.onboarding_4_items_unlocked_at` column + backfill +
  fail-open default).
- #279/288/291 — Photo-of-items flow across all three platforms
  (Edge Function `scan-items` with 5/day rate limit, iOS+Android
  Snap Items tile in AddItemModal with chooser bottom sheet, web
  `ScanItemsModal.jsx` + Fridge.jsx button).
- #285 — Android update-prompt skip (was sending Android users to
  iOS App Store via iTunes Lookup).
- #286 — Android nav padding 36 → 48 (Samsung S-series gesture
  handle overlap).
- #287 — Version-in-Settings across iOS+Android+web (one source of
  truth: app.json read via expo-constants on mobile, Vite
  build-time __APP_VERSION__ replace on web).
- #289 — Fridge UI cleanup: dropped "Heads up!" banner duplicate,
  dropped "CONTENTS · TAP TO VIEW DETAILS" label, moved Select
  inline with sort chip.
- #290/275 — Search Food Database switched from flaky OFF API to
  Supabase `search_products` RPC primary (OFF as fallback). Cheddar
  cheese search timeout fix in the RPC itself: dropped `OR
  sp.name % q.raw_q` from SP WHERE (was forcing 855K-row Seq Scan),
  added FK-confident short-circuit. 3,390ms → 457ms.
- *#278 — Receipt-scan UX overhaul (v1.24 code, rolled into v1.25).
  Edge Function typed error_type responses + JSON retry-once;
  client-side resize via expo-image-manipulator (1600px max, JPEG
  q=0.7); rotating loading copy ("Reading your receipt…" →
  "Identifying items…" → "Almost there…"); typed errorType →
  actionable Alert routing; cancel_stage telemetry. Web
  ScanReceiptModal: Canvas-based resize, MAX_FILE_BYTES 4.5MB →
  12MB (since we now resize), same rotating copy + trackedClose
  with cancel_stage.*

Supabase config that v1.25 depends on:

- Migration `20260519_v125_onboarding_4_items_gate.sql` applied live
  via SQL Editor (adds `onboarding_4_items_unlocked_at timestamptz`
  to `user_settings`, backfills existing users with 4+ items).
- Migration `20260518_v123_search_timeout_fix.sql` applied (search
  function rewrite — already live, predates v1.25 cohort).
- Edge Function `scan-items` deployed (`supabase functions deploy
  scan-items`).
- `expo-image-manipulator` added to package.json + dev client
  rebuilt locally before EAS production build.
