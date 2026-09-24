# Booking App

Scheduling for a small business owner. Clients book on a website; the owner
manages bookings and services in a Flutter app. One Supabase project powers all.

```
supabase/schema.sql            Full schema (fresh installs)
supabase/client-accounts.sql   Migration: client accounts + tightened RLS
web/                           Client site (plain HTML/JS, no build step)
client/                        Client site (React + Vite, learn-an-app version)
server/                        Node/Express API for the React client
owner_app/                     Flutter admin app
```

## Setup

### 1. Supabase

1. Create a project at supabase.com.
2. Open **SQL Editor** and run `supabase/schema.sql` (fresh) — or for this
   existing project, run `supabase/client-accounts.sql`. Then run
   `supabase/sessions.sql` (morning/afternoon sessions + double-booking guard).
   **Edit the owner email in step 8 first** — it promotes your account.
3. Create the owner account (email + password) in **Authentication → Users**.
4. Note the URL + anon key under **Project Settings → API**.

> With client accounts, RLS now distinguishes clients from the owner. Without
> this migration, *any* signed-up client could act as the owner in the Flutter
> app — the exact hole `client-accounts.sql` closes.

### 2. Owner app (Flutter)

1. Put URL + anon key in `owner_app/lib/main.dart`.
2. `cd owner_app && flutter run`, sign in with the owner account.

### 3. React client + Node API

1. Put the Supabase URL + anon key in `server/.env`.
2. Terminal A: `cd server && npm install && npm run dev`
3. Terminal B: `cd client && npm install && npm run dev`
4. Open http://localhost:5173

Vite proxies `/api` to the Node server (`localhost:3001`), so no CORS config
and no Supabase keys in the browser.

**Email confirmation:** signup currently requires email confirmation (the
Supabase default) — the UI says "check your email". For a friction-free demo,
turn it off: **Authentication → Sign In / Providers → Email** → disable
*"Confirm email"*.

## What's deliberately simple (demo scope)

- Clients log in, but a booking is still name/email/phone + date/session.
- A day has two claimable sessions — morning and afternoon — set by the owner
  in the Hours tab. The site marks a day red when *both* sessions are taken,
  and the DB rejects a second claim on one (`bookings_one_per_session`
  partial unique index) even when two clients race.
- No notifications/push — the owner's Flutter app shows bookings in realtime.
- Clients can view booking status but not cancel yet.

All are obvious "next" upgrades before real customers.