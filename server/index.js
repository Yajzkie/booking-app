import express from "express";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

// anon client = unauthenticated calls (public read / booking RPC)
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

// per-request client: forwards the user's JWT so Supabase RLS sees *them*,
// not the server. Keeps all access rules in one place (the database).
function withToken(token) {
  if (!token) return anon;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
}

function clientFor(req) {
  return withToken(tokenOf(req));
}

function tokenOf(req) {
  return (req.headers.authorization || "").replace(/^Bearer /, "") || null;
}

// The role the user's JWT sees in their own profile. Renters default to
// "client"; the owner is promoted manually (step 8 of client-accounts.sql).
// Pin to the caller's profile row: owners can read *all* profiles under RLS,
// so without the filter .maybeSingle() sees many rows and errors out.
function tokenSub(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url")).sub;
  } catch {
    return null;
  }
}

async function roleOf(token) {
  const sub = tokenSub(token);
  if (!sub) return "client";
  const { data } = await withToken(token)
    .from("profiles")
    .select("role")
    .eq("id", sub)
    .maybeSingle();
  return data?.role || "client";
}

// Gate for owner-only endpoints. Sends its own 401/403; callers return early
// when it returns null.
async function requireOwner(req, res) {
  const token = tokenOf(req);
  if (!token) {
    res.status(401).json({ error: "Login required" });
    return null;
  }
  const { data, error } = await anon.auth.getUser(token);
  if (error) {
    res.status(401).json({ error: "Session invalid, sign in again" });
    return null;
  }
  if ((await roleOf(token)) !== "owner") {
    res.status(403).json({ error: "Owner account required" });
    return null;
  }
  return data.user;
}

// Validate service input; returns { fields } or { error }.
function serviceFields(body) {
  const name = (body.name || "").toString().trim();
  const price = Number(body.price);
  const duration = Number(body.duration_minutes);
  if (!name) return { error: "Name is required" };
  if (!Number.isFinite(price) || price < 0) return { error: "Price must be 0 or more" };
  if (!Number.isInteger(duration) || duration < 1) {
    return { error: "Duration must be a whole number of minutes (at least 1)" };
  }
  return {
    fields: {
      name,
      description: (body.description || "").toString().trim() || null,
      price,
      duration_minutes: duration,
    },
  };
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---------- auth ----------
app.post("/api/auth/signup", async (req, res) => {
  const { email, password, name } = req.body;
  const { data, error } = await anon.auth.signUp({
    email,
    password,
    options: { data: { name, full_name: name } },
  });
  if (error) return res.status(400).json({ error: error.message });
  res.json({
    session: data.session,
    user: data.user,
    role: data.session ? await roleOf(data.session.access_token) : "client",
  });
});

// --- brute-force guard (in-memory, per-process; ok for this scale) ---
// Tracks failed attempts per email in a sliding window; rate-limit code
// should move to Redis/DB if this ever runs on multiple instances.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 5;
const loginFails = new Map(); // email -> [timestampMs, ...]

function allowLogin(email) {
  const key = String(email).toLowerCase();
  const now = Date.now();
  const recent = (loginFails.get(key) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  if (recent.length >= LOGIN_MAX_FAILS) {
    const wait = Math.ceil((LOGIN_WINDOW_MS - (now - recent[0])) / 1000 / 60);
    return { ok: false, wait };
  }
  return { ok: true, recent };
}

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const gate = allowLogin(email);
  if (!gate.ok)
    return res.status(429).json({ error: `Too many attempts. Try again in ~${gate.wait} min.` });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) {
    loginFails.set(String(email).toLowerCase(), [...gate.recent, Date.now()]);
    return res.status(400).json({ error: error.message });
  }
  loginFails.delete(String(email).toLowerCase());
  res.json({
    session: data.session,
    user: data.user,
    role: data.session ? await roleOf(data.session.access_token) : "client",
  });
});

// Logout is client-side only: the browser drops the token.
// Without the service-role key the server can't revoke sessions — and we
// don't want that key here anyway. Access tokens expire on their own (~1h).
app.post("/api/auth/logout", (_req, res) => res.json({ ok: true }));

