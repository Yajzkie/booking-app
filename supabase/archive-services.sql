-- Run in the Supabase SQL Editor.
-- Services can no longer be hard-deleted once bookings reference them
-- (FK violation, bookings keep history). Instead they are archived:
-- hidden from the booking site and admin list, bookings stay intact.
alter table public.services
  add column if not exists active boolean not null default true;