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

test("Stage 2A remains opt-in and loads after the approved foundation", () => {
  assert.match(html, /get\("ui"\) !== "legacy"/);
  assert.match(html, /foundationScript\.addEventListener\("load"/);
  assert.match(html, /bom-album\.js\?v=3/);
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
