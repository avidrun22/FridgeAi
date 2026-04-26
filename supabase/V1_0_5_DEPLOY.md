# v1.0.5 deploy checklist

Three Supabase changes plus a fresh iOS build. Order matters — apply schema
before the new app code calls the new columns/tables.

## 1. Schema migration

Open the Supabase SQL editor (https://supabase.com/dashboard/project/qemarhvgeuzhlwybmbie/sql/new),
paste the contents of `supabase/migrations/20260426_v105_unit_and_notifications.sql`,
and run. This adds:

- `fridge_items.unit` column (text, nullable)
- `user_settings` table with notification preferences and RLS policies
- `expo_push_tokens` table for daily-digest delivery, with RLS policies

Click "Run this query" through the destructive-operation prompt — the DROP
POLICYs are idempotency guards on fresh policies.

## 2. Deploy the send-daily-digest Edge Function

Same flow as the existing two functions:

1. https://supabase.com/dashboard/project/qemarhvgeuzhlwybmbie/functions/new
2. Name: `send-daily-digest`
3. Paste the contents of `supabase/functions/send-daily-digest/index.ts`
4. Click **Deploy function**

Then set the cron secret as a function env var:

1. Go to **Functions → Secrets**
2. Add:
   - Name: `CRON_SECRET`
   - Value: any random 32+ character string (e.g. generate one at https://www.random.org/strings/)
3. Save

## 3. Schedule the cron job

Open `supabase/migrations/20260426_v105_pg_cron_digest.sql`, **replace
`REPLACE_ME`** with the exact same secret you used in step 2, then paste it
into the SQL editor and run.

This:
- Enables `pg_cron` and `pg_net` extensions if needed
- Schedules `send-daily-digest` to fire at the top of every hour
- Stores the cron secret in a database setting that the SQL block reads at run time

To verify: `SELECT * FROM cron.job;` should show the `ok2eat-daily-digest` row.
After the next top-of-the-hour, `SELECT * FROM cron.job_run_details ORDER BY end_time DESC LIMIT 5;`
should show a successful run.

## 4. iOS build

```bash
cd ~/fridgeai-native
git add app.json App.js assets/ supabase/
git commit -m "v1.0.5: avocado icon, unit field, expired filter, multi-select, daily digest"
git push origin main
rm -rf ios
npx expo prebuild -p ios
```

Then open Xcode → Product → Archive → Distribute → App Store Connect → Upload.

## 5. Submit for review

In App Store Connect, create version 1.0.5, attach build 6, fill in release
notes (see proposed copy below), submit for review.

### Proposed release notes

```
v1.0.5
• New avocado app icon
• Receipt scans now save reliably even with partial errors
• Items now have separate amount + unit fields
• New "Expired" filter on the fridge screen
• Multi-select + bulk delete on the fridge list
• Notifications redesigned: one daily digest instead of per-item alerts
```
