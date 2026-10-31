import { supabase, supabaseConfigReady } from "./supabase.js";

const clients = [];
const palette = ["lavender", "mint", "peach", "blue", "rose"];
const panels = {
  dashboard: document.querySelector("#dashboard-view"),
  clients: document.querySelector("#clients-view"),
  renewals: document.querySelector("#renewals-view"),
};
const authScreen = document.querySelector("#auth-screen");
const appShell = document.querySelector("#app-shell");
const authMessage = document.querySelector("#auth-message");
const modal = document.querySelector("#client-modal");
const toast = document.querySelector("#toast");
let currentUser = null;
let workspaceId = null;
let workspaceRole = null;
let toastTimer;

function dateValue(value) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, options = { month: "short", day: "numeric", year: "numeric" }) {
  const date = dateValue(value);
  return date ? new Intl.DateTimeFormat(undefined, options).format(date) : "Not set";
}

function daysUntil(value) {
  const date = dateValue(value);
  if (!date) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - now.getTime()) / 86400000);
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function initialsFor(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function getPolicies(client) {
  return Array.isArray(client.policies) ? client.policies : [];
}

function primaryPolicy(client) {
  return getPolicies(client)[0] ?? null;
}

function allRenewals() {
  return clients.flatMap((client) => getPolicies(client)
    .filter((policy) => {
      const days = daysUntil(policy.renewal_date);
      return days !== null && days >= 0;
    })
    .map((policy) => ({ ...client, policy })))
    .sort((a, b) => a.policy.renewal_date.localeCompare(b.policy.renewal_date));
}

function announce(message, isError = false) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("toast-error", isError);
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 4500);
}

function showAuthMessage(message, isError = true) {
  authMessage.textContent = message;
  authMessage.classList.toggle("error", isError);
  authMessage.hidden = false;
}

function clearAuthMessage() {
  authMessage.textContent = "";
  authMessage.hidden = true;
  authMessage.classList.remove("error");
}

function displaySignIn(message = "") {
  currentUser = null;
  workspaceId = null;
  workspaceRole = null;
  appShell.hidden = true;
  authScreen.hidden = false;
  document.querySelector("#login-form").hidden = false;
  document.querySelector("#reset-form").hidden = true;
  document.querySelector("#password-update-form").hidden = true;
  document.querySelector("#forgot-password").hidden = false;
  clearAuthMessage();
  if (message) showAuthMessage(message);
}

function reportError(context, error) {
  console.error(context, error);
  const message = error?.message || "An unexpected error occurred. Please try again.";
  if (authScreen.hidden) announce(`${context}: ${message}`, true);
  else showAuthMessage(`${context}: ${message}`);
}

function updateUserDisplay(user) {
  const email = user.email || "Signed-in user";
  const name = user.user_metadata?.full_name || email.split("@")[0];
  const initials = initialsFor(name) || "U";
  document.querySelector("#user-avatar").textContent = initials;
  document.querySelector("#user-avatar").setAttribute("aria-label", email);
  document.querySelector(".profile-copy strong").textContent = name;
  document.querySelector(".profile-copy span").textContent = email;
  document.querySelector("#page-title").innerHTML = `Good to see you, ${safeText(name)} <span class="wave" aria-hidden="true">✦</span>`;
}

async function loadWorkspace(user) {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Your account is not a member of this agency workspace. Ask the workspace owner to add you.");
  workspaceId = data.workspace_id;
  workspaceRole = data.role;
}

async function loadClients() {
  const { data, error } = await supabase
    .from("clients")
    .select("id, full_name, email, phone, notes, created_at, updated_at, policies(id, policy_type, policy_reference, status, annual_premium, renewal_date)")
    .order("full_name", { ascending: true });
  if (error) throw error;
  clients.splice(0, clients.length, ...(data || []));
  render();
}

async function showWorkspace(user) {
  currentUser = user;
  try {
    await loadWorkspace(user);
    await loadClients();
    authScreen.hidden = true;
    appShell.hidden = false;
    updateUserDisplay(user);
  } catch (error) {
    console.error("Could not load the agency workspace.", error);
    await supabase.auth.signOut();
    displaySignIn(error.message);
  }
}

