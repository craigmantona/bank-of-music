import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [html, app, album, styles, browserRegression] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-album.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8"),
  readFile(new URL("./stage2a-album-browser.test.html", import.meta.url), "utf8")
]);

const trackModelStart = app.indexOf("function buildStageOneAlbumTrackModels");
const trackModelEnd = app.indexOf("const albumDurationEnrichmentAttempted", trackModelStart);
const trackModelSource = app.slice(trackModelStart, trackModelEnd);

function createAlbumModelContext(allSongs = []) {
  const context = {
    allSongs,
    selectedItem: { title: "People Watching (Deluxe Edition)", artist: "Sam Fender" },
    normaliseText: value => String(value || "").trim(),
    normaliseCompare: value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, ""),
    getSongAverage: () => null,
    getYourSongRating: () => null,
    renderArtistCreditLinks: value => value,
    buildCompactTrackRatingControl: () => "track-rating",
    buildCompactAlbumRatingControl: id => `album-rating-${id}`,
    buildSelectedBackButton: () => "",
    renderClickableArtistName: value => value,
    isAdmin: false,
    renderRemoteAlbumCatalogueStatus: () => "Discovery-only album — add it to the catalogue to enable ratings.",
    buildMusicProviderPanel: () => "",
    buildSelectedSharePanel: () => "",
    renderSelectedAdminControls: () => ""
  };
  vm.runInNewContext(trackModelSource, context);
  return context;
}

function albumDetail(trackCount) {
  return {
    title: "People Watching (Deluxe Edition)",
    "artist-credit": [{ name: "Sam Fender" }],
    media: [{ tracks: Array.from({ length: trackCount }, (_, index) => ({
      position: index + 1,
      title: `Track ${index + 1}`,
      recording: { id: `recording-${index + 1}`, title: `Track ${index + 1}` }
    })) }]
  };
}

