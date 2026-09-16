(function initialiseBOMDiscoverPresentation() {
  "use strict";

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);

  function albumRow(albums, label) {
    if (!albums.length) return "";
    const rowId = `bomDiscoverRow-${Math.random().toString(36).slice(2)}`;
    return `<div class="bom-v1-discover-row-shell">
      <button type="button" class="bom-v1-discover-arrow is-previous" data-bom-discover-scroll="-1" aria-controls="${rowId}" aria-label="Scroll ${escapeHtml(label)} left">←</button>
      <div id="${rowId}" class="bom-v1-discover-row" tabindex="0" aria-label="${escapeHtml(label)}">${albums.map((album) => window.BOMUI.AlbumCard(album)).join("")}</div>
      <button type="button" class="bom-v1-discover-arrow is-next" data-bom-discover-scroll="1" aria-controls="${rowId}" aria-label="Scroll ${escapeHtml(label)} right">→</button>
    </div>`;
  }

  function recommendationGroup(group) {
    return `<section class="bom-v1-discover-group" aria-labelledby="bomDiscoverGroup-${escapeHtml(group.key)}">
      <header class="bom-v1-discover-group-heading"><p id="bomDiscoverGroup-${escapeHtml(group.key)}">Because you rated <strong>${escapeHtml(group.reason.title)}</strong> ${escapeHtml(group.reason.rating)} / 10</p></header>
      ${albumRow(group.albums, `Recommendations because you rated ${group.reason.title}`)}
    </section>`;
  }

  function emptyState(model) {
    const title = model.authenticated ? "Your next record is waiting." : "Sign in to make Discover yours.";
    const message = model.authenticated
      ? "Rate an album you know, or search for an artist to start building recommendations."
      : "Search the collection now, then sign in when you’re ready to rate and save music.";
    return window.BOMUI.SectionState({ title, message, actionLabel: "Search the collection", action: "discover-search" });
  }

  function render(model) {
    const groups = model.groups || [];
    const general = model.general || [];
    const hasMusic = groups.some((group) => group.albums.length) || general.length;
    return `<article class="bom-v1-discover" data-bom-discover>
      <header class="bom-v1-discover-intro"><div><p class="bom-v1-discover-eyebrow">Listen closely. Find something good.</p><h1>A world worth listening to.</h1><p>Old favourites. New obsessions. Your next great record.</p></div><span>The Bank of Music<br>A life in records</span></header>
      ${hasMusic ? `${groups.map(recommendationGroup).join("")}
        ${general.length ? `<section class="bom-v1-discover-section" aria-labelledby="bomDiscoverNext"><header class="bom-v1-discover-section-heading"><div><h2 id="bomDiscoverNext">Your next listen</h2><p>Records to make time for.</p></div></header>${albumRow(general, "Albums to rate next")}</section>` : ""}` : emptyState(model)}
    </article>`;
  }

  function skeletonCards(count = 5) {
    return `<div class="bom-v1-discover-skeleton-row" aria-hidden="true">${Array.from({ length: count }, () => '<div><span class="bom-v1-skeleton"></span><span class="bom-v1-skeleton"></span><span class="bom-v1-skeleton"></span></div>').join("")}</div>`;
  }

  function renderLoading() {
    return `<article class="bom-v1-discover" data-bom-discover aria-busy="true">
      <header class="bom-v1-discover-intro"><div><p class="bom-v1-discover-eyebrow">Listen closely. Find something good.</p><h1>A world worth listening to.</h1><p>Finding records for you…</p></div></header>
      <section class="bom-v1-discover-section"><header class="bom-v1-discover-section-heading"><div><h2>Your next listen</h2><p>Records to make time for.</p></div></header>${skeletonCards()}</section>
    </article>`;
  }

  function renderError() {
    return `<article class="bom-v1-discover" data-bom-discover><header class="bom-v1-discover-intro"><div><p class="bom-v1-discover-eyebrow">Listen closely. Find something good.</p><h1>A world worth listening to.</h1></div></header>${window.BOMUI.SectionState({ title: "Discover couldn’t load.", message: "The rest of Bank of Music is still available.", actionLabel: "Try again", action: "discover-retry" })}</article>`;
  }

  function updateRowControls(root = document) {
    root.querySelectorAll?.(".bom-v1-discover-row-shell").forEach((shell) => {
      const row = shell.querySelector(".bom-v1-discover-row");
      const previous = shell.querySelector(".is-previous");
      const next = shell.querySelector(".is-next");
      if (!row || !previous || !next) return;
      const overflow = row.scrollWidth > row.clientWidth + 2;
      previous.hidden = !overflow || row.scrollLeft <= 2;
      next.hidden = !overflow || row.scrollLeft + row.clientWidth >= row.scrollWidth - 2;
    });
  }

  document.addEventListener("click", (event) => {
    const arrow = event.target.closest("[data-bom-discover-scroll]");
    if (arrow) {
      const row = document.getElementById(arrow.getAttribute("aria-controls"));
      row?.scrollBy({ left: Number(arrow.dataset.bomDiscoverScroll) * Math.max(280, row.clientWidth * .82), behavior: "smooth" });
      window.setTimeout(() => updateRowControls(arrow.closest(".bom-v1-discover")), 220);
      return;
    }
    const action = event.target.closest("[data-bom-action]")?.dataset.bomAction;
    if (action === "discover-search") window.BOMPresentationBridge?.showSearch();
    if (action === "discover-retry") window.BOMPresentationBridge?.refreshDiscover();
  });

  document.addEventListener("click", (event) => {
    const artist = event.target.closest("[data-bom-discover-artist]");
    const album = event.target.closest(".bom-v1-discover .bom-v1-music-card");
    if (!artist && !album) return;
    window.history.replaceState({ ...(window.history.state || {}), bomDiscover: true, scrollY: window.scrollY }, "", window.location.href);
    window.history.pushState({ bomDiscoverDestination: true }, "", window.location.href);
    if (!artist) return;
    event.preventDefault();
    event.stopPropagation();
    void window.BOMPresentationBridge?.openArtist(artist.dataset.bomDiscoverArtist);
  }, true);

  document.addEventListener("keydown", (event) => {
    const card = event.target.closest(".bom-v1-discover .bom-v1-music-card");
    if (!card || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    card.click();
  });

  window.addEventListener("resize", () => updateRowControls());
  window.BOMDiscoverUI = Object.freeze({ render, renderLoading, renderError, updateRowControls });
})();
