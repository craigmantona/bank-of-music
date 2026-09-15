(function initialiseBOMAlbumPresentation() {
  "use strict";

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);

  function artwork(model) {
    if (!model.artworkUrl) {
      return '<div class="bom-v1-album-artwork bom-v1-album-artwork-missing" role="img" aria-label="Artwork unavailable"><span>bom</span><small>Artwork unavailable</small></div>';
    }
    return `<img class="bom-v1-album-artwork" src="${escapeHtml(model.artworkUrl)}" alt="${escapeHtml(model.title)} cover" decoding="async" fetchpriority="high">`;
  }

  function duration(value) {
    if (!Number.isFinite(value) || value <= 0) return "—";
    const seconds = Math.round(value / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function formatReleaseDate(value, precision = "external") {
    const clean = String(value || "").trim();
    if (!clean) return "";
    const match = clean.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
    if (!match) return clean;
    const [, year, month, day] = match;
    const normalizedPrecision = String(precision || "").toLowerCase();
    if (normalizedPrecision === "year" || !month || (normalizedPrecision === "stored" && month === "01" && day === "01")) return year;
    const monthDate = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    const monthYear = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(monthDate);
    if (normalizedPrecision === "month" || !day) return monthYear;
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
  }

  function communityRating(rating) {
    if (!rating || !Number.isFinite(rating.average)) return '<span class="bom-v1-rating-empty">Not rated</span>';
    return `<strong>${rating.average.toFixed(1)}</strong><span>/ 10</span>${rating.count ? `<small>${rating.count.toLocaleString()} rating${rating.count === 1 ? "" : "s"}</small>` : ""}`;
  }

  function trackRow(track) {
    const topClass = track.isTopTrack ? " bom-v1-top-track" : "";
    return `<div class="track-row-table bom-v1-track-row${topClass}" data-track-index="${track.index}" data-song-id="${escapeHtml(track.songId || "")}">
      <div class="track-col-number">${escapeHtml(track.number)}</div>
      <div class="track-col-title"><strong>${escapeHtml(track.title)}</strong>${track.isManual ? '<small>Manual track</small>' : ""}</div>
      <div class="bom-v1-track-time" data-label="Time">${duration(track.durationMs)}</div>
      <div class="track-col-average" data-label="Community" ${track.community ? `title="${track.community.count} community rating${track.community.count === 1 ? "" : "s"}" aria-label="${track.community.average.toFixed(1)} out of 10 from ${track.community.count} community rating${track.community.count === 1 ? "" : "s"}"` : 'aria-label="No community ratings"'}>${track.community ? `<strong>${track.community.average.toFixed(1)}</strong><span> / 10</span>` : "—"}</div>
      <div class="track-col-your-rating${track.personal !== null ? " has-rating" : ""}" data-label="You"><span class="bom-v1-track-personal-value">${track.personal !== null ? `<strong>${track.personal}</strong><span> / 10</span>` : "—"}</span><span class="bom-v1-track-rating-slot">${track.ratingControlHtml || ""}</span></div>
      <div class="track-col-actions">
        <button type="button" class="track-preview-btn" data-track-preview="true" data-provider-type="song" data-provider-title="${escapeHtml(track.title)}" data-provider-artist="${escapeHtml(track.artist)}" data-provider-album="${escapeHtml(track.album)}" aria-label="Preview ${escapeHtml(track.title)}"><span aria-hidden="true">▶</span></button>
        ${track.saveControlHtml || ""}
      </div>
    </div>`;
  }

  function tracks(model) {
    if (!model.tracks.length) return `<section class="bom-v1-album-section"><h2>Tracks</h2>${window.BOMUI.SectionState({ title: "Track list unavailable", message: "No track information is available for this release." })}</section>`;
    return `<section class="bom-v1-album-section bom-v1-tracks-section">
      <header class="bom-v1-album-section-header"><h2>Tracks</h2><span>${model.trackCount} track${model.trackCount === 1 ? "" : "s"}</span></header>
      <div id="albumTrackPreviewDock" class="album-track-preview-dock hidden" aria-live="polite"></div>
      <div class="bom-v1-track-table">
        <div class="bom-v1-track-header" aria-hidden="true"><span>#</span><span>Track</span><span>Time</span><span>Community</span><span>You</span><span></span></div>
        ${model.tracks.map(trackRow).join("")}
      </div>
    </section>`;
  }

  function render(model) {
    const meta = [
      model.releaseDate ? `<span>${escapeHtml(formatReleaseDate(model.releaseDate, model.releaseDatePrecision))}</span>` : "",
      `<span>${model.trackCount} track${model.trackCount === 1 ? "" : "s"}</span>`,
      model.durationMs ? `<span>${duration(model.durationMs)}</span>` : ""
    ].filter(Boolean).join("");

    return `<article class="bom-v1-album" data-bom-album-id="${escapeHtml(model.albumId || "")}">
      <div class="bom-v1-album-back">${model.backControlHtml || ""}</div>
      <section class="bom-v1-album-hero">
        <div class="bom-v1-album-artwork-wrap">${artwork(model)}</div>
        <div class="bom-v1-album-identity">
          <div class="bom-v1-album-kind">Album</div>
          <h1>${escapeHtml(model.title)}</h1>
          <div class="bom-v1-album-artist">${model.artistControlHtml || escapeHtml(model.artist)}</div>
          <div class="bom-v1-album-meta">${meta}</div>
          <div class="bom-v1-album-ratings">
            <div><span>Community</span><div class="bom-v1-album-community">${communityRating(model.community)}</div></div>
            <div><span>Your album rating</span><div class="bom-v1-album-personal">${model.albumRatingControlHtml || "Not rated"}</div></div>
          </div>
          <div class="bom-v1-album-actions">${model.providerControlHtml || ""}${model.shareControlHtml || ""}</div>
          ${model.adminControlHtml || ""}
        </div>
      </section>
      ${tracks(model)}
      <section class="bom-v1-album-section bom-v1-reviews-wrap" id="bomV1AlbumReviews" aria-live="polite">
        <header class="bom-v1-album-section-header"><h2>Reviews</h2></header>
        ${window.BOMUI.Skeleton({ label: "Loading reviews", lines: 3 })}
      </section>
    </article>`;
  }

  function renderReviews(html) {
    const target = document.getElementById("bomV1AlbumReviews");
    if (target) target.innerHTML = html;
  }

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest(".bom-v1-track-rating-trigger");
    if (!trigger) return;
    document.querySelectorAll(".bom-v1-track-rating-control[open]").forEach((control) => {
      if (control !== trigger.parentElement) control.removeAttribute("open");
    });
  });

  window.BOMAlbumUI = Object.freeze({ render, renderReviews, formatReleaseDate });
})();
