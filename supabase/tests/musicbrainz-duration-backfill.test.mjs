import assert from "node:assert/strict";
import test from "node:test";
import {
  planAlbumDurationUpdates,
  releaseOccurrenceTracks,
  runDurationBackfillBatch
} from "../functions/_shared/musicbrainz-duration-backfill.ts";

const RELEASE_ID = "11111111-1111-4111-8111-111111111111";
const RECORDING_1 = "22222222-2222-4222-8222-222222222221";
const RECORDING_2 = "22222222-2222-4222-8222-222222222222";
const album = { id: 9, musicbrainz_release_id: RELEASE_ID };

function song(id, position, recordingId, duration_ms = null) {
  return {
    id, album_id: album.id, track_position: position,
    external_source: recordingId ? "musicbrainz" : "manual",
    external_id: recordingId, duration_ms, is_deleted: false,
    title: `Song ${id}`, spotify_track_id: `spotify-${id}`, untouched: `value-${id}`
  };
}

function track(position, recordingId, length) {
  return { position, title: `Track ${position}`, length, recording: { id: recordingId } };
}

function release(media = [{ position: 1, "track-count": 2, tracks: [
  track(1, RECORDING_1, 101001), track(2, RECORDING_2, 202002)
]}]) {
  return { id: RELEASE_ID, media };
}

test("complete unique positions map durations without recording identities", () => {
  const plan = planAlbumDurationUpdates(album, [song(1, 1, null), song(2, 2, null)], release());
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.updates.map(item => [item.song_id, item.duration_ms]), [[1, 101001], [2, 202002]]);
});

test("complete unique recording IDs map durations without positions", () => {
  const plan = planAlbumDurationUpdates(album, [
    song(1, null, RECORDING_1), song(2, null, RECORDING_2)
  ], release());
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.updates.map(item => item.song_id), [1, 2]);
});

test("position and recording mappings must agree", () => {
  const agreed = planAlbumDurationUpdates(album, [
    song(1, 1, RECORDING_1), song(2, 2, RECORDING_2)
  ], release());
  assert.equal(agreed.updates.length, 2);

  const disagreed = planAlbumDurationUpdates(album, [
    song(1, 1, RECORDING_2), song(2, 2, RECORDING_1)
  ], release());
  assert.equal(disagreed.ok, false);
  assert.equal(disagreed.reason, "position_recording_disagreement");
  assert.equal(disagreed.updates.length, 0);
  assert.equal(disagreed.skipped, 2);
});

test("missing occurrence duration is skipped and never replaced with recording length", () => {
  const detail = release([{ position: 1, "track-count": 2, tracks: [
    { ...track(1, RECORDING_1, null), recording: { id: RECORDING_1, length: 999999 } },
    track(2, RECORDING_2, 202002)
  ] }]);
  const plan = planAlbumDurationUpdates(album, [
    song(1, 1, RECORDING_1), song(2, 2, RECORDING_2)
  ], detail);
  assert.deepEqual(plan.updates.map(item => item.song_id), [2]);
  assert.equal(plan.skipped, 1);
});

test("multi-disc tracks use one album-wide occurrence sequence", () => {
  const detail = release([
    { position: 1, "track-count": 1, tracks: [track(1, RECORDING_1, 101001)] },
    { position: 2, "track-count": 1, tracks: [track(1, RECORDING_2, 202002)] }
  ]);
  const flattened = releaseOccurrenceTracks(detail, RELEASE_ID);
  assert.deepEqual(flattened.tracks.map(item => [item.position, item.medium_position, item.medium_track_position]), [
    [1, 1, 1], [2, 2, 1]
  ]);
  const plan = planAlbumDurationUpdates(album, [song(1, 1, null), song(2, 2, null)], detail);
  assert.deepEqual(plan.updates.map(item => item.duration_ms), [101001, 202002]);
});

test("restart is idempotent and counts valid existing durations", async () => {
  const existing = [song(1, 1, RECORDING_1, 101001), song(2, 2, RECORDING_2)];
  const writes = [];
  let fetches = 0;
  const first = await runDurationBackfillBatch({
    albums: [album], dryRun: false,
    fetchSongs: async () => existing,
    fetchRelease: async () => { fetches += 1; return release(); },
    updateDuration: async update => { writes.push(update); existing[1].duration_ms = update.duration_ms; return true; }
  });
  assert.equal(first.songs_populated, 1);
  assert.equal(first.songs_already_populated, 1);
  const second = await runDurationBackfillBatch({
    albums: [album], dryRun: false,
    fetchSongs: async () => existing,
    fetchRelease: async () => { fetches += 1; return release(); },
    updateDuration: async update => { writes.push(update); return true; }
  });
  assert.equal(second.songs_populated, 0);
  assert.equal(second.songs_already_populated, 2);
  assert.equal(writes.length, 1);
  assert.equal(fetches, 1);
});

test("preview validates and reports without writing", async () => {
  let writes = 0;
  const report = await runDurationBackfillBatch({
    albums: [album], dryRun: true,
    fetchSongs: async () => [song(1, 1, RECORDING_1), song(2, 2, RECORDING_2)],
    fetchRelease: async () => release(),
    updateDuration: async () => { writes += 1; return true; }
  });
  assert.equal(report.songs_would_populate, 2);
  assert.equal(report.songs_populated, 0);
  assert.equal(writes, 0);
});

test("write plans contain only identity guards and duration, preserving unrelated song data", () => {
  const original = song(1, 1, RECORDING_1);
  const plan = planAlbumDurationUpdates(album, [original, song(2, 2, RECORDING_2)], release());
  assert.deepEqual(Object.keys(plan.updates[0]).sort(), ["album_id", "duration_ms", "song_id"]);
  assert.equal(original.spotify_track_id, "spotify-1");
  assert.equal(original.untouched, "value-1");
});

test("one shared release ID is fetched once per batch", async () => {
  let fetches = 0;
  await runDurationBackfillBatch({
    albums: [album, { ...album, id: 10 }], dryRun: true,
    fetchSongs: async albumId => [
      { ...song(albumId * 10 + 1, 1, RECORDING_1), album_id: albumId },
      { ...song(albumId * 10 + 2, 2, RECORDING_2), album_id: albumId }
    ],
    fetchRelease: async () => { fetches += 1; return release(); },
    updateDuration: async () => true
  });
  assert.equal(fetches, 1);
});
