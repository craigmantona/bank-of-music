(function initialiseBOMArtistPresentation() {
  "use strict";

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);

  let currentModel = null;
  let discographySort = "release";
  let trackLimit = 10;

  function releaseLabel(value, precision) {
    if (window.BOMAlbumUI?.formatReleaseDate) return window.BOMAlbumUI.formatReleaseDate(value, precision);
    return String(value || "").slice(0, 4);
  }

  function artwork(album, className = "") {
    if (!album?.artworkUrl) {
      return `<span class="bom-v1-artist-artwork-missing ${className}" role="img" aria-label="Artwork unavailable"><span aria-hidden="true">bom</span></span>`;
    }
    return `<img class="${className}" src="${escapeHtml(album.artworkUrl)}" alt="${escapeHtml(album.title)} cover" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="bom-v1-artist-artwork-missing ${className}" role="img" aria-label="Artwork unavailable" hidden><span aria-hidden="true">bom</span></span>`;
  }

  function sortedAlbums() {
    const albums = [...(currentModel?.albums || [])];
    if (discographySort === "community") {
      return albums.sort((a, b) => (b.community?.average ?? -1) - (a.community?.average ?? -1) || (b.community?.count ?? 0) - (a.community?.count ?? 0) || String(a.releaseDate || "9999").localeCompare(String(b.releaseDate || "9999")) || a.title.localeCompare(b.title));
    }
    if (discographySort === "personal") {
      return albums.sort((a, b) => (b.personal ?? -1) - (a.personal ?? -1) || (b.community?.average ?? -1) - (a.community?.average ?? -1) || String(a.releaseDate || "9999").localeCompare(String(b.releaseDate || "9999")) || a.title.localeCompare(b.title));
    }
    return albums.sort((a, b) => String(a.releaseDate || "9999-99-99").localeCompare(String(b.releaseDate || "9999-99-99")) || a.title.localeCompare(b.title));
  }

  function albumCard(album) {
    const attributes = album.albumId
      ? `data-library-type="album" data-album-id="${escapeHtml(album.albumId)}"`
      : `data-artist-album-index="${album.sourceIndex}"`;
    const community = album.community ? `${album.community.average.toFixed(1)} <small>/ 10 community</small>` : "Not rated";
    const personal = album.personal !== null ? `<span class="bom-v1-artist-album-personal">You ${album.personal} / 10</span>` : "";
    return `<article class="bom-v1-artist-album-card" ${attributes} tabindex="0" role="link" aria-label="Open ${escapeHtml(album.title)}">
      <div class="bom-v1-artist-album-art">${artwork(album)}</div>
      <h3>${escapeHtml(album.title)}</h3>
      <p>${escapeHtml(releaseLabel(album.releaseDate, album.releaseDatePrecision) || "Release date unavailable")}</p>
      <div class="bom-v1-artist-album-ratings"><span>${community}</span>${personal}</div>
    </article>`;
  }

  function renderDiscography() {
    const target = document.getElementById("bomV1ArtistDiscography");
    if (!target) return;
    const albums = sortedAlbums();
    target.innerHTML = albums.length
      ? albums.map(albumCard).join("")
      : window.BOMUI.SectionState({ title: "No albums available", message: "This artist’s catalogue has not reached the collection yet." });
  }

  function trackRow(track) {
    const albumLink = track.albumId ? `data-library-type="album" data-album-id="${escapeHtml(track.albumId)}"` : "";
    return `<div class="bom-v1-artist-track-row">
      <span class="bom-v1-artist-track-rank">${String(track.rank).padStart(2, "0")}</span>
      <button type="button" class="bom-v1-artist-track-art" ${albumLink} aria-label="Open ${escapeHtml(track.albumTitle || "album")}">${artwork({ title: track.albumTitle || track.title, artworkUrl: track.artworkUrl })}</button>
      <div class="bom-v1-artist-track-copy"><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(track.albumTitle || "Album unavailable")}${track.albumYear ? ` · ${escapeHtml(track.albumYear)}` : ""}</span></div>
      <span class="bom-v1-artist-track-score" title="${track.community.count} community rating${track.community.count === 1 ? "" : "s"}" aria-label="${track.community.average.toFixed(1)} out of 10 from ${track.community.count} community rating${track.community.count === 1 ? "" : "s"}">${track.community.average.toFixed(1)} <small>/ 10</small></span>
    </div>`;
  }

  function renderTracks() {
    const target = document.getElementById("bomV1ArtistTracks");
    const action = document.getElementById("bomV1ArtistTrackLimit");
    if (!target || !currentModel) return;
    const tracks = currentModel.topTracks.slice(0, trackLimit);
    target.innerHTML = tracks.length
      ? tracks.map(trackRow).join("")
      : window.BOMUI.SectionState({ title: "No rated tracks yet", message: "Community track ratings will appear here as listeners rate this artist’s music." });
    if (action) {
      const canExpand = currentModel.topTracks.length > 10;
      action.hidden = !canExpand;
      action.textContent = trackLimit === 10 ? "View Top 50 →" : "Show Top 10 ↑";
    }
  }

  function heroImage(model) {
    if (model.imageUrl) return `<img class="bom-v1-artist-photo" src="${escapeHtml(model.imageUrl)}" alt="${escapeHtml(model.name)}" fetchpriority="high" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><div class="bom-v1-artist-photo bom-v1-artist-photo-missing" role="img" aria-label="Artist image unavailable" hidden><span>${escapeHtml(model.name.slice(0, 1).toUpperCase())}</span><small>Artist image unavailable</small></div>`;
    return `<div class="bom-v1-artist-photo bom-v1-artist-photo-missing" role="img" aria-label="Artist image unavailable"><span>${escapeHtml(model.name.slice(0, 1).toUpperCase())}</span><small>Artist image unavailable</small></div>`;
  }

  function render(model) {
    currentModel = model;
    discographySort = "release";
    trackLimit = 10;
    const metadata = model.metadata.filter(Boolean).join(" · ");
    return `<article class="bom-v1-artist" data-bom-artist="${escapeHtml(model.name)}">
      <nav class="bom-v1-artist-breadcrumb" aria-label="Breadcrumb">${model.backControlHtml || ""}<span aria-hidden="true">/</span><span>Artist</span></nav>
      <section class="bom-v1-artist-hero">
        <div class="bom-v1-artist-identity"><span class="bom-v1-artist-eyebrow">The artist</span><h1>${escapeHtml(model.name)}</h1>${metadata ? `<p>${escapeHtml(metadata)}</p>` : ""}<div class="bom-v1-artist-follow-wrap">${model.followControlHtml || ""}</div></div>
        <div class="bom-v1-artist-photo-wrap">${heroImage(model)}</div>
      </section>
      <section class="bom-v1-artist-section" aria-labelledby="bomV1DiscographyHeading">
        <header class="bom-v1-artist-section-heading"><div><h2 id="bomV1DiscographyHeading">The records</h2><p>A selection from the discography.</p></div><label>Sort<select id="bomV1ArtistSort"><option value="release">Release date</option><option value="community">Highest community rated</option><option value="personal">Highest personally rated</option></select></label></header>
        <div id="bomV1ArtistDiscography" class="bom-v1-artist-discography"></div>
      </section>
      <section class="bom-v1-artist-section" aria-labelledby="bomV1TopTracksHeading">
        <header class="bom-v1-artist-section-heading"><div><h2 id="bomV1TopTracksHeading">Highest-rated tracks</h2><p>Ranked by community rating.</p></div><span>Community</span></header>
        <div id="bomV1ArtistTracks" class="bom-v1-artist-tracks"></div>
        <button type="button" id="bomV1ArtistTrackLimit" class="bom-v1-artist-more">View Top 50 →</button>
      </section>
    </article>`;
  }

  function renderLoading(name, backControlHtml = "") {
    return `<article class="bom-v1-artist bom-v1-artist-loading" aria-busy="true">
      <nav class="bom-v1-artist-breadcrumb" aria-label="Breadcrumb">${backControlHtml}<span aria-hidden="true">/</span><span>Artist</span></nav>
      <section class="bom-v1-artist-hero"><div class="bom-v1-artist-identity"><span class="bom-v1-artist-eyebrow">The artist</span><h1>${escapeHtml(name)}</h1>${window.BOMUI.Skeleton({ label: "Loading artist details", lines: 2 })}</div><div class="bom-v1-artist-photo-wrap">${window.BOMUI.Skeleton({ label: "Loading artist image", lines: 1 })}</div></section>
      <section class="bom-v1-artist-section"><header class="bom-v1-artist-section-heading"><div><h2>The records</h2><p>A selection from the discography.</p></div></header>${window.BOMUI.Skeleton({ label: "Loading discography", lines: 4 })}</section>
    </article>`;
  }

  document.addEventListener("change", (event) => {
    if (event.target.id !== "bomV1ArtistSort") return;
    discographySort = event.target.value;
    renderDiscography();
  });

  document.addEventListener("click", async (event) => {
    if (event.target.closest("#bomV1ArtistTrackLimit")) {
      trackLimit = trackLimit === 10 ? 50 : 10;
      renderTracks();
      return;
    }
    const follow = event.target.closest("[data-bom-artist-follow]");
    if (follow && window.BOMArtistBridge) {
      follow.disabled = true;
      await window.BOMArtistBridge.setFollowing(follow.dataset.bomArtistFollow === "true");
    }
  });

  document.addEventListener("click", (event) => {
    const albumLink = event.target.closest(".bom-v1-artist [data-library-type='album'], .bom-v1-artist [data-artist-album-index]");
    if (!albumLink) return;
    window.history.pushState({ bomShare: true, itemType: "artist" }, "", window.location.href);
  }, true);

  document.addEventListener("keydown", (event) => {
    const card = event.target.closest(".bom-v1-artist-album-card");
    if (!card || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    card.click();
  });

  window.BOMArtistUI = Object.freeze({ render, renderLoading, renderDiscography, renderTracks });
})();
