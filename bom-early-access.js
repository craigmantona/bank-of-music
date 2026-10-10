(function (global) {
  "use strict";

  const state = { mode: "PUBLIC", invitationToken: "", adminData: null };
  const el = id => global.document?.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

  function badge(isFoundingMember) {
    return isFoundingMember ? `<span class="founding-member-badge" tabindex="0" role="img" aria-label="Founding Member" title="Founding Member"><span class="founding-member-record" aria-hidden="true"></span><span class="founding-member-label">Founding Member</span></span>` : "";
  }

  async function invoke(client, body) {
    const { data, error } = await client.functions.invoke("early-access", { body });
    if (error) throw new Error(data?.error || error.message || "Early Access request failed.");
    if (!data?.ok) throw new Error(data?.error || "Early Access request failed.");
    return data;
  }

  function applyMode() {
    const invitation = Boolean(state.invitationToken);
    el("earlyAccessIntro")?.classList.toggle("hidden", state.mode !== "INVITATION_ONLY" || invitation);
    el("signupBtn")?.classList.toggle("hidden", state.mode === "INVITATION_ONLY" && !invitation);
    if (el("signupBtn") && invitation) el("signupBtn").textContent = "Create invited account";
  }

  async function init(client) {
    state.invitationToken = new URLSearchParams(global.location.search).get("invitation") || "";
    const { data } = await client.from("registration_public_state").select("mode").maybeSingle();
    state.mode = data?.mode || "PUBLIC";
    applyMode();

    el("requestEarlyAccessBtn")?.addEventListener("click", () => el("earlyAccessRequestForm")?.classList.remove("hidden"));
    el("cancelEarlyAccessRequestBtn")?.addEventListener("click", () => el("earlyAccessRequestForm")?.classList.add("hidden"));
    el("activateInvitationBtn")?.addEventListener("click", () => {
      el("authMessage").textContent = "Open the secure activation link from your invitation email.";
    });
    el("earlyAccessRequestForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const message = el("earlyAccessRequestMessage");
      try {
        const result = await invoke(client, { action: "request_access", name: el("earlyAccessName").value, email: el("earlyAccessEmail").value });
        message.textContent = result.message;
        event.currentTarget.reset();
      } catch (error) { message.textContent = error.message; }
    });
  }

  async function loadAdmin(client) {
    const root = el("earlyAccessAdmin");
    if (!root) return;
    try { state.adminData = await invoke(client, { action: "list" }); }
    catch { root.innerHTML = ""; return; }
    renderAdmin();
  }

  function invitationStatus(invitation) {
    if (invitation.status === "SENT" && new Date(invitation.expires_at) <= new Date()) return "EXPIRED";
    return invitation.status;
  }

  function renderAdmin() {
    const root = el("earlyAccessAdmin");
    const data = state.adminData;
    if (!root || !data) return;
    const pending = data.requests.filter(item => item.status === "PENDING").length;
    const sent = data.invitations.filter(item => invitationStatus(item) === "SENT").length;
    const accepted = data.invitations.filter(item => item.status === "ACCEPTED").length;
    root.innerHTML = `<section class="admin-panel early-access-admin-panel">
      <div class="early-access-admin-heading"><div><div class="early-access-kicker">Registration</div><h3>Early Access</h3></div>
      <label>Registration status <select id="registrationModeSelect"><option value="PUBLIC" ${data.settings.mode === "PUBLIC" ? "selected" : ""}>PUBLIC</option><option value="INVITATION_ONLY" ${data.settings.mode === "INVITATION_ONLY" ? "selected" : ""}>INVITATION ONLY</option></select></label></div>
      <div class="admin-summary-grid"><div class="admin-stat-card"><div class="admin-stat-number">${pending}</div><div>Pending Requests</div></div><div class="admin-stat-card"><div class="admin-stat-number">${sent}</div><div>Invitations Sent</div></div><div class="admin-stat-card"><div class="admin-stat-number">${accepted}</div><div>Invitations Accepted</div></div><div class="admin-stat-card"><div class="admin-stat-number">${data.foundingMembers}</div><div>Founding Members</div></div></div>
      <form id="directInvitationForm" class="early-access-direct-form"><input id="directInvitationEmail" type="email" placeholder="Email address" required><button type="submit">Send direct invitation</button></form>
      <p id="earlyAccessAdminMessage" class="small" role="status"></p>
      <h4>Requests</h4><div class="admin-list">${data.requests.map(item => `<div class="admin-row"><div class="admin-main"><div class="admin-title">${escape(item.name)}</div><div class="admin-meta">${escape(item.email)} · ${new Date(item.requested_at).toLocaleDateString()} · ${escape(item.status)}</div></div><div class="admin-actions">${item.status === "PENDING" ? `<button data-ea-approve="${item.id}">Approve &amp; Invite</button><button class="secondary-btn" data-ea-decline="${item.id}">Decline</button>` : ""}</div></div>`).join("") || `<p class="small">No requests yet.</p>`}</div>
      <h4>Invitations</h4><div class="admin-list">${data.invitations.map(item => `<div class="admin-row"><div class="admin-main"><div class="admin-title">${escape(item.email)}</div><div class="admin-meta">${escape(invitationStatus(item))} · expires ${new Date(item.expires_at).toLocaleDateString()}</div></div><div class="admin-actions">${["PENDING", "SENT"].includes(item.status) ? `<button class="secondary-btn" data-ea-revoke="${item.id}">Revoke</button>` : ""}</div></div>`).join("") || `<p class="small">No invitations yet.</p>`}</div>
    </section>`;
  }

  async function handleAdmin(client, target) {
    const action = target.dataset.eaApprove ? "approve" : target.dataset.eaDecline ? "decline" : target.dataset.eaRevoke ? "revoke" : "";
    if (!action) return false;
    target.disabled = true;
    try { await invoke(client, { action, requestId: target.dataset.eaApprove || target.dataset.eaDecline, invitationId: target.dataset.eaRevoke }); await loadAdmin(client); }
    catch (error) { el("earlyAccessAdminMessage").textContent = error.message; target.disabled = false; }
    return true;
  }

  global.BOMEarlyAccess = { state, init, loadAdmin, handleAdmin, badge, invoke };
})(window);
