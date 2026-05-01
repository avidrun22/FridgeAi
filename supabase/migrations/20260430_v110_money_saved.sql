-- v1.1.0: Money saved counter
--
-- Greg's testers keep saying "I like the app but I'm not incentivized to keep
-- using it." The honest answer to that gap is to show users the dollar value
-- of food they DIDN'T throw out — every "Use it all" before the expiration
-- date is money they saved by tracking instead of forgetting.
--
-- Two pieces:
--   1. fridge_items.value_cents — estimated dollar value at the time the
--      item was added (from receipt scan price when known, otherwise a
--      category-default fallback computed client-side).
--   2. money_saved_events — append-only log of every "saved" event (item
--      marked used, used_qty=null on handleUse). Stored separately from the
--      item so we still have a record after the item is deleted, and so
--      aggregate queries (this month / lifetime) are fast and clean.
--
-- The aggregate UI (Fridge tab top banner: "Saved $47 this month", Alerts
-- tab: "Lifetime: $312") is computed client-side from money_saved_events
-- rows scoped by RLS to the user's households.


-- ─── 1. Per-item value column on fridge_items ───────────────────────────────

-- value_cents is nullable: existing items without a known price keep null.
-- The client falls back to a category default when computing money saved.
ALTER TABLE public.fridge_items
  ADD COLUMN IF NOT EXISTS value_cents integer
    CHECK (value_cents IS NULL OR value_cents >= 0);

COMMENT ON COLUMN public.fridge_items.value_cents IS
  'Estimated value of this item in cents. From receipt scan when available, otherwise client-side category default.';


-- ─── 2. money_saved_events table ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.money_saved_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id  uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  item_name     text NOT NULL CHECK (length(item_name) <= 200),
  category      text,
  value_cents   integer NOT NULL CHECK (value_cents >= 0),
  saved_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_money_saved_events_household_saved
  ON public.money_saved_events(household_id, saved_at DESC);

CREATE INDEX IF NOT EXISTS idx_money_saved_events_user_saved
  ON public.money_saved_events(user_id, saved_at DESC);


-- ─── 3. RLS — household-scoped, same pattern as fridge_items / shopping_list_items ──

ALTER TABLE public.money_saved_events ENABLE ROW LEVEL SECURITY;

-- RLS uses an EXISTS subquery against household_members rather than the
-- user_household_ids() helper. Postgres rejects set-returning functions in
-- policy expressions ("0A000: set-returning functions are not allowed in
-- policy expressions"), and the existing v1.0.9 policies that use
-- user_household_ids() apparently still work via a runtime quirk we don't
-- want to depend on for new tables.
DROP POLICY IF EXISTS "members read money_saved_events" ON public.money_saved_events;
CREATE POLICY "members read money_saved_events"
  ON public.money_saved_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.user_id = auth.uid()
        AND hm.household_id = money_saved_events.household_id
    )
  );

DROP POLICY IF EXISTS "members insert money_saved_events" ON public.money_saved_events;
CREATE POLICY "members insert money_saved_events"
  ON public.money_saved_events
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.user_id = auth.uid()
        AND hm.household_id = money_saved_events.household_id
    )
  );

-- No update / delete policies — events are append-only by design.


-- ─── 4. Sanity check ─────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'fridge_items'
      AND column_name = 'value_cents'
  ), 'fridge_items.value_cents column missing';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'money_saved_events'
  ), 'money_saved_events table missing';
END;
$$;
