# v1.22 social drafts — quiz funnel + launch

Two sets of posts:

1. **Quiz funnel** — promotes ok2eat.com/quiz. Use these as the primary
   ongoing rotation. The whole point is to capture what visitors say they
   want (PostHog tracks every answer). Posts that ask a question and
   funnel into a personalized answer outperform feature listicles.

2. **v1.22 launch** — what shipped this week. Drop these once Apple
   approves v1.22 and the marketing site has bumped the version pill.

All copy follows the brand voice rules from CLAUDE.md: benefit-led,
second-person, em-dashes OK, no buzzwords, no emoji-stuffed bullets.

---

## Set 1 — Quiz funnel

### X / Twitter

**Variant A — the bait:**

```
"What do we have to eat?" is the most-asked question in every household.

I built ok2eat to answer it. Take a 60-second quiz — we'll show you the
parts of the app that fit your goal (saving money, wasting less, cooking
from what you have).

ok2eat.com/quiz
```

**Variant B — the headline:**

```
Three questions. We'll show you how ok2eat helps with your actual goal.

→ Save money on groceries
→ Waste less food
→ Stop buying things you already had
→ Cook from what's in your fridge

Pick yours: ok2eat.com/quiz
```

**Variant C — the data hook:**

```
The average US household throws out about $1,500 of food a year.

I built ok2eat to close that gap. Curious which part fits you best?
60-second quiz → ok2eat.com/quiz
```

### Instagram caption (single image or carousel)

```
Three questions. We'll show you the parts of ok2eat that fit your
goal best —

🥕 Save money on groceries
🌱 Waste less food
🛒 Stop buying things you already had
🍳 Cook from what's already in your fridge

Take the 60-second quiz: link in bio → /quiz

(I'll never know more about why people use ok2eat than from the
answers. Tap your goal, see what the app actually does for it,
and we both learn something.)
```

Visual: phone mockup showing the quiz Step 1 — "What's your #1
frustration with food at home?" with the 4 options visible. Soft
cream background matching the brand palette.

### Facebook (longer, conversational)

```
Quick experiment.

I've been thinking about how everyone uses ok2eat for slightly
different reasons. Some people want to save money. Some are
trying to waste less. Some are sick of buying the third jar of
dijon mustard because they forgot what's already in the fridge.

Built a quick 3-question quiz that points you at the parts of the
app most useful for whichever of those is most you.

Take it here: ok2eat.com/quiz

(Bonus: every answer helps me see what people actually want, so
the next thing I build is the next-most-useful thing — not just
the thing I assume people want.)

— Greg
```

### LinkedIn (more thoughtful, founder narrative)

```
What's the most-asked question in your household?

Mine: "What do we have to eat?"

After years of staring into the fridge, closing it, and ordering
takeout, I built ok2eat to answer it. Free iOS app, also runs on
the web. Android in beta.

Some users open it to save money — they hate that 30% of groceries
end up in the trash. Others open it because food waste bothers them
on principle. Others just want to stop buying duplicate items.

So I made a 3-question quiz that figures out what you're actually
trying to fix, then shows you the parts of the app that do that
specific thing.

Try it: ok2eat.com/quiz

Bonus for me: every answer becomes a signal about what to build
next. Most-asked goal = next feature.
```

---

## Set 2 — v1.22 launch (ship after Apple approves)

### X / Twitter

**Lead with the headline finding:**

```
The thing that bothers me most about food apps: when they tell you
your wedge of parmesan is expiring tomorrow.

It lasts six months unopened.

ok2eat v1.22 — fixed shelf-life data on 1,900+ foods. Now cheddar,
salami, frozen veg, canned goods, and dried beans have actual ranges,
not the "all cheese = 14 days" lie.

Free on iOS + web.
```

**Thread starter (if Greg wants to chain the changes):**

```
We shipped ok2eat v1.22 this week. Three things that matter:

1/ 1,900+ foods now have per-item shelf life. Cheddar lasts 6
months, not 14 days. Salami is 2 years, not 3 days. Frozen
veg is 8-12 months. The defaults were lying to you about
every long-lasting food in the fridge.
```

```
2/ Search got smarter. Type "swiss cheese" and you get swiss
cheese. Used to require typing "Cheese, swiss" because USDA
stores names inverted. Fixed. Same for whole milk, chicken
breast, raw spinach — every natural-language query now works.
```

```
3/ "Save leftovers" — after you mark something as used, the
app asks if you cooked it. Tap Save → a 4-day-shelf "Cooked
…" row appears in your fridge. So Tuesday's chili shows up
in Eat Me First on Wednesday instead of getting forgotten.

ok2eat.com — free on iOS + web.
```

### Instagram caption

```
What shipped in ok2eat this week 🥑

1️⃣ 1,900+ foods now have accurate shelf life. Hard cheddar is
6 months unopened, not 14 days. Frozen vegetables are 8-12
months, not 5 days. The defaults were lying to you.

2️⃣ "Swiss cheese" finally works in search. (USDA stores names
inverted — "Cheese, swiss" — so the natural-language version
used to return nothing. Fixed across the board.)

3️⃣ Save your leftovers. After you mark something used, ok2eat
asks if there are leftovers — tap Save and a 4-day-shelf
"Cooked …" row joins the fridge.

Free on iOS and the web. Android in beta — link in bio.
```

Visual: 3-up carousel — slide 1 cheese shelf-life comparison
(was 14d / now 180d), slide 2 search before/after, slide 3
leftovers prompt screenshot.

### Facebook

```
v1.22 went live this week. The change I'm most proud of: we
loaded 1,200+ more foods from USDA FoodData Central and gave
each one calibrated shelf-life data.

So now ok2eat knows hard cheddar lasts six months unopened,
not 14 days. Salami is 2 years. Frozen broccoli is 8-12 months.
Dried beans basically forever.

The whole point: those "use this in 2 days" warnings only
work if the dates are right. If we tell you your parmesan is
expiring tomorrow when it's actually got six months in it,
you stop trusting the urgency signal. We were doing that on
a lot of common items. Now we're not.

Plus: search is smarter ("swiss cheese" works, not just "Cheese,
swiss"), and you can save leftovers as a cooked item with a 4-day
expiry.

Free on iOS + web. Android in active beta.

ok2eat.com
```

---

## Posting cadence suggestion

- **Quiz funnel posts:** 1 per platform per week, rotate variants.
  These are the long-burn lead-magnet posts. Run them indefinitely.
- **v1.22 launch posts:** post within 48h of Apple approval. Pin
  the X thread. Reply to it with the IG image when that's also
  uploaded. Don't repeat the launch — once is enough.

## Tracking

All quiz CTAs link to `ok2eat.com/quiz` with a query parameter
appended manually per post for source tracking, e.g.:
- `?src=x_quiz_a`
- `?src=ig_quiz_carousel`
- `?src=fb_quiz_long`
- `?src=li_quiz_founder`

PostHog will pick those up via the page-view event referrer field.
After 2 weeks, query PostHog for which source converts best to
`quiz_completed` and double down.
