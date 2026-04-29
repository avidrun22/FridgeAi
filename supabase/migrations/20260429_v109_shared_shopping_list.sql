-- v1.0.9: shared shopping list
--
-- The v1.0.8 shopping list was AsyncStorage-only (device-local) — pragmatic
-- shortcut to ship the Plan tab faster. Real-user testing surfaced the gap:
-- if our households share the fridge, our shopping list should be shared too.
--
-- This migration adds a new server-side `shopping_list_items` table scoped
-- by household_id with the same RLS pattern as `fridge_items`. The v1.0.9
-- iOS client reads/writes through Supabase instead of AsyncStorage.
--
-- v1.0.8 clients still on the AsyncStorage version stay isolated (their list
-- doesn't sync) — they upgrade to v1.0.9 to get the shared experience.


-- ─── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.shopping_list_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 200),
  checked       boolean NOT NULL DEFAULT false,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopping_list_items_household
  ON public.shopping_list_items(household_id, created_at DESC);


-- ─── 2. RLS — household-scoped read/write ───────────────────────────────────

ALTER TABLE public.shopping_list_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read shopping list" ON public.shopping_list_items;
CREATE POLICY "members read shopping list" ON public.shopping_list_items
  FOR SELECT USING (household_id IN (SELECT public.user_household_ids()));

DROP POLICY IF EXISTS "members insert shopping list" ON public.shopping_list_items;
CREATE POLICY "members insert shopping list" ON public.shopping_list_items
  FOR INSERT WITH CHECK (household_id IN (SELECT public.user_household_ids()));

DROP POLICY IF EXISTS "members update shopping list" ON public.shopping_list_items;
CREATE POLICY "members update shopping list" ON public.shopping_list_items
  FOR UPDATE
  USING (household_id IN (SELECT public.user_household_ids()))
  WITH CHECK (household_id IN (SELECT public.user_household_ids()));

DROP POLICY IF EXISTS "members delete shopping list" ON public.shopping_list_items;
CREATE POLICY "members delete shopping list" ON public.shopping_list_items
  FOR DELETE USING (household_id IN (SELECT public.user_household_ids()));


-- ─── 3. Trigger to keep updated_at fresh ────────────────────────────────────
--
-- Useful when we add Realtime subscriptions later — clients can sort by
-- updated_at to detect re-orderings.

CREATE OR REPLACE FUNCTION public.shopping_list_items_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shopping_list_items_touch ON public.shopping_list_items;
CREATE TRIGGER trg_shopping_list_items_touch
  BEFORE UPDATE ON public.shopping_list_items
  FOR EACH ROW EXECUTE FUNCTION public.shopping_list_items_touch_updated_at();


-- ─── 4. Sanity-check (manual) ───────────────────────────────────────────────
--
--   SELECT count(*) FROM public.shopping_list_items;  -- should be 0 initially
