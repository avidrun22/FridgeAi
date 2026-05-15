-- v1.22 — Business waitlist
-- ==============================================================
-- One row per business inquiry from the /for-business landing page on
-- ok2eat.com. Richer than android_waitlist because B2B leads need more
-- qualification before we know whether to invest in the Toast Retail
-- integration + small-business pricing tier discussed in the
-- 2026-05-15 r/InventoryManagement post that surfaced this opportunity.
--
-- Fields are loosely structured — we want low form friction (people
-- abandon long forms) but enough signal to triage which leads are
-- worth a 30-min call vs. an async email. Business_type, pos_system,
-- and sku_count_range are dropdown-constrained for analytics; the rest
-- are free text.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS).
-- ==============================================================

-- citext for case-insensitive email uniqueness — same pattern as
-- android_waitlist. Extension is already created from v1.19 but the
-- IF NOT EXISTS guard keeps re-runs safe.
create extension if not exists citext;

create table if not exists public.business_waitlist (
  id              bigserial primary key,
  -- Contact info
  email           citext not null unique,
  contact_name    text,
  phone           text,                       -- optional; some users opt out of phone
  -- Business
  business_name   text not null,
  business_type   text,                       -- "grocery" | "cafe" | "restaurant" | "catering" | "juice_bar" | "butcher" | "convenience" | "other"
  location_count  int,                        -- 1, 2-5, 6-20, 20+ (stored as exact int when provided)
  sku_count_range text,                       -- "<100" | "100-500" | "500-1000" | "1000-5000" | "5000+"
  pos_system      text,                       -- "toast" | "square" | "clover" | "lightspeed" | "aloha" | "other" | "none"
  description     text,                       -- free-text: what they're trying to solve
  -- Metadata
  source          text,                       -- referrer page or campaign tag
  ua_country      text,                       -- optional geo signal from edge headers
  signed_up_at    timestamptz not null default now(),
  contacted_at    timestamptz,                -- set when Greg replies / books a call
  qualified       boolean,                    -- true if worth pursuing, false if not, null if untriaged
  notes           text                        -- internal triage notes
);

-- Convenience indexes
create index if not exists business_waitlist_signed_up_at_idx
  on public.business_waitlist (signed_up_at desc);
create index if not exists business_waitlist_qualified_idx
  on public.business_waitlist (qualified)
  where qualified is not null;
create index if not exists business_waitlist_business_type_idx
  on public.business_waitlist (business_type)
  where business_type is not null;
create index if not exists business_waitlist_pos_system_idx
  on public.business_waitlist (pos_system)
  where pos_system is not null;

-- RLS: no public access. Edge Function uses service-role to insert.
alter table public.business_waitlist enable row level security;

drop policy if exists business_waitlist_service_role_all on public.business_waitlist;
create policy business_waitlist_service_role_all
  on public.business_waitlist for all
  to service_role
  using (true) with check (true);

-- Sanity-check queries (run manually after the form is live):
--   SELECT count(*) FROM business_waitlist;
--   SELECT business_type, count(*) FROM business_waitlist GROUP BY 1 ORDER BY 2 DESC;
--   SELECT pos_system, count(*) FROM business_waitlist GROUP BY 1 ORDER BY 2 DESC;
--   SELECT signed_up_at, business_name, business_type, pos_system, sku_count_range
--   FROM business_waitlist
--   WHERE qualified IS NULL
--   ORDER BY signed_up_at DESC
--   LIMIT 20;
