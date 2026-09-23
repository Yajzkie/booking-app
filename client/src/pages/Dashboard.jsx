import { useEffect, useState } from "react";
import { api, storage } from "../api.js";
import { useAuth } from "../auth.jsx";

function fmtDate(b) {
  return new Date(`${b.date}T${b.time}`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtTime(b) {
  return new Date(`${b.date}T${b.time}`).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Dashboard({ navigate }) {
  const { user } = useAuth();
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = storage.token;
    if (!token) return setError("Log in to see your dashboard.");
    api("/api/bookings/mine", { token }).then(setBookings).catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div>
        <h1>Dashboard</h1>
        <p className="error">
          {error} <button onClick={() => navigate("/auth")}>Go to sign in</button>
        </p>
      </div>
    );
  }
  if (bookings === null) {
    return (
      <div>
        <h1>Dashboard</h1>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const now = new Date();
  const upcoming = bookings
    .filter((b) => new Date(`${b.date}T${b.time}`) > now && b.status !== "cancelled")
    .sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));
  const past = bookings.filter((b) => new Date(`${b.date}T${b.time}`) <= now);
  const counts = bookings.reduce(
    (acc, b) => ((acc[b.status] = (acc[b.status] || 0) + 1), acc),
    {}
  );

  const firstName = user?.name?.trim() || user?.email?.split("@")[0] || "there";

  const row = (b, showDate) => (
    <li key={b.id} className={`booking-row status-${b.status}`}>
      <div className="booking-when">
        {showDate ? (
          <>
            <span className="booking-date">{fmtDate(b)}</span>
            <span className="booking-time">{fmtTime(b)}</span>
          </>
        ) : (
          <span className="booking-date">{fmtDate(b)}</span>
        )}
      </div>
      <div className="booking-what">
        <strong>{b.services?.name}</strong>
        <span className="muted">
          {b.services?.duration_minutes} min · Ref #{b.id}
        </span>
      </div>
      <span className="status">{b.status}</span>
    </li>
  );

  const stats = [
    { key: "upcoming", label: "Upcoming", value: upcoming.length },
    { key: "confirmed", label: "Confirmed", value: counts.confirmed || 0 },
    { key: "pending", label: "Pending", value: counts.pending || 0 },
  ];

  return (
    <div className="dash">
      <header className="dash-head">
        <p className="auth-eyebrow">Dashboard</p>
        <h1>Welcome back, {firstName}</h1>
        <p className="auth-sub">
          {upcoming.length === 0
            ? "Nothing scheduled — book your next visit."
            : `You have ${upcoming.length} upcoming${counts.pending ? `, ${counts.pending} awaiting confirmation` : ""}.`}
        </p>
      </header>

      <div className="stat-row">
        {stats.map((s) => (
          <div key={s.key} className="stat">
            <strong>{s.value}</strong>
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      <section className="card">
        <div className="section-head">
          <h2>Upcoming</h2>
          <button onClick={() => navigate("/")}>Book a visit</button>
        </div>
        {upcoming.length === 0 ? (
          <p className="muted">No visits scheduled yet.</p>
        ) : (
          <ul className="booking-list">{upcoming.map((b) => row(b, true))}</ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="card">
          <div className="section-head">
            <h2>Past visits</h2>
          </div>
          <ul className="booking-list">{past.map((b) => row(b, true))}</ul>
        </section>
      )}
    </div>
  );
}