# v1.16 cross-post handoff

X is done (manual post). Use this doc to drive the rest of the cross-posts.

---

## Updated copy line (apply everywhere)

The v1_16_announcement.md doc uses:
> "Dinner uses what's about to go bad, not what you'd have to buy."

That's been replaced with:
> "We optimize your dinner menu by what needs to be eaten first."

Apply this swap in any caption you ship today.

---

## IG carousel (Day 0 — same hour as X)

**Assets to upload** (in order, all in `marketing/app_store_screenshots/`):

1. `01_eat_me_first.png`
2. `02_recipe_modal.png`
3. `03_dashboard.png`
4. `04_receipt_scan.png`
5. `05_settings.png`
6. `06_dual_date.png`

**Caption (paste as-is — already has the new "optimize" line):**

```
ok2eat 1.16 just shipped, and it's the biggest update since launch.

Open the new Eat Me First tab and your fridge is already sorted: the chicken expires tomorrow, the spinach has two days, the cilantro is gone. Tap any item and you get three recipe ideas — using that item plus the four next-most-urgent things alongside it. So we optimize your dinner menu by what needs to be eaten first.

What else is new:

• Impact Dashboard — money saved, pounds rescued, CO₂ avoided. Live numbers.
• Recipes that respect your diet — vegetarian, vegan, gluten-free, dairy-free, plus the major allergens. Set once.
• USDA-backed expiry — printed date AND the FoodKeeper window, so you stop trashing yogurt that's fine.
• Smarter receipt scanning — bread to pantry, ice cream to freezer, no manual sorting.

Free on iPhone + web. Link in bio.

—

#foodwaste #grocery #mealplanning #household #budgeting #lifehack #sustainableliving #fridgeorganization #appupdate #ios
```

**Posting path:** Meta Business Suite → Create post → IG + FB → drag in all 6 PNGs in numbered order → paste caption → Schedule for now (or pick a Tuesday/Thursday 9am PT window).

---

## IG Story + Reel (Day +1)

**Story sticker (poll):**

> Which item dies first in your fridge?
>
> · Leafy greens
> · Bread
> · Leftovers
> · Berries

Polls boost reach 2-3x on IG. Use the avocado logo (`assets/icon-fb-profile.png`) as the background.

**Reel (15-30s):**

The captioned demo video is already a Reel-perfect 9:16 vertical with captions baked in. Just upload:

`~/Downloads/v116_video/v116_demo_with_captions.mp4`

Use this caption:

```
What to eat first, before it goes bad. ok2eat 1.16 — the new Eat Me First tab ranks your fridge by urgency and suggests three recipes for whatever's closest to spoiling. Free → ok2eat.com

#foodwaste #fridgeorganization #mealplanning #appdemo
```

---

## Pinterest (Day 0)

The launch plan calls for a new pin: **Pin 04 — Eat Me First** at 1000×1500.

**Status:** Not built yet. The HTML/PNG generation pipeline lives at `marketing/app_store_screenshots/render.sh`. Skip Pinterest today; ping me to generate `pin_04_eat_me_first.png` whenever you want to add it. It'll keep working for months regardless of post timing — Pinterest is long-tail.

---

## Email blast (Day 0, after homepage deploy)

**From:** Greg from ok2eat <hello@ok2eat.com>
**Reply-to:** support@ok2eat.com
**Subject:** *"ok2eat 1.16 — finally, an answer to 'what should we cook?'"*

**Body — apply the same copy swap on the highlighted line:**

```
Quick one — ok2eat 1.16 just shipped. Three real changes worth opening for.

1) The new Eat Me First tab.

This is the headline. Your fridge is now sorted by urgency the moment you open the tab — the thing closest to going bad sits at the top. Tap any item and you get three recipe ideas that use it plus the four next-most-urgent things alongside it. So we optimize your dinner menu by what needs to be eaten first.

If you've been opening the app and then closing it, this is the tab to open instead.

2) Recipes that respect your diet.

Tell ok2eat once whether you're vegetarian, vegan, gluten-free, dairy-free, etc., and any allergies (peanut, tree nut, shellfish, fish, egg, milk, soy, wheat, sesame). Every recipe respects them from then on. They also scale to your household size — no more dividing by four.

3) A live impact dashboard.

Open the new Dashboard tab and see what your fridge tracking has actually been worth: money saved, pounds of food rescued, CO₂ avoided. Live numbers, not guesses. The average US household throws out $1,866 of food a year — yours doesn't have to.

Plus: USDA-backed dual-date display so you stop tossing yogurt that's fine. Smarter receipt scanning that puts bread in the pantry and ice cream in the freezer automatically. A cleaner 5-tab layout (Fridge / Eat First / Plan / Dashboard / Settings). And a fix for the receipt-scan camera not launching from the Add menu.

Update is rolling out via the App Store automatically. If you don't see it yet, tap your profile picture in the App Store → Available Updates.

Reply to this email with anything broken, anything missing, anything you wish worked differently. Read same day.

— Greg
```

**Send via:** Resend → existing subscriber list. Resend at +14 days to non-openers with subject *"What to eat first, before it goes bad"*.

---

## Skipped this launch

- **Reddit** — explicit decision in v1_16_announcement.md
- **LinkedIn** — explicit decision in v1_16_announcement.md
- **Product Hunt** — separate launch beat, targeting May 16-23

---

## Other open items

1. **ok2eat.com homepage** — staged changes (video embed) need `python3 scripts/deploy_website.py` or `/deploy` via Telegram. Sandbox can't reach the Netlify API.
2. **App Store Connect App Preview** — manual drag-drop the `.mov` onto the iPhone 6.9" Display section in Media Manager. Sandbox can't trigger Apple's custom upload UI.

Both deferred to you.
