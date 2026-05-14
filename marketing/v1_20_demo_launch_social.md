# v1.20 — Free demo launch (cross-post handoff)

Demo URL: **https://app.ok2eat.com/demo**

The pitch in one line: "Try ok2eat with a pre-loaded fridge — no signup, see what to cook before it spoils, 60 seconds."

What the demo actually does:
- Fake fridge with 5 items at varying urgencies (Cilantro expired, Salmon 2d, Spinach 3d, Milk 4d, Beef 5d)
- Tap any item → full details (qty, unit, category, container, expiry)
- Tap "Get recipes" → real-looking recipe cards using the most urgent items
- "Add by hand" → really adds an item to the demo state (no signup, no API)
- "Scan a receipt" + "Add to shopping list" + "Save recipe" → signup prompts (the conversion points)

---

## X / Twitter — 4-tweet thread (paste into Typefully)

**Tweet 1 (hook):**

```
Most fridge apps make you sign up before they show you anything.

We flipped it. Tap a link, see your fridge ranked by what spoils first, see tonight's recipe before the cilantro dies.

60-second demo, no account: app.ok2eat.com/demo
```

**Tweet 2 (what you see):**

```
Five real items loaded:

🌿 Cilantro — expired
🐟 Salmon fillet — expires tomorrow
🥬 Baby spinach — 2 days
🥛 Whole milk — 3 days
🥩 Ground beef — 4 days

Tap any one — three recipes that use it before it dies.
```

**Tweet 3 (depth):**

```
Tap an item for the detail card and you see what we actually track per row:

· Quantity + unit (5 oz, 1 lb)
· Category (Produce, Protein, Dairy)
· Container (fridge, pantry, freezer)
· Added date + expiry date
· Sealed vs opened — opened milk recalculates

This is the data behind the urgency ranking.
```

**Tweet 4 (close):**

```
You can add an item by hand in the demo — type "kale," watch it slot into the ranking.

When you're ready to scan a real receipt or save your fridge between sessions, sign up free.

app.ok2eat.com/demo
```

---

## LinkedIn — single post

```
Built a no-signup demo of ok2eat this week.

Background: ok2eat is a fridge-tracking app I've been shipping solo for 6 months. The pitch is simple — your fridge knows what's expiring, so it should tell you what to cook before things go bad. iOS + web, free, no subscription.

The problem: cold visitors hit the auth wall before seeing the product. Conversion from homepage was lower than it should have been.

So I rebuilt the entry point. Now anyone can visit app.ok2eat.com/demo, see a pre-loaded fridge with 5 items at varying urgencies, tap any one to get three recipes that use it, and add their own items by hand — no account required.

Three things I'm watching:
- Time-on-demo (PostHog event-stream)
- Add-by-hand → signup conversion (the cheapest possible signal that someone "got it")
- Recipe-modal → signup conversion (the highest-intent moment)

If you've ever built a SaaS landing and wondered whether the auth wall is killing you, this is the answer in one experiment.

Demo: app.ok2eat.com/demo
```

---

## Instagram — single post (caption + image direction)

**Image direction:** Screenshot of the demo on mobile showing the 5-item ranked list with the green "Sign up to start cooking" header CTA visible. Add a sticker-style overlay: "TRY IT — NO SIGNUP →"

**Caption:**

```
Most fridge apps gate the good stuff behind a signup screen.

Ok2eat doesn't anymore.

Tap the link, see five items pre-loaded in a fake fridge — cilantro expired, salmon tomorrow, spinach 2 days, milk 3 days, beef 4 days. Tap any one to see three recipes that use it before it spoils.

Want to try adding your own? Type "kale" in the demo — it slots right into the ranking.

60 seconds. No account needed.

Link in bio → app.ok2eat.com/demo

—

#foodwaste #grocery #mealplanning #budgeting #fridgeorganization #lifehack #sustainableliving #household #cookingathome #appdemo
```

---

## Facebook — single post

```
Just shipped a no-signup demo of ok2eat — the app that ranks your fridge by what's about to spoil and tells you what to cook tonight.

Tap the link, see a pre-loaded fridge with 5 real items at different urgencies, get recipes that use the ones about to die. Add an item by hand to see how it slots into the ranking. All without making an account.

Takes about a minute. Free when you do sign up.

→ app.ok2eat.com/demo
```

---

## Reddit reply template (for r/Frugal, r/MealPrepSunday, r/foodhacks threads about waste)

Use this when someone's complaining about throwing away groceries or asking for fridge-organization apps. Don't lead with the demo link — answer their question first, then mention.

```
I built a small iOS + web app for exactly this — ok2eat. It ranks your fridge by what's about to spoil and gives you 3 recipes that use the most urgent items together.

If you want to see how it works without signing up, there's a demo at app.ok2eat.com/demo — pre-loaded fridge, takes 60 seconds. Free when you do sign up, no ads.

Reply to the welcome email with anything broken or confusing — I read same-day. — Greg
```

---

## Hacker News — "Show HN" post (if you want to risk it)

**Title:** `Show HN: A fridge-tracking app you can try without signing up`

**Body:**

```
I've been shipping ok2eat solo for 6 months — iOS + web fridge tracker that ranks items by what spoils first and suggests recipes that use the most urgent items together.

Same problem most SaaS landings have: auth wall before the demo. I rebuilt the entry point this week. app.ok2eat.com/demo loads a fake fridge with 5 items, lets you tap into recipes, lets you add your own item by hand. The conversion gates (scan receipt, save recipe, add to shopping list) are still there — but the parts that demonstrate value are free.

What I'd love feedback on:
- Does the value land in 60 seconds?
- Are the conversion gates positioned right, or do they feel forced?
- Anything broken on mobile?

Demo: app.ok2eat.com/demo
iOS: apps.apple.com/us/app/ok2eat/id6761730687

Built with React Native + Expo + Supabase + Anthropic Claude (recipe gen). No subscription, no ads.
```

---

## Email blast (optional — to existing subscribers)

Subject options:
- "Try the new demo — no signup required"
- "Five fake items, sixty seconds"
- "ok2eat's first no-account tour"

```
Hi —

If you've ever wanted to show ok2eat to someone but they wanted to see it before signing up, you can now point them at app.ok2eat.com/demo.

It's a pre-loaded fridge with 5 items at different urgencies. They can tap into recipes, tap into item details, and even add their own items by hand — no account.

It's also the new "Open the web app" link on the homepage. New visitors land in the demo first, see how it works, then sign up.

If you've got a friend who's been on the fence, this is the link to send them.

Reply to this email with anything broken or confusing — read same day.

— Greg
```

---

## Post timing recommendation

Stagger across 24 hours, not all at once:

- **Hour 0 (now):** X thread (Typefully schedule), LinkedIn (post live)
- **Hour 2:** Instagram (single image + caption)
- **Hour 6:** Facebook page
- **Day 1 morning:** Email blast to subscribers
- **Day 1-3:** Reddit replies — wait for organic context (don't seed threads)
- **Day 3+ (optional):** Hacker News Show HN, ideally Tuesday/Wednesday morning Pacific

The demo URL gets the same UTM-free format everywhere so PostHog's `outbound_web_app_click` + `homepage_demo_click` events stay clean — referrer alone tells the channel story.
