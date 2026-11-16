(function initialiseEmailAnnouncements(global) {
  "use strict";
  const state = { summary: null, prepared: null };
  const byId = id => document.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function invoke(client, body) {
    const { data, error } = await client.functions.invoke("email-announcements", { body });
    if (error) throw new Error(data?.error || error.message || "Email announcement request failed.");
    if (!data?.ok) throw new Error(data?.error || "Email announcement request failed.");
    return data;
  }

  function setStatus(message, isError = false) {
    const element = byId("emailAnnouncementStatus");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("is-error", isError);
  }

  function historyRows(history) {
    if (!history.length) return '<p class="small">No announcements have been sent.</p>';
    return `<div class="email-announcement-history">${history.map(item => `<div class="admin-row"><div class="admin-main"><div class="admin-title">${escape(item.subject)}</div><div class="admin-meta">${new Date(item.created_at).toLocaleString()} · ${escape(item.status)}</div></div><div class="admin-meta">${Number(item.sent_count)}/${Number(item.eligible_count)} sent${item.failed_count ? ` · ${Number(item.failed_count)} failed` : ""}</div></div>`).join("")}</div>`;
  }

  function renderAdmin() {
    const root = byId("emailAnnouncementsAdmin");
    if (!root || !state.summary) return;
    const data = state.summary;
    root.innerHTML = `<section class="admin-panel email-announcements-panel">
      <div class="email-announcement-heading"><div><div class="early-access-kicker">Communications</div><h3>Email Announcements</h3></div><div class="admin-stat-card"><div class="admin-stat-number">${Number(data.eligibleCount)}</div><div>Eligible recipients</div></div></div>
      <p class="small">Only confirmed accounts with an explicit marketing email opt-in are counted. Addresses remain server-side.</p>
      <div class="email-announcement-grid">
        <div class="email-announcement-editor">
          <label for="emailAnnouncementAudience">Audience</label>
          <select id="emailAnnouncementAudience"><option value="MARKETING_OPT_IN">Explicit email subscribers (${Number(data.eligibleCount)})</option></select>
          <label for="emailAnnouncementSubject">Subject</label>
          <input id="emailAnnouncementSubject" maxlength="200" value="${escape(data.defaults.subject)}">
          <label for="emailAnnouncementMessage">Message</label>
          <textarea id="emailAnnouncementMessage" rows="18" maxlength="20000">${escape(data.defaults.message)}</textarea>
          <div class="email-announcement-actions"><button type="button" data-email-action="preview">Refresh preview &amp; count</button><button type="button" class="secondary-btn" data-email-action="test">Send test to me</button><button type="button" class="danger-btn" data-email-action="send" disabled>Send announcement</button></div>
          ${data.bulkSendingEnabled ? "" : '<p class="small">Bulk sending is disabled pending final campaign approval.</p>'}
          <p id="emailAnnouncementStatus" class="small" role="status"></p>
        </div>
        <div><h4>Branded HTML preview</h4><iframe id="emailAnnouncementPreview" title="Email announcement preview" sandbox="" srcdoc="<p style='font-family:sans-serif;padding:20px'>Select Refresh preview &amp; count.</p>"></iframe></div>
      </div>
      <h4>Sending history</h4>${historyRows(data.history || [])}
    </section>`;
  }

  async function loadAdmin(client) {
    const root = byId("emailAnnouncementsAdmin");
    if (!root) return;
    root.innerHTML = '<p class="small">Loading email announcements…</p>';
    try { state.summary = await invoke(client, { action: "summary" }); renderAdmin(); }
    catch (error) { root.innerHTML = `<p class="small is-error">${escape(error.message)}</p>`; }
  }

  function draft(action) {
    return { action, audience: byId("emailAnnouncementAudience")?.value, subject: byId("emailAnnouncementSubject")?.value || "", message: byId("emailAnnouncementMessage")?.value || "" };
  }

  async function handleAdmin(client, target) {
    const action = target.dataset.emailAction;
    if (!action) return;
    target.disabled = true;
    try {
      if (action === "preview") {
        state.prepared = await invoke(client, draft("prepare"));
        byId("emailAnnouncementPreview").srcdoc = state.prepared.previewHtml;
        const send = document.querySelector('[data-email-action="send"]');
        if (send) send.disabled = !state.summary.bulkSendingEnabled || state.prepared.eligibleCount === 0;
        setStatus(`Preview ready for ${state.prepared.eligibleCount} eligible recipient${state.prepared.eligibleCount === 1 ? "" : "s"}.`);
      } else if (action === "test") {
        const result = await invoke(client, draft("send_test"));
        setStatus(`Test email accepted by the provider (${result.id}).`);
      } else if (action === "send") {
        if (!state.prepared) throw new Error("Refresh the preview and recipient count first.");
        const count = state.prepared.eligibleCount;
        if (!global.confirm(`Send this promotional announcement to ${count} explicitly opted-in recipient${count === 1 ? "" : "s"}? This cannot be undone.`)) return;
        const result = await invoke(client, { ...draft("send"), confirmationToken: state.prepared.confirmationToken });
        setStatus(`Announcement complete: ${result.sentCount} sent, ${result.failedCount} failed.`);
        await loadAdmin(client);
      }
    } catch (error) { setStatus(error.message, true); }
    finally { if (target.isConnected && action !== "send") target.disabled = false; }
  }

  async function addPreferenceControl(client, menu) {
    if (menu.querySelector("#accountEmailPreferences")) return;
    const button = document.createElement("button");
    button.type = "button"; button.id = "accountEmailPreferences"; button.textContent = "✉ Email preferences";
    menu.insertBefore(button, menu.querySelector("#accountLogoutBtn"));
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const current = await invoke(client, { action: "get_preferences" });
        const change = global.confirm(current.subscribed ? "Email announcements are currently on. Select OK to unsubscribe, or Cancel to leave them on." : "Receive occasional Bank of Music news and feature announcements by email? Select OK to opt in, or Cancel to leave them off.");
        if (!change) return;
        const subscribed = !current.subscribed;
        await invoke(client, { action: "update_preferences", subscribed });
        global.alert(subscribed ? "Email announcements are now on. You can unsubscribe at any time." : "You are unsubscribed from promotional email.");
      } catch (error) { global.alert(error.message); }
      finally { button.disabled = false; }
    });
  }

  function initialise(client) {
    const observer = new MutationObserver(() => { const menu = byId("accountDropdown"); if (menu) addPreferenceControl(client, menu); });
    observer.observe(document.body, { childList: true });
    byId("emailAnnouncementsAdmin")?.addEventListener("click", event => { const target = event.target.closest("[data-email-action]"); if (target) handleAdmin(client, target); });
    const token = new URLSearchParams(location.search).get("unsubscribe");
    if (token) invoke(client, { action: "unsubscribe", token }).then(data => { global.alert(data.message); const url = new URL(location.href); url.searchParams.delete("unsubscribe"); history.replaceState({}, "", url); }).catch(error => global.alert(error.message));
  }

  global.BOMEmailAnnouncements = Object.freeze({ initialise, loadAdmin, handleAdmin, invoke });
})(window);
