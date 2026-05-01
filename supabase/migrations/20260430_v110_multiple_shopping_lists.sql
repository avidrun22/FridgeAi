-- v1.1.0: Multiple named shopping lists per household
--
-- The v1.0.9 shopping list was implicitly one-per-household. Greg + wife
-- testing surfaced two shapes of usage that don't fit a single list:
--   "Costco trip"   "Trader Joe's"   "Whole Foods"     — by store
--   "This week"     "Birthday party"  "Camping trip"   — by purpose
--
-- This migration adds a shopping_lists table and a list_id FK on
-- shopping_list_items. Existing items get backfilled into a default list
-- per household so v1.0.9 users don't lose anything.


-- ─── 1. shopping_lists table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.shopping_lists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 100),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_shopping_lists_household
  ON public.shopping_lists(household_id, archived_at NULLS FIRST, created_at);


-- ─── 2. RLS for shopping_lists ───────────────────────────────────────────────

ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;

-- RLS uses EXISTS over household_members (see money_saved migration for
-- the rationale — set-returning helpers can't be used in policy expressions).
DROP POLICY IF EXISTS "members read shopping_lists" ON public.shopping_lists;
CREATE POLICY "members read shopping_lists"
  ON public.shopping_lists
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.user_id = auth.uid()
        AND hm.household_id = shopping_lists.household_id
    )
  );

DROP POLICY IF EXISTS "members insert shopping_lists" ON public.shopping_lists;
CREATE POLICY "members insert shopping_lists"
  ON public.shopping_lists
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.user_id = auth.uid()
        AND hm.household_id = shopping_lists.household_id
    )
  );

DROP POLICY IF EXISTS "members update shopping_lists" ON public.shopping_lists;
CREATE POLICY "members update shopping_lists"
  ON public.shopping_lists
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.user_id = auth.uid()
        AND hm.household_id = shopping_lists.household_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.user_id = auth.uid()
        AND hm.household_id = shopping_lists.household_id
    )
  );

DROP POLICY IF EXISTS "members delete shopping_lists" ON public.shopping_lists;
CREATE POLICY "members delete shopping_lists"
  ON public.shopping_lists
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.user_id = auth.uid()
        AND hm.household_id = shopping_lists.household_id
    )
  );


-- ─── 3. list_id on shopping_list_items + backfill ────────────────────────────

-- Add the column nullable first so existing rows are valid.
ALTER TABLE public.shopping_list_items
  ADD COLUMN IF NOT EXISTS list_id uuid REFERENCES public.shopping_lists(id) ON DELETE CASCADE;

-- Create a default "Shopping list" list per household that has any items
-- (or any household, to be safe — extra empty lists are harmless and the
-- client can show them on first open).
INSERT INTO public.shopping_lists (household_id, name)
SELECT id, 'Shopping list'
FROM public.households h
WHERE NOT EXISTS (
  SELECT 1 FROM public.shopping_lists sl WHERE sl.household_id = h.id
);

-- Backfill list_id for any existing shopping_list_items rows by attaching
-- them to the household's first list (the default we just created).
UPDATE public.shopping_list_items sli
SET list_id = (
  SELECT id FROM public.shopping_lists sl
  WHERE sl.household_id = sli.household_id
  ORDER BY sl.created_at
  LIMIT 1
)
WHERE list_id IS NULL;

-- Now make list_id NOT NULL — every item from now on must belong to a list.
ALTER TABLE public.shopping_list_items
  ALTER COLUMN list_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shopping_list_items_list
  ON public.shopping_list_items(list_id, created_at DESC);


-- ─── 4. Touch updated_at trigger if not already in place ────────────────────

-- (existing v1.0.9 migration created this already; safe to skip.)


-- ─── 5. Sanity check ────────────────────────────────────────────────────────

DO $$
DECLARE
  v_orphan_items int;
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'shopping_lists'
  ), 'shopping_lists table missing';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shopping_list_items'
      AND column_name = 'list_id'
      AND is_nullable = 'NO'
  ), 'shopping_list_items.list_id should be NOT NULL';

  SELECT count(*) INTO v_orphan_items
  FROM public.shopping_list_items
  WHERE list_id IS NULL;
  ASSERT v_orphan_items = 0, 'orphan shopping_list_items remain after backfill';
END;
$$;
