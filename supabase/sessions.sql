-- Session-based booking migration: run in the Supabase SQL editor (idempotent).
--
-- A day has exactly two claimable units: a MORNING session and an AFTERNOON
-- session. A booking stores which session it is; the `time` column is kept as
-- a plain timestamp for display (the session's window start) so existing
-- dashboards keep working. Double-booking is impossible by construction:
-- a partial unique index allows only one non-cancelled booking per (date, session).

-- 1. Settings: a single row (id must be 1) with the owner's windows.
create table if not exists public.settings (
  id integer primary key default 1 check (id = 1),
  morning_start time not null default '09:00',
  morning_end time not null default '12:00',
  afternoon_start time not null default '13:00',
  afternoon_end time not null default '17:00'
);

insert into public.settings (id)
values (1)
on conflict (id) do nothing;

alter table public.settings drop column if exists slot_minutes;

-- is_owner() may not exist yet on a fresh install (client-accounts.sql runs
-- before this in the README, but sessions.sql should be self-sufficient).
create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'owner'
  );
$$;

-- settings: everyone may read (the site needs it to render sessions);
-- only the owner may change it.
alter table public.settings enable row level security;

drop policy if exists "public view settings" on public.settings;
create policy "public view settings" on public.settings
  for select to anon, authenticated
  using (true);

drop policy if exists "owner manage settings" on public.settings;
create policy "owner manage settings" on public.settings
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

grant select on public.settings to anon;
grant select, insert, update, delete on public.settings to authenticated;

-- 2. bookings: add the session column, backfill from the old time column,
--    keep `time` for display (window start below). The old slot-grid model
--    (unique (date,time) index) is superseded and its index is dropped.
alter table public.bookings
  add column if not exists session text check (session in ('morning', 'afternoon'));

update public.bookings
set session = case when time < '12:00' then 'morning' else 'afternoon' end
where session is null;

alter table public.bookings alter column session set not null;

drop index if exists bookings_one_per_slot;

-- 3. Resolve any duplicate active bookings created by the old slot-grid model
--    (multiple times on one date collapsed into one session on backfill).
--    First-come-first-served: the earliest created_at keeps the session, the
--    rest become cancelled. Cancelled rows are excluded from the unique index,
--    and the record is preserved for the owner. Idempotent — no-op once clean.
with ranked as (
  select id, date, session,
         row_number() over (
           partition by date, session
           order by created_at, id
         ) as rn
  from public.bookings
  where status in ('pending', 'confirmed')
)
update public.bookings b
set status = 'cancelled'
from ranked r
where b.id = r.id and r.rn > 1;

-- 4. One active booking per (date, session) — the actual double-booking guard.
-- Cancelled bookings release the session (excluded from the index).
create unique index if not exists bookings_one_per_session
  on public.bookings (date, session)
  where status in ('pending', 'confirmed');


-- 5. create_booking() only accepts morning/afternoon, stamps `time` with the
--    session's window start, and turns a collision into a friendly message.
-- Drop the old slot-timing overload first: its signature differs, so plain
-- create-or-replace would leave both behind and make the grant ambiguous.
drop function if exists public.create_booking(bigint, date, time, text, text, text);
create or replace function public.create_booking(
  p_service_id bigint,
  p_date date,
  p_session text,
  p_name text,
  p_email text default null,
  p_phone text default null
) returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
  new_id bigint;
  s public.settings;
  v_time time;
begin
  if p_session not in ('morning', 'afternoon') then
    raise exception 'Session must be morning or afternoon.';
  end if;

  select * into s from public.settings where id = 1;

  v_time := case when p_session = 'morning' then s.morning_start else s.afternoon_start end;

  begin
    insert into public.bookings
      (service_id, date, time, session, customer_name, customer_email, customer_phone, customer_id)
    values
      (p_service_id, p_date, v_time, p_session, p_name, p_email, p_phone, auth.uid())
    returning id into new_id;
  exception
    when unique_violation then
      raise exception 'That session was just taken. Pick the other one or another day.';
  end;

  return new_id;
end;
$$;

grant execute on function public.create_booking to anon, authenticated;

-- /api/sessions reads availability as anon (server/index.js). Without an anon
-- SELECT policy, RLS hides every booking row and the calendar shows nothing
-- taken. Grant only the bare columns availability needs -- never customer data.
grant select (date, session, status) on public.bookings to anon;
drop policy if exists "public view availability" on public.bookings;
create policy "public view availability" on public.bookings
  for select to anon
  using (true);