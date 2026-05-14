# /scan deploy guide — receipt scanner on the web

Three things ship together. Do them in this order.

## 1. Apply the Supabase migration

Adds the `public_scan_usage` table + `increment_public_scan_usage` RPC for per-IP rate limiting.

**Option A — Supabase SQL editor (fastest):**

1. Open the Supabase dashboard → your project → SQL Editor → New query
2. Paste the contents of `supabase/migrations/20260508_v116_public_scan_rate_limit.sql`
3. Run

**Option B — Supabase CLI:**

```bash
cd ~/fridgeai-native
npx supabase db push
```

(Verify with `select * from public.public_scan_usage limit 1;` — should run without error and return 0 rows.)

## 2. Deploy the Edge Function

```bash
cd ~/fridgeai-native
npx supabase functions deploy scan-receipt-public --no-verify-jwt
```

The `--no-verify-jwt` flag is critical — it tells Supabase to skip the auto-auth middleware. The function intentionally accepts unauthenticated requests.

**Set environment variables:**

```bash
npx supabase secrets set PUBLIC_SCAN_DAILY_LIMIT=5
npx supabase secrets set PUBLIC_SCAN_ALLOWED_ORIGINS="https://ok2eat.com,https://www.ok2eat.com"
```

The `ANTHROPIC_API_KEY` and Supabase env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`) should already be configured from the existing `scan-receipt` function — no action needed there.

**Test it (CLI):**

```bash
# Replace IMAGE_BASE64 with a real base64 receipt JPEG
curl -X POST 'https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/scan-receipt-public' \
  -H 'Content-Type: application/json' \
  -d '{"image":"<IMAGE_BASE64>"}'
```

Expected: 200 with `{ items: [...], usage: { count, limit } }`.

## 3. Deploy the website

```bash
cd ~/fridgeai-native
python3 scripts/deploy_website.py --message "v1.16.1 — /scan receipt scanner page"
```

The deploy script picks up `scan/` automatically (added to `_AUTO_INCLUDE_DIRS`). The updated nav on `ok2eat.html` ships with this deploy too.

After deploy, visit `https://ok2eat.com/scan` and verify:

- Page loads cleanly
- Drag-drop works
- Test scan with a real receipt photo from your phone
- Results render with category groups + urgency colors
- App install CTA shows under results
- PostHog events fire (`web_scan_page_viewed`, `web_scan_started`, `web_scan_completed`)

## 4. (Optional) Smoke test the rate limit

From the same IP, run 6 scans within the same day. The 6th should return 429 with the iOS app fallback message.

## 5. Update sitemap

Add `/scan/` to `sitemap.xml` so it's indexed:

```xml
<url>
  <loc>https://ok2eat.com/scan</loc>
  <changefreq>weekly</changefreq>
  <priority>0.9</priority>
</url>
```

Then submit the updated sitemap to Google Search Console.

## Rollback

If anything blows up:

- **Edge Function:** `npx supabase functions delete scan-receipt-public`
- **Website:** redeploy a previous version via Netlify dashboard, or revert the nav edit in `ok2eat.html` and re-run `deploy_website.py`
- **Migration:** the migration is additive (only creates new objects), no rollback needed unless the table starts to fill with abuse — `truncate public.public_scan_usage` at any time

## Things to monitor in week 1 of /scan being live

Add these to the Sunday review:

- **Anthropic API spend.** Each scan costs ~$0.01-0.03. Watch the Anthropic dashboard. If a single IP starts hammering, lower `PUBLIC_SCAN_DAILY_LIMIT` to 3 and consider adding Cloudflare Turnstile.
- **PostHog `web_scan_completed` count.** Funnel from there to `outbound_appstore_click` is the real win — that's the conversion lift.
- **Share of /shelf-life/ vs /scan/ traffic.** If /scan/ outperforms, update the social media plan to lead with /scan/ links instead.
- **Common scan failures.** Check Edge Function logs for "could not parse receipt" — if a particular failure mode is common, the prompt may need tuning.

## Files in this change

- `supabase/migrations/20260508_v116_public_scan_rate_limit.sql` — new
- `supabase/functions/scan-receipt-public/index.ts` — new
- `scan/index.html` — new
- `ok2eat.html` — nav updated (added "Scan receipt" link)
- `scripts/deploy_website.py` — added `scan` to `_AUTO_INCLUDE_DIRS`
- `.appstoreconnect/marketing_strategy/open_decisions.md` — closed Initiative 3 sequencing decision, opened web-scanner top-priority decision
