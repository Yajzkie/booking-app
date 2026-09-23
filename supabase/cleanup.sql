-- Reset demo data: wipe bookings + junk services, keep your accounts.
-- Safe to re-run.

delete from public.bookings;

-- Drop everything except the seeded service
delete from public.services where name <> 'Consultation';

-- Make sure the seed exists (no-op if it's still there)
insert into public.services (name, description, price, duration_minutes)
select 'Consultation', '30-minute consultation', 0, 30
where not exists (select 1 from public.services where name = 'Consultation');