function renderClientIdentity(client) {
  const initials = safeText(initialsFor(client.full_name));
  const color = palette[Math.abs(client.full_name.length) % palette.length];
  return `<span class="client-person"><span class="client-avatar ${color}">${initials}</span><span><span class="client-name">${safeText(client.full_name)}</span><span class="client-sub">${safeText(client.email || "No email provided")}</span></span></span>`;
}

function policyMarkup(client) {
  const policies = getPolicies(client);
  if (!policies.length) return '<span class="policy-name">No policy details</span>';
  const summary = policies.slice(0, 2).map((policy) =>
    `<span class="policy-name">${safeText(policy.policy_type)}</span><span class="policy-ref">${safeText(policy.policy_reference || "No reference")}</span>`,
  ).join("");
  return summary + (policies.length > 2 ? `<span class="policy-ref">+${policies.length - 2} more</span>` : "");
}

function statusMarkup(client) {
  const policies = getPolicies(client);
  const status = policies.some((policy) => policy.status === "active") ? "Active"
    : policies.some((policy) => policy.status === "pending") ? "Pending"
      : policies.length ? "Inactive" : "No policy";
  const className = status === "Active" ? "" : " status-other";
  return `<span class="status-badge${className}"><span class="status-dot"></span>${status}</span>`;
}

function rowActions(client) {
  const emailButton = client.email
    ? `<button class="row-action" type="button" data-email="${safeText(client.id)}"><span class="row-action-icon" aria-hidden="true">✉</span> Email draft</button>`
    : "";
  const policy = primaryPolicy(client);
  const calendarButton = policy?.renewal_date
    ? `<button class="row-action" type="button" data-calendar="${safeText(client.id)}"><span class="row-action-icon" aria-hidden="true">＋</span> Calendar</button>`
    : "";
  const editButton = `<button class="row-action" type="button" data-edit="${safeText(client.id)}"><span class="row-action-icon" aria-hidden="true">✎</span> Edit</button>`;
  const deleteButton = workspaceRole === "owner"
    ? `<button class="row-action delete-action" type="button" data-delete="${safeText(client.id)}">Delete</button>`
    : "";
  return `<span class="row-actions">${editButton}${emailButton}${calendarButton}${deleteButton}</span>`;
}

function renderClientRows(target, items, includeContact = false) {
  target.innerHTML = items.map((client) => {
    const policy = primaryPolicy(client);
    const nextRenewal = getPolicies(client).map((item) => item.renewal_date).filter(Boolean).sort()[0];
    return `<tr>
      <td>${renderClientIdentity(client)}</td>
      ${includeContact ? `<td>${safeText(client.phone || "—")}</td>` : ""}
      <td>${policyMarkup(client)}</td>
      <td>${statusMarkup(client)}</td>
      <td>${formatDate(nextRenewal)}</td>
      <td>${rowActions(client)}</td>
    </tr>`;
  }).join("");
}

function renewalRowMarkup(item, full = false) {
  const policy = item.policy;
  const date = dateValue(policy.renewal_date);
  const day = date ? new Intl.DateTimeFormat(undefined, { day: "2-digit" }).format(date) : "–";
  const month = date ? new Intl.DateTimeFormat(undefined, { month: "short" }).format(date).toUpperCase() : "TBD";
  const remaining = daysUntil(policy.renewal_date);
  const timing = remaining === 0 ? "Today" : remaining === 1 ? "Tomorrow" : `${remaining} days`;
  if (!full) {
    return `<div class="renewal-row">
      <span class="date-tile"><strong>${day}</strong><span>${month}</span></span>
      <span class="renewal-copy"><strong>${safeText(item.full_name)}</strong><span>${safeText(policy.policy_type)} · ${safeText(policy.policy_reference || "No reference")}</span></span>
      <span class="renewal-days">${timing}</span>
    </div>`;
  }
  return `<article class="renewal-full-row">
    <span class="date-tile"><strong>${day}</strong><span>${month}</span></span>
    <span class="renewal-client"><strong>${safeText(item.full_name)}</strong><span>${safeText(item.email || "No email provided")}</span></span>
    <span class="renewal-product"><strong>${safeText(policy.policy_type)}</strong><span>${safeText(policy.policy_reference || "No reference")}</span></span>
    <span class="renewal-days">${timing} · ${formatDate(policy.renewal_date, { month: "short", day: "numeric" })}</span>
    <span class="row-actions"><button class="row-action" type="button" data-email="${safeText(item.id)}">Email draft</button><button class="row-action" type="button" data-calendar="${safeText(item.id)}">Calendar</button></span>
  </article>`;
}

