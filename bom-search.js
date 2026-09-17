(function initialiseBOMSearchPresentation() {
  "use strict";

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);

  function artwork(item, kind) {
    if (!item.artworkUrl) return `<span class="bom-v1-search-art is-missing" role="img" aria-label="${kind} artwork unavailable"><span>${kind === "Artist" ? "Artist" : "bom"}</span></span>`;
    return `<span class="bom-v1-search-art"><img src="${escapeHtml(item.artworkUrl)}" alt="" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="bom-v1-search-art is-missing" role="img" aria-label="${kind} artwork unavailable" hidden><span>${kind === "Artist" ? "Artist" : "bom"}</span></span></span>`;
  }

  function score(item) {
    const value = Number(item.community?.average);
    if (!Number.isFinite(value)) return "";
    const count = Number(item.community?.count || 0);
    return `<span class="bom-v1-search-score"${count ? ` title="${value.toFixed(1)} out of 10 from ${count.toLocaleString()} community rating${count === 1 ? "" : "s"}"` : ""}><strong>${value.toFixed(1)}</strong><span>/ 10</span></span>`;
  }

  function result(item, group, hidden) {
    const artist = group === "artists";
    const album = group === "albums";
    const secondary = artist
      ? [item.country, item.disambiguation].filter(Boolean).join(" · ")
      : album
        ? [item.artist, item.year].filter(Boolean).join(" · ")
        : [item.artist, item.albumTitle, item.year].filter(Boolean).join(" · ");
    const label = artist ? item.name : item.title;
    return `<article class="bom-v1-search-result ${hidden ? "hidden extra-result" : ""}" data-result-group="${group}">
      <button type="button" class="select-result-btn" data-group="${group}" data-index="${item.index}" aria-label="Open ${escapeHtml(label)}">
        ${artwork(item, artist ? "Artist" : "Album")}
        <span class="bom-v1-search-result-copy"><strong>${escapeHtml(label)}</strong>${secondary ? `<span>${escapeHtml(secondary)}</span>` : ""}</span>
        ${score(item)}<span class="bom-v1-search-arrow" aria-hidden="true">→</span>
      </button>
    </article>`;
  }

  function section(title, group, items, initialCount) {
    if (!items.length) return "";
    const hiddenCount = Math.max(0, items.length - initialCount);
    return `<section class="bom-v1-search-section" aria-labelledby="bom-search-${group}">
      <header><h2 id="bom-search-${group}">${escapeHtml(title)}</h2><span>${items.length} result${items.length === 1 ? "" : "s"}</span></header>
      <div class="bom-v1-search-list">${items.map((item, index) => result(item, group, index >= initialCount)).join("")}</div>
      ${hiddenCount ? `<div class="show-more-row"><button type="button" class="show-more-results-btn" data-group="${group}">Show more ${title.toLowerCase()} (${hiddenCount} more)</button></div>` : ""}
    </section>`;
  }

  function render(model) {
    return `<article class="bom-v1-search-results" data-bom-search>
      <header class="bom-v1-search-intro"><p>SEARCH BOM</p><h1>Results for “${escapeHtml(model.query)}”</h1><span>Artists, albums and tracks from one search.</span></header>
      <div class="search-tabs" aria-label="Filter search results">
        <button type="button" class="search-tab active-search-tab" data-search-filter="all">All</button>
        <button type="button" class="search-tab" data-search-filter="artists">Artists</button>
        <button type="button" class="search-tab" data-search-filter="albums">Albums</button>
        <button type="button" class="search-tab" data-search-filter="songs">Tracks</button>
      </div>
      ${section("Artists", "artists", model.artists, 5)}
      ${section("Albums", "albums", model.albums, 5)}
      ${section("Tracks", "songs", model.songs, 8)}
    </article>`;
  }

  function state(query, title, message, action = "") {
    const actionHtml = action ? `<button type="button" data-bom-search-retry>${escapeHtml(action)}</button>` : "";
    return `<article class="bom-v1-search-results" data-bom-search><header class="bom-v1-search-intro"><p>SEARCH BOM</p><h1>${escapeHtml(query ? `Results for “${query}”` : "Search Bank of Music")}</h1></header><div class="bom-v1-search-state"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p>${actionHtml}</div></article>`;
  }

  function renderLoading(query) {
    return `<article class="bom-v1-search-results" data-bom-search aria-busy="true"><header class="bom-v1-search-intro"><p>SEARCH BOM</p><h1>Searching for “${escapeHtml(query)}”</h1></header><div class="bom-v1-search-loading">${Array.from({ length: 6 }, () => '<div><span class="bom-v1-skeleton"></span><span><i class="bom-v1-skeleton"></i><i class="bom-v1-skeleton"></i></span></div>').join("")}</div></article>`;
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-bom-search-retry]")) return;
    document.getElementById("globalSearchBtn")?.click();
  });

  window.BOMSearchUI = Object.freeze({
    render,
    renderLoading,
    renderEmpty: (query) => state(query, "No results found.", "Try another artist, album or track."),
    renderError: (query) => state(query, "Search couldn’t load.", "Nothing has changed. Please try again.", "Try again")
  });
  if (new URLSearchParams(window.location.search).get("view") === "search") void window.BOMPresentationBridge?.openRequestedRoute();
})();
