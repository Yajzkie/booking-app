function boot() {
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    showError("Setup broken: check config.js and that vendor/supabase.js loaded. " + e.message);
    return;
  }

  $("btn-next").onclick = () => {
    if (!validateStep(steps[currentStep])) return;
    setStep(currentStep + 1);
  };
  $("btn-prev").onclick = () => setStep(currentStep - 1);
  $("btn-submit").onclick = submitBooking;
  $("btn-again").onclick = resetForm;

  loadServices();
  setStep(0);
}

let sb;

const steps = ["service", "time", "details"];
let currentStep = 0;
let selectedService = null;

const $ = (id) => document.getElementById(id);

function setStep(step) {
  currentStep = step;
  steps.forEach((s, i) => $(`step-${s}`).classList.toggle("hidden", i !== step));
  $("btn-prev").classList.toggle("hidden", step === 0);
  $("btn-next").classList.toggle("hidden", step >= steps.length - 1);
  $("btn-submit").classList.toggle("hidden", step !== steps.length - 1);
}

async function loadServices() {
  const { data, error } = await sb
    .from("services")
    .select("*")
    .order("name");
  if (error) return showError(error.message);

  $("service-list").innerHTML = "";
  for (const s of data) {
    const card = document.createElement("div");
    card.className = "service-card";
    card.innerHTML = `
      <div>
        <div><strong>${esc(s.name)}</strong></div>
        ${s.description ? `<div class="desc">${esc(s.description)}</div>` : ""}
      </div>
      <div class="price">${formatPrice(s.price)}</div>`;
    card.onclick = () => selectService(s, card);
    $("service-list").appendChild(card);
  }
}

function selectService(service, card) {
  selectedService = service;
  document.querySelectorAll(".service-card").forEach((c) => c.classList.remove("selected"));
  card.classList.add("selected");
}

function validateStep(step) {
  if (step === "time") {
    $("booking-date").min = new Date().toISOString().split("T")[0];
    if (!$("booking-date").value || !$("booking-time").value) {
      showError("Please pick a date and time.");
      return false;
    }
  }
  if (step === "details" && !$("customer-name").value.trim()) {
    showError("Please enter your name.");
    return false;
  }
  hideError();
  return true;
}

async function submitBooking() {
  if (!selectedService) return showError("Please choose a service first.");
  if (!validateStep("time") || !validateStep("details")) return;

  const { data, error } = await sb.rpc("create_booking", {
    p_service_id: selectedService.id,
    p_date: $("booking-date").value,
    p_time: $("booking-time").value,
    p_name: $("customer-name").value.trim(),
    p_email: $("customer-email").value.trim() || null,
    p_phone: $("customer-phone").value.trim() || null,
  });

  if (error) return showError(error.message);

  $("booking-id").textContent = data;
  $("confirm-service").textContent = selectedService.name;
  $("confirm-time").textContent = new Date(
    `${$("booking-date").value}T${$("booking-time").value}`
  ).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  steps.forEach((s) => $(`step-${s}`).classList.add("hidden"));
  $("actions").classList.add("hidden");
  $("confirmation").classList.remove("hidden");
  hideError();
}

function resetForm() {
  selectedService = null;
  ["name", "email", "phone"].forEach((f) => ($(`customer-${f}`).value = ""));
  $("booking-date").value = "";
  $("booking-time").value = "";
  document.querySelectorAll(".service-card").forEach((c) => c.classList.remove("selected"));
  $("confirmation").classList.add("hidden");
  $("actions").classList.remove("hidden");
  setStep(0);
}

function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideError() { $("error").classList.add("hidden"); }

function formatPrice(p) {
  if (!p) return "Free";
  return `$${Number(p).toFixed(2)}`;
}

function esc(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

boot();