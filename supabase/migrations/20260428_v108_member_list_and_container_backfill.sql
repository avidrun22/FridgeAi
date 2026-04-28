-- v1.0.8 part 3: member listing RPC + section→container backfill
--
-- Two more pieces to round out the household + container backend:
--
-- 1. list_household_members() — RLS on household_members only lets a user
--    read their own row, which means a SELECT can't show "Greg + Jess".
--    This SECURITY DEFINER RPC bypasses that for the user's own household.
--
-- 2. Backfill container from section. The v1.0.7 app stores a per-item
--    "section" field with values like 'fridge' / 'cupboard'. The v1.0.8
--    container column defaulted everything to 'fridge'. Map cupboard→pantry
--    so existing items show up in the right new bucket. Idempotent.


-- ─── 1. list_household_members RPC ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_household_members()
RETURNS TABLE (
  user_id     uuid,
  email       text,
  joined_at   timestamptz,
  is_owner    boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $fn$
  WITH my_hh AS (
    SELECT household_id
      FROM public.household_members
      WHERE user_id = auth.uid()
      LIMIT 1
  )
  SELECT
    hm.user_id,
    u.email::text,
    hm.joined_at,
    (hm.user_id = h.owner_user_id) AS is_owner
  FROM public.household_members hm
  JOIN auth.users u   ON u.id = hm.user_id
  JOIN public.households h ON h.id = hm.household_id
  WHERE hm.household_id = (SELECT household_id FROM my_hh)
  ORDER BY (hm.user_id = h.owner_user_id) DESC, hm.joined_at;
$fn$;

GRANT EXECUTE ON FUNCTION public.list_household_members() TO authenticated;


-- ─── 2. section → container backfill ──────────────────────────────────────

UPDATE public.fridge_items
SET container = CASE section
  WHEN 'cupboard' THEN 'pantry'
  WHEN 'fridge'   THEN 'fridge'
  WHEN 'pantry'   THEN 'pantry'
  WHEN 'freezer'  THEN 'freezer'
  ELSE 'fridge'
END
WHERE container <> CASE section
  WHEN 'cupboard' THEN 'pantry'
  WHEN 'fridge'   THEN 'fridge'
  WHEN 'pantry'   THEN 'pantry'
  WHEN 'freezer'  THEN 'freezer'
  ELSE 'fridge'
END;


-- ─── 3. Sanity-checks ─────────────────────────────────────────────────────
--
--   SELECT public.list_household_members();
--     -- returns rows for everyone in your household
--
--   SELECT container, count(*) FROM fridge_items GROUP BY container;
--     -- shows the new distribution after backfill
