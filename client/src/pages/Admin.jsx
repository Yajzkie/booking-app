import { useEffect, useState } from "react";
import { api, storage } from "../api.js";
import { fmtDate, fmtTime } from "./Dashboard.jsx";

export default function Admin({ navigate }) {
  const [tab, setTab] = useState("bookings");
  const [filter, setFilter] = useState("all");
  const [bookings, setBookings] = useState(null);
  const [services, setServices] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  const auth = storage.token ? { token: storage.token } : {};

  function reloadBookings() {
    return api("/api/admin/bookings", auth).then(setBookings);
  }
  function reloadServices() {
    return api("/api/admin/services", auth).then(setServices);
  }

  useEffect(() => {
    const token = storage.token;
    Promise.all([
      api("/api/admin/bookings", { token }).then(setBookings),
      api("/api/admin/services", { token }).then(setServices),
    ]).catch((e) => {
      setError(e.message);
      setBookings([]);
      setServices([]);
    });
  }, []);

  async function setStatus(id, status) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/bookings/${id}`, { method: "PATCH", ...auth, body: { status } });
      await reloadBookings();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveService(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        name: editing.name,
        description: editing.description,
        price: Number(editing.price) || 0,
        duration_minutes: Number(editing.duration_minutes) || 0,
      };
      if (editing.id) {
        await api(`/api/admin/services/${editing.id}`, { method: "PATCH", ...auth, body });
      } else {
        await api("/api/admin/services", { method: "POST", ...auth, body });
      }
      setEditing(null);
      await reloadServices();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeService(s) {
    if (!window.confirm(`Delete "${s.name}"?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/services/${s.id}`, { method: "DELETE", ...auth });
      await reloadServices();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && bookings === null) {
    return (
      <div>
        <h1>Admin</h1>
        <p className="error">
          {error} <button onClick={() => navigate("/dashboard")}>Go to dashboard</button>
        </p>
      </div>
    );
  }
  if (bookings === null) {
    return (
      <div>
        <h1>Admin</h1>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const counts = bookings.reduce(
    (acc, b) => ((acc[b.status] = (acc[b.status] || 0) + 1), acc),
    {}
  );
  const stats = [
    { key: "all", label: "All", value: bookings.length },
    { key: "pending", label: "Pending", value: counts.pending || 0 },
    { key: "confirmed", label: "Confirmed", value: counts.confirmed || 0 },
  ];
  const filteredBookings =
    filter === "all" ? bookings : bookings.filter((b) => b.status === filter);
  const confirmedBookings = (filter === "all" ? [...bookings] : [...filteredBookings])
    .filter((b) => b.status === "confirmed")
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  async function confirmBooking() {
    if (!confirming) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/bookings/${confirming.id}`, { method: "PATCH", ...auth, body: { status: "confirmed" } });
      setConfirming(null);
      await reloadBookings();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const bookingRow = (b) => (
    <li key={b.id} className={`booking-row status-${b.status}`}>
      <div className="booking-when">
        <span className="booking-date">{fmtDate(b)}</span>
        <span className="booking-time">{fmtTime(b)}</span>
      </div>
      <div className="booking-what">
        <strong>{b.customer_name}</strong>
        <span className="muted">
          {b.services?.name} · {b.services?.duration_minutes} min
          {b.customer_email && ` · ${b.customer_email}`}
          {b.customer_phone && ` · ${b.customer_phone}`}
          &nbsp;· Ref #{b.id}
        </span>
      </div>
      <span className="status">{b.status}</span>
      {b.status === "pending" && (
        <div className="row-actions">
          <button className="primary" disabled={busy} onClick={() => setStatus(b.id, "confirmed")}>
            Confirm
          </button>
          <button className="danger" disabled={busy} onClick={() => setStatus(b.id, "cancelled")}>
            Cancel
          </button>
        </div>
      )}
    </li>
  );

  const setField = (key) => (e) => setEditing({ ...editing, [key]: e.target.value });

  return (
    <div className="dash">
      <header className="dash-head">
        <p className="auth-eyebrow">Admin</p>
        <h1>Bookings &amp; services</h1>
        <p className="auth-sub">
          {counts.pending
            ? `${counts.pending} booking${counts.pending === 1 ? "" : "s"} awaiting confirmation.`
            : "Nothing pending — all clear."}
        </p>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="auth-switch" role="group" aria-label="Admin views">
        <button
          className={tab === "bookings" ? "active" : ""}
          aria-pressed={tab === "bookings"}
          onClick={() => setTab("bookings")}
        >
          Bookings
        </button>
        <button
          className={tab === "services" ? "active" : ""}
          aria-pressed={tab === "services"}
          onClick={() => setTab("services")}
        >
          Services
        </button>
        <button
          className={tab === "schedule" ? "active" : ""}
          aria-pressed={tab === "schedule"}
          onClick={() => setTab("schedule")}
        >
          Schedule
        </button>
      </div>

      {tab === "bookings" && (
        <>
          <div className="stat-row">
            {stats.map((s) => (
              <button
                key={s.key}
                className={`stat ${filter === s.key ? "active" : ""}`}
                aria-pressed={filter === s.key}
                disabled={busy}
                onClick={() => setFilter(s.key)}
              >
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
          <section className="card">
            <div className="section-head">
              <h2>
                All bookings
                {filter !== "all" && (
                  <span className="filter-hint"> — {filter}</span>
                )}
              </h2>
            </div>
            {filteredBookings.length === 0 ? (
              <p className="muted">
                {filter === "all"
                  ? "No bookings yet."
                  : `No ${filter} bookings right now.`}
              </p>
            ) : (
              <ul className="booking-list">{filteredBookings.map(bookingRow)}</ul>
            )}
          </section>
        </>
      )}

      {tab === "schedule" && (
        <section className="card">
          <div className="section-head">
            <h2>Confirmed schedule</h2>
            <p className="muted">
              Every confirmed booking, in date &amp; time order — your working day at a glance.
            </p>
          </div>
          {confirmedBookings.length === 0 ? (
            <p className="muted">No confirmed bookings yet — confirm one from the Bookings tab.</p>
          ) : (
            <ul className="booking-list">{confirmedBookings.map(bookingRow)}</ul>
          )}
        </section>
      )}

      {tab === "services" && (
        <>
          <section className="card">
            <div className="section-head">
              <h2>Services</h2>
              <button onClick={() => setEditing({ name: "", description: "", price: "", duration_minutes: "30" })}>
                Add service
              </button>
            </div>

            {editing && (
              <form onSubmit={saveService} noValidate>
                <label>
                  Name
                  <input
                    autoFocus
                    value={editing.name}
                    onChange={setField("name")}
                    placeholder="e.g. Full detail"
                  />
                </label>
                <label>
                  Description
                  <input
                    value={editing.description}
                    onChange={setField("description")}
                    placeholder="Optional"
                  />
                </label>
                <div className="form-row">
                  <label>
                    Price ($)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editing.price}
                      onChange={setField("price")}
                    />
                  </label>
                  <label>
                    Duration (minutes)
                    <input
                      type="number"
                      min="1"
                      value={editing.duration_minutes}
                      onChange={setField("duration_minutes")}
                    />
                  </label>
                </div>
                <div className="actions">
                  <button className="primary" type="submit" disabled={busy || !editing.name.trim()}>
                    Save
                  </button>
                  <button type="button" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {services.length === 0 && !editing ? (
              <p className="muted">No services yet — add your first one.</p>
            ) : (
              <ul className="booking-list">
                {services.map((s) => (
                  <li key={s.id} className="service-card">
                    <div>
                      <strong>{s.name}</strong>
                      {s.description && <div className="muted">{s.description}</div>}
                    </div>
                    <div className="service-side">
                      <span className="price">{s.price ? `$${s.price}` : "Free"} · {s.duration_minutes} min</span>
                      <div className="row-actions">
                        <button onClick={() => setEditing({ ...s, price: String(s.price), duration_minutes: String(s.duration_minutes) })}>
                          Edit
                        </button>
                        <button className="danger" disabled={busy} onClick={() => removeService(s)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}