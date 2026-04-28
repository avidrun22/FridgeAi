-- v1.0.7: open vs closed expiry tracking for packaged items
--
-- Adds four columns to fridge_items so we can track whether a packaged item
-- has been opened, when it was opened, and the appropriate shelf life in
-- each state. Designed to be reversible: if a user accidentally taps
-- "Open it", we restore the original closed expiry from `expiry_unopened`.
--
-- Existing rows get is_opened=false (column default); the other three
-- columns stay NULL until a user adds a new item or marks one as opened.

ALTER TABLE public.fridge_items
  ADD COLUMN IF NOT EXISTS is_opened           boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opened_at           timestamptz,
  ADD COLUMN IF NOT EXISTS expiry_opened_days  smallint,
  ADD COLUMN IF NOT EXISTS expiry_unopened     date;

-- Sanity-check (manual; run separately):
--   SELECT id, name, is_opened, opened_at, expiry_opened_days, expiry_unopened
--   FROM fridge_items LIMIT 5;
