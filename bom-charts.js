(function initialiseBOMChartsPresentation() {
  "use strict";

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);

  let currentModel = { albums: [], tracks: [] };
  let selectedType = "albums";

  function missingArtwork() {
    return '<span class="bom-v1-chart-art bom-v1-chart-art-missing" role="img" aria-label="Artwork unavailable"><span aria-hidden="true">bom</span></span>';
  }

  function artwork(row) {
    if (!row.artworkUrl) return missingArtwork();
    return `<span class="bom-v1-chart-art"><img src="${escapeHtml(row.artworkUrl)}" alt="" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="bom-v1-chart-art-missing" role="img" aria-label="Artwork unavailable" hidden><span aria-hidden="true">bom</span></span></span>`;
  }

  function chartRow(row, index, type) {
    const isAlbum = type === "albums";
    const secondary = isAlbum
      ? [row.artist, row.year].filter(Boolean).join(" · ")
      : [row.artist, row.albumTitle, row.year].filter(Boolean).join(" · ");
    const count = Number(row.ratingCount || 0);
    const countLabel = count ? `${count.toLocaleString()} community rating${count === 1 ? "" : "s"}` : "Community rating count unavailable";
    const score = Number(row.averageRating);
    return `<article class="chart-row bom-v1-chart-row" tabindex="0" role="link"
      data-chart-type="${isAlbum ? "album" : "song"}"
      data-chart-id="${escapeHtml(row.id)}"
      data-chart-title="${escapeHtml(row.title)}"
      data-chart-artist="${escapeHtml(row.artist)}"
      aria-label="Number ${index + 1}: ${escapeHtml(row.title)}, ${Number.isFinite(score) ? `${score.toFixed(1)} out of 10` : "not rated"}">
      <span class="bom-v1-chart-rank" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
      ${artwork(row)}
      <span class="bom-v1-chart-copy"><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(secondary || "Information unavailable")}</span></span>
      <span class="bom-v1-chart-score" title="${escapeHtml(countLabel)}"><strong>${Number.isFinite(score) ? score.toFixed(1) : "—"}</strong><small>/ 10</small><span>Community</span></span>
    </article>`;
  }

  function list(rows, type) {
    if (!rows.length) {
      return window.BOMUI.SectionState({
        title: `No rated ${type === "albums" ? "albums" : "tracks"} yet.`,
        message: "Community rankings will appear as ratings are added."
      });
    }
    return `<div class="bom-v1-chart-list" aria-label="Top ${type === "albums" ? "albums" : "tracks"}">${rows.slice(0, 10).map((row, index) => chartRow(row, index, type)).join("")}</div>`;
  }

  function render(model, type = selectedType) {
    currentModel = model;
    selectedType = type === "tracks" ? "tracks" : "albums";
    const rows = selectedType === "albums" ? model.albums : model.tracks;
    return `<article class="bom-v1-charts" data-bom-charts>
      <header class="bom-v1-charts-intro">
        <div><p class="bom-v1-charts-eyebrow">The community, on record</p><h1>Records that resonate.</h1><p>The albums and tracks that stay with us.</p></div>
        ${window.BOMUI.SegmentedControl({ label: "Chart type", selected: selectedType, options: [{ value: "albums", text: "Top Albums" }, { value: "tracks", text: "Top Tracks" }] })}
      </header>
      <section class="bom-v1-charts-section" aria-labelledby="bomChartsTitle">
        <header><div><p>Community chart</p><h2 id="bomChartsTitle">Top 10 ${selectedType === "albums" ? "Albums" : "Tracks"}</h2></div><span>Ranked by rating, then number of ratings</span></header>
        ${list(rows, selectedType)}
      </section>
    </article>`;
  }

  function renderLoading() {
    const rows = Array.from({ length: 6 }, (_, index) => `<div class="bom-v1-chart-row bom-v1-chart-skeleton" aria-hidden="true"><span class="bom-v1-chart-rank">${String(index + 1).padStart(2, "0")}</span><span class="bom-v1-skeleton"></span><span class="bom-v1-chart-copy"><span class="bom-v1-skeleton"></span><span class="bom-v1-skeleton"></span></span><span class="bom-v1-skeleton"></span></div>`).join("");
    return `<article class="bom-v1-charts" data-bom-charts aria-busy="true"><header class="bom-v1-charts-intro"><div><p class="bom-v1-charts-eyebrow">The community, on record</p><h1>Records that resonate.</h1><p>Loading the latest community rankings…</p></div></header><section class="bom-v1-charts-section"><header><div><p>Community chart</p><h2>Top 10 Albums</h2></div></header><div class="bom-v1-chart-list">${rows}</div></section></article>`;
  }

  function renderError(message = "The charts couldn’t load.") {
    return `<article class="bom-v1-charts" data-bom-charts><header class="bom-v1-charts-intro"><div><p class="bom-v1-charts-eyebrow">The community, on record</p><h1>Records that resonate.</h1></div></header>${window.BOMUI.SectionState({ title: message, message: "The rest of Bank of Music is still available.", actionLabel: "Try again", action: "charts-retry" })}</article>`;
  }

  document.addEventListener("click", (event) => {
    const switcher = event.target.closest(".bom-v1-charts [data-value]");
    if (switcher) {
      const root = switcher.closest("#chartsSection");
      if (root) root.innerHTML = render(currentModel, switcher.dataset.value);
      return;
    }
    if (event.target.closest('[data-bom-action="charts-retry"]')) void window.BOMPresentationBridge?.refreshCharts();
  });

  document.addEventListener("keydown", (event) => {
    const row = event.target.closest(".bom-v1-chart-row.chart-row");
    if (!row || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    row.click();
  });

  window.BOMChartsUI = Object.freeze({ render, renderLoading, renderError });
})();
