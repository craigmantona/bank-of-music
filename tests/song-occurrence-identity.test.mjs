import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

function extract(start, end) {
  const from = app.indexOf(start);
  return app.slice(from, app.indexOf(end, from));
}

test("recording lookup requires song or album context when provenance is shared", () => {
  const context = vm.createContext({
    normaliseCompare: value => String(value || "").toLowerCase(),
    allSongs: [
      { id: 101, album_id: 1, external_source: "musicbrainz", external_id: "shared" },
      { id: 202, album_id: 2, external_source: "musicbrainz", external_id: "shared" }
    ]
  });
  vm.runInContext(extract("function getSavedSongByExternalId", "function getSavedAlbumsByArtist"), context);
  assert.equal(context.getSavedSongByExternalId("shared"), null);
  assert.equal(context.getSavedSongByExternalId("shared", { songId: 202 }).id, 202);
  assert.equal(context.getSavedSongByExternalId("shared", { albumId: 1 }).id, 101);
  context.allSongs.forEach((song) => Object.assign(song, { title: "How Soon Is Now?", artist: "The Smiths" }));
  assert.equal(context.getSavedSongByTitleArtist("How Soon Is Now?", "The Smiths"), null);
  assert.equal(context.getSavedSongByTitleArtist("How Soon Is Now?", "The Smiths", { albumId: 2 }).id, 202);
});

test("album track modelling selects the occurrence belonging to that album", () => {
  const context = vm.createContext({
    allSongs: [
      { id: 101, album_id: 1, title: "How Soon Is Now?", artist: "The Smiths", track_position: 6, external_source: "musicbrainz", external_id: "shared" },
      { id: 202, album_id: 2, title: "How Soon Is Now?", artist: "The Smiths", track_position: 5, external_source: "musicbrainz", external_id: "shared" }
    ],
    selectedItem: { title: "Hatful of Hollow", artist: "The Smiths" },
    getSongAverage: id => ({ avg: id === 202 ? 8 : 4, count: 1 }),
    getYourSongRating: id => id === 202 ? 9 : 3,
    buildCompactTrackRatingControl: id => `rating-${id}`,
    escapeHtml: value => String(value),
    normaliseCompare: value => String(value || "").toLowerCase()
  });
  vm.runInContext(extract("function buildStageOneAlbumTrackModels", "function buildStageOneAlbumModel"), context);
  const rows = context.buildStageOneAlbumTrackModels({
    title: "Hatful of Hollow",
    "artist-credit": [{ name: "The Smiths" }],
    media: [{ tracks: [{ position: 5, title: "How Soon Is Now?", recording: { id: "shared" } }] }]
  }, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].songId, 202);
  assert.equal(rows[0].personal, 9);
  assert.equal(rows[0].ratingControlHtml, "rating-202");
});

test("occurrence-specific paths no longer use global recording conflicts or linked rating writes", async () => {
  const ratingFunction = extract("async function saveTrackRating(", "async function deleteTrackRating");
  const catalogueMigration = await readFile(
    new URL("../supabase/migrations/20260927120000_album_track_occurrence_identity.sql", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(ratingFunction, /sameExternalId|sameTitleArtist|matchingSongs/);
  assert.doesNotMatch(catalogueMigration, /recording_already_belongs_to_another_catalogue_row/);
  assert.match(catalogueMigration, /songs_album_external_source_external_id_unique/);
  assert.match(catalogueMigration, /songs_album_track_position_unique/);
  assert.doesNotMatch(app, /from\("songs"\)[\s\S]{0,200}?onConflict:\s*"external_source,external_id"/);
});
