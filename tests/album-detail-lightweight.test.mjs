import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const loaderStart = app.indexOf("const albumDetailLoadPromises");
const loaderEnd = app.indexOf("async function ensureFullCatalogue", loaderStart);
const loader = app.slice(loaderStart, loaderEnd);
const renderStart = app.indexOf("async function renderSelectedItem");
const renderEnd = app.indexOf("function getSavedAlbumByTitleArtist", renderStart);
const render = app.slice(renderStart, renderEnd);

test("album detail uses a bounded loader instead of the full catalogue", () => {
  assert.match(render, /selectedItem\.type === "album"[\s\S]*await loadAlbumDetailData\(selectedItem\)[\s\S]*else \{[\s\S]*await ensureFullCatalogue\(\)/);
  assert.doesNotMatch(loader, /fetchAllRows|loadLibrary|canonical_recordings/);
});

test("album detail fetches only the selected album and related rows", () => {
  assert.match(loader, /from\("albums"\)\.select\("\*"\)\.limit\(1\)/);
  assert.match(loader, /from\("songs"\)\.select\("\*"\)\.eq\("album_id", Number\(album\.id\)\)/);
  assert.match(loader, /from\("ratings"\)\.select\("user_id,album_id,rating"\)\.eq\("album_id", Number\(album\.id\)\)/);
  assert.match(loader, /fetchRowsInChunks\("song_ratings", "song_id", relatedSongIds/);
  assert.match(loader, /fetchRowsInChunks\("song_ratings", "canonical_song_id", canonicalIds/);
});

test("canonical and MusicBrainz duplicate occurrences remain available for ratings", () => {
  assert.match(loader, /fetchRowsInChunks\("songs", "canonical_song_id", canonicalIds, "\*", album\.id\)/);
  assert.match(loader, /fetchRowsInChunks\("songs", "external_id", recordingIds, "\*", album\.id\)/);
  assert.match(loader, /filter\(\(song\) => !getCanonicalSongId\(song\)\)/);
  assert.match(loader, /mergeRowsById\(visibleAlbumSongs, \[\.\.\.canonicalOccurrences, \.\.\.recordingOccurrences\]\)/);
});

test("lightweight album data never marks the full catalogue ready", () => {
  assert.doesNotMatch(loader, /fullCatalogueReady\s*=\s*true/);
  assert.match(loader, /if \(fullCatalogueReady \|\| selection\?\.type !== "album"\) return null/);
});

test("direct saved album links can resolve by id without catalogue state", () => {
  assert.match(loader, /selection\?\.savedAlbumId \|\| selection\?\.albumId/);
  assert.match(loader, /query = query\.eq\("id", albumId\)/);
});

test("album detail requests remain single-flight per album", () => {
  assert.match(loader, /albumDetailLoadPromises\.has\(key\)/);
  assert.match(loader, /albumDetailLoadPromises\.set\(key, load\)/);
  assert.match(loader, /albumDetailLoadPromises\.delete\(key\)/);
});

test("bounded loader merges album, duplicate occurrences and relevant ratings without claiming full readiness", async () => {
  const canonicalId = "11111111-1111-4111-8111-111111111111";
  const db = {
    albums: [{ id: 7, title: "Large Album", artist: "An Artist", cover_art_url: "cover.jpg" }],
    songs: [
      { id: 70, album_id: 7, title: "One", track_position: 1, canonical_song_id: canonicalId, external_source: "musicbrainz", external_id: "22222222-2222-4222-8222-222222222222" },
      { id: 71, album_id: 7, title: "Two", track_position: 2 },
      { id: 90, album_id: 9, title: "One again", track_position: 3, canonical_song_id: canonicalId }
    ],
    ratings: [{ user_id: "listener", album_id: 7, rating: 9 }],
    song_ratings: [{ user_id: "listener", song_id: null, canonical_song_id: canonicalId, rating: 8 }]
  };
  const calls = [];
  const client = { from(table) {
    const filters = [];
    const query = {
      select(columns) { calls.push([table, "select", columns]); return query; },
      limit(value) { calls.push([table, "limit", value]); return query; },
      eq(column, value) { filters.push(["eq", column, value]); return query; },
      in(column, values) { filters.push(["in", column, values]); return query; },
      neq(column, value) { filters.push(["neq", column, value]); return query; },
      order() { return query; },
      async maybeSingle() { const rows = run(); return { data: rows[0] || null, error: null }; },
      then(resolve) { return Promise.resolve({ data: run(), error: null }).then(resolve); }
    };
    function run() {
      return (db[table] || []).filter(row => filters.every(([kind, column, value]) => kind === "eq" ? row[column] === value : kind === "neq" ? row[column] !== value : value.includes(row[column])));
    }
    return query;
  } };
  const context = {
    supabaseClient: client, fullCatalogueReady: false, allAlbums: [{ id: 7, title: "Large Album", discover_track_count: 2 }],
    allSongs: [], allAlbumRatings: [], allSongRatings: [],
    getCanonicalSongId: song => String(song?.canonical_song_id || ""),
    getConfirmedMusicBrainzRecordingId: song => song?.external_source === "musicbrainz" ? String(song.external_id || "") : ""
  };
  vm.runInNewContext(loader, context);
  const result = await context.loadAlbumDetailData({ type: "album", savedAlbumId: 7 });
  assert.equal(result.songs.length, 2);
  assert.deepEqual(Array.from(context.allSongs, row => row.id).sort((a, b) => a - b), [70, 71, 90]);
  assert.equal(context.allAlbumRatings[0].rating, 9);
  assert.equal(context.allSongRatings[0].rating, 8);
  assert.equal(context.fullCatalogueReady, false);
  assert.equal(calls.some(([table]) => table === "canonical_recordings"), false);
});
