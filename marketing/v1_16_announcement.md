# v1.16 launch announcement copy

**Status:** Draft. Hold until App Store Connect status flips from "Waiting for Review" → "Ready for Sale" on build #23. Realistic window: 24–48 hours from submission (2026-05-11 16:00 PT).

**Don't fire anything in this doc until two things are true:**

1. App Store Connect shows v1.16 (build 23) as `Ready for Sale`.
2. `python scripts/deploy_website.py` has run so the refreshed homepage at `ok2eat.com` matches the reposition. (Currently held — commit is on `main`, Netlify hasn't deployed.)

When both are true, the **same hour** push the homepage + fire the X post + send the email. Cross-platform consistency matters more than absolute timing.

---

## The storyline (lead with this, not features)

v1.13 told a "shopping list got dramatically better" story. v1.16 is the strategic reposition — every channel should lead with the same hook:

> **You open the fridge. You don't know what to cook. You order takeout. ok2eat fixes that by telling you what to eat first — before it goes bad.**

The supporting features (Eat Me First tab, Dashboard, dietary + household scaling, USDA dual-date) get mentioned, but in service of that one hook. The temptation will be to list features. Resist it. The product is the *answer to a question*, not a feature checklist.

**One emoji per post max** (matching `social_originals/writing_principles.md`). No hashtag walls in the body — separate line at the bottom, or skip on X entirely.

---

## X / Twitter (`@ok2eatapp`)

### Variant A — straight reposition (recommended for first post)

```
ok2eat 1.16 just shipped. Big one.

The new Eat Me First tab ranks your fridge by urgency — the thing closest to spoiling sits at the top. Tap any item, get three recipes that use it plus the four next-most-urgent things alongside it.

Dinner uses what's about to go bad, not what you'd have to buy.

Free → ok2eat.com
```

**Why this works:** opens with verb + version, the second paragraph IS the new feature in plain language, the third paragraph is the customer benefit in the customer's own words. No emoji. No hashtags. Fits in one screen on the X timeline.

279 chars (well under 280). Ship as a single post — splitting into a thread weakens the impact for this kind of "headline" announcement.

### Variant B — problem hook (use as Day +2 follow-up)

```
Real moment from yesterday: opened the fridge, stared at it, closed it, ordered takeout.

The thing closest to going bad was the chicken I bought three days ago.

ok2eat 1.16 (out today) just tells you what to eat first. Then it suggests three recipes for it.

Free → ok2eat.com
```

**Why this works:** narrative hook draws in scrollers, "real moment" framing reads as founder voice (more trustable than ad copy). Use 24–48 hrs after Variant A so it doesn't compete.

### Variant C — reply/quote (use under any food-waste thread)

```
ok2eat shipped 1.16 today with a new "Eat Me First" tab that ranks your fridge by urgency and suggests recipes for whatever's about to spoil. Free on iPhone + web → ok2eat.com
```

Short enough to use as a reply. No emoji, no hashtags — replies that read like ad copy get downranked. Keep it conversational.

### Variant D — the data hook (Day +5, if first wave has traction)

```
~30% of food bought in the US gets thrown away. The hard part isn't motivation — it's *knowing what to eat first*.

ok2eat 1.16 ranks your fridge by urgency so dinner uses what's about to spoil, not what you'd have to buy.

Backed by USDA FoodKeeper data — 660 foods, sourced.

Free → ok2eat.com
```

**Why this works:** specific stat anchors the post in research (ReFED 2024 is the canonical source if anyone asks), then pivots to product without listing features. USDA name is the trust mark.

---

## Instagram + Facebook (`@ok2eatapp`)

### Single image / carousel post

**Visual:** carousel of the same 6 screenshots we uploaded to App Store Connect, in the same 1→6 order. Reuse the PNGs from `marketing/app_store_screenshots/`. IG accepts 1290×2796 PNGs directly; FB will downscale automatically.

**Caption:**

```
ok2eat 1.16 just shipped, and it's the biggest update since launch.

Open the new Eat Me First tab and your fridge is already sorted: the chicken expires tomorrow, the spinach has two days, the cilantro is gone. Tap any item and you get three recipe ideas — using that item plus the four next-most-urgent things alongside it. So dinner uses what's about to go bad, not what you'd have to buy.

What else is new:

• Impact Dashboard — money saved, pounds rescued, CO₂ avoided. Live numbers.
• Recipes that respect your diet — vegetarian, vegan, gluten-free, dairy-free, plus the major allergens. Set once.
• USDA-backed expiry — printed date AND the FoodKeeper window, so you stop trashing yogurt that's fine.
• Smarter receipt scanning — bread to pantry, ice cream to freezer, no manual sorting.

Free on iPhone + web. Link in bio.

—

#foodwaste #grocery #mealplanning #household #budgeting #lifehack #sustainableliving #fridgeorganization #appupdate #ios
```

**Why this works:** problem-narrative first sentence, the new tab gets two full sentences before any bullet, then four crisp bullets for the supporting features. Hashtag block at the bottom (IG convention — mix high-volume `#foodwaste` with niche-specific `#fridgeorganization`).

### Story / Reel

**15-second reel idea (record on phone, no special tools needed):**

1. **0–2s:** open the fridge IRL, hold for a beat, close it. Caption overlay: *"What do we cook tonight?"*
2. **3–5s:** quick cut to the Eat Me First tab on phone screen. Caption: *"ok2eat just tells you."*
3. **6–10s:** tap a top-of-list item, the recipe sheet slides up. Caption: *"Three recipes per item — using what's about to spoil."*
4. **11–14s:** zoom to ok2eat.com URL.
5. **15s:** end frame with the same v1.16 promotional image we already have at `_v1_16_ig_image.png`.

**Story sticker prompt:** *"Which item dies first in your fridge?"* (poll: leafy greens / bread / leftovers / berries). Stickers boost reach 2-3x on IG.

---


## Pinterest (`@ok2eatapp`)

Pinterest is the longest-tail channel — pins keep driving traffic months and years later, so the v1.16 launch deserves one purpose-built pin alongside the existing always-on shelf-life pins (`pin_01_lasts_forever`, `pin_02_fridge_facts`, `pin_03_money_saver` already at `.appstoreconnect/marketing_strategy/week_1_content/pinterest_pins/`).

### New launch pin — "Pin 04 — Eat Me First"

**Dimensions:** 1000×1500 (standard 2:3 vertical). Reuse the cream/forest-green brand palette + Bricolage Grotesque + DM Mono.

**Visual concept:** split layout. Top 60%: a stylized fridge view with 6 items in priority-ranked order (#1 with red "Expired" badge at top, #6 with green "11 days" badge at bottom). Bottom 40%: the words "Open Eat Me First" in big serif, with a small "ok2eat.com" footer.

**Title (100 char):**
> The trick to never wasting food: open your fridge by urgency, not by shelf

**Description (500 char max — Pinterest search optimization matters here):**
```
The hardest part of cutting food waste isn't motivation, it's knowing what to use first. ok2eat 1.16 just shipped a new "Eat Me First" tab that ranks your fridge by urgency — the thing closest to spoiling sits at the top, and tapping any item gives you three recipes that use it plus the four next-most-urgent things alongside it. Backed by USDA FoodKeeper data. Free on iPhone + web at ok2eat.com.
```

**Hashtags (use, Pinterest is hashtag-friendly):**
`#foodwaste #grocery #mealplanning #fridgeorganization #budgeting #lifehack #sustainableliving #ios #appupdate #usdafoodkeeper`

**Board to pin to:** "ok2eat — App + updates" (or create "v1.16 launch" if you'd rather isolate the traffic for measurement).

**Destination URL:** `https://ok2eat.com/blog/what-to-eat-first.html` (the v1.16 blog post), not the App Store. Pinterest converts much better when the click lands on contentful pages, not on the App Store directly. The blog post then drives App Store traffic via its CTAs.

### How to generate the pin

Same pattern as the existing pins: write a `pin_04_eat_me_first.html` at 1000×1500 vertical, render via headless Chrome + Pillow (matching the App Store screenshot pipeline you already have at `marketing/app_store_screenshots/render.sh`), upload via Pinterest's web UI or your Typefully workflow.

I can draft the HTML for this pin if you want it ready — same brand styling as the App Store screenshots and the IG launch image.

### When to post

- **Day 0 (Apple flips Ready for Sale):** new Pin 04 goes live
- **Day +2, +5, +9:** re-pin to other relevant boards if you have them ("Food waste tips", "Budgeting hacks", etc.) — Pinterest rewards same-pin-on-different-boards if the boards are topically distinct
- **Ongoing:** the existing 3 shelf-life pins keep running; no change

### Why Pinterest gets less attention in the schedule

Pinterest doesn't need same-day amplification because pins compound over weeks. The Day 0 post is the one beat; everything after is just letting Pinterest's algorithm spread it. No "Day +2 second post" needed.

---

## Reddit + LinkedIn — SKIPPED for v1.16

Decided 2026-05-11: not active on Reddit or LinkedIn during this launch window. Channel attention stays on X, IG/FB, Pinterest, and the email blast. Reddit can be revisited if a relevant thread surfaces organically during the launch week — but no proactive posting.

---

## Email blast — existing subscriber list

**From:** Greg from ok2eat <hello@ok2eat.com>
**Reply-to:** support@ok2eat.com
**Subject (locked, 2026-05-11):** *"ok2eat 1.16 — finally, an answer to 'what should we cook?'"*
**Resend at +14 days (different subject, same body):** *"What to eat first, before it goes bad"*

**Body:**

```
Quick one — ok2eat 1.16 just shipped. Three real changes worth opening for.

1) The new Eat Me First tab.

This is the headline. Your fridge is now sorted by urgency the moment you open the tab — the thing closest to going bad sits at the top. Tap any item and you get three recipe ideas that use it plus the four next-most-urgent things alongside it. So dinner uses what's about to spoil, not what you'd have to buy.

If you've been opening the app and then closing it, this is the tab to open instead.

2) Recipes that respect your diet.

Tell ok2eat once whether you're vegetarian, vegan, gluten-free, dairy-free, etc., and any allergies (peanut, tree nut, shellfish, fish, egg, milk, soy, wheat, sesame). Every recipe respects them from then on. They also scale to your household size — no more dividing by four.

3) A live impact dashboard.

Open the new Dashboard tab and see what your fridge tracking has actually been worth: money saved, pounds of food rescued, CO₂ avoided. Live numbers, not guesses. The average US household throws out $1,866 of food a year — yours doesn't have to.

Plus: USDA-backed dual-date display so you stop tossing yogurt that's fine. Smarter receipt scanning that puts bread in the pantry and ice cream in the freezer automatically. A cleaner 5-tab layout (Fridge / Eat First / Plan / Dashboard / Settings). And a fix for the receipt-scan camera not launching from the Add menu.

Update is rolling out via the App Store automatically. If you don't see it yet, tap your profile picture in the App Store → Available Updates.

Reply to this email with anything broken, anything missing, anything you wish worked differently. Read same day.

— Greg

---

You're getting this because you signed up at ok2eat.com or downloaded the iOS app.
Unsubscribe: {{unsubscribe_url}}
```

**Why this works:** numbered three things (matching the v1.13 pattern), founder-voice closing, explicit "reply to me" invitation in the last paragraph. Subject line A leans into the brand question; subject line B leans into the new reposition — A/B test will tell us which the existing list prefers.

---

## Cross-post timing schedule

Don't fire all of this on Day 0. The carousel should breathe across a week:

**Day 0 (Apple flips status to Ready for Sale):**
- 8am PT: run `python scripts/deploy_website.py` so the new homepage + new blog post are live
- 9am PT: X Variant A (straight reposition)
- 9am PT: IG carousel (same 6 PNGs from `marketing/app_store_screenshots/`)
- 9am PT: Pin 04 — Eat Me First, destination URL = the v1.16 blog post
- 10am PT: email blast (after the homepage is live so any "see what's new" click lands on the new page)

**Day +1:**
- IG Story with the poll sticker
- Reel (see "Reel concepts" section below for what to shoot)
- *Don't post on X today* — let Variant A breathe

**Day +2:**
- X Variant B (problem hook)

**Day +5:**
- X Variant D (data hook with the 30% / 1,866 stats)
- Cross-post the Day +1 IG Reel to TikTok if available

**Day +7:**
- Pull DAU + signup numbers, log to BACKLOG / `EXPENSES.md` for impact tracking
- Pull email open / click rates from Resend
- Decide whether to layer paid acquisition (Meta or Google) based on Day-0 → Day-7 organic conversion

**Day +14:**
- Resend the Day-0 email blast to non-openers with subject line B ("What to eat first, before it goes bad")

---

## What NOT to do

- **No emoji stuffing.** One emoji max per post on X, two on IG. Never decorative. (See `social_originals/writing_principles.md`.)
- **No hashtag walls in the body.** IG/FB hashtags go on a separate line at the bottom. X gets none.
- **No "we" or "our team."** This is a solo product — first person ("I built", "I noticed") reads more honestly than corporate-speak.
- **No "AI"-prefixed feature names.** ok2eat uses AI under the hood for recipe generation and receipt OCR, but customers don't care about the tech — they care that the recipes are good. Lead with the outcome, not the model.
- **No founder full name in any post.** First name only ("Greg") or just no name at all. Per `brand_context.md` privacy rules.
- **No personal email in any post.** All contact through `@ok2eat.com` aliases (any one — they all forward).
- **No paid ad spend until v1.16 is `Ready for Sale`.** Anyone driven to the App Store from a paid ad before that lands on the v1.15 listing. Wasted spend.

---

## Press / Product Hunt (defer)

The `docs/producthunt-launch.md` doc has a target date of Saturday 2026-05-16. That date now depends on whether v1.16 is approved by then. If Apple approves before May 16, the PH launch is the next-best beat. If not, push PH to May 23.

PH launch is **not** included in the Day 0–7 schedule above — it's its own production with its own subscriber-build phase. Don't blur the two.

---

## Decisions locked (2026-05-11)

1. **Email subject:** A — *"ok2eat 1.16 — finally, an answer to 'what should we cook?'"*. Subject B becomes the +14 day resend to non-openers.
2. **Reddit + LinkedIn:** skipped entirely for this launch. Channel attention stays on X, IG/FB, and email.
3. **Reel:** to be shot Day 0 or Day +1 per the recommendations in `marketing/v1_16_reel_concepts.md`.

---

_Last updated 2026-05-11 by v1.16 launch prep. Touch nothing until App Store Connect shows Ready for Sale._
