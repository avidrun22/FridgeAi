-- Per-user-per-day counters for AI-backed features. Used by Edge Functions
-- to enforce daily rate limits. One row per (user, day, feature) pair.

CREATE TABLE IF NOT EXISTS public.ai_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  feature text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, usage_date, feature)
);

-- RLS: users can read their own rows. Writes happen via service_role
-- inside Edge Functions, which bypasses RLS — users never write directly.
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own ai_usage" ON public.ai_usage;
CREATE POLICY "users read own ai_usage"
  ON public.ai_usage
  FOR SELECT
  USING (auth.uid() = user_id);

-- Atomic increment helper so the Edge Function can bump a counter in one
-- query without race conditions. Returns the new count after incrementing.
CREATE OR REPLACE FUNCTION public.increment_ai_usage(
  p_user_id uuid,
  p_feature text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO public.ai_usage (user_id, usage_date, feature, count, updated_at)
  VALUES (p_user_id, CURRENT_DATE, p_feature, 1, now())
  ON CONFLICT (user_id, usage_date, feature)
  DO UPDATE SET count = ai_usage.count + 1, updated_at = now()
  RETURNING count INTO new_count;
  RETURN new_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_ai_usage(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_ai_usage(uuid, text) TO service_role;
