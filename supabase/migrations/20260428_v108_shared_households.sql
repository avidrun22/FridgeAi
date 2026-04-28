-- v1.0.8 (or later) groundwork: shared household inventory
--
-- One household per user, equal access for all members. Existing users get
-- auto-backfilled into a personal household so nothing breaks for them.
-- The legacy user_id-based RLS policy on fridge_items stays in place so
-- v1.0.6/v1.0.7 clients keep working until they update.
--
-- Apply via Supabase SQL Editor while users are on v1.0.6 or v1.0.7. The
-- migration is intentionally additive — nothing is removed or renamed.


-- ─── 1. Tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.households (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL DEFAULT 'My Household',
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.household_members (
  household_id  uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id),
  -- One household per user invariant
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_household_members_user
  ON public.household_members(user_id);

CREATE TABLE IF NOT EXISTS public.household_invites (
  code              text PRIMARY KEY,
  household_id      uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  created_by        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_by_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_household_invites_household
  ON public.household_invites(household_id);


-- ─── 2. Add household_id to fridge_items ────────────────────────────────────

ALTER TABLE public.fridge_items
  ADD COLUMN IF NOT EXISTS household_id uuid REFERENCES public.households(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_fridge_items_household
  ON public.fridge_items(household_id);


-- ─── 3. Backfill: a household per existing user ─────────────────────────────
--
-- For every user in auth.users, create a household and add them as a member.
-- For every existing fridge_item, populate household_id from its owner's
-- backfilled household. Items with NULL user_id are skipped (shouldn't exist).

DO $$
DECLARE
  rec RECORD;
  v_household_id uuid;
BEGIN
  FOR rec IN SELECT id FROM auth.users LOOP
    -- Skip if user already has a household member row (re-running this script)
    IF EXISTS (SELECT 1 FROM public.household_members WHERE user_id = rec.id) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.households (owner_user_id)
      VALUES (rec.id)
      RETURNING id INTO v_household_id;

    INSERT INTO public.household_members (household_id, user_id)
      VALUES (v_household_id, rec.id);

    UPDATE public.fridge_items
      SET household_id = v_household_id
      WHERE user_id = rec.id AND household_id IS NULL;
  END LOOP;
END $$;


-- ─── 4. RLS helper — break recursion via SECURITY DEFINER ───────────────────
--
-- A naïve policy like USING (household_id IN (SELECT household_id FROM
-- household_members WHERE user_id = auth.uid())) hits infinite recursion:
-- the inner SELECT itself triggers the household_members policy, which
-- queries household_members again. PostgreSQL aborts with an error.
--
-- This helper bypasses RLS internally (SECURITY DEFINER) so we can use it
-- safely in policies WITHOUT the recursion path.

CREATE OR REPLACE FUNCTION public.user_household_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT household_id FROM public.household_members WHERE user_id = auth.uid();
$fn$;

GRANT EXECUTE ON FUNCTION public.user_household_ids() TO authenticated;


-- ─── 5. RLS — new tables ─────────────────────────────────────────────────────

ALTER TABLE public.households         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_invites  ENABLE ROW LEVEL SECURITY;

-- household_members: simplest non-recursive policy — users see their own row.
-- (UI listing of fellow members will go through a SECURITY DEFINER RPC.)
DROP POLICY IF EXISTS "users read own membership" ON public.household_members;
CREATE POLICY "users read own membership" ON public.household_members
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "household members can leave" ON public.household_members;
CREATE POLICY "household members can leave" ON public.household_members
  FOR DELETE USING (user_id = auth.uid());

-- households: read/update via the helper.
DROP POLICY IF EXISTS "members read own household" ON public.households;
CREATE POLICY "members read own household" ON public.households
  FOR SELECT USING (id IN (SELECT public.user_household_ids()));

DROP POLICY IF EXISTS "members update own household" ON public.households;
CREATE POLICY "members update own household" ON public.households
  FOR UPDATE
  USING (id IN (SELECT public.user_household_ids()))
  WITH CHECK (id IN (SELECT public.user_household_ids()));

-- household_invites: members can list invites for their household.
DROP POLICY IF EXISTS "members read own invites" ON public.household_invites;
CREATE POLICY "members read own invites" ON public.household_invites
  FOR SELECT USING (household_id IN (SELECT public.user_household_ids()));


-- ─── 6. RLS — additive policies on fridge_items ─────────────────────────────
--
-- Existing "user_id = auth.uid()" policies stay in place for backwards
-- compatibility (v1.0.6/v1.0.7 clients keep working). We add new household-
-- scoped policies that v1.0.8+ clients will use.

DROP POLICY IF EXISTS "members read fridge_items" ON public.fridge_items;
CREATE POLICY "members read fridge_items" ON public.fridge_items
  FOR SELECT USING (household_id IN (SELECT public.user_household_ids()));

DROP POLICY IF EXISTS "members insert fridge_items" ON public.fridge_items;
CREATE POLICY "members insert fridge_items" ON public.fridge_items
  FOR INSERT WITH CHECK (household_id IN (SELECT public.user_household_ids()));

DROP POLICY IF EXISTS "members update fridge_items" ON public.fridge_items;
CREATE POLICY "members update fridge_items" ON public.fridge_items
  FOR UPDATE
  USING (household_id IN (SELECT public.user_household_ids()))
  WITH CHECK (household_id IN (SELECT public.user_household_ids()));

DROP POLICY IF EXISTS "members delete fridge_items" ON public.fridge_items;
CREATE POLICY "members delete fridge_items" ON public.fridge_items
  FOR DELETE USING (household_id IN (SELECT public.user_household_ids()));


-- ─── 6. Helper RPC functions ────────────────────────────────────────────────
--
-- Three SECURITY DEFINER functions the app calls instead of touching invite
-- rows directly. Keeps invite codes from being enumerable.

-- Idempotent: returns the user's existing household, or creates one.
-- Called from the app on login as a safety net (the backfill above handles
-- existing users; this covers anyone created post-migration if a trigger
-- isn't set up).
CREATE OR REPLACE FUNCTION public.ensure_household_for_user()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_household_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'must be authenticated';
  END IF;

  SELECT household_id INTO v_household_id
    FROM public.household_members
    WHERE user_id = auth.uid()
    LIMIT 1;

  IF v_household_id IS NOT NULL THEN
    RETURN v_household_id;
  END IF;

  INSERT INTO public.households (owner_user_id)
    VALUES (auth.uid())
    RETURNING id INTO v_household_id;

  INSERT INTO public.household_members (household_id, user_id)
    VALUES (v_household_id, auth.uid());

  RETURN v_household_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_household_for_user() TO authenticated;


-- Generates a 6-character invite code and stores the row. Returns the code.
CREATE OR REPLACE FUNCTION public.create_household_invite(p_household_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code     text;
  v_attempts int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'must be authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = p_household_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not a member of this household';
  END IF;

  -- Try until we hit a unique code (collision-rate is ~0 for 6 chars upper)
  LOOP
    v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    BEGIN
      INSERT INTO public.household_invites (code, household_id, created_by)
        VALUES (v_code, p_household_id, auth.uid());
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_attempts := v_attempts + 1;
      IF v_attempts > 10 THEN
        RAISE EXCEPTION 'failed to generate unique invite code';
      END IF;
    END;
  END LOOP;

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_household_invite(uuid) TO authenticated;


-- Redeems an invite. Removes the user from any current household (the
-- one-household-per-user invariant), adds them to the invited household,
-- marks the invite used. Returns the joined household_id.
CREATE OR REPLACE FUNCTION public.redeem_household_invite(p_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invite public.household_invites%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'must be authenticated';
  END IF;

  SELECT * INTO v_invite
    FROM public.household_invites
    WHERE code = upper(trim(p_code));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid invite code';
  END IF;

  IF v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'invite expired';
  END IF;

  IF v_invite.used_by_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'invite already used';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = v_invite.household_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'already a member of this household';
  END IF;

  -- Enforce one-household-per-user: leave the current household first
  DELETE FROM public.household_members WHERE user_id = auth.uid();

  INSERT INTO public.household_members (household_id, user_id)
    VALUES (v_invite.household_id, auth.uid());

  UPDATE public.household_invites
    SET used_by_user_id = auth.uid()
    WHERE code = v_invite.code;

  RETURN v_invite.household_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_household_invite(text) TO authenticated;


-- ─── 7. Sanity-checks (manual; run separately if desired) ───────────────────
--
--   SELECT count(*) FROM households;             -- should equal auth.users count
--   SELECT count(*) FROM household_members;      -- same
--   SELECT count(*) FROM fridge_items WHERE household_id IS NULL;  -- should be 0
--   SELECT public.ensure_household_for_user();   -- idempotent; returns your hh id
