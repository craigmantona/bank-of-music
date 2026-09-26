// BoM v29: Spotify-style sharing, public user profiles, handle editing, and follower system.
/*

Bank of Music - FULL app.js

Full-code version with blank-line spacing preserved for Textastic readability.

Fixes: helper nesting, recommendations visibility, album autosave on selection,

album rating save support, album star clicks, and savedAlbumId carried into detail view.

*/



// Bank of Music app.js v20 - admin UI controls
// Adds admin dashboard plus selected item controls for artwork, hiding albums, and hiding songs.

// Bank of Music app.js v21 full admin controls fix
// Fixes selected album crash caused by missing renderSelectedAdminControls.

document.addEventListener("DOMContentLoaded", () => {

const supabaseClient = window.supabase.createClient(

  window.SUPABASE_URL,

  window.SUPABASE_ANON_KEY

);

const emailInput = document.getElementById("email");

const passwordInput = document.getElementById("password");

const birthYearInput = document.getElementById("birthYear");

const handleInput = document.getElementById("handleInput");

const signupBtn = document.getElementById("signupBtn");

const loginBtn = document.getElementById("loginBtn");

const logoutBtn = document.getElementById("logoutBtn");

const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");

const authMessage = document.getElementById("authMessage");

const globalSearchInput = document.getElementById("globalSearchInput");

const globalSearchBtn = document.getElementById("globalSearchBtn");

const globalSearchMessage = document.getElementById("globalSearchMessage");

const globalSearchResults = document.getElementById("globalSearchResults");

const followArtistInput = document.getElementById("followArtistInput");

const followArtistBtn = document.getElementById("followArtistBtn");

const followArtistMessage = document.getElementById("followArtistMessage");



const selectedItemDetail = document.getElementById("selectedItemDetail");



const refreshLibraryBtn = document.getElementById("refreshLibraryBtn");

const albumsList = document.getElementById("albumsList");

const songsList = document.getElementById("songsList");

const recommendationsList = document.getElementById("recommendationsList");

const loadChartsBtn = document.getElementById("loadChartsBtn");
const globalAlbumCharts = document.getElementById("globalAlbumCharts");
const ageAlbumCharts = document.getElementById("ageAlbumCharts");

const sessionStatus = document.getElementById("sessionStatus");

const authCard = document.getElementById("authCard");

const topNavButtons = document.querySelectorAll(".top-nav-btn");

const adminSection = document.getElementById("adminSection");

const adminDashboard = document.getElementById("adminDashboard");

const adminSearchInput = document.getElementById("adminSearchInput");

const adminRefreshBtn = document.getElementById("adminRefreshBtn");

const adminMessage = document.getElementById("adminMessage");

const profileModal = document.getElementById("profileModal") || createProfileModal();

injectProfileStyles();

const LASTFM_API_KEY = window.LASTFM_API_KEY || null;

const releaseGroupCoverCache = {};

const albumTrackCache = {};

let currentUser = null;

let passwordRecovery = null;

let allAlbums = [];

let allSongs = [];

let allAlbumRatings = [];

let allSongRatings = [];

let followedArtists = [];

let selectedItem = null;
let currentSectionId = "searchSection";
let stageOneInitialDataReady = false;
let previousSectionId = "searchSection";

let currentProfile = null;

let isAdmin = false;
let adminEditingTrackAlbumId = null;

/*
  Prevents the tap that opens a profile from also opening
  one of the albums inside the newly displayed profile.
*/
let profileOpenedAt = 0;

/*
  Prevents an iPhone/iPad synthetic second tap from opening an
  album card immediately after a track-rating star changes the DOM.
*/
let lastTrackRatingInteractionAt = 0;

/*
  Prevent album-card navigation when a Spotify control is tapped
  inside an album detail card on touch devices.
*/
let lastMusicProviderInteractionAt = 0;


function setMessage(element, text) {

  if (element) element.textContent = text || "";

}



function escapeHtml(value) {

  return String(value ?? "")

    .replace(/&/g, "&amp;")

    .replace(/</g, "&lt;")

    .replace(/>/g, "&gt;")

    .replace(/\"/g, "&quot;")

    .replace(/'/g, "&#39;");

}

function renderClickableProfileHandle(
  profile,
  userId,
  fallbackText = "BoM member"
) {
  const handle = profile?.handle
    ? `@${String(profile.handle).replace(/^@+/, "")}`
    : fallbackText;

  if (!userId) {
    return `
      <span class="review-member-handle">
        ${escapeHtml(handle)}
      </span>
    `;
  }

  return `
    <button
      type="button"
      class="review-member-handle clickable-profile-handle"
      data-profile-user-id="${escapeHtml(userId)}"
      onclick="
        event.preventDefault();
        event.stopPropagation();
        window.openPublicProfileById('${escapeHtml(userId)}');
        return false;
      "
      title="View ${escapeHtml(handle)}'s profile"
    >
      ${escapeHtml(handle)}
    </button>
  `;
}

function renderClickableArtistName(artistName) {
  if (!artistName) return "";

  return `
  <button
    class="artist-link-btn"
    onclick="openArtistPage('${escapeHtml(artistName)}'); return false;"
  >
    ${escapeHtml(artistName)}
  </button>
`;
}

window.openArtistPage = async function (artistName) {

  const cleanArtistName = normaliseText(artistName);

  if (!cleanArtistName) {
    return;
  }

  /*
    Artist links from saved songs usually contain only the artist
    name, whereas a search result already contains MusicBrainz's
    artist ID. Resolve and retain that ID before rendering so both
    routes show the same complete studio discography.
  */
  const artistId =
    getSelectedArtistIdFallback(cleanArtistName) ||
    await resolveArtistIdByName(cleanArtistName);

  selectedItem = {
    type: "artist",
    title: cleanArtistName,
    name: cleanArtistName,
    artist: cleanArtistName,
    externalId: artistId,
    artistId
  };

  showOnlySection("detailSection");

  await renderSelectedItem();
};


function normaliseText(value) {

  return String(value || "").trim().replace(/\s+/g, " ");

}



function normaliseCompare(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^the\s+/i, "")
    .replace(/\u2019/gi, "")
    .replace(/\U2019/g, "")
    .replace(/[’'`]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normaliseAlbumTitleKey(value) {
  const source = String(value || "").normalize("NFKC").trim();
  const ordinary = source
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/[^\p{L}\p{N}]+/gu, "");
  if (ordinary) return ordinary;
  return source
    ? `symbols:${Array.from(source).map((character) => character.codePointAt(0).toString(16)).join("-")}`
    : "";
}

function albumIdentityMatches(album, candidate) {
  if (!album || !candidate) return false;

  const albumGroupId = album.musicbrainz_release_group_id || album.release_group_id || album.releaseGroupId || "";
  const candidateGroupId = candidate.musicbrainz_release_group_id || candidate.release_group_id || candidate.releaseGroupId || "";
  if (albumGroupId && candidateGroupId) return albumGroupId === candidateGroupId;

  const albumReleaseId = album.musicbrainz_release_id ||
    (album.external_source === "musicbrainz" ? album.external_id : "") || "";
  const candidateReleaseId = candidate.musicbrainz_release_id ||
    candidate.externalId ||
    (candidate.external_source === "musicbrainz" ? candidate.external_id : "") || "";
  if (albumReleaseId && candidateReleaseId) return albumReleaseId === candidateReleaseId;
  if (candidate.savedAlbumId && Number(album.id) === Number(candidate.savedAlbumId)) return true;

  const titleKey = normaliseAlbumTitleKey(candidate.title);
  const artistKey = normaliseCompare(candidate.artist);
  return Boolean(titleKey && artistKey &&
    normaliseAlbumTitleKey(album.title) === titleKey &&
    normaliseCompare(album.artist) === artistKey);
}



function normaliseReleaseDate(value) {

  const raw = String(value || "").replace(/^"+|"+$/g, "").trim();



  if (!raw) return null;



  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {

    return raw;

  }



  if (/^\d{4}-\d{2}$/.test(raw)) {

    return `${raw}-01`;

  }



  if (/^\d{4}$/.test(raw)) {

    return `${raw}-01-01`;

  }



  return null;

}



function setActiveTopNav(targetId) {

  topNavButtons.forEach((button) => {

    button.classList.toggle("active-nav", button.dataset.target === targetId);

  });

}



function goToSection(targetId) {

  const section = document.getElementById(targetId);

  if (!section) return;

  section.scrollIntoView({ behavior: "smooth", block: "start" });

  setActiveTopNav(targetId);

}





function showOnlySection(targetId) {

  if (targetId && targetId !== currentSectionId) {
    previousSectionId = currentSectionId || "searchSection";
    currentSectionId = targetId;
  }

  [
  "searchSection",
  "recommendationsSection",
  "librarySection",
  "detailSection",
  "chartsSection",
  "settingsSection",
  "adminSection"
].forEach((id) => {

    const section = document.getElementById(id);

    if (!section) return;

    section.classList.toggle("hidden", id !== targetId);

  });

  setActiveTopNav(targetId);

  if (targetId === "searchSection") {
    setTimeout(() => {
      const searchInput = document.getElementById("globalSearchInput");

      if (searchInput) {
  const y =
    searchInput.getBoundingClientRect().top +
    window.pageYOffset -
    160;

  window.scrollTo({
    top: y,
    behavior: "smooth"
  });

        searchInput.focus();
    }
  }, 100);
}

/*
  Stage 1 presentation bridge.
  It exposes existing application actions without duplicating their data,
  authentication, Spotify, rating, review or catalogue behaviour.
*/
window.BOMPresentationBridge = Object.freeze({
  showSection: (sectionId) => showOnlySection(sectionId),
  showDiscover: () => {
    selectedItem = null;
    showOnlySection("recommendationsSection");
    renderRecommendations();
  },
  showQuickRate: () => openQuickRate(),
  showSearch: () => showOnlySection("searchSection"),
  showCharts: () => window.goCharts(),
  showRatings: () => {
    showOnlySection("librarySection");
    renderLibrary();
  },
  showSpotify: () => {
    showOnlySection("settingsSection");
    return refreshSpotifyConnectionUI();
  },
  connectSpotify: () => {
    showOnlySection("settingsSection");
    return connectSpotify();
  },
  showProfile: () => showUserProfile(),
  logout: () => logOut(),
  runSearch: (term) => {
    if (globalSearchInput) globalSearchInput.value = String(term || "");
    showOnlySection("searchSection");
    return runGlobalSearch();
  },
  getSearchCatalogue: () => getPredictiveCatalogue(),
  openSearchSuggestion: async (item) => {
    if (item.kind === "Artist") return window.openArtistPage(item.title);
    const row = item.row;
    if (item.album && !allAlbums.some((album) => album.id === item.album.id)) allAlbums.push(item.album);
    if (item.kind === "Album" && !allAlbums.some((album) => album.id === row.id)) allAlbums.push(row);
    if (item.kind === "Track" && !allSongs.some((song) => song.id === row.id)) allSongs.push(row);
    selectedItem = {
      type: item.kind === "Album" ? "album" : "song", title: row.title, artist: row.artist,
      externalId: row.external_id || "", coverUrl: item.artworkUrl,
      releaseDate: row.release_date || "", albumId: item.kind === "Album" ? row.id : row.album_id,
      ...(item.kind === "Album" ? { savedAlbumId: row.id } : { savedSongId: row.id })
    };
    showOnlySection("detailSection");
    await renderSelectedItem();
  },
  openArtist: (artistName) => window.openArtistPage(artistName),
  refreshDiscover: () => renderRecommendations(),
  refreshCharts: () => loadCharts(),
  refreshRatings: async () => {
    const root = document.getElementById("librarySection");
    if (isStageOnePresentation() && window.BOMRatingsUI && root) root.innerHTML = window.BOMRatingsUI.renderLoading();
    try {
      await loadLibrary();
      renderLibrary();
    } catch (error) {
      if (isStageOnePresentation() && window.BOMRatingsUI && root) root.innerHTML = window.BOMRatingsUI.renderError();
    }
  },
  openAlbumById: (albumId) => openStageOneRatingsAlbum(albumId),
  openRequestedRoute: () => {
    const params = new URLSearchParams(window.location.search);
    if (!stageOneInitialDataReady || params.get("ui") === "legacy") return;
    if (params.get("view") === "search" && window.BOMSearchUI) {
      const query = params.get("q") || "";
      const shellInput = document.getElementById("bomV1Search");
      if (shellInput) shellInput.value = query;
      if (query) return window.BOMPresentationBridge.runSearch(query);
    }
    if (params.get("view") === "charts" && window.BOMChartsUI) return window.goCharts();
    if (params.get("view") === "ratings" && window.BOMRatingsUI) {
      showOnlySection("librarySection");
      return renderLibrary();
    }
  },
  getState: () => ({
    authenticated: Boolean(currentUser),
    displayName: getUserDisplayName(),
    isAdmin: Boolean(isAdmin),
    currentSectionId,
    spotifyConnected: spotifyConnectionState
  })
});

window.dispatchEvent(new CustomEvent("bom:presentation-ready"));

}


function createProfileModal() {

 injectProfileStyles();

 const modal = document.createElement("div");

 modal.id = "profileModal";

 modal.className = "profile-modal hidden";

 modal.setAttribute("aria-hidden", "true");

 modal.innerHTML = "";

 document.body.appendChild(modal);

 return modal;

}



function injectProfileStyles() {

 if (document.getElementById("profileFeatureStyles")) return;



 const style = document.createElement("style");

 style.id = "profileFeatureStyles";

 style.textContent = `

   .session-profile-btn {
     background: linear-gradient(135deg, rgba(255,45,141,0.92), rgba(0,212,255,0.92)) !important;
     border: 0 !important;
     border-radius: 18px !important;
     color: #fff !important;
     font: inherit !important;
     font-weight: 950 !important;
     cursor: pointer !important;
     padding: 10px 18px !important;
     box-shadow: 0 12px 34px rgba(0, 212, 255, 0.22), 0 12px 34px rgba(255, 45, 141, 0.18) !important;
   }

   .session-profile-btn:hover {
     filter: brightness(1.08) !important;
     transform: translateY(-1px) !important;
   }

   .profile-modal.hidden {
     display: none !important;
   }

   .profile-modal {
     position: fixed !important;
     inset: 0 !important;
     width: 100vw !important;
     height: 100vh !important;
     z-index: 999999 !important;
     display: flex !important;
     align-items: center !important;
     justify-content: center !important;
     padding: 20px !important;
     overflow: hidden !important;
   }
   .profile-modal-backdrop {
     position: absolute !important;
     inset: 0 !important;
     background: rgba(2, 6, 23, 0.78) !important;
     backdrop-filter: blur(16px) !important;
     -webkit-backdrop-filter: blur(16px) !important;
   }

   .profile-card-panel {
     position: relative !important;
     width: min(760px, 94vw) !important;
     max-height: 82vh !important;
     overflow: auto !important;
     border: 1px solid rgba(147, 51, 234, 0.58) !important;
     border-radius: 30px !important;
     background:
       radial-gradient(circle at top left, rgba(255, 45, 141, 0.32), transparent 28%),
       radial-gradient(circle at top right, rgba(0, 212, 255, 0.28), transparent 30%),
       linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(5, 8, 22, 0.98)) !important;
     color: #fff !important;
     box-shadow: 0 34px 120px rgba(0,0,0,0.70), 0 0 0 1px rgba(255,255,255,0.05) inset !important;
     padding: 26px !important;
     animation: profilePopIn 0.22s ease-out !important;
   }

   @keyframes profilePopIn {
     from { opacity: 0; transform: translateY(18px) scale(0.98); }
     to { opacity: 1; transform: translateY(0) scale(1); }
   }

   .profile-card-header {
     display: flex !important;
     justify-content: space-between !important;
     gap: 18px !important;
     align-items: flex-start !important;
     margin-bottom: 22px !important;
   }

   .profile-card-header h2 {
     margin: 4px 0 0 !important;
     font-size: clamp(2rem, 4vw, 3.2rem) !important;
     line-height: 1 !important;
     letter-spacing: -0.04em !important;
   }

   .profile-card-header p {
     margin: 8px 0 0 !important;
     color: #cbd5e1 !important;
     font-weight: 900 !important;
     font-size: 1.05rem !important;
   }

   .profile-kicker {
     color: #22f5a7 !important;
     text-transform: uppercase !important;
     letter-spacing: 0.14em !important;
     font-size: 0.78rem !important;
     font-weight: 950 !important;
   }

   .profile-close-btn {
     width: 46px !important;
     height: 46px !important;
     min-width: 46px !important;
     border-radius: 50% !important;
     border: 1px solid rgba(255,255,255,0.18) !important;
     background: linear-gradient(135deg, rgba(255,45,141,0.95), rgba(0,212,255,0.95)) !important;
     color: white !important;
     font-size: 1.6rem !important;
     line-height: 1 !important;
     cursor: pointer !important;
     display: grid !important;
     place-items: center !important;
     box-shadow: 0 12px 32px rgba(0, 212, 255, 0.22) !important;
   }

   .profile-stats-grid {
     display: grid !important;
     grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
     gap: 14px !important;
     margin-bottom: 24px !important;
   }

   .profile-stat-card {
     border-radius: 20px !important;
     background: rgba(255,255,255,0.08) !important;
     border: 1px solid rgba(255,255,255,0.13) !important;
     padding: 18px !important;
     min-height: 96px !important;
   }

   .profile-stat-number {
     font-size: 2.15rem !important;
     font-weight: 950 !important;
     color: #facc15 !important;
     line-height: 1 !important;
   }

   .profile-stat-label {
     color: #cbd5e1 !important;
     font-weight: 850 !important;
     margin-top: 8px !important;
   }

   .profile-section-title {
     color: #22f5a7 !important;
     text-transform: uppercase !important;
     letter-spacing: 0.12em !important;
     font-size: 0.92rem !important;
     font-weight: 950 !important;
     margin: 16px 0 12px !important;
   }

   .profile-top-albums {
     display: grid !important;
     gap: 10px !important;
   }

   .profile-album-row {
     display: grid !important;
     grid-template-columns: 38px 66px minmax(0, 1fr) 86px !important;
     align-items: center !important;
     gap: 14px !important;
     border-radius: 18px !important;
     padding: 11px 12px !important;
     background: rgba(255,255,255,0.065) !important;
     border: 1px solid rgba(255,255,255,0.11) !important;
     cursor: pointer !important;
     min-height: 88px !important;
     transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease !important;
   }

   .profile-album-row:hover {
     border-color: rgba(34, 245, 167, 0.58) !important;
     transform: translateY(-1px) !important;
     background: rgba(255,255,255,0.09) !important;
   }

   .profile-album-rank {
     font-weight: 950 !important;
     color: #93c5fd !important;
     text-align: center !important;
     font-size: 1.05rem !important;
   }

   .profile-album-cover-wrap {
     width: 66px !important;
     height: 66px !important;
     overflow: hidden !important;
     border-radius: 14px !important;
     background: #0b1020 !important;
   }

   .profile-album-cover-wrap .media-cover,
   .profile-album-cover-wrap .media-cover-placeholder {
     width: 66px !important;
     height: 66px !important;
     max-width: 66px !important;
     min-height: 66px !important;
     border-radius: 14px !important;
     object-fit: cover !important;
     display: grid !important;
     place-items: center !important;
     font-size: 0.76rem !important;
     line-height: 1.1 !important;
     text-align: center !important;
     overflow: hidden !important;
   }

   .profile-album-main {
     min-width: 0 !important;
   }

   .profile-album-title {
     font-weight: 950 !important;
     font-size: 1rem !important;
     white-space: nowrap !important;
     overflow: hidden !important;
     text-overflow: ellipsis !important;
   }

   .profile-album-artist {
     color: #cbd5e1 !important;
     margin-top: 3px !important;
     font-size: 0.92rem !important;
     white-space: nowrap !important;
     overflow: hidden !important;
     text-overflow: ellipsis !important;
   }

   .profile-album-rating {
     color: #facc15 !important;
     font-weight: 950 !important;
     white-space: nowrap !important;
     font-size: 1rem !important;
     text-align: right !important;
   }

   .profile-help-note {
     color: #94a3b8 !important;
     font-size: 0.9rem !important;
     margin-top: 18px !important;
   }

   body.profile-open {
     overflow: hidden !important;
   }

   @media (max-width: 720px) {
     .profile-card-panel {
       padding: 20px !important;
     }

     .profile-stats-grid {
       grid-template-columns: 1fr !important;
     }

     .profile-album-row {
       grid-template-columns: 30px 54px minmax(0, 1fr) !important;
       gap: 10px !important;
     }

     .profile-album-rating {
       grid-column: 3 !important;
       text-align: left !important;
     }

     .profile-album-cover-wrap,
     .profile-album-cover-wrap .media-cover,
     .profile-album-cover-wrap .media-cover-placeholder {
       width: 54px !important;
       height: 54px !important;
       max-width: 54px !important;
       min-height: 54px !important;
     }
   }

 `;



 document.head.appendChild(style);

}



function cleanHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
}

function isValidHandle(handle) {
  return /^[a-z0-9_]{3,20}$/.test(handle);
}

async function updateCurrentUserHandle() {
  if (!currentUser) return;

  const rawHandle = prompt("Choose your handle:", currentProfile?.handle || "");
  if (rawHandle === null) return;

  const newHandle = cleanHandle(rawHandle);

  if (!newHandle || newHandle.length < 3) {
    setMessage(globalSearchMessage, "Handle must be at least 3 characters.");
    return;
  }

  const { data: existing } = await supabaseClient
    .from("profiles")
    .select("id")
    .eq("handle", newHandle)
    .maybeSingle();

  if (existing && existing.id !== currentUser.id) {
    setMessage(globalSearchMessage, "That handle is already taken.");
    return;
  }

  const { data, error } = await supabaseClient
    .from("profiles")
    .update({ handle: newHandle })
    .eq("id", currentUser.id)
    .select("*")
    .single();

  if (error) {
    setMessage(globalSearchMessage, error.message);
    return;
  }

  currentProfile = data;
  updateSessionUI();
  renderProfileModalContent();
  setMessage(globalSearchMessage, "Handle updated.");
}



function getFallbackHandle() {

 return cleanHandle(currentUser?.email || "bom_user");

}


function fixChartSectionHeadings() {
  document
    .querySelectorAll("h1, h2, h3, h4, .section-title")
    .forEach((heading) => {
      const text =
        normaliseText(
          heading.textContent || ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      if (
        text ===
        "your age range top albums"
      ) {
        heading.textContent =
          "Global Top Songs";
      }
    });
}

document.addEventListener(
  "DOMContentLoaded",
  () => {
    fixChartSectionHeadings();

    const chartHeadingObserver =
      new MutationObserver(() => {
        fixChartSectionHeadings();
      });

    chartHeadingObserver.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }
);

async function loadCharts() {
  const chartRoot = document.getElementById("chartsSection");
  if (isStageOnePresentation() && window.BOMChartsUI) {
    chartRoot.innerHTML = window.BOMChartsUI.renderLoading();
  } else {
  globalAlbumCharts.innerHTML = "<p class='small'>Loading albums...</p>";
  ageAlbumCharts.innerHTML = "<p class='small'>Loading songs...</p>";
  }

  fixChartSectionHeadings();

  const { data: albums, error: albumError } = await supabaseClient
    .from("album_rating_charts")
    .select("*")
    .order("average_rating", { ascending: false })
    .order("rating_count", { ascending: false })
    .limit(20);

  if (albumError) {
    if (isStageOnePresentation() && window.BOMChartsUI) {
      chartRoot.innerHTML = window.BOMChartsUI.renderError();
      return;
    }
    globalAlbumCharts.innerHTML = `<p class="small">${escapeHtml(albumError.message)}</p>`;
    return;
  }

  const { data: songs, error: songError } = await supabaseClient
    .from("song_rating_charts")
    .select("*")
    .order("average_rating", { ascending: false })
    .order("rating_count", { ascending: false })
    .limit(20);

  if (songError) {
    if (isStageOnePresentation() && window.BOMChartsUI) {
      chartRoot.innerHTML = window.BOMChartsUI.renderError();
      return;
    }
    ageAlbumCharts.innerHTML = `<p class="small">${escapeHtml(songError.message)}</p>`;
    return;
  }

  if (isStageOnePresentation() && window.BOMChartsUI) {
    chartRoot.innerHTML = window.BOMChartsUI.render(buildStageOneChartsModel(albums || [], songs || []));
    return;
  }

  globalAlbumCharts.innerHTML = `
    <h3>🔥 Top 10 Albums</h3>
    ${renderChartRows(albums || [])}
  `;

  ageAlbumCharts.innerHTML = `
    <h3>🎵 Top 10 Songs</h3>
    ${renderChartRows(songs || [])}
  `;

  fixChartSectionHeadings();
}

function buildStageOneChartsModel(albumRows, songRows) {
  const albums = dedupeChartRows(albumRows).map((row) => {
    const album = allAlbums.find((item) => Number(item.id) === Number(row.item_id));
    return {
      id: row.item_id,
      title: row.title || "Untitled album",
      artist: row.artist || album?.artist || "Unknown artist",
      year: String(album?.release_date || "").match(/\b\d{4}\b/)?.[0] || "",
      artworkUrl: row.cover_art_url || row.cover_url || row.image_url || (album ? getAlbumArtworkUrl(album) : ""),
      averageRating: row.average_rating,
      ratingCount: row.rating_count
    };
  });
  const tracks = (songRows || []).map((row) => {
    const song = allSongs.find((item) => Number(item.id) === Number(row.item_id));
    const albumId = row.album_id || song?.album_id;
    const album = allAlbums.find((item) => Number(item.id) === Number(albumId));
    return {
      id: row.item_id,
      title: row.title || "Untitled track",
      artist: row.artist || song?.artist || album?.artist || "Unknown artist",
      albumTitle: album?.title || "",
      year: String(album?.release_date || "").match(/\b\d{4}\b/)?.[0] || "",
      artworkUrl: album ? getAlbumArtworkUrl(album) : "",
      averageRating: row.average_rating,
      ratingCount: row.rating_count
    };
  });
  return { albums, tracks };
}

function renderAlbumCharts(albums) {
  globalAlbumCharts.innerHTML = `
    <h2>🔥 Top 10 Albums</h2>
    <div class="chart-grid">
      ${albums.map((a, i) => `
        <div class="chart-card" data-id="${a.item_id}" data-type="album">
          <div class="chart-rank">#${i + 1}</div>
          <div class="chart-title">${a.title}</div>
          <div class="chart-artist">${a.artist}</div>
          <div class="chart-rating">⭐ ${a.average_rating}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderSongCharts(songs) {
  ageAlbumCharts.innerHTML = `
    <h2>🎵 Top 10 Songs</h2>
    <div class="chart-grid">
      ${songs.map((s, i) => `
        <div class="chart-card" data-id="${s.item_id}" data-type="song">
          <div class="chart-rank">#${i + 1}</div>
          <div class="chart-title">${s.title}</div>
          <div class="chart-artist">${s.artist}</div>
          <div class="chart-rating">⭐ ${s.average_rating}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function dedupeChartRows(rows) {
  const seen = new Set();

  return (rows || []).filter((row) => {
    if (row.item_type !== "album") return true;

    const a = normaliseCompare(row.title || "");
    const b = normaliseCompare(row.artist || "");

    const key = [a, b].sort().join("|");

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderChartRows(rows) {
  if (!rows.length) return `<p class="small">No chart data yet.</p>`;

  return `
    <div class="chart-list">
	${dedupeChartRows(rows).slice(0, 10).map((row, index) => {
  const cover =
    row.cover_art_url ||
    row.cover_url ||
    row.image_url ||
    "";

  return `
    <div class="chart-row"
  data-chart-type="${row.item_type}"
  data-chart-id="${row.item_id}"
  data-chart-title="${escapeHtml(row.title || "")}"
  data-chart-artist="${escapeHtml(row.artist || "")}"
>
      
      <div class="chart-rank">#${index + 1}</div>

      <div class="chart-art">
        ${cover
          ? `<img src="${cover}" alt="${escapeHtml(row.title)}">`
          : `<div class="chart-art-placeholder">🎵</div>`}
      </div>

      <div class="chart-info">
        <div class="chart-title">${escapeHtml(row.title)}</div>
        <div class="chart-artist">${escapeHtml(row.artist || "Unknown artist")}</div>
      </div>

      <div class="chart-meta">
        ⭐ ${Number(row.average_rating).toFixed(1)}
      </div>

    </div>
  `;
}).join("")}
    </div>
  `;
}

async function getChartPosition(itemType, itemId) {
  const viewName = itemType === "song" ? "song_rating_charts" : "album_rating_charts";

  const { data, error } = await supabaseClient
    .from(viewName)
    .select("item_id, average_rating, rating_count")
    .order("average_rating", { ascending: false })
    .order("rating_count", { ascending: false });

  if (error || !data) return null;

  const index = data.findIndex((row) => Number(row.item_id) === Number(itemId));

  return index >= 0 ? index + 1 : null;
}

async function ensureUserProfile() {
  if (!currentUser) {
    currentProfile = null;
    return null;
  }

  const meta = currentUser.user_metadata || {};
  const fallbackHandle = getFallbackHandle();

  const metadataHandle = cleanHandle(meta.handle || "");
  const preferredHandle = metadataHandle || fallbackHandle;
  const metadataBirthYear = Number(meta.birth_year || 0) || null;

  try {
    const { data: existing, error: selectError } = await supabaseClient
      .from("profiles")
      .select("id, handle, member_number, created_at, is_admin, birth_year")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (selectError && selectError.code !== "PGRST116") {
      console.error("Profile lookup failed", selectError);
      return null;
    }

    if (existing) {
  if (!existing.birth_year && metadataBirthYear) {
    const { data: updatedProfile, error: updateError } = await supabaseClient
      .from("profiles")
      .update({
        birth_year: metadataBirthYear
      })
      .eq("id", currentUser.id)
      .select("id, handle, member_number, created_at, is_admin, birth_year")
      .single();

    if (updateError) {
      console.error("Birth year update failed", updateError);
      currentProfile = existing;
      return currentProfile;
    }

    currentProfile = updatedProfile;
    return currentProfile;
  }

  currentProfile = existing;
  return currentProfile;
}

    let insertedProfile = null;

    const firstAttempt = await supabaseClient
      .from("profiles")
      .insert({
        id: currentUser.id,
        handle: preferredHandle,
        birth_year: metadataBirthYear
      })
      .select("id, handle, member_number, created_at, is_admin, birth_year")
      .single();

    if (firstAttempt.error) {
      const suffix = String(currentUser.id || "")
        .replace(/-/g, "")
        .slice(0, 5);

      const backupHandle = cleanHandle(`${preferredHandle}_${suffix}`);

      const secondAttempt = await supabaseClient
        .from("profiles")
        .insert({
          id: currentUser.id,
          handle: backupHandle,
          birth_year: metadataBirthYear
        })
        .select("id, handle, member_number, created_at, is_admin, birth_year")
        .single();

      if (!secondAttempt.error) {
        insertedProfile = secondAttempt.data;
      } else {
        console.error("Profile insert failed", secondAttempt.error);
      }
    } else {
      insertedProfile = firstAttempt.data;
    }

    currentProfile = insertedProfile;
    return currentProfile;
  } catch (err) {
    console.error("ensureUserProfile failed", err);
    currentProfile = null;
    return null;
  }
}


function getUserDisplayName() {

 if (!currentUser) return "Not logged in";

 if (currentProfile?.handle) return `@${currentProfile.handle}`;

 return currentUser.email || "Logged in";

}



function getAlbumsRatedCountForCurrentUser() {

 if (!currentUser) return 0;

 return new Set(

   allAlbumRatings

     .filter((row) => row.user_id === currentUser.id)

     .map((row) => Number(row.album_id))

 ).size;

}



function getSongsRatedCountForCurrentUser() {

 if (!currentUser) return 0;

 return new Set(

   allSongRatings

     .filter((row) => row.user_id === currentUser.id)

     .map((row) => Number(row.song_id))

 ).size;

}



function getTopRatedAlbumsForCurrentUser(limit = 10) {

 if (!currentUser) return [];



 return allAlbumRatings

   .filter((row) => row.user_id === currentUser.id)

   .map((ratingRow) => {

     const album = allAlbums.find((item) => Number(item.id) === Number(ratingRow.album_id));

     return album

       ? {

           album,

           rating: Number(ratingRow.rating)

         }

       : null;

   })

   .filter(Boolean)

   .sort((a, b) => {

     if (b.rating !== a.rating) return b.rating - a.rating;

     return normaliseCompare(a.album.title).localeCompare(normaliseCompare(b.album.title));

   })

   .slice(0, limit);

}



function renderProfileModalContent() {

 if (!profileModal || !currentUser) return;



 const displayHandle = currentProfile?.handle ? `@${currentProfile.handle}` : currentUser.email;

 const memberNumber = currentProfile?.member_number ? `#${currentProfile.member_number}` : "Pending";

 const albumsRated = getAlbumsRatedCountForCurrentUser();

 const songsRated = getSongsRatedCountForCurrentUser();

 const artistsFollowed = followedArtists.length;

 const topAlbums = getTopRatedAlbumsForCurrentUser(10);



 profileModal.innerHTML = `

   <div class="profile-modal-backdrop" data-profile-close="true"></div>

   <div class="profile-card-panel" role="dialog" aria-modal="true" aria-label="Profile statistics">

     <div class="profile-card-header">

       <div>

         <div class="profile-kicker">Bank of Music profile</div>

         <h2>${escapeHtml(displayHandle)}</h2>

         <p>Member ${escapeHtml(memberNumber)}</p>
<button type="button" id="editHandleBtn" class="secondary-btn">Edit handle</button>
<button type="button" id="logoutProfileBtn" class="secondary-btn">Logout</button>

       </div>

       <button type="button" class="profile-close-btn" data-profile-close="true">×</button>

     </div>



     <div class="profile-stats-grid">

       <div class="profile-stat-card">

         <div class="profile-stat-number">${albumsRated}</div>

         <div class="profile-stat-label">Albums rated</div>

       </div>

       <div class="profile-stat-card">

         <div class="profile-stat-number">${songsRated}</div>

         <div class="profile-stat-label">Tracks rated</div>

       </div>

       <div class="profile-stat-card">

         <div class="profile-stat-number">${artistsFollowed}</div>

         <div class="profile-stat-label">Artists followed</div>

       </div>

     </div>



     <div class="profile-section-title">Top 10 rated albums</div>

     <div class="profile-top-albums">

       ${topAlbums.length

         ? topAlbums.map((item, index) => `

             <div class="profile-album-row" data-profile-album-id="${item.album.id}">

               <div class="profile-album-rank">${index + 1}</div>

               <div class="profile-album-cover-wrap">

                 ${getAlbumCoverMarkup(getAlbumArtworkUrl(item.album), `${item.album.title} cover`)}

               </div>

               <div class="profile-album-main">

                 <div class="profile-album-title">${escapeHtml(item.album.title)}</div>

                 <div class="profile-album-artist">${escapeHtml(item.album.artist || "")}</div>

               </div>

               <div class="profile-album-rating">${isStageOnePresentation() ? "" : "⭐ "}${item.rating}/10</div>

             </div>

           `).join("")

         : `<p class="small">No rated albums yet.</p>`}

     </div>



     <div class="profile-help-note">

       Your public display name is your handle. Your email is not shown in the main app header.

     </div>

   </div>

 `;

}



async function showUserProfile() {

 if (!currentUser || !profileModal) return;



 await ensureUserProfile();

 await loadLibrary();

 renderProfileModalContent();



 profileModal.classList.remove("hidden");

 profileModal.setAttribute("aria-hidden", "false");

 document.body.classList.add("profile-open");

}



function hideUserProfile() { 

 if (!profileModal) return;

 profileModal.classList.add("hidden");

 profileModal.setAttribute("aria-hidden", "true");

 document.body.classList.remove("profile-open");

}

function showUserAccountMenu() {
  if (!currentUser) return;

  const existingMenu = document.getElementById("accountDropdown");

  if (existingMenu) {
    existingMenu.remove();
    return;
  }

  const handle = currentProfile?.handle
    ? `@${currentProfile.handle}`
    : "My account";

  const email = currentUser.email || "";

  const menu = document.createElement("div");
  menu.id = "accountDropdown";
  menu.className = "account-dropdown";

  menu.innerHTML = `
    <div class="account-dropdown-header">
      <strong>${escapeHtml(handle)}</strong>
      <span>${escapeHtml(email)}</span>
    </div>

    <button type="button" id="accountProfileBtn">
      👤 My profile
    </button>

    <button type="button" id="accountLogoutBtn" class="account-logout-btn">
      ↪ Logout
    </button>
  `;

  document.body.appendChild(menu);

  const handleButton = sessionStatus?.querySelector(".session-profile-btn");

  if (handleButton) {
    const rect = handleButton.getBoundingClientRect();

    menu.style.top = `${rect.bottom + window.scrollY + 10}px`;
    menu.style.left = `${Math.max(
      12,
      rect.right + window.scrollX - menu.offsetWidth
    )}px`;
  }

  document
    .getElementById("accountProfileBtn")
    ?.addEventListener("click", async () => {
      menu.remove();
      await showUserProfile();
    });

  document
    .getElementById("accountLogoutBtn")
    ?.addEventListener("click", async () => {
      menu.remove();
      await logOut();
    });
}

document.addEventListener("click", (event) => {
  const menu = document.getElementById("accountDropdown");

  if (!menu) return;

  const clickedMenu = event.target.closest("#accountDropdown");
  const clickedHandle = event.target.closest(".session-profile-btn");

  if (!clickedMenu && !clickedHandle) {
    menu.remove();
  }
});

function updateSessionUI() {
  if (!sessionStatus || !authCard) return;

  if (passwordRecovery?.isActive()) return;

  if (currentUser) {
    const displayName = getUserDisplayName();

    sessionStatus.innerHTML = `
      <button type="button" class="session-profile-btn" title="Open account menu">
        ${escapeHtml(displayName)} ▼
      </button>
    `;

    sessionStatus.classList.add("session-clickable");
    authCard.classList.add("hidden");
  } else {
    currentProfile = null;

    sessionStatus.textContent = "Not logged in";
    sessionStatus.classList.remove("session-clickable");
    authCard.classList.remove("hidden");
  }

  updateAdminAccessUI();
}

function updateAdminAccessUI() {

 isAdmin = Boolean(currentProfile?.is_admin);

 document.querySelectorAll("[data-admin-only='true']").forEach((element) => {

   element.classList.toggle("hidden", !isAdmin);

 });

 if (!isAdmin && adminSection) {

   adminSection.classList.add("hidden");

 }

}



function handleScrollState() {

  const header = document.getElementById("mainHeader");

  if (!header) return;



  if (window.scrollY > 50) {

    header.classList.add("header-small");

    document.body.classList.add("header-shrunk");

  } else {

    header.classList.remove("header-small");

    document.body.classList.remove("header-shrunk");

  }

}



function buildFallbackMarkup(text, className) {

  return `<div class="${className}">${escapeHtml(text)}</div>`;

}



function buildSafeImageMarkup(url, altText, imageClass, fallbackClass, fallbackText) {

  if (!url) {

    return buildFallbackMarkup(fallbackText, fallbackClass);

  }



  return `

    <img

      class="${imageClass}"

      src="${escapeHtml(url)}"

      alt="" aria-label="${escapeHtml(altText)}"

      loading="lazy"

      decoding="async"

      referrerpolicy="no-referrer"

      onerror="this.onerror=null; this.style.display='none'; this.insertAdjacentHTML('afterend', '<div class=&quot;${fallbackClass}&quot;>${escapeHtml(fallbackText)}</div>');">

  `;

}



function getPosterCoverMarkup(url, altText) {

  return buildSafeImageMarkup(url, altText, "poster-image", "poster-placeholder", "No cover");

}



function getAlbumCoverMarkup(url, altText) {

  return buildSafeImageMarkup(url, altText, "media-cover", "media-cover-placeholder", "No cover");

}



function getLargeCoverMarkup(url, alt = "") {
  const initial = (alt || "?").trim().charAt(0).toUpperCase();

  if (!url) {
    return `<div class="artist-initial-large">${escapeHtml(initial)}</div>`;
  }

  return `
    <div class="artist-image-wrap">
      <img
        src="${url}"
        alt="${escapeHtml(alt)}"
        class="large-cover-image"
        loading="eager"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      >
      <div class="artist-initial-large" style="display:none;">${escapeHtml(initial)}</div>
    </div>
  `;
}



function getAlbumArtworkUrl(item) {

  if (!item) return "";



  const directUrl =

    item.custom_cover ||

    item.cover_art_url ||

    item.coverUrl ||

    item.cover_url ||

    item.artwork_url ||

    "";



  if (directUrl) return directUrl;



  const externalId = item.external_id || item.externalId || "";



  if (externalId) {

    return `https://coverartarchive.org/release/${encodeURIComponent(externalId)}/front-250`;

  }



  return "";

}





function renderSelectedAdminControls(options = {}) {

  if (!isAdmin) return "";

  const albumId = options.albumId || "";
  const songId = options.songId || "";
  const buttons = [];

  if (albumId) {
    buttons.push(`<button class="admin-selected-edit-cover-btn" data-album-id="${albumId}">🖼 Edit cover</button>`);
    buttons.push(`<button class="admin-selected-delete-album-btn danger-btn" data-album-id="${albumId}">🗑 Hide album</button>`);
  }

  if (songId) {
    buttons.push(`<button class="admin-selected-delete-song-btn danger-btn" data-song-id="${songId}">🗑 Hide song</button>`);
  }

  if (!buttons.length) return "";

  return `
    <div class="selected-admin-controls">
      <div class="selected-admin-title">Admin controls</div>
      <div class="selected-admin-buttons">
        ${buttons.join("")}
      </div>
    </div>
  `;
}

function isArtistFollowed(artistName) {

  const target = normaliseCompare(artistName);

  return followedArtists.some((row) => normaliseCompare(row.artist_name) === target);

}



function renderFollowControls(artistName) {

  if (isArtistFollowed(artistName)) {

    return `

      <div class="following-row">

        <div class="following-badge">Following artist</div>

        <button id="unfollowSelectedArtistBtn" class="unfollow-btn">Unfollow</button>

      </div>

    `;

  }



  return `

    <div class="detail-actions">

      <button id="followSelectedArtistBtn" class="secondary-btn">Follow artist</button>

    </div>

  `;

}



function getSavedAlbumByExternalId(externalId) {

  if (!externalId) return null;

  return allAlbums.find(

    (album) => album.external_source === "musicbrainz" && album.external_id === externalId

  ) || null;

}



function getSavedSongByExternalId(externalId) {

  if (!externalId) return null;

  return allSongs.find(

    (song) => song.external_source === "musicbrainz" && song.external_id === externalId

  ) || null;

}



function getSavedAlbumsByArtist(artistName) {

  return allAlbums.filter((album) => normaliseCompare(album.artist) === normaliseCompare(artistName));

}



function getSavedSongsByArtist(artistName) {

  return allSongs.filter((song) => normaliseCompare(song.artist) === normaliseCompare(artistName));

}



function getAlbumNameById(albumId) {

  const album = allAlbums.find((row) => Number(row.id) === Number(albumId));

  return album ? album.title : "";

}



function getAlbumAverage(albumId) {

  const ratings = allAlbumRatings

    .filter((row) => Number(row.album_id) === Number(albumId))

    .map((row) => Number(row.rating));



  if (ratings.length === 0) return null;



  return {

    avg: ratings.reduce((sum, value) => sum + value, 0) / ratings.length,

    count: ratings.length
 
  };

}



function getSongAverage(songId) {

  const ratings = allSongRatings

    .filter((row) => Number(row.song_id) === Number(songId))

    .map((row) => Number(row.rating));



  if (ratings.length === 0) return null;



  return {

    avg: ratings.reduce((sum, value) => sum + value, 0) / ratings.length,

    count: ratings.length

  };

}

function getLinkedSongAverage(songIds) {
  const ids = songIds.map(Number);

  const ratings = allSongRatings
    .filter((row) => ids.includes(Number(row.song_id)))
    .map((row) => Number(row.rating));

  if (!ratings.length) return null;

  return {
    avg: ratings.reduce((sum, value) => sum + value, 0) / ratings.length,
    count: ratings.length
  };
}


function getYourAlbumRating(albumId) {

  if (!currentUser) return null;

  const row = allAlbumRatings.find(

    (rating) => rating.user_id === currentUser.id && Number(rating.album_id) === Number(albumId)

  );

  return row ? Number(row.rating) : null;

}



function getYourSongRating(songId) {

  if (!currentUser) return null;

  const row = allSongRatings.find(

    (rating) => rating.user_id === currentUser.id && Number(rating.song_id) === Number(songId)

  );

  return row ? Number(row.rating) : null;

}

function getYourSongRatingByTitleArtist(title, artist) {

  if (!currentUser) return null;

  const key = normaliseCompare(`${artist}-${title}`);

  const matchingSongIds = allSongs
    .filter(
      (song) =>
        normaliseCompare(`${song.artist}-${song.title}`) === key
    )
    .map((song) => Number(song.id));

  if (!matchingSongIds.length) return null;

  const row = allSongRatings.find(
    (rating) =>
      rating.user_id === currentUser.id &&
      matchingSongIds.includes(Number(rating.song_id))
  );

  return row ? Number(row.rating) : null;

}

function renderStarSelector(targetId, currentValue = null) {
  const safeValue = currentValue !== null ? Number(currentValue) : 0;

  return `
    <div class="star-rating-block">
  <div class="album-rating-box">
    <div class="star-rating" data-target-input="${targetId}">
        ${Array.from({ length: 10 }, (_, i) => {
          const score = i + 1;
          const activeClass = score <= safeValue ? "active-star" : "";

          return `
            <button
              type="button"
              class="star-option ${activeClass}"
              data-target-input="${targetId}"
              data-rating="${score}"
              onclick="handleStarOptionClick(event, this); return false;"
            >★</button>
          `;
        }).join("")}

        <span class="star-score-text" id="${targetId}-text">
          ${safeValue > 0 ? `${safeValue}/10` : "Not rated"}
        </span>
    </div>
  </div>
</div>
<input type="hidden" id="${targetId}" value="${safeValue > 0 ? safeValue : ""}">
  `;
}



function updateStarSelector(targetId, value) {

  const hiddenInput = document.getElementById(targetId);

  if (hiddenInput) hiddenInput.value = value;



  const text = document.getElementById(`${targetId}-text`);

  if (text) text.textContent = value > 0 ? `${value}/10` : "Not rated";



  const buttons = document.querySelectorAll(`.star-option[data-target-input="${targetId}"]`);

  buttons.forEach((button) => {

    const buttonValue = Number(button.dataset.rating);

    button.classList.toggle("active-star", buttonValue <= value);

  });

}



function upsertLocalAlbumRating(albumId, rating) {

  if (!currentUser) return;



  const existingIndex = allAlbumRatings.findIndex(

    (row) => row.user_id === currentUser.id && Number(row.album_id) === Number(albumId)

  );



  const payload = {

    user_id: currentUser.id,

    album_id: Number(albumId),

    rating: Number(rating)

  };



  if (existingIndex >= 0) {

    allAlbumRatings[existingIndex] = payload;

  } else {

    allAlbumRatings.push(payload);

  }

}

function removeLocalAlbumRating(albumId) {
  if (!currentUser) return;
  allAlbumRatings = allAlbumRatings.filter(
    (row) => !(row.user_id === currentUser.id && Number(row.album_id) === Number(albumId))
  );
}

function updateStageOneAlbumRatingUi(albumId) {
  if (!isStageOnePresentation()) return;
  const target = selectedItemDetail?.querySelector(".bom-v1-album-personal");
  if (target) target.innerHTML = buildCompactAlbumRatingControl(albumId, getYourAlbumRating(albumId));
}



function upsertLocalSongRating(songId, rating) {

  if (!currentUser) return;



  const existingIndex = allSongRatings.findIndex(

    (row) => row.user_id === currentUser.id && Number(row.song_id) === Number(songId)

  );



  const payload = {

    user_id: currentUser.id,

    song_id: Number(songId),

    rating: Number(rating)

  };



  if (existingIndex >= 0) {

    allSongRatings[existingIndex] = payload;

  } else {

    allSongRatings.push(payload);

  }

}



function removeLocalSongRating(songId) {

  if (!currentUser) return;



  allSongRatings = allSongRatings.filter(

    (row) => !(row.user_id === currentUser.id && Number(row.song_id) === Number(songId))

  );

}



function updateTrackRowUi(songId) {

  const row = selectedItemDetail.querySelector(`.track-row-table[data-song-id="${songId}"]`);

  if (!row) return;



  const avgData = getSongAverage(songId);

  const selectedSong = allSongs.find(
  (song) => Number(song.id) === Number(songId)
);

const selectedKey = selectedSong
  ? normaliseCompare(`${selectedSong.artist}-${selectedSong.title}`)
  : "";

const linkedSongIds = selectedSong
  ? allSongs
      .filter((song) => {
        const sameExternalId =
          selectedSong.external_id &&
          song.external_id &&
          song.external_id === selectedSong.external_id;

        const sameTitleArtist =
          normaliseCompare(`${song.artist}-${song.title}`) === selectedKey;

        return sameExternalId || sameTitleArtist;
      })
      .map((song) => Number(song.id))
  : [Number(songId)];

const yourRatingRow = allSongRatings.find((rating) =>
  linkedSongIds.includes(Number(rating.song_id)) &&
  rating.user_id === currentUser?.id
);

const yourRating = yourRatingRow ? Number(yourRatingRow.rating) : null;



  const averageEl = row.querySelector(".track-col-average");

  const yourRatingEl = row.querySelector(".track-col-your-rating");



  if (averageEl) {

    if (isStageOnePresentation()) {
      if (avgData) {
        const count = Number(avgData.count || 0);
        averageEl.innerHTML = `<strong>${avgData.avg.toFixed(1)}</strong><span> / 10</span>`;
        averageEl.title = `${count} community rating${count === 1 ? "" : "s"}`;
        averageEl.setAttribute("aria-label", `${avgData.avg.toFixed(1)} out of 10 from ${count} community rating${count === 1 ? "" : "s"}`);
      } else {
        averageEl.textContent = "—";
        averageEl.removeAttribute("title");
        averageEl.setAttribute("aria-label", "No community ratings");
      }
    } else {
      averageEl.textContent = avgData ? `⭐ ${avgData.avg.toFixed(1)} / 10` : "No ratings";
    }

  }



  if (yourRatingEl) {
    const compactSlot = yourRatingEl.querySelector(".bom-v1-track-rating-slot");
    if (compactSlot) {
      compactSlot.innerHTML = buildCompactTrackRatingControl(songId, yourRating);
    } else {
      yourRatingEl.textContent = yourRating !== null ? `${yourRating}/10` : "—";
    }

    yourRatingEl.classList.toggle("has-rating", yourRating !== null);

  }



  updateStarSelector(`track-rating-${songId}`, yourRating || 0);

}



async function refreshSessionUI() {

  try {

    const {

      data: { session },

      error

    } = await supabaseClient.auth.getSession();



    if (error) {

      currentUser = null;

      setMessage(authMessage, error.message);

    } else {

      currentUser = session ? session.user : null;

    }



    if (passwordRecovery?.reconcileSession(session)) return;

    await ensureUserProfile();

    updateSessionUI();

    renderStageOneDiscoverLoading();

    await loadLibrary();

    renderLibrary();

    renderRecommendations();

    renderAdminDashboard();

    await renderSelectedItem();

    handleScrollState();

  } catch (err) {

    currentUser = null;

    updateSessionUI();

    setMessage(authMessage, "Session error: " + err.message);

    renderStageOneDiscoverError();

  }

}



async function signUp() {
  setMessage(authMessage, "Trying to sign up...");

  const email = emailInput?.value.trim() || "";
  const password = passwordInput?.value.trim() || "";
  const birthYear = Number(birthYearInput?.value || 0);
  const handle = cleanHandle(handleInput?.value || "");
  const currentYear = new Date().getFullYear();

  if (!email || !password) {
    setMessage(authMessage, "Please enter email and password.");
    return;
  }

  if (!birthYear || birthYear < 1900 || birthYear > currentYear) {
    setMessage(authMessage, "Please enter a valid year of birth.");
    return;
  }

  if (!isValidHandle(handle)) {
    setMessage(authMessage, "Handle must be 3-20 characters and only use letters, numbers and underscores.");
    return;
  }

  const { data: existingHandle, error: handleCheckError } = await supabaseClient
    .from("profiles")
    .select("id")
    .eq("handle", handle)
    .maybeSingle();

  if (handleCheckError) {
    setMessage(authMessage, handleCheckError.message);
    return;
  }

  if (existingHandle) {
    setMessage(authMessage, "That handle is already taken.");
    return;
  }

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
        data: {
          handle,
          birth_year: birthYear
        }
      }
    });

    if (error) {
      setMessage(authMessage, error.message);
      return;
    }

    

setMessage(
    authMessage,
    "Account created. Please check your email and click the confirmation link before logging in."
);
  } catch (err) {
    setMessage(authMessage, "Error: " + err.message);
  }
}



async function logIn() {

  setMessage(authMessage, "Trying to log in...");



  const email = emailInput?.value.trim() || "";

  const password = passwordInput?.value.trim() || "";



  if (!email || !password) {

    setMessage(authMessage, "Please enter email and password.");

    return;

  }



  try {

    passwordRecovery?.clear({ notify: false });

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });



    if (error) {

      setMessage(authMessage, error.message);

      return;

    }



    currentUser = data.user || null;

    await ensureUserProfile();

    updateSessionUI();

    await loadLibrary();

    renderLibrary();

    renderRecommendations();

    await renderSelectedItem();

    setMessage(authMessage, "Logged in successfully.");

  } catch (err) {

    setMessage(authMessage, "Error: " + err.message);

  }

}



async function logOut() {

  try {

    passwordRecovery?.clear({ notify: false });

    const { error } = await supabaseClient.auth.signOut();



    if (error) {

      setMessage(authMessage, error.message);

      return;

    }



    currentUser = null;

    updateSessionUI();

    setMessage(authMessage, "Logged out.");

    await loadLibrary();

    renderLibrary();

    renderRecommendations();

    await renderSelectedItem();

  } catch (err) {

    setMessage(authMessage, "Error: " + err.message);

  }

}

async function resetPassword() {
  const email = emailInput?.value.trim() || "";

  if (!email) {
    setMessage(authMessage, "Enter your email address first, then tap Forgot password.");
    return;
  }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });

  if (error) {
    setMessage(authMessage, error.message);
    return;
  }

  setMessage(authMessage, "Password reset email sent. Please check your inbox.");
}

passwordRecovery = window.BOMPasswordRecovery?.create({
  auth: supabaseClient.auth,
  document,
  window,
  onExit: () => refreshSessionUI()
}) || null;

async function fetchAllRows(tableName, orderColumn = "id", columns = "*") {
  let allRows = [];
  let from = 0;
  const size = 1000;

  while (true) {
    let query = supabaseClient
      .from(tableName)
      .select(columns)
      .order(orderColumn, { ascending: true });

    if (orderColumn !== "id") query = query.order("id", { ascending: true });

    const { data, error } = await query.range(from, from + size - 1);

    if (error) {
      console.error(`${tableName} load error`, error);
      throw error;
    }

    allRows = allRows.concat(data || []);

    if (!data || data.length < size) break;

    from += size;
  }

  return allRows;
}


async function loadLibrary() {

  const albums = await fetchAllRows("albums", "title");
	
	const songs = await fetchAllRows("songs", "id");
allSongs = songs;




  const albumRatings = await fetchAllRows(
    "ratings",
    "id",
    "user_id, album_id, rating"
  );



  const songRatings = await fetchAllRows(
    "song_ratings",
    "id",
    "user_id, song_id, rating"
  );



  const followed = await fetchAllRows(
    "followed_artists",
    "artist_name",
    "artist_name"
  );



  allAlbums = albums || [];

  allSongs = songs || [];

  allAlbumRatings = albumRatings || [];

  allSongRatings = songRatings || [];

  followedArtists = followed || [];

}



async function followArtistByName(artistName) {

  const cleanName = normaliseText(artistName);



  if (!cleanName) {

    setMessage(followArtistMessage, "Please enter an artist name.");

    return false;

  }



  const { error } = await supabaseClient

    .from("followed_artists")

    .upsert([{ artist_name: cleanName }], { onConflict: "artist_name" });



  if (error) {

    setMessage(followArtistMessage, error.message);

    return false;

  }



  await loadLibrary();

  setMessage(followArtistMessage, `"${cleanName}" followed.`);

  return true;

}



async function unfollowArtistByName(artistName) {

  const cleanName = normaliseText(artistName);

  if (!cleanName) return false;



  const { error } = await supabaseClient

    .from("followed_artists")

    .delete()

    .eq("artist_name", cleanName);



  if (error) {

    setMessage(followArtistMessage, error.message);

    return false;

  }



  await loadLibrary();

  setMessage(followArtistMessage, `"${cleanName}" unfollowed.`);

  return true;

}

async function saveManualArtistHero(file) {
  if (!currentUser || !isAdmin || selectedItem?.type !== "artist") return { ok: false, message: "Admin access is required." };
  const validationMessage = validateArtistHeroFile(file);
  if (validationMessage) return { ok: false, message: validationMessage };
  const artistName = selectedItem.name || selectedItem.artist || selectedItem.title || "";
  const artistKey = getArtistHeroKey(artistName);
  if (!artistKey) return { ok: false, message: "The artist could not be identified." };
  let dimensions;
  try {
    dimensions = await readArtistHeroDimensions(file);
  } catch (error) {
    return { ok: false, message: error?.message || "The selected image could not be read." };
  }
  if (dimensions.width < 800 || dimensions.height < 300) {
    return { ok: false, message: "Choose an image at least 800 × 300 pixels." };
  }
  const existing = await loadManualArtistHero(artistName);
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
  const safeArtist = normaliseCompare(artistName).slice(0, 80) || "artist";
  const uniqueId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const storagePath = `${safeArtist}/${Date.now()}-${uniqueId}.${extension}`;
  const { error: uploadError } = await supabaseClient.storage
    .from(ARTIST_HERO_BUCKET)
    .upload(storagePath, file, { cacheControl: "31536000", contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, message: uploadError.message || "The image could not be uploaded." };
  const payload = {
    artist_key: artistKey,
    artist_name: artistName,
    musicbrainz_artist_id: selectedItem.externalId || selectedItem.artistId || null,
    storage_path: storagePath,
    mime_type: file.type,
    width: dimensions.width,
    height: dimensions.height,
    uploaded_by: currentUser.id,
    updated_at: new Date().toISOString()
  };
  const { error: saveError } = await supabaseClient
    .from("artist_hero_overrides")
    .upsert(payload, { onConflict: "artist_key" });
  if (saveError) {
    await supabaseClient.storage.from(ARTIST_HERO_BUCKET).remove([storagePath]);
    return { ok: false, message: saveError.message || "The artist hero could not be saved." };
  }
  if (existing?.storage_path && existing.storage_path !== storagePath) {
    const { error: cleanupError } = await supabaseClient.storage.from(ARTIST_HERO_BUCKET).remove([existing.storage_path]);
    if (cleanupError) console.warn("Previous artist hero could not be removed", cleanupError);
  }
  clearAutomaticArtistImageCache(artistName, payload.musicbrainz_artist_id || "");
  await renderSelectedItem();
  return { ok: true, message: "Artist hero saved." };
}

async function removeManualArtistHero() {
  if (!currentUser || !isAdmin || selectedItem?.type !== "artist") return { ok: false, message: "Admin access is required." };
  const artistName = selectedItem.name || selectedItem.artist || selectedItem.title || "";
  const existing = await loadManualArtistHero(artistName);
  if (!existing) return { ok: true, message: "Automatic artist image restored." };
  const { error } = await supabaseClient.from("artist_hero_overrides").delete().eq("artist_key", existing.artist_key);
  if (error) return { ok: false, message: error.message || "The artist hero could not be removed." };
  const { error: storageError } = await supabaseClient.storage.from(ARTIST_HERO_BUCKET).remove([existing.storage_path]);
  if (storageError) console.warn("Removed artist hero object could not be cleaned up", storageError);
  clearAutomaticArtistImageCache(artistName, existing.musicbrainz_artist_id || selectedItem.externalId || "");
  await renderSelectedItem();
  return { ok: true, message: "Automatic artist image restored." };
}

window.BOMArtistBridge = Object.freeze({
  async setFollowing(shouldFollow) {
    if (selectedItem?.type !== "artist") return false;
    const artistName = selectedItem.name || selectedItem.artist || selectedItem.title || "";
    const changed = shouldFollow
      ? await followArtistByName(artistName)
      : await unfollowArtistByName(artistName);
    if (changed && selectedItem?.type === "artist") await renderSelectedItem();
    return changed;
  },
  saveHero: (file) => saveManualArtistHero(file),
  removeHero: () => removeManualArtistHero()
});



async function followArtistFromInput() {

  const artistName = normaliseText(followArtistInput?.value);



  if (!artistName) {

    setMessage(followArtistMessage, "Enter an artist name.");

    return;

  }



  const existing = followedArtists.find(

    (row) => normaliseCompare(row.artist_name || row.name) === normaliseCompare(artistName)

  );



  if (existing) {

    setMessage(followArtistMessage, "Already following.");

    return;

  }



  followedArtists.push({ artist_name: artistName });

  setMessage(followArtistMessage, `Following ${artistName}.`);



  if (followArtistInput) {

    followArtistInput.value = "";

  }

}





function renderLoadingSkeleton(targetEl, type = "list") {

  if (!targetEl) return;



  if (type === "detail") {
    targetEl.innerHTML = `

      <div class="detail-panel">

        ${buildSelectedBackButton()}

        <div class="detail-hero">

          <div class="skeleton skeleton-large"></div>

          <div>

            <div class="skeleton skeleton-line" style="width:60%;height:24px;"></div>

            <div class="skeleton skeleton-line" style="width:40%;"></div>

            <div class="skeleton skeleton-line" style="width:80%;"></div>

            <div class="skeleton skeleton-line" style="width:72%;"></div>

          </div>

        </div>

      </div>

    `;

    return;

  }



  targetEl.innerHTML = `

    <div class="result-item">

      <div class="media-row">

        <div class="skeleton skeleton-cover"></div>

        <div>

          <div class="skeleton skeleton-line" style="width:180px;"></div>

          <div class="skeleton skeleton-line" style="width:120px;"></div>

        </div>

      </div>

    </div>

    <div class="result-item">

      <div class="media-row">

        <div class="skeleton skeleton-cover"></div>

        <div>

          <div class="skeleton skeleton-line" style="width:200px;"></div>

          <div class="skeleton skeleton-line" style="width:140px;"></div>

        </div>

      </div>

    </div>

  `;

}



function renderPosterCard(item, options = {}) {

  const type = options.type || "album";

  const idAttr =

    type === "song"

      ? `data-library-type="song" data-song-id="${item.id}"`

      : `data-library-type="album" data-album-id="${item.id}"`;



  const coverUrl =

    type === "song"

      ? options.coverUrl || ""

      : getAlbumArtworkUrl(item);



  return `

    <div class="poster-card" ${options.wrapperAttrs || idAttr}>

      ${getPosterCoverMarkup(coverUrl, `${item.title} cover`)}

      <div class="poster-body">

        <div class="poster-title">${escapeHtml(item.title)}</div>

        <div class="poster-subtitle">${escapeHtml(item.artist || "")}</div>

        ${options.meta ? `<div class="poster-meta">${options.meta}</div>` : ""}

        ${options.extra || ""}

        ${options.showInlineAlbumRating ? `

          <div class="poster-inline-rating">

            ${renderStarSelector(`album-rating-${item.id}`, getYourAlbumRating(item.id))}

          </div>

        ` : ""}

      </div>

    </div>

  `;

}



function getAlbumTrackCount(albumId) {

  return allSongs.filter((song) => Number(song.album_id) === Number(albumId)).length;

}



function isLikelyStudioAlbum(album) {

  if (!album || album.is_deleted) return false;

  const title = normaliseCompare(album.title);

  const badTitleBits = [
    " single", " ep", "remix", "karaoke", "instrumental", "acoustic",
    "live", "demo", "edit", "radio edit", "session", "sessions",
    "best of", "greatest hits", "collection", "compilation", "anthology",
    "now that's what", "now thats what", "soundtrack", "tribute"
  ];

  const hasBadTitle = badTitleBits.some((bit) => title.includes(bit) || title.endsWith(bit.trim()));

  if (hasBadTitle) return false;

  const trackCount = getAlbumTrackCount(album.id);

  if (trackCount >= 7) return true;

  // v26: do not treat zero-track items as studio albums. This stops singles,
  // EPs and loose MusicBrainz releases appearing as album recommendations.
  return false;

}



function buildHorizontalCarousel(itemsHtml, extraClass = "") {

  const carouselId = `carousel-${Math.random().toString(36).slice(2)}`;

  return `
    <div class="bom-carousel-shell ${extraClass}-shell">
      <button class="carousel-arrow carousel-arrow-left" type="button" data-carousel-target="${carouselId}" data-carousel-dir="left" aria-label="Scroll left">‹</button>
      <div id="${carouselId}" class="bom-carousel ${extraClass}" tabindex="0">
        ${itemsHtml}
      </div>
      <button class="carousel-arrow carousel-arrow-right" type="button" data-carousel-target="${carouselId}" data-carousel-dir="right" aria-label="Scroll right">›</button>
    </div>
  `;

}

function getTopRatedSongsByArtist(artistName, limit = 6) {

  const target = normaliseCompare(artistName);

  return allSongs
    .filter((song) => normaliseCompare(song.artist) === target)
    .map((song) => {
      const avg = getSongAverage(song.id);
      const linkedAlbum = song.album_id ? allAlbums.find((album) => Number(album.id) === Number(song.album_id)) : null;
      return { ...song, avgScore: avg ? avg.avg : 0, ratingCount: avg ? avg.count : 0, linkedAlbum };
    })
    .filter((song) => song.avgScore > 0)
    .sort((a, b) => {
      if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
      return b.ratingCount - a.ratingCount;
    })
    .slice(0, limit);

}

async function fetchSimilarArtistsRemote(artistName, limit = 8) {

  if (!LASTFM_API_KEY || !artistName) return [];

  try {

    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(artistName)}&api_key=${encodeURIComponent(LASTFM_API_KEY)}&format=json&limit=${limit}`;

    const response = await fetch(url);

    if (!response.ok) return [];

    const data = await response.json();

    return (data?.similarartists?.artist || [])
      .map((artist) => ({
        name: artist.name || "",
        image: ([...(artist.image || [])].reverse().find((img) => img["#text"]) || {})["#text"] || ""
      }))
      .filter((artist) => artist.name);

  } catch {

    return [];

  }

}



function getSimilarArtistsLocal(artistName, limit = 8) {

  const target = normaliseCompare(artistName);

  const ratedArtistScores = new Map();

  allAlbumRatings
    .filter((row) => !currentUser || row.user_id === currentUser.id)
    .forEach((row) => {
      const album = allAlbums.find((item) => Number(item.id) === Number(row.album_id));
      if (!album || normaliseCompare(album.artist) === target) return;
      const artistKey = normaliseText(album.artist);
      const previous = ratedArtistScores.get(artistKey) || { name: artistKey, score: 0, count: 0, cover: "" };
      previous.score += Number(row.rating || 0);
      previous.count += 1;
      previous.cover = previous.cover || getAlbumArtworkUrl(album);
      ratedArtistScores.set(artistKey, previous);
    });

  return [...ratedArtistScores.values()]
    .map((artist) => ({ ...artist, avg: artist.count ? artist.score / artist.count : 0 }))
    .filter((artist) => artist.avg >= 7)
    .sort((a, b) => b.avg - a.avg || b.count - a.count)
    .slice(0, limit)
    .map((artist) => ({ name: artist.name, image: artist.cover }));

}



async function buildSimilarArtistsSection(artistName) {

  const cleanArtist = normaliseText(artistName);

  if (!cleanArtist) return "";

  let similarArtists = await fetchSimilarArtistsRemote(cleanArtist, 8);

  if (!similarArtists.length) similarArtists = getSimilarArtistsLocal(cleanArtist, 8);

  similarArtists = similarArtists
    .filter((artist) => normaliseCompare(artist.name) !== normaliseCompare(cleanArtist))
    .slice(0, 8);

  if (!similarArtists.length) return "";

  const cards = similarArtists.map((artist, index) => `
    <div class="similar-artist-card" data-similar-artist-index="${index}">
      ${artist.image ? `<img src="${escapeHtml(artist.image)}" alt="" aria-label="${escapeHtml(artist.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : `<div class="similar-artist-avatar">${escapeHtml(artist.name.slice(0, 1).toUpperCase())}</div>`}
      <div class="similar-artist-name">${escapeHtml(artist.name)}</div>
    </div>
  `).join("");

  selectedItemDetail.dataset.similarArtists = JSON.stringify(similarArtists);

  return `
    <div class="section-divider">Similar artists</div>
    ${buildHorizontalCarousel(cards, "similar-artists-carousel")}
  `;

}





function getSelectedArtistIdFallback(artistName = "") {
  if (selectedItem?.artistId) return selectedItem.artistId;
  if (selectedItem?.type === "artist" && selectedItem?.externalId) return selectedItem.externalId;
  const cleanArtist = normaliseCompare(artistName || selectedItem?.artist || selectedItem?.name || "");
  if (!cleanArtist) return "";
  const matchedAlbum = allAlbums.find((album) => normaliseCompare(album.artist) === cleanArtist && album.artist_id);
  if (matchedAlbum?.artist_id) return matchedAlbum.artist_id;
  return "";
}

function buildSelectedBackButton() {
  const label = previousSectionId === "librarySection" ? "Back to ratings" : previousSectionId === "adminSection" ? "Back to admin" : "Back to search";
  return `
    <button type="button" class="selected-back-btn" data-back-to-previous="true">
      ← ${escapeHtml(label)}
    </button>
  `;
}

async function buildMoreFromArtistSection(artistName, currentAlbumId = null) {

  const cleanArtist = normaliseText(artistName);
  if (!cleanArtist) return "";

  const selectedArtistId = getSelectedArtistIdFallback(cleanArtist) || await resolveArtistIdByName(cleanArtist);

  let remoteStudioAlbums = [];
  if (selectedArtistId) {
    remoteStudioAlbums = await fetchStudioAlbumsForArtist(selectedArtistId, cleanArtist);
  }

  const savedStudioAlbums = allAlbums
    .filter((album) =>
      normaliseCompare(album.artist) === normaliseCompare(cleanArtist) &&
      Number(album.id) !== Number(currentAlbumId) &&
      isLikelyStudioAlbum(album)
    )
    .map((album) => ({
      type: "album",
      title: album.title,
      artist: album.artist,
      externalId: album.external_id || "",
      releaseGroupId: album.release_group_id || album.releaseGroupId || "",
      artistId: selectedArtistId || album.artist_id || "",
      releaseDate: album.release_date || "",
      coverUrl: getAlbumArtworkUrl(album),
      savedAlbumId: album.id,
      localAlbumId: album.id
    }));

  const seenAlbums = new Set();
  const studioAlbums = [...savedStudioAlbums, ...remoteStudioAlbums]
    .filter((album) => {
      const key = normaliseCompare(`${album.artist} ${album.title}`);
      if (!key || seenAlbums.has(key)) return false;
      seenAlbums.add(key);
      if (currentAlbumId && album.localAlbumId && Number(album.localAlbumId) === Number(currentAlbumId)) return false;
      if (selectedItem?.title && normaliseCompare(album.title) === normaliseCompare(selectedItem.title)) return false;
      return true;
    })
    .sort((a, b) => String(a.releaseDate || "9999").localeCompare(String(b.releaseDate || "9999")))
    .slice(0, 18);

  selectedItemDetail.dataset.artistAlbums = JSON.stringify(studioAlbums);

  const topSongs = getTopRatedSongsByArtist(cleanArtist, 10);

  const albumsHtml = studioAlbums.length
    ? buildHorizontalCarousel(studioAlbums.map((album, index) => renderPosterCard(album, {
        type: "album",
        meta: album.releaseDate ? escapeHtml(album.releaseDate) : "Studio album",
        wrapperAttrs: `data-artist-album-index="${index}" data-remote-studio-album="true"`
      })).join(""), "studio-albums-carousel")
    : `<p class="small">No studio albums found for this artist yet.</p>`;

  const topSongsHtml = topSongs.length
    ? buildHorizontalCarousel(topSongs.map((song) => renderPosterCard(song, { type: "song", coverUrl: song.linkedAlbum ? getAlbumArtworkUrl(song.linkedAlbum) : "", meta: `⭐ ${song.avgScore.toFixed(1)} / 10 (${song.ratingCount} rating${song.ratingCount === 1 ? "" : "s"})`, wrapperAttrs: `data-library-type="song" data-song-id="${song.id}"` })).join(""), "top-songs-carousel")
    : `<p class="small">No rated songs by this artist yet.</p>`;

  const similarHtml = await buildSimilarArtistsSection(cleanArtist);

  return `
    <div class="related-music-panel">
      <div class="section-divider">More studio albums from ${escapeHtml(cleanArtist)}</div>
      ${albumsHtml}
      <div class="section-divider">Top rated songs by ${escapeHtml(cleanArtist)}</div>
      ${topSongsHtml}
      ${similarHtml}
    </div>
  `;

}




function getSelectedCoverUrl(item = selectedItem) {

  if (!item) return "";

  if (item.type === "album") {
    const saved = item.savedAlbumId
      ? allAlbums.find((album) => Number(album.id) === Number(item.savedAlbumId))
      : getSavedAlbumByExternalId(item.externalId);
    return getAlbumArtworkUrl(saved) || item.coverUrl || "";
  }

  if (item.type === "song") {
    const saved = item.savedSongId
      ? allSongs.find((song) => Number(song.id) === Number(item.savedSongId))
      : getSavedSongByExternalId(item.externalId);
    const album = saved?.album_id ? allAlbums.find((row) => Number(row.id) === Number(saved.album_id)) : null;
    return getAlbumArtworkUrl(album) || item.coverUrl || "";
  }

  return item.coverUrl || "";

}

function updateStickyPlayer(item = selectedItem) {

  const player = document.getElementById("stickyPlayer");
  if (!player) return;

  if (!item) {
    player.classList.add("hidden");
    return;
  }

  const titleEl = document.getElementById("stickyPlayerTitle");
  const artistEl = document.getElementById("stickyPlayerArtist");
  const coverEl = document.getElementById("stickyPlayerCover");

  const title = item.title || item.name || "Selected item";
  const artist = item.artist || item.name || "Bank of Music";
  const cover = getSelectedCoverUrl(item);

  if (titleEl) titleEl.textContent = title;
  if (artistEl) artistEl.textContent = artist;
  if (coverEl) {
    coverEl.innerHTML = cover
      ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
      : `<span>${escapeHtml((title || "B").slice(0, 1).toUpperCase())}</span>`;
  }

  player.classList.remove("hidden");

}

function buildShareUrl(item = selectedItem) {

  if (!item) return window.location.href;

  const url = new URL(window.location.href);
  url.searchParams.set("share", item.type || "item");
  if (item.externalId) url.searchParams.set("id", item.externalId);
  if (item.savedAlbumId) url.searchParams.set("albumId", item.savedAlbumId);
  if (item.savedSongId) url.searchParams.set("songId", item.savedSongId);
  url.searchParams.set("title", item.title || item.name || "");
  url.searchParams.set("artist", item.artist || item.name || "");
  if (item.releaseDate) url.searchParams.set("date", item.releaseDate);
  if (item.coverUrl) url.searchParams.set("cover", item.coverUrl);
  return url.toString();

}

async function shareSelectedItem() {

  if (!selectedItem) {
    setMessage(globalSearchMessage, "Select an album or song first.");
    return;
  }

  const title = selectedItem.title || selectedItem.name || "this music";
  const artist = selectedItem.artist || selectedItem.name || "Bank of Music";
  const shareUrl = getItemDeepLinkUrl(selectedItem);
  const shareTitle = `Rate ${title} on Bank of Music`;
  const shareText = `I think you should rate ${title} by ${artist} on Bank of Music.`;

  try {
    if (navigator.share) {
      await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      setMessage(globalSearchMessage, "Share link copied.");
    } else {
      prompt("Copy this link to send to a friend:", shareUrl);
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      setMessage(globalSearchMessage, "Could not share this item.");
    }
  }

}

async function handleIncomingShareLink() {

  const params = new URLSearchParams(window.location.search);
  const shareType = params.get("share");
  if (!shareType) return;

  const title = params.get("title") || "Shared item";
  const artist = params.get("artist") || "Unknown artist";
  const externalId = params.get("id") || "";

  if (shareType === "album") {
    selectedItem = {
      type: "album",
      title,
      artist,
      externalId,
      releaseDate: params.get("date") || "",
      coverUrl: params.get("cover") || "",
      savedAlbumId: params.get("albumId") || ""
    };
  } else if (shareType === "song") {
    selectedItem = {
      type: "song",
      title,
      artist,
      externalId,
      releaseTitle: params.get("release") || "",
      coverUrl: params.get("cover") || "",
      savedSongId: params.get("songId") || ""
    };
  } else if (shareType === "artist") {
    selectedItem = {
      type: "artist",
      title: artist,
      name: artist,
      artist,
      externalId,
      artistId: externalId
    };
  } else {
    return;
  }

  showOnlySection("detailSection");
  await renderSelectedItem();

}

function activateCarousels(root = document) {

  const carousels = root.querySelectorAll?.(".bom-carousel") || [];

  carousels.forEach((carousel) => {
    if (carousel.dataset.swipeReady === "true") return;
    carousel.dataset.swipeReady = "true";

    let isDown = false;
    let startX = 0;
    let startScrollLeft = 0;

    carousel.addEventListener("pointerdown", (event) => {
      isDown = true;
      carousel.classList.add("is-dragging");
      startX = event.clientX;
      startScrollLeft = carousel.scrollLeft;
      carousel.setPointerCapture?.(event.pointerId);
    });

    carousel.addEventListener("pointermove", (event) => {
      if (!isDown) return;
      const walk = event.clientX - startX;
      carousel.scrollLeft = startScrollLeft - walk;
    });

    ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
      carousel.addEventListener(eventName, () => {
        isDown = false;
        carousel.classList.remove("is-dragging");
      });
    });
  });

}

function scrollCarouselByButton(button) {

  const targetId = button?.dataset?.carouselTarget;
  const dir = button?.dataset?.carouselDir === "left" ? -1 : 1;
  const carousel = targetId ? document.getElementById(targetId) : null;
  if (!carousel) return;
  const amount = Math.max(260, carousel.clientWidth * 0.82);
  carousel.scrollBy({ left: amount * dir, behavior: "smooth" });

}

function buildSmartRecommendationHtml() {

  if (!currentUser) return "";
  const ratedAlbumIds = new Set(allAlbumRatings.filter((row) => row.user_id === currentUser.id).map((row) => Number(row.album_id)));
  const highRatedAlbums = allAlbumRatings
    .filter((row) => row.user_id === currentUser.id && Number(row.rating) >= 8)
    .map((row) => { const album = allAlbums.find((item) => Number(item.id) === Number(row.album_id)); return album ? { album, rating: Number(row.rating) } : null; })
    .filter(Boolean)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 3);

  const sections = [];
  highRatedAlbums.forEach((ratedItem) => {
    const recommendations = allAlbums
      .filter((album) => normaliseCompare(album.artist) === normaliseCompare(ratedItem.album.artist) && !ratedAlbumIds.has(Number(album.id)) && Number(album.id) !== Number(ratedItem.album.id) && isLikelyStudioAlbum(album))
      .slice(0, 4);
    if (!recommendations.length) return;
    sections.push(`<div class="smart-recommendation-block"><div class="smart-recommendation-heading">Because you rated <strong>${escapeHtml(ratedItem.album.title)}</strong> ${ratedItem.rating}/10</div>${buildHorizontalCarousel(recommendations.map((album) => renderPosterCard(album, { type: "album", meta: `${getAlbumTrackCount(album.id)} tracks`, wrapperAttrs: `data-library-type="album" data-album-id="${album.id}"` })).join(""), "recommendation-carousel")}</div>`);
  });
  return sections.join("");

}

function getStageOneDiscoverYear(album) {
  const value = album?.original_release_date || album?.release_date || "";
  const precision = album?.original_release_date_precision || album?.release_date_precision || "stored";
  const label = window.BOMAlbumUI?.formatReleaseDate
    ? window.BOMAlbumUI.formatReleaseDate(value, precision)
    : String(value || "");
  return label.match(/\b\d{4}\b/)?.[0] || "";
}

function buildStageOneDiscoverAlbum(album) {
  const average = getAlbumAverage(album.id);
  return {
    id: album.id,
    title: album.title || "Untitled album",
    artist: album.artist || "",
    artworkUrl: getAlbumArtworkUrl(album),
    year: getStageOneDiscoverYear(album),
    community: average ? { average: Number(average.avg), count: Number(average.count || 0) } : null
  };
}

function buildStageOneRatedRecommendationGroups(highRatedAlbums, ratedAlbumIds, albums = allAlbums, maxGroups = 3) {
  const displayedAlbumIds = new Set();
  const groups = [];
  for (const ratedItem of highRatedAlbums) {
    const recommendations = albums
      .filter((album) => normaliseCompare(album.artist) === normaliseCompare(ratedItem.album.artist) && !ratedAlbumIds.has(Number(album.id)) && Number(album.id) !== Number(ratedItem.album.id) && !displayedAlbumIds.has(Number(album.id)) && isLikelyStudioAlbum(album))
      .slice(0, 4);
    if (!recommendations.length) continue;
    recommendations.forEach((album) => displayedAlbumIds.add(Number(album.id)));
    groups.push({
      key: `${ratedItem.album.id}-${groups.length}`,
      reason: { title: ratedItem.album.title, rating: ratedItem.rating },
      albums: recommendations.map(buildStageOneDiscoverAlbum)
    });
    if (groups.length >= maxGroups) break;
  }
  return groups;
}

function buildStageOneNextListenAlbums(highRatedAlbums, ratedAlbumIds, albums = allAlbums, limit = 8) {
  const affinityByArtist = new Map();
  highRatedAlbums.forEach((ratedItem) => {
    const artistKey = normaliseCompare(ratedItem.album.artist);
    if (!artistKey) return;
    affinityByArtist.set(artistKey, Math.max(affinityByArtist.get(artistKey) || 0, Number(ratedItem.rating) || 0));
  });

  const candidates = albums
    .filter((album) => !ratedAlbumIds.has(Number(album.id)) && isLikelyStudioAlbum(album))
    .sort((a, b) => {
      const affinityDifference = (affinityByArtist.get(normaliseCompare(b.artist)) || 0) - (affinityByArtist.get(normaliseCompare(a.artist)) || 0);
      if (affinityDifference) return affinityDifference;
      return getAlbumTrackCount(Number(b.id)) - getAlbumTrackCount(Number(a.id));
    });

  const seenArtists = new Set();
  const recommendations = [];
  for (const album of candidates) {
    const artistKey = normaliseCompare(album.artist);
    if (!artistKey || seenArtists.has(artistKey)) continue;
    seenArtists.add(artistKey);
    recommendations.push(buildStageOneDiscoverAlbum(album));
    if (recommendations.length >= limit) break;
  }
  return recommendations;
}

function buildStageOneDiscoverModel() {
  const userRatings = currentUser
    ? allAlbumRatings.filter((row) => row.user_id === currentUser.id)
    : [];
  const ratedAlbumIds = new Set(userRatings.map((row) => Number(row.album_id)));
  const highRatedAlbums = userRatings
    .filter((row) => Number(row.rating) >= 8)
    .map((row) => {
      const album = allAlbums.find((item) => Number(item.id) === Number(row.album_id));
      return album ? { album, rating: Number(row.rating) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.rating - a.rating);

  const groups = buildStageOneRatedRecommendationGroups(highRatedAlbums, ratedAlbumIds);

  const general = buildStageOneNextListenAlbums(highRatedAlbums, ratedAlbumIds);

  return { authenticated: Boolean(currentUser), groups, general };
}

function renderStageOneDiscoverLoading() {
  if (!isStageOnePresentation() || !window.BOMDiscoverUI || !recommendationsList) return;
  recommendationsList.innerHTML = window.BOMDiscoverUI.renderLoading();
}

function renderStageOneDiscoverError() {
  if (!isStageOnePresentation() || !window.BOMDiscoverUI || !recommendationsList) return;
  recommendationsList.innerHTML = window.BOMDiscoverUI.renderError();
}

function renderRecommendations() {

  if (!recommendationsList) return;
  if (isStageOnePresentation() && window.BOMDiscoverUI) {
    recommendationsList.innerHTML = window.BOMDiscoverUI.render(buildStageOneDiscoverModel());
    window.requestAnimationFrame(() => window.BOMDiscoverUI.updateRowControls(recommendationsList));
    return;
  }
  if (!currentUser) {
    recommendationsList.innerHTML = `<p class="poster-empty">Log in to get recommendations.</p>`;
    return;
  }

  const ratedAlbumIds = new Set(allAlbumRatings.filter((row) => row.user_id === currentUser.id).map((row) => Number(row.album_id)));
  const smartHtml = buildSmartRecommendationHtml();
  const recommendedAlbums = allAlbums
    .filter((album) => {
      const albumId = Number(album.id);
      return !ratedAlbumIds.has(albumId) && isLikelyStudioAlbum(album);
    })
    .sort((a, b) => getAlbumTrackCount(Number(b.id)) - getAlbumTrackCount(Number(a.id)))
    .slice(0, 8);

  const generalHtml = recommendedAlbums.length
    ? `<div class="section-divider">Albums to rate next</div>${buildHorizontalCarousel(recommendedAlbums.map((album) => renderPosterCard(album, { type: "album", meta: `${getAlbumTrackCount(album.id)} tracks`, wrapperAttrs: `data-library-type="album" data-album-id="${album.id}"` })).join(""), "recommendation-carousel")}`
    : `<p class="poster-empty">No album recommendations yet.</p>`;

  recommendationsList.innerHTML = `${smartHtml}${generalHtml}`;
  requestAnimationFrame(() => activateCarousels(recommendationsList));

}

function renderLibrary() {

  if (isStageOnePresentation() && window.BOMRatingsUI) {
    const root = document.getElementById("librarySection");
    if (root) root.innerHTML = window.BOMRatingsUI.render(buildStageOneRatingsModel());
    return;
  }

  const ratedAlbumIds = currentUser

    ? allAlbumRatings.filter((row) => row.user_id === currentUser.id).map((row) => Number(row.album_id))

    : [];

  const ratedSongIds = currentUser

    ? allSongRatings.filter((row) => row.user_id === currentUser.id).map((row) => Number(row.song_id))

    : [];



  const ratedAlbums = allAlbums.filter((album) => ratedAlbumIds.includes(Number(album.id)));

  const ratedSongs = allSongs.filter((song) => ratedSongIds.includes(Number(song.id)));



  if (albumsList) {

    albumsList.innerHTML = ratedAlbums.length

      ? ratedAlbums.map((album) => {

          const avgData = getAlbumAverage(album.id);

          const yourRating = getYourAlbumRating(album.id);

          return renderPosterCard(album, {

            type: "album",

            meta: avgData

              ? `⭐ ${avgData.avg.toFixed(1)} / 10 (${avgData.count} rating${avgData.count === 1 ? "" : "s"})`

              : "No ratings yet",

            extra: yourRating !== null ? `<div class="poster-your-rating">Your rating: ${yourRating}/10</div>` : ""

          });

        }).join("")

      : `<p class="poster-empty">No rated albums yet.</p>`;

  }



  if (songsList) {

    songsList.innerHTML = ratedSongs.length

      ? ratedSongs.map((song) => {
          const avgData = getSongAverage(song.id);

const yourRating =
  getYourSongRating(song.id) ??
  getYourSongRatingByTitleArtist(song.title, song.artist);

          const albumName = song.album_id ? getAlbumNameById(song.album_id) : "";

          const albumCover = song.album_id

            ? getAlbumArtworkUrl(allAlbums.find((album) => Number(album.id) === Number(song.album_id)))

            : "";



          return renderPosterCard(song, {

            type: "song",

            coverUrl: albumCover,

            meta: [

              albumName ? `Album: ${escapeHtml(albumName)}` : "",

              avgData ? `⭐ ${avgData.avg.toFixed(1)} / 10 (${avgData.count} rating${avgData.count === 1 ? "" : "s"})` : "No ratings yet"

            ].filter(Boolean).join("<br>"),

            extra: yourRating !== null ? `<div class="poster-your-rating">Your rating: ${yourRating}/10</div>` : ""

          });

        }).join("")

      : `<p class="poster-empty">No rated songs yet.</p>`;

  }

}

function buildStageOneRatingsModel() {
  const ownAlbumRatings = currentUser ? allAlbumRatings.filter((row) => row.user_id === currentUser.id) : [];
  const ownTrackRatings = currentUser ? allSongRatings.filter((row) => row.user_id === currentUser.id) : [];
  const albums = ownAlbumRatings.map((ratingRow) => {
    const album = allAlbums.find((item) => Number(item.id) === Number(ratingRow.album_id));
    if (!album) return null;
    const community = getAlbumAverage(album.id);
    return {
      id: album.id,
      title: album.title || "Untitled album",
      artist: album.artist || "Unknown artist",
      year: String(album.release_date || "").match(/\b\d{4}\b/)?.[0] || "",
      artworkUrl: getAlbumArtworkUrl(album),
      personal: Number(ratingRow.rating),
      community: community ? { average: community.avg, count: community.count } : null
    };
  }).filter(Boolean);
  const tracks = ownTrackRatings.map((ratingRow) => {
    const track = allSongs.find((item) => Number(item.id) === Number(ratingRow.song_id));
    if (!track) return null;
    const album = allAlbums.find((item) => Number(item.id) === Number(track.album_id));
    const community = getSongAverage(track.id);
    return {
      id: track.id,
      title: track.title || "Untitled track",
      artist: track.artist || album?.artist || "Unknown artist",
      albumId: album?.id || null,
      albumTitle: album?.title || "",
      year: String(album?.release_date || "").match(/\b\d{4}\b/)?.[0] || "",
      artworkUrl: album ? getAlbumArtworkUrl(album) : "",
      personal: Number(ratingRow.rating),
      community: community ? { average: community.avg, count: community.count } : null
    };
  }).filter(Boolean);
  return { authenticated: Boolean(currentUser), albums, tracks };
}

async function openStageOneRatingsAlbum(albumId) {
  const album = allAlbums.find((row) => Number(row.id) === Number(albumId));
  if (!album) return;
  selectedItem = { type: "album", title: album.title, artist: album.artist, externalId: album.external_id || "", releaseDate: album.release_date || "", coverUrl: getAlbumArtworkUrl(album), savedAlbumId: album.id, albumId: album.id };
  showOnlySection("detailSection");
  await renderSelectedItem();
}



async function searchArtistsFromApi(term) {

  const url = `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(term)}&fmt=json&limit=8`;

  const response = await fetch(url, { headers: { Accept: "application/json" } });

  if (!response.ok) throw new Error(`Artist API request failed: ${response.status}`);

  const result = await response.json();

  return (result.artists || []).map((artist) => ({

    type: "artist",

    name: artist.name || "Unknown artist",

    title: artist.name || "Unknown artist",

    artist: artist.name || "Unknown artist",

    externalId: artist.id || "",

    country: artist.country || "",

    disambiguation: artist.disambiguation || "",

    sortName: artist["sort-name"] || ""

  }));

}



async function searchAlbumsFromApi(term) {

  const url = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(term)}&fmt=json&limit=12`;

  const response = await fetch(url, { headers: { Accept: "application/json" } });

  if (!response.ok) throw new Error(`Album API request failed: ${response.status}`);

  const result = await response.json();

  return (result.releases || []).map((release) => ({

    type: "album",

    title: release.title || "Untitled",

    artist: release["artist-credit"]?.map((credit) => credit.name).join(", ") || "Unknown artist",

    externalId: release.id || "",

    releaseDate: release.date || "",

    coverUrl: release.id ? `https://coverartarchive.org/release/${release.id}/front-250` : ""

  }));

}



async function searchSongsFromApi(term) {

  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(term)}&fmt=json&limit=12`;

  const response = await fetch(url, { headers: { Accept: "application/json" } });

  if (!response.ok) throw new Error(`Song API request failed: ${response.status}`);

  const result = await response.json();

  return (result.recordings || []).map((recording) => ({

    type: "song",

    title: recording.title || "Untitled",

    artist: recording["artist-credit"]?.map((credit) => credit.name).join(", ") || "Unknown artist",

    externalId: recording.id || "",

    releaseTitle: recording.releases && recording.releases.length > 0 ? recording.releases[0].title || "" : ""

  }));

}



async function searchAll(term) {

  const [artists, albums, songs] = await Promise.all([

    searchArtistsFromApi(term),

    searchAlbumsFromApi(term),

    searchSongsFromApi(term)

  ]);

  return { artists, albums, songs };

}



function buildGroupedSearchHtml(results) {

  const { artists, albums, songs } = results;



  const artistHtml = artists.length

    ? `

      <div class="section-divider">Artists</div>

      ${artists.map((artist, index) => `

        <div class="result-item">

          <div class="media-row">

            <div class="media-cover-placeholder">Artist</div>

            <div class="media-content">

              <div class="result-title">${escapeHtml(artist.name)}</div>

              ${artist.country ? `<div class="result-meta">${escapeHtml(artist.country)}</div>` : ""}

              ${artist.disambiguation ? `<div class="result-meta">${escapeHtml(artist.disambiguation)}</div>` : ""}

              <div class="detail-actions">

                <button class="select-result-btn" data-group="artists" data-index="${index}">View details</button>

              </div>

            </div>

          </div>

        </div>

      `).join("")}

    `

    : "";



  const albumHtml = albums.length

    ? `

      <div class="section-divider">Albums</div>

      ${albums.map((album, index) => `

        <div class="result-item">

          <div class="media-row">

            ${getAlbumCoverMarkup(album.coverUrl, `${album.title} cover`)}

            <div class="media-content">

              <div class="result-title">${escapeHtml(album.title)}</div>

              <div class="result-meta">${escapeHtml(album.artist)}</div>

              ${album.releaseDate ? `<div class="result-meta">Release date: ${escapeHtml(album.releaseDate)}</div>` : ""}

              <div class="detail-actions">

                <button class="select-result-btn" data-group="albums" data-index="${index}">View details</button>

              </div>

            </div>

          </div>

        </div>

      `).join("")}

    `

    : "";



  const songHtml = songs.length

    ? `

      <div class="section-divider">Songs</div>

      ${songs.map((song, index) => `

        <div class="result-item">

          <div class="media-row">

            <div class="media-cover-placeholder">Song</div>

            <div class="media-content">

              <div class="result-title">${escapeHtml(song.title)}</div>

              <div class="result-meta">${escapeHtml(song.artist)}</div>

              ${song.releaseTitle ? `<div class="result-meta">Album: ${escapeHtml(song.releaseTitle)}</div>` : ""}

              <div class="detail-actions">

                <button class="select-result-btn" data-group="songs" data-index="${index}">View details</button>

              </div>

            </div>

          </div>

        </div>

      `).join("")}

    `

    : "";



  return artistHtml + albumHtml + songHtml;

}





function cleanSearchText(value) {

  return String(value || "")

    .toLowerCase()

    .replace(/\(.*?\)/g, "")

    .replace(/\[.*?\]/g, "")

    .replace(/deluxe|remaster|remastered|anniversary|expanded|edition|version|bonus|live|karaoke|instrumental/g, "")

    .replace(/[^a-z0-9\s]/g, " ")

    .replace(/\s+/g, " ")

    .trim();

}



function scoreSearchMatch(query, candidateTitle, candidateArtist = "") {

  const q = cleanSearchText(query);

  const t = cleanSearchText(candidateTitle);

  const a = cleanSearchText(candidateArtist);



  let score = 0;

  if (!q) return score;



  if (t === q) score += 100;

  else if (t.startsWith(q)) score += 60;

  else if (t.includes(q)) score += 35;



  if (a === q) score += 90;

  else if (a.startsWith(q)) score += 45;

  else if (a.includes(q)) score += 20;



  if (`${a} ${t}` === q) score += 120;

  if (`${t} ${a}` === q) score += 120;


  return score;

}



function sortBySearchScore(items, query) {

  return [...items].sort((a, b) => {

    const aScore = scoreSearchMatch(query, a.title || a.name, a.artist || a.name);

    const bScore = scoreSearchMatch(query, b.title || b.name, b.artist || b.name);

    return bScore - aScore;

  });

}



// One shared, read-only catalogue snapshot; typing never fans out into requests.
let predictiveCataloguePromise = null;
let predictiveCatalogueLoadedAt = 0;
function getPredictiveCatalogue() {
  if (predictiveCatalogueLoadedAt && Date.now() - predictiveCatalogueLoadedAt > 300000) predictiveCataloguePromise = null;
  if (!predictiveCataloguePromise) {
    predictiveCatalogueLoadedAt = 0;
    const read = async (table) => {
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabaseClient.from(table).select("*")
          .order("id", { ascending: true }).range(offset, offset + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) return rows;
      }
    };
    predictiveCataloguePromise = Promise.all([read("albums"), read("songs")])
      .then(([albums, songs]) => {
        predictiveCatalogueLoadedAt = Date.now();
        return window.BOMAutocomplete.buildCatalogue(albums, songs, getAlbumArtworkUrl, (name) => readArtistImageCache(name)?.url || "");
      })
      .catch((error) => { predictiveCataloguePromise = null; throw error; });
  }
  return predictiveCataloguePromise;
}

let searchDebounceTimer = null;



async function runGlobalSearch(forceOpenBest = false) {

  const query = globalSearchInput?.value.trim();



  if (!query) {

    setMessage(globalSearchMessage, "Enter something to search.");

    globalSearchResults.innerHTML = "";

    return;

  }



  setMessage(globalSearchMessage, "Searching...");
  if (isStageOnePresentation() && window.BOMSearchUI) {
    globalSearchResults.innerHTML = window.BOMSearchUI.renderLoading(query);
  } else {
    renderLoadingSkeleton(globalSearchResults, "list");
  }



  function renderResultItem(item, group, index, hiddenClass = "") {

    if (group === "artists") {

      return `

        <div class="result-item ${hiddenClass}" data-result-group="${group}">

          <div class="media-row">

            <div class="media-cover-placeholder">Artist</div>

            <div class="media-content">

              <div class="result-title">${escapeHtml(item.name)}</div>

              ${item.country ? `<div class="result-meta">${escapeHtml(item.country)}</div>` : ""}

              ${item.disambiguation ? `<div class="result-meta">${escapeHtml(item.disambiguation)}</div>` : ""}

            </div>

            <button class="select-result-btn" data-group="artists" data-index="${index}">Select</button>

          </div>

        </div>

      `;

    }



    if (group === "albums") {

      return `

        <div class="result-item ${hiddenClass}" data-result-group="${group}">

          <div class="media-row">

            ${item.coverUrl

              ? `<img class="media-cover" src="${escapeHtml(item.coverUrl)}" alt="${escapeHtml(item.title)} cover">`

              : `<div class="media-cover-placeholder">Album</div>`}

            <div class="media-content">

              <div class="result-title">${escapeHtml(item.title)}</div>

              <div class="result-meta">${escapeHtml(item.artist)}</div>

              ${item.releaseDate ? `<div class="result-meta">${escapeHtml(item.releaseDate)}</div>` : ""}

              ${item.country ? `<div class="result-meta">Country: ${escapeHtml(item.country)}</div>` : ""}

            </div>

            <button class="select-result-btn" data-group="albums" data-index="${index}">Select</button>

          </div>

        </div>

      `;

    }



    return `

      <div class="result-item ${hiddenClass}" data-result-group="${group}">

        <div class="media-row">

          <div class="media-cover-placeholder">Song</div>

          <div class="media-content">

            <div class="result-title">${escapeHtml(item.title)}</div>

            <div class="result-meta">${escapeHtml(item.artist)}</div>

            ${item.releaseTitle ? `<div class="result-meta">${escapeHtml(item.releaseTitle)}</div>` : ""}
${item.versionCount > 1 ? `<div class="result-meta">+ ${item.versionCount - 1} other version${item.versionCount - 1 === 1 ? "" : "s"}</div>` : ""}

          </div>

          <button class="select-result-btn" data-group="songs" data-index="${index}">Select</button>

        </div>

      </div>

    `;

  }



  function renderExpandableSection(title, group, items, initialCount) {

    if (!items.length) return "";



    const hiddenCount = Math.max(0, items.length - initialCount);



    return `

      <div

        class="section-divider clickable-result-heading show-more-results-btn"

        data-group="${group}"

        role="button"

        tabindex="0">

        ${title}${hiddenCount ? ` <span class="result-heading-more">— tap for more</span>` : ""}

      </div>



      ${items.map((item, index) => {

        const hiddenClass = index >= initialCount ? "hidden extra-result" : "";

        return renderResultItem(item, group, index, hiddenClass);

      }).join("")}



      ${hiddenCount ? `

        <div class="show-more-row">

          <button

            type="button"

            class="secondary-btn show-more-results-btn"

            data-group="${group}">

            Show more ${title.toLowerCase()} (${hiddenCount} more)

          </button>

        </div>

      ` : ""}

    `;

  }



  try {

    const [artistRes, albumRes, songRes] = await Promise.all([

      fetch(`https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=15`, {

        headers: { Accept: "application/json" }

      }),

      fetch(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=60`, {

        headers: { Accept: "application/json" }

      }),

      fetch(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=25`, {

        headers: { Accept: "application/json" }

      })

    ]);



    const artistData = await artistRes.json();

    const albumData = await albumRes.json();

    const songData = await songRes.json();



    const artists = sortBySearchScore(
  (artistData.artists || []).map((artist) => ({
    type: "artist",
    name: artist.name || "Unknown",
    title: artist.name || "Unknown",
    artist: artist.name || "Unknown",
    externalId: artist.id || "",
    country: artist.country || "",
    disambiguation: artist.disambiguation || "",
    score: artist.score || 0,
    releaseCount: artist["release-count"] || 0
  })),
  query
)
.sort((a, b) => {
  const cleanQuery = normaliseCompare(query);
  const aName = normaliseCompare(a.name);
  const bName = normaliseCompare(b.name);

  const aBad = /tribute|karaoke|string quartet|cover|experience/i.test(a.name + " " + a.disambiguation);
  const bBad = /tribute|karaoke|string quartet|cover|experience/i.test(b.name + " " + b.disambiguation);

  if (aBad !== bBad) return aBad ? 1 : -1;

  const aExact = aName === cleanQuery;
  const bExact = bName === cleanQuery;

  if (aExact !== bExact) return aExact ? -1 : 1;

  return Number(b.releaseCount || 0) - Number(a.releaseCount || 0);
})
.slice(0, 20);



    const rawAlbums = (albumData.releases || []).map((release) => ({

      type: "album",

      title: release.title || "Untitled",

      artist: release["artist-credit"]?.map(a => a.name).join(", ") || "Unknown artist",

      externalId: release.id || "",

      releaseGroupId: release["release-group"]?.id || "",

      releaseDate: release.date || "",

      coverUrl: release.id

        ? `https://coverartarchive.org/release/${release.id}/front-250`

        : "",

      primaryType: release["release-group"]?.["primary-type"] || "",

      secondaryTypes: release["release-group"]?.["secondary-types"] || [],

      status: release.status || "",

      country: release.country || ""

    }));



    const grouped = {};



    rawAlbums.forEach((album) => {

      if (

        album.primaryType !== "Album" ||

        album.secondaryTypes.includes("Live") ||

        album.secondaryTypes.includes("Compilation") ||

        album.secondaryTypes.includes("Soundtrack")

      ) return;



      const groupId = album.releaseGroupId;

      if (!groupId) return;



      if (!grouped[groupId]) grouped[groupId] = [];

      grouped[groupId].push(album);

    });



    const albums = sortBySearchScore(

      Object.values(grouped).map(group => {

        return group.sort((a, b) => {
 
          const score = (album) => {

            const year = album.releaseDate ? Number(album.releaseDate.slice(0, 4)) : 3000;

            return (

              (album.status === "Official" ? 5 : 0) +

              (album.coverUrl ? 3 : 0) +

              (album.country === "GB" || album.country === "US" ? 2 : 0) -

              year

            );

          };

          return score(b) - score(a);

        })[0];

      }),

      query

    ).slice(0, 30);



    const queryWords = cleanSearchText(query).split(" ").filter(Boolean);

const artistsInResults = (songData.recordings || [])
  .map((rec) => rec["artist-credit"]?.map(a => a.name).join(", ") || "")
  .filter(Boolean);

const likelyArtist =
  artistsInResults.find((artist) =>
    queryWords.some((word) => normaliseCompare(artist).includes(normaliseCompare(word)))
  ) || "";

function isBadSongReleaseTitle(title) {
  const clean = normaliseCompare(title);

  return (
    clean.includes("unplugged") ||
    clean.includes("undrugged") ||
    clean.includes("acoustic") ||
    clean.includes("session") ||
    clean.includes("sessions") ||
    clean.includes("live") ||
    clean.includes("tribute") ||
    clean.includes("karaoke") ||
    clean.includes("greatesthits") ||
    clean.includes("bestof") ||
    clean.includes("collection") ||
    clean.includes("anthology") ||
    clean.includes("essential") ||
    clean.includes("soundtrack") ||
    clean.includes("hits")
  );
}

function bigArtistBoost(artistName) {
  const clean = normaliseCompare(artistName);

  const boosts = {
    oasis: 1000,
    thebeatles: 1000,
    beatles: 1000,
    therollingstones: 950,
    rollingstones: 950,
    davidbowie: 900,
    queen: 900,
    radiohead: 850,
    blur: 850,
    pinkfloyd: 850
  };

  return boosts[clean] || 0;
}

function releaseScore(release, artistName, songTitle = "") {
  const title = release.title || "";
  const cleanTitle = normaliseCompare(title);
  let score = bigArtistBoost(artistName);

  if (!isBadSongReleaseTitle(title)) score += 100;
  if (release.date) score += 20;
  if (release.status === "Official") score += 15;
  if (release.country === "GB") score += 10;
  if (
  normaliseCompare(artistName) === "oasis" &&
  normaliseCompare(songTitle) === "wonderwall" &&
  cleanTitle.includes("whatsthestorymorningglory")
) {
  score += 5000;
}

  return score;
}

const rawSongs = (songData.recordings || []).map((rec) => {
  const artist = rec["artist-credit"]?.map(a => a.name).join(", ") || "Unknown";
  const releases = rec.releases || [];

  const bestRelease = releases
    .slice()
    .sort((a, b) =>
  releaseScore(b, artist, rec.title) - releaseScore(a, artist, rec.title)
)[0] || {};

  return {
    type: "song",
    title: rec.title || "Untitled",
    artist,
    externalId: rec.id || "",
    releaseTitle: bestRelease.title || "",
    releaseDate: bestRelease.date || "",
    releaseId: bestRelease.id || "",
    versionCount: releases.length
  };
});

const groupedSongs = {};

rawSongs.forEach((song) => {
  const key = `${normaliseCompare(song.artist)}-${normaliseCompare(song.title)}`;

  if (!groupedSongs[key]) {
    groupedSongs[key] = song;
    return;
  }

  const currentScore = releaseScore(
    { title: groupedSongs[key].releaseTitle, date: groupedSongs[key].releaseDate },
    groupedSongs[key].artist
  );

  const nextScore = releaseScore(
    { title: song.releaseTitle, date: song.releaseDate },
    song.artist
  );

  groupedSongs[key].versionCount =
    Number(groupedSongs[key].versionCount || 1) + Number(song.versionCount || 1);

  if (nextScore > currentScore) {
    groupedSongs[key] = {
      ...song,
      versionCount: groupedSongs[key].versionCount
    };
  }
});

const songs = sortBySearchScore(
  Object.values(groupedSongs),
  query
)
.sort((a, b) => {
  const aArtistMatch = likelyArtist && normaliseCompare(a.artist) === normaliseCompare(likelyArtist);
  const bArtistMatch = likelyArtist && normaliseCompare(b.artist) === normaliseCompare(likelyArtist);

  if (aArtistMatch !== bArtistMatch) return aArtistMatch ? -1 : 1;

  const aBad = isBadSongReleaseTitle(a.releaseTitle);
  const bBad = isBadSongReleaseTitle(b.releaseTitle);

  if (aBad !== bBad) return aBad ? 1 : -1;

  return releaseScore(b, b.artist) - releaseScore(a, a.artist);
})
.slice(0, 20);



    const groupedResults = { artists, albums, songs };

    globalSearchResults.dataset.results = JSON.stringify(groupedResults);



    const bestArtist = artists[0];

    const bestAlbum = albums[0];

    const bestSong = songs[0];



    const bestCandidates = [bestArtist, bestAlbum, bestSong]

      .filter(Boolean)

      .map((item) => ({

        item,

        score: scoreSearchMatch(query, item.title || item.name, item.artist || item.name)

      }))

      .sort((a, b) => b.score - a.score);



    const best = bestCandidates[0];



    if (forceOpenBest && best && best.score >= 95) {

      selectedItem = best.item;

      setMessage(globalSearchMessage, "");

      await renderSelectedItem();

      showOnlySection("detailSection");

      return;

    }



    if (!artists.length && !albums.length && !songs.length) {

      setMessage(globalSearchMessage, "No results found.");
      globalSearchResults.innerHTML = isStageOnePresentation() && window.BOMSearchUI
        ? window.BOMSearchUI.renderEmpty(query)
        : "";

      return;

    }

    if (isStageOnePresentation() && window.BOMSearchUI) {
      globalSearchResults.innerHTML = window.BOMSearchUI.render(buildStageOneSearchModel(query, groupedResults));
      setMessage(globalSearchMessage, "");
      return;
    }



    globalSearchResults.innerHTML = `
  <div class="search-tabs">
    <button class="search-tab active-search-tab" data-search-filter="all">All</button>
    <button class="search-tab" data-search-filter="artists">Artists</button>
    <button class="search-tab" data-search-filter="albums">Albums</button>
    <button class="search-tab" data-search-filter="songs">Tracks</button>
  </div>

  ${renderExpandableSection("Artists", "artists", artists, 5)}

  ${renderExpandableSection("Albums", "albums", albums, 5)}

  ${renderExpandableSection("Songs", "songs", songs, 8)}
`;



    setMessage(

      globalSearchMessage,

      best && best.score >= 95

        ? "Best match ready. Tap a green heading or Show more to reveal more options."

        : "Tap a green heading or Show more to reveal more options."

    );

  } catch (err) {

    console.error("Search failed", err);

    setMessage(globalSearchMessage, "Search failed.");
    if (isStageOnePresentation() && window.BOMSearchUI) {
      globalSearchResults.innerHTML = window.BOMSearchUI.renderError(query);
    }

  }

}

function buildStageOneSearchModel(query, groupedResults) {
  const findAlbum = (item) => allAlbums.find((album) =>
    normaliseCompare(album.title) === normaliseCompare(item.title) &&
    normaliseCompare(album.artist) === normaliseCompare(item.artist)
  );
  const artists = groupedResults.artists.map((item, index) => ({ ...item, index, artworkUrl: "" }));
  const albums = groupedResults.albums.map((item, index) => {
    const saved = findAlbum(item);
    const community = saved ? getAlbumAverage(saved.id) : null;
    return {
      ...item,
      index,
      artworkUrl: saved ? getAlbumArtworkUrl(saved) : item.coverUrl,
      year: String(saved?.original_release_date || saved?.release_date || item.releaseDate || "").match(/\b\d{4}\b/)?.[0] || "",
      community: community ? { average: community.avg, count: community.count } : null
    };
  });
  const songs = groupedResults.songs.map((item, index) => {
    const saved = allSongs.find((song) =>
      normaliseCompare(song.title) === normaliseCompare(item.title) &&
      normaliseCompare(song.artist) === normaliseCompare(item.artist)
    );
    const album = saved?.album_id ? allAlbums.find((row) => Number(row.id) === Number(saved.album_id)) : findAlbum({ title: item.releaseTitle, artist: item.artist });
    const community = saved ? getSongAverage(saved.id) : null;
    return {
      ...item,
      index,
      albumTitle: album?.title || item.releaseTitle || "",
      artworkUrl: album ? getAlbumArtworkUrl(album) : "",
      year: String(album?.original_release_date || album?.release_date || item.releaseDate || "").match(/\b\d{4}\b/)?.[0] || "",
      community: community ? { average: community.avg, count: community.count } : null
    };
  });
  return { query, artists, albums, songs };
}



function isStudioReleaseGroup(releaseGroup) {

  if (!releaseGroup) return false;

  const primaryType = releaseGroup["primary-type"] || "";

  const secondaryTypes = releaseGroup["secondary-types"] || [];

  const title = normaliseCompare(releaseGroup.title || "");

  const blockedTitleBits = [
  "single",
  "ep",
  "remix",
  "karaoke",
  "instrumental",
  "acoustic",
  "live",
  "demo",
  "radioedit",
  "session",
  "sessions",
  "bestof",
  "greatesthits",
  "collection",
  "compilation",
  "anthology",
  "soundtrack",
  "tribute",
  "interview",
  "broadcast",
  "bootleg",
  "unauthorised",
  "spokenword",
  "unauthorized",
  "mixtape",
  "homedownshowdown"
];

  if (primaryType !== "Album") return false;

  const secondaryText = secondaryTypes
  .map((type) => normaliseCompare(type))
  .join(" ");

  if (
  secondaryText.includes("compilation") ||
  secondaryText.includes("live") ||
  secondaryText.includes("demo") ||
  secondaryText.includes("soundtrack") ||
  secondaryText.includes("interview") ||
  secondaryText.includes("mixtape") ||
  secondaryText.includes("remix") ||
  secondaryText.includes("spokenword") ||
  secondaryText.includes("djmix")
) return false;

  if (blockedTitleBits.some((bit) => title.includes(bit) || title.endsWith(bit.trim()))) return false;

  return true;

}



function sortReleaseGroupsByDate(releaseGroups) {

  return [...releaseGroups].sort((a, b) => {

    const aDate = String(a["first-release-date"] || "9999-99-99");

    const bDate = String(b["first-release-date"] || "9999-99-99");

    return aDate.localeCompare(bDate);

  });

}



async function resolveArtistIdByName(artistName) {

  const cleanName = normaliseText(artistName);

  if (!cleanName) return "";

  /*
    Prefer an artist ID already attached to one of BoM's saved
    albums. This is the same canonical ID used when the artist was
    originally found through search.
  */
  const localArtistId =
    getSelectedArtistIdFallback(cleanName);

  if (localArtistId) {
    return localArtistId;
  }

  try {

    /*
      Quote the MusicBrainz artist search so names containing "&",
      punctuation or common words are resolved as one exact phrase.
    */
    const query = `artist:"${cleanName.replace(/"/g, "")}"`;

    const url =
      `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(query)}` +
      `&fmt=json&limit=25`;

    const response = await fetch(url, {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) return "";

    const data = await response.json();

    const artists = data.artists || [];

    const exactMatches = artists.filter(
      (artist) =>
        normaliseCompare(artist.name) ===
        normaliseCompare(cleanName)
    );

    const candidates =
      exactMatches.length
        ? exactMatches
        : artists;

    candidates.sort((a, b) => {
      const aBad =
        /tribute|cover|karaoke|impersonator/i.test(
          `${a.disambiguation || ""} ${a.type || ""}`
        );

      const bBad =
        /tribute|cover|karaoke|impersonator/i.test(
          `${b.disambiguation || ""} ${b.type || ""}`
        );

      if (aBad !== bBad) {
        return aBad ? 1 : -1;
      }

      const scoreDifference =
        Number(b.score || 0) -
        Number(a.score || 0);

      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return (
        Number(b["release-count"] || 0) -
        Number(a["release-count"] || 0)
      );
    });

    return candidates[0]?.id || "";

  } catch (error) {

    console.error(
      "MusicBrainz artist ID resolution failed:",
      cleanName,
      error
    );

    return "";

  }

}



async function fetchCanonicalReleaseForReleaseGroup(releaseGroupId) {

  if (!releaseGroupId) return "";

  try {

    const url = `https://musicbrainz.org/ws/2/release-group/${encodeURIComponent(releaseGroupId)}?inc=releases&fmt=json`;

    const response = await fetch(url, { headers: { Accept: "application/json" } });

    if (!response.ok) return "";

    const data = await response.json();

    const releases = data.releases || [];

    if (!releases.length) return "";

    const scored = releases.map((release) => {

      let score = 0;

      if (release.status === "Official") score += 40;

      if (release.country === "GB" || release.country === "US") score += 12;

      if (release.date) score += 8;

      if (release["packaging"] && !String(release["packaging"]).toLowerCase().includes("none")) score += 2;

      return { release, score };

    }).sort((a, b) => {

      if (b.score !== a.score) return b.score - a.score;

      return String(a.release.date || "9999-99-99").localeCompare(String(b.release.date || "9999-99-99"));

    });

    return scored[0]?.release?.id || "";

  } catch {

    return "";

  }

}



async function resolveArtistIdFreshFromMusicBrainz(
  artistName,
  excludedIds = []
) {
  const cleanName = normaliseText(artistName);
  if (!cleanName) return "";

  try {
    const query =
      `artist:"${cleanName.replace(/"/g, "")}"`;

    const url =
      `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(query)}` +
      `&fmt=json&limit=25`;

    const response = await fetch(url, {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) return "";

    const data = await response.json();
    const excluded = new Set(
      (excludedIds || [])
        .filter(Boolean)
        .map(String)
    );

    const exactMatches =
      (data.artists || [])
        .filter(
          (artist) =>
            normaliseCompare(artist.name) ===
            normaliseCompare(cleanName)
        )
        .filter(
          (artist) =>
            !excluded.has(String(artist.id || ""))
        )
        .filter(
          (artist) =>
            !/tribute|cover|karaoke|impersonator|string quartet/i.test(
              `${artist.disambiguation || ""} ${artist.type || ""}`
            )
        )
        .sort((a, b) => {
          const releaseDifference =
            Number(b["release-count"] || 0) -
            Number(a["release-count"] || 0);

          if (releaseDifference !== 0) {
            return releaseDifference;
          }

          return (
            Number(b.score || 0) -
            Number(a.score || 0)
          );
        });

    return exactMatches[0]?.id || "";
  } catch (error) {
    console.warn(
      "Fresh artist lookup failed:",
      cleanName,
      error
    );

    return "";
  }
}

async function fetchMostCompleteArtistDiscography({
  artistName,
  preferredArtistId = "",
  savedAlbumCount = 0,
  expectedReleaseCount = 0
}) {
  let bestArtistId = preferredArtistId || "";
  let bestAlbums = [];

  if (preferredArtistId) {
    bestAlbums =
      await fetchStudioAlbumsForArtist(
        preferredArtistId,
        artistName
      );
  }

  /*
    A common failure mode in BoM was an old/wrong MusicBrainz ID
    attached to a saved album. The artist page then showed only the
    few albums already stored locally. If the remote discography is
    empty or suspiciously small, perform a fresh exact-name lookup
    that ignores the local ID and compare the results.
  */
  const looksIncomplete =
    !bestAlbums.length ||
    bestAlbums.length <= savedAlbumCount ||
    (
      Number(expectedReleaseCount || 0) >= 8 &&
      bestAlbums.length < 5
    );

  if (looksIncomplete) {
    const freshArtistId =
      await resolveArtistIdFreshFromMusicBrainz(
        artistName,
        [preferredArtistId]
      );

    if (freshArtistId) {
      const freshAlbums =
        await fetchStudioAlbumsForArtist(
          freshArtistId,
          artistName
        );

      if (freshAlbums.length > bestAlbums.length) {
        bestAlbums = freshAlbums;
        bestArtistId = freshArtistId;
      }
    }
  }

  return {
    artistId: bestArtistId,
    albums: bestAlbums
  };
}

async function fetchStudioAlbumsForArtist(artistId, artistName = "") {

  const resolvedArtistId = artistId || await resolveArtistIdByName(artistName);

  if (!resolvedArtistId) return [];

  try {

    const url = `https://musicbrainz.org/ws/2/release-group?artist=${encodeURIComponent(resolvedArtistId)}&type=album&fmt=json&limit=100`;

    const response = await fetch(url, { headers: { Accept: "application/json" } });

    if (!response.ok) return [];

    const data = await response.json();

    return sortReleaseGroupsByDate(data["release-groups"] || [])

      .filter(isStudioReleaseGroup)

      .map((releaseGroup) => ({

        type: "album",

        title: releaseGroup.title || "Untitled",

        artist: artistName || selectedItem?.artist || selectedItem?.name || "",

        artistId: resolvedArtistId,

        externalId: "",

        releaseGroupId: releaseGroup.id || "",

        releaseDate: releaseGroup["first-release-date"] || "",

        coverUrl: releaseGroup.id ? `https://coverartarchive.org/release-group/${releaseGroup.id}/front-250` : ""

      }));

  } catch {

    return [];

  }

}



async function fetchArtistAlbumsFromApi(artistName, artistId = "") {

  return await fetchStudioAlbumsForArtist(artistId, artistName);

}



async function fetchArtistDetail(externalId) {
  if (!externalId) return null;

  const url = `https://musicbrainz.org/ws/2/artist/${encodeURIComponent(externalId)}?inc=tags+genres+aliases+url-rels&fmt=json`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (response.ok) return await response.json();
    if (attempt < 2 && (response.status === 503 || response.status === 429)) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      continue;
    }
    return null;
  }
  return null;

}

async function resolveArtistIdentityForImage(artistName, preferredArtistId = "", preferredDetail = null) {
  if (preferredArtistId && preferredDetail?.id === preferredArtistId) return { artistId: preferredArtistId, detail: preferredDetail };
  if (preferredArtistId) {
    const detail = preferredDetail || await fetchArtistDetail(preferredArtistId);
    if (detail) return { artistId: preferredArtistId, detail };
  }

  const endpoint = new URL("https://musicbrainz.org/ws/2/artist");
  endpoint.search = new URLSearchParams({ query: `artist:\"${artistName.replace(/\"/g, "")}\"`, fmt: "json", limit: "10" }).toString();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(endpoint.toString(), { headers: { Accept: "application/json" } });
    if (response.ok) {
      const matches = ((await response.json())?.artists || [])
        .filter((artist) => normaliseCompare(artist.name) === normaliseCompare(artistName))
        .filter((artist) => artist.type && artist.id)
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
      const match = matches[0];
      if (!match) return { artistId: "", detail: null };
      await new Promise((resolve) => window.setTimeout(resolve, 1100));
      return { artistId: match.id, detail: await fetchArtistDetail(match.id) };
    }
    if (attempt < 2 && (response.status === 503 || response.status === 429)) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      continue;
    }
    break;
  }
  return { artistId: "", detail: null };
}



const ARTIST_IMAGE_CACHE_PREFIX = "bom_artist_image_v17:";
const ARTIST_IMAGE_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;
const artistImageMemoryCache = new Map();
const ARTIST_HERO_BUCKET = "artist-hero-images";

function getArtistHeroKey(artistName) {
  return String(artistName || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}

function getArtistHeroPublicUrl(storagePath, updatedAt = "") {
  if (!storagePath) return "";
  const { data } = supabaseClient.storage.from(ARTIST_HERO_BUCKET).getPublicUrl(storagePath);
  const url = data?.publicUrl || "";
  if (!url || !updatedAt) return url;
  const version = Date.parse(updatedAt);
  return Number.isFinite(version) ? `${url}?v=${version}` : url;
}

async function loadManualArtistHero(artistName) {
  const artistKey = getArtistHeroKey(artistName);
  if (!artistKey) return null;
  const { data, error } = await supabaseClient
    .from("artist_hero_overrides")
    .select("artist_key, artist_name, musicbrainz_artist_id, storage_path, mime_type, width, height, updated_at")
    .eq("artist_key", artistKey)
    .maybeSingle();
  if (error) {
    // Keep the staged UI usable while the accompanying migration is pending.
    // Unexpected read failures still surface for diagnosis.
    if (!["PGRST205", "42P01"].includes(error.code)) {
      console.warn("Artist hero override could not load", error);
    }
    return null;
  }
  if (!data?.storage_path) return null;
  const width = Number(data.width || 0);
  const height = Number(data.height || 0);
  const { heroFit, heroPosition } = window.BOMArtistHeroPolicy.fitForDimensions(width, height);
  return {
    ...data,
    url: getArtistHeroPublicUrl(data.storage_path, data.updated_at),
    provider: "BOM artist hero",
    identitySource: "Admin-selected artist photograph",
    imageIdentity: data.storage_path,
    width,
    height,
    originalWidth: width,
    originalHeight: height,
    heroFit,
    heroPosition,
    isManual: true
  };
}

function clearAutomaticArtistImageCache(artistName, artistId = "") {
  [getArtistImageCacheKey(artistName, artistId), getArtistImageCacheKey(artistName, "")].forEach((key) => {
    artistImageMemoryCache.delete(key);
    try { sessionStorage.removeItem(key); } catch (_error) {}
  });
}

async function readArtistHeroDimensions(file) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }
  return await new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The selected image could not be read.")); };
    image.src = url;
  });
}

function validateArtistHeroFile(file) {
  return window.BOMArtistHeroPolicy.validateFile(file);
}

function isMusicalArtistContext(value) {
  return /\b(singer|songwriter|musician|rapper|composer|record producer|musical artist|music group|rock band|pop band|band|duo|trio|quartet|vocalist|instrumentalist)\b/i.test(String(value || ""));
}

function isSuitableArtistImageFilename(value) {
  return !/(album|single|ep[._ -]?cover|record[._ -]?cover|sleeve|logo|wordmark|composite|collage|montage|poster|advert|ticket|prop|mini.?disc|ostinato|chord|sheet.?music|scenery|landscape|desert|satellite|building|meter|tree|microphones?|instruments?|statue|sculpture|mural|museum|memorabilia|waxwork|graffiti|costume|magazine|book|publication|newspaper)/i.test(String(value || ""));
}

function isSuitableArtistImageMetadata(value) {
  return !/(montage|composite|collage|album cover|record sleeve|logo|wordmark|museum exhibits|statues|sculptures|waxworks|memorabilia|magazines|books|publications|newspapers)/i.test(String(value || ""));
}

function isArtistGroupContext(value) {
  return /\b(group|band|duo|trio|quartet|ensemble|orchestra)\b/i.test(String(value || ""));
}

function buildCommonsArtistImage(filename, info, identity) {
  if (!filename || !info || !isSuitableArtistImageFilename(filename)) return null;
  const description = String(info?.extmetadata?.ImageDescription?.value || "").replace(/<[^>]*>/g, " ");
  const categories = String(info?.extmetadata?.Categories?.value || "");
  if (!isSuitableArtistImageMetadata(`${description} ${categories}`)) return null;
  const originalWidth = Number(info?.width || 0);
  const originalHeight = Number(info?.height || 0);
  const useThumbnail = originalWidth > 1200 && info?.thumburl;
  const imageUrl = (useThumbnail ? info.thumburl : info?.url) || "";
  if (!imageUrl || !/^https:\/\/(?:upload|thumb)\.wikimedia\.org\//i.test(imageUrl)) return null;
  const width = useThumbnail ? Number(info.thumbwidth || 1200) : originalWidth;
  const height = useThumbnail ? Number(info.thumbheight || 0) : originalHeight;
  return {
    url: imageUrl,
    provider: "Wikimedia Commons",
    identitySource: identity.source,
    identityUrl: identity.url,
    imageIdentity: filename,
    width,
    height,
    originalWidth,
    originalHeight,
    description,
    categories
  };
}

function scoreArtistHeroCandidate(image, artistName, isGroup, primary = false) {
  if (!image?.url || !image.width || !image.height) return -Infinity;
  const ratio = image.width / image.height;
  const text = `${image.imageIdentity || ""} ${image.description || ""} ${image.categories || ""}`;
  const artistKey = normaliseCompare(artistName);
  const filenameKey = normaliseCompare(String(image.imageIdentity || "").replace(/\.[a-z0-9]+$/i, ""));
  let score = primary ? 12 : 0;
  score += Math.min(28, Math.round(image.originalWidth / 180));
  if (ratio >= 1.45 && ratio <= 2.5) score += 38;
  else if (ratio >= 1.2 && ratio < 1.45) score += 18;
  else if (ratio > 3.2) score -= 35;
  if (filenameKey.includes(artistKey)) score += 28;

  const groupCue = /\b(group photo|group portrait|group shot|band photo|band portrait|band members|members of|the band|full band|musical group|left to right|performing together)\b|\bL-R\b/i.test(text);
  const peopleCue = /\b(portrait|performing|performance|musicians?|singers?|band|group|members?)\b/i.test(text);
  const soloCue = /\b(solo|lead singer|frontman|frontwoman|vocalist|guitarist|drummer|bassist)\b/i.test(text);
  const distantCue = /\b(crowd|audience|stadium|festival grounds?|wide shot|panorama|aerial|from a distance|distant|stage view)\b/i.test(text);
  if (isGroup) {
    if (groupCue) score += 70;
    else if (peopleCue) score += 20;
    if (soloCue && !groupCue) score -= 42;
    if (ratio < 1.05) score -= 40;
  } else {
    if (/\b(portrait|headshot|close-up)\b/i.test(text)) score += 55;
    else if (peopleCue) score += 25;
  }
  if (distantCue) score -= 65;
  return score;
}

function isStrongPrimaryArtistHero(image, isGroup) {
  if (!image?.width || !image?.height || image.width < 800) return false;
  const ratio = image.width / image.height;
  const text = `${image.imageIdentity || ""} ${image.description || ""} ${image.categories || ""}`;
  if (ratio < 1.3 || ratio > 2.6) return false;
  if (/\b(crowd|audience|stadium|festival grounds?|wide shot|panorama|aerial|from a distance|distant|stage view)\b/i.test(text)) return false;
  if (!isGroup) return /\b(portrait|performing|performance|singer|musician)\b/i.test(text);
  return /\b(group|band|members?|left to right|bow|lineup|performing together)\b|\bL-R\b/i.test(text);
}

function selectBestArtistHero(candidates, artistName, isGroup) {
  const ranked = candidates
    .filter(Boolean)
    .map((candidate) => ({
      ...candidate,
      selectionScore: scoreArtistHeroCandidate(candidate, artistName, isGroup, Boolean(candidate.isPrimary))
    }))
    .filter((candidate) => Number.isFinite(candidate.selectionScore))
    .sort((a, b) => b.selectionScore - a.selectionScore || b.originalWidth - a.originalWidth);
  const selected = ranked[0] || null;
  if (!selected) return null;
  const ratio = selected.width / Math.max(selected.height, 1);
  selected.heroFit = ratio >= 1.25 && ratio <= 2.6 && !/\b(close-up|headshot)\b/i.test(`${selected.imageIdentity} ${selected.description}`)
    ? "cover"
    : "contain";
  selected.heroPosition = selected.heroFit === "cover" ? "center 32%" : "center";
  return selected;
}

function getArtistImageCacheKey(artistName, artistId = "") {
  return `${ARTIST_IMAGE_CACHE_PREFIX}${artistId || normaliseCompare(artistName)}`;
}

function readArtistImageCache(artistName, artistId = "") {
  const key = getArtistImageCacheKey(artistName, artistId);
  if (artistImageMemoryCache.has(key)) return artistImageMemoryCache.get(key);
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || "null");
    if (cached && Date.now() - Number(cached.cachedAt || 0) < ARTIST_IMAGE_CACHE_MAX_AGE_MS) {
      artistImageMemoryCache.set(key, cached.value);
      return cached.value;
    }
  } catch (_error) {}
  return null;
}

function writeArtistImageCache(artistName, artistId, value) {
  const key = getArtistImageCacheKey(artistName, artistId);
  artistImageMemoryCache.set(key, value);
  try {
    sessionStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), value }));
  } catch (_error) {}
  return value;
}

function getMusicBrainzRelation(artistDetail, type) {
  return (artistDetail?.relations || []).find((relation) => relation.type === type && !relation.ended && relation.url?.resource) || null;
}

function getCommonsFilename(value) {
  const clean = decodeURIComponent(String(value || "").split("?")[0]);
  const match = clean.match(/(?:File:|\/wiki\/File:)(.+)$/i);
  return match ? match[1].replace(/_/g, " ") : "";
}

async function fetchArtistImageJson(url, options = {}, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(url, options);
    if (response.ok) return await response.json();
    if (attempt < attempts - 1 && (response.status === 429 || response.status === 503)) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    return null;
  }
  return null;
}

async function fetchCommonsArtistImage(filename, identity) {
  if (!filename || !isSuitableArtistImageFilename(filename)) return null;
  const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
  endpoint.search = new URLSearchParams({ action: "query", format: "json", origin: "*", prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "1200", titles: `File:${filename}` }).toString();
  const data = await fetchArtistImageJson(endpoint.toString());
  if (!data) return null;
  const pages = Object.values(data?.query?.pages || {});
  const info = pages[0]?.imageinfo?.[0];
  return buildCommonsArtistImage(filename, info, identity);
}

async function fetchCommonsCategoryArtistImages(category, artistName, identity, isGroup) {
  if (!category || !artistName) return [];
  const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
  endpoint.search = new URLSearchParams({ action: "query", format: "json", origin: "*", generator: "categorymembers", gcmtitle: `Category:${category}`, gcmtype: "file", gcmlimit: "50", prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "1200" }).toString();
  const data = await fetchArtistImageJson(endpoint.toString());
  if (!data) return [];
  const artistKey = normaliseCompare(artistName);
  const candidates = Object.values(data?.query?.pages || {})
    .map((page) => ({ filename: String(page.title || "").replace(/^File:/i, ""), info: page.imageinfo?.[0] }))
    .filter((item) => item.info?.mime === "image/jpeg" && item.info.width >= 800 && item.info.height >= 300)
    .filter((item) => isSuitableArtistImageFilename(item.filename))
    .filter((item) => isSuitableArtistImageMetadata(`${item.info.extmetadata?.ImageDescription?.value || ""} ${item.info.extmetadata?.Categories?.value || ""}`))
    .map((item) => {
      const fileKey = normaliseCompare(item.filename.replace(/\.[a-z0-9]+$/i, ""));
      const categories = String(item.info.extmetadata?.Categories?.value || "");
      let score = categories.toLowerCase().split("|").some((value) => normaliseCompare(value) === artistKey) ? 60 : 0;
      if (fileKey === artistKey) score += 200;
      else if (fileKey.includes(artistKey)) score += 100;
      const description = String(item.info.extmetadata?.ImageDescription?.value || "");
      const depictsPeople = /\b(live|concert|perform|band|group|members?|portrait|singer|musician|vocalist|guitarist|drummer|bassist)\b/i.test(`${item.filename} ${description}`);
      if (depictsPeople) score += 20;
      score += Math.min(20, Math.round(item.info.width / 500));
      const image = buildCommonsArtistImage(item.filename, item.info, identity);
      return { ...item, image, score, depictsPeople, namesArtist: fileKey.includes(artistKey) };
    })
    .filter((item) => item.image && item.score >= 60)
    .map((item) => ({
      ...item.image,
      shortlistScore: item.score,
      heroScore: scoreArtistHeroCandidate(item.image, artistName, isGroup)
    }))
    .sort((a, b) => b.heroScore - a.heroScore || b.shortlistScore - a.shortlistScore || b.originalWidth - a.originalWidth)
    .slice(0, 8);
  return candidates;
}

async function fetchCommonsSearchArtistImages(artistName, identity, isGroup) {
  if (!artistName) return [];
  const queries = isGroup
    ? [`\"${artistName}\" \"left to right\"`]
    : [`\"${artistName}\" portrait`];
  const responses = await Promise.all(queries.map(async (query) => {
    const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
    endpoint.search = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      generator: "search",
      gsrnamespace: "6",
      gsrlimit: "20",
      gsrsearch: query,
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "1200"
    }).toString();
    return await fetchArtistImageJson(endpoint.toString());
  }));
  const artistKey = normaliseCompare(artistName);
  const pages = responses.flatMap((data) => Object.values(data?.query?.pages || {}));
  return pages
    .map((page) => ({ filename: String(page.title || "").replace(/^File:/i, ""), info: page.imageinfo?.[0] }))
    .filter((item) => item.info?.mime === "image/jpeg" && item.info.width >= 800 && item.info.height >= 300)
    .map((item) => {
      const image = buildCommonsArtistImage(item.filename, item.info, identity);
      if (!image) return null;
      const filenameKey = normaliseCompare(item.filename.replace(/\.[a-z0-9]+$/i, ""));
      const descriptionKey = normaliseCompare(image.description);
      const categoryKeys = String(image.categories || "").split("|").map(normaliseCompare);
      const identityConfirmed = categoryKeys.some((key) => key === artistKey || key.includes(artistKey))
        && (filenameKey.includes(artistKey) || descriptionKey.includes(artistKey));
      if (!identityConfirmed) return null;
      return { ...image, heroScore: scoreArtistHeroCandidate(image, artistName, isGroup) };
    })
    .filter(Boolean)
    .sort((a, b) => b.heroScore - a.heroScore || b.originalWidth - a.originalWidth)
    .slice(0, 8);
}

async function fetchVerifiedCommonsArtistCandidates(category, artistName, identity, isGroup) {
  const [categoryImages, searchImages] = await Promise.all([
    fetchCommonsCategoryArtistImages(category, artistName, identity, isGroup),
    fetchCommonsSearchArtistImages(artistName, identity, isGroup)
  ]);
  const unique = new Map();
  [...categoryImages, ...searchImages].forEach((image) => {
    if (image?.imageIdentity && !unique.has(image.imageIdentity)) unique.set(image.imageIdentity, image);
  });
  return [...unique.values()]
    .sort((a, b) => scoreArtistHeroCandidate(b, artistName, isGroup) - scoreArtistHeroCandidate(a, artistName, isGroup))
    .slice(0, 8);
}

async function fetchWikidataArtistImage(relation) {
  const entityId = relation?.url?.resource?.match(/\/(Q\d+)(?:$|[?#])/i)?.[1]?.toUpperCase();
  if (!entityId) return null;
  const data = await fetchArtistImageJson(`https://www.wikidata.org/wiki/Special:EntityData/${entityId}.json`);
  if (!data) return null;
  const entity = data?.entities?.[entityId];
  const description = entity?.descriptions?.en?.value || "";
  if (!isMusicalArtistContext(description)) return null;
  const isGroup = isArtistGroupContext(description);
  const filename = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value || "";
  const identity = { source: "MusicBrainz-linked Wikidata", url: relation.url.resource };
  const primaryImage = filename ? await fetchCommonsArtistImage(filename, identity) : null;
  if (primaryImage) primaryImage.isPrimary = true;
  if (isStrongPrimaryArtistHero(primaryImage, isGroup)) return selectBestArtistHero([primaryImage], entity?.labels?.en?.value || "", isGroup);
  const category = entity?.claims?.P373?.[0]?.mainsnak?.datavalue?.value || "";
  const categoryImages = await fetchVerifiedCommonsArtistCandidates(category, entity?.labels?.en?.value || "", identity, isGroup);
  return selectBestArtistHero([primaryImage, ...categoryImages], entity?.labels?.en?.value || "", isGroup);
}

async function fetchWikidataArtistImageByMusicBrainzId(artistName, artistId) {
  if (!artistName || !artistId) return null;
  const search = new URL("https://www.wikidata.org/w/api.php");
  search.search = new URLSearchParams({ action: "wbsearchentities", format: "json", origin: "*", language: "en", type: "item", limit: "10", search: artistName }).toString();
  const searchData = await fetchArtistImageJson(search.toString());
  if (!searchData) return null;
  const entityIds = (searchData?.search || []).map((item) => item.id).filter(Boolean);
  if (!entityIds.length) return null;

  const entitiesUrl = new URL("https://www.wikidata.org/w/api.php");
  entitiesUrl.search = new URLSearchParams({ action: "wbgetentities", format: "json", origin: "*", languages: "en", props: "claims|descriptions|sitelinks", ids: entityIds.join("|") }).toString();
  const entitiesData = await fetchArtistImageJson(entitiesUrl.toString());
  if (!entitiesData) return null;
  const entities = Object.values(entitiesData?.entities || {});
  const entity = entities.find((item) =>
    (item?.claims?.P434 || []).some((claim) => String(claim?.mainsnak?.datavalue?.value || "") === String(artistId))
  );
  const description = entity?.descriptions?.en?.value || "";
  if (!entity?.id || !isMusicalArtistContext(description)) return null;
  const isGroup = isArtistGroupContext(description);
  const identity = { source: "Wikidata MusicBrainz ID match", url: `https://www.wikidata.org/wiki/${entity.id}` };
  const filename = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value || "";
  const primaryImage = filename ? await fetchCommonsArtistImage(filename, identity) : null;
  if (primaryImage) primaryImage.isPrimary = true;
  if (isStrongPrimaryArtistHero(primaryImage, isGroup)) return selectBestArtistHero([primaryImage], artistName, isGroup);
  const category = entity?.claims?.P373?.[0]?.mainsnak?.datavalue?.value || "";
  const categoryImages = await fetchVerifiedCommonsArtistCandidates(category, artistName, identity, isGroup);
  return selectBestArtistHero([primaryImage, ...categoryImages], artistName, isGroup);
}

async function fetchValidatedWikipediaSearchImage(artistName) {
  const endpoint = new URL("https://en.wikipedia.org/w/api.php");
  endpoint.search = new URLSearchParams({ action: "query", format: "json", origin: "*", generator: "search", gsrsearch: `intitle:\"${artistName}\" (band OR musician OR singer)`, gsrlimit: "5", prop: "pageimages|description|pageprops", piprop: "name", redirects: "1" }).toString();
  const data = await fetchArtistImageJson(endpoint.toString());
  if (!data) return null;
  const candidates = Object.values(data?.query?.pages || {})
    .filter((page) => isMusicalArtistContext(page.description))
    .filter((page) => normaliseCompare(page.title).includes(normaliseCompare(artistName)))
    .sort((a, b) => Number(a.index || 99) - Number(b.index || 99));
  const page = candidates[0];
  const wikidataId = String(page?.pageprops?.wikibase_item || "");
  if (wikidataId) {
    const linkedImage = await fetchWikidataArtistImage({ url: { resource: `https://www.wikidata.org/wiki/${wikidataId}` } });
    if (linkedImage) return linkedImage;
  }
  if (!page?.pageimage) return null;
  return await fetchCommonsArtistImage(page.pageimage, { source: "Validated Wikipedia search", url: `https://en.wikipedia.org/?curid=${page.pageid}` });
}

async function fetchArtistImagePremium(artistName, artistId = "", artistDetail = null) {
  if (!artistName) return { url: "", provider: "BOM placeholder", identitySource: "No artist identity" };
  const cached = readArtistImageCache(artistName, artistId);
  if (cached) return cached;

  const directImageRelation = getMusicBrainzRelation(artistDetail, "image");
  const directFilename = getCommonsFilename(directImageRelation?.url?.resource);
  let lowResolutionDirectImage = null;
  if (directFilename) {
    try {
      const directImage = await fetchCommonsArtistImage(directFilename, { source: "MusicBrainz image relation", url: directImageRelation.url.resource });
      if (directImage) {
        directImage.isPrimary = true;
        lowResolutionDirectImage = directImage;
      }
    } catch (error) { console.warn("MusicBrainz artist image failed", error); }
  }

  const isGroup = isArtistGroupContext(`${artistDetail?.type || ""} ${artistDetail?.disambiguation || ""}`);

  const wikidataRelation = getMusicBrainzRelation(artistDetail, "wikidata");
  if (wikidataRelation) {
    try {
      const wikidataImage = await fetchWikidataArtistImage(wikidataRelation);
      const selected = selectBestArtistHero([lowResolutionDirectImage, wikidataImage], artistName, isGroup);
      if (selected) return writeArtistImageCache(artistName, artistId, selected);
    } catch (error) { console.warn("Wikidata artist image failed", error); }
  }

  if (artistId) {
    try {
      const wikidataIdImage = await fetchWikidataArtistImageByMusicBrainzId(artistName, artistId);
      const selected = selectBestArtistHero([lowResolutionDirectImage, wikidataIdImage], artistName, isGroup);
      if (selected) return writeArtistImageCache(artistName, artistId, selected);
    } catch (error) { console.warn("Wikidata MusicBrainz ID image failed", error); }
  }

  if (LASTFM_API_KEY) {
    try {
      const response = await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artistName)}&api_key=${encodeURIComponent(LASTFM_API_KEY)}&format=json`);
      if (response.ok) {
        const data = await response.json();
        const best = [...(data?.artist?.image || [])].reverse().find((image) => image["#text"]);
        const url = String(best?.["#text"] || "").replace("lastfm.freetls.fastly.net", "lastfm-img2.akamaized.net");
        if (url && !/2a96cbd8b46e442fc41c2b86b821562f/i.test(url)) {
          return writeArtistImageCache(artistName, artistId, { url, provider: "Last.fm", identitySource: "Last.fm exact artist lookup", identityUrl: data?.artist?.url || "" });
        }
      }
    } catch (error) { console.warn("Last.fm artist image failed", error); }
  }

  try {
    const response = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}`);
    const data = await response.json();
    const match = (data?.data || []).find((artist) => normaliseCompare(artist.name) === normaliseCompare(artistName));
    const url = match?.picture_xl || match?.picture_big || match?.picture_medium || "";
    if (url) return writeArtistImageCache(artistName, artistId, { url, provider: "Deezer", identitySource: "Deezer exact artist match", identityUrl: match.link || "" });
  } catch (error) { console.warn("Deezer artist image failed", error); }

  try {
    const wikipediaImage = await fetchValidatedWikipediaSearchImage(artistName);
    if (wikipediaImage) return writeArtistImageCache(artistName, artistId, wikipediaImage);
  } catch (error) { console.warn("Wikipedia artist search failed", error); }

  if (lowResolutionDirectImage) return writeArtistImageCache(artistName, artistId, lowResolutionDirectImage);
  return {
    url: "",
    provider: "BOM placeholder",
    identitySource: artistDetail?.id
      ? `MusicBrainz identity ${artistDetail.id}; no validated photograph`
      : `MusicBrainz identity unavailable${artistId ? ` for ${artistId}` : ""}`
  };
}

async function cacheArtistImageToSupabase(artistName, remoteUrl) {
  if (!artistName || !remoteUrl || !currentUser) return remoteUrl;

  try {
    const safeName = artistName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const filePath = `${safeName}.jpg`;

    const imageResponse = await fetch(remoteUrl);

if (!imageResponse.ok) {
  console.warn("Artist image could not be fetched, using fallback:", remoteUrl);
  return remoteUrl;
}


    const imageBlob = await imageResponse.blob();
	
	console.log("Uploading artist image to Supabase:", filePath, imageBlob.type, imageBlob.size);


    const { error: uploadError } = await supabaseClient.storage
      .from("artist-images")
      .upload(filePath, imageBlob, {
        cacheControl: "3600",
        upsert: true,
        contentType: imageBlob.type || "image/jpeg"
      });

    if (uploadError) {
      console.error("Artist image upload failed", uploadError);
      return remoteUrl;
    }

    const { data } = supabaseClient.storage
      .from("artist-images")
      .getPublicUrl(filePath);

    return data?.publicUrl || remoteUrl;

  } catch (err) {
    console.error("Artist image cache failed", err?.message || err, err);
    return remoteUrl;
  }
}



const ALBUM_DETAIL_STORAGE_PREFIX =
  "bom_album_detail_v1_";

const ALBUM_DETAIL_CACHE_MAX_AGE_MS =
  1000 * 60 * 60 * 24 * 30;

function getStoredAlbumDetail(externalId) {
  if (!externalId) return null;

  try {
    const stored = JSON.parse(
      localStorage.getItem(
        ALBUM_DETAIL_STORAGE_PREFIX +
        externalId
      ) || "null"
    );

    if (!stored?.detail || !stored?.savedAt) {
      return null;
    }

    const age =
      Date.now() -
      Number(stored.savedAt);

    if (
      !Number.isFinite(age) ||
      age > ALBUM_DETAIL_CACHE_MAX_AGE_MS
    ) {
      localStorage.removeItem(
        ALBUM_DETAIL_STORAGE_PREFIX +
        externalId
      );

      return null;
    }

    return stored.detail;
  } catch {
    return null;
  }
}

function storeAlbumDetail(
  externalId,
  detail
) {
  if (!externalId || !detail) return;

  try {
    localStorage.setItem(
      ALBUM_DETAIL_STORAGE_PREFIX +
      externalId,
      JSON.stringify({
        savedAt: Date.now(),
        detail
      })
    );
  } catch (error) {
    console.warn(
      "Album track cache could not be stored:",
      error
    );
  }
}

async function fetchAlbumDetail(externalId) {
  const storedDetail =
    getStoredAlbumDetail(externalId);

  if (storedDetail) {
    albumTrackCache[externalId] =
      storedDetail;

    return storedDetail;
  }

  const url =
    `https://musicbrainz.org/ws/2/release/${encodeURIComponent(externalId)}` +
    `?inc=recordings+artist-credits+release-groups&fmt=json`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Album detail request failed: ${response.status}`
    );
  }

  const detail =
    await response.json();

  albumTrackCache[externalId] =
    detail;

  storeAlbumDetail(
    externalId,
    detail
  );

  return detail;
}

async function fetchReleaseGroupCover(releaseGroupId) {

  if (!releaseGroupId) return "";

  const coverUrl = `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`;

  try {

    const response = await fetch(coverUrl, { method: "HEAD" });

    return response.ok ? coverUrl : "";

  } catch {

    return "";

  }

}



const autoSavedTrackAlbums = new Set();

async function ensureTrackSongs(albumDetail, savedAlbumId) {
  if (!albumDetail || !savedAlbumId) return;

  const key = String(savedAlbumId);
  if (autoSavedTrackAlbums.has(key)) return;
  autoSavedTrackAlbums.add(key);

  for (const medium of albumDetail.media || []) {
    for (const track of medium.tracks || []) {
      await saveTrackFromAlbum(
        track.title || track.recording?.title || "",
        track.recording?.id || track.id || "",
        savedAlbumId
      );
    }
  }
}



function buildArtistBannerMarkup(artistName, bannerUrl) {
  const initial = artistName ? artistName.charAt(0).toUpperCase() : "?";

  return `
    <div class="artist-banner artist-banner-fallback">
      <div class="artist-banner-initial">${escapeHtml(initial)}</div>

      <div class="artist-banner-text">
        <div class="artist-banner-label">ARTIST</div>
        <div class="artist-banner-name">${escapeHtml(artistName)}</div>
      </div>
    </div>
  `;
}



function buildArtistTopTracksHtml(artistName) {

  const savedSongs = getSavedSongsByArtist(artistName);

  if (savedSongs.length === 0) {

    return `<p class="small">No saved top tracks for this artist yet.</p>`;

  }



  const rankedSongs = [...savedSongs].sort((a, b) => {

    const aAvg = getSongAverage(a.id);

    const bAvg = getSongAverage(b.id);

    const aScore = aAvg ? aAvg.avg * 100 + aAvg.count : 0;

    const bScore = bAvg ? bAvg.avg * 100 + bAvg.count : 0;

    return bScore - aScore;

  });



  return `

    <div class="artist-top-tracks">

      ${rankedSongs.slice(0, 8).map((song, index) => {

        const avgData = getSongAverage(song.id);

        const yourRating = getYourSongRating(song.id);

        return `

          <div class="artist-track-row" data-library-type="song" data-song-id="${song.id}">

            <div class="artist-track-number">${index + 1}</div>

            <div class="artist-track-main">

              <div class="artist-track-title">${escapeHtml(song.title)}</div>

              <div class="artist-track-meta">${song.album_id ? escapeHtml(getAlbumNameById(song.album_id)) : "Single / Unknown album"}</div>

            </div>

            <div class="artist-track-stats">

              <div>${avgData ? `⭐ ${avgData.avg.toFixed(1)} / 10` : "No ratings"}</div>

              <div>${yourRating !== null ? `You: ${yourRating}/10` : "Not rated"}</div>

            </div>

          </div>

        `;

      }).join("")}

    </div>

  `;

}



function buildArtistTopRatedAlbumsHtml(artistName) {

  const target = normaliseCompare(artistName);

  const rankedAlbums = allAlbums

    .filter((album) => normaliseCompare(album.artist) === target)

    .map((album) => {

      const avg = getAlbumAverage(album.id);

      return { ...album, avgScore: avg ? avg.avg : 0, ratingCount: avg ? avg.count : 0 };

    })

    .filter((album) => album.avgScore > 0)

    .sort((a, b) => {

      if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;

      return b.ratingCount - a.ratingCount;

    })

    .slice(0, 8);



  if (!rankedAlbums.length) return `<p class="small">No rated albums by this artist yet.</p>`;



  return buildHorizontalCarousel(

    rankedAlbums.map((album) => renderPosterCard(album, {

      type: "album",

      meta: `⭐ ${album.avgScore.toFixed(1)} / 10 (${album.ratingCount} rating${album.ratingCount === 1 ? "" : "s"})`,

      wrapperAttrs: `data-library-type="album" data-album-id="${album.id}"`

    })).join(""),

    "top-rated-albums-carousel"

  );

}

function buildStageOneArtistModel({ artistName, artistDetail, artistItem, imageUrl, imageMeta = null, albums, savedSongs }) {
  const normalizedAlbums = albums.map((album, sourceIndex) => {
    const albumId = album.savedAlbumId || album.localAlbumId || "";
    const average = albumId ? getAlbumAverage(albumId) : null;
    return {
      sourceIndex,
      albumId,
      title: album.title || "Untitled album",
      artworkUrl: album.coverUrl || "",
      releaseDate: album.releaseDate || "",
      releaseDatePrecision: album.release_date_precision || (albumId ? "stored" : "external"),
      community: average ? { average: Number(average.avg), count: Number(average.count || 0) } : null,
      personal: albumId ? getYourAlbumRating(albumId) : null
    };
  });

  const rankedAlbums = normalizedAlbums
    .filter((album) => album.community)
    .sort((a, b) => b.community.average - a.community.average || b.community.count - a.community.count || String(a.releaseDate || "9999").localeCompare(String(b.releaseDate || "9999")) || a.title.localeCompare(b.title));

  const rankedTracks = savedSongs
    .map((song) => {
      const average = getSongAverage(song.id);
      const album = song.album_id ? allAlbums.find((item) => Number(item.id) === Number(song.album_id)) : null;
      return average ? {
        songId: song.id,
        title: song.title || "Untitled track",
        albumId: album?.id || "",
        albumTitle: album?.title || getAlbumNameById(song.album_id) || "",
        albumYear: String(album?.release_date || "").slice(0, 4),
        artworkUrl: album ? getAlbumArtworkUrl(album) : "",
        community: { average: Number(average.avg), count: Number(average.count || 0) },
        personal: getYourSongRating(song.id)
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.community.average - a.community.average || b.community.count - a.community.count || a.albumYear.localeCompare(b.albumYear) || a.albumTitle.localeCompare(b.albumTitle) || a.title.localeCompare(b.title));

  let priorDisplayedScore = null;
  let priorRank = 0;
  rankedTracks.forEach((track, index) => {
    const displayedScore = track.community.average.toFixed(1);
    if (displayedScore !== priorDisplayedScore) priorRank = index + 1;
    track.rank = priorRank;
    priorDisplayedScore = displayedScore;
  });

  const metadata = [];
  const area = artistDetail?.area?.name || artistDetail?.begin_area?.name || "";
  const country = artistDetail?.country || artistItem.country || "";
  const start = artistDetail?.["life-span"]?.begin || "";
  const end = artistDetail?.["life-span"]?.end || "";
  if (area) metadata.push(area);
  else if (country) metadata.push(country);
  if (start) metadata.push(`${end ? "Active" : "Formed"} ${start.slice(0, 4)}${end ? `–${end.slice(0, 4)}` : ""}`);
  if (artistDetail?.type && artistDetail.type !== "Other") metadata.push(artistDetail.type);

  return {
    name: artistName,
    imageUrl,
    imageMeta,
    metadata,
    description: artistDetail?.disambiguation || artistItem.disambiguation || "",
    albums: normalizedAlbums,
    topTracks: rankedTracks,
    highestAlbum: rankedAlbums[0] || null,
    highestTrack: rankedTracks[0] || null,
    heroAdmin: { enabled: Boolean(isAdmin), hasManual: Boolean(imageMeta?.isManual) },
    backControlHtml: buildSelectedBackButton(),
    followControlHtml: isArtistFollowed(artistName)
      ? '<button type="button" class="bom-v1-artist-follow is-following" data-bom-artist-follow="false" aria-pressed="true">Following ✓</button>'
      : '<button type="button" class="bom-v1-artist-follow" data-bom-artist-follow="true" aria-pressed="false">+ Follow artist</button>'
  };
}

async function renderStageOneArtist(model, sourceAlbums) {
  if (!window.BOMArtistUI) await new Promise((resolve) => window.setTimeout(resolve, 0));
  if (!window.BOMArtistUI) throw new Error("Artist presentation did not load");
  selectedItemDetail.innerHTML = window.BOMArtistUI.render(model);
  selectedItemDetail.dataset.artistAlbums = JSON.stringify(sourceAlbums);
  window.BOMArtistUI.renderDiscography();
  window.BOMArtistUI.renderTracks();
  performance.mark?.("bom-artist-useful-content");
  updateStickyPlayer(selectedItem);
}

async function renderArtistDetail(artistItem) {

  if (!artistItem) return;

  const artistName =
    artistItem.name ||
    artistItem.artist ||
    "Unknown artist";

  if (isStageOnePresentation()) {
    if (!window.BOMArtistUI) await new Promise((resolve) => window.setTimeout(resolve, 0));
    if (window.BOMArtistUI) selectedItemDetail.innerHTML = window.BOMArtistUI.renderLoading(artistName, buildSelectedBackButton());
  }

  const savedAlbums =
    getSavedAlbumsByArtist(artistName);

  const savedSongs =
    getSavedSongsByArtist(artistName);

  const preferredArtistMusicBrainzId =
    artistItem.externalId ||
    artistItem.artistId ||
    getSelectedArtistIdFallback(artistName) ||
    await resolveArtistIdByName(artistName);

  const manualArtistHero = await loadManualArtistHero(artistName);

  // Resolve the image identity before the discography makes further
  // MusicBrainz requests. This keeps URL relationships off the rate-limit tail.
  if (preferredArtistMusicBrainzId && !manualArtistHero) await new Promise((resolve) => window.setTimeout(resolve, 1100));
  let imageIdentity = manualArtistHero
    ? { artistId: preferredArtistMusicBrainzId, detail: preferredArtistMusicBrainzId ? await fetchArtistDetail(preferredArtistMusicBrainzId) : null }
    : await resolveArtistIdentityForImage(artistName, preferredArtistMusicBrainzId);

  const completeDiscography =
    await fetchMostCompleteArtistDiscography({
      artistName,
      preferredArtistId:
        preferredArtistMusicBrainzId,
      savedAlbumCount:
        savedAlbums.length,
      expectedReleaseCount:
        Number(
          artistItem.releaseCount ||
          artistItem["release-count"] ||
          0
        )
    });

  const artistMusicBrainzId =
    completeDiscography.artistId ||
    preferredArtistMusicBrainzId;

  // The discography lookup can recover an identity after an earlier transient
  // MusicBrainz search failure. Reuse that verified ID before accepting the
  // placeholder so direct Artist links remain resilient without guessing.
  if (!manualArtistHero && !imageIdentity.detail && artistMusicBrainzId) {
    await new Promise((resolve) => window.setTimeout(resolve, 1100));
    imageIdentity = await resolveArtistIdentityForImage(artistName, artistMusicBrainzId);
  }

  const remoteAlbums =
    completeDiscography.albums || [];

  /*
    Build the displayed discography from MusicBrainz first,
    then attach any matching locally saved BoM album.

    Previously this page only mapped savedAlbums, so an artist
    with one album saved in BoM displayed only that one album,
    even when MusicBrainz returned their full discography.
  */
  const seenAlbumKeys = new Set();

  const displayAlbums = remoteAlbums
    .map((remoteAlbum) => {
      const albumKey =
        normaliseAlbumTitleKey(remoteAlbum.title || "");

      const savedAlbum =
        savedAlbums.find((album) => albumIdentityMatches(album, remoteAlbum)) || null;

      seenAlbumKeys.add(albumKey);

      return {
        ...remoteAlbum,

        artist:
          remoteAlbum.artist ||
          savedAlbum?.artist ||
          artistName,

        coverUrl:
          getAlbumArtworkUrl(savedAlbum) ||
          remoteAlbum.coverUrl ||
          "",

        releaseDate:
          savedAlbum?.release_date ||
          savedAlbum?.releaseDate ||
          remoteAlbum.releaseDate ||
          "",

        savedAlbumId:
          savedAlbum?.id || "",

        localAlbumId:
          savedAlbum?.id || ""
      };
    });

  /*
    Keep any locally saved albums that MusicBrainz did not return,
    for example a manual import or an unusual release.
  */
  savedAlbums.forEach((savedAlbum) => {
    const albumKey =
      normaliseAlbumTitleKey(savedAlbum.title || "");

    if (!albumKey || seenAlbumKeys.has(albumKey)) {
      return;
    }

    displayAlbums.push({
      type: "album",
      title: savedAlbum.title || "Untitled",
      artist: savedAlbum.artist || artistName,
      externalId: savedAlbum.external_id || "",
      releaseGroupId:
        savedAlbum.release_group_id ||
        savedAlbum.releaseGroupId ||
        "",
      artistId:
        artistMusicBrainzId ||
        savedAlbum.artist_id ||
        "",
      releaseDate:
        savedAlbum.release_date ||
        savedAlbum.releaseDate ||
        "",
      coverUrl: getAlbumArtworkUrl(savedAlbum),
      savedAlbumId: savedAlbum.id,
      localAlbumId: savedAlbum.id
    });
  });

  displayAlbums.sort((a, b) => {
    const dateComparison =
      String(a.releaseDate || "9999-99-99")
        .localeCompare(
          String(b.releaseDate || "9999-99-99")
        );

    if (dateComparison !== 0) {
      return dateComparison;
    }

    return String(a.title || "")
      .localeCompare(String(b.title || ""));
  });

  const artistDetail = imageIdentity.detail;
  const artistImageResult = await window.BOMArtistHeroPolicy.select(
    manualArtistHero,
    () => fetchArtistImagePremium(artistName, imageIdentity.artistId || artistMusicBrainzId, artistDetail)
  );
  const premiumArtistImage = artistImageResult?.url || "";

  const cachedArtistImage = "";

  const bannerUrl =
    cachedArtistImage ||
    premiumArtistImage ||
    displayAlbums.find(
      (album) => album.coverUrl
    )?.coverUrl ||
    "";

  const artistType =
    artistDetail?.type || "Artist";

  const artistCountry =
    artistDetail?.country ||
    artistItem.country ||
    "Unknown";

  const artistArea =
    artistDetail?.area?.name ||
    artistDetail?.begin_area?.name ||
    "";

  const disambiguation =
    artistDetail?.disambiguation ||
    artistItem.disambiguation ||
    "";

  const sortName =
    artistDetail?.["sort-name"] ||
    artistItem.sortName ||
    "";

  const lifeStart =
    artistDetail?.["life-span"]?.begin || "";

  const lifeEnd =
    artistDetail?.["life-span"]?.end || "";

  const tags =
    (artistDetail?.tags || [])
      .slice(0, 6)
      .map((tag) => tag.name)
      .filter(Boolean);

  if (isStageOnePresentation()) {
    await renderStageOneArtist(buildStageOneArtistModel({
      artistName,
      artistDetail,
      artistItem,
      // Stage 2B never promotes album artwork or generated avatars into the
      // artist-photo position. The presentation supplies its own quiet fallback.
      imageUrl: /(api\.dicebear\.com|2a96cbd8b46e442fc41c2b86b821562f)/i.test(premiumArtistImage || "")
        ? ""
        : premiumArtistImage,
      imageMeta: artistImageResult,
      albums: displayAlbums,
      savedSongs
    }), displayAlbums);
    return;
  }

  selectedItemDetail.innerHTML = `
    ${buildArtistBannerMarkup(
      artistName,
      bannerUrl
    )}

    <div class="detail-panel">
      <div class="detail-hero">
        <div>
          ${
            bannerUrl
              ? `
                <img
                  src="${escapeHtml(bannerUrl)}"
                  alt="${escapeHtml(artistName)} banner"
                  class="artist-banner-image"
                  loading="lazy"
                  onerror="this.style.display='none';"
                >
              `
              : `
                <div class="media-cover-placeholder-large">
                  ${escapeHtml(artistName)}
                </div>
              `
          }
        </div>

        <div class="detail-info-panel">
          <div class="media-title">
            ${escapeHtml(artistName)}
          </div>

          <div class="media-subtitle">
            ${escapeHtml(artistType)}
          </div>

          ${renderFollowControls(artistName)}

          <button
            class="artist-info-toggle"
            onclick="toggleArtistInfo()"
          >
            More info
          </button>

          <div
            id="artistInfoPanel"
            class="detail-meta-grid artist-info-panel collapsed"
          >
            <div class="detail-meta-label">
              Country
            </div>

            <div class="detail-meta-value">
              ${escapeHtml(artistCountry)}
            </div>

            <div class="detail-meta-label">
              Area
            </div>

            <div class="detail-meta-value">
              ${
                artistArea
                  ? escapeHtml(artistArea)
                  : "Unknown"
              }
            </div>

            <div class="detail-meta-label">
              Also known as
            </div>

            <div class="detail-meta-value">
              ${
                sortName
                  ? escapeHtml(sortName)
                  : "—"
              }
            </div>

            <div class="detail-meta-label">
              Active since
            </div>

            <div class="detail-meta-value">
              ${
                lifeStart
                  ? escapeHtml(lifeStart)
                  : "Unknown"
              }
            </div>

            <div class="detail-meta-label">
              Ended
            </div>

            <div class="detail-meta-value">
              ${
                lifeEnd
                  ? escapeHtml(lifeEnd)
                  : "Still active / Unknown"
              }
            </div>

            <div class="detail-meta-label">
              Studio albums shown
            </div>

            <div class="detail-meta-value">
              ${displayAlbums.length}
            </div>

            <div class="detail-meta-label">
              Saved tracks
            </div>

            <div class="detail-meta-value">
              ${savedSongs.length}
            </div>
          </div>

          ${
            disambiguation
              ? `
                <div class="artist-bio-box">
                  ${escapeHtml(disambiguation)}
                </div>
              `
              : ""
          }

          ${
            tags.length
              ? `
                <div class="artist-tags">
                  ${tags
                    .map(
                      (tag) => `
                        <span class="artist-tag">
                          ${escapeHtml(tag)}
                        </span>
                      `
                    )
                    .join("")}
                </div>
              `
              : ""
          }
        </div>
      </div>

      <div class="section-divider">
        Top tracks
      </div>

      ${buildArtistTopTracksHtml(artistName)}

      <div class="section-divider">
        Most rated albums by
        ${escapeHtml(artistName)}
      </div>

      ${buildArtistTopRatedAlbumsHtml(
        artistName
      )}

      <div class="section-divider">
        Studio albums - chronological discography
      </div>

      ${
        displayAlbums.length
          ? `
            <div class="artist-albums-grid">
              ${displayAlbums
                .map((album, index) => {
                  const cardAttributes =
                    album.savedAlbumId
                      ? `
                        data-library-type="album"
                        data-album-id="${escapeHtml(
                          album.savedAlbumId
                        )}"
                      `
                      : `
                        data-artist-album-index="${index}"
                      `;

                  return `
                    <div
                      class="poster-card artist-album-card"
                      ${cardAttributes}
                    >
                      ${getPosterCoverMarkup(
                        album.coverUrl,
                        `${album.title} cover`
                      )}

                      <div class="poster-body">
                        <div class="poster-title">
                          ${escapeHtml(album.title)}
                        </div>

                        <div class="poster-subtitle">
                          ${escapeHtml(
                            album.artist || artistName
                          )}
                        </div>

                        ${
                          album.releaseDate
                            ? `
                              <div class="poster-meta">
                                ${escapeHtml(
                                  album.releaseDate
                                )}
                              </div>
                            `
                            : ""
                        }
                      </div>
                    </div>
                  `;
                })
                .join("")}
            </div>
          `
          : `
            <p class="small">
              No studio album data found.
            </p>
          `
      }
    </div>
  `;

  /*
    The click handler uses this array for albums that have not
    yet been saved locally, so it must match the displayed order.
  */
  selectedItemDetail.dataset.artistAlbums =
    JSON.stringify(displayAlbums);
}



function isStageOnePresentation() {
  return new URLSearchParams(window.location.search).get("ui") !== "legacy";
}

function buildCompactTrackRatingControl(songId, currentValue) {
  if (!songId) return "";
  const hasRating = currentValue !== null && Number.isFinite(Number(currentValue));
  const targetId = `track-rating-${songId}`;
  return `<details class="bom-v1-track-rating-control">
    <summary class="bom-v1-track-rating-trigger" aria-label="${hasRating ? `Change rating, currently ${Number(currentValue)} out of 10` : "Rate this track"}">${hasRating ? `${Number(currentValue)} / 10` : "Rate +"}</summary>
    <div class="bom-v1-track-rating-popover" role="group" aria-label="Rate this track from 1 to 10">
      ${Array.from({ length: 10 }, (_, index) => {
        const rating = index + 1;
        return `<button type="button" class="bom-v1-track-rating-choice${rating === Number(currentValue) ? " is-selected" : ""}" data-target-input="${targetId}" data-rating="${rating}" aria-label="Rate ${rating} out of 10" onclick="handleStarOptionClick(event, this); return false;">${rating}</button>`;
      }).join("")}
      ${hasRating ? `<button type="button" class="bom-v1-track-rating-clear delete-track-rating-btn" data-clear-track-rating="${songId}">Clear</button>` : ""}
    </div>
  </details><input type="hidden" id="${targetId}" value="${hasRating ? Number(currentValue) : ""}">`;
}

function buildCompactAlbumRatingControl(albumId, currentValue) {
  if (!albumId) return "";
  const hasRating = currentValue !== null && Number.isFinite(Number(currentValue));
  const targetId = `album-rating-${albumId}`;
  return `<details class="bom-v1-album-rating-control" data-bom-album-rating="${albumId}">
    <summary class="bom-v1-album-rating-trigger" aria-label="${hasRating ? `Change album rating, currently ${Number(currentValue)} out of 10` : "Rate this album"}">${hasRating ? `<strong>${Number(currentValue)}</strong><span> / 10</span><small>Change</small>` : "Rate +"}</summary>
    <div class="bom-v1-album-rating-popover" role="group" aria-label="Rate this album from 1 to 10">
      ${Array.from({ length: 10 }, (_, index) => {
        const rating = index + 1;
        return `<button type="button" class="bom-v1-album-rating-choice${rating === Number(currentValue) ? " is-selected" : ""}" data-target-input="${targetId}" data-rating="${rating}" aria-label="Rate ${rating} out of 10" onclick="handleStarOptionClick(event, this); return false;">${rating}</button>`;
      }).join("")}
      ${hasRating ? `<button type="button" class="bom-v1-album-rating-clear" data-clear-album-rating="${albumId}">Clear</button>` : ""}
    </div>
  </details><input type="hidden" id="${targetId}" value="${hasRating ? Number(currentValue) : ""}">`;
}

function buildStageOneAlbumTrackModels(detail, savedAlbumId) {
  const albumTitle = detail?.title || selectedItem?.title || "";
  const artist = detail?.["artist-credit"]?.map((credit) => credit.name).filter(Boolean).join(", ") || selectedItem?.artist || "";
  const albumSongs = (allSongs || []).filter((song) => Number(song.is_deleted || 0) === 0 && Number(song.album_id) === Number(savedAlbumId));
  const rows = [];
  const seenSongIds = new Set();
  const seenExternalIds = new Set();
  let fallbackNumber = 1;

  const addTrack = ({ track = null, savedSong = null, isManual = false }) => {
    const rawTitle = savedSong?.title || track?.title || track?.recording?.title || "Untitled track";
    const title = String(rawTitle).replace(/\\[uU]([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
    const number = Number(savedSong?.track_position || track?.position || fallbackNumber) || fallbackNumber;
    const externalId = savedSong?.external_id || track?.recording?.id || "";
    const averageData = savedSong ? getSongAverage(savedSong.id) : null;
    const community = averageData ? { average: Number(averageData.avg), count: Number(averageData.count || 0) } : null;
    const personal = savedSong
      ? (getYourSongRating(savedSong.id) ?? getYourSongRatingByTitleArtist(title, savedSong.artist || artist))
      : getYourSongRatingByTitleArtist(title, artist);
    if (savedSong?.id) seenSongIds.add(Number(savedSong.id));
    if (savedSong?.external_id) seenExternalIds.add(String(savedSong.external_id));
    rows.push({
      index: Math.max(0, number - 1), number, title, artist, album: albumTitle,
      durationMs: Number(track?.length || track?.recording?.length || 0) || null,
      songId: savedSong?.id || null, externalId, community, personal, isManual,
      ratingControlHtml: savedSong?.id ? buildCompactTrackRatingControl(savedSong.id, personal) : "",
      saveControlHtml: savedSong?.id ? "" : `<button class="save-track-btn" data-action="save-track" data-track-title="${escapeHtml(title)}" data-track-external-id="${escapeHtml(externalId)}" data-album-id="${savedAlbumId || ""}" aria-label="Save ${escapeHtml(title)}">Save</button>`
    });
    fallbackNumber += 1;
  };

  for (const medium of detail?.media || []) {
    for (const track of medium.tracks || []) {
      const trackTitle = track.title || track.recording?.title || "Untitled track";
      const externalId = track.recording?.id || "";
      const savedSong = albumSongs.find((song) => externalId && String(song.external_id || "") === String(externalId)) ||
        albumSongs.find((song) => normaliseCompare(song.title || "") === normaliseCompare(trackTitle)) || null;
      addTrack({ track, savedSong, isManual: savedSong?.external_source === "manual" });
    }
  }

  albumSongs
    .filter((song) => !seenSongIds.has(Number(song.id)))
    .filter((song) => !song.external_id || !seenExternalIds.has(String(song.external_id)))
    .forEach((song) => addTrack({ savedSong: song, isManual: song.external_source === "manual" || !song.external_source }));

  rows.sort((a, b) => a.number - b.number || a.title.localeCompare(b.title));
  const rated = rows.filter((row) => row.community).sort((a, b) => b.community.average - a.community.average);
  const topThreshold = rated.length ? rated[Math.min(2, rated.length - 1)].community.average : null;
  rows.forEach((row) => { row.isTopTrack = topThreshold !== null && row.community?.average >= topThreshold; });
  return rows;
}

function buildStageOneAlbumModel({ album, detail, albumId, artworkUrl, artist, community, personal, releaseDate, releaseDateSource = "external" }) {
  const tracks = buildStageOneAlbumTrackModels(detail, albumId);
  const knownDurations = tracks.map((track) => track.durationMs).filter((value) => Number.isFinite(value) && value > 0);
  return {
    albumId,
    title: detail?.title || album?.title || selectedItem?.title || "Unknown album",
    artist,
    artworkUrl,
    releaseDate: releaseDate || "",
    releaseDatePrecision: album?.release_date_precision || album?.releaseDatePrecision || releaseDateSource,
    trackCount: tracks.length,
    durationMs: knownDurations.length === tracks.length && tracks.length ? knownDurations.reduce((sum, value) => sum + value, 0) : null,
    community: community ? { average: Number(community.avg), count: Number(community.count || 0) } : null,
    personal,
    tracks,
    backControlHtml: buildSelectedBackButton(),
    artistControlHtml: renderClickableArtistName(artist),
    albumRatingControlHtml: albumId ? buildCompactAlbumRatingControl(albumId, personal) : '<button id="importSelectedAlbumBtn">Save album</button>',
    providerControlHtml: buildMusicProviderPanel({ type: "album", title: detail?.title || album?.title || selectedItem?.title || "", artist }).replace(">Play here<", ">Listen elsewhere<"),
    shareControlHtml: buildSelectedSharePanel(selectedItem).replace(">Send<", ">Share album<"),
    adminControlHtml: typeof renderSelectedAdminControls === "function" ? renderSelectedAdminControls({ albumId }) : ""
  };
}

async function renderStageOneAlbum(model) {
  if (!window.BOMAlbumUI) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  if (!window.BOMAlbumUI) throw new Error("Album presentation did not load");
  selectedItemDetail.innerHTML = window.BOMAlbumUI.render(model);
  selectedItemDetail.dataset.bomAlbumSource = model.albumId ? "production" : "external";
  performance.mark?.("bom-album-useful-content");
  updateStickyPlayer(selectedItem);
  scheduleSpotifyTrackCacheWarmup();
  void hydrateStageOneAlbumReviews(model.albumId);
}

async function hydrateStageOneAlbumReviews(albumId) {
  if (!albumId || !window.BOMAlbumUI) {
    window.BOMAlbumUI?.renderReviews(window.BOMUI.SectionState({ title: "No reviews yet", message: "Reviews are available after this album is saved." }));
    return;
  }
  try {
    const reviews = await loadAlbumReviews(albumId, { throwOnError: true });
    if (document.querySelector("[data-bom-album-id]")?.dataset.bomAlbumId !== String(albumId)) return;
    window.BOMAlbumUI.renderReviews(renderAlbumReviewsSection(albumId, reviews));
  } catch (error) {
    console.warn("Album reviews unavailable", error?.message || error);
    window.BOMAlbumUI.renderReviews(`<header class="bom-v1-album-section-header"><h2>Reviews</h2></header>${window.BOMUI.SectionState({ title: "Reviews unavailable", message: "The album is still available.", actionLabel: "Retry", action: "retry-album-reviews" })}`);
  }
}

window.addEventListener("click", (event) => {
  if (event.target.closest('[data-bom-action="retry-album-reviews"]')) {
    const albumId = document.querySelector("[data-bom-album-id]")?.dataset.bomAlbumId;
    void hydrateStageOneAlbumReviews(albumId);
  }
});

window.addEventListener("click", async (event) => {
  const clearButton = event.target.closest("[data-clear-track-rating]");
  if (!clearButton) return;
  event.preventDefault();
  event.stopPropagation();
  await deleteTrackRating(clearButton.dataset.clearTrackRating);
});

window.addEventListener("click", async (event) => {
  const clearButton = event.target.closest("[data-clear-album-rating]");
  if (!clearButton) return;
  event.preventDefault();
  event.stopPropagation();
  await deleteAlbumRating(clearButton.dataset.clearAlbumRating);
});

function buildTrackListHtml(detail, savedAlbumId) {

  const trackAlbumTitle =
    detail?.title ||
    selectedItem?.title ||
    "";

  const trackArtistName =
    detail?.["artist-credit"]
      ?.map((credit) => credit.name)
      .filter(Boolean)
      .join(", ") ||
    selectedItem?.artist ||
    "";

  const trackRows = [];
  const seenSongIds = new Set();
  const seenExternalIds = new Set();

  function getTrackSortPosition(song, fallbackPosition) {
    const manualPosition = Number(song?.track_position || 0);
    if (manualPosition > 0) return manualPosition;
    return fallbackPosition;
  }

  function buildTrackRow({
  number,
  sortPosition,
  title,
  externalId = "",
  savedSong = null,
  isManual = false
}) {
  if (savedSong?.id) seenSongIds.add(Number(savedSong.id));
  if (savedSong?.external_id) seenExternalIds.add(String(savedSong.external_id));

  const avgData = savedSong ? getSongAverage(savedSong.id) : null;

  const yourRating = savedSong
    ? (
        getYourSongRating(savedSong.id) ??
        getYourSongRatingByTitleArtist(
          title,
          savedSong.artist || trackArtistName
        )
      )
    : getYourSongRatingByTitleArtist(
        title,
        trackArtistName
      );

  return {
    sortPosition,
    html: `
      <div class="track-row-table" data-track-index="${number - 1}" data-song-id="${savedSong ? savedSong.id : ""}">
        <div class="track-col-number">${number}</div>

        <div class="track-col-title">
          ${escapeHtml(title)}
          ${isManual ? `<div class="track-admin-note">Manual track</div>` : ""}
        </div>

        <div class="track-col-average">
          ${avgData ? `⭐ ${avgData.avg.toFixed(1)} / 10` : "No ratings"}
        </div>

        <div class="track-col-your-rating ${yourRating !== null ? "has-rating" : ""}">
          ${yourRating !== null ? `${yourRating}/10` : "—"}
        </div>

        <div class="track-col-stars">
          ${savedSong?.id ? renderStarSelector(`track-rating-${savedSong.id}`, yourRating) : ""}
        </div>

        <div class="track-col-actions">
          <button
            type="button"
            class="track-preview-btn"
            data-track-preview="true"
            data-provider-type="song"
            data-provider-title="${escapeHtml(title)}"
            data-provider-artist="${escapeHtml(trackArtistName)}"
            data-provider-album="${escapeHtml(trackAlbumTitle)}"
            title="Preview ${escapeHtml(title)}"
            aria-label="Preview ${escapeHtml(title)}"
          >
            <span class="track-preview-icon" aria-hidden="true">▶</span>
            <span class="track-preview-label">Play preview</span>
          </button>

          ${savedSong?.id
            ? ""
            : `<button class="save-track-btn"
                 data-action="save-track"
                 data-track-title="${escapeHtml(title)}"
                 data-track-external-id="${escapeHtml(externalId)}"
                 data-album-id="${savedAlbumId}">
                 💾
               </button>`
          }
        </div>
      </div>
    `
  };
}


  let trackNumber = 1;

  for (const medium of detail.media || []) {
    for (const track of medium.tracks || []) {
      const trackTitle = String(track.title || track.recording?.title || "Untitled track")
  .replace(/\\[uU]([0-9a-fA-F]{4})/g, (_, code) =>
    String.fromCharCode(parseInt(code, 16))
  );
      const externalId = track.recording?.id || "";

      const albumSongPool = (allSongs || []).filter(song =>
  Number(song.is_deleted || 0) === 0 &&
  Number(song.album_id) === Number(savedAlbumId)
);

const savedSong =
  albumSongPool.find(song =>
    externalId &&
    String(song.external_id || "") === String(externalId)
  ) ||
  albumSongPool.find(song =>
    normaliseCompare(song.title || "") === normaliseCompare(trackTitle || "")
  ) ||
  null;

console.log("SAVED SONG FOUND?", {
  externalId,
  savedSong,
  trackTitle
});
  
  console.log("SAVED SONG FOUND?", {
  trackTitle,
  externalId,
  savedSong
});



      trackRows.push(buildTrackRow({
  number: getTrackSortPosition(savedSong, trackNumber),
  sortPosition: getTrackSortPosition(savedSong, trackNumber),
  title: savedSong?.title || trackTitle,
  externalId: savedSong?.external_id || externalId,
  savedSong: savedSong,
  isManual: savedSong?.external_source === "manual"
}));

      trackNumber += 1;
    }
  }

  if (savedAlbumId) {
    const manualOrExtraTracks = allSongs
      .filter((song) => Number(song.album_id) === Number(savedAlbumId))
      .filter((song) => !seenSongIds.has(Number(song.id)))
      .filter((song) => !song.external_id || !seenExternalIds.has(String(song.external_id)));

    manualOrExtraTracks.forEach((song, index) => {
      const sortPosition = getTrackSortPosition(song, trackNumber + index);
      trackRows.push(buildTrackRow({
        number: sortPosition,
        sortPosition,
        title: song.title || "Untitled track",
        externalId: song.external_id || "",
        savedSong: song,
        isManual: song.external_source === "manual" || !song.external_source
      }));
    });
  }

  trackRows.sort((a, b) => {
    if (a.sortPosition !== b.sortPosition) return a.sortPosition - b.sortPosition;
    return String(a.html).localeCompare(String(b.html));
  });

  if (trackRows.length === 0) {
    return `<p class="small">No track list available.</p>`;
  }

  scheduleSpotifyTrackCacheWarmup();

  return `
    <div class="section-divider">Tracks</div>

    <div
      id="albumTrackPreviewDock"
      class="album-track-preview-dock hidden"
      aria-live="polite"
    ></div>

    <div class="track-table">
      <div class="track-header">
        <div>#</div>
        <div>Track</div>
        <div>Average</div>
        <div>Your rating</div>
        <div>Rate</div>
        <div>Play</div>
      </div>
      ${trackRows.map((row) => row.html).join("")}
    </div>
  `;

}




/* v27: Share/send-to-friend visibility guard */
function shouldShowSendToFriend(item) {
return !!item && (item.type === "album" || item.type === "song");
}

/* v27: force-hide any global share/send controls unless an album/song is selected */
function updateSendToFriendVisibility() {
const visible = shouldShowSendToFriend(window.selectedItem || selectedItem);
document.querySelectorAll(
  "#sendToFriendBtn, #shareSelectedBtn, .send-to-friend-btn, .send-to-friend, .share-selected-btn, .share-friend-control"
).forEach((el) => {
  const insideSelected =
    el.closest("#selectedItemDetail") ||
    el.closest("#selectedSection") ||
    el.closest("#detailSection");

  if (!insideSelected) {
    el.classList.toggle("hidden", !visible);
    el.style.display = visible ? "" : "none";
  }
});
}

const MAX_REVIEW_LENGTH = 500;
const MAX_REVIEW_COMMENT_LENGTH = 500;
const expandedReviewCommentIds = new Set();
let editingAlbumReviewCommentId = null;

async function loadAlbumReviews(albumId, { throwOnError = false } = {}) {
  const { data: reviews, error } = await supabaseClient
    .from("album_reviews")
    .select("*")
    .eq("album_id", Number(albumId))
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Load album reviews error", error);
    if (throwOnError) throw error;
    return [];
  }

  if (!reviews?.length) {
    return [];
  }

  const reviewIds = reviews.map((review) => review.id).filter(Boolean);
  const { data: likes, error: likesError } = await supabaseClient
    .from("album_review_likes")
    .select("review_id,user_id")
    .in("review_id", reviewIds);

  if (likesError) {
    console.error("Review likes lookup error", likesError);
  }

  const { data: comments, error: commentsError } = await supabaseClient
    .from("album_review_comments")
    .select("id,review_id,user_id,comment_text,created_at,updated_at")
    .in("review_id", reviewIds)
    .order("created_at", { ascending: true });

  if (commentsError) {
    console.error("Review comments lookup error", commentsError);
  }

  const userIds = [
    ...new Set(
      [...reviews, ...(comments || [])]
        .map((item) => item.user_id)
        .filter(Boolean)
    )
  ];

  let profilesById = {};

  if (userIds.length) {
    const { data: profiles, error: profilesError } = await supabaseClient
      .from("profiles")
      .select("id, handle, member_number")
      .in("id", userIds);

    if (profilesError) {
      console.error("Review profile lookup error", profilesError);
    } else {
      profilesById = Object.fromEntries(
        (profiles || []).map((profile) => [
          profile.id,
          profile
        ])
      );
    }
  }

  return reviews.map((review) => ({
    ...review,
    profile: profilesById[review.user_id] || null,
    comments: (comments || [])
      .filter((comment) => comment.review_id === review.id)
      .map((comment) => ({
        ...comment,
        profile: profilesById[comment.user_id] || null
      })),
    like_count: (likes || []).filter((like) => like.review_id === review.id).length,
    liked_by_current_user: Boolean(
      currentUser && (likes || []).some((like) =>
        like.review_id === review.id && like.user_id === currentUser.id
      )
    )
  }));
}

async function toggleAlbumReviewLike(reviewId, reviewOwnerId, albumId, currentlyLiked) {
  if (!currentUser) {
    alert("Please log in to like a review.");
    return;
  }
  if (currentUser.id === reviewOwnerId) return;

  const request = currentlyLiked
    ? supabaseClient
        .from("album_review_likes")
        .delete()
        .eq("review_id", reviewId)
        .eq("user_id", currentUser.id)
    : supabaseClient
        .from("album_review_likes")
        .insert({ review_id: reviewId, user_id: currentUser.id });
  const { error } = await request;

  if (error) {
    console.error("Toggle review like error", error);
    return;
  }

  const reviews = await loadAlbumReviews(albumId);
  const section = document.querySelector(".album-reviews-section");
  if (section) section.outerHTML = renderAlbumReviewsSection(albumId, reviews);
}

window.toggleAlbumReviewLike = toggleAlbumReviewLike;

async function refreshAlbumReviewSection(albumId) {
  const reviews = await loadAlbumReviews(albumId);
  const section = document.querySelector(".album-reviews-section");
  if (section) section.outerHTML = renderAlbumReviewsSection(albumId, reviews);
}

function toggleAlbumReviewComments(reviewId) {
  const comments = document.querySelector(`[data-review-comments="${reviewId}"]`);
  const toggle = document.querySelector(`[data-review-comments-toggle="${reviewId}"]`);
  if (!comments) return;
  const willExpand = comments.classList.contains("hidden");
  comments.classList.toggle("hidden", !willExpand);
  if (willExpand) expandedReviewCommentIds.add(reviewId);
  else expandedReviewCommentIds.delete(reviewId);
  if (toggle) toggle.setAttribute("aria-expanded", willExpand ? "true" : "false");
}

async function saveAlbumReviewComment(reviewId, albumId, commentId = "") {
  if (!currentUser) return;
  const suffix = commentId || reviewId;
  const input = document.getElementById(`reviewCommentInput-${suffix}`);
  const message = document.getElementById(`reviewCommentMessage-${reviewId}`);
  const commentText = input?.value.trim() || "";
  if (!commentText || commentText.length > MAX_REVIEW_COMMENT_LENGTH) {
    if (message) message.textContent = `Comments must be 1–${MAX_REVIEW_COMMENT_LENGTH} characters.`;
    return;
  }

  const request = commentId
    ? supabaseClient
        .from("album_review_comments")
        .update({ comment_text: commentText, updated_at: new Date().toISOString() })
        .eq("id", commentId)
        .eq("user_id", currentUser.id)
    : supabaseClient.from("album_review_comments").insert({
        review_id: reviewId,
        user_id: currentUser.id,
        comment_text: commentText
      });
  const { error } = await request;
  if (error) {
    if (message) message.textContent = error.message;
    return;
  }
  expandedReviewCommentIds.add(reviewId);
  editingAlbumReviewCommentId = null;
  await refreshAlbumReviewSection(albumId);
}

async function deleteAlbumReviewComment(commentId, reviewId, albumId) {
  if (!currentUser || (!isAdmin && !confirm("Delete this comment?"))) return;
  const { error } = await supabaseClient
    .from("album_review_comments")
    .delete()
    .eq("id", commentId);
  if (error) {
    console.error("Delete review comment error", error);
    return;
  }
  expandedReviewCommentIds.add(reviewId);
  await refreshAlbumReviewSection(albumId);
}

async function editAlbumReviewComment(commentId, reviewId, albumId) {
  editingAlbumReviewCommentId = commentId;
  expandedReviewCommentIds.add(reviewId);
  await refreshAlbumReviewSection(albumId);
  document.getElementById(`reviewCommentInput-${commentId}`)?.focus();
}

window.toggleAlbumReviewComments = toggleAlbumReviewComments;
window.saveAlbumReviewComment = saveAlbumReviewComment;
window.deleteAlbumReviewComment = deleteAlbumReviewComment;
window.editAlbumReviewComment = editAlbumReviewComment;

function renderAlbumReviewLikeControl(albumId, review) {
  const count = Number(review.like_count || 0);
  const countLabel = `${count} like${count === 1 ? "" : "s"}`;
  if (!currentUser || currentUser.id === review.user_id) {
    return `<span class="review-like-count">${countLabel}</span>`;
  }
  return `<button
    type="button"
    class="review-like-btn${review.liked_by_current_user ? " is-liked" : ""}"
    aria-pressed="${review.liked_by_current_user ? "true" : "false"}"
    onclick="toggleAlbumReviewLike('${escapeHtml(review.id)}', '${escapeHtml(review.user_id)}', ${Number(albumId)}, ${review.liked_by_current_user ? "true" : "false"})"
  >${review.liked_by_current_user ? "Unlike" : "Like"} · ${countLabel}</button>`;
}

function renderAlbumReviewComments(albumId, review) {
  const comments = review.comments || [];
  const expanded = expandedReviewCommentIds.has(review.id);
  return `
    <div class="review-comment-controls">
      <button type="button" class="review-comment-toggle" data-review-comments-toggle="${escapeHtml(review.id)}"
        aria-expanded="${expanded ? "true" : "false"}"
        onclick="toggleAlbumReviewComments('${escapeHtml(review.id)}')">
        ${comments.length} comment${comments.length === 1 ? "" : "s"}
      </button>
    </div>
    <div class="review-comments${expanded ? "" : " hidden"}" data-review-comments="${escapeHtml(review.id)}">
      ${comments.length ? comments.map((comment) => {
        const ownsComment = currentUser?.id === comment.user_id;
        const canDelete = ownsComment || isAdmin;
        const isEditing = ownsComment && editingAlbumReviewCommentId === comment.id;
        return `<div class="review-comment" data-comment-id="${escapeHtml(comment.id)}">
          <div class="review-comment-meta">
            <span>${renderClickableProfileHandle(comment.profile, comment.user_id, "Member")}</span>
            <time>${new Date(comment.updated_at || comment.created_at).toLocaleDateString()}</time>
          </div>
          ${isEditing ? `
            <textarea id="reviewCommentInput-${escapeHtml(comment.id)}" maxlength="${MAX_REVIEW_COMMENT_LENGTH}">${escapeHtml(comment.comment_text)}</textarea>
            <div class="review-comment-actions">
              <button type="button" onclick="saveAlbumReviewComment('${escapeHtml(review.id)}', ${Number(albumId)}, '${escapeHtml(comment.id)}')">Save</button>
            </div>
          ` : `<p>${escapeHtml(comment.comment_text)}</p>`}
          ${!isEditing && (ownsComment || canDelete) ? `<div class="review-comment-actions">
            ${ownsComment ? `<button type="button" onclick="editAlbumReviewComment('${escapeHtml(comment.id)}', '${escapeHtml(review.id)}', ${Number(albumId)})">Edit</button>` : ""}
            ${canDelete ? `<button type="button" class="danger-link" onclick="deleteAlbumReviewComment('${escapeHtml(comment.id)}', '${escapeHtml(review.id)}', ${Number(albumId)})">Delete${isAdmin && !ownsComment ? " as Admin" : ""}</button>` : ""}
          </div>` : ""}
        </div>`;
      }).join("") : `<p class="small">No comments yet.</p>`}
      ${currentUser ? `<div class="review-comment-form">
        <textarea id="reviewCommentInput-${escapeHtml(review.id)}" maxlength="${MAX_REVIEW_COMMENT_LENGTH}" placeholder="Add a comment"></textarea>
        <button type="button" onclick="saveAlbumReviewComment('${escapeHtml(review.id)}', ${Number(albumId)})">Add comment</button>
      </div>` : ""}
      <p id="reviewCommentMessage-${escapeHtml(review.id)}" class="small review-comment-message"></p>
    </div>`;
}

async function saveAlbumReview(albumId) {
  if (!currentUser) {
    alert("Please log in to write a review.");
    return;
  }

  const textarea = document.getElementById("albumReviewText");
  const message = document.getElementById("albumReviewMessage");

  if (!textarea) return;

  const reviewText = textarea.value.trim();

  if (!reviewText) {
  if (message) message.textContent = "Please write a review first.";
  return;
}

  if (reviewText.length > MAX_REVIEW_LENGTH) {
  if (message) message.textContent = "Review is too long. Maximum 500 characters.";
  return;
}

  const { error } = await supabaseClient
    .from("album_reviews")
    .upsert({
      user_id: currentUser.id,
      album_id: Number(albumId),
      review_text: reviewText,
      updated_at: new Date().toISOString()
    }, {
      onConflict: "user_id,album_id"
    });

  if (error) {
    console.error("Save album review error", error);
    message.textContent = error.message;
    return;
  }

  message.textContent = "Review posted.";

await renderSelectedItem();

setTimeout(() => {
  const reviewsSection = document.querySelector(".album-reviews-section");
  const newMessage = document.getElementById("albumReviewMessage");

  if (reviewsSection) {
    reviewsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (newMessage) {
    newMessage.textContent = "Review posted.";
  }
}, 100);
}

window.saveAlbumReview = saveAlbumReview;

function renderAlbumReviewsSection(albumId, reviews = []) {
  const myReview = currentUser
    ? reviews.find((review) => review.user_id === currentUser.id)
    : null;

  const otherReviews = reviews.filter((review) =>
    !currentUser || review.user_id !== currentUser.id
  );

  const reviewCount = reviews.length;

  return `
    <section class="album-reviews-section">
      <div class="reviews-header">
        <h3>Reviews</h3>

        <span class="review-count">
          ${reviewCount} review${reviewCount === 1 ? "" : "s"}
        </span>
      </div>

      ${
        myReview
          ? `
            <div class="posted-review-card">
              <div class="posted-review-top">
                <div>
                  <strong>Your review</strong>

                  <div class="review-author-line">
                    ${renderClickableProfileHandle(
                      currentProfile,
                      currentUser?.id,
                      "You"
                    )}
                  </div>
                </div>

                <button type="button" onclick="toggleReviewEditor()">
                  Edit review
                </button>
              </div>

              <p>${escapeHtml(myReview.review_text)}</p>

              <div class="review-date">
                Posted ${new Date(
                  myReview.updated_at || myReview.created_at
                ).toLocaleDateString()}
              </div>

              <div class="review-actions">
                ${renderAlbumReviewLikeControl(albumId, myReview)}
              </div>
              ${renderAlbumReviewComments(albumId, myReview)}
            </div>

            <div id="reviewEditor" class="review-write-box hidden">
          `
          : `
            <div id="reviewEditor" class="review-write-box">
          `
      }

        <label for="albumReviewText">
          ${myReview ? "Edit your review" : "Write your review"}
        </label>

        <textarea
          id="albumReviewText"
          maxlength="${MAX_REVIEW_LENGTH}"
          placeholder="What did you think of this album?"
          oninput="document.getElementById('albumReviewCount').textContent = this.value.length + ' / ${MAX_REVIEW_LENGTH}'"
        >${myReview ? escapeHtml(myReview.review_text) : ""}</textarea>

        <div class="review-footer">
          <span id="albumReviewCount">
            ${myReview ? myReview.review_text.length : 0} / ${MAX_REVIEW_LENGTH}
          </span>

          <button
            type="button"
            onclick="saveAlbumReview(${Number(albumId)})"
          >
            ${myReview ? "Update review" : "Post review"}
          </button>
        </div>

        <p id="albumReviewMessage" class="small"></p>
      </div>

      <div class="community-reviews">
        <h4>Community reviews</h4>

        ${
          otherReviews.length
            ? otherReviews.map((review) => {
                const profile = review.profile || null;

                return `
                  <article class="review-card">
                    <div class="review-card-header">
                      <div class="review-member-avatar">
                        ${escapeHtml(
                          String(profile?.handle || "B")
                            .replace(/^@+/, "")
                            .slice(0, 1)
                            .toUpperCase()
                        )}
                      </div>

                      <div class="review-member-info">
                        ${renderClickableProfileHandle(
                          profile,
                          review.user_id
                        )}

                        ${
                          profile?.member_number
                            ? `
                              <div class="review-member-number">
                                Member #${escapeHtml(profile.member_number)}
                              </div>
                            `
                            : ""
                        }
                      </div>
                    </div>

                    <p>${escapeHtml(review.review_text)}</p>

                    <div class="review-date">
                      Posted ${new Date(
                        review.updated_at || review.created_at
                      ).toLocaleDateString()}
                    </div>

                    <div class="review-actions">
                      ${renderAlbumReviewLikeControl(albumId, review)}
                    </div>
                    ${renderAlbumReviewComments(albumId, review)}
                  </article>
                `;
              }).join("")
            : `<p class="small">No other reviews yet.</p>`
        }
      </div>
    </section>
  `;
}


/* ============================================================
   PLAY WITH YOUR MUSIC PROVIDER
   Opens the selected BoM song or album in Spotify.
   ============================================================ */

const SPOTIFY_ALBUM_MATCH_CACHE_PREFIX =
  "bom_spotify_album_match_";

function getSpotifyAlbumMatchCacheKey(album) {
  return (
    SPOTIFY_ALBUM_MATCH_CACHE_PREFIX +
    [
      normaliseSpotifyMatchText(album?.artist),
      normaliseSpotifyMatchText(album?.title)
    ].join("|")
  );
}

function getCachedSpotifyAlbumMatch(album) {
  try {
    const cached = JSON.parse(
      localStorage.getItem(
        getSpotifyAlbumMatchCacheKey(album)
      ) || "null"
    );

    return cached?.externalUrl ? cached : null;
  } catch {
    return null;
  }
}

function cacheSpotifyAlbumMatch(bomAlbum, spotifyAlbum) {
  const externalUrl =
    spotifyAlbum?.external_urls?.spotify || "";

  if (!externalUrl) return;

  localStorage.setItem(
    getSpotifyAlbumMatchCacheKey(bomAlbum),
    JSON.stringify({
      id: spotifyAlbum.id || "",
      uri: spotifyAlbum.uri || "",
      name: spotifyAlbum.name || "",
      externalUrl,
      matchedAt: new Date().toISOString()
    })
  );
}

async function searchSpotifyAlbumForBoMAlbum(bomAlbum) {
  const cachedMatch =
    getCachedSpotifyAlbumMatch(bomAlbum);

  if (cachedMatch) {
    return cachedMatch;
  }

  const wantedTitle =
    normaliseSpotifyMatchText(bomAlbum.title);

  const wantedArtist =
    normaliseSpotifyMatchText(bomAlbum.artist);

  const queries = [
    `album:${bomAlbum.title} artist:${bomAlbum.artist}`,
    `"${bomAlbum.title}" "${bomAlbum.artist}"`,
    `${bomAlbum.title} ${bomAlbum.artist}`
  ];

  let candidates = [];

  for (const query of queries) {
    const searchData = await spotifyApiRequest(
      `/search?${new URLSearchParams({
        q: query,
        type: "album",
        limit: "20"
      }).toString()}`
    );

    candidates.push(
      ...(searchData?.albums?.items || [])
    );

    if (candidates.length >= 20) {
      break;
    }
  }

  const uniqueCandidates = Array.from(
    new Map(
      candidates
        .filter(Boolean)
        .map((candidate) => [
          candidate.id,
          candidate
        ])
    ).values()
  );

  if (!uniqueCandidates.length) {
    return null;
  }

  const scoredCandidates =
    uniqueCandidates
      .map((candidate) => {
        const candidateTitle =
          normaliseSpotifyMatchText(
            candidate.name
          );

        const candidateArtists =
          (candidate.artists || [])
            .map((artist) =>
              normaliseSpotifyMatchText(
                artist.name
              )
            )
            .join(" ");

        let score = 0;

        if (candidateTitle === wantedTitle) {
          score += 120;
        } else if (
          candidateTitle.includes(wantedTitle) ||
          wantedTitle.includes(candidateTitle)
        ) {
          score += 80;
        } else {
          const wantedWords =
            new Set(
              wantedTitle
                .split(" ")
                .filter((word) => word.length > 2)
            );

          const candidateWords =
            new Set(
              candidateTitle
                .split(" ")
                .filter((word) => word.length > 2)
            );

          const sharedWords =
            [...wantedWords].filter((word) =>
              candidateWords.has(word)
            ).length;

          score += sharedWords * 12;
        }

        if (candidateArtists === wantedArtist) {
          score += 120;
        } else if (
          candidateArtists.includes(wantedArtist) ||
          wantedArtist.includes(candidateArtists)
        ) {
          score += 90;
        }

        return {
          candidate,
          score
        };
      })
      .sort((a, b) => b.score - a.score);

  const bestMatch =
    scoredCandidates[0];

  /*
    Artist agreement is weighted heavily, so this accepts legitimate
    Spotify titles that include subtitles, territories or expanded
    release names, such as The Rolling Stones' first UK/US albums.
  */
  if (!bestMatch || bestMatch.score < 150) {
    console.warn(
      "No confident Spotify album match:",
      bomAlbum,
      scoredCandidates.slice(0, 3)
    );

    return null;
  }

  cacheSpotifyAlbumMatch(
    bomAlbum,
    bestMatch.candidate
  );

  return bestMatch.candidate;
}

function buildMusicProviderPanel({
  type,
  title,
  artist,
  album = ""
}) {
  if (!title || !artist) return "";

  const playerId =
    "spotify-embed-" +
    Math.random().toString(36).slice(2);

  return `
    <div class="music-provider-panel" data-music-provider-panel="true">
      <div class="music-provider-header">
        <div class="music-provider-copy">
          <div class="music-provider-kicker">Listen now</div>
          <strong>Play with your music provider</strong>
          <span>
            Play this ${type === "album" ? "album" : "track"}
            inside Bank of Music.
          </span>
        </div>

        <div class="music-provider-actions">
          <button
            type="button"
            class="music-provider-play-btn"
            data-provider-type="${escapeHtml(type)}"
            data-provider-title="${escapeHtml(title)}"
            data-provider-artist="${escapeHtml(artist)}"
            data-provider-album="${escapeHtml(album)}"
            data-player-target="${escapeHtml(playerId)}"
          >
            <span class="music-provider-icon" aria-hidden="true">♪</span>
            <span>Play here</span>
          </button>
        </div>
      </div>

      <div
        id="${escapeHtml(playerId)}"
        class="spotify-embed-container hidden"
        aria-live="polite"
      ></div>
    </div>
  `;
}

function getSpotifySearchFallbackUrl({
  title,
  artist
}) {
  return (
    "https://open.spotify.com/search/" +
    encodeURIComponent(
      `${title} ${artist}`.trim()
    )
  );
}


function getMusicProviderItemKey({
  type,
  title,
  artist,
  album = ""
}) {
  return [
    normaliseSpotifyMatchText(type),
    normaliseSpotifyMatchText(artist),
    normaliseSpotifyMatchText(title),
    normaliseSpotifyMatchText(album)
  ].join("|");
}

async function recordMusicProviderClick({
  provider,
  type,
  title,
  artist,
  album = ""
}) {
  try {
    const itemKey =
      getMusicProviderItemKey({
        type,
        title,
        artist,
        album
      });

    if (
      !provider ||
      !itemKey ||
      !title ||
      !artist
    ) {
      return null;
    }

    const { data, error } =
      await supabaseClient.rpc(
        "record_music_provider_click",
        {
          p_provider: provider,
          p_item_type: type,
          p_item_key: itemKey,
          p_title: title,
          p_artist: artist,
          p_album: album || null
        }
      );

    if (error) {
      console.warn(
        "Music provider click tracking failed:",
        error
      );

      return null;
    }

    return Number(data || 0) || null;
  } catch (error) {
    console.warn(
      "Music provider click tracking failed:",
      error
    );

    return null;
  }
}

function getSpotifyEntityId(spotifyItem) {
  if (spotifyItem?.id) return spotifyItem.id;

  const uri = spotifyItem?.uri || "";
  if (uri.includes(":")) {
    return uri.split(":").pop() || "";
  }

  const url =
    spotifyItem?.external_urls?.spotify ||
    spotifyItem?.externalUrl ||
    "";

  const match = url.match(
    /open\.spotify\.com\/(?:intl-[^/]+\/)?(?:track|album)\/([A-Za-z0-9]+)/
  );

  return match?.[1] || "";
}

function buildSpotifyEmbedUrl({
  type,
  spotifyItem
}) {
  const entityId =
    getSpotifyEntityId(spotifyItem);

  if (!entityId) return "";

  const entityType =
    type === "album" ? "album" : "track";

  return (
    `https://open.spotify.com/embed/${entityType}/` +
    encodeURIComponent(entityId) +
    "?utm_source=generator&theme=0"
  );
}

function renderSpotifyEmbed({
  target,
  type,
  title,
  artist,
  embedUrl,
  externalUrl
}) {
  if (!target || !embedUrl) return false;

  const height =
    type === "album" ? 352 : 152;

  target.classList.remove("hidden");

  target.innerHTML = `
    <iframe
      class="spotify-embed-frame"
      title="Spotify player for ${escapeHtml(title)} by ${escapeHtml(artist)}"
      src="${escapeHtml(embedUrl)}"
      width="100%"
      height="${height}"
      frameborder="0"
      allowfullscreen
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
    ></iframe>

    <div class="spotify-embed-footer">
      <span class="small">
        Playback remains inside Bank of Music.
      </span>

      <a
        class="spotify-open-externally-btn"
        href="${escapeHtml(externalUrl)}"
        target="_blank"
        rel="noopener noreferrer"
      >
        Open in Spotify
      </a>
    </div>
  `;

  target.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });

  return true;
}

async function openWithMusicProvider({
  type,
  title,
  artist,
  album = "",
  button = null,
  playerTarget = "",
  targetElement = null
}) {
  const fallbackUrl =
    getSpotifySearchFallbackUrl({
      title,
      artist
    });

  let target =
    targetElement ||
    (
      playerTarget
        ? document.getElementById(
            playerTarget
          )
        : button
            ?.closest(
              "[data-music-provider-panel='true']"
            )
            ?.querySelector(
              ".spotify-embed-container"
            )
    );

  const originalText =
    button?.innerHTML || "";

  if (button) {
    button.disabled = true;
    button.innerHTML =
      "<span>Loading player…</span>";
  }

  if (target) {
    target.classList.remove("hidden");
    target.innerHTML = `
      <div class="spotify-embed-loading">
        Finding ${escapeHtml(title)} in Spotify…
      </div>
    `;
  }

  try {
    await recordMusicProviderClick({
      provider: "spotify",
      type,
      title,
      artist,
      album
    });

    /*
      First use a match already cached by BoM's Spotify playlist
      sync. This works even when Textastic's Local preview does not
      share the live site's Spotify login/session.
    */
    let spotifyItem =
      type === "song"
        ? getCachedSpotifyMatch({
            title,
            artist,
            album
          })
        : getCachedSpotifyAlbumMatch({
            title,
            artist
          });

    const accessToken =
      await getValidSpotifyAccessToken();

    if (!spotifyItem && accessToken && type === "song") {
      spotifyItem =
        await searchSpotifyTrackForBoMTrack({
          title,
          artist,
          album
        });
    }

    if (!spotifyItem && accessToken && type === "album") {
      spotifyItem =
        await searchSpotifyAlbumForBoMAlbum({
          title,
          artist
        });
    }

    if (!spotifyItem && !accessToken) {
      throw new Error(
        "SPOTIFY_NOT_CONNECTED_IN_THIS_BROWSER"
      );
    }

    if (!spotifyItem) {
      throw new Error(
        "NO_EXACT_SPOTIFY_MATCH"
      );
    }

    const externalUrl =
      spotifyItem?.external_urls?.spotify ||
      spotifyItem?.externalUrl ||
      fallbackUrl;

    let rendered = false;

    const embedUrl =
      buildSpotifyEmbedUrl({
        type,
        spotifyItem
      });

    if (
      target?.id ===
      "albumTrackPreviewDock"
    ) {
      rendered =
        getOrCreateReusableAlbumPreviewFrame({
          dock: target,
          title,
          artist,
          embedUrl,
          externalUrl
        });
    } else {
      rendered =
        renderSpotifyEmbed({
          target,
          type,
          title,
          artist,
          embedUrl,
          externalUrl
        });
    }

    if (!rendered) {
      throw new Error(
        "NO_PLAYABLE_SPOTIFY_EMBED"
      );
    }

    if (button) {
      button.innerHTML = `
        <span class="music-provider-icon" aria-hidden="true">✓</span>
        <span>Player loaded</span>
      `;
    }
  } catch (error) {
    console.error(
      "Embedded Spotify player failed:",
      error
    );

    const reason =
      String(error?.message || error);

    const isNotConnected =
      reason.includes(
        "SPOTIFY_NOT_CONNECTED_IN_THIS_BROWSER"
      );

    if (target) {
      target.classList.remove("hidden");

      const inTrackDock =
        target.id ===
        "albumTrackPreviewDock";

      target.innerHTML = isNotConnected
        ? `
          <div class="spotify-local-preview-notice">
            <strong>
              Preview available on live BoM
            </strong>

            <span>
              Textastic Local preview uses separate Spotify login storage.
              Use Remote/live BoM for seamless previews, or connect Spotify
              in this Local preview once.
            </span>

            <button
              type="button"
              class="spotify-connect-from-player-btn"
              onclick="
                event.preventDefault();
                event.stopPropagation();
                showOnlySection('settingsSection');
              "
            >
              Connect Spotify here
            </button>
          </div>
        `
        : `
          <div class="spotify-embed-error ${inTrackDock ? "album-track-preview-error" : ""}">
            <strong>
              BoM could not find an exact Spotify match.
            </strong>

            <span>
              You can still search for it directly in Spotify.
            </span>

            <a
              class="spotify-open-externally-btn"
              href="${escapeHtml(fallbackUrl)}"
              target="_blank"
              rel="noopener noreferrer"
              onclick="
                event.stopPropagation();
              "
            >
              Search in Spotify
            </a>
          </div>
        `;
    }

    if (button) {
      button.innerHTML = originalText;
    }
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function renderSelectedItem() {

  if (!selectedItem) {

    updateStickyPlayer(null);
    selectedItemDetail.innerHTML = `<p class="small">Search above and select an artist, album or song.</p>`;

    return;

  }

  updateStickyPlayer(selectedItem);



  if (selectedItem.type === "artist") {

    await renderArtistDetail(selectedItem);

    return;

  }
  
  if (selectedItem.type === "song") {
  const songId = selectedItem.savedSongId || selectedItem.songId || selectedItem.id;
  const song = allSongs.find((s) => Number(s.id) === Number(songId)) || selectedItem;
  
  const linkedAlbum = song.album_id
  ? allAlbums.find((a) => Number(a.id) === Number(song.album_id))
  : null;

const linkedAlbumCover = linkedAlbum ? getAlbumArtworkUrl(linkedAlbum) : "";

  const linkedSongIds = allSongs
  .filter((s) =>
    normaliseCompare(`${s.artist}-${s.title}`) ===
    normaliseCompare(`${song.artist || selectedItem.artist}-${song.title || selectedItem.title}`)
  )
  .map((s) => Number(s.id));

const avgData = getLinkedSongAverage(linkedSongIds);

const yourRatingRow = allSongRatings.find((rating) =>
  rating.user_id === currentUser?.id &&
  linkedSongIds.includes(Number(rating.song_id))
);

const yourRating = yourRatingRow ? Number(yourRatingRow.rating) : null;

  const trackTitle = song.title || selectedItem.title || "Unknown song";
  const trackArtist = song.artist || selectedItem.artist || "Unknown artist";
  const albumTitle = linkedAlbum?.title || selectedItem.releaseTitle || "Unknown album";
  const artworkUrl = linkedAlbumCover || selectedItem.coverUrl || "";
  const relatedSongs = allSongs
    .filter((candidate) =>
      normaliseCompare(candidate.artist) === normaliseCompare(trackArtist) &&
      Number(candidate.id) !== Number(song.id || songId)
    )
    .slice(0, 8);

  selectedItemDetail.innerHTML = `
    <article class="bom-v1-album bom-v1-track-detail" data-bom-track-id="${escapeHtml(song.id || songId || "")}">
      <div class="bom-v1-album-back">${buildSelectedBackButton()}</div>
      <section class="bom-v1-album-hero bom-v1-track-detail-hero">
        <div class="bom-v1-album-artwork-wrap">
          ${artworkUrl
            ? `<img class="bom-v1-album-artwork" src="${escapeHtml(artworkUrl)}" alt="${escapeHtml(albumTitle)} cover" decoding="async">`
            : `<div class="bom-v1-album-artwork bom-v1-album-artwork-missing" role="img" aria-label="Artwork unavailable"><span>bom</span><small>Artwork unavailable</small></div>`}
        </div>
        <div class="bom-v1-album-identity">
          <div class="bom-v1-album-kind">Track</div>
          <h1>${escapeHtml(trackTitle)}</h1>
          <div class="bom-v1-album-artist">
            <button class="song-artist-link" data-artist-name="${escapeHtml(trackArtist)}">${escapeHtml(trackArtist)}</button>
          </div>
          <div class="bom-v1-track-detail-album">
            <span>From</span>
            ${song.album_id
              ? `<button type="button" class="song-album-link" data-open-song-album-id="${song.album_id}">${escapeHtml(albumTitle)}</button>`
              : `<strong>${escapeHtml(albumTitle)}</strong>`}
          </div>
          <div class="bom-v1-album-ratings">
            <div><span>Community</span><div class="bom-v1-album-community">${avgData?.count
              ? `<strong>${avgData.avg.toFixed(1)}</strong><span>/ 10</span><small>${avgData.count} rating${avgData.count === 1 ? "" : "s"}</small>`
              : `<span class="bom-v1-rating-empty">Not rated</span>`}</div></div>
            <div><span>Your track rating</span><div class="bom-v1-album-personal">${buildCompactTrackRatingControl(song.id || selectedItem.savedSongId, yourRating) || "Not rated"}</div></div>
          </div>
          <div class="bom-v1-album-actions">${buildMusicProviderPanel({ type: "song", title: trackTitle, artist: trackArtist, album: albumTitle })}</div>
        </div>
      </section>
      ${(linkedAlbum || relatedSongs.length) ? `<section class="bom-v1-album-section bom-v1-track-detail-related">
        <header class="bom-v1-album-section-header"><h2>More from ${escapeHtml(trackArtist)}</h2></header>
        ${linkedAlbum ? `<button class="bom-v1-track-album-card open-album-btn" data-album-id="${linkedAlbum.id}">
          ${getAlbumCoverMarkup(linkedAlbumCover, `${linkedAlbum.title} cover`)}
          <span><strong>${escapeHtml(linkedAlbum.title)}</strong><small>${escapeHtml(linkedAlbum.artist)}</small><em>Open album</em></span>
        </button>` : ""}
        ${relatedSongs.length ? `<div class="bom-v1-track-related-list">${relatedSongs.map((relatedSong) => `
          <button class="bom-v1-track-related-row" data-library-type="song" data-song-id="${relatedSong.id}">
            <strong>${escapeHtml(relatedSong.title)}</strong>
            <span>${escapeHtml(getAlbumNameById(relatedSong.album_id) || "Unknown album")}</span>
          </button>`).join("")}</div>` : ""}
      </section>` : ""}
    </article>
  `;

  return;
}



  if (selectedItem.type === "album") {

    const albumSelection = selectedItem;
    renderLoadingSkeleton(selectedItemDetail, "detail");

    try {

      const immediatelySavedAlbum =
        (albumSelection.savedAlbumId
          ? allAlbums.find(
              (album) =>
                Number(album.id) ===
                Number(albumSelection.savedAlbumId)
            )
          : null) ||
        (albumSelection.id
          ? allAlbums.find(
              (album) =>
                Number(album.id) ===
                Number(albumSelection.id)
            )
          : null) ||
        getSavedAlbumByExternalId(
          albumSelection.externalId
        ) ||
        allAlbums.find(
          (album) =>
            normaliseCompare(album.title) ===
              normaliseCompare(albumSelection.title) &&
            normaliseCompare(album.artist) ===
              normaliseCompare(albumSelection.artist)
        ) ||
        null;

      const immediatelySavedTracks =
        immediatelySavedAlbum
          ? allSongs
              .filter(
                (song) =>
                  Number(song.album_id) ===
                    Number(immediatelySavedAlbum.id) &&
                  Number(song.is_deleted || 0) === 0
              )
              .sort(
                (a, b) =>
                  Number(a.track_position || 9999) -
                  Number(b.track_position || 9999)
              )
          : [];

      /*
        Rated/saved albums already have their tracks in BoM.
        Build a local MusicBrainz-shaped detail object and render
        from that instead of waiting for another network request.
      */
      if (immediatelySavedAlbum && immediatelySavedTracks.length) {
        const localDetail = {
          id:
            immediatelySavedAlbum.external_id ||
            albumSelection.externalId ||
            "",
          title:
            immediatelySavedAlbum.title ||
            albumSelection.title ||
            "",
          date:
            immediatelySavedAlbum.release_date ||
            immediatelySavedAlbum.releaseDate ||
            albumSelection.releaseDate ||
            "",
          "artist-credit": [
            {
              name:
                immediatelySavedAlbum.artist ||
                albumSelection.artist ||
                ""
            }
          ],
          media: [
            {
              tracks:
                immediatelySavedTracks.map(
                  (song, index) => ({
                    position:
                      Number(song.track_position) ||
                      index + 1,
                    title:
                      song.title ||
                      `Track ${index + 1}`,
                    recording: {
                      id:
                        song.external_id ||
                        "",
                      title:
                        song.title ||
                        `Track ${index + 1}`
                    }
                  })
                )
            }
          ]
        };

        const albumId =
          immediatelySavedAlbum.id;

        const albumReviews = isStageOnePresentation()
          ? []
          : await loadAlbumReviews(albumId);

        const avg =
          getAlbumAverage(albumId);

        const yourRating =
          getYourAlbumRating(albumId);

        const coverUrl =
          getAlbumArtworkUrl(
            immediatelySavedAlbum
          ) ||
          albumSelection.coverUrl ||
          "";

        const displayArtist =
          immediatelySavedAlbum.artist ||
          albumSelection.artist ||
          "";

        if (isStageOnePresentation()) {
          await renderStageOneAlbum(buildStageOneAlbumModel({
            album: immediatelySavedAlbum,
            detail: localDetail,
            albumId,
            artworkUrl: coverUrl,
            artist: displayArtist,
            community: avg,
            personal: yourRating,
            releaseDate: immediatelySavedAlbum.original_release_date || immediatelySavedAlbum.release_date || immediatelySavedAlbum.releaseDate || "",
            releaseDateSource: "stored"
          }));
          return;
        }

        selectedItemDetail.innerHTML = `
          <div class="detail-panel">
            ${buildSelectedBackButton()}

            <div class="detail-hero">
              <div>
                ${getLargeCoverMarkup(
                  coverUrl,
                  `${immediatelySavedAlbum.title} cover`
                )}
              </div>

              <div class="detail-info-panel">
                <div class="media-title">
                  ${escapeHtml(
                    immediatelySavedAlbum.title
                  )}
                </div>

                <div class="album-activity-line">
                  ${
                    avg
                      ? `⭐ ${avg.avg.toFixed(1)} / 10`
                      : "No ratings yet"
                  }
                  ${
                    albumReviews.length
                      ? ` · 📝 ${albumReviews.length} review${albumReviews.length === 1 ? "" : "s"}`
                      : " · No reviews yet"
                  }
                </div>

                <div class="media-subtitle">
                  ${renderClickableArtistName(
                    displayArtist
                  )}
                </div>

                ${renderFollowControls(
                  displayArtist
                )}

                <div class="detail-meta-grid">
                  <div class="detail-meta-label">
                    Release date
                  </div>

                  <div class="detail-meta-value">
                    ${escapeHtml(
                      immediatelySavedAlbum.release_date ||
                      immediatelySavedAlbum.releaseDate ||
                      "Unknown"
                    )}
                  </div>

                  <div class="detail-meta-label">
                    Average rating
                  </div>

                  <div class="detail-meta-value">
                    ${
                      avg
                        ? `⭐ ${avg.avg.toFixed(1)} / 10 (${avg.count} rating${avg.count === 1 ? "" : "s"})`
                        : "No ratings yet"
                    }
                  </div>

                  <div class="detail-meta-label">
                    Your rating
                  </div>

                  <div class="detail-meta-value">
                    ${
                      yourRating !== null
                        ? `${yourRating}/10`
                        : "Not rated"
                    }
                  </div>
                </div>

                <div class="detail-actions">
                  ${renderStarSelector(
                    `album-rating-${albumId}`,
                    yourRating
                  )}

                  ${buildSelectedSharePanel(
                    albumSelection
                  )}
                </div>

                ${
                  typeof renderSelectedAdminControls ===
                  "function"
                    ? renderSelectedAdminControls({
                        albumId
                      })
                    : ""
                }
              </div>
            </div>

            ${buildTrackListHtml(
              localDetail,
              albumId
            )}

            ${renderAlbumReviewsSection(
              albumId,
              albumReviews
            )}
          </div>
        `;

        return;
      }

      if (!albumSelection.externalId && albumSelection.releaseGroupId) {

        albumSelection.externalId = await fetchCanonicalReleaseForReleaseGroup(albumSelection.releaseGroupId);

      }

      if (!albumSelection.externalId && albumSelection?.title && albumSelection?.artist) {
		  const cleanTitle = normaliseCompare(albumSelection.title);
const cleanArtist = normaliseCompare(albumSelection.artist);

if (
  (cleanTitle === "abbey road" && (cleanArtist === "beatles" || cleanArtist === "the beatles")) ||
  (cleanArtist === "abbey road" && (cleanTitle === "beatles" || cleanTitle === "the beatles"))
) {
  albumSelection.title = "Abbey Road";
  albumSelection.artist = "The Beatles";
  albumSelection.externalId = "46264b17-694c-468a-8233-6b79bbb1b8b5";
}
  const searchUrl =
    `https://musicbrainz.org/ws/2/release/?query=release:${encodeURIComponent(albumSelection.title)}%20AND%20artist:${encodeURIComponent(albumSelection.artist === "Beatles" ? "The Beatles" : albumSelection.artist)}&fmt=json&limit=5`;

  const res = await fetch(searchUrl);
  const data = await res.json();

  const bestMatch = (data.releases || []).find((r) =>
    normaliseCompare(r.title) === normaliseCompare(albumSelection.title)
  ) || data.releases?.[0];

  if (bestMatch?.id) {
    albumSelection.externalId = bestMatch.id;
  }
}

if (selectedItem !== albumSelection) return;
if (!albumSelection.externalId) {
  console.warn("No MusicBrainz release found — showing fallback view");

  selectedItemDetail.innerHTML = `
    <h3>${escapeHtml(albumSelection.title)}</h3>
    <p class="small">${escapeHtml(albumSelection.artist)}</p>
    <p class="small">Track list unavailable, but you can still rate this album.</p>
  `;

  return;
}

      const albumLookupId = albumSelection.externalId || albumSelection.releaseGroupId || "";

	  selectedItemDetail.innerHTML = `
<div class="glass-card">
    <h3>${escapeHtml(albumSelection.title)}</h3>
    <p>Loading tracks...</p>
</div>
`;

let detail = { media: [] };

if (albumLookupId) {

  if (albumTrackCache[albumLookupId]) {

    detail = albumTrackCache[albumLookupId];

  } else {

    const storedDetail =
      getStoredAlbumDetail(
        albumLookupId
      );

    if (storedDetail) {
      detail = storedDetail;
      albumTrackCache[albumLookupId] =
        storedDetail;
    } else {
      detail =
        await fetchAlbumDetail(
          albumLookupId
        );
    }

  }

}

      if (selectedItem !== albumSelection) return;
      const releaseGroupId = detail?.["release-group"]?.id || "";

      let releaseGroupCover = "";

if (releaseGroupId) {
  if (releaseGroupCoverCache[releaseGroupId]) {
    releaseGroupCover = releaseGroupCoverCache[releaseGroupId];
  } else if (typeof fetchReleaseGroupCover === "function") {
    releaseGroupCover = await fetchReleaseGroupCover(releaseGroupId);
    releaseGroupCoverCache[releaseGroupId] = releaseGroupCover || "";
  }
}



      if (selectedItem !== albumSelection) return;
      let savedAlbum =

        getSavedAlbumByExternalId(albumSelection.externalId) ||

        (albumSelection.savedAlbumId

          ? allAlbums.find((row) => Number(row.id) === Number(albumSelection.savedAlbumId))

          : null);



      if (!savedAlbum && currentUser && typeof autoSaveSelectedAlbum === "function") {

        try {

          savedAlbum = await autoSaveSelectedAlbum();

          if (selectedItem !== albumSelection) return;

        } catch (error) {

          console.warn("Album auto-save during render skipped", error?.message || error);

        }

      }



    //  if (savedAlbum && typeof ensureTrackSongs === "function") {

      //  try {

        //  await ensureTrackSongs(detail, savedAlbum.id);

          //await loadLibrary();

        //} catch (error) {

          //console.warn("Track auto-save during render skipped", error?.message || error);

        //}

      //}



      if (selectedItem !== albumSelection) return;
      const refreshedSavedAlbum =

        getSavedAlbumByExternalId(albumSelection.externalId) ||

        (savedAlbum ? allAlbums.find((row) => Number(row.id) === Number(savedAlbum.id)) || savedAlbum : null);



      const albumId =
  refreshedSavedAlbum?.id ||
  albumSelection.savedAlbumId ||
  albumSelection.id ||
  albumSelection.album_id ||
  null;
  
  const albumReviews = isStageOnePresentation()
  ? []
  : (albumId ? await loadAlbumReviews(albumId) : []);

const albumReviewCount = albumReviews.length;

      const refreshedAvg = albumId ? getAlbumAverage(albumId) : null;

      const refreshedYourRating = albumId ? getYourAlbumRating(albumId) : null;

const trackListHtml = isStageOnePresentation() ? "" : buildTrackListHtml(detail, albumId);

      const displayArtist = detail?.["artist-credit"]?.map((credit) => credit.name).join(", ") || albumSelection.artist;
      const displayArtistId = detail?.["artist-credit"]?.[0]?.artist?.id || albumSelection.artistId || "";
      if (displayArtistId) albumSelection.artistId = displayArtistId;

      const coverUrl =

        getAlbumArtworkUrl(refreshedSavedAlbum) ||

        albumSelection.coverUrl ||

        releaseGroupCover ||

        "";

      const releaseDate = detail?.date || albumSelection.releaseDate || "";

      if (isStageOnePresentation()) {
        await renderStageOneAlbum(buildStageOneAlbumModel({
          album: refreshedSavedAlbum || albumSelection,
          detail,
          albumId,
          artworkUrl: coverUrl,
          artist: displayArtist,
          community: refreshedAvg,
          personal: refreshedYourRating,
          releaseDate,
          releaseDateSource: detail?.date ? "external" : "stored"
        }));
        return;
      }
	  
	  const chartPosition = await getChartPosition(
  albumSelection.type,
  albumSelection.id || albumSelection.externalId
);



      selectedItemDetail.innerHTML = `
	  
	  

        <div class="detail-panel">

          ${buildSelectedBackButton()}

          <div class="detail-hero">

            <div>${getLargeCoverMarkup(coverUrl, `${albumSelection.title} cover`)}</div>

            <div class="detail-info-panel">

              <div class="media-title">${escapeHtml(detail?.title || albumSelection.title)}</div>
			  
			  <div class="album-activity-line">

  ${refreshedAvg ? `⭐ ${refreshedAvg.avg.toFixed(1)} / 10` : "No ratings yet"}

  ${albumReviewCount ? ` · 📝 ${albumReviewCount} review${albumReviewCount === 1 ? "" : "s"}` : " · No reviews yet"}

</div>

              <div class="media-subtitle">
  ${renderClickableArtistName(displayArtist)}
</div>

              ${renderFollowControls(displayArtist)}

              <div class="detail-meta-grid">

                <div class="detail-meta-label">Release date</div>

                <div class="detail-meta-value">${releaseDate ? escapeHtml(releaseDate) : "Unknown"}</div>

                <div class="detail-meta-label">Average rating</div>

                <div class="detail-meta-value">${refreshedAvg ? `⭐ ${refreshedAvg.avg.toFixed(1)} / 10 (${refreshedAvg.count} rating${refreshedAvg.count === 1 ? "" : "s"})` : "No ratings yet"}</div>

                <div class="detail-meta-label">Your rating</div>

                <div class="detail-meta-value">${refreshedYourRating !== null ? `${refreshedYourRating}/10` : "Not rated"}</div>

              </div>

              <div class="detail-actions">

                ${albumId

                  ? renderStarSelector(`album-rating-${albumId}`, refreshedYourRating)

                  : `<button id="importSelectedAlbumBtn">Save album</button>`}

                ${buildSelectedSharePanel(albumSelection)}

              </div>

              ${typeof renderSelectedAdminControls === "function" ? renderSelectedAdminControls({ albumId }) : ""}

            </div>

          </div>

          ${trackListHtml}

${albumId
  ? renderAlbumReviewsSection(
      albumId,
      albumReviews
    )
  : ""}

		  ${(() => {
  const moreAlbums = allAlbums
  .filter((album) =>
    album.library_type === "album" &&
    normaliseCompare(album.artist) === normaliseCompare(albumSelection.artist) &&
    normaliseCompare(album.title) !== normaliseCompare(albumSelection.title)
  )
  .slice(0, 4);

  if (!moreAlbums.length) {
    return `
      <div class="keep-listening-panel">
        <h3>More from this artist</h3>
        <p class="small">Search for more albums by this artist.</p>
      </div>
    `;
  }

  return `
    <div class="keep-listening-panel">
      <h3>More from this artist</h3>
      <div class="album-grid">
        ${moreAlbums.map((album) => `
          <div class="album-card" data-library-type="album" data-album-id="${album.id}">
            ${getAlbumCoverMarkup(album.cover_art_url || album.coverUrl || "")}
            <div class="album-card-body">
              <strong>${escapeHtml(album.title)}</strong>
              <span>${escapeHtml(album.artist)}</span>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
})()}


      `;
      updateStickyPlayer(albumSelection);
      requestAnimationFrame(() => activateCarousels(selectedItemDetail));

	  

    } catch (err) {
      if (selectedItem !== albumSelection) return;

      console.warn("Album detail unavailable", err?.message || err);

      selectedItemDetail.innerHTML = isStageOnePresentation() && window.BOMUI
        ? `<div class="bom-v1-album bom-v1-album-error">${window.BOMUI.SectionState({ title: "Album details unavailable", message: "We could not load this album right now.", actionLabel: "Retry", action: "retry-album" })}</div>`
        : `
  <div class="empty-state">
    <h3>Album details unavailable</h3>
    <p class="small">We found the album, but could not load a full track list from MusicBrainz yet.</p>
    <button class="secondary-btn" type="button" onclick="document.querySelector('[data-target=&quot;searchSection&quot;]').click()">← Back to search</button>
  </div>
`;

    }

    return;

  }



  if (selectedItem.type === "song") {

    let savedSong = await autoSaveSelectedSong();



    if (!savedSong) {

      savedSong = selectedItem.externalId

        ? getSavedSongByExternalId(selectedItem.externalId)

        : allSongs.find((song) =>

            normaliseCompare(song.title) === normaliseCompare(selectedItem.title) &&

            normaliseCompare(song.artist) === normaliseCompare(selectedItem.artist)

          );

    }



    const avgData = savedSong ? getSongAverage(savedSong.id) : null;

    const yourRating = savedSong
      ? (
          getYourSongRating(savedSong.id) ??
          getYourSongRatingByTitleArtist(
            savedSong.title || selectedItem.title,
            savedSong.artist || selectedItem.artist
          )
        )
      : getYourSongRatingByTitleArtist(
          selectedItem.title,
          selectedItem.artist
        );

    const linkedAlbum = savedSong?.album_id

      ? allAlbums.find((album) => Number(album.id) === Number(savedSong.album_id))

      : null;

    const coverUrl = linkedAlbum ? getAlbumArtworkUrl(linkedAlbum) : "";



    selectedItemDetail.innerHTML = `

      <div class="detail-panel">

        ${buildSelectedBackButton()}

        <div class="detail-hero">

          <div>${getLargeCoverMarkup(coverUrl, `${selectedItem.title} artwork`)}</div>

          <div class="detail-info-panel">

            <div class="media-title">${escapeHtml(song.title || selectedItem.title || "Unknown song")}</div>

<button class="song-artist-link" data-artist-name="${escapeHtml(song.artist || selectedItem.artist || "")}">
  ${escapeHtml(song.artist || selectedItem.artist || "Unknown artist")}
</button>

            ${renderFollowControls(selectedItem.artist)}

            <div class="detail-meta-grid">

              <div class="detail-meta-label">Album</div>

<div class="detail-meta-value">
  ${
    song.album_id
      ? `<button class="open-album-btn song-album-link" data-album-id="${song.album_id}">
          ${escapeHtml(getAlbumNameById(song.album_id))}
        </button>`
      : "Unknown"
  }
</div>

              <div class="detail-meta-label">Average rating</div>

              <div class="detail-meta-value">${avgData ? `⭐ ${avgData.avg.toFixed(1)} / 10 (${avgData.count} rating${avgData.count === 1 ? "" : "s"})` : "No ratings yet"}</div>

              <div class="detail-meta-label">Your rating</div>

              <div class="detail-meta-value">${yourRating !== null ? `${yourRating}/10` : "Not rated"}</div>

            </div>

            <div class="detail-actions">

              ${savedSong

                ? renderStarSelector(`track-rating-${savedSong.id}`, yourRating)

                : `<button id="importSelectedSongBtn">Save song</button>`}

              ${buildSelectedSharePanel(selectedItem)}

            </div>

            ${typeof renderSelectedAdminControls === "function"
  ? renderSelectedAdminControls({
      albumId: savedAlbumId
    })
  : ""
}

<div class="keep-listening-panel">
  <h3>More from this artist</h3>
  <p class="small">Use Search to find more albums by this artist.</p>
</div>

</div>

`;
    updateStickyPlayer(selectedItem);
    requestAnimationFrame(() => activateCarousels(selectedItemDetail));
	

    return;

  }



}

function getSavedAlbumByTitleArtist(title, artist) {
  return allAlbums.find((album) => albumIdentityMatches(album, { title, artist })) || null;
}


async function autoSaveSelectedSong() {

  if (!currentUser) return null;

  if (!selectedItem || selectedItem.type !== "song") return null;



  let savedSong =

    (selectedItem.externalId ? getSavedSongByExternalId(selectedItem.externalId) : null) ||

    (selectedItem.savedSongId

      ? allSongs.find((row) => Number(row.id) === Number(selectedItem.savedSongId))

      : null) ||

    allSongs.find((song) =>

      normaliseCompare(song.title) === normaliseCompare(selectedItem.title) &&

      normaliseCompare(song.artist) === normaliseCompare(selectedItem.artist)

    );



  if (!savedSong) {

    const payload = {

      title: normaliseText(selectedItem.title),

      artist: normaliseText(selectedItem.artist),

      album_id: selectedItem.albumId ? Number(selectedItem.albumId) : null,
	  
	  track_position: selectedItem.trackPosition || selectedItem.track_position || null,

      external_source: selectedItem.externalId ? "musicbrainz" : null,

      external_id: selectedItem.externalId || null

    };



    let response;



    if (payload.external_source && payload.external_id) {

      response = await supabaseClient

        .from("songs")

        .upsert([payload], { onConflict: "external_source,external_id" })

        .select();

    } else {

      response = await supabaseClient

        .from("songs")

        .insert([payload])

        .select();

    } 



    if (response.error) {

      console.warn("Selected song auto-save skipped", response.error?.message || response.error);

      setMessage(globalSearchMessage, "Song opened, but could not be auto-saved for rating. Check the songs table RLS policy.");

      return null;

    }



    await loadLibrary();



    savedSong =

      (selectedItem.externalId ? getSavedSongByExternalId(selectedItem.externalId) : null) ||

      (Array.isArray(response.data) && response.data[0] ? response.data[0] : null) ||

      allSongs.find((song) =>

        normaliseCompare(song.title) === normaliseCompare(selectedItem.title) &&

        normaliseCompare(song.artist) === normaliseCompare(selectedItem.artist)

      );

  }



  if (savedSong) {

    selectedItem = {

      ...selectedItem,

      type: "song",

      title: savedSong.title || selectedItem.title,

      artist: savedSong.artist || selectedItem.artist,

      externalId: savedSong.external_id || selectedItem.externalId || "",

      albumId: savedSong.album_id || selectedItem.albumId || "",

      savedSongId: savedSong.id

    };

  }



  renderLibrary();

  renderRecommendations();



  return savedSong;

}



// Coalesce repeated selections without introducing another catalogue write path.
const albumAutoSaveInFlight = new Map();

async function autoSaveSelectedAlbum() {
  if (!currentUser) return null;
  if (!selectedItem || selectedItem.type !== "album") return null;
  const item = selectedItem;
  const userId = currentUser.id;
  const key = `${userId}:${item.releaseGroupId || item.externalId || normaliseCompare(`${item.artist}-${item.title}`)}`;

  const bindSavedAlbum = (album) => {
    if (!album || selectedItem !== item) return album;
    item.savedAlbumId = album.id;
    item.albumId = album.id;
    item.title = album.title;
    item.artist = album.artist;
    item.externalId = album.musicbrainz_release_id || album.external_id || item.externalId;
    item.releaseGroupId = album.musicbrainz_release_group_id || item.releaseGroupId;
    item.coverUrl = getAlbumArtworkUrl(album) || item.coverUrl || "";
    item.releaseDate = album.release_date || item.releaseDate || "";
    return album;
  };

  if (albumAutoSaveInFlight.has(key)) return bindSavedAlbum(await albumAutoSaveInFlight.get(key));

  const save = (async () => {
    const matches = (album, title, artist, releaseGroupId) =>
      albumIdentityMatches(album, { ...item, title, artist, releaseGroupId });

    const local = allAlbums.find((album) => matches(album, item.title, item.artist, item.releaseGroupId));
    if (local) return local.is_deleted ? null : local;

    // Resolution must be complete before the first catalogue mutation. Never
    // fall back to a synthetic/manual album when MusicBrainz is unavailable.
    if (!item.externalId) return null;
    const detail = await fetchAlbumDetail(item.externalId);
    const title = normaliseText(detail?.title);
    const artist = normaliseText(detail?.["artist-credit"]?.map((credit) => credit.name || credit.artist?.name || "").join(", "));
    const releaseGroupId = detail?.["release-group"]?.id;
    const media = detail?.media;
    const tracks = Array.isArray(media) ? media.flatMap((medium) => medium.tracks || []) : [];
    if (detail?.id !== item.externalId || !title || !artist || !releaseGroupId ||
        (item.releaseGroupId && item.releaseGroupId !== releaseGroupId) ||
        !detail["artist-credit"].every((credit) => normaliseText(credit.name || credit.artist?.name)) ||
        !tracks.length || !media.every((medium) => Array.isArray(medium.tracks) &&
          medium.tracks.length > 0 && (medium["track-count"] == null || Number(medium["track-count"]) === medium.tracks.length)) ||
        !tracks.every((track) => normaliseText(track.title || track.recording?.title))) return null;

    // The catalogue cache can be stale or truncated. Restore the historical
    // database conflict recovery, including the existing release-group key.
    const findSavedAlbum = async () => {
      const queries = [
        { exactIdentity: true, run: () => supabaseClient.from("albums").select("*").eq("external_source", "musicbrainz").eq("external_id", detail.id).maybeSingle() },
        { exactIdentity: true, run: () => supabaseClient.from("albums").select("*").eq("musicbrainz_release_group_id", releaseGroupId).maybeSingle() },
        { exactIdentity: false, run: () => supabaseClient.from("albums").select("*").eq("title", title).eq("artist", artist).maybeSingle() }
      ];
      for (const query of queries) {
        const { data, error } = await query.run();
        if (error) throw error;
        if (data && (query.exactIdentity || albumIdentityMatches(data, {
          title, artist, externalId: detail.id, releaseGroupId
        }))) return data;
      }
      return null;
    };
    let savedAlbum = await findSavedAlbum();
    if (savedAlbum?.is_deleted) return null;
    if (savedAlbum) {
      await loadLibrary();
      if (!allAlbums.some((album) => Number(album.id) === Number(savedAlbum.id))) allAlbums.push(savedAlbum);
      return savedAlbum;
    }
    if (currentUser?.id !== userId) return null;

    const coverUrl = item.coverUrl || item.cover_url ||
      `https://coverartarchive.org/release/${encodeURIComponent(detail.id)}/front-250`;
    const payload = {
      title, artist, external_source: "musicbrainz", external_id: detail.id,
      musicbrainz_release_id: detail.id, musicbrainz_release_group_id: releaseGroupId,
      cover_art_url: coverUrl,
      release_date: normaliseReleaseDate(detail.date || item.releaseDate)
    };
    const { data, error } = await supabaseClient.from("albums")
      .upsert([payload], { onConflict: "external_source,external_id", ignoreDuplicates: true })
      .select().maybeSingle();
    if (error && error.code !== "23505") throw error;
    savedAlbum = data || await findSavedAlbum();
    if (!savedAlbum || savedAlbum.is_deleted) return null;
    // A concurrent client may already have imported the canonical album.
    // Do not overwrite its metadata or append tracks from another edition.
    if (!data) {
      await loadLibrary();
      if (!allAlbums.some((album) => Number(album.id) === Number(savedAlbum.id))) allAlbums.push(savedAlbum);
      return savedAlbum;
    }

    const { data: savedTracks, error: trackReadError } = await supabaseClient.from("songs").select("*").eq("album_id", savedAlbum.id);
    if (trackReadError) throw trackReadError;
    const knownTracks = savedTracks || [];
    for (const [index, track] of tracks.entries()) {
      const trackTitle = normaliseText(track.title || track.recording?.title);
      const trackExternalId = track.recording?.id || "";
      const exists = knownTracks.some((song) => normaliseCompare(song.title) === normaliseCompare(trackTitle) ||
        (trackExternalId && song.external_source === "musicbrainz" && song.external_id === trackExternalId));
      if (exists) continue;
      const { data: song, error: songInsertError } = await supabaseClient.from("songs").insert([{
        title: trackTitle, artist, album_id: savedAlbum.id, track_position: index + 1,
        external_source: trackExternalId ? "musicbrainz" : "manual",
        external_id: trackExternalId || `manual-track-${savedAlbum.id}-${index + 1}`
      }]).select().single();
      // Preserve the existing recording/title unique constraints; never move
      // an existing recording to another album to evade a duplicate conflict.
      if (songInsertError && songInsertError.code !== "23505") throw songInsertError;
      if (song) knownTracks.push(song);
    }

    await loadLibrary();
    if (!allAlbums.some((album) => Number(album.id) === Number(savedAlbum.id))) allAlbums.push(savedAlbum);
    for (const song of knownTracks) if (!allSongs.some((row) => Number(row.id) === Number(song.id))) allSongs.push(song);
    predictiveCataloguePromise = null;
    predictiveCatalogueLoadedAt = 0;
    renderLibrary();
    renderRecommendations();
    return savedAlbum;
  })();
  albumAutoSaveInFlight.set(key, save);
  try {
    return bindSavedAlbum(await save);
  } finally {
    albumAutoSaveInFlight.delete(key);
  }
}


async function importSelectedAlbum() {

  if (!selectedItem || selectedItem.type !== "album") return;



  let detail = null;

  let releaseGroupCover = "";

  try {

    detail = await fetchAlbumDetail(selectedItem.externalId);

    const releaseGroupId = detail["release-group"]?.id || "";

    releaseGroupCover = await fetchReleaseGroupCover(releaseGroupId);

  } catch {}



  const { data, error } = await supabaseClient

    .from("albums")

    .upsert(

      [{

        title: normaliseText(detail?.title || selectedItem.title),

        artist: normaliseText(detail?.["artist-credit"]?.map((credit) => credit.name).join(", ") || selectedItem.artist),

        external_source: "musicbrainz",

        external_id: selectedItem.externalId,

        cover_art_url: selectedItem.coverUrl || releaseGroupCover || null,

        release_date: normaliseReleaseDate(detail?.date || selectedItem.releaseDate)

      }],

      { onConflict: "external_source,external_id" }

    )

    .select();



  if (error) {

    setMessage(globalSearchMessage, error.message);

    return;

  }



  await loadLibrary();

  const importedAlbum = getSavedAlbumByExternalId(selectedItem.externalId) || (Array.isArray(data) && data[0] ? data[0] : null);

  if (importedAlbum) {

    selectedItem = {

      type: "album",

      title: importedAlbum.title,

      artist: importedAlbum.artist,

      externalId: importedAlbum.external_id || selectedItem.externalId,

      releaseDate: importedAlbum.release_date || selectedItem.releaseDate || "",

      coverUrl: importedAlbum.cover_art_url || selectedItem.coverUrl || "",

      savedAlbumId: importedAlbum.id

    };

  }



  renderLibrary();

  renderRecommendations(); 

  await renderSelectedItem();

  setMessage(globalSearchMessage, "Album saved.");

}




async function importSelectedSong() {

  const savedSong = await autoSaveSelectedSong();

  await loadLibrary();

  renderLibrary();

  renderRecommendations();

  await renderSelectedItem();



  if (savedSong) {

    setMessage(globalSearchMessage, "Song saved. You can now rate it.");

  }

}



async function saveTrackFromAlbum(trackTitle, trackExternalId, albumId) {
  if (!selectedItem || selectedItem.type !== "album") return null;

  const finalAlbumId = Number(
    albumId ||
    selectedItem.savedAlbumId ||
    selectedItem.albumId
  );

  if (!finalAlbumId) {
    console.error("NO ALBUM ID FOUND FOR TRACK SAVE", { trackTitle, trackExternalId, selectedItem });
    return null;
  }

  const cleanTitle = normaliseText(trackTitle);
  const cleanArtist = normaliseText(selectedItem.artist);

  // First check if this track already exists on THIS album by title
  const existing = allSongs.find((song) =>
    Number(song.album_id) === Number(finalAlbumId) &&
    (
      normaliseCompare(song.title) === normaliseCompare(cleanTitle) ||
      (
        trackExternalId &&
        String(song.external_source || "") === "musicbrainz" &&
        String(song.external_id || "") === String(trackExternalId)
      )
    )
  );

  let result;

  if (existing) {
    result = await supabaseClient
      .from("songs")
      .update({
        title: cleanTitle,
        artist: cleanArtist,
        album_id: finalAlbumId,
        external_source: trackExternalId ? "musicbrainz" : existing.external_source || "manual",
        external_id: trackExternalId || existing.external_id || null
      })
      .eq("id", existing.id)
      .select()
      .single();
  } else {
    result = await supabaseClient
      .from("songs")
      .insert([{
        title: cleanTitle,
        artist: cleanArtist,
        album_id: finalAlbumId,
        external_source: trackExternalId ? "musicbrainz" : "manual",
        external_id: trackExternalId || null
      }])
      .select()
      .single();
  }

  if (result.error) {
    console.error("SAVE TRACK ERROR", result.error);
    setMessage(globalSearchMessage, result.error.message);
    return null;
  }
  
  if (result.data) {
  allSongs = (allSongs || []).filter(song => Number(song.id) !== Number(result.data.id));
  allSongs.push(result.data);
}

  await loadLibrary();
  renderLibrary();
  renderRecommendations();

  setMessage(globalSearchMessage, "Track saved.");
  return result.data;
}



// Quick Rate keeps its queue and skips in memory only.
function buildQuickRateQueue(songs, ratings, userId, random = Math.random) {
  const rated = new Set(ratings.filter(row => row.user_id === userId).map(row => Number(row.song_id)));
  const getTrackKey = song => song.canonical_song_id
    ? `canonical:${song.canonical_song_id}`
    : song.external_id
      ? `external:${song.external_source || ""}:${song.external_id}`
      : `track:${normaliseCompare(song.artist)}:${normaliseCompare(song.title)}`;
  const ratedKeys = new Set(songs.filter(song => rated.has(Number(song.id))).map(getTrackKey));
  const seen = new Set();
  const queue = songs.filter(song => {
    if (!song?.id || Number(song.is_deleted || 0) === 1) return false;
    const key = getTrackKey(song);
    if (rated.has(Number(song.id)) || ratedKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  for (let i = 1; i < queue.length; i++) {
    if (normaliseCompare(queue[i].artist) !== normaliseCompare(queue[i - 1].artist)) continue;
    const replacement = queue.findIndex((song, candidateIndex) =>
      candidateIndex > i && normaliseCompare(song.artist) !== normaliseCompare(queue[i - 1].artist)
    );
    if (replacement > i) [queue[i], queue[replacement]] = [queue[replacement], queue[i]];
  }
  return queue;
}

function getQuickRateSpotifyItem(song, album) {
  if (song?.spotify_track_id) {
    return {
      id: song.spotify_track_id,
      uri: `spotify:track:${song.spotify_track_id}`,
      externalUrl: `https://open.spotify.com/track/${song.spotify_track_id}`
    };
  }
  const uri = song?.spotify_uri || (song?.external_source === "spotify" ? `spotify:track:${song.external_id}` : "");
  const id = song?.spotify_track_id || (uri ? uri.split(":").pop() : "");
  if (id) return { id, uri };
  return getCachedSpotifyMatch({ title: song?.title, artist: song?.artist, album: album?.title || "" });
}

async function resolveQuickRateSpotifyTrack(song) {
  const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
  if (sessionError || !session?.access_token) {
    throw new Error("Your Bank of Music session has expired. Please log in again.");
  }

  const response = await fetch(SPOTIFY_TOKEN_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: window.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ action: "resolve_track", song_id: Number(song.id) })
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After") || data.retry_after || 1);
    const error = new Error("Spotify is temporarily busy.");
    error.retryAfter = Number.isFinite(retryAfter) ? retryAfter : 1;
    throw error;
  }

  if (!response.ok) {
    throw new Error(data.error || `Spotify resolver failed with HTTP ${response.status}.`);
  }

  if (data.status !== "matched" || !data.spotify_track_id) return null;

  song.spotify_track_id = data.spotify_track_id;
  song.spotify_matched_at = data.spotify_matched_at || new Date().toISOString();
  const spotifyItem = {
    id: data.spotify_track_id,
    uri: `spotify:track:${data.spotify_track_id}`,
    external_urls: { spotify: `https://open.spotify.com/track/${data.spotify_track_id}` }
  };
  cacheSpotifyMatch(song, spotifyItem);
  return spotifyItem;
}

function renderQuickRateSpotifyFailure(target, song, retryAfter = 0) {
  if (!target) return;
  const fallbackUrl = getSpotifySearchFallbackUrl(song);
  target.classList.remove("hidden");
  target.innerHTML = `<div class="spotify-embed-error">
    <strong>${retryAfter ? "Spotify is temporarily busy." : "BoM could not find an exact Spotify match."}</strong>
    <span>${retryAfter ? `Try again in about ${retryAfter} second${retryAfter === 1 ? "" : "s"}.` : "You can still search for it directly in Spotify."}</span>
    <a class="spotify-open-externally-btn" href="${escapeHtml(fallbackUrl)}" target="_blank" rel="noopener noreferrer">Search in Spotify</a>
  </div>`;
}

async function listenToQuickRateTrack({ song, album, target, button }) {
  if (!song || !target || !button) return false;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Finding on Spotify…";
  target.classList.remove("hidden");
  target.innerHTML = `<div class="spotify-embed-loading">Finding ${escapeHtml(song.title)} in Spotify…</div>`;

  try {
    await recordMusicProviderClick({
      provider: "spotify",
      type: "song",
      title: song.title,
      artist: song.artist,
      album: album?.title || ""
    });

    const spotifyItem = getQuickRateSpotifyItem(song, album) ||
      await resolveQuickRateSpotifyTrack(song);
    if (!spotifyItem) {
      renderQuickRateSpotifyFailure(target, song);
      return false;
    }

    const embedUrl = buildSpotifyEmbedUrl({ type: "song", spotifyItem });
    const externalUrl = spotifyItem.external_urls?.spotify || spotifyItem.externalUrl ||
      `https://open.spotify.com/track/${encodeURIComponent(getSpotifyEntityId(spotifyItem))}`;
    const rendered = renderSpotifyEmbed({
      target,
      type: "song",
      title: song.title,
      artist: song.artist,
      embedUrl,
      externalUrl
    });
    if (!rendered) throw new Error("NO_PLAYABLE_SPOTIFY_EMBED");
    button.textContent = "Player loaded";
    return true;
  } catch (error) {
    console.error("Quick Rate Spotify player failed:", error);
    renderQuickRateSpotifyFailure(target, song, Number(error?.retryAfter || 0));
    return false;
  } finally {
    button.disabled = false;
    if (button.textContent !== "Player loaded") button.textContent = originalText;
  }
}

async function fetchQuickRateRows(table, columns, userId) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    let query = supabaseClient.from(table).select(columns).order("id", { ascending: true });
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query.range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function openQuickRate() {
  if (!currentUser || document.getElementById("bomQuickRate")) return;
  const userId = currentUser.id;
  const dialog = document.createElement("dialog");
  dialog.id = "bomQuickRate";
  dialog.className = "bom-v1-quick-rate bom-v1-album";
  dialog.setAttribute("aria-labelledby", "bomQuickRateTitle");
  dialog.innerHTML = `<header><h1 id="bomQuickRateTitle">Quick Rate</h1><button type="button" data-quick-exit>Exit Quick Rate</button></header>
    <p data-quick-count>0 rated this session</p><div data-quick-card></div><p data-quick-status role="status">Loading unrated tracks…</p>`;
  document.body.append(dialog);
  const card = dialog.querySelector("[data-quick-card]");
  const status = dialog.querySelector("[data-quick-status]");
  let queue = [], index = 0, count = 0, busy = false;
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector("[data-quick-exit]").onclick = () => dialog.close();
  dialog.showModal();

  function render(focus = false) {
    if (!dialog.open) return;
    if (currentUser?.id !== userId) { dialog.close(); return; }
    while (queue[index] && allSongRatings.some(row => row.user_id === userId && Number(row.song_id) === Number(queue[index].id))) index++;
    const song = queue[index];
    if (!song) {
      card.innerHTML = `<h2>You’re all caught up for this round.</h2><p>Skipped tracks are available again next time.</p>`;
      status.textContent = "No more unrated tracks in this round.";
      dialog.querySelector("[data-quick-exit]").focus();
      return;
    }
    const album = allAlbums.find(row => Number(row.id) === Number(song.album_id));
    const artwork = getAlbumArtworkUrl(album);
    const control = buildCompactTrackRatingControl(song.id, null)
      .replace('<details ', '<details open ')
      .replaceAll('handleStarOptionClick(event, this)', 'handleQuickRateClick(event, this)');
    const albumMeta = album
      ? `${escapeHtml(album.title)}${getStageOneDiscoverYear(album) ? ` · ${escapeHtml(getStageOneDiscoverYear(album))}` : ""}`
      : "Album unavailable";
    card.innerHTML = `<div class="bom-quick-art">${artwork ? `<img src="${escapeHtml(artwork)}" alt="${escapeHtml(album?.title || song.title)} cover" onerror="this.hidden=true">` : ''}<span>bom</span></div>
      <h2>${escapeHtml(song.title)}</h2><p>${escapeHtml(song.artist)}</p><p>${albumMeta}</p>
      <button type="button" data-quick-listen>Listen on Spotify</button>
      <div class="spotify-embed-container hidden bom-quick-spotify" data-quick-spotify aria-live="polite"></div>
      <p>Your rating / 10</p>${control}<button type="button" data-quick-skip>Skip →</button>`;
    card.querySelector("[data-quick-listen]").onclick = event => {
      void listenToQuickRateTrack({
        song,
        album,
        target: card.querySelector("[data-quick-spotify]"),
        button: event.currentTarget
      });
    };
    card.querySelector("[data-quick-skip]").onclick = () => {
      if (busy) return;
      index++;
      status.textContent = "Skipped. No rating saved.";
      render(true);
    };
    if (focus) card.querySelector(".bom-v1-track-rating-choice").focus();
  }

  dialog.saveRating = async (button) => {
    if (busy || currentUser?.id !== userId || !queue[index]) return;
    busy = true;
    card.querySelectorAll("button").forEach(item => item.disabled = true);
    status.textContent = "Saving…";
    try {
      const song = queue[index];
      if (!allSongs.some(row => Number(row.id) === Number(song.id))) allSongs.push(song);
      const saved = await saveTrackRating(song.id, Number(button.dataset.rating));
      if (!dialog.open || currentUser?.id !== userId) return;
      if (!saved) throw new Error("Rating not saved");
      count++;
      dialog.querySelector("[data-quick-count]").textContent = `${count} rated this session`;
      status.textContent = `Saved ${button.dataset.rating} / 10`;
      button.classList.add("is-selected");
      await new Promise(resolve => setTimeout(resolve, 350));
      index++;
      render(true);
    } catch (error) {
      status.textContent = "Couldn’t save your rating. Please try again.";
    } finally {
      busy = false;
      card.querySelectorAll("button").forEach(item => item.disabled = false);
      if (dialog.open) card.querySelector(".bom-v1-track-rating-choice")?.focus();
    }
  };

  try {
    const [songs, albums, ratings] = await Promise.all([
      fetchQuickRateRows("songs", "*"),
      fetchQuickRateRows("albums", "*"),
      fetchQuickRateRows("song_ratings", "id,user_id,song_id,rating", userId)
    ]);
    if (!dialog.open || currentUser?.id !== userId) return;
    albums.forEach(album => {
      if (!allAlbums.some(row => Number(row.id) === Number(album.id))) allAlbums.push(album);
    });
    queue = buildQuickRateQueue(songs, ratings, userId);
    status.textContent = "Choose a rating, or skip a track you don’t know.";
    render();
  } catch (error) {
    status.textContent = "Couldn’t load tracks. Exit Quick Rate and try again.";
  }
}

window.handleQuickRateClick = function (event, button) {
  event.preventDefault();
  event.stopImmediatePropagation();
  void document.getElementById("bomQuickRate")?.saveRating(button);
  return false;
};

async function saveAlbumRating(albumId, ratingValue = null) {

  if (!currentUser) {

    setMessage(globalSearchMessage, "You must be logged in first.");

    return;

  }



  const input = document.getElementById(`album-rating-${albumId}`);

  if (!input && ratingValue === null) return;



  const rating = ratingValue === null ? parseFloat(input.value) : ratingValue;

  if (isNaN(rating) || rating < 0 || rating > 10) {

    setMessage(globalSearchMessage, "Album rating must be between 0 and 10.");

    return;

  }



  const { error } = await supabaseClient

    .from("ratings")

    .upsert(

      [{ user_id: currentUser.id, album_id: Number(albumId), rating }],

      { onConflict: "user_id,album_id" }

    );



  if (error) {

    setMessage(globalSearchMessage, error.message);

    return;

  }



  upsertLocalAlbumRating(albumId, rating);

  if (ratingValue === null) updateStageOneAlbumRatingUi(albumId);

  renderLibrary();

  renderRecommendations();

  setMessage(globalSearchMessage, "Album rating saved.");

  return true;

}

async function deleteAlbumRating(albumId) {
  if (!currentUser) {
    setMessage(globalSearchMessage, "You must be logged in first.");
    return;
  }

  const { error } = await supabaseClient
    .from("ratings")
    .delete()
    .eq("user_id", currentUser.id)
    .eq("album_id", Number(albumId));

  if (error) {
    setMessage(globalSearchMessage, error.message);
    return;
  }

  removeLocalAlbumRating(albumId);
  updateStageOneAlbumRatingUi(albumId);
  renderLibrary();
  renderRecommendations();
  setMessage(globalSearchMessage, "Album rating deleted.");
}



async function saveTrackRating(songId, ratingValue = null) {

  if (!currentUser) {
    setMessage(
      globalSearchMessage,
      "You must be logged in first."
    );
    return;
  }

  const input =
    document.getElementById(
      `track-rating-${songId}`
    ) ||
    document.getElementById(
      `song-rating-${songId}`
    );

  if (!input && ratingValue === null) return;

  const rating = ratingValue === null ? parseFloat(input.value) : ratingValue;

  if (
    isNaN(rating) ||
    rating < 0 ||
    rating > 10
  ) {
    setMessage(
      globalSearchMessage,
      "Track rating must be between 0 and 10."
    );
    return;
  }

  let selectedSong = allSongs.find(
    (song) =>
      Number(song.id) === Number(songId)
  );

  if (!selectedSong && selectedItem?.type === "song") {
    selectedSong = allSongs.find(
      (song) =>
        normaliseCompare(song.title) ===
          normaliseCompare(selectedItem.title) &&
        normaliseCompare(song.artist) ===
          normaliseCompare(selectedItem.artist)
    );
  }

  if (!selectedSong) {
    setMessage(
      globalSearchMessage,
      "BoM could not identify this track to save the rating."
    );
    return;
  }

  const selectedKey = normaliseCompare(
    `${selectedSong.artist}-${selectedSong.title}`
  );

  let matchingSongs = allSongs.filter(
    (song) => {
      const sameExternalId =
        selectedSong.external_id &&
        song.external_id &&
        song.external_id ===
          selectedSong.external_id;

      const sameTitleArtist =
        normaliseCompare(
          `${song.artist}-${song.title}`
        ) === selectedKey;

      return sameExternalId || sameTitleArtist;
    }
  );

  if (!matchingSongs.length) {
    matchingSongs = [selectedSong];
  }

  const ratingRows = matchingSongs.map(
    (song) => ({
      user_id: currentUser.id,
      song_id: Number(song.id),
      rating
    })
  );

  const { error } = await supabaseClient
    .from("song_ratings")
    .upsert(ratingRows, {
      onConflict: "user_id,song_id"
    });

  if (error) {
    setMessage(
      globalSearchMessage,
      error.message
    );
    return;
  }

  matchingSongs.forEach((song) => {
    upsertLocalSongRating(
      song.id,
      rating
    );

    updateTrackRowUi(song.id);
  });

  /*
    Re-read this user's saved rows in the background so every
    route (album, song detail and charts) uses the same source.
  */
  void supabaseClient
    .from("song_ratings")
    .select("*")
    .eq("user_id", currentUser.id)
    .then(({ data, error }) => {
      if (!error && Array.isArray(data)) {
        const otherUsersRows =
          allSongRatings.filter(
            (row) =>
              row.user_id !== currentUser.id
          );

        allSongRatings = [
          ...otherUsersRows,
          ...data
        ];
      }
    });

  /*
    Keep both possible selector IDs in sync. This prevents one
    song-detail route showing the old value after a successful save.
  */
  updateStarSelector(
    `track-rating-${selectedSong.id}`,
    rating
  );

  updateStarSelector(
    `song-rating-${selectedSong.id}`,
    rating
  );

  const currentDetailRating =
    selectedItemDetail?.querySelector(
      ".detail-meta-grid .detail-meta-value:last-child"
    );

  const selectedDetailSongId =
    selectedItem?.savedSongId ||
    selectedItem?.songId ||
    selectedItem?.id;

  const selectedDetailMatchesSong = selectedDetailSongId
    ? Number(selectedDetailSongId) === Number(selectedSong.id)
    : normaliseCompare(
        `${selectedItem?.artist}-${selectedItem?.title}`
      ) === selectedKey;

  if (
    selectedItem?.type === "song" &&
    selectedDetailMatchesSong &&
    currentDetailRating
  ) {
    currentDetailRating.textContent =
      `${rating}/10`;
  }

  renderLibrary();

  setMessage(
    globalSearchMessage,
    "Track rating saved."
  );

  return true;
}

async function deleteTrackRating(songId) {

  if (!currentUser) {

    setMessage(globalSearchMessage, "You must be logged in first.");

    return;

  }



  const { error } = await supabaseClient

    .from("song_ratings")

    .delete()

    .eq("user_id", currentUser.id)

    .eq("song_id", Number(songId));



  if (error) {

    setMessage(globalSearchMessage, error.message);

    return;

  }



  removeLocalSongRating(songId);

  updateTrackRowUi(songId);

  renderLibrary();

  setMessage(globalSearchMessage, "Track rating deleted.");

}


/* PASTE NEW FUNCTION HERE */

window.handleStarOptionClick = async function (event, button) {

  lastTrackRatingInteractionAt = Date.now();

  event.preventDefault();

  event.stopPropagation();

  event.stopImmediatePropagation();

  const targetId = button.dataset.targetInput;

  const rating = Number(button.dataset.rating);

  updateStarSelector(targetId, rating);

  if (
    targetId.startsWith("track-rating-") ||
    targetId.startsWith("song-rating-")
  ) {

    const songId = targetId
      .replace("track-rating-", "")
      .replace("song-rating-", "");

    await saveTrackRating(songId);

    return false;

  }

  if (targetId.startsWith("album-rating-")) {

    const albumId = targetId.replace("album-rating-", "");

    await saveAlbumRating(albumId);

    return false;

  }

  return false;

};

/* YOUR EXISTING EVENT LISTENER */



function getAlbumRatingCount(albumId) {

  return allAlbumRatings.filter((row) => Number(row.album_id) === Number(albumId)).length;

}



function getSongRatingCount(songId) {

  return allSongRatings.filter((row) => Number(row.song_id) === Number(songId)).length;

}



function renderAdminTrackListingRow(song, fallbackArtist = "", position = "") {
  return `<div class="admin-track-listing-row" data-admin-track-row data-song-id="${song?.id || ""}">
    <input class="admin-track-listing-position" data-admin-track-position type="number" min="1" value="${escapeHtml(song?.track_position || position || "")}" aria-label="Track position">
    <input data-admin-track-title value="${escapeHtml(song?.title || "")}" placeholder="Track title" aria-label="Track title">
    <input data-admin-track-artist value="${escapeHtml(song?.artist || fallbackArtist)}" placeholder="Track artist" aria-label="Track artist">
    <button type="button" class="admin-track-listing-remove danger-btn">Remove</button>
  </div>`;
}

function renderAdminTrackListingEditor() {
  const album = allAlbums.find((item) => Number(item.id) === Number(adminEditingTrackAlbumId));
  if (!album) return "";
  const tracks = allSongs
    .filter((song) => Number(song.album_id) === Number(album.id))
    .sort((a, b) => Number(a.track_position || 9999) - Number(b.track_position || 9999) || Number(a.id) - Number(b.id));
  return `<div class="admin-panel admin-track-listing-editor" data-admin-track-listing-editor data-album-id="${album.id}">
    <div class="admin-track-listing-header">
      <div><h3>Edit track listing</h3><p class="small">${escapeHtml(album.artist)} — ${escapeHtml(album.title)}</p></div>
      <button type="button" class="admin-track-listing-cancel secondary-btn">Cancel</button>
    </div>
    <div class="admin-track-listing-labels" aria-hidden="true"><span>#</span><span>Title</span><span>Artist</span><span></span></div>
    <div data-admin-track-rows>${tracks.map((song) => renderAdminTrackListingRow(song, album.artist)).join("")}</div>
    <div class="admin-track-listing-actions">
      <button type="button" class="admin-track-listing-add secondary-btn">Add track</button>
      <button type="button" class="admin-track-listing-save">Save complete listing</button>
    </div>
    <p class="small">Removing a track detaches it from this album without deleting its ratings or external identity.</p>
  </div>`;
}

async function saveAdminTrackListing(editor) {
  if (!isAdmin || !editor) return;
  const albumId = Number(editor.dataset.albumId || 0);
  const tracks = [...editor.querySelectorAll("[data-admin-track-row]")].map((row) => ({
    id: row.dataset.songId ? Number(row.dataset.songId) : null,
    position: Number(row.querySelector("[data-admin-track-position]")?.value || 0),
    title: normaliseText(row.querySelector("[data-admin-track-title]")?.value || ""),
    artist: normaliseText(row.querySelector("[data-admin-track-artist]")?.value || "")
  }));
  if (tracks.some((track) => !track.position || !track.title || !track.artist)) {
    setMessage(adminMessage, "Every track needs a positive position, title and artist.");
    return;
  }
  const { error } = await supabaseClient.rpc("admin_update_album_track_listing", {
    p_album_id: albumId,
    p_tracks: tracks
  });
  if (error) {
    setMessage(adminMessage, error.message);
    return;
  }
  adminEditingTrackAlbumId = null;
  setMessage(adminMessage, "Track listing updated.");
  await refreshAdminDashboard();
}

function renderAdminDashboard() {

  if (!adminDashboard) return;

  if (!currentUser) {

    adminDashboard.innerHTML = `<p class="small">Log in to use admin tools.</p>`;

    return;

  }

  if (!isAdmin) {

    adminDashboard.innerHTML = `<p class="small">Admin tools are only available to admin users.</p>`;

    return;

  }

  const query = normaliseCompare(adminSearchInput?.value || "");

  const matchingAlbums = query
    ? allAlbums
        .filter((album) => normaliseCompare(`${album.title} ${album.artist}`).includes(query))
        .slice(0, 24)
    : [];

  const matchingSongs = query
    ? allSongs
        .filter((song) => {
          const albumName = song.album_id ? getAlbumNameById(song.album_id) : "";
          return normaliseCompare(`${song.title} ${song.artist} ${albumName}`).includes(query);
        })
        .slice(0, 24)
    : [];

  adminDashboard.innerHTML = `
  
  <div class="admin-panel">
  <h3>Members</h3>

  <div class="admin-summary-grid">
    <div class="admin-stat-card">
      <div class="admin-stat-number" id="adminTotalUsers">0</div>
      <div>Total users</div>
    </div>
  </div>

  <div class="admin-stat-card" style="margin-top: 16px; max-width: 520px;">
    <h4>Latest members</h4>
    <div id="latestMembers">
      <p class="small">Loading members...</p>
    </div>
  </div>
</div>

    <div class="admin-summary-grid">

      <div class="admin-stat-card"><div class="admin-stat-number">${allAlbums.length}</div><div>Albums</div></div>

      <div class="admin-stat-card"><div class="admin-stat-number">${allSongs.length}</div><div>Songs</div></div>

      <div class="admin-stat-card"><div class="admin-stat-number">${allAlbumRatings.length}</div><div>Album ratings</div></div>

      <div class="admin-stat-card"><div class="admin-stat-number">${allSongRatings.length}</div><div>Track ratings</div></div>

    </div>

    ${renderAdminTrackListingEditor()}

    <div class="admin-panel">

      <h3>Albums</h3>

      <p class="small">Fix album artwork, open an album, or remove a bad album entry.</p>

      <div class="admin-list">

        ${matchingAlbums.length ? matchingAlbums.map((album) => `

          <div class="admin-row" data-admin-album-id="${album.id}">

            <div class="admin-cover-wrap">${getAlbumCoverMarkup(getAlbumArtworkUrl(album), `${album.title} cover`)}</div>

            <div class="admin-main">
 
              <div class="admin-title">${escapeHtml(album.title)}</div>

              <div class="admin-meta">${escapeHtml(album.artist || "Unknown artist")}</div>

              <div class="admin-meta">${getAlbumRatingCount(album.id)} album rating${getAlbumRatingCount(album.id) === 1 ? "" : "s"}</div>

            </div>

            <div class="admin-actions">

              <button class="admin-open-album-btn" data-album-id="${album.id}">Open</button>

              <button class="admin-edit-track-listing-btn secondary-btn" data-album-id="${album.id}">Edit track listing</button>

              <button class="admin-edit-cover-btn" data-album-id="${album.id}">Edit cover</button>

              <button class="admin-delete-album-btn danger-btn" data-album-id="${album.id}">Delete</button>

            </div>

          </div>

        `).join("") : `<p class="small">${query ? "No albums found." : "Search to find an album."}</p>`}

      </div>

    </div>

    <div class="admin-panel">

      <h3>Songs / tracks</h3>

      <p class="small">Delete bad duplicate tracks or open the linked album.</p>

      <div class="admin-list">

        ${matchingSongs.length ? matchingSongs.map((song) => `

          <div class="admin-row" data-admin-song-id="${song.id}">

            <div class="admin-song-icon">♪</div>

            <div class="admin-main">

              <div class="admin-title">${escapeHtml(song.title)}</div>

              <div class="admin-meta">${escapeHtml(song.artist || "Unknown artist")}${song.album_id ? ` · ${escapeHtml(getAlbumNameById(song.album_id))}` : ""}</div>

              <div class="admin-meta">${getSongRatingCount(song.id)} track rating${getSongRatingCount(song.id) === 1 ? "" : "s"}${song.track_position ? ` · Position ${song.track_position}` : ""}</div>

            </div>

            <div class="admin-actions">

              ${song.album_id ? `<button class="admin-open-album-btn" data-album-id="${song.album_id}">Open album</button>` : ""}

              <button class="admin-edit-song-btn secondary-btn" data-song-id="${song.id}">Edit track</button>

              <button class="admin-delete-song-btn danger-btn" data-song-id="${song.id}">Delete</button>

            </div>

          </div>

        `).join("") : `<p class="small">${query ? "No songs found." : "Search to find a song or track."}</p>`}

      </div>

    </div>

  `;

loadAdminStats();
}

async function loadAdminStats() {
  const totalUsers = document.getElementById("adminTotalUsers");
  const totalRatings = document.getElementById("adminTotalRatings");
  const totalAlbums = document.getElementById("adminTotalAlbums");
  const totalSongs = document.getElementById("adminTotalSongs");
  const latestMembers = document.getElementById("latestMembers");

  if (!latestMembers) return;

  latestMembers.innerHTML = `<p class="small">Loading members...</p>`;

  const { data: members, error: membersError } = await supabaseClient
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  if (membersError) {
    latestMembers.innerHTML = `<p class="small">Could not load members: ${escapeHtml(membersError.message)}</p>`;
  } else {
    latestMembers.innerHTML = (members || []).length
      ? members.map((member) => `
          <div class="member-row">
            <strong>#${member.member_number || "-"}</strong>
            &nbsp;
            <strong>@${escapeHtml(member.handle || "unknown")}</strong>
            &nbsp;
            <span>${member.birth_year || ""}</span>
          </div>
        `).join("")
      : `<p class="small">No members yet.</p>`;
  }

  const { count: userCount } = await supabaseClient
    .from("profiles")
    .select("*", { count: "exact", head: true });

  const { count: albumRatingCount } = await supabaseClient
    .from("ratings")
    .select("*", { count: "exact", head: true });

  const { count: songRatingCount } = await supabaseClient
    .from("song_ratings")
    .select("*", { count: "exact", head: true });

  const { count: albumCount } = await supabaseClient
    .from("albums")
    .select("*", { count: "exact", head: true });

  const { count: songCount } = await supabaseClient
    .from("songs")
    .select("*", { count: "exact", head: true });

  if (totalUsers) totalUsers.textContent = userCount || 0;
  if (totalRatings) totalRatings.textContent = (albumRatingCount || 0) + (songRatingCount || 0);
  if (totalAlbums) totalAlbums.textContent = albumCount || 0;
  if (totalSongs) totalSongs.textContent = songCount || 0;
}

async function refreshAdminDashboard() {

  await loadLibrary();

  renderLibrary();

  renderRecommendations();

  renderAdminDashboard();

}



async function adminOpenAlbum(albumId) {

  const album = allAlbums.find((row) => Number(row.id) === Number(albumId));

  if (!album) return;

  selectedItem = {

    type: "album",

    title: album.title,

    artist: album.artist,

    externalId: album.external_id || "",

    releaseDate: album.release_date || "",

    coverUrl: getAlbumArtworkUrl(album),

    savedAlbumId: album.id

  };

  showOnlySection("detailSection");

  await renderSelectedItem();

}



async function adminEditAlbumCover(albumId) {

  if (!isAdmin) return;

  const album = allAlbums.find((row) => Number(row.id) === Number(albumId));

  if (!album) return;

  const currentUrl = album.cover_art_url || "";

  const newUrl = prompt(`Paste a new cover image URL for ${album.title}:`, currentUrl);

  if (newUrl === null) return;

  const cleanUrl = normaliseText(newUrl);

  const { error } = await supabaseClient

    .from("albums")

    .update({ cover_art_url: cleanUrl || null })

    .eq("id", Number(albumId));

  if (error) {

    setMessage(adminMessage, error.message);

    return;

  }

  setMessage(adminMessage, "Album cover updated.");

  await refreshAdminDashboard();

  if (selectedItem?.savedAlbumId && Number(selectedItem.savedAlbumId) === Number(albumId)) {

    await renderSelectedItem();

  }

}



async function adminDeleteSong(songId) {
  if (!isAdmin) return;

  const confirmDelete = confirm("Delete this track from the album?");
  if (!confirmDelete) return;

  const { data: song, error: findError } = await supabaseClient
    .from("songs")
    .select("id, title, album_id")
    .eq("id", Number(songId))
    .single();

  if (findError || !song) {
    alert("Could not find this track.");
    return;
  }

  const { error } = await supabaseClient
    .from("songs")
    .delete()
    .eq("id", Number(songId));

  if (error) {
    alert("Could not delete track: " + error.message);
    return;
  }

  alert(`Deleted track: ${song.title}`);

  await loadLibrary();
  await refreshAdminDashboard();

  if (selectedItem?.savedAlbumId && Number(selectedItem.savedAlbumId) === Number(song.album_id)) {
    await renderSelectedItem();
  }
}



async function adminDeleteAlbum(albumId) {

  if (!isAdmin) return;

  const album = allAlbums.find((row) => Number(row.id) === Number(albumId));

  if (!album) return;

  const linkedSongs = allSongs.filter((song) => Number(song.album_id) === Number(albumId));

  if (!confirm(`Delete album: ${album.title}? This also removes ${linkedSongs.length} linked tracks and related ratings.`)) return;

  for (const song of linkedSongs) {

    await supabaseClient.from("song_ratings").delete().eq("song_id", Number(song.id));

  }

  await supabaseClient.from("songs").delete().eq("album_id", Number(albumId));

  await supabaseClient.from("ratings").delete().eq("album_id", Number(albumId));

  const { error } = await supabaseClient.from("albums").delete().eq("id", Number(albumId));

  if (error) {

    setMessage(adminMessage, error.message);

    return;

  }

  setMessage(adminMessage, "Album deleted.");

  if (selectedItem?.savedAlbumId && Number(selectedItem.savedAlbumId) === Number(albumId)) {

    selectedItem = null;

  }

  await refreshAdminDashboard();

  await renderSelectedItem();

}


if (signupBtn) signupBtn.addEventListener("click", signUp);

if (loginBtn) loginBtn.addEventListener("click", logIn);

if (logoutBtn) logoutBtn.addEventListener("click", logOut);

if (forgotPasswordBtn) forgotPasswordBtn.addEventListener("click", resetPassword);

if (globalSearchBtn) {
  globalSearchBtn.addEventListener("click", () => runGlobalSearch(false));
}

if (globalSearchInput) {

  globalSearchInput.addEventListener("input", () => {

    clearTimeout(searchDebounceTimer);

    searchDebounceTimer = setTimeout(() => {

      runGlobalSearch(false);

    }, 350);

  });

  globalSearchInput.addEventListener("keydown", (event) => {

    if (event.key === "Enter") {

      event.preventDefault();

      clearTimeout(searchDebounceTimer);

      runGlobalSearch(false);

    }

  });

}





if (albumsList) {
  albumsList.addEventListener("click", async function(event) {

    const card = event.target.closest("[data-library-type='album']");
    if (!card) return;

    const albumId = Number(card.dataset.albumId);
    const album = allAlbums.find((row) => Number(row.id) === albumId);

    if (!album) return;

    selectedItem = {
      type: "album",
      title: album.title,
      artist: album.artist,
      externalId: album.external_id || "",
      releaseDate: album.release_date || "",
      coverUrl: album.cover_art_url || "",
      savedAlbumId: album.id
    };

    showOnlySection("detailSection");
    await renderSelectedItem();

  });
}



songsList?.addEventListener("click", async (event) => {

  const card = event.target.closest("[data-library-type='song']");

  if (!card) return;



  const songId = Number(card.dataset.songId);

  const song = allSongs.find((row) => Number(row.id) === songId);

  if (!song) return;



  selectedItem = {

    type: "song",

    title: song.title,

    artist: song.artist,

    externalId: song.external_id || "",

    albumId: song.album_id || "",

    coverUrl: song.cover_art_url || ""

  };



  await renderSelectedItem();

  showOnlySection("detailSection");

});



if (refreshLibraryBtn) {

  refreshLibraryBtn.addEventListener("click", async () => {

    await loadLibrary();

    renderLibrary();

    renderRecommendations();

    renderAdminDashboard();

    await renderSelectedItem();

    renderAdminDashboard();

  });

}



if (adminRefreshBtn) {

  adminRefreshBtn.addEventListener("click", refreshAdminDashboard);

}



if (adminSearchInput) {

  adminSearchInput.addEventListener("input", renderAdminDashboard);

}



if (adminDashboard) {

  adminDashboard.addEventListener("click", async (event) => {

    const editTrackListingButton = event.target.closest(".admin-edit-track-listing-btn");

    if (editTrackListingButton) {

      adminEditingTrackAlbumId = Number(editTrackListingButton.dataset.albumId);

      renderAdminDashboard();

      adminDashboard.querySelector("[data-admin-track-listing-editor]")?.scrollIntoView({ behavior: "smooth", block: "start" });

      return;

    }

    const trackListingEditor = event.target.closest("[data-admin-track-listing-editor]");

    if (trackListingEditor && event.target.closest(".admin-track-listing-add")) {

      const album = allAlbums.find((item) => Number(item.id) === Number(trackListingEditor.dataset.albumId));

      const rows = trackListingEditor.querySelector("[data-admin-track-rows]");

      const nextPosition = Math.max(0, ...[...rows.querySelectorAll("[data-admin-track-position]")].map((input) => Number(input.value || 0))) + 1;

      rows.insertAdjacentHTML("beforeend", renderAdminTrackListingRow(null, album?.artist || "", nextPosition));

      return;

    }

    if (trackListingEditor && event.target.closest(".admin-track-listing-remove")) {

      event.target.closest("[data-admin-track-row]")?.remove();

      return;

    }

    if (trackListingEditor && event.target.closest(".admin-track-listing-cancel")) {

      adminEditingTrackAlbumId = null;

      renderAdminDashboard();

      return;

    }

    if (trackListingEditor && event.target.closest(".admin-track-listing-save")) {

      await saveAdminTrackListing(trackListingEditor);

      return;

    }

    const openAlbumButton = event.target.closest(".admin-open-album-btn");

    if (openAlbumButton) {

      await adminOpenAlbum(openAlbumButton.dataset.albumId);

      return;

    }

    const editCoverButton = event.target.closest(".admin-edit-cover-btn");

    if (editCoverButton) {

      await adminEditAlbumCover(editCoverButton.dataset.albumId);

      return;

    }

    const editSongButton = event.target.closest(".admin-edit-song-btn");

    if (editSongButton) {

      await adminEditSong(editSongButton.dataset.songId);

      return;

    }

    const deleteSongButton = event.target.closest(".admin-delete-song-btn");

    if (deleteSongButton) {

      await adminDeleteSong(deleteSongButton.dataset.songId);

      return;

    }

    const deleteAlbumButton = event.target.closest(".admin-delete-album-btn");

    if (deleteAlbumButton) {

      await adminDeleteAlbum(deleteAlbumButton.dataset.albumId);

    }

  });

}



topNavButtons.forEach((button) => {

  button.addEventListener("click", () => {

    showOnlySection(button.dataset.target);

  });

});

loadChartsBtn?.addEventListener("click", loadCharts);

document.querySelector(".nav-left")?.addEventListener("click", () => {
  showOnlySection("searchSection");
  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
});

selectedItemDetail?.addEventListener("click", async (event) => {

  const ratingClick = event.target.closest(
    ".star, .rating-star, .star-selector, .track-rating, .album-rating, .star-rating-button"
  );

  if (ratingClick) {
    event.stopPropagation();
  }

  const backButton = event.target.closest("[data-back-to-previous]");

  if (backButton) {
    event.preventDefault();
    event.stopPropagation();

    if (window.history.length > 1) {
      window.history.back();
    } else {
      showOnlySection(previousSectionId || "searchSection");
    }

    return;
  }

  const deleteTrackButton = event.target.closest(".admin-delete-track-btn");

  if (deleteTrackButton) {
    event.preventDefault();
    event.stopPropagation();
    await adminDeleteSong(deleteTrackButton.dataset.songId);
    return;
  }
});



if (globalSearchResults) {

  globalSearchResults.addEventListener("click", async (event) => {
	  
	  const tabButton = event.target.closest(".search-tab");

if (tabButton) {
  const filter = tabButton.dataset.searchFilter;

  globalSearchResults.querySelectorAll(".search-tab").forEach((button) => {
    button.classList.toggle("active-search-tab", button === tabButton);
  });

  globalSearchResults.querySelectorAll("[data-result-group]").forEach((item) => {
    item.classList.toggle(
      "hidden",
      filter !== "all" && item.dataset.resultGroup !== filter
    );
  });

  globalSearchResults.querySelectorAll(".section-divider[data-group]").forEach((heading) => {
    heading.classList.toggle(
      "hidden",
      filter !== "all" && heading.dataset.group !== filter
    );
  });

  globalSearchResults.querySelectorAll(".show-more-row").forEach((row) => {
    row.classList.toggle("hidden", filter !== "all");
  });

  return;
}

    const moreButton = event.target.closest(".show-more-results-btn");

    if (moreButton) {

      const group = moreButton.dataset.group;

      if (!group) return;



      const hiddenItems = Array.from(

        globalSearchResults.querySelectorAll(`.extra-result[data-result-group="${group}"].hidden`)

      );



      hiddenItems.slice(0, 10).forEach((item) => item.classList.remove("hidden"));



      const remainingHidden = globalSearchResults.querySelectorAll(`.extra-result[data-result-group="${group}"].hidden`).length;

      const matchingButtons = globalSearchResults.querySelectorAll(`.show-more-results-btn[data-group="${group}"]`);



      matchingButtons.forEach((button) => {

        if (!button.classList.contains("section-divider")) {

          if (remainingHidden === 0) {

            button.closest(".show-more-row")?.classList.add("hidden");

          } else {

            button.textContent = `Show more ${group} (${remainingHidden} more)`;

          }

        } else {

          const moreText = button.querySelector(".result-heading-more");

          if (moreText) {

            moreText.textContent = remainingHidden === 0 ? "— all shown" : "— tap for more";

          }

        }

      });



      return;

    }



    const button = event.target.closest(".select-result-btn");

    if (!button) return;



    const groupedResults = JSON.parse(globalSearchResults.dataset.results || "{}");

    const group = button.dataset.group;

    const index = Number(button.dataset.index);

    if (!groupedResults[group] || !groupedResults[group][index]) return;



    selectedItem = groupedResults[group][index];



    showOnlySection("detailSection");



    if (typeof renderLoadingSkeleton === "function") {

      renderLoadingSkeleton(selectedItemDetail, "detail");

    }



    try {

      await renderSelectedItem();

    } catch (error) {

      console.error("Open selected failed");

      console.error("selectedItem =", selectedItem);

      console.error("error =", error);

      console.error("error message =", error?.message);

      console.error("error stack =", error?.stack);



      if (selectedItemDetail) {

        selectedItemDetail.innerHTML = `

          <p class="small">Could not open selection.</p>

          <p class="small">Type: ${selectedItem?.type || "unknown"}</p>

          <p class="small">Title: ${selectedItem?.title || "unknown"}</p>

          <p class="small">Artist: ${selectedItem?.artist || "unknown"}</p>

        `;

      }

    }

  });

}

document.addEventListener("click", async function (event) {
  const starButton = event.target.closest(".star-option");

  if (!starButton) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  await window.handleStarOptionClick(event, starButton);

  return false;
}, true);

/*
  Capture provider-control taps before the main selected-item
  navigation listener sees them. This is especially important in
  iOS Safari/Textastic preview where a synthetic second click can
  land on the album card after the player area expands.
*/
document.addEventListener(
  "pointerdown",
  (event) => {
    if (
      event.target.closest(
        "[data-music-provider-panel='true']"
      ) ||
      event.target.closest(
        "[data-track-preview='true']"
      ) ||
      event.target.closest(
        "#albumTrackPreviewDock"
      )
    ) {
      lastMusicProviderInteractionAt =
        Date.now();

      event.stopPropagation();
    }
  },
  true
);

document.addEventListener("click", async (event) => {
  const chartCard = event.target.closest(".chart-card");
  if (!chartCard) return;

  event.preventDefault();

  const itemType = chartCard.dataset.chartType;
  const itemId = Number(chartCard.dataset.chartId);

  if (itemType === "album") {
    const album = allAlbums.find((row) => Number(row.id) === itemId);
    if (!album) return;

    selectedItem = {
      type: "album",
      title: album.title,
      artist: album.artist,
      externalId: album.external_id || "",
      releaseDate: album.release_date || "",
      coverUrl: getAlbumArtworkUrl(album),
      savedAlbumId: album.id
    };
  }

  if (itemType === "song") {
    const song = allSongs.find((row) => Number(row.id) === itemId);
    if (!song) return;

    selectedItem = {
      type: "song",
      title: song.title,
      artist: song.artist,
      externalId: song.external_id || "",
      savedSongId: song.id
    };
  }

  showOnlySection("detailSection");
  await renderSelectedItem();
});


let spotifyAlbumWarmupKey = "";
let spotifyAlbumWarmupPromise = null;

function getCurrentAlbumPreviewButtons() {
  return [
    ...document.querySelectorAll(
      "[data-track-preview='true']"
    )
  ];
}

async function warmSpotifyTrackCacheForCurrentAlbum() {
  const buttons =
    getCurrentAlbumPreviewButtons();

  if (!buttons.length) return;

  const albumTitle =
    buttons[0]?.dataset.providerAlbum || "";

  const artist =
    buttons[0]?.dataset.providerArtist || "";

  const warmupKey =
    `${normaliseSpotifyMatchText(artist)}|` +
    `${normaliseSpotifyMatchText(albumTitle)}`;

  if (
    warmupKey &&
    spotifyAlbumWarmupKey === warmupKey &&
    spotifyAlbumWarmupPromise
  ) {
    return spotifyAlbumWarmupPromise;
  }

  spotifyAlbumWarmupKey = warmupKey;

  spotifyAlbumWarmupPromise =
    (async () => {
      const accessToken =
        await getValidSpotifyAccessToken();

      if (!accessToken) return;

      const pending = buttons
        .map((button) => ({
          title:
            button.dataset.providerTitle || "",
          artist:
            button.dataset.providerArtist || "",
          album:
            button.dataset.providerAlbum || ""
        }))
        .filter(
          (track) =>
            track.title &&
            track.artist &&
            !getCachedSpotifyMatch(track)
        );

      /*
        Match a few tracks at a time so album opening stays fast
        and Spotify is not hit with a burst of requests.
      */
      const concurrency = 3;
      let nextIndex = 0;

      async function worker() {
        while (nextIndex < pending.length) {
          const index = nextIndex++;
          const track = pending[index];

          try {
            await searchSpotifyTrackForBoMTrack(
              track
            );
          } catch (error) {
            console.warn(
              "Spotify preview warmup skipped:",
              track.title,
              error
            );
          }
        }
      }

      await Promise.all(
        Array.from(
          {
            length: Math.min(
              concurrency,
              pending.length
            )
          },
          () => worker()
        )
      );
    })();

  return spotifyAlbumWarmupPromise;
}

function scheduleSpotifyTrackCacheWarmup() {
  const tryWarmup = (attempt = 0) => {
    window.setTimeout(
      () => {
        const buttons =
          getCurrentAlbumPreviewButtons();

        if (!buttons.length && attempt < 4) {
          tryWarmup(attempt + 1);
          return;
        }

        void warmSpotifyTrackCacheForCurrentAlbum();
      },
      attempt === 0 ? 250 : 350
    );
  };

  tryWarmup();
}

function getOrCreateReusableAlbumPreviewFrame({
  dock,
  title,
  artist,
  embedUrl,
  externalUrl
}) {
  if (!dock || !embedUrl) {
    return false;
  }

  dock.classList.remove("hidden");

  let card = dock.querySelector(
    ".album-track-preview-card"
  );

  let frame = dock.querySelector(
    ".album-track-preview-frame"
  );

  if (!card || !frame) {
    dock.innerHTML = `
      <div class="album-track-preview-card">
        <div class="album-track-preview-heading">
          <div>
            <div class="album-track-preview-kicker">
              Now previewing
            </div>

            <strong
              class="album-track-preview-title"
            ></strong>

            <span
              class="album-track-preview-artist"
            ></span>
          </div>

          <a
            class="album-track-preview-open"
            target="_blank"
            rel="noopener noreferrer"
            onclick="event.stopPropagation();"
          >
            Open in Spotify
          </a>
        </div>

        <iframe
          class="spotify-embed-frame album-track-preview-frame"
          width="100%"
          height="152"
          frameborder="0"
          allowfullscreen
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        ></iframe>

        <div class="album-track-preview-note">
          Tap ▶ in the Spotify player to hear the track.
          Then choose another song below to switch the same player.
        </div>
      </div>
    `;

    card = dock.querySelector(
      ".album-track-preview-card"
    );

    frame = dock.querySelector(
      ".album-track-preview-frame"
    );
  }

  const titleNode = dock.querySelector(
    ".album-track-preview-title"
  );

  const artistNode = dock.querySelector(
    ".album-track-preview-artist"
  );

  const openLink = dock.querySelector(
    ".album-track-preview-open"
  );

  if (titleNode) {
    titleNode.textContent = title;
  }

  if (artistNode) {
    artistNode.textContent = artist;
  }

  if (openLink) {
    openLink.href = externalUrl;
  }

  /*
    Keep one iframe in the DOM and switch its Spotify entity.
    This avoids stacking multiple players or error panels.
  */
  if (frame.src !== embedUrl) {
    frame.title =
      `Spotify preview for ${title} by ${artist}`;

    frame.src = embedUrl;
  }

  return true;
}

async function handleAlbumTrackPreviewButton(
  trackPreviewButton
) {
  if (!trackPreviewButton) return;

  lastMusicProviderInteractionAt =
    Date.now();

  const albumSnapshot =
    selectedItem
      ? { ...selectedItem }
      : null;

  const dock =
    document.getElementById(
      "albumTrackPreviewDock"
    );

  if (!dock) return;

  document
    .querySelectorAll(
      "[data-track-preview='true'].is-active"
    )
    .forEach((button) => {
      if (button !== trackPreviewButton) {
        button.classList.remove(
          "is-active"
        );
        button.removeAttribute(
          "aria-pressed"
        );
      }
    });

  trackPreviewButton.classList.add(
    "is-active"
  );

  trackPreviewButton.setAttribute(
    "aria-pressed",
    "true"
  );

  dock.classList.remove("hidden");

  dock.innerHTML = `
    <div class="album-track-preview-loading">
      <div>
        <div class="album-track-preview-kicker">
          Spotify preview
        </div>

        <strong>
          ${escapeHtml(
            trackPreviewButton.dataset
              .providerTitle || ""
          )}
        </strong>

        <span>
          Finding this track…
        </span>
      </div>
    </div>
  `;

  await openWithMusicProvider({
    type: "song",
    title:
      trackPreviewButton.dataset
        .providerTitle || "",
    artist:
      trackPreviewButton.dataset
        .providerArtist || "",
    album:
      trackPreviewButton.dataset
        .providerAlbum || "",
    button: null,
    targetElement: dock
  });

  /*
    Previewing must never change the selected BoM album.
    Restore the exact album snapshot if any unrelated listener
    attempted to navigate while Spotify was loading.
  */
  if (
    albumSnapshot &&
    (
      selectedItem?.type !==
        albumSnapshot.type ||
      selectedItem?.title !==
        albumSnapshot.title ||
      selectedItem?.artist !==
        albumSnapshot.artist
    )
  ) {
    selectedItem = albumSnapshot;
  }

  lastMusicProviderInteractionAt =
    Date.now();

  dock.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
}

/*
  Handle track previews in the capture phase so the tap never
  reaches album cards, song cards, swipe handlers or other
  navigation listeners on iOS.
*/
document.addEventListener(
  "click",
  (event) => {
    const previewButton =
      event.target.closest(
        "[data-track-preview='true']"
      );

    if (!previewButton) return;

    lastMusicProviderInteractionAt =
      Date.now();

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    void handleAlbumTrackPreviewButton(
      previewButton
    );
  },
  true
);

function bindCardClicks(container) {
  if (!container) return;

  container.addEventListener("click", async (event) => {
    const saveTrackBtn = event.target.closest(".save-track-btn");

if (saveTrackBtn) {
	console.log("SAVE TRACK CLICKED", saveTrackBtn.dataset);
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const title = saveTrackBtn.dataset.trackTitle || "";
  const externalId = saveTrackBtn.dataset.trackExternalId || "";

  const albumId = Number(
    saveTrackBtn.dataset.albumId ||
    selectedItem.savedAlbumId ||
    selectedItem.albumId
  );

  const savedTrack = await saveTrackFromAlbum(title, externalId, albumId);
  
  await loadLibrary();

const track = Array.isArray(savedTrack) ? savedTrack[0] : savedTrack;

if (track) {
  allSongs = [
    ...allSongs.filter(song => Number(song.id) !== Number(track.id)),
    track
  ];
}

console.log("AFTER SAVE allSongs contains:", allSongs.filter(song =>
  Number(song.album_id) === Number(albumId)
));

await renderSelectedItem();

return false;

await loadLibrary();

if (savedTrack) {
  const track = Array.isArray(savedTrack) ? savedTrack[0] : savedTrack;
  allSongs.push(track);
}

await renderSelectedItem();

return false;
}

if (
  event.target.closest(".star-option") ||
  event.target.closest(".delete-track-rating-btn") ||
  event.target.closest(".admin-edit-track-btn") ||
  event.target.closest(".admin-delete-track-btn")
) {
  return;
}

    const trackPreviewButton =
      event.target.closest(
        "[data-track-preview='true']"
      );

    /*
      Track previews are handled by the capture-phase listener
      above. Keep this guard as a second line of defence.
    */
    if (trackPreviewButton) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }

    const musicProviderButton =
      event.target.closest(
        ".music-provider-play-btn"
      );

    if (musicProviderButton) {
      lastMusicProviderInteractionAt = Date.now();

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      await openWithMusicProvider({
        type:
          musicProviderButton.dataset
            .providerType || "song",
        title:
          musicProviderButton.dataset
            .providerTitle || "",
        artist:
          musicProviderButton.dataset
            .providerArtist || "",
        album:
          musicProviderButton.dataset
            .providerAlbum || "",
        button: musicProviderButton,
        playerTarget:
          musicProviderButton.dataset
            .playerTarget || ""
      });

      return;
    }

    const spotifyExternalLink =
      event.target.closest(
        ".spotify-open-externally-btn"
      );

    if (spotifyExternalLink) {
      lastMusicProviderInteractionAt = Date.now();

      event.stopPropagation();
      event.stopImmediatePropagation();

      return;
    }

    const providerPanel =
      event.target.closest(
        "[data-music-provider-panel='true']"
      );

    if (providerPanel) {
      lastMusicProviderInteractionAt = Date.now();

      /*
        Controls inside this panel must never be interpreted as
        clicks on the surrounding BoM album card.
      */
      event.stopPropagation();
      event.stopImmediatePropagation();

      return;
    }

    const libraryAlbumCard = event.target.closest('[data-library-type="album"][data-album-id]');

    if (
      libraryAlbumCard &&
      (
        Date.now() - lastTrackRatingInteractionAt < 1200 ||
        Date.now() - lastMusicProviderInteractionAt < 1500
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      console.log("Ignored album ghost click after track rating");
      return;
    }

    if (libraryAlbumCard) {
      event.preventDefault();
      event.stopPropagation();

      const albumId = Number(libraryAlbumCard.dataset.albumId);
      const album = allAlbums.find((row) => Number(row.id) === albumId);

      if (!album) return;

      selectedItem = {
        type: "album",
        title: album.title,
        artist: album.artist,
        externalId: album.external_id || "",
        releaseDate: album.release_date || "",
        coverUrl: getAlbumArtworkUrl(album),
        savedAlbumId: album.id,
        albumId: album.id
      };

      showOnlySection("detailSection");
      await renderSelectedItem();
      return;
    }

    const artistAlbumCard = event.target.closest("[data-artist-album-index]");

    if (
      artistAlbumCard &&
      (
        Date.now() - lastTrackRatingInteractionAt < 1200 ||
        Date.now() - lastMusicProviderInteractionAt < 1500
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      console.log("Ignored artist-album ghost click after track rating");
      return;
    }

    if (artistAlbumCard && selectedItemDetail.dataset.artistAlbums) {
      event.preventDefault();
      event.stopPropagation();

      const index = Number(artistAlbumCard.getAttribute("data-artist-album-index"));
      const artistAlbums = JSON.parse(selectedItemDetail.dataset.artistAlbums || "[]");
      const artistAlbum = artistAlbums[index];

      if (!artistAlbum) return;

      selectedItem = {
        type: "album",
        title: artistAlbum.title || "",
        artist: artistAlbum.artist || selectedItem?.artist || "",
        externalId: artistAlbum.externalId || "",
        releaseGroupId: artistAlbum.releaseGroupId || artistAlbum.id || "",
        artistId: artistAlbum.artistId || "",
        releaseDate: artistAlbum.releaseDate || artistAlbum.date || "",
        coverUrl: artistAlbum.coverUrl || "",
        savedAlbumId: artistAlbum.savedAlbumId || artistAlbum.localAlbumId || "",
        albumId: artistAlbum.savedAlbumId || artistAlbum.localAlbumId || ""
      };

      showOnlySection("detailSection");
      await renderSelectedItem();
      return;
    }

    const similarArtistCard = event.target.closest(".similar-artist-card");

    if (similarArtistCard && selectedItemDetail.dataset.similarArtists) {
      event.preventDefault();
      event.stopPropagation();

      const similarArtists = JSON.parse(selectedItemDetail.dataset.similarArtists || "[]");
      const artist = similarArtists[Number(similarArtistCard.dataset.similarArtistIndex)];

      if (!artist?.name) return;

      selectedItem = {
        type: "artist",
        name: artist.name,
        title: artist.name,
        artist: artist.name,
        externalId: artist.id || ""
      };

      showOnlySection("detailSection");
      await renderSelectedItem();
      return;
    }
	
	const openAlbumBtn = event.target.closest(".open-album-btn");

if (openAlbumBtn) {
  if (
    Date.now() -
      lastMusicProviderInteractionAt <
    2200
  ) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  event.preventDefault();

  const albumId = Number(openAlbumBtn.dataset.albumId);
  const album = allAlbums.find((a) => Number(a.id) === albumId);

  if (!album) return;

  selectedItem = {
    type: "album",
    title: album.title,
    artist: album.artist,
    externalId: album.external_id || "",
    releaseDate: album.release_date || "",
    coverUrl: getAlbumArtworkUrl(album),
    savedAlbumId: album.id,
    albumId: album.id
  };

  showOnlySection("detailSection");
  await renderSelectedItem();
  return;
}


const songAlbumLink = event.target.closest("[data-open-song-album-id]");

if (songAlbumLink) {
  if (
    Date.now() -
      lastMusicProviderInteractionAt <
    2200
  ) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const albumId = Number(songAlbumLink.dataset.openSongAlbumId);
  const album = allAlbums.find((a) => Number(a.id) === albumId);

  if (!album) return;

  selectedItem = {
    type: "album",
    title: album.title,
    artist: album.artist,
    externalId: album.external_id || "",
    releaseDate: album.release_date || "",
    coverUrl: getAlbumArtworkUrl(album),
    savedAlbumId: album.id,
    albumId: album.id
  };

  showOnlySection("detailSection");
  await renderSelectedItem();
  return;
}

    const songCard = event.target.closest("[data-library-type='song']");

    if (songCard) {
      if (
        Date.now() -
          lastMusicProviderInteractionAt <
        2200
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const songId = Number(songCard.dataset.songId);
      const song = allSongs.find((row) => Number(row.id) === songId);

      if (!song) return;

      selectedItem = {
        type: "song",
        title: song.title,
        artist: song.artist,
        externalId: song.external_id || "",
        releaseTitle: song.album_id ? getAlbumNameById(song.album_id) : "",
        savedSongId: song.id,
        albumId: song.album_id || ""
      };

      showOnlySection("detailSection");
      await renderSelectedItem();
      return;
    }
	
	const songArtistLink = event.target.closest(".song-artist-link");

if (songArtistLink) {
  event.preventDefault();
  event.stopPropagation();

  const artistName =
    songArtistLink.dataset.artistName || "";

  await window.openArtistPage(artistName);

  return;
}
  });
}

bindCardClicks(recommendationsList);
bindCardClicks(albumsList);
bindCardClicks(songsList);
bindCardClicks(selectedItemDetail);

if (sessionStatus) {
  sessionStatus.addEventListener("click", async (event) => {
    const profileButton = event.target.closest(".session-profile-btn");
    if (!profileButton) return;

    showUserAccountMenu();
  });
}



if (profileModal) {
  profileModal.addEventListener("click", async (event) => {
    const closeButton = event.target.closest("[data-profile-close='true']");

    if (closeButton) {
      event.preventDefault();
      event.stopPropagation();

      hideUserProfile();
      return;
    }

    const albumRow = event.target.closest("[data-profile-album-id]");

    if (!albumRow) return;

    event.preventDefault();
    event.stopPropagation();

    /*
      Ignore any ghost click created by the original tap that
      opened the profile.

      A genuine second tap on an album will work normally.
    */
    const millisecondsSinceProfileOpened =
      Date.now() - profileOpenedAt;

    if (millisecondsSinceProfileOpened < 900) {
      console.log("Ignored profile ghost click");
      return;
    }

    const albumId = Number(albumRow.dataset.profileAlbumId);

    if (!albumId) return;

    const album = allAlbums.find(
      (row) => Number(row.id) === albumId
    );

    if (!album) return;

    selectedItem = {
      type: "album",
      title: album.title,
      artist: album.artist,
      externalId: album.external_id || "",
      releaseDate: album.release_date || "",
      coverUrl: getAlbumArtworkUrl(album),
      savedAlbumId: album.id,
      albumId: album.id
    };

    hideUserProfile();
    showOnlySection("detailSection");

    await renderSelectedItem();
  });
}



document.addEventListener("keydown", (event) => {

  if (event.key === "Escape") {

    hideUserProfile();

  }

});


document.addEventListener("click", async (event) => {
	
	

  const carouselArrow = event.target.closest(".carousel-arrow");
  if (carouselArrow) {
    scrollCarouselByButton(carouselArrow);
    return;
  }

  if (event.target.closest("#stickyPlayerShareBtn")) {
    await shareSelectedItem();
    return;
  }
  
  if (event.target.closest("#editHandleBtn")) {
  event.preventDefault();
  await updateCurrentUserHandle();
  return;
}

if (event.target.closest("#logoutProfileBtn")) {
    event.preventDefault();

    await supabaseClient.auth.signOut();

    currentUser = null;
    currentProfile = null;

    updateSessionUI();
	showOnlySection("searchSection");

    profileModal.classList.add("hidden");

    return;
}

  if (event.target.closest("#stickyPlayerOpenBtn")) {
    if (selectedItem) {
      showOnlySection("detailSection");
      await renderSelectedItem();
    }
  }

});

/* ============================================================
   SPOTIFY CONNECTION — PKCE
   Connects BoM to Spotify without exposing a client secret.
   ============================================================ */

const SPOTIFY_CLIENT_ID = window.SPOTIFY_CLIENT_ID || "";

const SPOTIFY_REDIRECT_URI =
  window.SPOTIFY_REDIRECT_URI ||
  "https://bank-of-music.pages.dev/";
  
const SPOTIFY_TOKEN_FUNCTION_URL =
  `${window.SUPABASE_URL}/functions/v1/rapid-processor`;

const SPOTIFY_SCOPES = [
  "user-read-private",
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public"
];

const SPOTIFY_STORAGE_KEYS = {
  accessToken: "bom_spotify_access_token",
  refreshToken: "bom_spotify_refresh_token",
  expiresAt: "bom_spotify_expires_at",
  verifier: "bom_spotify_code_verifier",
  state: "bom_spotify_auth_state"
};

let spotifyConnectionState = false;
let spotifyRefreshPromise = null;

function publishSpotifyConnectionState(connected) {
  spotifyConnectionState = Boolean(connected);
  window.dispatchEvent(new CustomEvent("bom:spotify-connection", {
    detail: { connected: spotifyConnectionState }
  }));
}

function getSpotifyElement(id) {
  return document.getElementById(id);
}

function setSpotifyMessage(message) {
  const element = getSpotifyElement("spotifyMessage");

  if (element) {
    element.textContent = message || "";
  }
}

function generateSpotifyRandomString(length = 64) {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  const randomValues = new Uint8Array(length);

  window.crypto.getRandomValues(randomValues);

  return Array.from(randomValues)
    .map((value) => characters[value % characters.length])
    .join("");
}

function spotifyBase64UrlEncode(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);

  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createSpotifyCodeChallenge(verifier) {
  const encodedVerifier = new TextEncoder().encode(verifier);

  const digest = await window.crypto.subtle.digest(
    "SHA-256",
    encodedVerifier
  );

  return spotifyBase64UrlEncode(digest);
}

function saveSpotifyTokens(tokenData) {
  if (tokenData.access_token) {
    localStorage.setItem(
      SPOTIFY_STORAGE_KEYS.accessToken,
      tokenData.access_token
    );
  }

  if (tokenData.refresh_token) {
    localStorage.setItem(
      SPOTIFY_STORAGE_KEYS.refreshToken,
      tokenData.refresh_token
    );
  }

  const expiresInSeconds = Number(tokenData.expires_in || 3600);

  const expiresAt =
    Date.now() + expiresInSeconds * 1000 - 60000;

  localStorage.setItem(
    SPOTIFY_STORAGE_KEYS.expiresAt,
    String(expiresAt)
  );
}

function clearSpotifyTokens() {
  Object.values(SPOTIFY_STORAGE_KEYS).forEach((key) => {
    localStorage.removeItem(key);
  });
}

function getStoredSpotifyAccessToken() {
  return localStorage.getItem(
    SPOTIFY_STORAGE_KEYS.accessToken
  );
}

function getStoredSpotifyRefreshToken() {
  return localStorage.getItem(
    SPOTIFY_STORAGE_KEYS.refreshToken
  );
}

function spotifyTokenHasExpired() {
  const expiresAt = Number(
    localStorage.getItem(SPOTIFY_STORAGE_KEYS.expiresAt) || 0
  );

  return !expiresAt || Date.now() >= expiresAt;
}

async function connectSpotify() {
  if (!currentUser) {
    setSpotifyMessage(
      "Please log into Bank of Music before connecting Spotify."
    );
    return;
  }

  if (!SPOTIFY_CLIENT_ID) {
    setSpotifyMessage(
      "Spotify Client ID is missing from config.js."
    );
    return;
  }

  try {
    setSpotifyMessage("Opening Spotify…");

    const state =
      generateSpotifyRandomString(32);

    localStorage.setItem(
      SPOTIFY_STORAGE_KEYS.state,
      state
    );

    const authorizationUrl =
      new URL(
        "https://accounts.spotify.com/authorize"
      );

    authorizationUrl.search =
      new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        response_type: "code",
        redirect_uri:
          SPOTIFY_REDIRECT_URI,
        scope: SPOTIFY_SCOPES.join(" "),
        state,
        show_dialog: "true"
      }).toString();

    window.location.href =
      authorizationUrl.toString();
  } catch (error) {
    console.error(
      "Spotify connection failed",
      error
    );

    setSpotifyMessage(
      "Could not start the Spotify connection."
    );
  }
}

async function exchangeSpotifyCodeForTokens(code) {
  const {
    data: { session },
    error: sessionError
  } = await supabaseClient.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error(
      "Your Bank of Music session has expired. Please log in again."
    );
  }

  const response = await fetch(
    SPOTIFY_TOKEN_FUNCTION_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        action: "exchange",
        code
      })
    }
  );

  let data = {};

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Spotify server returned HTTP ${response.status}.`
    );
  }

  if (!response.ok) {
    console.error(
      "Spotify Edge Function response:",
      data
    );

    throw new Error(
      data?.error ||
      `Spotify token exchange failed with HTTP ${response.status}.`
    );
  }

  if (!data.access_token) {
    throw new Error(
      "Spotify did not return an access token."
    );
  }

  saveSpotifyTokens(data);

  localStorage.removeItem(
    SPOTIFY_STORAGE_KEYS.verifier
  );

  localStorage.removeItem(
    SPOTIFY_STORAGE_KEYS.state
  );

  return data.access_token;
}

async function requestSpotifyAccessTokenRefresh() {
  const refreshToken = getStoredSpotifyRefreshToken();

  if (!refreshToken) {
    return null;
  }

  const {
    data: { session },
    error: sessionError
  } = await supabaseClient.auth.getSession();

  if (sessionError || !session?.access_token) {
    return null;
  }

  const response = await fetch(
    SPOTIFY_TOKEN_FUNCTION_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        action: "refresh",
        refresh_token: refreshToken
      })
    }
  );

  let data = {};

  try {
    data = await response.json();
  } catch {
    return null;
  }

  if (!response.ok) {
    console.error("Spotify refresh failed", data);

    if (response.status === 400 || response.status === 401) {
      clearSpotifyTokens();
      publishSpotifyConnectionState(false);
    }

    return null;
  }

  saveSpotifyTokens(data);

  return data.access_token;
}

async function refreshSpotifyAccessToken() {
  if (!spotifyRefreshPromise) {
    spotifyRefreshPromise = requestSpotifyAccessTokenRefresh()
      .finally(() => {
        spotifyRefreshPromise = null;
      });
  }

  return spotifyRefreshPromise;
}

async function getValidSpotifyAccessToken() {
  let accessToken = getStoredSpotifyAccessToken();

  if (!accessToken) {
    return null;
  }

  if (spotifyTokenHasExpired()) {
    accessToken = await refreshSpotifyAccessToken();
  }

  return accessToken;
}

async function spotifyApiRequest(path, options = {}) {
  const accessToken =
    await getValidSpotifyAccessToken();

  if (!accessToken) {
    throw new Error("Spotify is not connected.");
  }

  const response = await fetch(
    `https://api.spotify.com/v1${path}`,
    {
      ...options,

      headers: {
  Authorization: `Bearer ${accessToken}`,
  ...(options.body
    ? { "Content-Type": "application/json" }
    : {}),
  ...(options.headers || {})
}
    }
  );

  if (response.status === 401) {
    const refreshedToken =
      await refreshSpotifyAccessToken();

    if (!refreshedToken) {
      throw new Error(
        "Spotify connection expired. Please reconnect."
      );
    }

    return spotifyApiRequest(path, options);
  }

  if (response.status === 204) {
    return null;
  }

  let data = null;

try {
  data = await response.json();
} catch {
  data = null;
}

if (!response.ok) {
  console.error(
    "Spotify API error:",
    response.status,
    data
  );

  throw new Error(
    data?.error?.message ||
    `Spotify API request failed with HTTP ${response.status}.`
  );
}

  return data;
}

async function getSpotifyCurrentUser() {
  return spotifyApiRequest("/me");
}

/* ============================================================
   SPOTIFY PLAYLIST SYNCHRONISATION — v2
   Creates or updates the user's 7+, 8+, 9+, Perfect 10s and
   the community Global Top 100 playlists.
   ============================================================ */

const SPOTIFY_MATCH_CACHE_PREFIX = "bom_spotify_match_";

function normaliseSpotifyMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*(remaster|remastered|live|edit|version)[^)]*\)/gi, "")
    .replace(/\[[^\]]*(remaster|remastered|live|edit|version)[^\]]*\]/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getSpotifyTrackKey(track) {
  return [
    normaliseSpotifyMatchText(track?.artist),
    normaliseSpotifyMatchText(track?.title)
  ].join("|");
}

function getSpotifyExportElements() {
  return {
    buttons: Array.from(
      document.querySelectorAll(".spotify-sync-playlist-btn")
    ),
    progress: getSpotifyElement("spotifyExportProgress"),
    progressBar: getSpotifyElement("spotifyProgressBar"),
    progressText: getSpotifyElement("spotifyProgressText"),
    result: getSpotifyElement("spotifyExportResult")
  };
}

function updateSpotifyExportProgress(completed, total, message) {
  const elements = getSpotifyExportElements();
  const percentage = total
    ? Math.round((completed / total) * 100)
    : 0;

  elements.progress?.classList.remove("hidden");

  if (elements.progressBar) {
    elements.progressBar.style.width = `${Math.min(100, percentage)}%`;
  }

  if (elements.progressText) {
    elements.progressText.textContent =
      message || `${completed} of ${total}`;
  }
}

function resetSpotifyExportDisplay() {
  const elements = getSpotifyExportElements();

  elements.result?.classList.add("hidden");

  if (elements.result) {
    elements.result.innerHTML = "";
  }

  if (elements.progressBar) {
    elements.progressBar.style.width = "0%";
  }

  elements.progress?.classList.add("hidden");
}

function setSpotifySyncButtonsDisabled(disabled, activeButton = null) {
  getSpotifyExportElements().buttons.forEach((button) => {
    button.disabled = disabled;

    const statusText = button.querySelector(
      ".spotify-sync-button-text small"
    );

    if (!statusText) return;

    if (disabled && button === activeButton) {
      statusText.textContent = "Synchronising…";
      return;
    }

    statusText.textContent =
      button.dataset.playlistType === "global-top-100"
        ? "Highest-rated songs with at least 3 ratings"
        : "Create or sync playlist";
  });
}

function buildSpotifyTrack(song, extra = {}) {
  if (!song) return null;

  const album = allAlbums.find(
    (item) => Number(item.id) === Number(song.album_id)
  );

  const artist = song.artist || album?.artist || "";
  const title = song.title || "";

  if (!artist || !title) return null;

  return {
    id: song.id,
    title,
    artist,
    album: album?.title || "",
    ...extra
  };
}

function getCurrentUserRatedTracksForSpotify(minimumRating) {
  if (!currentUser) return [];

  const tracksByKey = new Map();

  allSongRatings
    .filter((ratingRow) => (
      ratingRow.user_id === currentUser.id &&
      Number(ratingRow.rating) >= minimumRating
    ))
    .forEach((ratingRow) => {
      const song = allSongs.find(
        (item) => Number(item.id) === Number(ratingRow.song_id)
      );

      const track = buildSpotifyTrack(song, {
        rating: Number(ratingRow.rating)
      });

      if (!track) return;

      const key = getSpotifyTrackKey(track);
      const existing = tracksByKey.get(key);

      if (!existing || track.rating > existing.rating) {
        tracksByKey.set(key, track);
      }
    });

  return [...tracksByKey.values()].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;

    const artistComparison = a.artist.localeCompare(b.artist);
    return artistComparison || a.title.localeCompare(b.title);
  });
}

function getGlobalTop100TracksForSpotify() {
  const groupedSongs = new Map();

  allSongRatings.forEach((ratingRow) => {
    const song = allSongs.find(
      (item) => Number(item.id) === Number(ratingRow.song_id)
    );

    const track = buildSpotifyTrack(song);
    if (!track) return;

    const key = getSpotifyTrackKey(track);
    const current = groupedSongs.get(key) || {
      ...track,
      ratingTotal: 0,
      ratingCount: 0,
      users: new Set()
    };

    const userKey = String(ratingRow.user_id || "");

    if (userKey && current.users.has(userKey)) {
      return;
    }

    if (userKey) current.users.add(userKey);
    current.ratingTotal += Number(ratingRow.rating || 0);
    current.ratingCount += 1;
    groupedSongs.set(key, current);
  });

  return [...groupedSongs.values()]
    .filter((track) => track.ratingCount >= 3)
    .map((track) => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      rating: track.ratingTotal / track.ratingCount,
      ratingCount: track.ratingCount
    }))
    .sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      if (b.ratingCount !== a.ratingCount) {
        return b.ratingCount - a.ratingCount;
      }

      const artistComparison = a.artist.localeCompare(b.artist);
      return artistComparison || a.title.localeCompare(b.title);
    })
    .slice(0, 100);
}

function getSpotifyMatchCacheKey(bomTrack) {
  return SPOTIFY_MATCH_CACHE_PREFIX + getSpotifyTrackKey(bomTrack);
}

function getCachedSpotifyMatch(bomTrack) {
  try {
    const cached = JSON.parse(
      localStorage.getItem(getSpotifyMatchCacheKey(bomTrack)) || "null"
    );

    return cached?.uri ? cached : null;
  } catch {
    return null;
  }
}

function cacheSpotifyMatch(bomTrack, spotifyTrack) {
  if (!spotifyTrack?.uri) return;

  localStorage.setItem(
    getSpotifyMatchCacheKey(bomTrack),
    JSON.stringify({
      id: spotifyTrack.id || "",
      uri: spotifyTrack.uri,
      name: spotifyTrack.name || "",
      externalUrl: spotifyTrack.external_urls?.spotify || "",
      matchedAt: new Date().toISOString()
    })
  );
}

async function searchSpotifyTrackForBoMTrack(bomTrack) {
  const cachedMatch = getCachedSpotifyMatch(bomTrack);
  if (cachedMatch) return cachedMatch;

  const searchQuery = [
    `track:${bomTrack.title}`,
    `artist:${bomTrack.artist}`
  ].join(" ");

  const searchData = await spotifyApiRequest(
    `/search?${new URLSearchParams({
      q: searchQuery,
      type: "track",
      limit: "10"
    }).toString()}`
  );

  const candidates = searchData?.tracks?.items || [];
  if (!candidates.length) return null;

  const wantedTitle = normaliseSpotifyMatchText(bomTrack.title);
  const wantedArtist = normaliseSpotifyMatchText(bomTrack.artist);
  const wantedAlbum = normaliseSpotifyMatchText(bomTrack.album);

  const scoredCandidates = candidates.map((candidate) => {
    const candidateTitle = normaliseSpotifyMatchText(candidate.name);
    const candidateArtists = (candidate.artists || [])
      .map((artist) => normaliseSpotifyMatchText(artist.name))
      .join(" ");
    const candidateAlbum = normaliseSpotifyMatchText(candidate.album?.name);

    let score = 0;

    if (candidateTitle === wantedTitle) score += 100;
    else if (
      candidateTitle.includes(wantedTitle) ||
      wantedTitle.includes(candidateTitle)
    ) score += 45;

    if (candidateArtists.includes(wantedArtist)) score += 90;
    else if (wantedArtist.includes(candidateArtists)) score += 50;

    if (
      wantedAlbum &&
      (candidateAlbum === wantedAlbum ||
        candidateAlbum.includes(wantedAlbum) ||
        wantedAlbum.includes(candidateAlbum))
    ) score += 20;

    return { candidate, score };
  }).sort((a, b) => b.score - a.score);

  const bestMatch = scoredCandidates[0];

  if (!bestMatch || bestMatch.score < 120) {
    return null;
  }

  cacheSpotifyMatch(bomTrack, bestMatch.candidate);
  return bestMatch.candidate;
}

async function findSpotifyPlaylistByName(playlistName) {
  let path = "/me/playlists?limit=50";

  while (path) {
    const data = await spotifyApiRequest(path);
    const match = (data?.items || []).find(
      (playlist) => playlist?.name === playlistName
    );

    if (match) return match;
    if (!data?.next) return null;

    const nextUrl = new URL(data.next);
    path = nextUrl.pathname.replace(/^\/v1/, "") + nextUrl.search;
  }

  return null;
}

async function createSpotifyPlaylist(playlistName, description) {
  return spotifyApiRequest("/me/playlists", {
    method: "POST",
    body: JSON.stringify({
      name: playlistName,
      description,
      public: false
    })
  });
}

async function getOrCreateSpotifyPlaylist({
  playlistName,
  description
}) {
  const existingPlaylist = await findSpotifyPlaylistByName(playlistName);

  if (existingPlaylist?.id) {
    return { playlist: existingPlaylist, created: false };
  }

  const playlist = await createSpotifyPlaylist(
    playlistName,
    description
  );

  if (!playlist?.id) {
    throw new Error("Spotify did not return a playlist ID.");
  }

  return { playlist, created: true };
}

async function replaceSpotifyPlaylistItems(playlistId, uris) {
  const uniqueUris = [...new Set(uris.filter(Boolean))];
  const firstBatch = uniqueUris.slice(0, 100);

  await spotifyApiRequest(
    `/playlists/${encodeURIComponent(playlistId)}/items`,
    {
      method: "PUT",
      body: JSON.stringify({ uris: firstBatch })
    }
  );

  for (let start = 100; start < uniqueUris.length; start += 100) {
    await spotifyApiRequest(
      `/playlists/${encodeURIComponent(playlistId)}/items`,
      {
        method: "POST",
        body: JSON.stringify({
          uris: uniqueUris.slice(start, start + 100)
        })
      }
    );
  }

  return uniqueUris;
}

function renderSpotifySyncResult({
  playlist,
  playlistName,
  matched,
  unmatched,
  created,
  sourceLabel
}) {
  const elements = getSpotifyExportElements();
  if (!elements.result) return;

  const playlistUrl = playlist?.external_urls?.spotify || "";

  elements.result.classList.remove("hidden");
  elements.result.innerHTML = `
    <div class="spotify-export-success">
      <div class="spotify-export-success-icon">✓</div>

      <div>
        <h3>${created ? "Playlist created" : "Playlist synchronised"}</h3>

        <p>
          <strong>${escapeHtml(playlistName)}</strong>
          now contains <strong>${matched.length}</strong>
          matched track${matched.length === 1 ? "" : "s"}
          from ${escapeHtml(sourceLabel)}.
        </p>

        ${unmatched.length ? `
          <p class="small">
            ${unmatched.length} track${unmatched.length === 1 ? "" : "s"}
            could not be matched automatically.
          </p>
        ` : ""}

        ${playlistUrl ? `
          <a
            class="spotify-open-playlist-btn"
            href="${escapeHtml(playlistUrl)}"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open playlist in Spotify
          </a>
        ` : ""}
      </div>
    </div>

    ${unmatched.length ? `
      <details class="spotify-unmatched-details">
        <summary>View unmatched tracks</summary>

        <div class="spotify-unmatched-list">
          ${unmatched.map((track) => `
            <div class="spotify-unmatched-row">
              <strong>${escapeHtml(track.title)}</strong>
              <span>${escapeHtml(track.artist)}</span>
            </div>
          `).join("")}
        </div>
      </details>
    ` : ""}
  `;
}

async function synchroniseSpotifyPlaylist({
  button,
  playlistName,
  playlistType,
  minimumRating
}) {
  if (!currentUser) {
    setSpotifyMessage("Please log into Bank of Music first.");
    return;
  }

  const accessToken = await getValidSpotifyAccessToken();

  if (!accessToken) {
    renderSpotifyDisconnected(
      "Please connect Spotify before synchronising playlists."
    );
    return;
  }

  const isTop100 = playlistType === "global-top-100";
  const tracks = isTop100
    ? getGlobalTop100TracksForSpotify()
    : getCurrentUserRatedTracksForSpotify(minimumRating);

  const sourceLabel = isTop100
    ? "the BoM Global Top 100"
    : `your ${minimumRating}+ ratings`;

  if (!tracks.length) {
    setSpotifyMessage(
      isTop100
        ? "No songs currently have the minimum three ratings needed for the Global Top 100."
        : `You do not currently have any tracks rated ${minimumRating} or above.`
    );
    return;
  }

  resetSpotifyExportDisplay();
  setSpotifySyncButtonsDisabled(true, button);

  const matched = [];
  const unmatched = [];

  try {
    setSpotifyMessage(
      `Matching ${tracks.length} track${tracks.length === 1 ? "" : "s"} with Spotify…`
    );

    for (let index = 0; index < tracks.length; index += 1) {
      const bomTrack = tracks[index];

      updateSpotifyExportProgress(
        index,
        tracks.length,
        `Finding ${bomTrack.title} — ${bomTrack.artist}`
      );

      try {
        const spotifyTrack = await searchSpotifyTrackForBoMTrack(bomTrack);

        if (spotifyTrack?.uri) {
          matched.push({ bomTrack, spotifyTrack });
        } else {
          unmatched.push(bomTrack);
        }
      } catch (error) {
        console.error("Spotify track matching failed:", bomTrack, error);
        unmatched.push(bomTrack);
      }

      updateSpotifyExportProgress(
        index + 1,
        tracks.length,
        `Matched ${matched.length} of ${tracks.length}`
      );
    }

    if (!matched.length) {
      throw new Error(
        "Spotify could not match any of the selected BoM tracks."
      );
    }

    setSpotifyMessage(`Preparing "${playlistName}"…`);

    const description = isTop100
      ? "The 100 highest-rated songs on Bank of Music with at least three ratings."
      : `Tracks you rated ${minimumRating}/10 or higher in Bank of Music.`;

    const { playlist, created } = await getOrCreateSpotifyPlaylist({
      playlistName,
      description
    });

    const uniqueUris = await replaceSpotifyPlaylistItems(
      playlist.id,
      matched.map((item) => item.spotifyTrack.uri)
    );

    updateSpotifyExportProgress(
      tracks.length,
      tracks.length,
      created
        ? "Playlist created successfully."
        : "Playlist synchronised successfully."
    );

    renderSpotifySyncResult({
      playlist,
      playlistName,
      matched,
      unmatched,
      created,
      sourceLabel
    });

    setSpotifyMessage(
      `${created ? "Created" : "Synchronised"} "${playlistName}" ` +
      `with ${uniqueUris.length} track${uniqueUris.length === 1 ? "" : "s"}.`
    );
  } catch (error) {
    console.error("Spotify playlist synchronisation failed:", error);

    const errorMessage =
      error?.message ||
      "The Spotify playlist could not be synchronised.";

    setSpotifyMessage(errorMessage);
    alert("Spotify playlist synchronisation failed: " + errorMessage);
  } finally {
    setSpotifySyncButtonsDisabled(false);
  }
}

document
  .querySelectorAll(".spotify-sync-playlist-btn")
  .forEach((button) => {
    button.addEventListener("click", () => {
      const playlistType = button.dataset.playlistType || "personal";
      const minimumRating = Number(
        button.dataset.minimumRating || 0
      );
      const playlistName = String(
        button.dataset.playlistName || "BoM Playlist"
      );

      synchroniseSpotifyPlaylist({
        button,
        playlistName,
        playlistType,
        minimumRating
      });
    });
  });


function renderSpotifyDisconnected(message = "") {
  publishSpotifyConnectionState(false);
  const status =
    getSpotifyElement("spotifyConnectionStatus");

  const account =
    getSpotifyElement("spotifyConnectedAccount");

  const connectButton =
    getSpotifyElement("connectSpotifyBtn");

  const disconnectButton =
    getSpotifyElement("disconnectSpotifyBtn");
	
	const exportPanel =
  getSpotifyElement("spotifyExportPanel");

  if (status) {
    status.classList.remove("spotify-connected");

    status.innerHTML = `
      <div class="spotify-status-dot"></div>

      <div>
        <strong>Spotify not connected</strong>

        <div class="small">
          Connect Spotify to create playlists from your BoM ratings.
        </div>
      </div>
    `;
  }

  if (account) {
    account.innerHTML = "";
    account.classList.add("hidden");
  }

  connectButton?.classList.remove("hidden");
  disconnectButton?.classList.add("hidden");
  exportPanel?.classList.add("hidden");

  setSpotifyMessage(message);
}

function renderSpotifyConnected(spotifyUser) {
  publishSpotifyConnectionState(true);
  const status =
    getSpotifyElement("spotifyConnectionStatus");

  const account =
    getSpotifyElement("spotifyConnectedAccount");

  const connectButton =
    getSpotifyElement("connectSpotifyBtn");

  const disconnectButton =
    getSpotifyElement("disconnectSpotifyBtn");
	
	const exportPanel =
  getSpotifyElement("spotifyExportPanel");

  const displayName =
    spotifyUser?.display_name ||
    spotifyUser?.id ||
    "Spotify user";

  const imageUrl =
    spotifyUser?.images?.[0]?.url || "";

  if (status) {
    status.classList.add("spotify-connected");

    status.innerHTML = `
      <div class="spotify-status-dot"></div>

      <div>
        <strong>Spotify connected</strong>

        <div class="small">
          Ready to create BoM playlists.
        </div>
      </div>
    `;
  }

  if (account) {
    account.classList.remove("hidden");

    account.innerHTML = `
      <div class="spotify-account-card">
        ${
          imageUrl
            ? `
              <img
                src="${escapeHtml(imageUrl)}"
                alt=""
                class="spotify-account-image"
              >
            `
            : `
              <div class="spotify-account-placeholder">
                ♪
              </div>
            `
        }

        <div>
          <div class="small">Connected as</div>

          <strong>${escapeHtml(displayName)}</strong>

          ${
            spotifyUser?.product
              ? `
                <div class="small">
                  ${escapeHtml(spotifyUser.product)} account
                </div>
              `
              : ""
          }
        </div>
      </div>
    `;
  }

  connectButton?.classList.add("hidden");
  disconnectButton?.classList.remove("hidden");
  exportPanel?.classList.remove("hidden");

  setSpotifyMessage("");
}

async function refreshSpotifyConnectionUI() {
  const status =
    getSpotifyElement("spotifyConnectionStatus");

  if (!status) return;

  const accessToken =
    await getValidSpotifyAccessToken();

  if (!accessToken) {
    renderSpotifyDisconnected();

    return;
  }

  status.innerHTML = `
    <div class="spotify-status-dot"></div>

    <div>
      <strong>Checking Spotify connection…</strong>
    </div>
  `;

  try {
    const spotifyUser =
      await getSpotifyCurrentUser();

    renderSpotifyConnected(spotifyUser);
	} catch (error) {
  console.error(
    "Spotify account lookup failed",
    error
  );

  const errorMessage =
    error?.message ||
    "Spotify account lookup failed.";

  /*
    Do not delete the tokens while diagnosing this.
    The token exchange has already succeeded.
  */
  renderSpotifyDisconnected(
    "Spotify account check failed: " +
    errorMessage
  );

  alert(
    "Spotify account check failed: " +
    errorMessage
  );
}
}

function disconnectSpotify() {
  clearSpotifyTokens();

  renderSpotifyDisconnected(
    "Spotify disconnected."
  );
}

function cleanSpotifyCallbackUrl() {
  const url = new URL(window.location.href);

  [
    "code",
    "state",
    "error",
    "error_description"
  ].forEach((parameter) => {
    url.searchParams.delete(parameter);
  });

  window.history.replaceState(
    {},
    document.title,
    url.toString()
  );
}

async function handleSpotifyAuthorizationCallback() {
  const liveParams =
    new URLSearchParams(window.location.search);

  let preservedCallback = null;

  const preservedValue = sessionStorage.getItem(
    "bom_spotify_pending_callback"
  );

  if (preservedValue) {
    try {
      preservedCallback =
        JSON.parse(preservedValue);
    } catch {
      preservedCallback = null;
    }
  }

  const code =
    preservedCallback?.code ||
    liveParams.get("code") ||
    "";

  const returnedState =
    preservedCallback?.state ||
    liveParams.get("state") ||
    "";

  const spotifyError =
    preservedCallback?.error ||
    liveParams.get("error") ||
    "";

  const spotifyErrorDescription =
    preservedCallback?.errorDescription ||
    liveParams.get("error_description") ||
    "";

  const expectedState =
    preservedCallback?.expectedState ||
    localStorage.getItem(
      SPOTIFY_STORAGE_KEYS.state
    ) ||
    "";

  if (!code && !spotifyError) {
    return false;
  }

  showOnlySection("settingsSection");

  if (spotifyError) {
    sessionStorage.removeItem(
      "bom_spotify_pending_callback"
    );

    cleanSpotifyCallbackUrl();

    renderSpotifyDisconnected(
      spotifyError === "access_denied"
        ? "Spotify connection was cancelled."
        : (
            spotifyErrorDescription ||
            "Spotify could not be connected."
          )
    );

    return true;
  }

  if (
    !returnedState ||
    !expectedState ||
    returnedState !== expectedState
  ) {
    sessionStorage.removeItem(
      "bom_spotify_pending_callback"
    );

    cleanSpotifyCallbackUrl();

    clearSpotifyTokens();

    renderSpotifyDisconnected(
      "Spotify security check failed. Please connect again."
    );

    return true;
  }

  try {
    setSpotifyMessage(
      "Completing Spotify connection…"
    );

    /*
      The Supabase invocation should appear when this
      function calls exchangeSpotifyCodeForTokens().
    */
    await exchangeSpotifyCodeForTokens(code);

    sessionStorage.removeItem(
      "bom_spotify_pending_callback"
    );

    cleanSpotifyCallbackUrl();

    await refreshSpotifyConnectionUI();

    setSpotifyMessage(
      "Spotify connected successfully."
    );

    return true;
  } catch (error) {
    console.error(
      "Spotify callback failed",
      error
    );

    const errorMessage =
      error?.message ||
      "Spotify could not be connected.";

    sessionStorage.removeItem(
      "bom_spotify_pending_callback"
    );

    cleanSpotifyCallbackUrl();

    clearSpotifyTokens();

    renderSpotifyDisconnected(
      "Connection failed: " + errorMessage
    );

    alert(
      "Spotify connection failed: " +
      errorMessage
    );

    return true;
  }
}

getSpotifyElement("connectSpotifyBtn")
  ?.addEventListener("click", connectSpotify);

getSpotifyElement("disconnectSpotifyBtn")
  ?.addEventListener("click", disconnectSpotify);

topNavButtons.forEach((button) => {
  if (button.dataset.target !== "settingsSection") {
    return;
  }

  button.addEventListener("click", () => {
    refreshSpotifyConnectionUI();
  });
});

handleSpotifyAuthorizationCallback()
  .then((handledCallback) => {
    if (!handledCallback) {
      refreshSpotifyConnectionUI();
    }
  })
  .catch((error) => {
    console.error(
      "Spotify startup failed",
      error
    );
  });

supabaseClient.auth.onAuthStateChange((event, session) => {

  currentUser = session ? session.user : null;

  if (passwordRecovery?.handleAuthEvent(event, session)) return;

  ensureUserProfile().then(() => {

    updateSessionUI();

    renderStageOneDiscoverLoading();

    loadLibrary().then(async () => {

      renderLibrary();

      renderRecommendations();

      renderAdminDashboard();

      await renderSelectedItem();

    });

  });

});




/* ============================================================
   v29 SOCIAL UPGRADE
   Real share links, public user profiles, handle editing,
   follower/following counts and follow/unfollow controls.
   Requires the v29 SQL setup file.
   ============================================================ */

function cleanHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_\.]/g, "")
    .slice(0, 24);
}

function getProfileShareUrl(handle = currentProfile?.handle) {
  const url = new URL(window.location.href);
  url.searchParams.delete("share");
  url.searchParams.delete("id");
  url.searchParams.delete("title");
  url.searchParams.delete("artist");
  url.searchParams.set("profile", cleanHandle(handle));
  return url.toString();
}

function getSelectedShareUrl() {
  return buildShareUrl(selectedItem);
}

async function copyTextToClipboard(text, successMessage = "Copied.") {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      prompt("Copy this link:", text);
    }
    setMessage(globalSearchMessage, successMessage);
    return true;
  } catch (error) {
    prompt("Copy this link:", text);
    return false;
  }
}

async function getFollowerCounts(profileId) {
  if (!profileId) return { followers: 0, following: 0, isFollowing: false };

  let followers = 0;
  let following = 0;
  let isFollowing = false;

  try {
    const { count: followerCount } = await supabaseClient
      .from("user_follows")
      .select("id", { count: "exact", head: true })
      .eq("following_id", profileId);
    followers = followerCount || 0;
  } catch {}

  try {
    const { count: followingCount } = await supabaseClient
      .from("user_follows")
      .select("id", { count: "exact", head: true })
      .eq("follower_id", profileId);
    following = followingCount || 0;
  } catch {}

  try {
    if (currentUser && currentUser.id !== profileId) {
      const { data } = await supabaseClient
        .from("user_follows")
        .select("id")
        .eq("follower_id", currentUser.id)
        .eq("following_id", profileId)
        .maybeSingle();
      isFollowing = Boolean(data);
    }
  } catch {}

  return { followers, following, isFollowing };
}

async function findProfileByHandle(handle) {
  const clean = cleanHandle(handle);
  if (!clean) return null;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, handle, member_number, created_at, is_admin")
    .eq("handle", clean)
    .maybeSingle();

  if (error) {
    setMessage(globalSearchMessage, error.message);
    return null;
  }
  return data || null;
}

async function updateCurrentUserHandle() {
  if (!currentUser) return;
  const input = document.getElementById("profileHandleInput");
  const newHandle = cleanHandle(input?.value || "");

  if (!newHandle || newHandle.length < 3) {
    setMessage(globalSearchMessage, "Handle must be at least 3 characters.");
    return;
  }

  const { data, error } = await supabaseClient
    .from("profiles")
    .update({ handle: newHandle })
    .eq("id", currentUser.id)
    .select("id, handle, member_number, created_at, is_admin, avatar_url, bio")
    .single();

  if (error) {
    setMessage(globalSearchMessage, error.message);
    return;
  }

  currentProfile = data;
  updateSessionUI();
  renderProfileModalContent();
  setMessage(globalSearchMessage, "Handle updated.");
}

async function followProfile(profileId) {
  if (!currentUser) {
    setMessage(globalSearchMessage, "Please log in first.");
    return;
  }
  if (!profileId || profileId === currentUser.id) return;

  const { error } = await supabaseClient
    .from("user_follows")
    .upsert([{ follower_id: currentUser.id, following_id: profileId }], {
      onConflict: "follower_id,following_id"
    });

  if (error) {
    setMessage(globalSearchMessage, error.message);
    return;
  }

  setMessage(globalSearchMessage, "Profile followed.");
  await openPublicProfileById(profileId);
}

async function unfollowProfile(profileId) {
  if (!currentUser || !profileId) return;

  const { error } = await supabaseClient
    .from("user_follows")
    .delete()
    .eq("follower_id", currentUser.id)
    .eq("following_id", profileId);

  if (error) {
    setMessage(globalSearchMessage, error.message);
    return;
  }

  setMessage(globalSearchMessage, "Profile unfollowed.");
  await openPublicProfileById(profileId);
}

async function openPublicProfileById(profileId) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, handle, member_number, created_at, is_admin")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    console.error("Public profile lookup failed:", error);
    alert("Could not open profile: " + error.message);
    return;
  }

  if (!data) {
    alert("Profile not found.");
    return;
  }

  await renderPublicProfile(data);
}

window.openPublicProfileById = openPublicProfileById;


async function openPublicProfileByHandle(handle) {
  const profile = await findProfileByHandle(handle);
  if (!profile) {
    setMessage(globalSearchMessage, "Profile not found.");
    return;
  }
  await renderPublicProfile(profile);
}

async function renderPublicProfile(profile) {
  if (!profileModal || !profile) return;

  const counts = await getFollowerCounts(profile.id);
  const isOwnProfile = currentUser && profile.id === currentUser.id;
  const displayHandle = profile.handle ? `@${String(profile.handle).replace(/^@+/, "")}` : "Unknown member";
  const profileUrl = getProfileShareUrl(profile.handle);

  let albumRows = [];
  try {
    const { data } = await supabaseClient
      .from("ratings")
      .select("album_id, rating")
      .eq("user_id", profile.id)
      .order("rating", { ascending: false })
      .limit(10);
    albumRows = data || [];
  } catch {}

  const topAlbums = albumRows
    .map((ratingRow) => {
      const album = allAlbums.find((item) => Number(item.id) === Number(ratingRow.album_id));
      return album ? { album, rating: Number(ratingRow.rating) } : null;
    })
    .filter(Boolean);

  profileModal.innerHTML = `
    <div class="profile-modal-backdrop" data-profile-close="true"></div>
    <div class="profile-card-panel" role="dialog" aria-modal="true" aria-label="Public profile">
      <div class="profile-card-header">
        <div>
          <div class="profile-kicker">Bank of Music profile</div>
          <h2>${escapeHtml(displayHandle)}</h2>
          <p>Member ${profile.member_number ? `#${escapeHtml(profile.member_number)}` : "number pending"}</p>
        </div>
        <button type="button" class="profile-close-btn" data-profile-close="true">×</button>
      </div>

      <div class="profile-stats-grid">
        <div class="profile-stat-card"><div class="profile-stat-number">${counts.followers}</div><div class="profile-stat-label">Followers</div></div>
        <div class="profile-stat-card"><div class="profile-stat-number">${counts.following}</div><div class="profile-stat-label">Following</div></div>
        <div class="profile-stat-card"><div class="profile-stat-number">${topAlbums.length}</div><div class="profile-stat-label">Top albums shown</div></div>
      </div>

      <div class="profile-actions-row">
        ${!isOwnProfile && currentUser ? `
          <button type="button" class="secondary-btn ${counts.isFollowing ? "danger-btn" : ""}" data-profile-${counts.isFollowing ? "unfollow" : "follow"}="${profile.id}">
            ${counts.isFollowing ? "Unfollow" : "Follow"}
          </button>
        ` : ""}
        <button type="button" class="secondary-btn" data-profile-copy-link="${escapeHtml(profileUrl)}">Copy profile link</button>
      </div>

      <div class="profile-section-title">Top rated albums</div>
      <div class="profile-top-albums"> 
        ${topAlbums.length ? topAlbums.map((item, index) => `
          <div class="profile-album-row" data-profile-album-id="${item.album.id}">
            <div class="profile-album-rank">${index + 1}</div>
            <div class="profile-album-cover-wrap">${getAlbumCoverMarkup(getAlbumArtworkUrl(item.album), `${item.album.title} cover`)}</div>
            <div class="profile-album-main">
              <div class="profile-album-title">${escapeHtml(item.album.title)}</div>
              <div class="profile-album-artist">${escapeHtml(item.album.artist || "")}</div>
            </div>
            <div class="profile-album-rating">${isStageOnePresentation() ? "" : "⭐ "}${item.rating}/10</div>
          </div>
        `).join("") : `<p class="small">No public ratings yet.</p>`}
      </div>
    </div>
  `;

  /*
  Record exactly when the profile appeared.

  Mobile Safari can reuse the opening tap on newly rendered
  content, so album links are temporarily locked.
*/
profileOpenedAt = Date.now();

profileModal.classList.remove("hidden");
profileModal.setAttribute("aria-hidden", "false");
document.body.classList.add("profile-open");

profileModal.scrollTop = 0;

const profilePanel = profileModal.querySelector(".profile-card-panel");

if (profilePanel) {
  profilePanel.scrollTop = 0;
}
}

async function renderProfileSocialExtras() {
  if (!profileModal || !currentUser || !currentProfile) return;
  const panel = profileModal.querySelector(".profile-card-panel");
  if (!panel || panel.querySelector(".profile-social-panel")) return;

  const counts = await getFollowerCounts(currentUser.id);
  const profileUrl = getProfileShareUrl(currentProfile.handle);

  const socialPanel = document.createElement("div");
  socialPanel.className = "profile-social-panel";
  socialPanel.innerHTML = `
    <div class="profile-section-title">Profile and followers</div>
    <div class="profile-social-grid">
      <div class="profile-stat-card"><div class="profile-stat-number">${counts.followers}</div><div class="profile-stat-label">Followers</div></div>
      <div class="profile-stat-card"><div class="profile-stat-number">${counts.following}</div><div class="profile-stat-label">Following</div></div>
    </div>

    <div class="profile-edit-row">
      <input id="profileHandleInput" value="${escapeHtml(currentProfile.handle || "")}" placeholder="Choose a handle" maxlength="24">
      <button id="profileUpdateHandleBtn" type="button">Update handle</button>
    </div>

    <div class="profile-edit-row">
      <input id="profileFindHandleInput" placeholder="Find a user by handle">
      <button id="profileFindHandleBtn" type="button" class="secondary-btn">Find user</button>
      <button id="profileCopyMyLinkBtn" type="button" class="secondary-btn" data-profile-copy-link="${escapeHtml(profileUrl)}">Copy my profile link</button>
    </div>
  `;

  const help = panel.querySelector(".profile-help-note");
  if (help) panel.insertBefore(socialPanel, help);
  else panel.appendChild(socialPanel);
}

const originalRenderProfileModalContentV29 = renderProfileModalContent;
renderProfileModalContent = function() {
  originalRenderProfileModalContentV29();
  setTimeout(renderProfileSocialExtras, 0);
};

function buildSelectedSharePanel(item) {
  if (!item || (item.type !== "album" && item.type !== "song")) return "";
  return `
    <div class="selected-share-panel">
      <div>
        <div class="selected-share-title">Send this ${escapeHtml(item.type)} to a friend</div>
        <div class="selected-share-subtitle">Creates a shareable Bank of Music link they can open and rate.</div>
      </div>
      <button id="shareSelectedItemBtn" class="secondary-btn send-to-friend-btn" type="button">Send</button>
    </div>
  `;
}

async function handleIncomingProfileLink() {
  const params = new URLSearchParams(window.location.search);
  const profileHandle = params.get("profile");
  if (!profileHandle) return;
  await openPublicProfileByHandle(profileHandle);
}

document.addEventListener("click", async (event) => {
  const followBtn = event.target.closest("[data-profile-follow]");
  if (followBtn) {
    await followProfile(followBtn.dataset.profileFollow);
    return;
  }

  const unfollowBtn = event.target.closest("[data-profile-unfollow]");
  if (unfollowBtn) {
    await unfollowProfile(unfollowBtn.dataset.profileUnfollow);
    return;
  }

  const copyProfileBtn = event.target.closest("[data-profile-copy-link]");
  if (copyProfileBtn) {
    await copyTextToClipboard(copyProfileBtn.dataset.profileCopyLink, "Profile link copied.");
    return;
  }

  if (event.target.closest("#profileUpdateHandleBtn")) {
    await updateCurrentUserHandle();
    return;
  }

  if (event.target.closest("#profileFindHandleBtn")) {
    const handle = document.getElementById("profileFindHandleInput")?.value || "";
    await openPublicProfileByHandle(handle);
    return;
  }
});

document.addEventListener("click", async (event) => {

  const chartRow = event.target.closest(".chart-row");
  if (!chartRow) return;
  document.body.style.cursor = "wait";

  event.preventDefault();

  const itemType = chartRow.dataset.chartType;
  const itemId = Number(chartRow.dataset.chartId);

  if (itemType === "album") {
    const { data: album, error } = await supabaseClient
      .from("albums")
      .select("*")
      .eq("id", itemId)
      .single();

    if (error || !album) {
      alert("Could not open album.");
      return;
    }

    selectedItem = {
      type: "album",
      title: album.title,
      artist: album.artist,
      externalId: album.external_id || "",
      releaseDate: album.release_date || "",
      coverUrl: getAlbumArtworkUrl(album),
      savedAlbumId: album.id
    };
  }

  if (itemType === "song") {
    const { data: song, error } = await supabaseClient
      .from("songs")
      .select("*")
      .eq("id", itemId)
      .single();

    if (error || !song) {
      alert("Could not open song.");
      return;
    }

    selectedItem = {
      type: "song",
      title: song.title,
      artist: song.artist,
      externalId: song.external_id || "",
      savedSongId: song.id
    };
  }

  showOnlySection("detailSection");

  

await renderSelectedItem();
  document.body.style.cursor = "default";
window.scrollTo({ top: 0, behavior: "smooth" });
});



/* ============================================================
   v32 PRODUCTION APP POLISH
   - modular CSS-compatible section transitions
   - sticky player deep-link awareness
   - swipe between albums in selected view
   - real browser URLs for selected albums/songs
   ============================================================ */

function getItemDeepLinkUrl(item = selectedItem) {
  if (!item || !["album", "song", "artist"].includes(item.type)) return window.location.pathname;
  const url = new URL(window.location.href);
  url.searchParams.set("share", item.type);
  if (item.externalId) url.searchParams.set("id", item.externalId);
  if (item.savedAlbumId) url.searchParams.set("albumId", item.savedAlbumId);
  if (item.savedSongId) url.searchParams.set("songId", item.savedSongId);
  if (item.title || item.name) url.searchParams.set("title", item.title || item.name || "");
  if (item.artist || item.name) url.searchParams.set("artist", item.artist || item.name || "");
  if (item.releaseDate) url.searchParams.set("date", item.releaseDate);
  if (item.coverUrl) url.searchParams.set("cover", item.coverUrl);
  return url.toString();
}

function updateRealShareLinkState(item = selectedItem) {
  if (!item || !["album", "song", "artist"].includes(item.type)) return;
  const nextUrl = getItemDeepLinkUrl(item);
  if (nextUrl && nextUrl !== window.location.href) {
    window.history.replaceState({ bomShare: true, itemType: item.type }, "", nextUrl);
  }
}

function clearRealShareLinkState() {
  const url = new URL(window.location.href);
  ["share", "id", "albumId", "songId", "title", "artist", "date", "cover", "release"].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({ bomHome: true }, "", url.toString());
}

function applySectionTransition(targetId) {
  document.body.classList.add("bom-is-transitioning");
  ["searchSection", "recommendationsSection", "settingsSection", "librarySection", "detailSection", "chartsSection", "adminSection"].forEach((id) => {
    const section = document.getElementById(id);
    if (!section) return;
    section.classList.add("bom-page");
    section.classList.toggle("bom-page-active", !section.classList.contains("hidden"));
  });
  setTimeout(() => document.body.classList.remove("bom-is-transitioning"), 260);
}

function getAlbumSwipeCandidates() {
  if (!selectedItem || selectedItem.type !== "album") return [];
  const artistKey = normaliseCompare(selectedItem.artist || "");
  const saved = allAlbums
    .filter((album) => normaliseCompare(album.artist) === artistKey)
    .map((album) => ({
      type: "album",
      title: album.title,
      artist: album.artist,
      externalId: album.external_id || "",
      releaseGroupId: album.release_group_id || album.releaseGroupId || "",
      releaseDate: album.release_date || "",
      coverUrl: getAlbumArtworkUrl(album),
      savedAlbumId: album.id,
      artistId: album.artist_id || selectedItem.artistId || ""
    }));

  let remote = [];
  try { remote = JSON.parse(selectedItemDetail?.dataset?.artistAlbums || "[]") || []; } catch { remote = []; }

  const combined = [...saved, ...remote]
    .filter((album) => album && normaliseCompare(album.artist || selectedItem.artist || "") === artistKey)
    .sort((a, b) => String(a.releaseDate || "9999").localeCompare(String(b.releaseDate || "9999")));

  const seen = new Set();
  return combined.filter((album) => {
    const key = album.savedAlbumId ? `saved:${album.savedAlbumId}` : album.externalId ? `ext:${album.externalId}` : album.releaseGroupId ? `rg:${album.releaseGroupId}` : `name:${normaliseCompare(album.title)}:${album.releaseDate || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getCurrentAlbumSwipeIndex(albums) {
  if (!selectedItem || !albums.length) return -1;
  return albums.findIndex((album) =>
    (selectedItem.savedAlbumId && album.savedAlbumId && Number(album.savedAlbumId) === Number(selectedItem.savedAlbumId)) ||
    (selectedItem.externalId && album.externalId && album.externalId === selectedItem.externalId) ||
    (selectedItem.releaseGroupId && album.releaseGroupId && album.releaseGroupId === selectedItem.releaseGroupId) ||
    (normaliseCompare(album.title) === normaliseCompare(selectedItem.title) && normaliseCompare(album.artist) === normaliseCompare(selectedItem.artist))
  );
}

async function swipeToAdjacentAlbum(direction) {
  const albums = getAlbumSwipeCandidates();
  if (albums.length < 2) return;
  const currentIndex = getCurrentAlbumSwipeIndex(albums);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + direction + albums.length) % albums.length;
  selectedItem = { ...albums[nextIndex], type: "album" };
  await renderSelectedItem();
  showOnlySection("detailSection");
}

function bindSelectedAlbumSwipe() {
  if (!selectedItemDetail || selectedItemDetail.dataset.v32SwipeReady === "true") return;
  selectedItemDetail.dataset.v32SwipeReady = "true";
  let startX = 0;
  let startY = 0;
  let started = false;
  selectedItemDetail.addEventListener("pointerdown", (event) => {
    if (!selectedItem || selectedItem.type !== "album") return;
    if (event.target.closest("button, input, textarea, select, .star-option, .bom-carousel, a")) return;
    started = true;
    startX = event.clientX;
    startY = event.clientY;
  }, { passive: true });
  selectedItemDetail.addEventListener("pointerup", async (event) => {
    if (!started) return;
    started = false;

    if (
      Date.now() -
        lastMusicProviderInteractionAt <
      2200
    ) {
      return;
    }
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) < 90 || Math.abs(dx) < Math.abs(dy) * 1.35) return;
    selectedItemDetail.classList.add(dx < 0 ? "swipe-next" : "swipe-prev");
    await swipeToAdjacentAlbum(dx < 0 ? 1 : -1);
    setTimeout(() => selectedItemDetail.classList.remove("swipe-next", "swipe-prev"), 260);
  });
}


const originalShowOnlySectionV32 = showOnlySection;
showOnlySection = function(targetId) {
  originalShowOnlySectionV32(targetId);
  applySectionTransition(targetId);
  if (targetId === "searchSection") clearRealShareLinkState();
  setTimeout(() => {
    if (typeof updateSendToFriendVisibility === "function") updateSendToFriendVisibility();
    bindSelectedAlbumSwipe();
    activateCarousels(document);
  }, 0);
};

const originalUpdateStickyPlayerV32 = updateStickyPlayer;
updateStickyPlayer = function(item = selectedItem) {
  originalUpdateStickyPlayerV32(item);
  if (item && ["album", "song", "artist"].includes(item.type)) updateRealShareLinkState(item);
  const shareBtn = document.getElementById("stickyPlayerShareBtn");
  if (shareBtn) shareBtn.classList.toggle("hidden", !(item && (item.type === "album" || item.type === "song")));
};

document.getElementById("stickyPlayerOpenBtn")?.addEventListener("click", () => {
  if (selectedItem) showOnlySection("detailSection");
});

document.getElementById("stickyPlayerShareBtn")?.addEventListener("click", async (event) => {
  event.stopPropagation();
  if (selectedItem && (selectedItem.type === "album" || selectedItem.type === "song")) await shareSelectedItem();
});

window.toggleReviewEditor = function () {
  const editor = document.getElementById("reviewEditor");
  if (!editor) return;
  editor.classList.toggle("hidden");
};

window.addEventListener("popstate", async (event) => {
  if (isStageOnePresentation() && event.state?.bomDiscover) {
    selectedItem = null;
    showOnlySection("recommendationsSection");
    renderRecommendations();
    window.requestAnimationFrame(() => window.scrollTo({ top: Number(event.state.scrollY || 0), behavior: "auto" }));
    return;
  }
  await handleIncomingShareLink();
});

window.addEventListener("click", (event) => {
  if (event.target.closest('[data-bom-action="retry-album"]')) void renderSelectedItem();
});



/* ============================================================
   v33: profile average rating + admin add album/add tracks
   ============================================================ */

function getAverageRatingGivenForCurrentUserV33() {
  if (!currentUser) return null;
  const albumRatings = allAlbumRatings
    .filter((row) => row.user_id === currentUser.id)
    .map((row) => Number(row.rating))
    .filter((value) => !Number.isNaN(value));
  const trackRatings = allSongRatings
    .filter((row) => row.user_id === currentUser.id)
    .map((row) => Number(row.rating))
    .filter((value) => !Number.isNaN(value));
  const ratings = [...albumRatings, ...trackRatings];
  if (!ratings.length) return null;
  const average = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
  return { average, count: ratings.length };
}

function renderProfileModalContent() {
  if (!profileModal || !currentUser) return;
  const cleanHandle = currentProfile?.handle ? String(currentProfile.handle).replace(/^@+/, "") : "";
  const displayHandle = cleanHandle ? `@${cleanHandle}` : currentUser.email;
  const memberNumber = currentProfile?.member_number ? `#${currentProfile.member_number}` : "Pending";
  const albumsRated = getAlbumsRatedCountForCurrentUser();
  const songsRated = getSongsRatedCountForCurrentUser();
  const artistsFollowed = followedArtists.length;
  const averageRatingGiven = getAverageRatingGivenForCurrentUserV33();
  const topAlbums = getTopRatedAlbumsForCurrentUser(10);
  profileModal.innerHTML = `
    <div class="profile-modal-backdrop" data-profile-close="true"></div>
    <div class="profile-card-panel" role="dialog" aria-modal="true" aria-label="Profile statistics">
      <div class="profile-card-header">
        <div>
          <div class="profile-kicker">Bank of Music profile</div>
          <h2>${escapeHtml(displayHandle)}</h2>
          <p>Member ${escapeHtml(memberNumber)}</p>
<button type="button" id="editHandleBtn" class="secondary-btn">Edit handle</button>

<button type="button"
        id="logoutProfileBtn"
        class="secondary-btn"
        style="margin-left:10px;">
    Logout
</button>
		  
        </div>
        <button type="button" class="profile-close-btn" data-profile-close="true">×</button>
      </div>
      <div class="profile-stats-grid profile-stats-grid-v33">
        <div class="profile-stat-card"><div class="profile-stat-number">${albumsRated}</div><div class="profile-stat-label">Albums rated</div></div>
        <div class="profile-stat-card"><div class="profile-stat-number">${songsRated}</div><div class="profile-stat-label">Tracks rated</div></div>
        <div class="profile-stat-card"><div class="profile-stat-number">${artistsFollowed}</div><div class="profile-stat-label">Artists followed</div></div>
        <div class="profile-stat-card profile-stat-card-wide"><div class="profile-stat-number">${averageRatingGiven ? averageRatingGiven.average.toFixed(1) : "—"}</div><div class="profile-stat-label">Average rating given${averageRatingGiven ? ` (${averageRatingGiven.count} ratings)` : ""}</div></div>
      </div>
      <div class="profile-section-title">Top 10 rated albums</div>
      <div class="profile-top-albums">
        ${topAlbums.length ? topAlbums.map((item, index) => `
          <div class="profile-album-row" data-profile-album-id="${item.album.id}">
            <div class="profile-album-rank">${index + 1}</div>
            <div class="profile-album-cover-wrap">${getAlbumCoverMarkup(getAlbumArtworkUrl(item.album), `${item.album.title} cover`)}</div>
            <div class="profile-album-main"><div class="profile-album-title">${escapeHtml(item.album.title)}</div><div class="profile-album-artist">${escapeHtml(item.album.artist || "")}</div></div>
            <div class="profile-album-rating">${isStageOnePresentation() ? "" : "⭐ "}${item.rating}/10</div>
          </div>
        `).join("") : `<p class="small">No rated albums yet.</p>`}
      </div>
      <div class="profile-help-note">Your average rating is calculated from your album and track ratings.</div>
    </div>
  `;
}

async function adminAddAlbumFromForm() {
  if (!isAdmin) return;
  const title = normaliseText(document.getElementById("adminNewAlbumTitle")?.value || "");
  const artist = normaliseText(document.getElementById("adminNewAlbumArtist")?.value || "");
  const releaseDate = normaliseReleaseDate(document.getElementById("adminNewAlbumDate")?.value || "");
  const coverUrl = normaliseText(document.getElementById("adminNewAlbumCover")?.value || "");
  if (!title || !artist) { setMessage(adminMessage, "Please enter album title and artist."); return; }
  const payload = {
    title,
    artist,
    external_source: "manual",
    external_id: `manual-album-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    cover_art_url: coverUrl || selectedItem?.coverUrl || selectedItem?.cover_url || null,
    release_date: releaseDate
  };
  
  alert(JSON.stringify(payload, null, 2));
  
  alert("Attempting to add album:\n\n" + title + "\n" + artist);
  
  const { data, error } = await supabaseClient
  .from("albums")
  .insert([payload])
  .select()
  .single();
  if (error) {
  alert("Album insert failed:\n\n" + error.message);
  setMessage(adminMessage, error.message);
  console.error(error);
  return;
}
  setMessage(adminMessage, `Album added: ${title}.`);
  ["adminNewAlbumTitle", "adminNewAlbumArtist", "adminNewAlbumDate", "adminNewAlbumCover"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  await refreshAdminDashboard();
  const createdAlbum = data || null;
  if (createdAlbum) {
    selectedItem = { type: "album", title: createdAlbum.title, artist: createdAlbum.artist, externalId: createdAlbum.external_id || "", releaseDate: createdAlbum.release_date || "", coverUrl: getAlbumArtworkUrl(createdAlbum), savedAlbumId: createdAlbum.id };
    showOnlySection("detailSection");
    await renderSelectedItem();
  }
}

function extractMusicBrainzReleaseId(value) {
  const text = String(value || "").trim();

  const match = text.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );

  return match ? match[0] : "";
}

async function importMusicBrainzRelease() {
  if (!isAdmin) return;

  const rawValue = document.getElementById("mbReleaseId")?.value?.trim() || "";
  const releaseId = extractMusicBrainzReleaseId(rawValue);

  if (!releaseId) {
    alert("Paste a MusicBrainz release URL or release ID.");
    return;
  }

  try {
    const response = await fetch(
      `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits&fmt=json`
    );

    if (!response.ok) {
      alert("MusicBrainz could not load that release. Please check the URL is a release page.");
      return;
    }

    const data = await response.json();

    const releaseTitle = normaliseText(data.title || "");
    const releaseArtist = normaliseText(data["artist-credit"]?.[0]?.name || "Unknown artist");
    const releaseDate = normaliseReleaseDate(data.date || "");
    const coverUrl = `https://coverartarchive.org/release/${releaseId}/front`;

    if (!releaseTitle || !releaseArtist) {
      alert("Could not read album title or artist from MusicBrainz.");
      return;
    }

    const albumPayload = {
      title: releaseTitle,
      artist: releaseArtist,
      release_date: releaseDate || null,
      cover_art_url: coverUrl,
      external_source: "musicbrainz",
      external_id: releaseId,
      is_deleted: false
    };

    let { data: albumData, error: albumError } = await supabaseClient
  .from("albums")
  .upsert([albumPayload], {
    onConflict: "external_source,external_id"
  })
  .select()
  .single();

if (albumError && albumError.code === "23505") {
  const existing = await supabaseClient
    .from("albums")
    .select("*")
    .eq("title", releaseTitle)
    .eq("artist", releaseArtist)
    .single();

  if (existing.error) {
    alert("Album import failed:\n\n" + existing.error.message);
    console.error(existing.error);
    return;
  }

  const updated = await supabaseClient
    .from("albums")
    .update({
      release_date: releaseDate || existing.data.release_date || null,
      cover_art_url: coverUrl || existing.data.cover_art_url || null,
      external_source: "musicbrainz",
      external_id: releaseId,
      is_deleted: false
    })
    .eq("id", existing.data.id)
    .select()
    .single();

  if (updated.error) {
    alert("Album update failed:\n\n" + updated.error.message);
    console.error(updated.error);
    return;
  }

  albumData = updated.data;
  albumError = null;
}

if (albumError) {
  alert("Album import failed:\n\n" + albumError.message);
  console.error(albumError);
  return;
}

    if (albumError) {
      alert("Album import failed:\n\n" + albumError.message);
      console.error(albumError);
      return;
    }

    let trackNumber = 1;

    for (const medium of data.media || []) {
      for (const track of medium.tracks || []) {
        const title = normaliseText(track.title || track.recording?.title || "");
        if (!title) continue;

        const recordingId = track.recording?.id || null;

        const songPayload = {
          album_id: albumData.id,
          title,
          artist: releaseArtist,
          track_position: trackNumber,
          external_source: "musicbrainz",
          external_id: recordingId,
          is_deleted: false
        };

        if (recordingId) {
          await supabaseClient
            .from("songs")
            .upsert([songPayload], {
              onConflict: "external_source,external_id"
            });
        } else {
          await supabaseClient
            .from("songs")
            .insert([songPayload]);
        }

        trackNumber++;
      }
    }

    document.getElementById("mbReleaseId").value = "";

    await loadLibrary();
    await refreshAdminDashboard();

    selectedItem = {
      type: "album",
      title: albumData.title,
      artist: albumData.artist,
      externalId: albumData.external_id,
      releaseDate: albumData.release_date || "",
      coverUrl: getAlbumArtworkUrl(albumData),
      savedAlbumId: albumData.id
    };

    showOnlySection("detailSection");
    await renderSelectedItem();

    alert(`Imported ${releaseTitle} with ${trackNumber - 1} tracks.`);
  } catch (error) {
    console.error(error);
    alert("Import failed:\n\n" + error.message);
  }
}

async function adminAddTrackFromForm() {
  if (!isAdmin) return;

  const albumId = Number(document.getElementById("adminTrackAlbumSelect")?.value || 0);
  const title = normaliseText(document.getElementById("adminNewTrackTitle")?.value || "");
  const selectedAlbum = allAlbums.find((album) => Number(album.id) === albumId);
  const artist = normaliseText(document.getElementById("adminNewTrackArtist")?.value || selectedAlbum?.artist || "");
  const requestedPosition = Number(document.getElementById("adminNewTrackPosition")?.value || 0);

  if (!albumId || !selectedAlbum) { setMessage(adminMessage, "Please select an album."); return; }
  if (!title) { setMessage(adminMessage, "Please enter a track title."); return; }

  const existingTrack = allSongs.find((song) =>
    Number(song.album_id) === albumId &&
    normaliseCompare(song.title) === normaliseCompare(title) &&
    normaliseCompare(song.artist) === normaliseCompare(artist)
  );

  if (existingTrack) { setMessage(adminMessage, "That track already exists on this album."); return; }

  const currentAlbumTracks = allSongs.filter((song) => Number(song.album_id) === albumId);
  const highestPosition = currentAlbumTracks.reduce(
    (max, song) => Math.max(max, Number(song.track_position || 0)),
    0
  );

  const trackPosition = requestedPosition > 0 ? requestedPosition : highestPosition + 1;

  if (requestedPosition > 0) {
    const { data: tracksToShift, error: shiftLoadError } = await supabaseClient
      .from("songs")
      .select("id, track_position")
      .eq("album_id", albumId)
      .gte("track_position", trackPosition)
      .order("track_position", { ascending: false });

    if (shiftLoadError) {
      setMessage(adminMessage, shiftLoadError.message);
      return;
    }

    for (const track of tracksToShift || []) {
      const { error: shiftError } = await supabaseClient
        .from("songs")
        .update({ track_position: Number(track.track_position || 0) + 1 })
        .eq("id", track.id);

      if (shiftError) {
        setMessage(adminMessage, shiftError.message);
        return;
      }
    }
  }

  const payload = {
    title,
    artist,
    album_id: albumId,
    track_position: trackPosition,
    external_source: "manual",
    external_id: `manual-track-${albumId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  };

  const { error } = await supabaseClient.from("songs").insert([payload]);
  if (error) { setMessage(adminMessage, error.message); return; }

  setMessage(adminMessage, `Track added at position ${trackPosition}: ${title}.`);

  ["adminNewTrackTitle", "adminNewTrackArtist", "adminNewTrackPosition"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  await refreshAdminDashboard();
  if (selectedItem?.savedAlbumId && Number(selectedItem.savedAlbumId) === albumId) await renderSelectedItem();
}

async function adminEditSong(songId) {
  if (!isAdmin) return;

  const song = allSongs.find((row) => Number(row.id) === Number(songId));
  if (!song) return;

  const newTitle = prompt("Track title:", song.title || "");
  if (newTitle === null) return;

  const newArtist = prompt("Track artist:", song.artist || "");
  if (newArtist === null) return;

  const newPositionRaw = prompt("Track position on album:", song.track_position || "");
  if (newPositionRaw === null) return;

  const newPosition = Number(newPositionRaw || 0);

  const payload = {
    title: normaliseText(newTitle),
    artist: normaliseText(newArtist),
    track_position: newPosition > 0 ? newPosition : null
  };

  if (!payload.title) { setMessage(adminMessage, "Track title cannot be blank."); return; }

  const { error } = await supabaseClient.from("songs").update(payload).eq("id", Number(songId));
  if (error) { setMessage(adminMessage, error.message); return; }

  setMessage(adminMessage, "Track updated.");
  await refreshAdminDashboard();

  if (selectedItem?.savedAlbumId && Number(selectedItem.savedAlbumId) === Number(song.album_id)) {
    await renderSelectedItem();
  }
  
  async function adminDeleteSong(songId) {
  if (!isAdmin) return;

  const confirmDelete = confirm("Delete this track?");
  if (!confirmDelete) return;

  const { data: song } = await supabaseClient
    .from("songs")
    .select("album_id")
    .eq("id", Number(songId))
    .single();

  const { error } = await supabaseClient
    .from("songs")
    .delete()
    .eq("id", Number(songId));

  if (error) {
    setMessage(adminMessage, error.message);
    return;
  }

  setMessage(adminMessage, "Track deleted.");

  await refreshAdminDashboard();

  if (song?.album_id && selectedItem?.savedAlbumId === song.album_id) {
    await renderSelectedItem();
  }
}
}

const originalRenderAdminDashboardV33 = renderAdminDashboard;
renderAdminDashboard = function() {
  originalRenderAdminDashboardV33();
  if (!adminDashboard || !currentUser || !isAdmin) return;
  if (adminDashboard.querySelector("#adminNewAlbumTitle")) return;

  const creator = document.createElement("div");
  creator.innerHTML = `
    <div class="admin-panel admin-create-panel">
      <h3>Add album</h3>
      <p class="small">Manually add a missing album, then add tracks to it below.</p>
      <div class="admin-form-grid">
        <input id="adminNewAlbumTitle" placeholder="Album title" />
        <input id="adminNewAlbumArtist" placeholder="Artist" />
        <input id="adminNewAlbumDate" placeholder="Release date, e.g. 1982 or 1982-11-30" />
        <input id="adminNewAlbumCover" placeholder="Cover image URL (optional)" />
        <button class="admin-add-album-btn">Add album</button>
      </div>
    </div>

    <div class="admin-panel admin-create-panel">
      <h3>Add track to album</h3>
      <p class="small">Choose an existing album, then add one track at a time. If you enter a position, existing tracks from that position onwards will move down automatically.</p>
      <div class="admin-form-grid">
        <input id="adminAlbumSearchInput" placeholder="Search album or artist..." />
		<select id="adminTrackAlbumSelect">
          <option value="">Select album</option>
        </select>
        <input id="adminNewTrackTitle" placeholder="Track title" />
        <input id="adminNewTrackArtist" placeholder="Track artist (optional - uses album artist if blank)" />
        <input id="adminNewTrackPosition" type="number" min="1" placeholder="Track position (leave blank for next)" />
        <button class="admin-add-track-btn">Add track</button>
      </div>
	  <div class="admin-panel">
  <h3>Import MusicBrainz release</h3>

  <input
    id="mbReleaseId"
    type="text"
    placeholder="Paste MusicBrainz release URL or ID"
  />

  <button id="importMbReleaseBtn">
    Import tracks from MusicBrainz
  </button>
</div>
    </div>`;
	
	

  const summary = adminDashboard.querySelector(".admin-summary-grid");
  if (summary) summary.insertAdjacentElement("afterend", creator);
  else adminDashboard.prepend(creator);
};

adminDashboard?.addEventListener("input", function(event) {
  if (!event.target || event.target.id !== "adminAlbumSearchInput") return;

  var query = normaliseCompare(event.target.value || "");
  var select = document.getElementById("adminTrackAlbumSelect");
  if (!select) return;

  var matchingAlbums = query
    ? allAlbums
        .filter(function(album) {
          return normaliseCompare(album.title).includes(query) ||
                 normaliseCompare(album.artist).includes(query);
        })
        .slice(0, 24)
    : [];

  select.innerHTML = `
    <option value="">Select album</option>
    ${matchingAlbums
      .map(function(album) {
        return `
          <option value="${album.id}">
            ${escapeHtml(album.artist || "Unknown artist")} — ${escapeHtml(album.title)}
          </option>
        `;
      })
      .join("")}
  `;
});

adminDashboard?.addEventListener("click", async (event) => {
  const addAlbumButton = event.target.closest(".admin-add-album-btn");
  if (addAlbumButton) { event.preventDefault(); await adminAddAlbumFromForm(); return; }

  const addTrackButton = event.target.closest(".admin-add-track-btn");
  if (addTrackButton) { event.preventDefault(); await adminAddTrackFromForm(); return; }

  const editTrackButton = event.target.closest(".admin-edit-track-btn");
  if (editTrackButton) { event.preventDefault(); await adminEditSong(editTrackButton.dataset.songId); }
  
  const deleteTrackButton = event.target.closest(".admin-delete-track-btn");

if (deleteTrackButton) {
  event.preventDefault();
  await adminDeleteSong(deleteTrackButton.dataset.songId);
  return;
}

});
    
handleScrollState();

function goHome() {
  selectedItem = null;
  showOnlySection("searchSection");
}

function goSearch() {
  showOnlySection("searchSection");
}

document.addEventListener("click", async (event) => {

  if (event.target.closest(".admin-add-album-btn")) {
    event.preventDefault();
    alert("Album button clicked");
    await adminAddAlbumFromForm();
    return;
  }

  if (event.target.id === "importMbReleaseBtn") {
    event.preventDefault();
    alert("Import button clicked");
    await importMusicBrainzRelease();
    return;
  }

});

window.addEventListener("scroll", handleScrollState, { passive: true });

showOnlySection("recommendationsSection");

refreshSessionUI().then(async () => {
  stageOneInitialDataReady = true;
  await handleIncomingShareLink();
  await handleIncomingProfileLink();
  await window.BOMPresentationBridge?.openRequestedRoute();
});

handleScrollState();

window.goHome = function () {
  selectedItem = null;
  showOnlySection("searchSection");
};

window.goSearch = function () {
  selectedItem = null;
  showOnlySection("searchSection");
};

window.toggleArtistInfo = function () {

  const panel = document.getElementById("artistInfoPanel");

  const button = document.querySelector(".artist-info-toggle");

  if (!panel || !button) return;

  panel.classList.toggle("collapsed");

  button.textContent = panel.classList.contains("collapsed")

    ? "More info"

    : "Less info";

};

window.goCharts = async function () {
  selectedItem = null;
  showOnlySection("chartsSection");

  if (typeof loadCharts === "function") {
    await loadCharts();
  }
};

});


// NOTE: Album de-duplication patch not auto-applied.

// v30: Artist pages now fetch studio albums by MusicBrainz artist ID, sort chronologically, and include top rated albums/tracks.
// NOTE: Studio album de-duplication patch was not auto-applied.
