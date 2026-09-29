(function initialiseBOMAdminCatalogue(global) {
  "use strict";

  let host = null;

  const state = {
    artistQuery: "",
    artistCandidates: [],
    artist: null,
    rows: [{ client_id: crypto.randomUUID(), title: "", uk_release_date: "", release_group_id: "", release_id: "", selected: false }],
    previews: [],
    results: [],
    busy: false,
    message: ""
  };

  function escape(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function normalise(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function rowById(id) {
    return state.rows.find(row => row.client_id === id);
  }

  function previewById(id) {
    return state.previews.find(preview => preview.client_id === id);
  }

  function resultById(id) {
    return state.results.find(result => result.client_id === id);
  }

  function statusLabel(status) {
    return ({ ready: "Ready", added: "Added", already_exists: "Already exists",
      needs_correction: "Needs correction", failed: "Failed" })[status] || status || "Not checked";
  }

  function reasonLabel(reason) {
    return String(reason || "").replaceAll("_", " ");
  }

  function existingAlbums() {
    return state.artist ? host.getExistingAlbums(state.artist.name) : [];
  }

  function artistMarkup() {
    if (state.artist) {
      const albums = existingAlbums();
      return `<div class="admin-catalogue-confirmed">
        <div><span>Confirmed artist</span><strong>${escape(state.artist.name)}</strong>
          <small>${escape([state.artist.type, state.artist.country, state.artist.disambiguation].filter(Boolean).join(" · ") || "MusicBrainz identity confirmed")}</small></div>
        <button type="button" class="secondary-btn" data-catalogue-change-artist>Change artist</button>
      </div>
      <div class="admin-catalogue-existing">
        <h4>Already in BOM (${albums.length})</h4>
        ${albums.length ? `<div>${albums.map(album => `<span>${escape(album.title)}${album.original_release_date || album.release_date ? ` <small>${escape(String(album.original_release_date || album.release_date))}</small>` : ""}<button type="button" class="secondary-btn" data-catalogue-edit-date="${escape(album.id)}" ${state.busy ? "disabled" : ""}>Edit release date</button><button type="button" class="danger-btn" data-catalogue-delete-album="${escape(album.id)}" ${state.busy ? "disabled" : ""}>Delete album</button></span>`).join("")}</div>` : "<p class=\"small\">No albums for this artist are currently in BOM.</p>"}
      </div>`;
    }
    return `<div class="admin-catalogue-artist-search">
      <label for="adminCatalogueArtist">Artist</label>
      <div><input id="adminCatalogueArtist" value="${escape(state.artistQuery)}" placeholder="e.g. The Smiths" autocomplete="off">
        <button type="button" data-catalogue-search-artist ${state.busy ? "disabled" : ""}>Search MusicBrainz</button></div>
      ${state.artistCandidates.length ? `<div class="admin-catalogue-candidates" role="list">
        ${state.artistCandidates.map((artist, index) => `<button type="button" data-catalogue-choose-artist="${index}" role="listitem">
          <strong>${escape(artist.name)}</strong><span>${escape([artist.type, artist.country, artist.disambiguation].filter(Boolean).join(" · ") || "No disambiguation")}</span>
          <small>${artist.exact_name ? "Exact name" : "Similar name"} · MusicBrainz score ${escape(artist.score)}</small>
        </button>`).join("")}
      </div>` : ""}
    </div>`;
  }

  function correctionControls(row, preview) {
    if (!preview || preview.status !== "needs_correction") return "";
    const groups = preview.release_group_candidates || [];
    const releases = preview.release_candidates || [];
    return `<div class="admin-catalogue-correction">
      <strong>Administrator choice required</strong>
      ${groups.length ? `<label>Release group<select data-catalogue-group-choice="${escape(row.client_id)}"><option value="">Choose…</option>${groups.map(group => `<option value="${escape(group.release_group_id)}" ${row.release_group_id === group.release_group_id ? "selected" : ""}>${escape(group.title)} · ${escape(group.first_release_date || "date unknown")}</option>`).join("")}</select></label>` : ""}
      ${releases.length ? `<label>Official edition<select data-catalogue-release-choice="${escape(row.client_id)}"><option value="">Choose…</option>${releases.map(release => `<option value="${escape(release.release_id)}" ${row.release_id === release.release_id ? "selected" : ""}>${escape(release.country || "??")} · ${escape(release.date || "date unknown")} · ${escape(release.title)}</option>`).join("")}</select></label>` : ""}
      <small>Choose the correct identity, then preview again. BOM will not guess.</small>
    </div>`;
  }

  function previewMarkup(row) {
    const preview = previewById(row.client_id);
    const result = resultById(row.client_id);
    const current = result || preview;
    if (!current) return "";
    const warnings = preview?.warnings || [];
    return `<div class="admin-catalogue-preview is-${escape(current.status)}">
      <div class="admin-catalogue-preview-heading">
        ${preview?.album?.cover_art_url ? `<img src="${escape(preview.album.cover_art_url)}" alt="" loading="lazy">` : `<span class="admin-catalogue-no-art">bom</span>`}
        <div><span class="admin-catalogue-status">${escape(statusLabel(current.status))}</span>
          <strong>${escape(preview?.album?.title || current.requested_title || row.title)}</strong>
          ${preview?.selected_release ? `<small>${escape(preview.selected_release.country || "Country unknown")} · ${escape(preview.selected_release.date || "Date unknown")} · ${escape(preview.selection_strategy || "administrator selected")}</small>` : ""}
        </div>
      </div>
      ${current.reason ? `<p class="admin-catalogue-warning">${escape(reasonLabel(current.reason))}</p>` : ""}
      ${warnings.map(warning => `<p class="admin-catalogue-warning">${escape(reasonLabel(warning))}</p>`).join("")}
      ${preview?.tracks?.length ? `<details><summary>${preview.tracks.length} tracks</summary><ol>${preview.tracks.map(track => `<li>${escape(track.title)}${normalise(track.artist) !== normalise(state.artist?.name) ? ` — ${escape(track.artist)}` : ""}</li>`).join("")}</ol></details>` : ""}
      ${correctionControls(row, preview)}
    </div>`;
  }

  function albumsMarkup() {
    if (!state.artist) return "";
    return `<div class="admin-catalogue-albums">
      <div class="admin-catalogue-albums-heading"><div><h4>Albums to consider</h4><p class="small">Enter only the albums you have editorially decided belong in BOM.</p></div>
        <button type="button" class="secondary-btn" data-catalogue-add-row ${state.rows.length >= 10 ? "disabled" : ""}>Add album row</button></div>
      <div class="admin-catalogue-rows">
        ${state.rows.map((row, index) => {
          const preview = previewById(row.client_id);
          return `<article class="admin-catalogue-row" data-catalogue-row="${escape(row.client_id)}">
            <div class="admin-catalogue-row-number">${index + 1}</div>
            <label>Album title<input data-catalogue-field="title" value="${escape(row.title)}" placeholder="Album title"></label>
            <label>UK release year/date <small>optional</small><input data-catalogue-field="uk_release_date" value="${escape(row.uk_release_date)}" placeholder="1984 or 1984-02-20"></label>
            <button type="button" class="danger-btn admin-catalogue-remove" data-catalogue-remove-row ${state.rows.length === 1 ? "disabled" : ""}>Remove</button>
            ${preview?.status === "ready" ? `<label class="admin-catalogue-select"><input type="checkbox" data-catalogue-select ${row.selected ? "checked" : ""}> Add this album</label>` : ""}
            ${previewMarkup(row)}
          </article>`;
        }).join("")}
      </div>
      <div class="admin-catalogue-actions">
        <button type="button" data-catalogue-preview ${state.busy ? "disabled" : ""}>Look up &amp; preview</button>
        <button type="button" data-catalogue-commit ${state.busy || !state.rows.some(row => row.selected && previewById(row.client_id)?.status === "ready") ? "disabled" : ""}>Add selected albums</button>
      </div>
    </div>`;
  }

  function render() {
    const adminDashboard = host?.getRoot();
    if (!adminDashboard || !host.canRender()) return;
    adminDashboard.querySelectorAll(".admin-create-panel").forEach(panel => panel.remove());
    let panel = adminDashboard.querySelector("[data-admin-catalogue]");
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "admin-panel admin-catalogue";
      panel.dataset.adminCatalogue = "true";
      const summary = adminDashboard.querySelector(".admin-summary-grid");
      if (summary) summary.insertAdjacentElement("afterend", panel);
      else adminDashboard.prepend(panel);
    }
    panel.innerHTML = `<header class="admin-catalogue-header"><div><span>Catalogue</span><h3>Add Artist &amp; Albums</h3>
      <p>Confirm one artist, preview up to 10 explicitly requested albums, then add only your selected matches.</p></div></header>
      ${state.message ? `<p class="admin-catalogue-message" role="status">${escape(state.message)}</p>` : ""}
      ${artistMarkup()}${albumsMarkup()}`;
  }

  async function invoke(body) {
    const { data, error } = await host.invoke(body);
    if (error) throw new Error(error.message || "Admin Catalogue request failed.");
    if (!data?.ok) throw new Error(data?.error || "Admin Catalogue request failed.");
    return data;
  }

  async function searchArtist() {
    const input = document.getElementById("adminCatalogueArtist");
    state.artistQuery = String(input?.value || "").trim();
    if (!state.artistQuery) { state.message = "Enter an artist name."; render(); return; }
    state.busy = true; state.message = "Searching MusicBrainz…"; render();
    try {
      const data = await invoke({ action: "search_artist", artist_name: state.artistQuery });
      state.artistCandidates = data.candidates || [];
      state.message = state.artistCandidates.length ? "Choose the correct artist identity." : "No artist matches found.";
    } catch (error) { state.message = error.message; }
    finally { state.busy = false; render(); }
  }

  async function previewAlbums() {
    const albums = state.rows.filter(row => row.title.trim()).map(({ selected, ...row }) => row);
    if (!albums.length) { state.message = "Enter at least one album title."; render(); return; }
    state.busy = true; state.message = "Resolving only the albums you requested…"; state.results = []; render();
    try {
      const data = await invoke({ action: "preview", artist: state.artist, albums });
      state.previews = data.previews || [];
      state.rows.forEach(row => { row.selected = previewById(row.client_id)?.status === "ready"; });
      const ready = state.previews.filter(item => item.status === "ready").length;
      const correction = state.previews.filter(item => item.status === "needs_correction").length;
      state.message = `${ready} ready to add${correction ? ` · ${correction} need your correction` : ""}. Nothing has been written.`;
    } catch (error) { state.message = error.message; }
    finally { state.busy = false; render(); }
  }

  async function commitAlbums() {
    const selected = state.rows.filter(row => row.selected && previewById(row.client_id)?.status === "ready")
      .map(({ selected: _selected, ...row }) => row);
    if (!selected.length) { state.message = "Select at least one ready album."; render(); return; }
    state.busy = true; state.message = "Adding selected albums…"; render();
    try {
      const data = await invoke({ action: "commit", artist: state.artist, albums: selected });
      state.results = data.results || [];
      state.message = state.results.map(result => `${result.requested_title}: ${statusLabel(result.status)}`).join(" · ");
      await host.refreshAfterCommit();
    } catch (error) { state.message = error.message; }
    finally { state.busy = false; render(); }
  }

  async function deleteAlbum(albumId) {
    state.busy = true; state.message = "Checking album dependencies…"; render();
    try {
      const preview = (await invoke({ action: "delete_album_preview", album_id: albumId })).deletion;
      const action = preview.deletion_mode === "delete"
        ? "This will permanently delete this album and its album-specific tracks."
        : "User data exists, so this album and its tracks will be hidden rather than permanently deleted.";
      const confirmed = global.confirm(`${preview.artist} — ${preview.title}\n\nTracks: ${preview.track_count}\nAlbum ratings: ${preview.album_rating_count}\nAlbum reviews: ${preview.album_review_count}\nTrack ratings: ${preview.track_rating_count}\n\n${action}\n\nContinue?`);
      if (!confirmed) { state.message = "Album deletion cancelled."; return; }
      const result = (await invoke({ action: "delete_album", album_id: albumId })).deletion;
      state.message = result.status === "deleted"
        ? `${result.artist} — ${result.title} was permanently deleted.`
        : `${result.artist} — ${result.title} was hidden because user data is attached.`;
      await host.refreshAfterCommit();
    } catch (error) { state.message = error.message; }
    finally { state.busy = false; render(); }
  }

  async function editAlbumDate(albumId) {
    const album = existingAlbums().find(item => Number(item.id) === Number(albumId));
    if (!album) { state.message = "Choose an existing BOM album."; render(); return; }
    const currentDate = String(album.original_release_date || album.release_date || "");
    const nextDate = global.prompt(`Edit original release date\n\n${album.artist} — ${album.title}\nCurrent: ${currentDate || "Unknown"}\n\nEnter a full date (YYYY-MM-DD):`, currentDate);
    if (nextDate === null) { state.message = "Release date edit cancelled."; render(); return; }
    const value = String(nextDate).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) { state.message = "Enter a valid full release date in YYYY-MM-DD format."; render(); return; }
    if (!global.confirm(`${album.artist} — ${album.title}\n\nChange original release date from ${currentDate || "Unknown"} to ${value}?\n\nSelected-edition provenance will not be changed.`)) {
      state.message = "Release date edit cancelled."; render(); return;
    }
    state.busy = true; state.message = "Updating original release date…"; render();
    try {
      await invoke({ action: "edit_album_date", album_id: Number(album.id), original_release_date: value });
      state.message = `${album.artist} — ${album.title} now uses ${value} for chronology.`;
      await host.refreshAfterCommit();
    } catch (error) { state.message = error.message; }
    finally { state.busy = false; render(); }
  }

  function resetArtist() {
    state.artist = null; state.artistCandidates = []; state.previews = []; state.results = [];
    state.rows.forEach(row => { row.selected = false; row.release_group_id = ""; row.release_id = ""; });
    state.message = "Search and explicitly confirm the artist."; render();
  }

  function attach(hostApi) {
    if (host || !hostApi) return;
    host = hostApi;
    const adminDashboard = host.getRoot();
    if (!adminDashboard) return;

    adminDashboard.addEventListener("input", event => {
    const field = event.target.closest("[data-catalogue-field]");
    if (!field) return;
    const row = rowById(field.closest("[data-catalogue-row]")?.dataset.catalogueRow);
    if (!row) return;
    row[field.dataset.catalogueField] = field.value;
    row.selected = false;
    state.previews = state.previews.filter(item => item.client_id !== row.client_id);
    state.results = state.results.filter(item => item.client_id !== row.client_id);
    });

    adminDashboard.addEventListener("change", event => {
    const select = event.target.closest("[data-catalogue-select]");
    if (select) {
      const row = rowById(select.closest("[data-catalogue-row]")?.dataset.catalogueRow);
      if (row) row.selected = select.checked;
      render(); return;
    }
    const group = event.target.closest("[data-catalogue-group-choice]");
    if (group) {
      const row = rowById(group.dataset.catalogueGroupChoice);
      if (row) { row.release_group_id = group.value; row.release_id = ""; row.selected = false; }
      return;
    }
    const release = event.target.closest("[data-catalogue-release-choice]");
    if (release) {
      const row = rowById(release.dataset.catalogueReleaseChoice);
      if (row) { row.release_id = release.value; row.selected = false; }
    }
    });

    adminDashboard.addEventListener("click", async event => {
    const editDateButton = event.target.closest("[data-catalogue-edit-date]");
    if (editDateButton) { await editAlbumDate(Number(editDateButton.dataset.catalogueEditDate)); return; }
    const deleteButton = event.target.closest("[data-catalogue-delete-album]");
    if (deleteButton) { await deleteAlbum(Number(deleteButton.dataset.catalogueDeleteAlbum)); return; }
    if (event.target.closest("[data-catalogue-search-artist]")) { await searchArtist(); return; }
    const choice = event.target.closest("[data-catalogue-choose-artist]");
    if (choice) {
      state.artist = state.artistCandidates[Number(choice.dataset.catalogueChooseArtist)] || null;
      state.message = state.artist ? "Artist confirmed. Add the albums you want BOM to contain." : "Choose an artist.";
      state.previews = []; state.results = []; render(); return;
    }
    if (event.target.closest("[data-catalogue-change-artist]")) { resetArtist(); return; }
    if (event.target.closest("[data-catalogue-add-row]")) {
      if (state.rows.length < 10) state.rows.push({ client_id: crypto.randomUUID(), title: "", uk_release_date: "", release_group_id: "", release_id: "", selected: false });
      render(); return;
    }
    const remove = event.target.closest("[data-catalogue-remove-row]");
    if (remove) {
      const id = remove.closest("[data-catalogue-row]")?.dataset.catalogueRow;
      if (state.rows.length > 1) state.rows = state.rows.filter(row => row.client_id !== id);
      state.previews = state.previews.filter(item => item.client_id !== id);
      state.results = state.results.filter(item => item.client_id !== id);
      render(); return;
    }
    if (event.target.closest("[data-catalogue-preview]")) { await previewAlbums(); return; }
    if (event.target.closest("[data-catalogue-commit]")) { await commitAlbums(); }
    });

    host.installRenderExtension(render);
    render();
    global.BOMAdminCatalogue = Object.freeze({ render, state });
  }

  document.addEventListener("click", event => {
    if (!event.target.closest("[data-open-admin-catalogue]")) return;
    event.preventDefault();
    host?.openAdmin();
    render();
    document.querySelector("[data-admin-catalogue]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.addEventListener("bom:admin-catalogue-host-ready", () => attach(global.BOMAdminCatalogueHost));
  attach(global.BOMAdminCatalogueHost);
})(window);
