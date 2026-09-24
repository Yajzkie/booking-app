-- Client accounts migration: run in the Supabase SQL editor (idempotent).

-- 1. Link bookings to the authenticated client
alter table public.bookings
  add column if not exists customer_id uuid references auth.users(id) on delete set null;

-- 2. New signups are clients, not owners
alter table public.profiles alter column role set default 'client';

-- 3. Owner check (definer: avoids policy recursion on profiles)
create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'owner'
  );
$$;

-- 4. bookings: owner manages all, client reads only their own
drop policy if exists "anyone can book" on public.bookings;
drop policy if exists "owner manage bookings" on public.bookings;
drop policy if exists "owner view all bookings" on public.bookings;
drop policy if exists "client view own bookings" on public.bookings;

create policy "owner manage bookings" on public.bookings
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "client view own bookings" on public.bookings
  for select to authenticated
  using (customer_id = auth.uid());
-- clients write through create_booking() only (security definer, no insert policy)

-- 5. services: public read, owner-only manage (was: ANY authenticated user!)
drop policy if exists "public view services" on public.services;
drop policy if exists "owner manage services" on public.services;

create policy "public view services" on public.services
  for select to anon, authenticated
  using (true);

create policy "owner manage services" on public.services
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- 6. profiles: read own / owner reads all; update own
drop policy if exists "owner view profiles" on public.profiles;
drop policy if exists "owner update own profile" on public.profiles;
drop policy if exists "client view own profile" on public.profiles;
drop policy if exists "client update own profile" on public.profiles;
drop policy if exists "read own profile" on public.profiles;
drop policy if exists "update own profile" on public.profiles;

create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_owner());

create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- 7. create_booking now records which account booked (when logged in).
--    The authoritative version lives in sessions.sql (stamps time from the
--    owner's window settings, rejects double-bookings). It runs after this
--    file per README and its INSERT already includes customer_id = auth.uid(),
--    so no defintion is duplicated here.

-- 8. Promote your owner account (edit the email first!):
update public.profiles
set role = 'owner'
where id = (select id from auth.users where email = 'PUT_OWNER_EMAIL_HERE');