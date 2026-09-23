import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: s } = await anon.auth.signInWithPassword({ email: "yaj143sabalo@gmail.com", password: "yajzkie1" });
const tok = s.session.access_token;
const sub = JSON.parse(Buffer.from(tok.split(".")[1], "base64url")).sub;
console.log("JWT sub:", sub);
const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${tok}` } },
  auth: { persistSession: false },
});
const q = await c.from("profiles").select("id, role").eq("id", sub).maybeSingle();
console.log("filtered roleOf:", JSON.stringify(q.data), "| error:", q.error?.message ?? "none");
const raw = await c.from("profiles").select("id, role");
console.log("unfiltered rows:", JSON.stringify(raw.data?.map(r=>r.id.slice(0,8)+":"+r.role)));
