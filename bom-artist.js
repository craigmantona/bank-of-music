(function initialiseBOMArtistPresentation() {
  "use strict";

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);

  let currentModel = null;
  let discographySort = "release";
  let trackLimit = 10;
  let selectedHeroFile = null;
  let selectedHeroPreviewUrl = "";

  const approvedArtistImageHosts = new Set([
    "lastfm-img2.akamaized.net",
    "lastfm.freetls.fastly.net",
    "e-cdns-images.dzcdn.net",
    "cdn-images.dzcdn.net",
    "upload.wikimedia.org",
    "thumb.wikimedia.org"
  ]);

  function isApprovedArtistImageUrl(value) {
    if (!value) return false;
    try {
      const imageUrl = new URL(value, window.location?.href || "http://localhost/");
      if (imageUrl.protocol !== "https:" || !approvedArtistImageHosts.has(imageUrl.hostname.toLowerCase())) return false;
      return !/(coverartarchive|release-group|\/releases?\/|\/albums?\/|composite|\bISS[-_]|desert|satellite|scenery|landscape)/i.test(`${imageUrl.hostname}${imageUrl.pathname}`);
    } catch (_error) {
      return false;
    }
  }

  function isApprovedManualHeroUrl(value) {
    if (!value || !window.SUPABASE_URL) return false;
    try {
      const imageUrl = new URL(value);
      const projectUrl = new URL(window.SUPABASE_URL);
      return imageUrl.protocol === "https:" && imageUrl.hostname === projectUrl.hostname && imageUrl.pathname.includes("/storage/v1/object/public/artist-hero-images/");
    } catch (_error) {
      return false;
    }
  }

  function artistImageSource(value) {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostname.includes("lastfm")) return "Last.fm";
    if (hostname.includes("dzcdn")) return "Deezer";
    if (hostname.includes("wikimedia")) return "Wikipedia";
    return "Artist image";
  }

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
    if (isApprovedArtistImageUrl(model.imageUrl) || (model.imageMeta?.isManual && isApprovedManualHeroUrl(model.imageUrl))) {
      const source = model.imageMeta?.provider || artistImageSource(model.imageUrl);
      const fitClass = model.imageMeta?.heroFit === "cover" ? " is-cover" : "";
      return `<img class="bom-v1-artist-photo${fitClass}" src="${escapeHtml(model.imageUrl)}" alt="${escapeHtml(model.name)}" data-bom-artist-image-source="${escapeHtml(source)}" data-bom-artist-identity-source="${escapeHtml(model.imageMeta?.identitySource || "")}" data-bom-artist-identity-url="${escapeHtml(model.imageMeta?.identityUrl || "")}" data-bom-artist-image-width="${escapeHtml(model.imageMeta?.width || "")}" data-bom-artist-image-height="${escapeHtml(model.imageMeta?.height || "")}" data-bom-artist-image-identity="${escapeHtml(model.imageMeta?.imageIdentity || "")}" data-bom-artist-image-fit="${escapeHtml(model.imageMeta?.heroFit || "contain")}" fetchpriority="high" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><div class="bom-v1-artist-photo bom-v1-artist-photo-missing" role="img" aria-label="Artist image unavailable" hidden><span>${escapeHtml(model.name.slice(0, 1).toUpperCase())}</span><small>Artist image unavailable</small></div>`;
    }
    return `<div class="bom-v1-artist-photo bom-v1-artist-photo-missing" role="img" aria-label="Artist image unavailable" data-bom-artist-image-source="${escapeHtml(model.imageMeta?.provider || "BOM placeholder")}" data-bom-artist-identity-source="${escapeHtml(model.imageMeta?.identitySource || "No validated artist photograph")}"><span>${escapeHtml(model.name.slice(0, 1).toUpperCase())}</span><small>Artist image unavailable</small></div>`;
  }

  function heroAdminControls(model) {
    if (!model.heroAdmin?.enabled) return "";
    const action = model.heroAdmin.hasManual ? "Change hero" : "Add hero";
    return `<div class="bom-v1-artist-hero-admin" data-bom-artist-hero-admin>
      <div class="bom-v1-artist-hero-admin-actions"><button type="button" data-bom-artist-hero-pick>${action}</button>${model.heroAdmin.hasManual ? '<button type="button" data-bom-artist-hero-remove>Remove hero</button>' : ""}</div>
      <input type="file" data-bom-artist-hero-input accept="image/jpeg,image/png,image/webp" hidden>
      <div class="bom-v1-artist-hero-editor" data-bom-artist-hero-editor hidden>
        <img data-bom-artist-hero-preview alt="New artist hero preview">
        <div><p data-bom-artist-hero-file></p><span data-bom-artist-hero-message role="status"></span><div><button type="button" data-bom-artist-hero-save>Save hero</button><button type="button" data-bom-artist-hero-cancel>Cancel</button></div></div>
      </div>
    </div>`;
  }

  function render(model) {
    currentModel = model;
    if (selectedHeroPreviewUrl) URL.revokeObjectURL(selectedHeroPreviewUrl);
    selectedHeroFile = null;
    selectedHeroPreviewUrl = "";
    discographySort = "release";
    trackLimit = 10;
    const metadata = model.metadata.filter(Boolean).join(" · ");
    return `<article class="bom-v1-artist" data-bom-artist="${escapeHtml(model.name)}">
      <nav class="bom-v1-artist-breadcrumb" aria-label="Breadcrumb">${model.backControlHtml || ""}<span aria-hidden="true">/</span><span>Artist</span></nav>
      <section class="bom-v1-artist-hero">
        <div class="bom-v1-artist-identity"><span class="bom-v1-artist-eyebrow">The artist</span><h1>${escapeHtml(model.name)}</h1>${metadata ? `<p>${escapeHtml(metadata)}</p>` : ""}<div class="bom-v1-artist-follow-wrap">${model.followControlHtml || ""}</div>${heroAdminControls(model)}</div>
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
    if (event.target.id === "bomV1ArtistSort") {
      discographySort = event.target.value;
      renderDiscography();
      return;
    }
    if (!event.target.matches("[data-bom-artist-hero-input]")) return;
    const file = event.target.files?.[0] || null;
    const editor = event.target.closest("[data-bom-artist-hero-admin]")?.querySelector("[data-bom-artist-hero-editor]");
    const message = editor?.querySelector("[data-bom-artist-hero-message]");
    if (!file || !editor) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      if (message) message.textContent = "Choose a JPEG, PNG or WebP image no larger than 5 MB.";
      editor.hidden = false;
      return;
    }
    if (selectedHeroPreviewUrl) URL.revokeObjectURL(selectedHeroPreviewUrl);
    selectedHeroFile = file;
    selectedHeroPreviewUrl = URL.createObjectURL(file);
    editor.querySelector("[data-bom-artist-hero-preview]").src = selectedHeroPreviewUrl;
    editor.querySelector("[data-bom-artist-hero-file]").textContent = `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    if (message) message.textContent = "Preview ready. The current hero is unchanged until you save.";
    editor.hidden = false;
  });

  document.addEventListener("click", async (event) => {
    const adminRoot = event.target.closest("[data-bom-artist-hero-admin]");
    if (adminRoot && event.target.closest("[data-bom-artist-hero-pick]")) {
      adminRoot.querySelector("[data-bom-artist-hero-input]")?.click();
      return;
    }
    if (adminRoot && event.target.closest("[data-bom-artist-hero-cancel]")) {
      if (selectedHeroPreviewUrl) URL.revokeObjectURL(selectedHeroPreviewUrl);
      selectedHeroFile = null;
      selectedHeroPreviewUrl = "";
      adminRoot.querySelector("[data-bom-artist-hero-editor]").hidden = true;
      adminRoot.querySelector("[data-bom-artist-hero-input]").value = "";
      return;
    }
    if (adminRoot && event.target.closest("[data-bom-artist-hero-save]")) {
      const saveButton = event.target.closest("[data-bom-artist-hero-save]");
      const message = adminRoot.querySelector("[data-bom-artist-hero-message]");
      if (!selectedHeroFile || !window.BOMArtistBridge) return;
      saveButton.disabled = true;
      message.textContent = "Saving artist hero…";
      const result = await window.BOMArtistBridge.saveHero(selectedHeroFile);
      if (!result?.ok) { saveButton.disabled = false; message.textContent = result?.message || "The artist hero could not be saved."; }
      return;
    }
    if (adminRoot && event.target.closest("[data-bom-artist-hero-remove]")) {
      if (!window.confirm("Remove this manual artist hero and restore automatic imagery?")) return;
      const removeButton = event.target.closest("[data-bom-artist-hero-remove]");
      removeButton.disabled = true;
      const result = await window.BOMArtistBridge?.removeHero();
      if (!result?.ok) removeButton.disabled = false;
      return;
    }
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

  window.BOMArtistUI = Object.freeze({ render, renderLoading, renderDiscography, renderTracks, isApprovedArtistImageUrl });
})();
