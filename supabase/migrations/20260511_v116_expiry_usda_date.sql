-- v1.16 — Per-item USDA shelf-life date.
--
-- Stores the FoodKeeper-suggested expiry date alongside the user's committed
-- expiry_date. Powers the "USDA says yours is conservative" dual-date display
-- in ItemDetailModal (validates Email 4 tip 4 — "the app shows both, so you
-- stop trashing yogurt that's fine").
--
-- Populated at item-add time from lookupShelfLife() when source = "foodkeeper".
-- NULL for manually-typed items where we don't have a FoodKeeper hit, and for
-- legacy rows that pre-date this column. UI treats NULL as "no USDA suggestion
-- available" and shows only the user's date — same as before.
--
-- This is purely additive. No backfill needed; old items just don't show the
-- USDA secondary line.

alter table public.fridge_items
  add column if not exists expiry_usda_date date;

comment on column public.fridge_items.expiry_usda_date is
  'USDA FoodKeeper-suggested expiry date at item-add time. NULL when no FoodKeeper match. Used by ItemDetailModal to surface the USDA window alongside the user-entered/printed date.';
