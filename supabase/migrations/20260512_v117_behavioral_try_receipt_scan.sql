-- v1.17 — Behavioral trigger: try-receipt-scan
--
-- Fires for users who:
--   • Signed up ≥3 days ago AND ≤30 days ago
--   • Have email confirmed
--   • Have added ≥1 fridge item (so they're activated)
--   • Have NEVER used the receipt-scan feature (no ai_usage row with feature='scan_receipt')
--   • Are still opted in to email digest
--   • Haven't already received this specific email
--
-- The 3-day delay lets them try the "Add a List" multi-add or barcode flow
-- first; we don't want to nag right after the D2 profile-setup nudge.

CREATE OR REPLACE FUNCTION public.eligible_behavioral_try_receipt_scan()
RETURNS TABLE (
  user_id            uuid,
  email              text,
  first_name         text,
  unsubscribe_token  uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    u.id AS user_id,
    u.email,
    COALESCE(
      NULLIF(trim(u.raw_user_meta_data->>'first_name'), ''),
      NULLIF(trim(u.raw_user_meta_data->>'given_name'), ''),
      NULLIF(trim(split_part(u.raw_user_meta_data->>'name',     ' ', 1)), ''),
      NULLIF(trim(split_part(u.raw_user_meta_data->>'full_name',' ', 1)), ''),
      CASE
        WHEN split_part(u.email, '@', 1) ~* '^[a-z][a-z\-_.]{1,20}$'
        THEN initcap(split_part(u.email, '@', 1))
        ELSE 'there'
      END
    ) AS first_name,
    us.unsubscribe_token
  FROM auth.users u
  JOIN public.user_settings us
    ON us.user_id = u.id
  WHERE u.created_at < now() - interval '3 days'
    AND u.created_at > now() - interval '30 days'
    AND u.email_confirmed_at IS NOT NULL
    AND us.email_digest_enabled = true
    -- Must have added at least one item (otherwise the quick_start trigger
    -- handles them; we don't double-message empty-fridge users).
    AND EXISTS (
      SELECT 1 FROM public.fridge_items fi WHERE fi.user_id = u.id
    )
    -- Must have NEVER used receipt scan. ai_usage rows are written by the
    -- scan-receipt Edge Function on every successful call.
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_usage au
      WHERE au.user_id = u.id
        AND au.feature = 'scan_receipt'
        AND au.count > 0
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_email_sends ues
      WHERE ues.user_id = u.id AND ues.email_key = 'behavioral_try_receipt_scan'
    )
  ORDER BY u.created_at ASC
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.eligible_behavioral_try_receipt_scan() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eligible_behavioral_try_receipt_scan() TO service_role;

-- Sanity-check (manual):
--   SELECT count(*) FROM public.eligible_behavioral_try_receipt_scan();
