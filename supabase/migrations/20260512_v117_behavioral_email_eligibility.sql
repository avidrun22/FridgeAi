-- v1.17 — Behavioral email eligibility helpers
--
-- One Postgres function per behavioral trigger. Each returns the candidate
-- users for that trigger as (user_id, email, first_name, unsubscribe_token).
-- The Edge Function calls these via supa.rpc(<name>) and handles rendering
-- + sending + per-user dedupe insert into user_email_sends.
--
-- Returning first_name here keeps the merge-tag logic in one place (DB knows
-- the user metadata; the function doesn't have to re-parse it).

-- ─── behavioral_quick_start ────────────────────────────────────────────────
-- Fires for users who:
--   • Signed up ≥24h ago (so the D0 welcome has had time to land)
--   • Signed up ≤14d ago (avoid welcoming ancient signups back)
--   • Have email confirmed (Supabase Auth required this)
--   • Haven't added a single fridge item yet
--   • Are still opted in to email digest
--   • Haven't already received this specific email
--
-- Returns at most 200 users per call to keep a single cron tick bounded.

CREATE OR REPLACE FUNCTION public.eligible_behavioral_quick_start()
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
      -- Last-ditch: capitalize local-part of email if it looks human
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
  WHERE u.created_at < now() - interval '24 hours'
    AND u.created_at > now() - interval '14 days'
    AND u.email_confirmed_at IS NOT NULL
    AND us.email_digest_enabled = true
    AND NOT EXISTS (
      SELECT 1 FROM public.fridge_items fi WHERE fi.user_id = u.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_email_sends ues
      WHERE ues.user_id = u.id AND ues.email_key = 'behavioral_quick_start'
    )
  ORDER BY u.created_at ASC  -- oldest-eligible first (closest to falling off the 14d window)
  LIMIT 200;
$$;

-- Service-role only — invoked from the Edge Function via supabase-js rpc().
REVOKE ALL ON FUNCTION public.eligible_behavioral_quick_start() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eligible_behavioral_quick_start() TO service_role;

-- Sanity-check (manual; not part of the migration):
--   SELECT count(*) FROM public.eligible_behavioral_quick_start();
