// All requests go through the Vite dev proxy (/api -> http://localhost:3001),
// so no CORS headaches and no Supabase keys in the browser.
export async function api(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const storage = {
  get token() {
    return localStorage.getItem("sb_token");
  },
  set token(v) {
    if (v) localStorage.setItem("sb_token", v);
    else localStorage.removeItem("sb_token");
  },
};