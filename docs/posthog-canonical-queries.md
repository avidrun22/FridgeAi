# ok2eat — canonical PostHog queries

Reference catalog of SQL queries that answer the questions we ask about
ok2eat usage. Paste any of these into the PostHog SQL editor at
https://us.posthog.com/project/382774/sql.

All queries assume the v1.15+ instrumentation is in place (web: posthog-js
landed 2026-05-07; iOS: full event coverage from 2026-05-07 onward). Pre-
v1.15 events lack `properties.platform` on iOS; use `properties.$lib` to
distinguish iOS (`posthog-react-native`) vs web (`web`) for older windows.

---

## 1. iOS vs web daily active users

The single most useful split now that web is instrumented. iOS's
`posthog-react-native` SDK doesn't auto-tag platform, so use `$lib` as the
canonical platform-discriminator.

```sql
SELECT
  toDate(timestamp) AS day,
  if(properties.$lib = 'web', 'web', 'ios') AS platform,
  count(DISTINCT distinct_id) AS dau
FROM events
WHERE timestamp >= now() - INTERVAL 28 DAY
GROUP BY day, platform
ORDER BY day, platform
```

Pivot into iOS/web columns:

```sql
SELECT
  toDate(timestamp) AS day,
  countDistinctIf(distinct_id, properties.$lib != 'web') AS ios_dau,
  countDistinctIf(distinct_id, properties.$lib = 'web')  AS web_dau,
  count(DISTINCT distinct_id) AS total_dau
FROM events
WHERE timestamp >= now() - INTERVAL 28 DAY
GROUP BY day
ORDER BY day
```

---

## 2. Receipt-scan funnel (the marquee feature)

Per-step counts since v1.15 added the full funnel. Healthy numbers:
`scan_started > scan_cancelled > scan_no_items > scan_failed > scan_succeeded`,
with permission_denied being a separate failure mode. If
`scan_started` ≫ `receipt_scanned` and `scan_cancelled` is high, the
camera dialog or OCR latency is killing flow.

```sql
SELECT
  countIf(event = 'receipt_scan_started')                  AS started,
  countIf(event = 'camera_permission_denied' AND properties.surface = 'receipt_camera') AS perm_denied,
  countIf(event = 'receipt_scan_cancelled')                AS cancelled,
  countIf(event = 'receipt_scan_no_items')                 AS no_items_extracted,
  countIf(event = 'receipt_scan_failed')                   AS failed,
  countIf(event = 'receipt_scanned')                       AS succeeded,
  -- Conversion rates
  round(100.0 * countIf(event = 'receipt_scanned')
              / nullif(countIf(event = 'receipt_scan_started'), 0), 1) AS scan_success_pct
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
```

User-level (each user counted once):

```sql
SELECT
  countDistinctIf(distinct_id, event = 'receipt_scan_started')   AS users_started,
  countDistinctIf(distinct_id, event = 'receipt_scanned')         AS users_succeeded,
  countDistinctIf(distinct_id, event = 'sample_receipt_tapped')   AS users_tried_sample
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
```

---

## 3. Permission-denial telemetry

Split by surface and whether the denial was permanent (canAskAgain=false).
Permanent denials are the bigger problem — those users have to find iOS
Settings to recover. If permanent rates exceed temporary, the rationale
copy isn't doing its job.

```sql
SELECT
  event,
  properties.surface  AS surface,
  properties.permanent AS permanent,
  count() AS events,
  count(DISTINCT distinct_id) AS users
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
  AND event IN ('camera_permission_denied', 'photo_library_permission_denied')
GROUP BY event, surface, permanent
ORDER BY events DESC
```

---

## 4. Web signup funnel (pageview → signup → first add)

Once the new posthog-js code has been live a few days, this tells you
where web traffic drops out. Auto-fired `$pageview` is the top of the
funnel; `user_signed_up` is the gate; `item_added_manual` or
`item_added_bulk` is "got value."

```sql
SELECT
  count(DISTINCT distinct_id) FILTER (WHERE event = '$pageview')                         AS pageview_uniq,
  count(DISTINCT distinct_id) FILTER (WHERE event = 'user_signed_up')                    AS signed_up_uniq,
  count(DISTINCT distinct_id) FILTER (WHERE event IN ('item_added_manual','item_added_bulk')) AS added_item_uniq
FROM events
WHERE timestamp >= now() - INTERVAL 14 DAY
  AND properties.$lib = 'web'
```

---

## 5. Recipe engagement

The two events that matter: `recipe_generated` (AI returned options) and
`recipe_tapped` (user opened a specific card). Healthy ratio is ~30-50%
of generations leading to at least one tap.

```sql
SELECT
  toDate(timestamp) AS day,
  countIf(event = 'recipe_generated') AS generated,
  countIf(event = 'recipe_tapped')    AS tapped,
  round(100.0 * countIf(event = 'recipe_tapped')
              / nullif(countIf(event = 'recipe_generated'), 0), 1) AS tap_rate_pct
FROM events
WHERE timestamp >= now() - INTERVAL 14 DAY
GROUP BY day
ORDER BY day
```

Web-side recipe link engagement (Plan tab → AllRecipes/NYT/Epicurious):

```sql
SELECT
  properties.source AS recipe_source,
  count() AS taps,
  count(DISTINCT distinct_id) AS users
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
  AND event = 'plan_recipe_link_tapped'
GROUP BY recipe_source
ORDER BY taps DESC
```

