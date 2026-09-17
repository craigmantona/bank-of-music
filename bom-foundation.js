(function initialiseBOMStageOne() {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  if (params.get("ui") !== "stage1") return;

  const root = document.getElementById("bomStageOneShell");
  if (!root) return;

  document.body.classList.add("bom-shell-v1");
  document.documentElement.dataset.bomUi = "stage1";
  root.hidden = false;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);

  window.BOMUI = Object.freeze({
    Artwork({ src = "", alt = "", className = "" } = {}) {
      if (!src) return `<div class="bom-v1-artwork bom-v1-artwork-missing ${escapeHtml(className)}" role="img" aria-label="Artwork unavailable">Artwork unavailable</div>`;
      return `<img class="bom-v1-artwork ${escapeHtml(className)}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`;
    },
    CommunityRating({ average = null, count = 0 } = {}) {
      const score = Number(average);
      const hasScore = average !== null && average !== "" && Number.isFinite(score);
      return `<span class="bom-v1-community-rating">${hasScore ? `${score.toFixed(1)} / 10` : "Not rated"}${count ? ` · ${Number(count).toLocaleString()} rating${Number(count) === 1 ? "" : "s"}` : ""}</span>`;
    },
    PersonalRating({ value = null, label = "Your rating" } = {}) {
      const score = Number(value);
      const hasScore = value !== null && value !== "" && Number.isFinite(score);
      return `<span class="bom-v1-personal-rating"><span class="visually-hidden">${escapeHtml(label)}: </span>${hasScore ? `${score} / 10` : "Not rated"}</span>`;
    },
    Skeleton({ label = "Loading", lines = 1 } = {}) {
      return `<div role="status" aria-label="${escapeHtml(label)}">${Array.from({ length: Math.max(1, Number(lines) || 1) }, () => '<div class="bom-v1-skeleton" aria-hidden="true"></div>').join("")}</div>`;
    },
    SectionState({ title, message = "", actionLabel = "", action = "" } = {}) {
      return `<div class="bom-v1-section-state" role="status"><h3>${escapeHtml(title || "Nothing here yet")}</h3>${message ? `<p>${escapeHtml(message)}</p>` : ""}${actionLabel ? `<button type="button" data-bom-action="${escapeHtml(action)}">${escapeHtml(actionLabel)}</button>` : ""}</div>`;
    },
    SectionHeading({ title, description = "", aside = "" } = {}) {
      return `<header class="bom-v1-section-heading"><div><h2>${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ""}</div>${aside ? `<span>${escapeHtml(aside)}</span>` : ""}</header>`;
    },
    SegmentedControl({ label, options = [], selected = "" } = {}) {
      return `<div class="bom-v1-segmented-control" role="group" aria-label="${escapeHtml(label)}">${options.map(({ value, text }) => `<button type="button" data-value="${escapeHtml(value)}" aria-pressed="${value === selected}">${escapeHtml(text)}</button>`).join("")}</div>`;
    },
    AlbumCard({ id, title, artist = "", artworkUrl = "", year = "", community = null } = {}) {
      const score = Number(community?.average);
      const hasScore = community && Number.isFinite(score);
      const artwork = artworkUrl
        ? `<img class="bom-v1-music-card-artwork" src="${escapeHtml(artworkUrl)}" alt="${escapeHtml(title)} cover" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="bom-v1-music-card-artwork bom-v1-music-card-missing" role="img" aria-label="Artwork unavailable" hidden><span aria-hidden="true">bom</span><small>Artwork unavailable</small></span>`
        : '<span class="bom-v1-music-card-artwork bom-v1-music-card-missing" role="img" aria-label="Artwork unavailable"><span aria-hidden="true">bom</span><small>Artwork unavailable</small></span>';
      return `<article class="bom-v1-music-card" data-library-type="album" data-album-id="${escapeHtml(id)}" tabindex="0" role="link" aria-label="Open ${escapeHtml(title)}">
        <div class="bom-v1-music-card-art">${artwork}</div>
        <h3>${escapeHtml(title)}</h3>
        ${artist ? `<button type="button" class="bom-v1-music-card-artist" data-bom-discover-artist="${escapeHtml(artist)}">${escapeHtml(artist)}</button>` : ""}
        <div class="bom-v1-music-card-foot"><span>${escapeHtml(year)}</span><span>${hasScore ? `${score.toFixed(1)} <small>/ 10</small>` : "Not rated"}</span></div>
      </article>`;
    }
  });

  root.innerHTML = `
    <header class="bom-v1-header">
      <button type="button" class="bom-v1-brand" data-bom-route="discover" aria-label="Bank of Music, Discover">bo<span class="bom-v1-brand-mark">m</span></button>
      <nav class="bom-v1-nav" aria-label="Main navigation">
        <button type="button" data-bom-route="discover" aria-current="page">Discover</button>
        <button type="button" data-bom-route="charts">Charts</button>
        <button type="button" data-bom-route="ratings">Your Ratings</button>
      </nav>
      <form class="bom-v1-search" role="search">
        <label class="visually-hidden" for="bomV1Search">Search artists, albums and tracks</label>
        <input id="bomV1Search" type="search" autocomplete="off" placeholder="Artists, albums, tracks">
        <button type="submit" aria-label="Search">⌕</button>
      </form>
      <div class="bom-v1-account">
        <button type="button" class="bom-v1-account-button" aria-expanded="false" aria-controls="bomV1ProfileMenu" aria-label="Open account menu">···</button>
        <div id="bomV1ProfileMenu" class="bom-v1-menu" hidden></div>
      </div>
    </header>`;

  const routeButtons = [...root.querySelectorAll("[data-bom-route]")];
  const accountButton = root.querySelector(".bom-v1-account-button");
  const menu = root.querySelector(".bom-v1-menu");
  const searchForm = root.querySelector(".bom-v1-search");
  const searchInput = root.querySelector("#bomV1Search");

  function bridge() { return window.BOMPresentationBridge || null; }

  function initials(displayName) {
    const clean = String(displayName || "Account").replace(/^@/, "").replace(/[^a-z0-9 ]/gi, " ").trim();
    return (clean.split(/\s+/).map((part) => part[0]).join("").slice(0, 2) || "••").toUpperCase();
  }

  function setRoute(route) {
    routeButtons.forEach((button) => {
      if (button.dataset.bomRoute === route) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function routeUrl(route, query = "") {
    const url = new URL(window.location.href);
    ["share", "id", "albumId", "songId", "title", "artist", "date", "cover", "release", "view", "q"].forEach((key) => url.searchParams.delete(key));
    if (route === "charts" || route === "ratings" || route === "search") url.searchParams.set("view", route);
    if (route === "search" && query) url.searchParams.set("q", query);
    return url.toString();
  }

  function rememberRoute(route, query = "") {
    const nextUrl = routeUrl(route, query);
    if (nextUrl !== window.location.href) window.history.pushState({ bomStageOneRoute: route, query }, "", nextUrl);
  }

  function closeMenu({ restoreFocus = false } = {}) {
    menu.hidden = true;
    accountButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) accountButton.focus();
  }

  function renderProfileMenu() {
    const state = bridge()?.getState() || { authenticated: false, displayName: "Account", isAdmin: false };
    accountButton.textContent = state.authenticated ? initials(state.displayName) : "••";
    menu.innerHTML = `
      <div class="bom-v1-menu-header"><strong>${escapeHtml(state.displayName)}</strong><small>${state.authenticated ? "Bank of Music account" : "Sign in to rate music"}</small></div>
      ${state.authenticated ? '<button type="button" data-bom-account="profile">Profile</button>' : '<button type="button" data-bom-account="signin">Sign in</button>'}
      <button type="button" data-bom-account="spotify">Spotify Sync</button>
      ${state.isAdmin ? '<button type="button" data-bom-account="admin">Admin</button>' : ""}
      ${state.authenticated ? '<button type="button" data-bom-account="logout">Log out</button>' : ""}`;
  }

  function activate() {
    renderProfileMenu();
    const state = bridge()?.getState();
    const routeBySection = { recommendationsSection: "discover", chartsSection: "charts", librarySection: "ratings" };
    if (state?.currentSectionId) setRoute(routeBySection[state.currentSectionId] || "");
  }

  routeButtons.forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.bomRoute;
    const app = bridge();
    if (!app) return;
    setRoute(action);
    if (action === "discover") app.showDiscover();
    if (action === "charts") await app.showCharts();
    if (action === "ratings") app.showRatings();
    rememberRoute(action);
  }));

  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const term = searchInput.value.trim();
    if (!term || !bridge()) return;
    setRoute("");
    await bridge().runSearch(term);
    rememberRoute("search", term);
  });

  accountButton.addEventListener("click", () => {
    renderProfileMenu();
    menu.hidden = !menu.hidden;
    accountButton.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) menu.querySelector("button")?.focus();
  });

  menu.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-bom-account]")?.dataset.bomAccount;
    if (!action || !bridge()) return;
    closeMenu();
    if (action === "profile") await bridge().showProfile();
    if (action === "spotify") await bridge().showSpotify();
    if (action === "logout") await bridge().logout();
    if (action === "signin") bridge().showSection("searchSection");
    if (action === "admin") bridge().showSection("adminSection");
    activate();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".bom-v1-account")) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      searchInput.focus();
    }
    if (event.key === "Escape" && !menu.hidden) closeMenu({ restoreFocus: true });
  });

  const sessionStatus = document.getElementById("sessionStatus");
  if (sessionStatus) new MutationObserver(activate).observe(sessionStatus, { childList: true, subtree: true, characterData: true });
  window.addEventListener("bom:presentation-ready", activate);
  window.addEventListener("popstate", async (event) => {
    const params = new URLSearchParams(window.location.search);
    const route = event.state?.bomStageOneRoute || params.get("view") || "";
    const app = bridge();
    if (!app) return activate();
    if (route === "charts") await app.showCharts();
    else if (route === "ratings") app.showRatings();
    else if (route === "search") await app.runSearch(event.state?.query || params.get("q") || "");
    else if (!params.get("share")) app.showDiscover();
    activate();
  });
  activate();
})();
