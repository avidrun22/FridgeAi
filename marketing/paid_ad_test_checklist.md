# Paid social ad test — pre-flight checklist

Use this before every paid Meta / TikTok / X / Reddit ad spend. Cheap insurance — each item takes <60 seconds and saves you a day of post-hoc attribution work.

## Before the ad goes live

- [ ] **UTM-tagged destination URL.** Format:
      `https://ok2eat.com/blog/SLUG?utm_source=PLATFORM&utm_medium=paid&utm_campaign=TEST_NAME_DATE`
      PostHog auto-captures UTMs; we get clean attribution day one.
- [ ] **Objective is Traffic or Engagement, NOT Brand Awareness.** Awareness optimizes for cheap impressions and rarely produces clicks. Common $5/day money sink.
- [ ] **Daily spend cap set.** Even if Meta says "no maximum needed," set it explicitly. Avoids surprise charges.
- [ ] **Audience size in the 100k–1M range.** Smaller = expensive CPM. Larger = unfocused.
- [ ] **Set an end date or budget cap** on the ad set so it can't run indefinitely if you forget about it.
- [ ] **Schedule the 4-day check-in** via the Scheduled-Tasks tool same time you start the ad.

## What "good" looks like for the ok2eat niche (food/lifestyle IG)

- CPM: $8–15 healthy, >$25 audience is wrong
- CPC: $0.50–1.50 healthy, <$0.50 great, >$2.50 creative is wrong
- CTR (link click-through): >1.5% healthy on Meta
- Cost per engagement: $0.20–0.50

## When the data comes in

Three buckets, decide which one:

- **Working** (CPC < $0.80, CTR > 1.5%, follower delta > 0): scale to 2x spend + test a second creative variant.
- **Mixed**: identify the bottleneck. Bad CPM = wrong audience. Good CPM, bad CTR = bad creative. Good CTR, bad post-click = bad landing page.
- **Not working** (high CPM, low CTR, no follower delta): kill it. The $20 was the cost of finding out.

## Notes for the May 2026 grocery-inflation test

- UTMs not set (too late by the time we set up tracking — lesson captured)
- Will use referrer-based attribution on Sunday: PostHog `$referrer LIKE '%l.instagram.com%' OR '%lm.facebook.com%'`
- Less clean but workable for this first test
