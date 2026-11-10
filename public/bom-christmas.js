(function initialiseChristmasSpecial() {
  "use strict";
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  let manifestPromise = null;

  function loadManifest() {
    if (!manifestPromise) manifestPromise = fetch("christmas-100.json?v=1", { credentials: "same-origin" }).then(response => {
      if (!response.ok) throw new Error("The festive collection could not be loaded.");
      return response.json();
    });
    return manifestPromise;
  }

  function ratingControl(entry, track) {
    if (!track?.available || !track.canonicalRecordingId) return `<p class="bom-xmas-discovery">Verified identity · catalogue approval pending</p>`;
    const personal = track.personalRating;
    return `<fieldset class="bom-xmas-rating" data-christmas-rating-group="${track.canonicalRecordingId}"><legend>Your rating${personal === null || personal === undefined ? "" : ` · ${personal} / 10`}</legend><div>${Array.from({ length: 11 }, (_, rating) => `<button type="button" data-christmas-rate="${rating}" aria-label="Rate ${escapeHtml(entry.title)} ${rating} out of 10" aria-pressed="${Number(personal) === rating}">${rating}</button>`).join("")}</div></fieldset>`;
  }

  function card(entry, track, index, groupLabel) {
    const hasCommunity = track?.communityRatingCount > 0;
    const community = hasCommunity ? `Community ${Number(track.communityAverage).toFixed(1)} / 10 · ${track.communityRatingCount} rating${track.communityRatingCount === 1 ? "" : "s"}` : "Not yet community-rated";
    const personal = track?.personalRating;
    const spotify = /^[A-Za-z0-9]{22}$/.test(track?.spotifyId || "") ? `<a class="bom-xmas-spotify spotify-open-externally-btn" href="https://open.spotify.com/track/${track.spotifyId}" target="_blank" rel="noopener noreferrer">Open in Spotify<span class="sr-only">: ${escapeHtml(entry.title)} by ${escapeHtml(entry.artist)}</span></a>` : "";
    return `<article class="bom-xmas-track" data-christmas-entry data-index="${index}" data-group="${entry.group}" data-decade="${Math.floor(entry.year / 10) * 10}" data-personal-rated="${personal === null || personal === undefined ? "false" : "true"}" data-community-rated="${hasCommunity}" data-community="${hasCommunity ? Number(track.communityAverage) : -1}" data-community-count="${track?.communityRatingCount || 0}" data-year="${entry.year}" tabindex="-1" style="--xmas-order:${index}"><div class="bom-xmas-rank" data-christmas-rank aria-label="Community rank">—</div><div class="bom-xmas-copy"><p>${entry.year} · ${escapeHtml(groupLabel)}</p><h2>${escapeHtml(entry.title)}</h2><h3>${escapeHtml(entry.artist)}</h3><span>${community}</span>${spotify}</div>${ratingControl(entry, track)}<p class="bom-xmas-status" role="status" aria-live="polite"></p></article>`;
  }

  function snowLayer() {
    const flakes = Array.from({ length: 20 }, (_, index) => {
      const left = (index * 37 + 11) % 100;
      const delay = -((index * 1.7) % 14).toFixed(1);
      const duration = (11 + (index * 7) % 9).toFixed(1);
      const drift = -32 + (index * 29) % 65;
      const size = 3 + (index * 5) % 6;
      const opacity = (0.68 + ((index * 11) % 5) * 0.055).toFixed(2);
      return `<i style="--snow-left:${left}%;--snow-delay:${delay}s;--snow-duration:${duration}s;--snow-drift:${drift}px;--snow-size:${size}px;--snow-opacity:${opacity}"></i>`;
    }).join("");
    return `<div class="bom-xmas-snow" aria-hidden="true">${flakes}</div>`;
  }

  function render(dialog, manifest, data) {
    const state = { group: "all", decade: "all", view: "community" };
    const groups = new Map(manifest.groups.map(group => [group.id, group.label]));
    const tracks = new Map((data.tracks || []).map(track => [String(track.musicbrainzRecordingId || "").toLowerCase(), track]));
    const matchedCount = manifest.tracks.filter(entry => tracks.get(String(entry.musicbrainzRecordingId || "").toLowerCase())?.available).length;
    const ratedCount = manifest.tracks.filter(entry => tracks.get(String(entry.musicbrainzRecordingId || "").toLowerCase())?.personalRating !== null && tracks.get(String(entry.musicbrainzRecordingId || "").toLowerCase())?.personalRating !== undefined).length;
    const decades = [...new Set(manifest.tracks.map(entry => Math.floor(entry.year / 10) * 10))].sort((a, b) => a - b);
    dialog.innerHTML = `${snowLayer()}<header class="bom-xmas-hero"><button type="button" class="bom-xmas-close" data-christmas-close aria-label="Close the Christmas Special">EXIT</button><div class="bom-xmas-mark" aria-hidden="true">✦</div><div><p>THE BANK OF MUSIC PRESENTS</p><h1 id="bomChristmasTitle">THE CHRISTMAS TOP 100</h1><span>Six festive collections. One community ranking.</span></div></header><section class="bom-xmas-progress" aria-label="Christmas rating progress"><div><strong data-christmas-rated-count>${ratedCount}</strong><span>of ${matchedCount} available tracks rated</span></div><div role="progressbar" aria-valuemin="0" aria-valuemax="${matchedCount}" aria-valuenow="${ratedCount}" aria-label="${ratedCount} of ${matchedCount} available tracks rated"><span style="width:${matchedCount ? ratedCount / matchedCount * 100 : 0}%"></span></div><small>${manifest.tracks.length} verified recording identities · ${matchedCount} currently available in BOM</small></section><section class="bom-xmas-controls" aria-label="Filter and navigate Christmas tracks"><button type="button" data-christmas-next>Next unrated</button><label>View<select data-christmas-view><option value="community">Community Top 100</option><option value="year">Chronological</option><option value="title">Title A–Z</option></select></label><label>Category<select data-christmas-group><option value="all">All six groups</option>${manifest.groups.map(group => `<option value="${group.id}">${escapeHtml(group.label)} (${group.targetCount})</option>`).join("")}</select></label><label>Decade<select data-christmas-decade><option value="all">All decades</option>${decades.map(decade => `<option value="${decade}">${decade}s</option>`).join("")}</select></label></section><main class="bom-xmas-list" data-christmas-list>${manifest.tracks.map((entry, index) => card(entry, tracks.get(String(entry.musicbrainzRecordingId || "").toLowerCase()), index, groups.get(entry.group))).join("")}</main><footer><p>Community positions include tracks with ratings. Not Yet Rated tracks stay in a separate section. All 100 verified identities use Bank of Music’s canonical rating system.</p></footer>`;

    function visible(cardElement) {
      return (state.group === "all" || cardElement.dataset.group === state.group) && (state.decade === "all" || cardElement.dataset.decade === state.decade);
    }

    function applyView() {
      const list = dialog.querySelector("[data-christmas-list]");
      list.querySelectorAll(".bom-xmas-divider").forEach(divider => divider.remove());
      const cards = [...list.querySelectorAll("[data-christmas-entry]")];
      cards.sort((left, right) => {
        if (state.view === "year") return Number(left.dataset.year) - Number(right.dataset.year) || Number(left.dataset.index) - Number(right.dataset.index);
        if (state.view === "title") return left.querySelector("h2").textContent.localeCompare(right.querySelector("h2").textContent);
        return Number(right.dataset.communityRated === "true") - Number(left.dataset.communityRated === "true") || Number(right.dataset.community) - Number(left.dataset.community) || Number(right.dataset.communityCount) - Number(left.dataset.communityCount) || Number(left.dataset.index) - Number(right.dataset.index);
      });
      let rank = 0, dividerAdded = false;
      cards.forEach(cardElement => {
        cardElement.hidden = !visible(cardElement);
        if (!cardElement.hidden && state.view === "community" && cardElement.dataset.communityRated === "true") rank += 1;
        cardElement.querySelector("[data-christmas-rank]").textContent = state.view === "community" && cardElement.dataset.communityRated === "true" ? String(rank) : "—";
        if (!cardElement.hidden && state.view === "community" && cardElement.dataset.communityRated === "false" && !dividerAdded) {
          const divider = document.createElement("h2");
          divider.className = "bom-xmas-divider";
          divider.textContent = "Not Yet Rated";
          list.append(divider);
          dividerAdded = true;
        }
        list.append(cardElement);
      });
    }

    function updateProgress() {
      const rated = [...dialog.querySelectorAll('[data-christmas-entry][data-personal-rated="true"]')].length;
      const progress = dialog.querySelector(".bom-xmas-progress [role=progressbar]");
      dialog.querySelector("[data-christmas-rated-count]").textContent = String(rated);
      progress.setAttribute("aria-valuenow", String(rated));
      progress.setAttribute("aria-label", `${rated} of ${matchedCount} available tracks rated`);
      progress.querySelector("span").style.width = `${matchedCount ? rated / matchedCount * 100 : 0}%`;
    }

    dialog.querySelector("[data-christmas-close]").onclick = () => dialog.close();
    dialog.querySelector("[data-christmas-view]").onchange = event => { state.view = event.target.value; applyView(); };
    dialog.querySelector("[data-christmas-group]").onchange = event => { state.group = event.target.value; applyView(); };
    dialog.querySelector("[data-christmas-decade]").onchange = event => { state.decade = event.target.value; applyView(); };
    dialog.querySelector("[data-christmas-next]").onclick = () => {
      const next = [...dialog.querySelectorAll('[data-christmas-entry][data-personal-rated="false"]')].find(cardElement => !cardElement.hidden && cardElement.querySelector("[data-christmas-rating-group]"));
      const status = dialog.querySelector(".bom-xmas-controls");
      if (next) { next.focus({ preventScroll: true }); next.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); }
      else status.setAttribute("aria-label", "No unrated catalogue tracks in this view");
    };
    dialog.querySelectorAll("[data-christmas-rate]").forEach(button => button.onclick = async () => {
      const cardElement = button.closest("[data-christmas-entry]"), group = button.closest("[data-christmas-rating-group]"), status = cardElement.querySelector("[role=status]");
      group.disabled = true; status.textContent = "Saving…";
      const result = await window.BOMPresentationBridge.saveChristmasTrackRating(group.dataset.christmasRatingGroup, Number(button.dataset.christmasRate)).catch(() => ({ ok: false, message: "Your rating could not be saved." }));
      group.disabled = false; status.textContent = result.message;
      if (result.ok) {
        group.querySelectorAll("button").forEach(control => control.setAttribute("aria-pressed", String(control === button)));
        group.querySelector("legend").textContent = `Your rating · ${result.rating} / 10`;
        cardElement.dataset.personalRated = "true";
        updateProgress();
      }
    });
    applyView();
    dialog.querySelector("[data-christmas-close]").focus({ preventScroll: true });
  }

  async function open() {
    if (window.BOM_CHRISTMAS_FEATURE?.enabled !== true || document.getElementById("bomChristmasSpecial")) return false;
    const timeZone = window.BOM_CHRISTMAS_FEATURE.timeZone || "Europe/London";
    if (new Intl.DateTimeFormat("en-GB", { month: "2-digit", timeZone }).format(new Date()) !== "12") return false;
    const dialog = document.createElement("dialog");
    dialog.id = "bomChristmasSpecial";
    dialog.className = "bom-xmas-dialog";
    dialog.setAttribute("aria-labelledby", "bomChristmasTitle");
    dialog.innerHTML = `<div class="bom-xmas-loading" aria-busy="true"><div class="bom-xmas-mark" aria-hidden="true">✦</div><p>UNWRAPPING THE COLLECTION…</p></div>`;
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
    try {
      const manifest = await loadManifest();
      const data = await window.BOMPresentationBridge.loadChristmasMusicData(manifest);
      if (dialog.open) render(dialog, manifest, data);
    } catch (error) {
      dialog.innerHTML = `<div class="bom-xmas-error"><h1 id="bomChristmasTitle">The festivities are paused</h1><p>${escapeHtml(error.message)}</p><button type="button" data-christmas-close>Return to Discover</button></div>`;
      dialog.querySelector("[data-christmas-close]").onclick = () => dialog.close();
    }
    return true;
  }

  window.BOMChristmasUI = Object.freeze({ open });
})();
