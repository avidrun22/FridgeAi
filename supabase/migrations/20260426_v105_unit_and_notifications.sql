-- v1.0.5 schema additions:
-- 1. unit column on fridge_items (separate amount + unit display)
-- 2. user_settings for notification preferences
-- 3. expo_push_tokens for sending the daily digest

-- ─── 1. unit column on fridge_items ──────────────────────────────────────────
ALTER TABLE public.fridge_items
  ADD COLUMN IF NOT EXISTS unit text;


-- ─── 2. user_settings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  notifications_enabled boolean NOT NULL DEFAULT true,
  digest_hour smallint NOT NULL DEFAULT 9
    CHECK (digest_hour BETWEEN 0 AND 23),
  digest_timezone text NOT NULL DEFAULT 'America/Los_Angeles',
  expiring_within_days smallint NOT NULL DEFAULT 3
    CHECK (expiring_within_days BETWEEN 1 AND 14),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own settings" ON public.user_settings;
CREATE POLICY "users read own settings"
  ON public.user_settings
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users upsert own settings" ON public.user_settings;
CREATE POLICY "users upsert own settings"
  ON public.user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users update own settings" ON public.user_settings;
CREATE POLICY "users update own settings"
  ON public.user_settings
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ─── 3. expo_push_tokens ─────────────────────────────────────────────────────
-- One row per device. A user can have many devices; we send to all active ones.
CREATE TABLE IF NOT EXISTS public.expo_push_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_name text,
  platform text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user
  ON public.expo_push_tokens(user_id);

ALTER TABLE public.expo_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own tokens" ON public.expo_push_tokens;
CREATE POLICY "users read own tokens"
  ON public.expo_push_tokens
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users insert own tokens" ON public.expo_push_tokens;
CREATE POLICY "users insert own tokens"
  ON public.expo_push_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users update own tokens" ON public.expo_push_tokens;
CREATE POLICY "users update own tokens"
  ON public.expo_push_tokens
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users delete own tokens" ON public.expo_push_tokens;
CREATE POLICY "users delete own tokens"
  ON public.expo_push_tokens
  FOR DELETE USING (auth.uid() = user_id);
