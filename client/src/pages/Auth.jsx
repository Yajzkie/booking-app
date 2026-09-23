import { useState } from "react";
import { useAuth } from "../auth.jsx";

export default function Auth({ navigate }) {
  const { user, signUp, login, logout, notice } = useAuth();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p className="auth-eyebrow">Signed in</p>
          <h1 className="auth-title">{user.email}</h1>
          <p className="auth-sub">Access your dashboard to see what's confirmed and what's coming up.</p>
          <div className="actions">
            <button className="primary" onClick={() => navigate("/dashboard")}>
              Go to dashboard
            </button>
            <button onClick={() => logout()}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  async function handle(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signup") await signUp(email, password, name);
      else await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-head">
          <p className="auth-eyebrow">
            {mode === "login" ? "Welcome back" : "Join"}
          </p>
          <h1 className="auth-title">
            {mode === "login" ? "Sign in" : "Create an account"}
          </h1>
          {notice && (
            <p className="auth-notice" role="status">
              {notice}
            </p>
          )}
        </div>

        <div className="auth-switch" role="group" aria-label="Account access">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            aria-pressed={mode === "login"}
            onClick={() => setMode("login")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === "signup" ? "active" : ""}
            aria-pressed={mode === "signup"}
            onClick={() => setMode("signup")}
          >
            Create account
          </button>
        </div>

        <form onSubmit={handle} className="auth-form" noValidate>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {mode === "signup" && (
            <label>
              Name
              <input
                name="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}

          <label>
            Email
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label>
            Password
            <input
              type="password"
              name="password"
              minLength={6}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <button className="primary auth-submit" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}