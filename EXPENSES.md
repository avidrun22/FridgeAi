# ok2eat — Expense Tracker

**Last updated:** 2026-05-08 (post-Typefully Pro signup)

The single-source-of-truth dollar view. STACK.md describes the *what* and *why* of each tool; this file is the *how much*. Update this when you add, remove, or change a paid service.

---

## Current monthly run-rate

| Service | Monthly | Annual | Category | Status |
|---|---|---|---|---|
| Supabase Pro | $25.00 | $300.00 | Infra (Postgres + Edge Funcs + Storage) | Active |
| Netlify Personal | $19.00 | $228.00 | Hosting (marketing + web app) | Active |
| Typefully Pro | $10.00 | $120.00 ($96 if annual) | Marketing (X scheduling + auto-DM) | **14-day trial — first charge ~May 22** |
| Apple Developer Program | $8.25 | $99.00 | Distribution (App Store) | Active, annual |
| Google Workspace (1 user) | $7.00 | $84.00 | Email aliases (8 @ok2eat.com) | Active |
| Namecheap (ok2eat.com) | $1.25 | $15.00 | Domain | Active, annual |
| **Fixed subtotal** | **$70.50** | **$846.00** | | |
| Anthropic API | $8-25 (variable) | $96-300 | AI (recipes, OCR, scoring, daily report) | Active, usage-based |
| **Total range** | **$78.50-$95.50** | **$942-$1,146** | | |

## Free tier (so far)

These are real services we depend on but currently $0:

| Service | Limit | When we'd hit it |
|---|---|---|
| PostHog | 1M events/mo | At ~30K DAU — far away |
| Resend | 3K emails/mo | At ~100 daily-digest subscribers — getting close, monitor |
| Expo | Free workflow | Always free for personal projects |
| Pinterest Business | Free | Always free for organic |
| X / Meta / Reddit / TikTok | Free | Always free for organic |
| Cloudflare DNS | Free | Always free at this volume |
| GitHub | Free | Public-repo limit — we may need to reconsider for private repos with collaborators |

## Marketing-specific spend (separate from infra)

This is the slice that lives inside the 30-day plan:

| Item | Budget | Spent | Notes |
|---|---|---|---|
| Typefully Pro (May) | $10 | $0 (in trial) | Charges May 22; 14-day evaluation |
| Meta Ads (planned, Weeks 2-3) | ~$65 | $0 | Boosting proven IG winners |
| X Promoted (planned, Week 3) | ~$15 | $0 | Boosting best lead magnet |
| Reserve (Week 4 boost) | ~$10 | $0 | Opportunistic |
| **30-day plan total** | **$100** | **$0** | Per `30_day_growth_plan.md` |

**Note:** the $10 Typefully cost is tracked here AND in the fixed monthly costs above — it's a recurring tool, not just a 30-day campaign expense. Don't double count when reading the totals.

## Variable cost projection — Anthropic API

The single most-volatile line item. Three scenarios:

| Scenario | Monthly cost | Trigger |
|---|---|---|
| Baseline (today) | ~$8-15/mo | iOS scan-receipt + recipe gen + daily report agent |
| With `/scan` live (current) | ~$10-25/mo | Add 50-200 anonymous web scans/day at $0.01-0.03 each |
| Mild viral moment | $50-150/mo | A lead magnet hits 1,000 DMs and 1,000 scans/day for a week |
| Full viral moment | $200-500+/mo | Sustained 5,000+ scans/day for a month |

**Mitigation if costs spike:**
- Lower `/scan` limit from 3/day to 1/day per IP
- Add Cloudflare Turnstile to gate scans behind a captcha
- Switch the per-page model from Haiku 4.5 to Haiku 4.0 (~30% cost reduction with minor quality tradeoff)
- Add monthly cap in Anthropic console — set at $50 initially, raise if usage normalizes

**How to monitor:** Anthropic console → Usage tab. Set up email alerts at $25 and $50 monthly thresholds.

## Total cost — what you're really paying

For a normal month (no viral moment):

```
  Fixed subscriptions:     $70.50/mo
  + Anthropic API (avg):   $15/mo
  = Total monthly:         ~$85.50/mo
  = Total annual:          ~$1,026/yr
```

If you renew Typefully on annual billing in May, save $24/yr → ~$1,002/yr.

## Cost per active user

A health metric worth watching:

```
  ~$85/mo / DAU (currently small)
```

This number is high right now because the fixed-infra cost (Supabase Pro, Netlify Personal) is the same whether you have 1 user or 1,000. As DAU grows, marginal-cost-per-user drops fast. Re-check this metric monthly. When the variable Anthropic cost outpaces fixed costs, you've reached real scale.

## What's missing from this tracker

Things to add when they happen:

- **Initiative 3 (paywall + free trial)** — if/when ok2eat charges users, App Store/Apple takes 15-30% cut. Add as a negative (revenue share).
- **Stripe / RevenueCat** — likely needed for paywall infra. Roughly 2.9% + $0.30 per transaction (Stripe) or 1% (RevenueCat).
- **Influencer sponsorships** — currently skipped per `open_decisions.md`. Add line if/when reactivated.
- **TikTok ads** — currently deferred. Add if/when activated.
- **Affiliate income** — Amazon Associates, Instacart Marketplace, etc. Add as negative (revenue, not expense).

## Maintenance

When you add a new paid service:
1. Add a row to "Current monthly run-rate" above
2. Update the fixed subtotal + total range
3. Note the date in "Last updated" at the top
4. Cross-reference in `STACK.md` if it's a major piece of infrastructure
5. Tag the category — Infra / Hosting / Marketing / Distribution / Email / AI / Domain / Other

When you cancel something:
1. Strike through the row (don't delete) — historical cost record matters
2. Note the cancellation date
3. Update totals
