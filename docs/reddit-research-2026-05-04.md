# Reddit + Web Research: Killer Feature Ideation (2026-05-04)

Synthesis of 7 web searches across Reddit, MetaFilter, Medium, and food-app
review sites. Goal: find the recurring pain points and feature gaps that
existing food-tracking apps don't solve, so ok2eat can pick a "killer
feature" with real signal behind it.

**Format:** for each insight I quote the actual user complaint where I
have one, then map it to an ok2eat feature opportunity. Insights are
ranked by signal strength (how often the same complaint surfaced).

---

## #1 signal — The ADHD / executive-function audience is huge and underserved

This is the strongest signal across all searches. Direct quotes from
multiple sources:

> "If you're like most ADHDers, the last time you cleaned your fridge,
> you threw away forgotten produce and uneaten leftovers."

> "You buy groceries on Sunday with real intentions. Monday you're
> motivated, you cook something. Tuesday the energy isn't there, so you
> order DoorDash. Wednesday you forget about the vegetables in the
> crisper drawer."

> "The executive function it takes to follow steps, manage time, and
> clean up afterward can feel impossible."

**Audience size:** ADHD adults are ~5% of the US population (~17M people).
r/ADHD has 2M+ members. r/ADHDfishermenmom and parenting subs all hit the
same theme.

**Opportunity for ok2eat:** This is **literally** the user ok2eat is built
for — someone who forgets about food in the crisper drawer. Most existing
apps target organized planners. ok2eat could lean into "ADHD-friendly
fridge brain" positioning in marketing without changing the product
substantially. The core mechanics already serve this user perfectly.

**Killer feature angle:** "Forgot you bought it? We didn't." Lean copy +
empathic language + maybe a "low-pressure" mode that surfaces ONE thing
to use today rather than a list. Marketing > engineering.

---

## #2 signal — "What to make for dinner" daily decision paralysis

> "It's hard to figure out what's for dinner."

> Dinner suggestion apps (SuperCook, MyFridgeFood, Fridge AI) are
> well-known but limited — they don't track your actual inventory.

> "Plan meals around what expires soonest" is a real practice, but no
> app surfaces this automatically.

**Existing solutions and their gaps:**
- **SuperCook** (~9M users) — biggest in the space. Recipe-from-pantry
  search. But the user has to manually maintain pantry list. ok2eat
  already does this passively via receipts.
- **MyFridgeFood** — same pattern. Last updated a year ago per reviews.
- **Cooklist** — closest competitor: "pantry-to-recipes." Subscription
  model. Mixed reviews on iOS App Store.
- **Fridge Leftovers AI / Fridge AI** — snap-photo-of-fridge, get recipes.
  Trendy but limited inventory persistence.

**Killer feature angle (= your "Smart Cook Night"):** Open ok2eat at 6pm
→ ONE recipe pick from current inventory + ONE missing ingredient +
one-tap order. Crucially: the fridge data is *already there* because of
ok2eat's inventory tracking + receipt scanning. **No other app combines
inventory + recipe + reorder in one tap.** This is a real moat.

---

## #3 signal — Existing grocery list apps are isolated from inventory

> AnyList, OurGroceries, Cozi, WiseList all dominate "shared shopping
> list" but **none** track what's in your fridge.

> Users report that adding items is frustrating because units are unclear.
> "1 rice isn't clear — including a unit next to the quantity selector
> would help."

> Categories aren't customizable. Frozen vegetables show in the produce
> section.

**Opportunity for ok2eat:** You're already ahead here — ok2eat's
shopping list IS connected to inventory. The reorder flow auto-populates
from low-stock items. Worth a marketing comparison post: "Why your
shared shopping list app should know what's in your fridge."

---

## #4 signal — Fridge organization advice is its own niche

> "Arrange food based on how quickly it should be consumed — ready-to-eat
> items on the top shelf."

> "Plan meals around what expires soonest, store leftovers in containers
> to freeze."

**Opportunity for ok2eat:** Lightweight "fridge organization tips"
content marketing — these articles get massive Pinterest/IG traction.
Not a feature, but a cheap traffic source.

---

## #5 signal — Receipt scanning is rare and impressive

> Most apps require manual barcode entry or typing. Receipt-photo →
> auto-populated inventory is a "wait, that's possible?" moment for
> users in articles I scanned.

**ok2eat already has this.** It's the closest thing to a viral moment
in the existing product. Lean into it harder in screenshots, demo
videos, and social cuts.

---

## #6 signal — Subscription fatigue is real

> "After just 5 minutes of using an app I canceled my subscription and
> deleted it."

> "Cooklist's mixed reviews mention paywalls aggressively."

**Opportunity for ok2eat:** Free positioning is a moat against Cooklist
and similar paid competitors. Don't add IAP friction prematurely.
Greg's plan to gate AI recipes behind a quota at scale is fine — but
keep the core inventory + lists free forever as a stake-in-the-ground
differentiator.

---

## What I did NOT find strong signal for (deprioritize)

- **Voice / Siri integration** — mentioned occasionally but not a top
  pain point. Cool-but-not-killer.
- **Photo-of-fridge AI inventory** — exists (Fridge AI, Fridge Leftovers
  AI) but not consistently praised. Greg's receipt scan is a more reliable
  proxy with less photo-quality ambiguity.
- **Macro tracking** — existing macro apps (MyFitnessPal etc.) own this.
  ok2eat's nutrition data is a "bonus" not a flagship.
- **Apple Watch glance** — nice-to-have but no Reddit thread reaching
  for it.

---

## Killer feature ranking (Greg's two + my top picks based on research)

| Rank | Feature | Reddit signal | Effort | Moat strength |
|---|---|---|---|---|
| 🥇 | **"Tonight's Dinner" / Smart Cook Night** — daily 6pm push: "Make X tonight using what you have + grab Y" with one-tap reorder | Very strong (#2) | 2-3 days | High — combines features no competitor connects |
| 🥈 | **ADHD-positioning marketing pivot** — copy + landing page rewrite around "for people who forget about the crisper drawer" | Very strong (#1) | 1 day | Medium — mostly content/positioning |
| 🥉 | **SMS Group Fridge** — text/iMessage shortcut to query household inventory ("do we have eggs?") | Weak direct signal but novel | 3-5 days | High — extremely shareable, no competitor has this |
| 4 | **Receipt-scan demo video as hero** — show off the 10-second scan-to-fridge moment | Strong indirect (#5) | 1 day | Marketing only |
| 5 | **Photo-of-leftovers → "what to do" suggestions** | Medium (#2 adjacent) | 2-3 days | Medium — competitors exist |

---

## Recommended call

**Build Smart Cook Night first.** It's the highest-signal feature with a
real moat — competitors have inventory, OR have recipe search, OR have
reorder, but no one combines all three into a single daily action.
Greg already has all three building blocks. Estimated 2-3 days of work.

**SMS Group Fridge as v1.16 or v1.17.** Real moat, but lower direct
signal — risk of building something cool that doesn't move the needle.
Worth the lottery ticket once Smart Cook Night proves the core thesis
works.

**Marketing pivot to ADHD audience NOW** (parallel, no engineering
needed). Rewrite the homepage hero to lead with "for people who forget
about the crisper drawer." Submit to r/ADHD / r/ADHDfishermenmom /
r/ADHD_partners as a tool that serves them. The audience is large,
empathetic, vocal, and willing to recommend things that work.
