-- v1.17 — Onboarding email sequence
--
-- Tracks which users have received which one-shot onboarding emails, so
-- send-onboarding-emails can dedupe across cron runs.
--
-- Email keys we currently send (one row per (user_id, email_key)):
--   onboarding_d0  — Welcome (fires within the first hour after signup)
--   onboarding_d2  — Profile setup nudge (~D+2 since signup)
--   onboarding_d5  — Core walkthrough (~D+5)
--   onboarding_d10 — Power user tips (~D+10)
--
-- Future behavioral triggers ("user added items but never opened Eat Me First",
-- etc.) can reuse this table with their own email_key values.
--
-- Opt-out: respected via user_settings.email_digest_enabled. If a user
-- unsubscribes from the daily digest they also stop receiving onboarding
-- emails. (We may split these flags later if onboarding completion is
-- separately valuable; for now we treat all marketing-style email under one
-- preference to honor user intent.)

CREATE TABLE IF NOT EXISTS public.user_email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  -- Resend message id from the API response. NULL if the send threw
  -- (we still insert a row to avoid retrying forever on a permanent failure).
  resend_email_id text,
  status text NOT NULL DEFAULT 'sent',
  error_message text,
  CONSTRAINT user_email_sends_user_key UNIQUE(user_id, email_key)
);

CREATE INDEX IF NOT EXISTS idx_user_email_sends_user
  ON public.user_email_sends(user_id);

CREATE INDEX IF NOT EXISTS idx_user_email_sends_key_sent
  ON public.user_email_sends(email_key, sent_at);

-- Service-role only — these rows aren't user-facing.
ALTER TABLE public.user_email_sends ENABLE ROW LEVEL SECURITY;

-- Sanity-check (manual; not part of the migration):
--   SELECT email_key, count(*) FROM public.user_email_sends GROUP BY email_key;
