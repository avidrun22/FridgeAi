-- v1.16 — Public scan-receipt rate limiting (per IP).
--
-- Used by the scan-receipt-public Edge Function to throttle anonymous
-- visitors who upload a receipt at ok2eat.com/scan. Two-tier limit:
--   * 3 scans per IP per day (cheap protection vs. one bad actor)
--   * 5 scans per IP per rolling 7-day window (vs. slow drip abuse)
-- Distinct from public.ai_usage which is per-user (authenticated) only.

create table if not exists public.public_scan_usage (
  ip          text  not null,
  day         date  not null,
  count       int   not null default 0,
  primary key (ip, day)
);

-- Lock down direct API access. Edge Functions use the service-role key
-- and bypass RLS. Web clients should NEVER call this table directly.
alter table public.public_scan_usage enable row level security;

-- Atomic increment-and-return RPC. Returns BOTH the daily count (after
-- increment) and the rolling-7-day count so the Edge Function can enforce
-- both limits in a single round-trip.
create or replace function public.increment_public_scan_usage(p_ip text)
returns table (daily_count int, weekly_count int)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Atomic upsert + increment for today's row
  insert into public.public_scan_usage(ip, day, count)
  values (p_ip, current_date, 1)
  on conflict (ip, day) do update
    set count = public.public_scan_usage.count + 1;

  -- Return both counters in one row
  return query
    select
      (
        select count
        from public.public_scan_usage
        where ip = p_ip and day = current_date
      )::int as daily_count,
      (
        select coalesce(sum(count), 0)
        from public.public_scan_usage
        where ip = p_ip and day >= current_date - interval '6 days'
      )::int as weekly_count;
end;
$$;

-- Daily cleanup: drop rows older than 30 days. Run via pg_cron once a week.
-- Optional — can also leave the table to grow; rows are tiny.
create or replace function public.cleanup_public_scan_usage()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.public_scan_usage where day < current_date - interval '30 days';
$$;

comment on table public.public_scan_usage is
  'Per-IP daily rate limit counter for ok2eat.com/scan anonymous receipt uploads. Two-tier check: 3/day + 5/rolling-7-days.';
