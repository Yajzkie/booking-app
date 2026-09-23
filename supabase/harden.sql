-- Privilege hardening: run once in the Supabase SQL editor.
-- Stops any client from promoting themselves to owner.
-- The app never writes profiles directly (the signup trigger is SECURITY
-- DEFINER and doesn't need table grants), so revoking UPDATE is safe.
revoke update on public.profiles from authenticated;