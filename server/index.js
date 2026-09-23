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

// ---------- bookings ----------
app.post("/api/bookings", async (req, res, next) => {
  try {
    const { service_id, date, time, name, email, phone } = req.body;
    if (!service_id || !date || !time || !name) {
      return res.status(400).json({ error: "service_id, date, time and name are required" });
    }
    const { data, error } = await clientFor(req).rpc("create_booking", {
      p_service_id: service_id,
      p_date: date,
      p_time: time,
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
      .select("id, date, time, status, created_at, services(name, duration_minutes)")
      .order("date", { ascending: false });
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
      .select("id, customer_name, customer_email, customer_phone, date, time, status, created_at, services(name, duration_minutes)")
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