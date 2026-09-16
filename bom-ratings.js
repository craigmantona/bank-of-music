(function initialiseBOMRatingsPresentation() {
  "use strict";

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
  let currentModel = { authenticated: false, albums: [], tracks: [] };
  let currentType = "albums";
  let currentSort = "rating";
  let currentMinimum = "all";
  let currentQuery = "";
  let visibleLimit = 60;

  function artwork(item, className = "") {
    if (!item.artworkUrl) return `<span class="bom-v1-rating-art bom-v1-rating-art-missing ${className}" role="img" aria-label="Artwork unavailable"><span>bom</span><small>Artwork unavailable</small></span>`;
    return `<span class="bom-v1-rating-art ${className}"><img src="${escapeHtml(item.artworkUrl)}" alt="${escapeHtml(item.albumTitle || item.title)} cover" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="bom-v1-rating-art-missing" role="img" aria-label="Artwork unavailable" hidden><span>bom</span></span></span>`;
  }

  function artistButton(item) {
    return `<button type="button" class="bom-v1-rating-artist" data-bom-ratings-artist="${escapeHtml(item.artist)}">${escapeHtml(item.artist || "Unknown artist")}</button>`;
  }

  function score(label, value, count = 0) {
    const number = Number(value);
    const available = value !== null && value !== "" && Number.isFinite(number);
    const countText = count ? ` from ${Number(count).toLocaleString()} rating${Number(count) === 1 ? "" : "s"}` : "";
    return `<span class="bom-v1-rating-score"${label === "Community" && available ? ` title="${number.toFixed(1)} out of 10${escapeHtml(countText)}"` : ""}><small>${escapeHtml(label)}</small><strong>${available ? number.toFixed(label === "You" ? 0 : 1) : "—"}</strong><span>/ 10</span></span>`;
  }

  function albumCard(item) {
    return `<article class="bom-v1-rating-album" data-bom-ratings-album="${escapeHtml(item.id)}" tabindex="0" role="link" aria-label="Open ${escapeHtml(item.title)}">
      ${artwork(item)}
      <div class="bom-v1-rating-album-copy"><h3>${escapeHtml(item.title)}</h3>${artistButton(item)}<span>${escapeHtml(item.year || "Release year unavailable")}</span></div>
      <div class="bom-v1-rating-scores">${score("You", item.personal)}${score("Community", item.community?.average, item.community?.count)}</div>
    </article>`;
  }

  function trackRow(item) {
    const canOpenAlbum = Boolean(item.albumId);
    return `<article class="bom-v1-rating-track${canOpenAlbum ? " is-linked" : ""}"${canOpenAlbum ? ` data-bom-ratings-album="${escapeHtml(item.albumId)}" tabindex="0" role="link" aria-label="Open ${escapeHtml(item.albumTitle || "album")}"` : ""}>
      ${artwork(item, "is-track")}
      <div class="bom-v1-rating-track-copy"><h3>${escapeHtml(item.title)}</h3>${artistButton(item)}<span>${escapeHtml([item.albumTitle, item.year].filter(Boolean).join(" · ") || "Album unavailable")}</span></div>
      <div class="bom-v1-rating-scores">${score("You", item.personal)}${score("Community", item.community?.average, item.community?.count)}</div>
    </article>`;
  }

  function filteredItems() {
    const source = currentType === "albums" ? currentModel.albums : currentModel.tracks;
    const minimum = currentMinimum === "all" ? 0 : Number(currentMinimum);
    const query = currentQuery.trim().toLocaleLowerCase();
    return source.filter((item) => Number(item.personal || 0) >= minimum && (!query || [item.title, item.artist, item.albumTitle].some((value) => String(value || "").toLocaleLowerCase().includes(query))));
  }

  function sortedItems() {
    return [...filteredItems()].sort((a, b) => {
      if (currentSort === "artist") return String(a.artist).localeCompare(String(b.artist)) || String(a.title).localeCompare(String(b.title));
      if (currentSort === "year") return String(b.year || "0000").localeCompare(String(a.year || "0000")) || String(a.title).localeCompare(String(b.title));
      return Number(b.personal || 0) - Number(a.personal || 0) || Number(b.community?.average || 0) - Number(a.community?.average || 0) || String(a.title).localeCompare(String(b.title));
    });
  }

  function controls() {
    return `<div class="bom-v1-ratings-controls">
      <label><span>Find in your ratings</span><input type="search" data-bom-ratings-query value="${escapeHtml(currentQuery)}" placeholder="Artist, album or track"></label>
      <label><span>Rating</span><select data-bom-ratings-minimum><option value="all"${currentMinimum === "all" ? " selected" : ""}>All ratings</option><option value="10"${currentMinimum === "10" ? " selected" : ""}>10 only</option><option value="9"${currentMinimum === "9" ? " selected" : ""}>9+</option><option value="8"${currentMinimum === "8" ? " selected" : ""}>8+</option></select></label>
      <label><span>Sort by</span><select data-bom-ratings-sort><option value="rating"${currentSort === "rating" ? " selected" : ""}>My rating</option><option value="artist"${currentSort === "artist" ? " selected" : ""}>Artist</option><option value="year"${currentSort === "year" ? " selected" : ""}>Release year</option></select></label>
    </div>`;
  }

  function render(model = currentModel, type = currentType) {
    currentModel = model;
    currentType = type === "tracks" ? "tracks" : "albums";
    if (!model.authenticated) {
      return `<article class="bom-v1-ratings" data-bom-ratings><header class="bom-v1-ratings-intro"><p>YOUR COLLECTION</p><h1>Your life in records.</h1><span>The music you’ve made your own.</span></header>${window.BOMUI.SectionState({ title: "Sign in to see your ratings.", message: "Your rated albums and tracks will appear here." })}</article>`;
    }
    const items = sortedItems();
    const visibleItems = items.slice(0, visibleLimit);
    const count = currentType === "albums" ? model.albums.length : model.tracks.length;
    const content = items.length
      ? `${currentType === "albums" ? `<div class="bom-v1-ratings-grid">${visibleItems.map(albumCard).join("")}</div>` : `<div class="bom-v1-ratings-track-list">${visibleItems.map(trackRow).join("")}</div>`}${items.length > visibleItems.length ? `<div class="bom-v1-ratings-more"><span>Showing ${visibleItems.length} of ${items.length}</span><button type="button" data-bom-ratings-more>Show more</button></div>` : ""}`
      : window.BOMUI.SectionState({ title: count ? "No ratings match these filters." : `No rated ${currentType} yet.`, message: count ? "Try a broader search or rating filter." : `Rate ${currentType === "albums" ? "an album" : "a track"} and it will appear here.` });
    return `<article class="bom-v1-ratings" data-bom-ratings>
      <header class="bom-v1-ratings-intro"><div><p>YOUR COLLECTION</p><h1>Your life in records.</h1><span>The music you’ve made your own.</span></div><div class="bom-v1-ratings-totals"><strong>${model.albums.length + model.tracks.length}</strong><span>ratings</span></div></header>
      <section class="bom-v1-ratings-library"><header><div><p>Rated music</p><h2>${currentType === "albums" ? "Albums" : "Tracks"}</h2></div>${window.BOMUI.SegmentedControl({ label: "Ratings type", selected: currentType, options: [{ value: "albums", text: `Albums ${model.albums.length}` }, { value: "tracks", text: `Tracks ${model.tracks.length}` }] })}</header>${controls()}${content}</section>
    </article>`;
  }

  function renderLoading() {
    return `<article class="bom-v1-ratings" data-bom-ratings aria-busy="true"><header class="bom-v1-ratings-intro"><div><p>YOUR COLLECTION</p><h1>Your life in records.</h1><span>Loading your ratings…</span></div></header><div class="bom-v1-ratings-loading">${Array.from({ length: 6 }, () => '<div><span class="bom-v1-skeleton"></span><span class="bom-v1-skeleton"></span><span class="bom-v1-skeleton"></span></div>').join("")}</div></article>`;
  }

  function renderError() {
    return `<article class="bom-v1-ratings" data-bom-ratings><header class="bom-v1-ratings-intro"><div><p>YOUR COLLECTION</p><h1>Your life in records.</h1></div></header>${window.BOMUI.SectionState({ title: "Your ratings couldn’t load.", message: "Your ratings have not been changed.", actionLabel: "Try again", action: "ratings-retry" })}</article>`;
  }

  function update(root) { root.innerHTML = render(currentModel, currentType); }

  document.addEventListener("click", (event) => {
    const root = event.target.closest("#librarySection");
    if (!root) return;
    const type = event.target.closest("[data-value]")?.dataset.value;
    if (type === "albums" || type === "tracks") { currentType = type; visibleLimit = 60; update(root); return; }
    if (event.target.closest("[data-bom-ratings-more]")) { visibleLimit += 60; update(root); return; }
    const artist = event.target.closest("[data-bom-ratings-artist]");
    if (artist) { event.preventDefault(); event.stopPropagation(); void window.BOMPresentationBridge?.openArtist(artist.dataset.bomRatingsArtist); return; }
    const album = event.target.closest("[data-bom-ratings-album]");
    if (album) { event.preventDefault(); void window.BOMPresentationBridge?.openAlbumById(album.dataset.bomRatingsAlbum); return; }
    if (event.target.closest('[data-bom-action="ratings-retry"]')) void window.BOMPresentationBridge?.refreshRatings();
  });

  document.addEventListener("input", (event) => {
    if (!event.target.matches("[data-bom-ratings-query]")) return;
    currentQuery = event.target.value;
    visibleLimit = 60;
    const position = currentQuery.length;
    update(event.target.closest("#librarySection"));
    const input = document.querySelector("[data-bom-ratings-query]");
    input?.focus(); input?.setSelectionRange(position, position);
  });

  document.addEventListener("change", (event) => {
    const root = event.target.closest("#librarySection");
    if (!root) return;
    if (event.target.matches("[data-bom-ratings-minimum]")) currentMinimum = event.target.value;
    else if (event.target.matches("[data-bom-ratings-sort]")) currentSort = event.target.value;
    else return;
    visibleLimit = 60;
    update(root);
  });

  document.addEventListener("keydown", (event) => {
    const item = event.target.closest("[data-bom-ratings-album]");
    if (!item || !["Enter", " "].includes(event.key)) return;
    event.preventDefault(); item.click();
  });

  window.BOMRatingsUI = Object.freeze({ render, renderLoading, renderError });
  if (new URLSearchParams(window.location.search).get("view") === "ratings") void window.BOMPresentationBridge?.openRequestedRoute();
})();
