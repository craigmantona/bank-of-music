import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, app, album, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-album.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);

test("Stage 2A remains opt-in and loads after the approved foundation", () => {
  assert.match(html, /get\("ui"\) === "stage1"/);
  assert.match(html, /foundationScript\.addEventListener\("load"/);
  assert.match(html, /bom-album\.js\?v=1/);
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
  assert.match(app, /renderStarSelector\(`track-rating-/);
  assert.match(app, /renderStarSelector\(`album-rating-/);
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
