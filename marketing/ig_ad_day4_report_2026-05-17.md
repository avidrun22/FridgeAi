# IG grocery-inflation ad — day-4 check-in (2026-05-17)

**Test window:** 2026-05-13 → 2026-05-16 (4 days, $5/day = ~$20)
**Post:** [3-slide carousel + Story](ig_grocery_inflation.md) — slide 1 the 44%-veg-inflation stat, slide 3 the blog CTA
**Destination:** ok2eat.com/blog/april-grocery-inflation.html (no UTMs — see lesson in `paid_ad_test_checklist.md`)

---

## Heads-up: scheduled run, partial data

This is the automated Sun-morning check. The autonomous sandbox can't reach Meta Ads Manager (no Marketing API token in the repo), Instagram Insights, PostHog, Supabase, or App Store Connect — all of those hosts are blocked at the sandbox proxy and most don't expose what we need via API anyway. So this report is in two parts:

1. **What I could reconstruct from cached data on disk** (the daily_report.log, marketing notes, ad checklist) — already filled in below.
2. **What you have to grab from the dashboards** — a 5-minute checklist. Run `python3 .appstoreconnect/check_ig_ad_day4.py` from your terminal to fill in the Supabase + PostHog rows automatically.

The decision call at the bottom is conditional on what those dashboard numbers turn out to be — three branches, pick the one that matches.

---

## Summary table (fill the dashboard rows)