function renderRenewalRows(target, items, full = false) {
  target.innerHTML = items.length
    ? items.map((item) => renewalRowMarkup(item, full)).join("")
    : full ? "" : '<div class="empty-inline">No upcoming renewals.</div>';
}

function render() {
  const renewals = allRenewals();
  const next30 = renewals.filter((item) => daysUntil(item.policy.renewal_date) <= 30);
  const activePolicies = clients.reduce((sum, client) =>
    sum + getPolicies(client).filter((policy) => policy.status === "active").length, 0);
  document.querySelector("#total-clients").textContent = clients.length;
  document.querySelector("#active-policies").textContent = activePolicies;
  document.querySelector("#upcoming-renewals").textContent = next30.length;
  document.querySelector("#follow-ups").textContent = next30.length;
  document.querySelector("#client-nav-count").textContent = clients.length;
  document.querySelector("#client-result-count").textContent = clients.length;
  document.querySelector("#renewal-result-count").textContent = renewals.length;
  renderRenewalRows(document.querySelector("#dashboard-renewals"), renewals.slice(0, 4));
  renderRenewalRows(document.querySelector("#all-renewals"), renewals, true);
  renderClientRows(document.querySelector("#recent-clients"), clients.slice(0, 4));
  renderClientRows(document.querySelector("#all-clients"), clients, true);
  document.querySelector("#no-renewals").hidden = renewals.length > 0;
  filterClients(document.querySelector("#client-search").value);
}

function filterClients(query) {
  const normalized = query.trim().toLowerCase();
  const filtered = clients.filter((client) => {
    const policyText = getPolicies(client).map((policy) =>
      `${policy.policy_type} ${policy.policy_reference || ""}`).join(" ");
    return [client.full_name, client.email, client.phone, client.notes, policyText]
      .some((value) => String(value || "").toLowerCase().includes(normalized));
  });
  renderClientRows(document.querySelector("#all-clients"), filtered, true);
  document.querySelector("#client-result-count").textContent = filtered.length;
  document.querySelector("#no-search-results").hidden = filtered.length > 0 || !normalized;
}

