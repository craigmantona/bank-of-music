import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { flattenTracks } from "../supabase/functions/_shared/admin-catalogue.ts";

const [app, renderer, migration] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-album.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20261006120000_add_song_duration_ms.sql", import.meta.url), "utf8")
]);

function releaseTrack(position, recordingId, length, recordingLength = null) {
  return {
    position,
    title: `Track ${position}`,
    length,
    recording: { id: recordingId, title: `Track ${position}`, length: recordingLength }
  };
}

test("MusicBrainz release-track duration is retained, with the existing recording fallback", () => {
  const tracks = flattenTracks({ media: [{ position: 1, tracks: [
    releaseTrack(1, "recording-1", 181234, 199999),
    releaseTrack(2, "recording-2", null, 202345),
    releaseTrack(3, "recording-3", null, null)
  ] }] }, "Artist");
  assert.deepEqual(tracks.map(track => track.duration_ms), [181234, 202345, null]);
});

test("multi-disc occurrences retain their own release-track durations", () => {
  const tracks = flattenTracks({ media: [
    { position: 1, tracks: [releaseTrack(1, "shared-recording", 100001)] },
    { position: 2, tracks: [releaseTrack(1, "shared-recording", 100999)] }
  ] }, "Artist");
  assert.deepEqual(tracks.map(track => ({ position: track.position, disc: track.medium_position, duration: track.duration_ms })), [
    { position: 1, disc: 1, duration: 100001 },
    { position: 2, disc: 2, duration: 100999 }
  ]);
});

test("stored durations format as m:ss and missing duration renders nothing", () => {
  const context = { window: { BOMUI: {} }, document: { addEventListener() {} }, Intl, Date, Number, String };
  vm.runInNewContext(renderer, context);
  assert.equal(context.window.BOMAlbumUI.formatDuration(181234), "3:01");
  assert.equal(context.window.BOMAlbumUI.formatDuration(null), "");
});

test("album total is calculated only from complete stored song durations", () => {
  const start = app.indexOf("function buildStageOneAlbumTrackModels");
  const end = app.indexOf("async function renderStageOneAlbum", start);
  const context = {
    selectedItem: { title: "Album", artist: "Artist" },
    allSongs: [
      { id: 11, album_id: 7, title: "One", artist: "Artist", track_position: 1, duration_ms: 60000, is_deleted: false },
      { id: 12, album_id: 7, title: "Two", artist: "Artist", track_position: 2, duration_ms: 125000, is_deleted: false }
    ],
    normaliseCompare: value => String(value).toLowerCase(),
    getSongAverage: () => null,
    getYourSongRating: () => null,
    buildCompactTrackRatingControl: () => "",
    buildSelectedBackButton: () => "",
    renderClickableArtistName: value => value,
    buildCompactAlbumRatingControl: () => "",
    buildMusicProviderPanel: () => "",
    buildSelectedSharePanel: () => "",
    renderSelectedAdminControls: () => "",
    isAdmin: false
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context);
  const input = { album: { title: "Album" }, detail: { title: "Album", media: [] }, albumId: 7, artist: "Artist" };
  assert.equal(context.buildStageOneAlbumModel(input).durationMs, 185000);
  context.allSongs[1].duration_ms = null;
  assert.equal(context.buildStageOneAlbumModel(input).durationMs, null);
});

test("catalogue writes store duration while reconciliation preserves song IDs and ratings", () => {
  assert.match(migration, /add column duration_ms integer null/);
  assert.match(migration, /insert into public\.songs \([\s\S]*duration_ms/);
  assert.match(migration, /where id = v_song_id and album_id = p_album_id/);
  assert.match(migration, /v_song\.duration_ms is distinct from v_track\.duration_ms/);
  assert.match(migration, /duration_ms = v_track\.duration_ms/);
  assert.doesNotMatch(migration, /update public\.song_ratings|delete from public\.song_ratings/);
  assert.match(app, /const songPayload = \{[\s\S]*duration_ms: durationMs/);
});
