-- v1.0.6 email digest support
-- Extends user_settings with three new columns:
--   1. email_digest_enabled — opt-in toggle for the email channel (separate
--      from notifications_enabled, which controls the push channel).
--   2. unsubscribe_token — one-click unsubscribe URL token included in every
--      email footer; flipping email_digest_enabled to false.
--   3. last_email_sent_at — when we last delivered a digest; used for
--      de-dup, analytics, and "haven't seen them in N days" suppression.
--
-- Existing users default to email_digest_enabled=true (mirrors push opt-in).
-- New users will be set to true on insert via app onboarding.

-- 1. opt-in
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS email_digest_enabled boolean NOT NULL DEFAULT true;

-- 2. unsubscribe token (uuid per user, regenerated on insert)
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid();

-- 3. last email sent
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS last_email_sent_at timestamptz;

-- Index so unsubscribe-by-token lookups stay fast even at scale
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_unsubscribe_token
  ON public.user_settings(unsubscribe_token);

-- Backfill: existing rows already got email_digest_enabled=true from the
-- column default. The unsubscribe_token default also auto-populated. No
-- additional UPDATE needed.

-- Sanity-check (manual; not part of the migration):
--   SELECT user_id, email_digest_enabled, unsubscribe_token, last_email_sent_at
--   FROM public.user_settings LIMIT 10;
