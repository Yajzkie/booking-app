import { useState } from "react";
import { useAuth } from "../auth.jsx";

export default function Auth({ navigate }) {
  const { user, signUp, login, logout, notice } = useAuth();
  const [mode, setMode] = useState("login");
  const [leaving, setLeaving] = useState(false);
  const [dir, setDir] = useState("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  function switchMode(m) {
    if (m === mode || leaving) return;
    setDir(m);
    setLeaving(true);
    window.setTimeout(() => {
      setMode(m);
      setLeaving(false);
    }, 140);
  }

  const panelClass = leaving
    ? `auth-panel out-${dir === "signup" ? "left" : "right"}`
    : `auth-panel in-${dir === "signup" ? "right" : "left"}`;

  if (user) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p className="auth-eyebrow">Signed in</p>
          <h1 className="auth-title">{user.email}</h1>
          <p className="auth-sub">Access your dashboard to see what's confirmed and what's coming up.</p>
          <div className="actions">
            <button className="primary" onClick={() => navigate(user.role === "owner" ? "/admin" : "/dashboard")}>
              {user.role === "owner" ? "Go to admin" : "Go to dashboard"}
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
        const role =
          mode === "signup" ? await signUp(email, password, name) : await login(email, password);
        navigate(role === "owner" ? "/admin" : "/dashboard");
      } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand" aria-hidden="true">
          <span className="brand-dot" />
          Welcome to JWorkz Shop
        </div>

        <div className={`auth-switch${mode === "signup" ? " thumb-right" : ""}`} role="group" aria-label="Account access">
          <span className="thumb" aria-hidden="true" />
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            aria-pressed={mode === "login"}
            onClick={() => switchMode("login")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === "signup" ? "active" : ""}
            aria-pressed={mode === "signup"}
            onClick={() => switchMode("signup")}
          >
            Create account
          </button>
        </div>

        <div key={mode} className={panelClass}>
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
            <span className="password-wrap">
              <input
                type={showPw ? "text" : "password"}
                name="password"
                minLength={6}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="pw-toggle"
                aria-pressed={showPw}
                aria-label={showPw ? "Hide password" : "Show password"}
                onClick={() => setShowPw((v) => !v)}
                tabIndex={0}
              >
                {showPw ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-6.5 0-10-7-10-7a13.16 13.16 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </span>
          </label>

          <button className="primary auth-submit" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        </div>
      </div>
    </div>
  );
}