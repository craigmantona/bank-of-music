(function initialiseEmailAnnouncements(global) {
  "use strict";
  const state = { summary: null, prepared: null, invitationCheckedUserId: null };
  const byId = id => document.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const invitationCss = `.email-updates-invitation{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:rgba(2,5,11,.72)}.email-updates-card{width:min(100%,520px);max-height:calc(100vh - 40px);overflow:auto;padding:28px;border:1px solid var(--border,#39445a);border-radius:18px;background:var(--panel,#101725);box-shadow:0 20px 70px rgba(0,0,0,.55)}.email-updates-card h2{margin:4px 0 12px}.email-updates-card p{line-height:1.55}.email-updates-kicker{margin:0;color:var(--accent,#ef476f);font-size:.75rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.email-updates-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}.email-updates-actions button{min-height:44px}@media(max-width:560px){.email-updates-invitation{align-items:end;padding:0}.email-updates-card{width:100%;max-height:90vh;padding:22px 18px;border-radius:18px 18px 0 0}.email-updates-actions{flex-direction:column-reverse}.email-updates-actions button{width:100%}}`;

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

  function removeInvitation() {
    byId("emailUpdatesInvitation")?.remove();
  }

  function renderInvitation(client) {
    if (byId("emailUpdatesInvitation")) return;
    const overlay = document.createElement("div");
    overlay.id = "emailUpdatesInvitation";
    overlay.className = "email-updates-invitation";
    overlay.innerHTML = `<section class="email-updates-card" role="dialog" aria-modal="true" aria-labelledby="emailUpdatesTitle" aria-describedby="emailUpdatesDescription">
      <p class="email-updates-kicker">Optional</p>
      <h2 id="emailUpdatesTitle">Stay in tune with Bank of Music?</h2>
      <p id="emailUpdatesDescription">Get occasional news, feature announcements and special releases by email. This is entirely optional and you can unsubscribe at any time.</p>
      <label class="marketing-consent-option" for="emailUpdatesConsent"><input id="emailUpdatesConsent" type="checkbox"><span>Yes, I would like to receive email updates.</span></label>
      <p id="emailUpdatesInvitationStatus" class="small" role="status" aria-live="polite"></p>
      <div class="email-updates-actions"><button type="button" class="secondary-btn" data-invitation-action="dismiss">Not now</button><button type="button" data-invitation-action="subscribe" disabled>Turn on email updates</button></div>
    </section>`;
    document.body.appendChild(overlay);
    const checkbox = byId("emailUpdatesConsent");
    const subscribe = overlay.querySelector('[data-invitation-action="subscribe"]');
    const dismiss = overlay.querySelector('[data-invitation-action="dismiss"]');
    checkbox.addEventListener("change", () => { subscribe.disabled = !checkbox.checked; });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") dismiss.click(); });
    overlay.addEventListener("click", async event => {
      const button = event.target.closest("[data-invitation-action]");
      if (!button) return;
      subscribe.disabled = true; dismiss.disabled = true;
      try {
        if (button.dataset.invitationAction === "subscribe") {
          if (!checkbox.checked) return;
          await invoke(client, { action: "update_preferences", subscribed: true });
          global.alert("Email updates are now on. You can unsubscribe at any time.");
        } else {
          await invoke(client, { action: "dismiss_invitation" });
        }
        removeInvitation();
      } catch (error) {
        const status = byId("emailUpdatesInvitationStatus");
        if (status) { status.textContent = error.message; status.classList.add("is-error"); }
        subscribe.disabled = !checkbox.checked; dismiss.disabled = false;
      }
    });
    dismiss.focus();
  }

  async function maybeShowInvitation(client, session) {
    const userId = session?.user?.id;
    if (!userId || state.invitationCheckedUserId === userId) return;
    state.invitationCheckedUserId = userId;
    try {
      const preferences = await invoke(client, { action: "get_preferences" });
      if (preferences.invitationPending) renderInvitation(client);
    } catch (error) { console.warn("Email updates invitation could not be loaded.", error); }
  }

  function initialise(client) {
    if (!byId("emailUpdatesInvitationStyles")) {
      const styles = document.createElement("style"); styles.id = "emailUpdatesInvitationStyles"; styles.textContent = invitationCss; document.head.appendChild(styles);
    }
    const observer = new MutationObserver(() => { const menu = byId("accountDropdown"); if (menu) addPreferenceControl(client, menu); });
    observer.observe(document.body, { childList: true });
    byId("emailAnnouncementsAdmin")?.addEventListener("click", event => { const target = event.target.closest("[data-email-action]"); if (target) handleAdmin(client, target); });
    const token = new URLSearchParams(location.search).get("unsubscribe");
    if (token) invoke(client, { action: "unsubscribe", token }).then(data => { global.alert(data.message); const url = new URL(location.href); url.searchParams.delete("unsubscribe"); history.replaceState({}, "", url); }).catch(error => global.alert(error.message));
    client.auth.getSession().then(({ data }) => maybeShowInvitation(client, data.session));
    client.auth.onAuthStateChange((event, session) => {
      if (!session) { state.invitationCheckedUserId = null; removeInvitation(); return; }
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") maybeShowInvitation(client, session);
    });
  }

  global.BOMEmailAnnouncements = Object.freeze({ initialise, loadAdmin, handleAdmin, invoke });
})(window);