---

## 6. D1 retention nudge — schedule rate + skip reasons

Tells us how often the v1.15 D1 nudge actually got scheduled vs
silently skipped (no permission, already scheduled today).

```sql
SELECT
  countIf(event = 'd1_nudge_scheduled')                        AS scheduled,
  countIf(event = 'd1_nudge_skipped' AND properties.reason = 'no_permission')        AS skipped_no_perm,
  countIf(event = 'd1_nudge_skipped' AND properties.reason = 'already_scheduled_today') AS skipped_dup,
  countIf(event = 'd1_nudge_failed')                           AS failed,
  countDistinctIf(distinct_id, event = 'd1_nudge_scheduled')   AS users_scheduled
FROM events
WHERE timestamp >= now() - INTERVAL 14 DAY
```

To measure whether scheduled nudges actually drive returns: cross-
reference with the D1 retention query (#7 below) once you have ≥7 days
of post-v1.15 cohorts.

---

## 7. D1/D7/D30 cohort retention

Same as the audit query that surfaced the original 6% D1 problem.
Re-run weekly to see if the v1.15 retention work is moving the
number — expect post-2026-05-07 cohorts to start showing measurable
improvement once 7+ days of new-user data has accumulated.

```sql
WITH first_seen AS (
  SELECT distinct_id, min(toDate(timestamp)) AS d0
  FROM events
  WHERE timestamp >= now() - INTERVAL 56 DAY
  GROUP BY distinct_id
),
active AS (
  SELECT DISTINCT distinct_id, toDate(timestamp) AS d
  FROM events
  WHERE timestamp >= now() - INTERVAL 56 DAY
)
SELECT
  fs.d0 AS cohort,
  count(DISTINCT fs.distinct_id) AS size,
  count(DISTINCT if(a.d = fs.d0 + 1, fs.distinct_id, NULL))                AS d1,
  count(DISTINCT if(a.d BETWEEN fs.d0 + 1 AND fs.d0 + 7, fs.distinct_id, NULL)) AS w1_any,
  count(DISTINCT if(a.d = fs.d0 + 7, fs.distinct_id, NULL))                AS d7,
  count(DISTINCT if(a.d = fs.d0 + 30, fs.distinct_id, NULL))               AS d30
FROM first_seen fs
LEFT JOIN active a ON fs.distinct_id = a.distinct_id
WHERE fs.d0 >= today() - INTERVAL 30 DAY
GROUP BY fs.d0
ORDER BY fs.d0
```

---

## 8. Empty-state CTA effectiveness

Did the v1.15 empty-state Fridge redesign actually move the
receipt-scan-from-empty path? Sample-receipt taps and scan-from-empty
events would tell us.

```sql
SELECT
  toDate(timestamp) AS day,
  countIf(event = 'sample_receipt_shown')   AS sample_shown,
  countIf(event = 'sample_receipt_tapped')  AS sample_tapped,
  countIf(event = 'receipt_scan_started' AND properties.source = 'camera') AS scan_started_camera
FROM events
WHERE timestamp >= now() - INTERVAL 14 DAY
GROUP BY day
ORDER BY day
```

---

## 9. Tour completion rate (post-v1.15)

We added `tour_started` so this is finally measurable. Pre-v1.15 we only
had `tour_completed` (which fires both on completion AND skip), so the
denominator was unknown.

```sql
SELECT
  countIf(event = 'tour_started')                                          AS started,
  countIf(event = 'tour_completed')                                        AS finished_or_skipped,
  countIf(event = 'tour_completed' AND properties.completed = true)        AS completed_full,
  countIf(event = 'tour_completed' AND properties.completed = false)       AS skipped_early,
  -- Skip rate
  round(100.0 * countIf(event = 'tour_completed' AND properties.completed = false)
              / nullif(countIf(event = 'tour_started'), 0), 1) AS skip_rate_pct
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
```

---

## 10. Email-digest click-through

After v1.15's UTM tagging on the digest "Open ok2eat" CTA, this measures
whether the daily-digest email actually drives app re-opens. Expected to
be small in absolute terms early on (small subscriber base) but the
ratio over digest-send count is the leading indicator.

```sql
SELECT
  toDate(timestamp) AS day,
  countIf(event = 'digest_email_opened') AS digest_clickthroughs,
  countDistinctIf(distinct_id, event = 'digest_email_opened') AS users
FROM events
WHERE timestamp >= now() - INTERVAL 14 DAY
GROUP BY day
ORDER BY day
```

---

## 11. Power-user pattern (for v1.16 product decisions)

Top 10 distinct users by event volume. The audit's `item_deleted: 29
events from 1 user` came from this kind of analysis. Surfaces who's
actually using the product heavily.

```sql
SELECT
  distinct_id,
  count() AS total_events,
  countIf(event LIKE 'item_%')           AS item_events,
  countIf(event = 'receipt_scanned')     AS scans,
  countIf(event = 'recipe_tapped')       AS recipe_taps,
  countIf(event = 'household_onboarding_completed') AS households,
  min(toDate(timestamp)) AS first_seen,
  max(toDate(timestamp)) AS last_seen
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
GROUP BY distinct_id
ORDER BY total_events DESC
LIMIT 10
```

---

## Updating this file

When you add new events to the iOS or web codebase, append the canonical
query for them here so future questions are a paste-and-run instead of a
re-derivation. Especially for funnels — they get tedious to rebuild from
memory.
