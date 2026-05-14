# v1.20 — PostHog setup for the demo funnel

## What events are firing (code-side, already deployed)

All events use the same project key (`phc_szxhjw2eQmYYhNGicX3kmNXxdz47Sj7evqx5Quqw8dTY`) so demo → app data is one continuous user journey.

### Marketing site (ok2eat.com — fires on demo CTA clicks)

- **`homepage_demo_click`** — fires when a visitor clicks any link to `/demo`.
  - `surface`: `"hero_demo_card_clicked"` (the green CTA card) or `"hero_phone_clicked"` (the clickable phone mockup) or `"unknown"` (fallback).
  - `source_path`: which marketing page they were on.
- **`outbound_web_app_click`** — already-existing event, also fires (`href` contains `/demo`).

### Demo screen (app.ok2eat.com/demo)

- **`demo_viewed`** — single fire on mount.
  - `total_items`, `expired_count`, `expiring_soon_count` (so we can compare empty-demo vs full-demo behavior later if we A/B).
- **`demo_recipes_opened`** — Get recipes tapped on a row OR the Top-5 banner.
  - `mode`: `single_item` or `top_5`.
  - `lead_item`, `context_count`.
- **`demo_item_detail_opened`** — row tapped (anywhere except Get recipes button).
  - `name`, `category`.
- **`demo_add_by_hand_opened`** — left tile tapped.
- **`demo_item_added`** — visitor actually added an item.
  - `name`, `category` (so we can see what people type — useful for shelf-life directory prioritization).
- **`demo_signup_prompt_shown`** — any of the 4 signup-prompt triggers (scan_receipt, save_recipe, add_to_list, add_item).
  - `reason`: which one.

### Auth screen (`/`)

- **`auth_demo_link_clicked`** — visitor on the auth screen tapped "Try the demo first →".
  - `from_mode`: which auth mode they were in (`magic`, `signin`, `signup`).
- **`user_signed_up`** + **`user_signed_in`** — already firing.

---

## Funnels to set up in PostHog

### Funnel A — "Marketing → demo → signup" (the headline number)

Steps in order:

1. `homepage_demo_click` (marketing-site)
2. `demo_viewed` (web app)
3. ANY of: `demo_recipes_opened` OR `demo_item_detail_opened` OR `demo_add_by_hand_opened` (engagement signal)
4. `demo_signup_prompt_shown` (intent moment)
5. `user_signed_up`

Window: 24 hours.
Conversion goal: track step 3 → step 5 ratio over time. Step 3 alone tells us "did they engage past first paint?"

### Funnel B — "Demo engagement" (qualitative)

Steps:

1. `demo_viewed`
2. `demo_recipes_opened` (mode=single_item OR top_5)
3. `demo_signup_prompt_shown` (reason=save_recipe OR add_to_list)

This isolates the recipe-modal conversion path from the scan-receipt path. If reason=save_recipe converts higher than reason=scan_receipt, we know the recipe flow is doing the heavy lifting.

### Funnel C — "Surface split" (which CTA wins)

Breakdown of Funnel A by `homepage_demo_click.surface`:

- `hero_demo_card_clicked` vs `hero_phone_clicked`

If one underperforms by 30%+, demote it next iteration.

---

## Cohorts to create

### "Demo visitors (last 7 days)"

- People who fired `demo_viewed` in the last 7 days.
- Use for retention analysis, conversion comparisons.

### "Demo engaged but didn't sign up"

- Fired `demo_recipes_opened` OR `demo_add_by_hand_opened`
- Did NOT fire `user_signed_up` in the last 14 days

This is the warm-but-not-converted audience — useful if you ever want to A/B the signup prompt copy.

---

## Saved insights

Once funnels are saved, pin these to the main dashboard:

1. **Funnel A** — top-line conversion (demo → signup)
2. **Trend: `demo_viewed` per day** — top-of-funnel volume
3. **Trend: `demo_item_added` per day** — engagement-depth signal
4. **Breakdown: `demo_signup_prompt_shown` by `reason`** — which conversion gate trips most often
5. **Breakdown: `demo_item_added.name`** — what items people typed (use to prioritize shelf-life directory additions)

---

## Click-by-click setup (5 minutes in PostHog UI)

If you want to do this solo instead of having me drive Chrome MCP next turn:

1. **Insights → New insight → Funnel.** Add steps in order above. Set conversion window to 24h. Save as "v1.20 Demo conversion funnel."
2. **Insights → New insight → Funnel.** Demo engagement funnel. Save as "v1.20 Demo engagement (recipe-modal path)."
3. **Insights → New insight → Funnel.** Funnel A again, this time add a Breakdown on event property `homepage_demo_click.surface`. Save as "v1.20 Demo CTA surface split."
4. **Cohorts → New cohort → Behavioral.** "Performed `demo_viewed` in the last 7 days." Save as "Demo visitors (7d)."
5. **Dashboards → New → 'v1.20 Demo launch'.** Pin the 3 funnels + the 2 trends + the 2 breakdowns from the list above.

---

## Drive next turn

Say "drive PostHog setup" and I'll Chrome-MCP my way through the dashboard, screenshotting each step to verify. Faster than clicking through it twice (once to learn the menu, once to actually configure).
