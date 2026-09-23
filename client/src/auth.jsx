import { createContext, useContext, useState } from "react";
import { api, storage } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("sb_user");
    return raw ? JSON.parse(raw) : null;
  });

  const [notice, setNotice] = useState("");

  function applySession({ session, user }) {
    if (session) {
      storage.token = session.access_token;
      setUser(user);
      localStorage.setItem(
        "sb_user",
        JSON.stringify({
          id: user.id,
          email: user.email,
          name: user.user_metadata?.full_name || user.user_metadata?.name || "",
        })
      );
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