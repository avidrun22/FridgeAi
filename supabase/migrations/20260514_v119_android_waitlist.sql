-- v1.19 — Android waitlist
-- ==============================================================
-- One row per email that signed up to be notified when ok2eat for Android
-- ships in Google Play (v1.21+). Captured from the homepage CTA below the
-- App Store + web app buttons. Mirrored to a Resend audience for the
-- eventual "Android is live" blast, but the table is the source of truth
-- for analytics + dedup.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS, ON CONFLICT DO NOTHING patterns).
-- ==============================================================

-- citext makes the unique email index case-insensitive
-- (greg@example.com == GREG@example.com). Must be created BEFORE the table
-- that uses the type — Postgres parses column types eagerly.
create extension if not exists citext;

create table if not exists public.android_waitlist (
  id           bigserial primary key,
  email        citext not null unique,
  source       text,                       -- e.g. "/" or "/blog/..." — where they signed up
  signed_up_at timestamptz not null default now(),
  notified_at  timestamptz,                -- set when we send the "Android is live" email
  ua_country   text,                       -- optional, from Edge Function geo header
  notes        text
);

-- Convenience index: signup timeline + sourced-from-page queries.
create index if not exists android_waitlist_signed_up_at_idx
  on public.android_waitlist (signed_up_at desc);
create index if not exists android_waitlist_source_idx
  on public.android_waitlist (source);

-- RLS: no public access. Edge Function uses service-role to insert.
alter table public.android_waitlist enable row level security;

drop policy if exists android_waitlist_service_role_all on public.android_waitlist;
create policy android_waitlist_service_role_all
  on public.android_waitlist for all
  to service_role
  using (true) with check (true);

-- Sanity-check (manual; run separately):
--   SELECT count(*) FROM android_waitlist;
--   SELECT source, count(*) FROM android_waitlist GROUP BY source ORDER BY 2 DESC;
--   SELECT signed_up_at, email, source FROM android_waitlist ORDER BY signed_up_at DESC LIMIT 20;
