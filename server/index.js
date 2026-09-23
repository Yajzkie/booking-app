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
function clientFor(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (!token) return anon;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
}

function tokenOf(req) {
  return (req.headers.authorization || "").replace(/^Bearer /, "") || null;
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
  res.json({ session: data.session, user: data.user });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ session: data.session, user: data.user });
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
  res.json({ user: data.user });
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