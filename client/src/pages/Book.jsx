import { useCallback, useEffect, useState } from "react";
import { api, storage } from "../api.js";
import { useAuth } from "../auth.jsx";
import { fmtPrice, fmtSession } from "./Dashboard.jsx";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const SESSION_LABEL = { morning: "Morning", afternoon: "Afternoon" };

function yearMonth(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function ymd(d) {
  return `${yearMonth(d)}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtHours(t) {
  const [h, m] = t.split(":").slice(0, 2).map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default function Book({ navigate }) {
  const { user } = useAuth();
  const [services, setServices] = useState([]);
  const [step, setStep] = useState(0);
  const [service, setService] = useState(null);
  const [form, setForm] = useState({ date: "", session: "", name: user?.name?.trim() ?? user?.email?.split("@")[0] ?? "", email: user?.email ?? "", phone: "" });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [avail, setAvail] = useState(null);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    api("/api/services").then(setServices).catch((e) => setError(e.message));
  }, []);

  const loadSessions = useCallback(() => {
    api(`/api/sessions?month=${yearMonth(monthCursor)}`)
      .then((d) => {
        setAvail(d.days);
        setSettings(d.settings);
      })
      .catch(() => setAvail({}));
  }, [monthCursor]);

  // New month: clear the grid so we show a loading state, then fetch.
  useEffect(() => {
    setAvail(null);
    loadSessions();
  }, [loadSessions]);

  // While the calendar is on screen, keep it in sync with other clients:
  // refresh when they come back to the tab, and poll every 20s as a fallback.
  const onCalendar = step === 1;
  useEffect(() => {
    if (!onCalendar) return;
    loadSessions();
    const onFocus = () => loadSessions();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const tick = setInterval(loadSessions, 20000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(tick);
    };
  }, [onCalendar, loadSessions]);

  const steps = ["service", "time", "details"];
  const stepLabels = ["Service", "Date & session", "Details"];

  function next() {
    if (steps[step] === "service" && !service) {
      return setError("Pick a service");
    }
    if (steps[step] === "time" && !form.date) {
      return setError("Pick a date");
    }
    if (steps[step] === "time" && !form.session) {
      return setError("Pick a session");
    }
    if (steps[step] === "details" && !form.name.trim()) {
      return setError("Enter your name");
    }
    setError("");
    setStep(step + 1);
  }

  async function submit() {
    if (!service) return setError("Pick a service");
    setError("");
    const token = storage.token;
    try {
      const { id } = await api("/api/bookings", {
        method: "POST",
        token,
        body: {
          service_id: service.id,
          date: form.date,
          session: form.session,
          name: form.name.trim(),
          email: user?.email ?? (form.email.trim() || null),
          phone: form.phone.trim() || null,
        },
      });
      setResult({ id, ...form });
    } catch (e) {
      setError(e.message);
    }
  }

  if (result) {
    return (
      <div className="card">
        <h2>Booking received!</h2>
        <p>
          Reference <strong>#{result.id}</strong> — {service.name},{" "}
          {SESSION_LABEL[result.session]} on{" "}
          {new Date(`${result.date}T00:00`).toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
          .
        </p>
        <p className="muted">
          {user
            ? "You can track its status from your dashboard."
            : form.email
              ? `We'll confirm it to ${form.email}.`
              : "We'll confirm your session shortly."}
        </p>
        <button onClick={() => location.reload()}>Book another</button>
      </div>
    );
  }

  const today = ymd(new Date());
  const daysInMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate();
  const leadBlanks = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1).getDay();
  const selectedFree = form.date ? (avail?.[form.date] || []) : [];

  const sessMark = (dayKey, s) => {
    const taken = dayKey < today || !(avail?.[dayKey] || []).includes(s);
    const name = s === "morning" ? "AM" : "PM";
    return <span key={s} className={`cal-sess${taken ? " taken" : ""}`}>{name}</span>;
  };

  const dayCell = (day) => {
    const d = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), day);
    const key = ymd(d);
    const isPast = key < today;
    const free = avail?.[key] || [];
    const isFull = !isPast && free.length === 0;
    const isPartial = !isPast && !isFull && free.length === 1;
    const isOpen = !isPast && !isFull && !isPartial;
    const cls = `cal-day${isPast ? " past" : ""}${isFull ? " full" : ""}${isPartial ? " partial" : ""}${isOpen ? " open" : ""}${form.date === key ? " selected" : ""}`;
    return (
      <button
        type="button"
        key={key}
        disabled={isPast}
        className={cls}
        aria-label={`${d.toDateString()} — ${isFull ? "fully booked" : isPartial ? "1 session free" : "open — 2 sessions free"}`}
        onClick={() => setForm({ ...form, date: key, session: "" })}
      >
        <span className="cal-day-num">{day}</span>
        {!isPast && (
          <span className="cal-day-sessions">
            {["morning", "afternoon"].map((s) => sessMark(key, s))}
          </span>
        )}
      </button>
    );
  };

  const windowOf = (session) =>
    session === "morning"
      ? `${fmtHours(settings.morning_start)} – ${fmtHours(settings.morning_end)}`
      : `${fmtHours(settings.afternoon_start)} – ${fmtHours(settings.afternoon_end)}`;

  return (
    <div>
      <h1>Book a visit</h1>

      <div
        className="stepper"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={stepLabels.length}
        aria-valuenow={step + 1}
        aria-label="Booking progress"
      >
        {stepLabels.map((label, i) => (
          <div
            key={label}
            className={`step${i < step ? " done" : ""}${i === step ? " current" : ""}`}
          >
            <span className="step-dot" aria-hidden="true">
              {i < step ? "✓" : i + 1}
            </span>
            <span className="step-label">{label}</span>
          </div>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      {step === 0 && (
        <div className="card">
          <h2>{stepLabels[0]}</h2>
          <div className="service-list">
            {services.map((s) => (
              <div
                key={s.id}
                className={`service-card${service?.id === s.id ? " selected" : ""}`}
                onClick={() => setService(s)}
              >
                <div>
                  <strong>{s.name}</strong>
                  {s.description && <div className="muted">{s.description}</div>}
                </div>
                <div className="price">{fmtPrice(s.price)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <h2>{stepLabels[1]}</h2>
          <div className="cal-head">
            <button type="button" onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}>
              ‹
            </button>
            <strong className="cal-title">
              {monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </strong>
            <button type="button" onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}>
              ›
            </button>
          </div>
          <div className="cal-weekdays">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          {avail === null ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <div className="cal-grid">
                {Array.from({ length: leadBlanks }, (_, i) => (
                  <span key={`b${i}`} className="cal-blank" />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => dayCell(i + 1))}
              </div>
              <p className="muted cal-legend">
                <span className="cal-dot full" /> fully booked ·{" "}
                <span className="cal-dot partial" /> 1 session left ·{" "}
                <span className="cal-dot open" /> open —{" "}
                <span className="cal-sess taken">AM</span> taken time
              </p>
            </>
          )}

          {form.date && avail !== null && (
            <fieldset className="slot-groups">
              <legend>Pick a session for {new Date(`${form.date}T00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</legend>
              {selectedFree.length === 0 ? (
                <p className="muted">This day is fully booked — pick another date.</p>
              ) : (
                <div className="slot-grid">
                  {["morning", "afternoon"]
                    .filter((s) => selectedFree.includes(s))
                    .map((s) => (
                      <button
                        type="button"
                        key={s}
                        className={`slot-chip${form.session === s ? " selected" : ""}`}
                        aria-pressed={form.session === s}
                        onClick={() => setForm({ ...form, session: s })}
                      >
                        {SESSION_LABEL[s]}
                        {settings && <span className="slot-chip-time">{windowOf(s)}</span>}
                      </button>
                    ))}
                </div>
              )}
            </fieldset>
          )}
        </div>
      )}

      {step === 2 && service && (
        <div className="card booking-summary">
          <div className="summary-row">
            <span className="summary-label">Service</span>
            <span className="summary-value">
              {service.name}
              {service.price ? ` · ${fmtPrice(service.price)}` : ""}
            </span>
            <button className="summary-edit" onClick={() => setStep(0)}>
              Edit
            </button>
          </div>
          <div className="summary-row">
            <span className="summary-label">When</span>
            <span className="summary-value">
              {SESSION_LABEL[form.session]} —{" "}
              {new Date(`${form.date}T00:00`).toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
            <button className="summary-edit" onClick={() => setStep(1)}>
              Edit
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <h2>{stepLabels[2]}</h2>
          <label>
            Name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={form.email}
              disabled={!!user}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label>
            Phone
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
        </div>
      )}

      <div className="actions">
        {step > 0 && <button onClick={() => setStep(step - 1)}>Back</button>}
        {step < steps.length - 1 ? (
          <button className="primary" onClick={next}>
            Next
          </button>
        ) : (
          <button className="primary" onClick={submit}>
            Confirm booking
          </button>
        )}
      </div>
    </div>
  );
}