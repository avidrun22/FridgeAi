# v1.21 — Release Notes

Paste the body of "App Store version notes" into App Store Connect →
this version → "What's New in This Version". The character limit is
~4000 chars; the v1.21 draft below is well under.

---

## App Store version notes

What's new in v1.21:

• Share a shopping list. Tap Share on any list in the Plan tab and
  send the link to whoever's heading to the store — they can open
  it in a browser, no sign-up needed.

• Share a recipe. The recipe sheet now has a Share button next to
  the heart. Send tonight's recipe to the person doing the cooking.

• Cleaner expiry copy. Items that expire today now read "Use today"
  instead of "Expired" — they're still safe to cook with, and that's
  the whole point.

Reply to any of our emails with anything broken or confusing — read
same day. — Greg

---

## App Store Connect — internal release notes (App Review team)

For Apple's reviewers, in the "Notes" field on the version page:

```
v1.21 — Sharable shopping lists and recipes.

No new permissions, no new account types. Same auth + same data
access pattern as v1.20. To verify the sharing flow:

1. Sign in with the existing demo account (provided in App Review
   credentials field).
2. Plan tab → tap any shopping list → "Share" pill next to the list
   name → the system share sheet appears with a https://ok2eat.com/lists?t=...
   link. Anyone with the link can view; only the household members
   can edit.
3. Recipe sheet (tap "Eat me first" → any item → "Get recipes" → tap
   a recipe card) → Share button left of the heart icon → system share
   sheet with a https://ok2eat.com/recipes/{slug} link.

Both links resolve to public landing pages on ok2eat.com with no
authentication, by design — the goal is that the recipient can view
without installing the app.
```

---

## Promotional text (optional, 170 char limit)

```
Share your shopping list with whoever's heading to the store —
no sign-up needed. Same for tonight's recipe.
```

---

## Brand voice checklist (from CLAUDE.md)

- ✅ Benefit-led ("Share a shopping list" not "Sharable shopping lists")
- ✅ Second-person ("Tap Share", "Send tonight's recipe")
- ✅ Em-dashes preserved
- ✅ Closes with "Reply to any of our emails… — Greg" signoff
- ✅ No buzzwords ("revolutionary", "game-changing")
- ✅ No emoji-stuffed bullets

---

## Post-approval ritual (per CLAUDE.md)

Once Apple approves v1.21 and it goes live in the App Store:

1. Update `ok2eat.html` hero badge: `<div class="hero-badge">v1.21 · iOS + web</div>`
   (currently around line 1094).

2. Update `ok2eat.html` JSON-LD `softwareVersion` to `"1.21"`
   (currently around line 978).

3. Deploy the marketing site: `python3 scripts/deploy_website.py`.

DO NOT bump the hero badge or JSON-LD before approval — the badge
must always reflect what's actually live in the App Store, not what's
pending. Visitors who tap "Download on the App Store" get whatever
Apple is serving.
