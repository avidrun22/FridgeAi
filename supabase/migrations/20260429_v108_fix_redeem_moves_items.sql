-- v1.0.8 hotfix: fix shared-household redemption so the joining user's
-- items move with them into the new household.
--
-- Bug discovered 2026-04-29 during real-user testing:
--   When a user redeemed an invite, the RPC moved them from their old
--   household to the new one — but their fridge_items stayed pinned to
--   the old household_id. Because the legacy RLS policy on fridge_items
--   (kept for v1.0.6/v1.0.7 client compat) reads with `user_id = auth.uid()`,
--   the joining user could still SEE their old items, mixed in with the
--   new shared household's items. Looked like a duplicated/confused fridge.
--
-- Two-part fix:
--   1. Replace `redeem_household_invite` with a version that moves the
--      joining user's items into the new household, then cleans up their
--      now-empty old household.
--   2. One-time cleanup of the current bad state: for any user whose items
--      are pinned to a household they're no longer a member of, move those
--      items to their CURRENT household. Then drop any orphaned (no
--      members, no items) household rows.
--
-- Idempotent: safe to re-run.


-- ─── 1. Updated redeem_household_invite ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.redeem_household_invite(p_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invite          public.household_invites%ROWTYPE;
  v_old_household   uuid;
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

  -- Capture the user's current household (if any) BEFORE we leave it
  SELECT household_id INTO v_old_household
    FROM public.household_members
    WHERE user_id = auth.uid()
    LIMIT 1;

  -- Move the user's items into the new household so they don't get
  -- orphaned. Joining a household consolidates inventory.
  IF v_old_household IS NOT NULL THEN
    UPDATE public.fridge_items
      SET household_id = v_invite.household_id
      WHERE user_id = auth.uid() AND household_id = v_old_household;
  END IF;

  -- Enforce one-household-per-user invariant: leave the old one first
  DELETE FROM public.household_members WHERE user_id = auth.uid();

  -- Join the new household
  INSERT INTO public.household_members (household_id, user_id)
    VALUES (v_invite.household_id, auth.uid());

  -- Mark invite redeemed
  UPDATE public.household_invites
    SET used_by_user_id = auth.uid()
    WHERE code = v_invite.code;

  -- Clean up the old household if it's now empty (no members AND no items).
  -- Avoids a graveyard of empty household rows accumulating.
  IF v_old_household IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.household_members WHERE household_id = v_old_household
  ) AND NOT EXISTS (
    SELECT 1 FROM public.fridge_items WHERE household_id = v_old_household
  ) THEN
    DELETE FROM public.households WHERE id = v_old_household;
  END IF;

  RETURN v_invite.household_id;
END;
$$;


-- ─── 2. One-time cleanup of the current bad state ───────────────────────────

-- For any item where the owner (user_id) is currently a member of a DIFFERENT
-- household than the item's household_id, reassign the item to the owner's
-- current household. Uses IS DISTINCT FROM (not <>) so it ALSO catches items
-- with NULL household_id — those come from v1.0.6/v1.0.7 clients that wrote
-- before the household_id column existed. This rescues both kinds of orphans
-- in one pass.
UPDATE public.fridge_items fi
SET household_id = hm.household_id
FROM public.household_members hm
WHERE fi.user_id = hm.user_id
  AND fi.household_id IS DISTINCT FROM hm.household_id;

-- Drop any households that are completely empty (no members AND no items).
DELETE FROM public.households h
WHERE NOT EXISTS (
    SELECT 1 FROM public.household_members hm WHERE hm.household_id = h.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.fridge_items fi WHERE fi.household_id = h.id
  );


-- ─── 3. Sanity-checks (manual; run separately) ──────────────────────────────
--
--   -- Should be 0: items pinned to a household the owner isn't a member of.
--   SELECT count(*)
--   FROM public.fridge_items fi
--   LEFT JOIN public.household_members hm
--     ON hm.user_id = fi.user_id AND hm.household_id = fi.household_id
--   WHERE hm.user_id IS NULL;
--
--   -- Should be 0: empty households.
--   SELECT count(*) FROM public.households h
--   WHERE NOT EXISTS (
--     SELECT 1 FROM public.household_members hm WHERE hm.household_id = h.id
--   ) AND NOT EXISTS (
--     SELECT 1 FROM public.fridge_items fi WHERE fi.household_id = h.id
--   );
