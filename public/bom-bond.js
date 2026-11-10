(function initialiseBondMusicSpecial() {
  "use strict";
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  let manifestPromise = null;

  function loadManifest() {
    if (!manifestPromise) manifestPromise = fetch("bond-007.json?v=1", { credentials: "same-origin" }).then(response => {
      if (!response.ok) throw new Error("The mission file could not be loaded.");
      return response.json();
    });
    return manifestPromise;
  }

  function launchPanel(launch) {
    if (!launch?.nextBondActor || !launch?.officialAnnouncementDate) return "";
    const source = launch.officialAnnouncementSource
      ? `<a href="${escapeHtml(launch.officialAnnouncementSource)}" target="_blank" rel="noopener noreferrer">Verified announcement source</a>` : "";
    const message = launch.launchDayMessageEnabled ? `<p>${escapeHtml(launch.launchDayMessage)}</p>` : "";
    return `<aside class="bom-007-announcement"><p>OFFICIAL INTELLIGENCE</p><h2>${escapeHtml(launch.announcementHeadline || `${launch.nextBondActor} announced as the next James Bond`)}</h2><span>${escapeHtml(launch.officialAnnouncementDate)}</span>${message}${source}</aside>`;
  }

  function ratingControl(entry, personalRating) {
    if (!entry.catalogueTrackId) return `<p class="bom-007-unmatched">Catalogue match pending review</p>`;
    return `<fieldset class="bom-007-rating" data-bond-rating-group="${entry.catalogueTrackId}"><legend>Your rating${personalRating === null ? "" : ` · ${personalRating} / 10`}</legend><div>${Array.from({ length: 11 }, (_, rating) => `<button type="button" data-bond-rate="${rating}" aria-label="Rate ${escapeHtml(entry.themeTitle)} ${rating} out of 10" aria-pressed="${Number(personalRating) === rating}">${rating}</button>`).join("")}</div></fieldset>`;
  }

  function entryCard(entry, track, index) {
    const community = track?.communityRatingCount > 0
      ? `<span>Community ${Number(track.communityAverage).toFixed(1)} / 10 · ${track.communityRatingCount} rating${track.communityRatingCount === 1 ? "" : "s"}</span>`
      : `<span>Community ranking unavailable</span>`;
    return `<article class="bom-007-track${entry.bonus ? " is-bonus" : ""}" data-bond-entry data-year="${entry.year}" data-bonus="${Boolean(entry.bonus)}" data-rated="${track?.personalRating === null || track?.personalRating === undefined ? "false" : "true"}" data-personal="${track?.personalRating ?? -1}" data-community="${track?.communityRatingCount > 0 ? Number(track.communityAverage) : -1}" tabindex="-1" style="--bond-order:${index}"><div class="bom-007-track-number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</div><div class="bom-007-track-copy"><p>${entry.year} · ${escapeHtml(entry.bondActor)}${entry.instrumental ? " · INSTRUMENTAL" : ""}</p><h2>${escapeHtml(entry.themeTitle)}</h2><h3>${escapeHtml(entry.filmTitle)}</h3><span>${escapeHtml(entry.originalPerformer)}</span>${entry.bonus ? `<strong>${escapeHtml(entry.bonusLabel)}</strong>` : ""}${entry.note ? `<small>${escapeHtml(entry.note)}</small>` : ""}${community}</div>${ratingControl(entry, track?.personalRating ?? null)}<p class="bom-007-save-status" role="status" aria-live="polite"></p></article>`;
  }

  function render(dialog, manifest, data) {
    const state = { filter: "all", sort: "year", year: "all" };
    const tracks = new Map((data.tracks || []).map(track => [Number(track.catalogueTrackId), track]));
    const films = manifest.films || [], entries = [...films, ...(manifest.bonusTracks || [])];
    const ratedCount = films.filter(entry => tracks.get(Number(entry.catalogueTrackId))?.personalRating !== null && tracks.get(Number(entry.catalogueTrackId))?.personalRating !== undefined).length;
    const matchedCount = films.filter(entry => entry.catalogueTrackId).length;
    dialog.innerHTML = `<header class="bom-007-hero"><button type="button" class="bom-007-close" data-bond-close aria-label="Close the 007 music special">EXIT</button><div class="bom-007-barrel" aria-hidden="true"><span>007</span></div><div><p>THE BANK OF MUSIC PRESENTS</p><h1 id="bomBondTitle">007 — THE MUSIC OF BOND</h1><span>Six decades. Legendary voices. One licence to rate.</span></div></header>${launchPanel(data.launch)}<section class="bom-007-progress" aria-label="Bond rating progress"><div><strong>${ratedCount}</strong><span>of ${films.length} official themes rated</span></div><div class="bom-007-progress-line" role="progressbar" aria-valuemin="0" aria-valuemax="25" aria-valuenow="${ratedCount}" aria-label="${ratedCount} of 25 official themes rated"><span style="width:${ratedCount / films.length * 100}%"></span></div><small>${matchedCount} verified catalogue matches · ${films.length - matchedCount} awaiting review</small></section><section class="bom-007-controls" aria-label="Filter and navigate Bond themes"><div role="group" aria-label="Rating filter"><button type="button" data-bond-filter="all" aria-pressed="true">All themes</button><button type="button" data-bond-filter="unrated" aria-pressed="false">Unrated</button></div><label>Order<select data-bond-sort><option value="year">Film year</option><option value="ranking">My ranking</option><option value="community">Community ranking</option></select></label><label>Film year<select data-bond-year><option value="all">All years</option>${films.map(entry => `<option value="${entry.year}">${entry.year} · ${escapeHtml(entry.filmTitle)}</option>`).join("")}</select></label></section><main class="bom-007-list" data-bond-list>${entries.map((entry, index) => entryCard(entry, tracks.get(Number(entry.catalogueTrackId)), index)).join("")}</main><footer><p>Official Eon films only. Bonus tracks are labelled and never replace title themes.</p></footer>`;

    function updateProgress() {
      const rated = [...dialog.querySelectorAll('[data-bond-entry][data-bonus="false"]')].filter(card => card.dataset.rated === "true").length;
      const progress = dialog.querySelector(".bom-007-progress-line");
      dialog.querySelector(".bom-007-progress strong").textContent = String(rated);
      progress.setAttribute("aria-valuenow", String(rated));
      progress.setAttribute("aria-label", `${rated} of ${films.length} official themes rated`);
      progress.querySelector("span").style.width = `${rated / films.length * 100}%`;
    }

    function applyView() {
      const cards = [...dialog.querySelectorAll("[data-bond-entry]")];
      cards.sort((left, right) => state.sort === "ranking" ? Number(right.dataset.personal) - Number(left.dataset.personal) || Number(left.dataset.year) - Number(right.dataset.year) : state.sort === "community" ? Number(right.dataset.community) - Number(left.dataset.community) || Number(left.dataset.year) - Number(right.dataset.year) : Number(left.dataset.year) - Number(right.dataset.year));
      cards.forEach(card => {
        card.hidden = (state.filter === "unrated" && card.dataset.rated === "true") || (state.year !== "all" && card.dataset.year !== state.year);
        dialog.querySelector("[data-bond-list]").append(card);
      });
    }
    dialog.querySelector("[data-bond-close]").onclick = () => dialog.close();
    dialog.querySelectorAll("[data-bond-filter]").forEach(button => button.onclick = () => {
      state.filter = button.dataset.bondFilter;
      dialog.querySelectorAll("[data-bond-filter]").forEach(control => control.setAttribute("aria-pressed", String(control === button)));
      applyView();
    });
    dialog.querySelector("[data-bond-sort]").onchange = event => { state.sort = event.target.value; applyView(); };
    dialog.querySelector("[data-bond-year]").onchange = event => { state.year = event.target.value; applyView(); dialog.querySelector("[data-bond-entry]:not([hidden])")?.focus?.({ preventScroll: true }); };
    dialog.querySelectorAll("[data-bond-rate]").forEach(button => button.onclick = async () => {
      const card = button.closest("[data-bond-entry]"), group = button.closest("[data-bond-rating-group]"), status = card.querySelector("[role=status]");
      group.disabled = true; status.textContent = "Saving…";
      const result = await window.BOMPresentationBridge.saveBondTrackRating(Number(group.dataset.bondRatingGroup), Number(button.dataset.bondRate)).catch(() => ({ ok: false, message: "Your rating could not be saved." }));
      group.disabled = false; status.textContent = result.message;
      if (result.ok) {
        group.querySelectorAll("button").forEach(control => control.setAttribute("aria-pressed", String(control === button)));
        group.querySelector("legend").textContent = `Your rating · ${result.rating} / 10`;
        card.dataset.rated = "true"; card.dataset.personal = String(result.rating);
        updateProgress();
      }
    });
    dialog.querySelector("[data-bond-close]").focus({ preventScroll: true });
  }

  async function open() {
    if (window.BOM_BOND_FEATURE?.enabled !== true || document.getElementById("bomBondSpecial")) return false;
    const dialog = document.createElement("dialog");
    dialog.id = "bomBondSpecial";
    dialog.className = "bom-007-dialog";
    dialog.setAttribute("aria-labelledby", "bomBondTitle");
    dialog.innerHTML = `<div class="bom-007-loading" aria-busy="true"><div class="bom-007-barrel" aria-hidden="true"><span>007</span></div><p>ACCEPTING MISSION…</p></div>`;
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
    try {
      const manifest = await loadManifest();
      const data = await window.BOMPresentationBridge.loadBondMusicData(manifest);
      if (dialog.open) render(dialog, manifest, data);
    } catch (error) {
      dialog.innerHTML = `<div class="bom-007-error"><h1 id="bomBondTitle">Mission interrupted</h1><p>${escapeHtml(error.message)}</p><button type="button" data-bond-close>Return to Discover</button></div>`;
      dialog.querySelector("[data-bond-close]").onclick = () => dialog.close();
    }
    return true;
  }

  window.BOMBondUI = Object.freeze({ open });
})();
