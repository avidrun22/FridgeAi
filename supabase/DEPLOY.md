# Deploy the AI Edge Functions

One-time setup to move the Anthropic API key off the mobile client and behind
per-user rate limits.

## Prereqs

- Supabase CLI: `brew install supabase/tap/supabase` (or download from
  https://supabase.com/docs/guides/cli).
- An Anthropic API key: https://console.anthropic.com. Set a monthly spend
  cap of $50 first at https://console.anthropic.com/settings/limits.

## 1. Link the CLI to your project

```bash
cd ~/fridgeai-native
supabase link --project-ref qemarhvgeuzhlwybmbie
```

(Project ref is the subdomain of your Supabase URL.)

## 2. Apply the migration (creates the `ai_usage` table + RPC)

```bash
supabase db push
```

If push complains about schema drift, use `supabase db diff` to inspect and
resolve. Worst case, run the SQL manually via the Supabase dashboard SQL editor.

## 3. Set function secrets

Only the Anthropic key needs to be set; `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the platform.

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Optional overrides (defaults shown):

```bash
supabase secrets set ANTHROPIC_MODEL=claude-haiku-4-5-20251001
supabase secrets set SCAN_RECEIPT_DAILY_LIMIT=10
supabase secrets set GENERATE_RECIPES_DAILY_LIMIT=10
```

## 4. Deploy both functions

```bash
supabase functions deploy scan-receipt
supabase functions deploy generate-recipes
```

## 5. Verify

Get an access token by signing into the iOS app, then from a terminal:

```bash
ACCESS_TOKEN="<paste from the app debug or a session log>"

curl -X POST "https://qemarhvgeuzhlwybmbie.supabase.co/functions/v1/generate-recipes" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"items":["eggs","spinach","cheese"]}'
```

You should get a JSON response with 3 recipes.

## 6. Bump app version and release

Once you confirm the Edge Functions work, the app needs a version bump since
its receipt scanner and recipe generator behaviour changed:

- `app.json`: `version` → `1.0.4`, `buildNumber` → `5`
- Test on your device: open the app, scan a receipt, generate recipes
- Archive, upload, submit for review