function showView(name) {
  if (!panels[name]) return;
  Object.entries(panels).forEach(([key, panel]) => {
    const active = key === name;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
  const labels = { dashboard: "Overview", clients: "Clients", renewals: "Renewals" };
  document.querySelector("#breadcrumb-current").textContent = labels[name];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openModal(client = null) {
  const form = document.querySelector("#client-form");
  form.reset();
  document.querySelector("#modal-title").textContent = client ? "Edit client" : "Add a client";
  form.querySelector('button[type="submit"]').textContent = client ? "Save changes" : "Save client";
  document.querySelector(".modal-notice").textContent = "Client details are shared with authorized members of your agency workspace.";
  form.elements.name.value = client?.full_name || "";
  form.elements.email.value = client?.email || "";
  form.elements.phone.value = client?.phone || "";
  form.elements.notes.value = client?.notes || "";
  const policy = client ? primaryPolicy(client) : null;
  form.elements.policyType.value = policy?.policy_type || "Life insurance";
  form.elements.policyNumber.value = policy?.policy_reference || "";
  form.elements.policyStatus.value = policy?.status || "active";
  form.elements.premium.value = policy?.annual_premium ?? "";
  form.elements.renewalDate.value = policy?.renewal_date || "";
  form.dataset.clientId = client?.id || "";
  modal.hidden = false;
  form.elements.name.focus();
}

function closeModal() {
  modal.hidden = true;
  document.querySelector("#client-form").reset();
}

function escapeCalendarText(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function downloadCalendar(items) {
  const withDates = items.filter((item) => dateValue(item.policy.renewal_date));
  if (!withDates.length) {
    announce("There are no upcoming renewal dates to add.");
    return;
  }
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const events = withDates.flatMap((item) => {
    const dateStamp = item.policy.renewal_date.replace(/-/g, "");
    const [year, month, day] = item.policy.renewal_date.split("-").map(Number);
    const end = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10).replace(/-/g, "");
    return [
      "BEGIN:VEVENT",
      `UID:coverdesk-${item.policy.id}-${dateStamp}@workspace.invalid`,
      `DTSTAMP:${timestamp}`,
      `DTSTART;VALUE=DATE:${dateStamp}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${escapeCalendarText(`Policy renewal: ${item.full_name}`)}`,
      `DESCRIPTION:${escapeCalendarText(`${item.policy.policy_type} renewal follow-up. Reference: ${item.policy.policy_reference || "not provided"}.`)}`,
      "END:VEVENT",
    ];
  });
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Coverdesk//Workspace//EN", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR", ""].join("\r\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "coverdesk-renewals.ics";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  announce(`${withDates.length} reminder${withDates.length === 1 ? "" : "s"} downloaded. Import the .ics file into your calendar.`);
}

function emailClient(client) {
  if (!client.email) {
    announce("Add an email address to this client's record first.", true);
    return;
  }
  const policy = primaryPolicy(client);
  const subject = `A quick note about your ${policy?.policy_type?.toLowerCase() || "insurance policy"}`;
  const renewal = policy?.renewal_date ? formatDate(policy.renewal_date) : "upcoming policy date";
  const body = `Hi ${client.full_name.split(" ")[0]},\r\n\r\nI wanted to get in touch about your policy renewal on ${renewal}. Let me know a convenient time to talk.\r\n\r\nBest,`;
  window.location.href = `mailto:${encodeURIComponent(client.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function handleLogin(event) {
  event.preventDefault();
  clearAuthMessage();
  if (!supabase) {
    showAuthMessage("Supabase isn’t configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your Vercel project settings.");
    return;
  }
  const form = new FormData(event.currentTarget);
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
    });
    if (error) throw error;
  } catch (error) {
    reportError("Sign in failed", error);
  } finally {
    submit.disabled = false;
  }
}

async function handlePasswordReset(event) {
  event.preventDefault();
  clearAuthMessage();
  if (!supabase) {
    showAuthMessage("Supabase isn’t configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your Vercel project settings.");
    return;
  }
  const form = new FormData(event.currentTarget);
  try {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.resetPasswordForEmail(String(form.get("email")).trim(), { redirectTo });
    if (error) throw error;
    showAuthMessage("If an account exists for that email, a password reset link has been sent.", false);
  } catch (error) {
    reportError("Could not send password reset email", error);
  }
}

async function handlePasswordUpdate(event) {
  event.preventDefault();
  clearAuthMessage();
  if (!supabase) {
    showAuthMessage("Supabase isn’t configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your Vercel project settings.");
    return;
  }
  const password = String(new FormData(event.currentTarget).get("password"));
  if (password.length < 12) {
    showAuthMessage("Choose a password with at least 12 characters.");
    return;
  }
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    displaySignIn("Password updated. Sign in with your new password.");
  } catch (error) {
    reportError("Could not update password", error);
  }
}

function formValues(form) {
  const values = new FormData(form);
  const premiumValue = String(values.get("premium") || "").trim();
  return {
    p_workspace_id: workspaceId,
    p_full_name: String(values.get("name") || "").trim(),
    p_email: String(values.get("email") || "").trim() || null,
    p_phone: String(values.get("phone") || "").trim() || null,
    p_notes: String(values.get("notes") || "").trim() || null,
    p_policy_type: String(values.get("policyType") || "Other"),
    p_policy_reference: String(values.get("policyNumber") || "").trim() || null,
    p_policy_status: String(values.get("policyStatus") || "active"),
    p_annual_premium: premiumValue ? Number(premiumValue) : null,
    p_renewal_date: String(values.get("renewalDate") || "") || null,
  };
}

async function saveClient(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const payload = formValues(form);
  if (!payload.p_full_name) {
    form.elements.name.focus();
    return;
  }
  submit.disabled = true;
  try {
    const clientId = form.dataset.clientId;
    if (clientId) {
      const { error } = await supabase.rpc("update_client_with_policy", {
        ...payload,
        p_client_id: clientId,
      });
      if (error) throw error;
    } else {
      const { error } = await supabase.rpc("create_client_with_policy", payload);
      if (error) throw error;
    }
    closeModal();
    await loadClients();
    announce(clientId ? "Client details updated." : "Client added to your workspace.");
  } catch (error) {
    reportError("Could not save client", error);
  } finally {
    submit.disabled = false;
  }
}

async function deleteClient(client) {
  if (!window.confirm(`Permanently delete ${client.full_name} and their policy records? This cannot be undone.`)) return;
  try {
    const { error } = await supabase.from("clients").delete().eq("id", client.id);
    if (error) throw error;
    await loadClients();
    announce("Client and related policy records deleted.");
  } catch (error) {
    reportError("Could not delete client", error);
  }
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((item) =>
    item.addEventListener("click", () => showView(item.dataset.view)));
  document.querySelectorAll("[data-view-link]").forEach((button) =>
    button.addEventListener("click", () => showView(button.dataset.viewLink)));
  document.querySelectorAll("[data-open-client]").forEach((button) =>
    button.addEventListener("click", () => openModal()));
  document.querySelectorAll("[data-close-modal]").forEach((button) =>
    button.addEventListener("click", closeModal));
  document.querySelector("#client-search").addEventListener("input", (event) => filterClients(event.target.value));
  document.querySelector("#dismiss-notice").addEventListener("click", () => {
    document.querySelector(".demo-notice").hidden = true;
  });
  document.querySelector("#help-button").addEventListener("click", () =>
    announce("Records are stored in your agency’s Supabase workspace and visible to its authorized members."));
  document.querySelector("#calendar-all-button").addEventListener("click", () => downloadCalendar(allRenewals()));
  document.querySelector("#client-form").addEventListener("submit", saveClient);
  document.querySelector("#login-form").addEventListener("submit", handleLogin);
  document.querySelector("#reset-form").addEventListener("submit", handlePasswordReset);
  document.querySelector("#password-update-form").addEventListener("submit", handlePasswordUpdate);
  document.querySelector("#forgot-password").addEventListener("click", () => {
    clearAuthMessage();
    document.querySelector("#login-form").hidden = true;
    document.querySelector("#reset-form").hidden = false;
    document.querySelector("#forgot-password").hidden = true;
  });
  document.querySelector("#sign-out").addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();
    if (error) reportError("Could not sign out", error);
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-email], [data-calendar], [data-edit], [data-delete]");
    if (!target) return;
    const client = clients.find((item) => item.id === target.dataset.email || item.id === target.dataset.calendar || item.id === target.dataset.edit || item.id === target.dataset.delete);
    if (!client) return;
    if (target.hasAttribute("data-email")) emailClient(client);
    if (target.hasAttribute("data-calendar")) {
      const policy = primaryPolicy(client);
      if (policy) downloadCalendar([{ ...client, policy }]);
    }
    if (target.hasAttribute("data-edit")) openModal(client);
    if (target.hasAttribute("data-delete")) void deleteClient(client);
  });
}

async function initialize() {
  bindEvents();
  if (!supabaseConfigReady || !supabase) {
    showAuthMessage("Connect your Supabase project by setting VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
    document.querySelectorAll("#login-form button[type='submit'], #reset-form button[type='submit'], #forgot-password")
      .forEach((button) => { button.disabled = true; });
    return;
  }

  supabase.auth.onAuthStateChange((event, session) => {
    window.setTimeout(() => {
      if (event === "PASSWORD_RECOVERY") {
        authScreen.hidden = false;
        appShell.hidden = true;
        document.querySelector("#login-form").hidden = true;
        document.querySelector("#reset-form").hidden = true;
        document.querySelector("#password-update-form").hidden = false;
        document.querySelector("#forgot-password").hidden = true;
        clearAuthMessage();
      } else if (session?.user) {
        void showWorkspace(session.user);
      } else {
        displaySignIn();
      }
    }, 0);
  });

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    reportError("Could not restore sign-in session", error);
    return;
  }
  if (data.session?.user) await showWorkspace(data.session.user);
}

document.querySelector("#today-label").textContent = new Intl.DateTimeFormat(undefined, {
  weekday: "long", month: "long", day: "numeric",
}).format(new Date()).toUpperCase();
initialize().catch((error) => reportError("Application startup failed", error));