| Metric | Value | Source | Healthy range |
|---|---|---|---|
| **Meta Ads — paid layer** | | | |
| Total spend | $___ | Ads Manager → Campaign | ~$20 expected |
| Reach | ___ | Ads Manager | — |
| Impressions | ___ | Ads Manager | — |
| CPM | $___ | Ads Manager | $8–15 (food/lifestyle '26) |
| Link clicks (to blog) | ___ | Ads Manager → Performance | — |
| CTR (link) | ___% | Ads Manager | >1.5% |
| CPC (link) | $___ | Ads Manager | $0.50–1.50; <$0.80 = working |
| Engagement (likes/comments/shares/saves) | __/__/__/__ | Ads Manager → Engagement | — |
| Cost per engagement | $___ | Ads Manager | $0.20–0.50 |
| Profile visits driven | ___ | Ads Manager | — |
| Top age bucket | ___ | Ads Manager → Demographics | (note for future targeting) |
| Top gender | ___ | Ads Manager → Demographics | — |
| Top 3 regions | ___, ___, ___ | Ads Manager → Demographics | — |
| **Instagram organic spillover** | | | |
| IG follower count, 05-13 → 05-17 | ___ → ___ | IG app → Insights → Audience | delta >0 = ad bio CTA works |
| **Site / app — cross-check** | | | |
| Newsletter signups in window | **11** *(May 13: 6, May 14: 4, May 15: 1, May 16–17: TBD)* | daily_report.log (May 13–15) + Supabase (May 16–17) | baseline 4-day prior was 8 signups¹ |
| Blog pageviews on inflation post | ___ | PostHog | — |
| Of which IG/FB referrer (`l.instagram.com`, `lm.facebook.com`) | ___ | PostHog | this is the no-UTM attribution path |
| Daily active users (DAU) trend | **22 → 42 → 95** (May 13/14/15) | daily_report.log | confounder: v1.19 recipe-browser launch was same window |
| iOS install delta 05-13..05-17 | ___ | App Store Connect → Analytics | — |

¹ Baseline 05-09 to 05-12 from daily_report.log: 4+11+13+16 = wait, those are *active* users; signups in baseline were 5+2+4+13 = 24. So actually the prior 4-day signup baseline was higher than the ad-window total so far. **That's a yellow flag** — see decision logic below.

---

## What I can already see from cached data

**Signups during the ad window are running BELOW the prior 4-day baseline.** From `daily_report.log`:

- Pre-ad 4-day window (05-09 → 05-12): **24 signups total** (5, 2, 4, 13)
- Ad window so far (05-13 → 05-15, 3 days observed): **11 signups** (6, 4, 1)
- Trailing 3-day pre-ad (05-10 → 05-12): **19 signups** (2, 4, 13)

The May 11 spike (13 signups) and the May 12 spike (16 signups) were almost certainly driven by the v1.19 recipe-browser launch + organic Reddit/X traffic, not the ad. So the apples-to-apples baseline is closer to "median 2–4 signups/day organically" — which makes the 6/4/1 ad-window numbers roughly **flat to slightly down**.

**Active users (DAU) climbed sharply during the ad window: 22 → 42 → 95.** But this is heavily confounded. v1.19 recipe browser shipped 05-12, v1.21 entered review 05-15. DAU spike is most likely the existing user base re-engaging with the new feature, not new visitors from the ad. The signup column is the cleaner read on ad effectiveness.

**The cron writing daily_report.log appears to have stopped completing cycles after the May 15 report** (mtime 2026-05-17 04:00 but no closing "Sent telegram" line for the latest entry). Worth a separate look at `.appstoreconnect/launchd.err.log` — the bottom is full of urllib3 LibreSSL warnings, not errors, so the daily report might actually be running but failing silently somewhere in the send step.

---

## How to fill in the rest (5 minutes)

**1. Auto-pull Supabase + PostHog** — from your terminal:

```bash
python3 .appstoreconnect/check_ig_ad_day4.py
```

This produces all rows except the Meta Ads / IG Insights / App Store Connect ones. (Sandbox proxy 401s these hosts; running locally is the established pattern — same as `metrics_rundown.py`.)

**2. Meta Ads Manager** — Open the campaign, switch the column view to "Performance and Clicks", grab spend / reach / impressions / CPM / link clicks / CPC. Then column-view "Engagement" for likes/comments/shares/saves. Then "Audience" tab → demographics. About 3 minutes if you know where each column lives; the [Ads Manager column-set guide](https://www.facebook.com/business/help/717368264947302) has the layout.

**3. Instagram Insights** — Open Instagram app → @ok2eatapp profile → Insights → Audience. The "Followers" chart has a 7-day view; compare today's count vs the 05-13 count. Also Insights → Accounts engaged → Profile visits (the ad-attributed slice is in Ads Manager, but the organic spillover number is here).

**4. App Store Connect** — Optional but useful. App Store Connect → Analytics → Sources → web referrers, filtered to 2026-05-13 onward. Look for `instagram.com` and `facebook.com` rows.

---

## Decision logic — pick the branch that matches your numbers

The benchmarks are from `marketing/paid_ad_test_checklist.md` (your own doc, verbatim — keeping internal consistency):

### A. **Working** → scale to $10/day + add second creative

All three must be true:
- CPC < $0.80 **AND**
- Link CTR > 1.5% **AND**
- IG follower delta > 0 (any positive — even +3 means the bio CTA is converting some impression-to-follow)

**Then:** bump the campaign to $10/day, run another 7 days, **and** kick off a creative variant testing the "+22% coffee" hook I drafted in `marketing/ig_grocery_inflation.md` follow-ups. Run the variant in a separate ad set so attribution stays clean.

### B. **Mixed** → diagnose the single bottleneck

Anything that doesn't cleanly fit A or C. Most common patterns and what each one means:

- **High CPM (>$20), good CTR if any clicks**: wrong audience. Tighten interests, drop the "sustainable living" overlap with too-broad lifestyle audiences.
- **Good CPM (<$15), low CTR (<1%)**: creative isn't earning the click. The slide-1 hook (44% veg inflation stat) might not be hitting — test the "30% of what you buy goes in the trash" line as the lead slide instead.
- **Good CTR, blog pageviews land but signups are flat**: the blog post is the bottleneck. Add an inline newsletter capture form mid-article, not just at the bottom.
- **Good clicks, IG followers not growing**: profile bio doesn't have a "Follow for daily shelf-life tips" CTA. Fix the bio first, then keep spending.

Run ONE fix, schedule a 3-day re-check. Don't change multiple variables.

### C. **Not working** → kill the ad, pivot $20-30/week

All three:
- CPM > $25 **OR** CPC > $2.50 **OR** link clicks < 30 total **AND**
- IG follower delta = 0 **AND**
- Newsletter signup window total ≤ baseline (≤24 in this case)

**Then:** pause the campaign today. $20 lost is the cost of testing — that's the point. Pivot the weekly $20-30 to:

1. **Apple Search Ads** on keywords "fridge inventory", "shelf life", "food waste app". App-install attribution is clean and the cost-per-install for niche utility apps in this category typically sits around $1.50-3 — for $20/week you get ~7 installs which is better signal than 0 followers.
2. **Reddit promoted post** in r/Frugal or r/MealPrepSunday. The marketing strategy doc already flagged this as a high-leverage organic channel; promoting one well-written comment-thread top-of-thread post for $20 is worth a test.
3. **Or just buy back the time** — use the budget as a runway for two more rounds of organic Reddit posts (your `30_day_growth_plan.md` Week 4 plan).

Your zero-X-followers note when you set this up still stands: if paid Meta can't shortcut audience-building for $20, that's a signal the paid layer isn't your unlock right now. The 30-day plan's thesis was "organic does 80%, paid amplifies winners" — confirming that thesis is worth the $20.

---

## What I'd flag for next test (regardless of outcome)

- **Set UTMs next time.** `paid_ad_test_checklist.md` already calls this out. Without UTMs, even with the referrer-based fallback, you're losing 20-30% of attribution to in-app browsers that don't pass referrers cleanly. The fix is one URL-encoded suffix, 30 seconds.
- **Get a Meta Marketing API token in the repo** so this exact report can run autonomously next Sunday. The flow is: Meta Business → System Users → create a system user → generate token with `ads_read` scope → drop into `telegram_config.json` as `meta_access_token` + `meta_ad_account_id`. Then `check_ig_ad_day4.py` pulls Meta numbers too and this becomes a one-command op.
- **The daily_report.log cron looks like it may have stalled.** Worth a separate 5-min check — the last fully-closed cycle is 05-15, and the mtime is 05-17 04:00 with an incomplete entry. Likely not a blocker (the AppStoreConnect status notifier is still working per `launchd.out.log`), but the daily Telegram digest may be silently broken.

---

**TL;DR for the chat thread, once you have the Meta numbers:** signup column is flat-to-down vs. baseline (11 vs. 24), DAU spike during the window is more likely the v1.19 launch than the ad. If your CPC is under $0.80 and you have any positive follower delta, scale (A). If CPC is over $2.50 with zero follower movement, kill it and move the money to Apple Search Ads (C). Anything in between, it's a single-variable diagnosis (B).
