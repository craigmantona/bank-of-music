import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const loaderStart = app.indexOf("const artistDetailLoadPromises");
const loaderEnd = app.indexOf("async function ensureFullCatalogue", loaderStart);
const loader = app.slice(loaderStart, loaderEnd);
const artistLoader = app.slice(app.indexOf("function getArtistDetailDataKey", loaderStart), loaderEnd);
const renderStart = app.indexOf("async function renderSelectedItem");
const renderEnd = app.indexOf("function getSavedAlbumByTitleArtist", renderStart);
const render = app.slice(renderStart, renderEnd);

test("artist detail uses its bounded loader instead of the full catalogue", () => {
  assert.match(render, /selectedItem\.type === "artist"[\s\S]*artistData = await loadArtistDetailData\(selectedItem\)/);
  assert.match(render, /renderArtistDetail\(selectedItem, artistData\)/);
  assert.doesNotMatch(loader, /fetchAllRows|loadLibrary|canonical_recordings/);
});

test("artist loader requests only selected-artist and related rating data", () => {
  assert.match(loader, /from\("albums"\)\.select\("\*"\)\.ilike\("artist", artistName\)/);
  assert.match(loader, /from\("songs"\)\.select\("\*"\)\.ilike\("artist", artistName\)/);
  assert.match(loader, /from\("artist_catalog"\)/);
  assert.match(loader, /fetchRowsInChunks\("ratings", "album_id", albumIds/);
  assert.doesNotMatch(artistLoader, /fetchRowsInChunks\("songs", "canonical_song_id"/);
  assert.match(loader, /fetchRowsInChunks\("song_ratings", "song_id", relatedSongIds/);
  assert.match(loader, /fetchRowsInChunks\("song_ratings", "canonical_song_id", canonicalIds/);
});

test("artist data remains scoped and never claims the full catalogue is ready", () => {
  assert.match(artistLoader, /artistDetailDataCache\.set/);
  assert.doesNotMatch(artistLoader, /allAlbums\s*=|allSongs\s*=|allAlbumRatings\s*=|allSongRatings\s*=/);
  assert.doesNotMatch(artistLoader, /fullCatalogueReady\s*=\s*true/);
});

test("artist requests are single-flight and cached by name and MusicBrainz identity", () => {
  assert.match(loader, /artistDetailLoadPromises\.has\(key\)/);
  assert.match(loader, /artistDetailDataCache\.set\(`name:/);
  assert.match(loader, /artistDetailDataCache\.set\(`id:/);
  assert.match(loader, /artistDetailLoadPromises\.delete\(key\)/);
});

test("bounded artist loader returns local albums, tracks, ratings and identity", async () => {
  const canonicalId = "11111111-1111-4111-8111-111111111111";
  const db = {
    albums: [{ id: 7, title: "Album", artist: "Radiohead", release_date: "1997-01-01", is_deleted: false }],
    songs: [
      { id: 70, album_id: 7, title: "Track", artist: "Radiohead", canonical_song_id: canonicalId, is_deleted: false },
      { id: 90, album_id: 9, title: "Track live", artist: "Other credit", canonical_song_id: canonicalId, is_deleted: false }
    ],
    artist_catalog: [{ artist_name: "Radiohead", musicbrainz_artist_id: "artist-id" }],
    followed_artists: [{ artist_name: "Radiohead" }],
    catalogue_release_group_exclusions: [],
    ratings: [{ user_id: "listener", album_id: 7, rating: 9 }],
    song_ratings: [{ user_id: "listener", song_id: null, canonical_song_id: canonicalId, rating: 8 }]
  };
  const calls = [];
  const client = { from(table) {
    const filters = [];
    const query = {
      select(columns) { calls.push([table, columns]); return query; },
      ilike(column, value) { filters.push(["ilike", column, value]); return query; },
      eq(column, value) { filters.push(["eq", column, value]); return query; },
      in(column, values) { filters.push(["in", column, values]); return query; },
      neq(column, value) { filters.push(["neq", column, value]); return query; },
      order() { return query; }, limit() { return query; },
      async maybeSingle() { const rows = run(); return { data: rows[0] || null, error: null }; },
      then(resolve) { return Promise.resolve({ data: run(), error: null }).then(resolve); }
    };
    function run() {
      return (db[table] || []).filter((row) => filters.every(([kind, column, value]) => {
        if (kind === "in") return value.includes(row[column]);
        if (kind === "neq") return row[column] !== value;
        if (kind === "ilike") return String(row[column] || "").toLowerCase() === String(value).toLowerCase();
        return row[column] === value;
      }));
    }
    return query;
  } };
  const context = {
    Map, Set, Promise, supabaseClient: client, fullCatalogueReady: false, currentUser: { id: "listener" },
    normaliseText: value => String(value || "").trim(), normaliseCompare: value => String(value || "").trim().toLowerCase(),
    getCanonicalSongId: song => String(song?.canonical_song_id || ""),
    getConfirmedMusicBrainzRecordingId: () => ""
  };
  vm.runInNewContext(loader, context);
  const data = await context.loadArtistDetailData({ type: "artist", name: "Radiohead" });
  assert.equal(data.artistId, "artist-id");
  assert.equal(data.albums.length, 1);
  assert.equal(data.artistSongs.length, 1);
  assert.equal(data.relatedSongs.length, 1);
  assert.equal(data.albumRatings.length, 1);
  assert.equal(data.songRatings.length, 1);
  assert.equal(data.followed, true);
  assert.equal(calls.some(([table]) => table === "canonical_recordings"), false);
});
