-- booking-app schema: run this in the Supabase SQL editor
-- Tables + RLS + a trigger that creates a profile on signup.

create table if not exists public.services (
  id bigint generated always as identity primary key,
  name text not null,
  description text,
  price numeric(10,2) not null default 0,
  duration_minutes integer not null default 30,
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id bigint generated always as identity primary key,
  customer_name text not null,
  customer_email text,
  customer_phone text,
  service_id bigint not null references public.services(id),
  date date not null,
  time time not null,
  session text not null default 'morning'
    check (session in ('morning', 'afternoon')),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  role text not null default 'owner',
  created_at timestamptz not null default now()
);

-- auto-create a profile row whenever a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Row Level Security ----------
-- anon (the website) : read services, insert bookings
-- authenticated (owner app) : manage everything

alter table public.services enable row level security;
alter table public.bookings enable row level security;
alter table public.profiles enable row level security;

create policy "public view services" on public.services
  for select to anon, authenticated
  using (true);

create policy "owner manage services" on public.services
  for all to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- NOTE: FOR ALL policies must be role-scoped ("to authenticated").
-- Without a TO clause, the ALL policy applies to anon too, and its USING is
-- reused as WITH CHECK for inserts, which would block public bookings.
create policy "anyone can book" on public.bookings
  for insert to anon, authenticated
  with check (true);

create policy "owner manage bookings" on public.bookings
  for all to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "owner view profiles" on public.profiles
  for select to authenticated
  using (auth.role() = 'authenticated');

create policy "owner update own profile" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- explicit grants (needed for tables created via raw SQL)
grant select on public.services to anon;
grant select, insert, update, delete on public.services to authenticated;
grant select, insert on public.bookings to anon;
grant select, insert, update, delete on public.bookings to authenticated;
grant select, update on public.profiles to authenticated;

-- stream new/changed bookings to the owner app in realtime
alter publication supabase_realtime add table public.bookings;

-- sample service so the site isn't empty on day one (delete if you like)
insert into public.services (name, description, price, duration_minutes) values
  ('Consultation', '30-minute consultation', 0, 30)
on conflict do nothing;

-- ---------- Public booking entry point ----------
-- create_booking(p_service_id, p_date, p_session, ...) lives in sessions.sql:
-- it stamps `time` from the owner's window settings and turns a double-booked
-- (date, session) into a friendly message. Run sessions.sql after this file
-- (it creates and grants the function).