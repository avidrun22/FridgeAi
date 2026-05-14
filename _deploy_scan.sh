#!/usr/bin/env bash
# One-paste deploy for ok2eat.com/scan (v1.16).
# Migration + Edge Function + secrets + website. Run from anywhere.
set -euo pipefail

REPO="${HOME}/fridgeai-native"
cd "${REPO}"

echo "==> 1/4 Apply DB migration (public_scan_usage table + RPC)"
supabase db push

echo "==> 2/4 Deploy scan-receipt-public Edge Function (no JWT)"
supabase functions deploy scan-receipt-public --no-verify-jwt

echo "==> 3/4 Set Edge Function secrets"
supabase secrets set \
  PUBLIC_SCAN_DAILY_LIMIT=3 \
  PUBLIC_SCAN_WEEKLY_LIMIT=5 \
  PUBLIC_SCAN_ALLOWED_ORIGINS="https://ok2eat.com,https://www.ok2eat.com"

echo "==> 4/4 Deploy marketing site (includes /scan/ + nav update)"
python3 scripts/deploy_website.py --message "v1.16.1 — /scan receipt scanner page + 3/day 5/week limits"

echo ""
echo "Done. Verify at https://ok2eat.com/scan"