app.get("/api/auth/me", async (req, res) => {
  const token = tokenOf(req);
  if (!token) return res.status(401).json({ error: "Not logged in" });
  const { data, error } = await anon.auth.getUser(token);
  if (error) return res.status(401).json({ error: "Session invalid" });
  res.json({ user: data.user, role: await roleOf(token) });
});

// ---------- services ----------
app.get("/api/services", async (_req, res, next) => {
  try {
    const { data, error } = await anon.from("services").select("*").order("name");
    if (error) throw error;
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// ---------- sessions ----------
// A day has two claimable sessions: morning and afternoon. This endpoint
// returns, for every day of the requested month, which sessions are still
// free (and not already past). The client renders a calendar that goes red
// when both sessions are taken.
const SESSIONS = ["morning", "afternoon"];

function hmToMinutes(hm) {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

async function sessionAvailability(firstDay, lastDay) {
  // Fresh client per call: the long-lived module-level `anon` holds a stale
  // PostgREST schema/policy cache and intermittently returns a filtered subset
  // of rows (calendar flips between correct and wrong without data changing).
  const reader = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const [{ data: settings, error: settingsError }, { data: rows, error: takenError }] =
    await Promise.all([
      reader.from("settings").select("*").eq("id", 1).single(),
      reader
        .from("bookings")
        .select("date, session")
        .gte("date", firstDay)
        .lte("date", lastDay)
        .in("status", ["pending", "confirmed"]),
    ]);
  if (settingsError) throw settingsError;
  if (takenError) throw takenError;

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const hm = (t) => t.split(":").slice(0, 2).map(Number);
  const windowEnd = {
    morning: hm(settings.morning_end),
    afternoon: hm(settings.afternoon_end),
  };
  const ended = (session, day) => {
    if (day < today) return true;
    if (day > today) return false;
    const [h, m] = windowEnd[session];
    return nowMinutes >= h * 60 + m;
  };

  const taken = new Set(rows.map((r) => `${r.date}|${r.session}`));
  const days = {};
  let cursor = new Date(`${firstDay}T00:00:00Z`);
  const last = new Date(`${lastDay}T00:00:00Z`);
  while (cursor <= last) {
    const day = cursor.toISOString().slice(0, 10);
    days[day] = SESSIONS.filter((s) => !taken.has(`${day}|${s}`) && !ended(s, day));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { days, settings };
}

app.get("/api/sessions", async (req, res, next) => {
  try {
    const { month } = req.query;
    if (!/^\d{4}-\d{2}$/.test(month || "")) {
      return res.status(400).json({ error: "month is required (YYYY-MM)" });
    }
    res.set("Cache-Control", "no-store");
    const [y, m] = month.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const firstDay = `${month}-01`;
    const lastDay = `${month}-${String(daysInMonth).padStart(2, "0")}`;
    res.json(await sessionAvailability(firstDay, lastDay));
  } catch (e) {
    next(e);
  }
});

// ---------- bookings ----------
app.post("/api/bookings", async (req, res, next) => {
  try {
    const { service_id, date, session, name, email, phone } = req.body;
    if (!service_id || !date || !session || !name) {
      return res.status(400).json({ error: "service_id, date, session and name are required" });
    }
    if (!SESSIONS.includes(session)) {
      return res.status(400).json({ error: "session must be morning or afternoon" });
    }
    const { data, error } = await clientFor(req).rpc("create_booking", {
      p_service_id: service_id,
      p_date: date,
      p_session: session,
      p_name: name,
      p_email: email || null,
      p_phone: phone || null,
    });
    if (error) throw error;
    res.status(201).json({ id: data });
  } catch (e) {
    next(e);
  }
});

app.get("/api/bookings/mine", async (req, res, next) => {
  try {
    if (!tokenOf(req)) return res.status(401).json({ error: "Login required" });
    const { data, error } = await clientFor(req)
      .from("bookings")
      .select("id, date, session, time, status, created_at, services(name, duration_minutes)")
      .order("date", { ascending: false })
      .order("time", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// ---------- admin (owner only) ----------
app.get("/api/admin/bookings", async (req, res, next) => {
  try {
    if (!(await requireOwner(req, res))) return;
    const { data, error } = await clientFor(req)
      .from("bookings")
      .select("id, customer_name, customer_email, customer_phone, date, session, time, status, created_at, services(name, duration_minutes)")
      .order("date", { ascending: true })
      .order("time", { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    next(e);
  }
});

const BOOKING_STATUSES = ["pending", "confirmed", "cancelled"];

app.patch("/api/admin/bookings/:id", async (req, res, next) => {
  try {
    if (!(await requireOwner(req, res))) return;
    const { status } = req.body;
    if (!BOOKING_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${BOOKING_STATUSES.join(", ")}` });
    }
    const { data, error } = await clientFor(req)
      .from("bookings")
      .update({ status })
      .eq("id", req.params.id)
      .select("id, status");
    if (error) throw error;
    if (!data.length) return res.status(404).json({ error: "Booking not found" });
    res.json(data[0]);
  } catch (e) {
    next(e);
  }
});

app.get("/api/admin/services", async (req, res, next) => {
  try {
    if (!(await requireOwner(req, res))) return;
    const { data, error } = await clientFor(req)
      .from("services")
      .select("*")
      .order("name");
    if (error) throw error;
    res.json(data);
  } catch (e) {
    next(e);
  }
});

app.post("/api/admin/services", async (req, res, next) => {
  try {
    if (!(await requireOwner(req, res))) return;
    const { fields, error: invalid } = serviceFields(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    const { data, error } = await clientFor(req)
      .from("services")
      .insert(fields)
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
});

app.patch("/api/admin/services/:id", async (req, res, next) => {
  try {
    if (!(await requireOwner(req, res))) return;
    const { fields, error: invalid } = serviceFields(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    const { data, error } = await clientFor(req)
      .from("services")
      .update(fields)
      .eq("id", req.params.id)
      .select("id");
    if (error) throw error;
    if (!data.length) return res.status(404).json({ error: "Service not found" });
    res.json({ id: data[0].id });
  } catch (e) {
    next(e);
  }
});

app.delete("/api/admin/services/:id", async (req, res, next) => {
  try {
    if (!(await requireOwner(req, res))) return;
    const { data, error } = await clientFor(req)
      .from("services")
      .delete()
      .eq("id", req.params.id)
      .select("id");
    if (error) {
      if (error.code === "23503") {
        return res.status(409).json({ error: "Can't delete — bookings reference this service." });
      }
      throw error;
    }
    if (!data.length) return res.status(404).json({ error: "Service not found" });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- admin: hours/slot settings ----------
function isValidTime(t) {
  return typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

function settingsFields(body) {
  const { morning_start, morning_end, afternoon_start, afternoon_end } = body;
  if ([morning_start, morning_end, afternoon_start, afternoon_end].some((t) => !isValidTime(t))) {
    return { error: "Opening hours must be times like 09:00" };
  }
  const [ms, me, as_, ae] = [morning_start, morning_end, afternoon_start, afternoon_end].map(hmToMinutes);
  if (ms >= me || as_ >= ae) return { error: "Each window's start must be before its end" };
  return {
    fields: { morning_start, morning_end, afternoon_start, afternoon_end },
  };
}

app.get("/api/admin/settings", async (req, res, next) => {
  try {
    if (!(await requireOwner(req, res))) return;
    const { data, error } = await clientFor(req).from("settings").select("*").eq("id", 1).single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    next(e);
  }
});

app.put("/api/admin/settings", async (req, res, next) => {
  try {
    if (!(await requireOwner(req, res))) return;
    const { fields, error: invalid } = settingsFields(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    const { data, error } = await clientFor(req).from("settings").update(fields).eq("id", 1).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    next(e);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

const port = process.env.PORT || 3001;

// Vercel imports the app as a serverless handler (no listening); 
// local dev runs the listener as before.
export default app;

if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`API on http://localhost:${port}`));
}