import { useState } from "react";
import Book from "./pages/Book.jsx";
import Auth from "./pages/Auth.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Admin from "./pages/Admin.jsx";
import { useAuth } from "./auth.jsx";

export default function App() {
  const [route, setRoute] = useState("/auth");
  const { user, logout } = useAuth();
  const navigate = (r) => setRoute(r);

  if (!user || route === "/auth") {
    return (
      <main className="page">
        <Auth navigate={navigate} />
      </main>
    );
  }

  const isAdmin = user.role === "owner";

  const navItem = (href, label) => (
    <button
      key={href}
      className={`nav-item${route === href ? " active" : ""}`}
      aria-current={route === href ? "page" : undefined}
      onClick={() => navigate(href)}
    >
      {label}
    </button>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-dot" aria-hidden="true" />
          Book a Service
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          {isAdmin ? (
            navItem("/admin", "Admin")
          ) : (
            <>
              {navItem("/dashboard", "Dashboard")}
              {navItem("/", "Book a visit")}
            </>
          )}
        </nav>

        <div className="sidebar-foot">
          <span className="sidebar-user">{user.email}</span>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>

      <main className="content">
        {isAdmin ? (
          <Admin navigate={navigate} />
        ) : (
          <>
            {route === "/" && <Book navigate={navigate} />}
            {route === "/dashboard" && <Dashboard navigate={navigate} />}
          </>
        )}
      </main>
    </div>
  );
}