test("Stage 2A remains opt-in and loads after the approved foundation", () => {
  assert.match(html, /get\("ui"\) !== "legacy"/);
  assert.match(html, /foundationScript\.addEventListener\("load"/);
  assert.match(html, /bom-album\.js\?v=6/);
  assert.match(app, /if \(isStageOnePresentation\(\)\)/);
});

test("Album presentation has no direct data access or mutations", () => {
  assert.doesNotMatch(album, /supabaseClient|musicbrainz|\bfetch\(|\.from\(|\.rpc\(/i);
  assert.doesNotMatch(album, /prototype|fixture|mock/i);
});

test("normalized Album and Track models retain first-class ratings", () => {
  for (const field of ["albumId", "title", "artist", "artworkUrl", "releaseDate", "trackCount", "durationMs", "community", "personal", "tracks"]) {
    assert.match(app, new RegExp(`\\b${field}\\b`));
  }
  assert.match(app, /getSongAverage\(savedSong\.id\)/);
  assert.match(app, /getYourSongRating\(savedSong\.id\)/);
  assert.match(app, /buildCompactTrackRatingControl\(savedSong\.id, personal\)/);
  assert.match(app, /buildCompactAlbumRatingControl\(albumId, personal\)/);
});

test("People Watching discovery detail keeps its 19 release tracks and never adopts orphan catalogue songs", () => {
  const orphanSongs = Array.from({ length: 85 }, (_, index) => ({
    id: index + 1, album_id: null, title: `Orphan ${index + 1}`, track_position: index + 1
  }));
  const context = createAlbumModelContext(orphanSongs);
  const tracks = context.buildStageOneAlbumTrackModels(albumDetail(19), null);
  assert.equal(tracks.length, 19);
  assert.equal(tracks.some(track => track.title.startsWith("Orphan")), false);
});

test("album track matching remains album-specific across catalogue variants", () => {
  const context = createAlbumModelContext([
    { id: 1, album_id: 7, title: "Catalogue A", track_position: 1 },
    { id: 2, album_id: 8, title: "Other Variant", track_position: 1 },
    { id: 3, album_id: null, title: "Unlinked", track_position: 1 }
  ]);
  const tracks = context.buildStageOneAlbumTrackModels({ title: "Saved Album", "artist-credit": [{ name: "Artist" }], media: [] }, 7);
  assert.deepEqual(Array.from(tracks, track => track.title), ["Catalogue A"]);
});

test("incomplete saved albums use available external tracks while rating eligibility follows a valid catalogue id", () => {
  const context = createAlbumModelContext([]);
  const detail = albumDetail(2);
  const savedTracks = context.buildStageOneAlbumTrackModels(detail, 42);
  assert.equal(savedTracks.length, 2);
  const savedModel = context.buildStageOneAlbumModel({ album: { title: detail.title }, detail, albumId: 42, artworkUrl: "", artist: "Sam Fender", community: null, personal: null, releaseDate: "" });
  const discoveryModel = context.buildStageOneAlbumModel({ album: { title: detail.title }, detail, albumId: null, artworkUrl: "", artist: "Sam Fender", community: null, personal: null, releaseDate: "" });
  assert.equal(savedModel.albumRatingControlHtml, "album-rating-42");
  assert.match(discoveryModel.albumRatingControlHtml, /Discovery-only album/);
});

test("existing mutation and provider handlers remain authoritative", () => {
  assert.match(app, /await saveTrackRating\(songId\)/);
  assert.match(app, /await saveAlbumRating\(albumId\)/);
  assert.match(app, /\.upsert\(ratingRows/);
  assert.match(app, /saveAlbumReview\(albumId\)/);
  assert.match(app, /openWithMusicProvider/);
  assert.match(app, /shareSelectedItem/);
});

test("reviews progressively hydrate with an independent retry state", () => {
  assert.match(app, /void hydrateStageOneAlbumReviews\(model\.albumId\)/);
  assert.match(app, /loadAlbumReviews\(albumId, \{ throwOnError: true \}\)/);
  assert.match(app, /retry-album-reviews/);
  assert.match(album, /Loading reviews/);
});

test("approved table and responsive mobile composition are present", () => {
  for (const label of ["Track", "Time", "Community", "You", "Reviews", "Listen elsewhere", "Share album"]) {
    assert.match(app + album + styles, new RegExp(label, "i"));
  }
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /\.bom-v1-top-track/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("catalogue and qualification infrastructure is absent from Stage 2A assets", () => {
  assert.doesNotMatch(album + styles, /artist-catalog|qualification-v2|shadow snapshots|artist_import_queue/i);
});

test("track ratings use a compact disclosure while retaining the existing handler", () => {
  assert.match(app, /<details class="bom-v1-track-rating-control">/);
  assert.match(app, /handleStarOptionClick\(event, this\)/);
  assert.match(app, /data-clear-track-rating/);
  assert.match(app, /await deleteTrackRating/);
  assert.doesNotMatch(album, /★/);
  assert.match(styles, /\.bom-v1-track-rating-popover/);
});

test("album ratings use the compact numeric interaction and no permanent stars", () => {
  assert.match(app, /<details class="bom-v1-album-rating-control"/);
  assert.match(app, /Rate this album from 1 to 10/);
  assert.match(app, /data-clear-album-rating/);
  assert.match(app, /await saveAlbumRating\(albumId\)/);
  assert.match(app, /await deleteAlbumRating\(clearButton\.dataset\.clearAlbumRating\)/);
  assert.doesNotMatch(app.match(/function buildCompactAlbumRatingControl[\s\S]*?\n\}/)?.[0] || "", /★/);
  assert.match(styles, /\.bom-v1-album-rating-popover/);
  assert.match(styles, /\.bom-v1-album-rating-trigger/);
});

test("top track emphasis never draws a left-hand rule", () => {
  assert.match(styles, /\.bom-v1-track-row\.bom-v1-top-track \{ box-shadow: none !important; \}/);
  assert.doesNotMatch(styles, /\.bom-v1-track-row\.bom-v1-top-track \{[^}]*inset\s+2px\s+0\s+0/);
  assert.match(styles, /\.bom-v1-track-row\.bom-v1-top-track \.track-col-average strong/);
});

test("album track rows override legacy card and glow styling only inside the track section", () => {
  assert.match(styles, /\.bom-v1-tracks-section \.track-row-table\.bom-v1-track-row \{[^}]*background-image: none !important;[^}]*border-radius: 0 !important;[^}]*box-shadow: none !important;/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.bom-v1-tracks-section \.track-row-table\.bom-v1-track-row \{[^}]*min-height: 0 !important;/);
});

test("saved album tracks expose one accessible stretched navigation control", () => {
  assert.match(album, /class="bom-v1-track-open" data-library-type="song" data-song-id=/);
  assert.match(album, /aria-label="Open \$\{escapeHtml\(track\.title\)\}"/);
  assert.match(styles, /\.bom-v1-track-open::after \{[^}]*position: absolute;[^}]*inset: 0;/);
  assert.match(styles, /\.bom-v1-track-open:focus-visible::after/);
});

test("browser regression harness exercises the visible rating lifecycle", () => {
  for (const expectation of ["closed selector leaked choices", "rated selector did not open", "changed value did not update", "changed value was not selected on reopen", "clear did not reset control", "unrated selector did not open"]) {
    assert.match(browserRegression, new RegExp(expectation));
  }
  assert.match(browserRegression, /dataset\.testResult/);
});

test("release dates display only the precision supported by their source", () => {
  const context = { window: { BOMUI: {} }, document: { addEventListener() {} }, Intl, Date, Number, String };
  vm.runInNewContext(album, context);
  const format = context.window.BOMAlbumUI.formatReleaseDate;
  assert.equal(format("1973-01-01", "stored"), "1973");
  assert.equal(format("1973", "external"), "1973");
  assert.equal(format("1973-05", "external"), "May 1973");
  assert.equal(format("1969-10-01", "external"), "1 October 1969");
});
