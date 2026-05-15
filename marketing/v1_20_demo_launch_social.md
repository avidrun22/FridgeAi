# v1.20 — Free demo launch (cross-post handoff)

Demo URL: **https://app.ok2eat.com/demo**

Tone calibration locked in 2026-05-14 (see `.appstoreconnect/marketing_strategy/brand_context.md`):
- Broader hook than the product category ("Most apps" not "Most fridge apps").
- Benefit cascade in one sentence — three verbs, reader as subject.
- One playful informalism per piece ("automagically").
- Punchy close: "Free @ app.ok2eat.com/demo" on its own line.

---

## X / Twitter — 4-tweet thread (drop into Typefully)

**Tweet 1**

```
Most apps make you sign up before they show you anything.
We flipped it. Tap a link, see your fridge ranked by what spoils first, create dynamic recipes based on the contents, and automagically create a shopping list for the rest.
60-second demo. Free @ app.ok2eat.com/demo
```

**Tweet 2 (reply)**

```
Five real items pre-loaded so you can see the ranking work:

🌿 Cilantro — expired
🐟 Salmon fillet — expires tomorrow
🥬 Baby spinach — 2 days
🥛 Whole milk — 3 days
🥩 Ground beef — 4 days

Tap any one. Get three recipes that use it before it dies.
```

**Tweet 3 (reply)**

```
Tap an item open and you see what we track per row:

· Quantity + unit (5 oz, 1 lb)
· Category, container (fridge / pantry / freezer)
· Added + expiry dates
· Sealed vs opened — opened milk recalculates its window

That's the data behind every urgency rank and recipe.
```

**Tweet 4 (reply)**

```
Type "kale" in the demo. Watch it slot into the ranking by the time you finish reading this sentence.

When you want it real — receipt scan, save your fridge between sessions, share with your household — sign up free.

Free @ app.ok2eat.com/demo
```

---

## LinkedIn — single post

```
Most apps make you sign up before they show you anything.

We flipped it for ok2eat — the fridge-tracking app I've been shipping solo for 6 months. Tap a link, see a fridge ranked by what spoils first, create dynamic recipes from what's there, and automagically build a shopping list for the rest. No account.

The problem this fixes: cold visitors hit the auth wall before they ever see the product. Conversion from the homepage was lower than it should have been.

Three signals I'm watching this week:
- Time-on-demo (does the value land in 60 seconds?)
- Add-by-hand → signup (cheapest signal someone "got it")
- Recipe-modal → signup (highest-intent moment)

If you've ever built a landing page and wondered whether the auth wall is killing you, this is the answer in one experiment.

Free @ app.ok2eat.com/demo
```

---

## Instagram — single post (+2h after X)

**Image:** screenshot of `app.ok2eat.com/demo` on mobile (post-stacking-fix). Optional sticker overlay: "FREE — NO SIGNUP →" in green pill.

**Caption**

```
Most apps make you sign up before they show you anything.

We flipped it.

Tap the link, see a fridge already ranked by what spoils first, create dynamic recipes from what's there, and automagically build a shopping list for the rest.

Cilantro expired. Salmon tomorrow. Spinach two days. Tap any one — three recipes use it before it dies. Type "kale" yourself, watch it slot into the ranking.

60 seconds. No account.

Link in bio → app.ok2eat.com/demo

—

#foodwaste #grocery #mealplanning #budgeting #fridgeorganization #lifehack #sustainableliving #household #cookingathome #appdemo
```

**Linktree / bio swap:** point to `app.ok2eat.com/demo` for 7 days.

---

## Facebook — single post (+4-6h after IG)

```
Most apps make you sign up before they show you anything.

We flipped it. Tap a link, see a fridge ranked by what spoils first, create dynamic recipes from what's there, and automagically build a shopping list for the rest. No account, no card.

Free @ app.ok2eat.com/demo
```

---

## Reddit — reply template (organic threads only)

Don't seed threads. Wait for r/Frugal, r/MealPrepSunday, r/foodhacks, r/EatCheapAndHealthy posts about throwing away groceries or asking for fridge-organization apps.

```
I build a small iOS + web app for exactly this — ok2eat. It ranks your fridge by what spoils first, suggests recipes that use the most urgent stuff together, and automagically builds a shopping list for what you're missing.

You can see the whole flow without an account — there's a demo with a pre-loaded fridge at app.ok2eat.com/demo. Takes 60 seconds. Free when you do sign up, no ads.

Reply to the welcome email with anything broken or confusing — I read same day. — Greg
```

---

## Hacker News — Show HN (Tue/Wed AM Pacific)

**Title**

```
Show HN: A fridge-tracking app you can try without signing up
```

**Body**

```
I've been shipping ok2eat solo for 6 months — iOS + web fridge tracker that ranks items by what spoils first, suggests recipes that use the most urgent ones together, and automagically builds a shopping list for what you're missing.

Same problem most SaaS landings have: auth wall before the demo. Rebuilt the entry point this week. app.ok2eat.com/demo loads a fake fridge with 5 items, lets you tap into recipes, lets you add your own item by hand. The conversion gates (scan receipt, save recipe, add to shopping list) are still there — but the parts that demonstrate value are free.

What I'd love feedback on:
- Does the value land in 60 seconds?
- Are the conversion gates positioned right, or do they feel forced?
- Anything broken on mobile?

Demo: app.ok2eat.com/demo
iOS: apps.apple.com/us/app/ok2eat/id6761730687

Built with React Native + Expo + Supabase + Anthropic Claude (recipe gen). No subscription, no ads.
```

---

## Email blast — to subscribers (optional, pending deliverability check)

Subject options:
- `Tap a link, see your fridge ranked — no signup`
- `60 seconds. Free @ app.ok2eat.com/demo`
- `The no-account tour of ok2eat`

**Body**

```
Hi —

Most apps make you sign up before they show you anything. We flipped that for ok2eat — there's now a demo you can send anyone, no account needed.

Tap app.ok2eat.com/demo and you'll see a pre-loaded fridge ranked by what spoils first, three recipes per item, and the same shopping-list flow that real users get. You can even add an item by hand and watch it slot into the ranking.

If you've got a friend who's been on the fence about trying ok2eat, this is the link to send them.

Reply to this email with anything broken or confusing — read same day.

— Greg
```

---

## Posting cadence

- **Hour 0 (now):** X thread (Typefully or manual), LinkedIn post.
- **+2h:** Instagram (screenshot + caption).
- **+4-6h:** Facebook page.
- **Day 1 morning:** Email blast (skip if deliverability still spotty).
- **Day 1-3:** Reddit replies on organic threads only — don't seed.
- **Tue/Wed AM Pacific (Day 5-7):** Hacker News Show HN.

Demo URL is the same everywhere (no UTM) so PostHog's `outbound_web_app_click` + `homepage_demo_click` events stay clean — referrer alone tells the channel story.
