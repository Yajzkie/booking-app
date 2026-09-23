import { createContext, useContext, useEffect, useState } from "react";
import { api, storage } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("sb_user");
    return raw ? JSON.parse(raw) : null;
  });

  const [notice, setNotice] = useState("");

  // On load, refresh the stored role (an owner session saved before this
  // shipped won't have "role" yet). Best-effort: ignore failures.
  useEffect(() => {
    const token = storage.token;
    if (!token) return;
    api("/api/auth/me", { token })
      .then((data) => {
        setUser((prev) => {
          if (!prev || !data.role) return prev;
          const next = { ...prev, role: data.role };
          localStorage.setItem("sb_user", JSON.stringify(next));
          return next;
        });
      })
      .catch(() => {});
  }, []);

  function applySession({ session, user, role }) {
    if (session) {
      storage.token = session.access_token;
      const shaped = {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.user_metadata?.name || "",
        role: role || "client",
      };
      setUser(shaped);
      localStorage.setItem("sb_user", JSON.stringify(shaped));
    }
    return session;
  }

  async function signUp(email, password, name) {
    const data = await api("/api/auth/signup", {
      method: "POST",
      body: { email, password, name },
    });
    if (data.error) throw new Error(data.error);
    const loggedIn = applySession(data);
    if (!loggedIn) {
      setNotice("Account created! Check your email to confirm, then sign in.");
    }
  }

  async function login(email, password) {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    if (data.error) throw new Error(data.error);
    applySession(data);
  }

  function logout() {
    storage.token = null;
    localStorage.removeItem("sb_user");
    setUser(null);
    setNotice("");
  }

  return (
    <AuthContext.Provider value={{ user, notice, signUp, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}