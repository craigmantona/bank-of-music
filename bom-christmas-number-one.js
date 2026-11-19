(function initialiseChristmasNumberOne() {
  "use strict";

  const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  const spotifyLink = candidate => /^[A-Za-z0-9]{22}$/.test(String(candidate?.spotifyId || ""))
    ? `<a class="bom-cno-listen" href="https://open.spotify.com/track/${candidate.spotifyId}" target="_blank" rel="noopener noreferrer">Listen on Spotify<span class="sr-only"> to ${esc(candidate.title)} by ${esc(candidate.artist)}</span></a>` : "";
  const number = value => new Intl.NumberFormat("en-GB").format(Number(value) || 0);
  const londonDate = value => new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date(value));

  function countdownParts(target, now = new Date()) {
    const remaining = Math.max(0, new Date(target).getTime() - new Date(now).getTime());
    return {
      complete: remaining === 0,
      days: Math.floor(remaining / 86400000),
      hours: Math.floor(remaining / 3600000) % 24,
      minutes: Math.floor(remaining / 60000) % 60,
      seconds: Math.floor(remaining / 1000) % 60
    };
  }

  function countdownLabel(schedule, now = new Date()) {
    const current = new Date(now), opens = new Date(schedule.opensAt), closes = new Date(schedule.closesAt), reveals = new Date(schedule.revealsAt);
    let target = reveals, prefix = "Reveal in";
    if (current < opens) { target = opens; prefix = "Voting opens in"; }
    else if (current < closes) { target = closes; prefix = "Voting closes in"; }
    else if (current >= reveals) return "Christmas Eve reveal time reached";
    const parts = countdownParts(target, current);
    return `${prefix} ${parts.days}d ${parts.hours}h ${parts.minutes}m ${parts.seconds}s`;
  }

  function rankingRows(results) {
    return (results?.ranking || []).slice(0, 10).map(row => `<li class="bom-cno-rank${row.isTied ? " is-tied" : ""}">
      <span>${row.position}</span><div><strong>${esc(row.title)}</strong><small>${esc(row.artist)}${row.isTied ? " · tied on votes" : ""}</small></div><b>${number(row.votes)}</b>
    </li>`).join("");
  }

  function renderReveal(results, { preview = false } = {}) {
    if (results?.publicationBlocked) {
      const leaders = (results.leaderTie || []).map(candidate => `<li><strong>${esc(candidate.title)}</strong><span>${esc(candidate.artist)} · ${number(candidate.votes)} votes</span></li>`).join("");
      return `<section class="bom-cno-reveal is-blocked" aria-labelledby="bomCnoRevealTitle">
        <p>WINNER ANNOUNCEMENT ${preview ? "PREVIEW" : ""}</p><h3 id="bomCnoRevealTitle">First place is tied</h3>
        <p>No single Christmas Number 1 can be published until an administrator records a documented tie resolution.</p><ul>${leaders}</ul>
        <span class="bom-cno-safety">Publication blocked server-side</span>
      </section>`;
    }
    if (!results?.winner) return `<section class="bom-cno-reveal"><p>WINNER ANNOUNCEMENT ${preview ? "PREVIEW" : ""}</p><h3>Awaiting votes</h3><p>The Christmas Number 1 feature will appear here after the approved Christmas Eve reveal.</p></section>`;
    return `<section class="bom-cno-reveal" aria-labelledby="bomCnoRevealTitle">
      <p>THE BANK OF MUSIC · CHRISTMAS NUMBER 1 ${esc(results.year)}</p>
      <div class="bom-cno-winner-mark" aria-hidden="true">1</div><h3 id="bomCnoRevealTitle">${esc(results.winner.title)}</h3><h4>${esc(results.winner.artist)}</h4>
      <p>${number(results.winner.votes)} vote${Number(results.winner.votes) === 1 ? "" : "s"}${results.winner.tieResolved ? " · selected after a documented first-place tie resolution" : ""}</p>
      ${spotifyLink(results.winner)}
      <div class="bom-cno-countdown-list"><h4>The festive top 10</h4><ol reversed start="10">${[...(results.ranking || []).slice(0, 10)].reverse().map(row => `<li><span>${esc(row.title)}</span><small>${esc(row.artist)} · ${number(row.votes)} votes${row.isTied ? " · tied; ordered title A–Z" : ""}</small></li>`).join("")}</ol></div>
    </section>`;
  }

  function renderArchive(items = []) {
    return `<section class="bom-cno-archive"><header><p>PERMANENT RECORD</p><h3>Annual winners archive</h3></header>${items.length
      ? `<div>${items.map(item => `<article><span>${esc(item.year)}</span><div><strong>${esc(item.title)}</strong><small>${esc(item.artist)}</small></div>${spotifyLink(item)}</article>`).join("")}</div>`
      : `<p class="bom-cno-empty">No annual winner has been published yet. Unapproved years never appear here.</p>`}</section>`;
  }

  function candidateCards(candidates, savedId, pendingId, query, showAll) {
    const normalized = query.trim().toLocaleLowerCase("en-GB");
    const matches = candidates.filter(candidate => !normalized || `${candidate.title} ${candidate.artist}`.toLocaleLowerCase("en-GB").includes(normalized));
    const visible = normalized || showAll ? matches : matches.slice(0, 12);
    return {
      total: matches.length,
      html: visible.map(candidate => `<article class="bom-cno-choice${candidate.id === savedId ? " is-saved" : ""}${candidate.id === pendingId ? " is-pending" : ""}" data-candidate-id="${esc(candidate.id)}">
        <button type="button" data-cno-select="${esc(candidate.id)}" aria-pressed="${candidate.id === pendingId}" aria-label="Choose ${esc(candidate.title)} by ${esc(candidate.artist)}">
          <span class="bom-cno-choice-check" aria-hidden="true">${candidate.id === savedId ? "✓" : candidate.id === pendingId ? "●" : "○"}</span>
          <span><strong>${esc(candidate.title)}</strong><small>${esc(candidate.artist)}</small></span>
        </button>${spotifyLink(candidate)}
      </article>`).join("")
    };
  }

  function shell() {
    return `<section class="bom-cno-admin" data-cno-root aria-labelledby="bomCnoAdminTitle">
      <header class="bom-cno-hero"><img src="assets/bom-header-logo.png" alt="Bank of Music"><div><p>PRIVATE ADMIN PREVIEW</p><h2 id="bomCnoAdminTitle">BOM Christmas Number 1</h2><span>One song. One vote. One festive winner.</span></div><b>OFF</b></header>
      <div class="bom-cno-preview-warning"><strong>Isolated preview</strong><span>Preview selections never touch official annual votes. Public activation, official RPC grants, reveal approval and deployment all remain off.</span></div>
      <div class="bom-cno-body" data-cno-body><p class="bom-cno-loading">Preparing the private preview…</p></div>
    </section>`;
  }

  function publicPanel(state, view) {
    const schedule = state.schedule, saved = (state.candidates || []).find(candidate => candidate.id === state.selectedCandidateId);
    if (state.phase === "revealed" && state.results) return `${renderReveal(state.results)}${renderArchive(view.archive || [])}`;
    if (["closed", "awaiting_reveal_approval", "reveal"].includes(state.phase)) return `<section class="bom-cno-public-wait"><div class="bom-cno-winner-mark" aria-hidden="true">✦</div><p>VOTING IS CLOSED</p><h2>The Christmas Eve reveal is on its way</h2><span>Voting closed on 20 December at 23:59 UK time. Standings remain secret until the approved 24 December reveal.</span>${saved ? `<aside><small>Your final choice</small><strong>${esc(saved.title)}</strong><span>${esc(saved.artist)}</span></aside>` : ""}</section>`;
    const cards = candidateCards(state.candidates || [], state.selectedCandidateId, view.pendingId, view.query, view.showAll);
    const pending = (state.candidates || []).find(candidate => candidate.id === view.pendingId);
    const open = state.phase === "open";
    return `<section class="bom-cno-public-vote">
      <header><p>${open ? "VOTING IS OPEN" : "VOTING OPENS 1 DECEMBER"}</p><h2>Choose the song that should be Christmas Number 1</h2><span>One choice per BOM member. Change it any time until 20 December at 23:59 UK time; only your latest selection counts.</span></header>
      <div class="bom-cno-countdown" role="timer" data-cno-public-countdown>${esc(countdownLabel(schedule))}<small>Christmas Eve reveal · 24 December</small></div>
      ${saved ? `<aside class="bom-cno-public-saved"><small>Your saved choice</small><strong>${esc(saved.title)}</strong><span>${esc(saved.artist)}</span></aside>` : ""}
      <label class="bom-cno-search"><span>Search the curated 100</span><input type="search" data-cno-public-search value="${esc(view.query)}" placeholder="Song or artist" autocomplete="off"></label>
      <div class="bom-cno-choices${open ? "" : " is-locked"}">${cards.html}</div>
      ${!view.query && cards.total > 12 && !view.showAll ? `<button class="bom-cno-show-all" type="button" data-cno-public-show-all>Show all ${cards.total} songs</button>` : ""}
      ${open && pending ? `<div class="bom-cno-confirm"><div><small>${pending.id === state.selectedCandidateId ? "CURRENT SELECTION" : "CONFIRM YOUR VOTE"}</small><strong>${esc(pending.title)}</strong><span>${esc(pending.artist)}</span></div><button type="button" data-cno-public-confirm${view.busy || pending.id === state.selectedCandidateId ? " disabled" : ""}>${view.busy ? "Saving…" : pending.id === state.selectedCandidateId ? "Vote saved" : "Confirm vote"}</button></div>` : ""}
      <p class="bom-cno-message" role="status" aria-live="polite">${esc(view.message)}</p>
    </section>`;
  }

  async function openPublic(initialState = null) {
    const bridge = window.BOMPresentationBridge;
    let dialog = document.getElementById("bomChristmasNumberOne");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "bomChristmasNumberOne";
      dialog.className = "bom-cno-dialog";
      dialog.setAttribute("aria-labelledby", "bomCnoPublicTitle");
      document.body.append(dialog);
    }
    const view = { state: initialState, archive: [], pendingId: initialState?.selectedCandidateId || "", query: "", showAll: false, busy: false, message: "" };
    const draw = () => {
      dialog.innerHTML = `<header class="bom-cno-public-hero"><button type="button" data-cno-public-close aria-label="Close Christmas Number 1">EXIT</button><img src="assets/bom-header-logo.png" alt="Bank of Music"><div><p>THE BANK OF MUSIC PRESENTS</p><h1 id="bomCnoPublicTitle">CHRISTMAS NUMBER 1</h1><span>One song. One vote. One festive winner.</span></div></header><main>${publicPanel(view.state, view)}</main>`;
    };
    try {
      view.state = view.state || await bridge.loadChristmasNumberOnePublicState();
      view.pendingId = view.state.selectedCandidateId || "";
      if (view.state.phase === "revealed") view.archive = await bridge.loadChristmasNumberOneArchive();
      draw();
    } catch (error) {
      dialog.innerHTML = `<div class="bom-cno-error"><h2 id="bomCnoPublicTitle">Christmas Number 1 is unavailable</h2><p>${esc(error.message)}</p><button type="button" data-cno-public-close>Close</button></div>`;
    }
    dialog.onclick = async event => {
      if (event.target.closest("[data-cno-public-close]")) { dialog.close(); return; }
      const choice = event.target.closest("[data-cno-select]");
      if (choice && view.state.phase === "open") { view.pendingId = choice.dataset.cnoSelect; view.message = "Review and confirm your choice below."; draw(); return; }
      if (event.target.closest("[data-cno-public-show-all]")) { view.showAll = true; draw(); return; }
      if (event.target.closest("[data-cno-public-confirm]") && view.pendingId !== view.state.selectedCandidateId) {
        view.busy = true; draw();
        try {
          await bridge.saveChristmasNumberOneVote(view.state.year, view.pendingId);
          view.state = await bridge.loadChristmasNumberOnePublicState(view.state.year);
          view.pendingId = view.state.selectedCandidateId || ""; view.message = "Your Christmas Number 1 vote is saved.";
        } catch (error) { view.message = error.message || "Your vote could not be saved."; }
        view.busy = false; draw();
      }
    };
    dialog.oninput = event => {
      if (event.target.matches("[data-cno-public-search]")) { view.query = event.target.value; draw(); dialog.querySelector("[data-cno-public-search]")?.focus(); }
    };
    if (!dialog.open) dialog.showModal();
    dialog.querySelector("[data-cno-public-close]")?.focus({ preventScroll: true });
    return true;
  }

  function installPublicEntry(state) {
    const root = document.querySelector("[data-bom-discover]");
    if (!root || state?.phase === "disabled" || state?.votingApproved !== true) return false;
    let entry = root.querySelector("[data-bom-christmas-number-one-entry]");
    if (!entry) {
      entry = document.createElement("section");
      entry.dataset.bomChristmasNumberOneEntry = "";
      entry.className = "bom-cno-public-entry";
      (root.querySelector(".bom-v1-discover-intro") || root.firstElementChild)?.after(entry);
    }
    const revealed = state.phase === "revealed";
    entry.innerHTML = `<img src="assets/bom-header-logo.png" alt=""><div><p>THE BANK OF MUSIC PRESENTS</p><h2>${revealed ? `${esc(state.year)} CHRISTMAS NUMBER 1` : "VOTE FOR CHRISTMAS NUMBER 1"}</h2><span>${revealed ? "The winner and festive top 10 have been revealed." : "One song. One vote. Closes 20 December at 23:59 UK time."}</span></div><button type="button" data-cno-public-open>${revealed ? "SEE THE WINNER" : "CAST YOUR VOTE"} <span aria-hidden="true">→</span></button>`;
    entry.querySelector("[data-cno-public-open]").onclick = () => void openPublic(state);
    return true;
  }

  function mountAdmin(container, options = {}) {
    if (!container || container.dataset.cnoMounted === "true") return false;
    const bridge = options.bridge || window.BOMPresentationBridge;
    const now = options.now || (() => new Date());
    const state = { year: Number(options.year) || Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric" }).format(now())), scenario: "leader", tab: "vote", query: "", pendingId: "", tieWinnerId: "", tieNote: "", showAll: false, payload: null, busy: false, message: "" };
    container.dataset.cnoMounted = "true";
    container.innerHTML = shell();
    const body = container.querySelector("[data-cno-body]");

    const currentCandidate = id => state.payload?.state?.candidates?.find(candidate => candidate.id === id);

    function render() {
      if (!state.payload) return;
      const preview = state.payload.state, results = state.payload.results, schedule = preview.schedule;
      const cards = candidateCards(preview.candidates || [], preview.selectedCandidateId, state.pendingId, state.query, state.showAll);
      const pending = currentCandidate(state.pendingId), saved = currentCandidate(preview.selectedCandidateId);
      const tieLeaders = results.leaderTie || [];
      body.innerHTML = `<div class="bom-cno-toolbar">
        <label>Preview year<input data-cno-year type="number" min="2025" max="2100" value="${state.year}"></label>
        <label>Result view<select data-cno-scenario><option value="leader"${state.scenario === "leader" ? " selected" : ""}>Simulated clear winner</option><option value="tie"${state.scenario === "tie" ? " selected" : ""}>Simulated first-place tie</option><option value="official"${state.scenario === "official" ? " selected" : ""}>Official results (read-only)</option></select></label>
        <button type="button" data-cno-refresh>Refresh preview</button>
      </div>
      <section class="bom-cno-status-grid">
        <article><span>Official feature</span><strong>Default off</strong><small>No automatic December activation</small></article>
        <article><span>Voting window</span><strong>1–20 Dec</strong><small>Closes 20 Dec at 23:59 UK</small></article>
        <article><span>Christmas Eve</span><strong>24 Dec</strong><small>Reveal still requires admin approval</small></article>
        <article><span>${results.preview === false ? "Official turnout" : "Preview turnout"}</span><strong>${number(results.turnout)}</strong><small>${results.preview === false ? "Live official votes · admin only" : "Simulated members · no official votes"}</small></article>
      </section>
      <div class="bom-cno-countdown" role="timer" data-cno-countdown>${esc(countdownLabel(schedule, now()))}<small>Server window: ${esc(londonDate(schedule.opensAt))} – 20 Dec, 23:59 UK · Reveal ${esc(londonDate(schedule.revealsAt))}</small></div>
      <nav class="bom-cno-tabs" aria-label="Christmas Number 1 preview views">
        ${[["vote", "Voting experience"], ["results", "Admin results"], ["reveal", "Reveal & archive"]].map(([id, label]) => `<button type="button" data-cno-tab="${id}" aria-current="${state.tab === id ? "page" : "false"}">${label}</button>`).join("")}
      </nav>
      <div data-cno-panel>${state.tab === "vote" ? `<section class="bom-cno-vote-panel">
        <header><div><p>YOUR ${state.year} PREVIEW VOTE</p><h3>Choose the song that should be Christmas Number 1</h3><span>You may change your choice until 20 December at 23:59 UK time. Only the latest selection counts.</span></div>${saved ? `<aside><small>Saved preview selection</small><strong>${esc(saved.title)}</strong><span>${esc(saved.artist)}</span></aside>` : ""}</header>
        <label class="bom-cno-search"><span>Search the curated 100</span><input type="search" data-cno-search value="${esc(state.query)}" placeholder="Song or artist" autocomplete="off"></label>
        <div class="bom-cno-choices">${cards.html || `<p class="bom-cno-empty">No festive songs match that search.</p>`}</div>
        ${!state.query && cards.total > 12 && !state.showAll ? `<button class="bom-cno-show-all" type="button" data-cno-show-all>Show all ${cards.total} songs</button>` : ""}
        ${pending ? `<div class="bom-cno-confirm"><div><small>${pending.id === preview.selectedCandidateId ? "CURRENT SELECTION" : "CONFIRM YOUR CHOICE"}</small><strong>${esc(pending.title)}</strong><span>${esc(pending.artist)}</span></div><button type="button" data-cno-confirm${state.busy ? " disabled" : ""}>${state.busy ? "Saving…" : pending.id === preview.selectedCandidateId ? "Selection saved" : "Confirm preview vote"}</button></div>` : ""}
        <p class="bom-cno-message" role="status" aria-live="polite">${esc(state.message)}</p>
      </section>` : state.tab === "results" ? `<section class="bom-cno-results"><header><div><p>ADMIN ONLY · HIDDEN FROM MEMBERS</p><h3>${state.year} ${results.preview === false ? "official" : "preview"} standings</h3><span>${results.preview === false ? "Read-only official vote counts." : "Simulated results for safe private testing."} Lower-rank vote ties use title A–Z ordering and are labelled transparently.</span></div><strong>${number(results.turnout)}<small>turnout</small></strong></header><ol>${rankingRows(results)}</ol>${results.publicationBlocked ? `<div class="bom-cno-tie-alert"><b>First-place tie detected</b><span>A documented resolution is required before a single Number 1 can be approved.</span></div>` : state.scenario === "tie" ? `<div class="bom-cno-tie-alert is-resolved"><b>Preview tie resolved</b><span>The winner announcement preview is now available. Official votes and approvals remain untouched.</span></div>` : ""}${state.scenario === "tie" ? `<div class="bom-cno-tie-resolution"><header><p>PREVIEW-ONLY DECISION</p><h4>Document the tied winner</h4><span>Choose one of the simulated joint leaders and record the reason. This decision is stored only with your admin preview.</span></header><div class="bom-cno-tie-options">${tieLeaders.map(candidate => `<button type="button" data-cno-tie-winner="${esc(candidate.id)}" aria-pressed="${state.tieWinnerId === candidate.id}"><strong>${esc(candidate.title)}</strong><span>${esc(candidate.artist)} · ${number(candidate.votes)} votes</span></button>`).join("")}</div><label><span>Resolution note · at least 20 characters</span><textarea data-cno-tie-note rows="3" placeholder="Document how the tied winner was selected">${esc(state.tieNote)}</textarea></label><button class="bom-cno-resolve-tie" type="button" data-cno-resolve-tie${state.busy || !state.tieWinnerId || state.tieNote.trim().length < 20 ? " disabled" : ""}>${state.busy ? "Recording…" : results.publicationBlocked ? "Record preview resolution" : "Update preview resolution"}</button><p class="bom-cno-message" role="status" aria-live="polite">${esc(state.message)}</p><small>Preview data only · no official vote, annual approval, result snapshot or audit record is changed.</small></div>` : ""}</section>` : `${renderReveal(results, { preview: true })}${renderArchive(results.archive || [])}`}</div>`;
    }

    async function refresh() {
      state.busy = true;
      try {
        state.payload = await bridge.loadChristmasNumberOneAdminPreview(state.year, state.scenario);
        state.pendingId = state.payload.state.selectedCandidateId || "";
        if (state.scenario === "tie" && state.payload.results.tieResolution) {
          state.tieWinnerId = state.payload.results.tieResolution.winnerCandidateId || "";
          state.tieNote = state.payload.results.tieResolution.note || "";
        }
        state.message = "";
        state.busy = false;
        render();
      } catch (error) {
        body.innerHTML = `<div class="bom-cno-error"><strong>Preview unavailable</strong><p>${esc(error.message || "The preview could not be loaded.")}</p><small>No production setting or vote was changed.</small></div>`;
      } finally { state.busy = false; }
    }

    container.addEventListener("click", async event => {
      const tab = event.target.closest("[data-cno-tab]");
      if (tab) { state.tab = tab.dataset.cnoTab; render(); return; }
      const choice = event.target.closest("[data-cno-select]");
      if (choice) { state.pendingId = choice.dataset.cnoSelect; state.message = "Review and confirm this preview selection below."; render(); return; }
      const tieWinner = event.target.closest("[data-cno-tie-winner]");
      if (tieWinner) { state.tieWinnerId = tieWinner.dataset.cnoTieWinner; state.message = "Add a documented reason, then record this preview-only resolution."; render(); return; }
      if (event.target.closest("[data-cno-show-all]")) { state.showAll = true; render(); return; }
      if (event.target.closest("[data-cno-refresh]")) { await refresh(); return; }
      if (event.target.closest("[data-cno-resolve-tie]") && state.tieWinnerId && state.tieNote.trim().length >= 20) {
        state.busy = true; render();
        try {
          await bridge.resolveChristmasNumberOneAdminPreviewTie(state.year, state.tieWinnerId, state.tieNote);
          const message = "Preview tie resolution recorded. Open Reveal & archive to inspect the winner announcement.";
          await refresh(); state.message = message; render();
        } catch (error) { state.message = error.message || "The preview tie resolution could not be saved."; state.busy = false; render(); }
        return;
      }
      if (event.target.closest("[data-cno-confirm]") && state.pendingId && state.pendingId !== state.payload.state.selectedCandidateId) {
        state.busy = true; render();
        try {
          await bridge.saveChristmasNumberOneAdminPreviewVote(state.year, state.pendingId);
          state.message = "Preview selection saved. Official annual votes were not affected.";
          const message = state.message;
          await refresh(); state.message = message; render();
        } catch (error) { state.message = error.message || "The preview selection could not be saved."; state.busy = false; render(); }
      }
    });
    container.addEventListener("input", event => {
      if (event.target.matches("[data-cno-search]")) { state.query = event.target.value; render(); container.querySelector("[data-cno-search]")?.focus(); }
      if (event.target.matches("[data-cno-tie-note]")) { state.tieNote = event.target.value; render(); const note = container.querySelector("[data-cno-tie-note]"); note?.focus(); note?.setSelectionRange(state.tieNote.length, state.tieNote.length); }
    });
    container.addEventListener("change", async event => {
      if (event.target.matches("[data-cno-scenario]")) { state.scenario = event.target.value; await refresh(); }
      if (event.target.matches("[data-cno-year]")) { state.year = Number(event.target.value); await refresh(); }
    });
    const timer = window.setInterval?.(() => {
      const countdown = container.querySelector("[data-cno-countdown]");
      if (countdown && state.payload) countdown.firstChild.textContent = countdownLabel(state.payload.state.schedule, now());
    }, 1000);
    container.addEventListener("DOMNodeRemoved", event => { if (event.target === container) window.clearInterval?.(timer); }, { once: true });
    void refresh();
    return true;
  }

  window.BOMChristmasNumberOneUI = Object.freeze({ countdownParts, countdownLabel, renderReveal, renderArchive, installPublicEntry, openPublic, mountAdmin });
})();
