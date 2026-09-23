import { useEffect, useState } from "react";
import { api, storage } from "../api.js";
import { useAuth } from "../auth.jsx";
import { fmtPrice } from "./Dashboard.jsx";

export default function Book({ navigate }) {
  const { user } = useAuth();
  const [services, setServices] = useState([]);
  const [step, setStep] = useState(0);
  const [service, setService] = useState(null);
  const [form, setForm] = useState({ date: "", time: "", name: user?.name?.trim() ?? user?.email?.split("@")[0] ?? "", email: user?.email ?? "", phone: "" });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/services").then(setServices).catch((e) => setError(e.message));
  }, []);

  const steps = ["service", "time", "details"];
  const stepLabels = ["Service", "Date & time", "Details"];

  function next() {
    if (steps[step] === "service" && !service) {
      return setError("Pick a service");
    }
    if (steps[step] === "time" && (!form.date || !form.time)) {
      return setError("Pick a date and time");
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
          time: form.time,
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
          Reference <strong>#{result.id}</strong> — {service.name} on{" "}
          {new Date(`${result.date}T${result.time}`).toLocaleString()}.
        </p>
        <p className="muted">
          {user
            ? "You can track its status from your dashboard."
            : form.email
              ? `We'll confirm it to ${form.email}.`
              : "We'll confirm your slot shortly."}
        </p>
        <button onClick={() => location.reload()}>Book another</button>
      </div>
    );
  }

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
          <label>
            Date
            <input
              type="date"
              value={form.date}
              min={new Date().toISOString().split("T")[0]}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
          <label>
            Time
            <input
              type="time"
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
            />
          </label>
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
              {new Date(`${form.date}T${form.time}`).toLocaleString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
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