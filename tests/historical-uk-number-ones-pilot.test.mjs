import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_MANIFEST, buildPlan, generateTransactionSql, validateManifest,
  postgresDateOrNull, validateMusicBrainzRelease
} from "../scripts/historical-uk-number-ones-pilot.mjs";

const manifest = validateManifest(JSON.parse(await readFile(DEFAULT_MANIFEST, "utf8")));

function releaseFor(entry, overrides = {}) {
  return {
    id: entry.source_release_mbid,
    status: "Official",
    title: entry.source_album_title,
    country: entry.source_release_country,
    date: "2009-01-01",
    "release-group": { id: entry.release_group_mbid },
    "artist-credit": [{ name: entry.source_album_artist || entry.artist }],
    media: [{ tracks: [{ position: entry.track_position, title: entry.title, length: entry.duration_ms,
      "artist-credit": [{ name: entry.artist }], recording: { id: entry.recording_mbid, title: entry.title, disambiguation: "", "artist-credit": [{ name: entry.artist }] } }] }],
    ...overrides
  };
}

function unresolvedSnapshot() {
  return {
    chartRows: manifest.entries.map(e => ({ id: e.chart_row_id, title: e.title, artist: e.artist, match_status: "unresolved", song_id: null, canonical_song_id: e.placeholder_canonical_id, musicbrainz_recording_id: null })),
    canonicals: manifest.entries.map(e => ({ id: e.placeholder_canonical_id, title: e.title, artist: e.artist, musicbrainz_recording_id: null })),
    albums: manifest.entries.filter(e => e.reuse_album_id).map(e => ({ id: e.reuse_album_id, title: e.source_album_title, artist: e.artist, external_source: "musicbrainz", external_id: e.reuse_album_release_mbid || e.source_release_mbid, musicbrainz_release_id: e.reuse_album_release_mbid || e.source_release_mbid, musicbrainz_release_group_id: null, is_deleted: false })),
    songs: [], ratings: []
  };
}

test("reviewed manifest has the exact bounded pilot shape", () => {
  assert.equal(manifest.entries.length, 20);
  assert.equal(new Set(manifest.entries.map(e => e.source_release_mbid)).size, 19);
  assert.deepEqual(manifest.entries.filter(e => e.reuse_album_id).map(e => e.reuse_album_id), [100, 380]);
  assert.equal(manifest.entries[0].recording_mbid, "530def51-6d66-4700-b64c-d98a2b12e103");
  assert.notEqual(manifest.entries[0].recording_mbid, "40e901c4-2e12-43eb-bc43-ddf93fb5601b");
});

test("PostgreSQL album dates require a real full ISO calendar date", () => {
  assert.equal(postgresDateOrNull("2000-02-29"), "2000-02-29");
  assert.equal(postgresDateOrNull("2001-02-28"), "2001-02-28");
  assert.equal(postgresDateOrNull("2004-11"), null);
  assert.equal(postgresDateOrNull("2004"), null);
  for (const invalid of ["", "unknown", "2001-02-29", "1900-02-29", "2000-02-30", "2000-13-01", "2000-00-10", "2000-01-00", "2000-1-01"]) {
    assert.equal(postgresDateOrNull(invalid), null, invalid);
  }
  assert.equal(postgresDateOrNull("2000-02-29"), "2000-02-29");
  assert.equal(postgresDateOrNull("1900-02-29"), null);
});

test("partial MusicBrainz dates stay in the plan audit payload but write NULL", () => {
  const releases = Object.fromEntries(manifest.entries.map(e => [e.source_release_mbid, releaseFor(e)]));
  releases[manifest.entries[1].source_release_mbid].date = "2000-05";
  const plan = buildPlan(manifest, unresolvedSnapshot(), releases);
  const album = plan.album_actions.find(action => action.release_mbid === manifest.entries[1].source_release_mbid);
  assert.equal(album.release_date_raw, "2000-05");
  assert.equal(album.release_date, null);
});

test("MusicBrainz validation enforces source, version, artist, position and duration", () => {
  const entry = manifest.entries[0];
  assert.doesNotThrow(() => validateMusicBrainzRelease(entry, releaseFor(entry)));
  for (const bad of [
    { status: "Bootleg" },
    { "release-group": { id: manifest.entries[1].release_group_mbid } },
    { media: [{ tracks: [{ position: entry.track_position, title: entry.title, length: entry.duration_ms, "artist-credit": [{ name: "Wham!" }], recording: { id: entry.recording_mbid, title: entry.title } }] }] },
    { media: [{ tracks: [{ position: 9, title: entry.title, length: entry.duration_ms, "artist-credit": [{ name: entry.artist }], recording: { id: entry.recording_mbid, title: entry.title } }] }] },
    { media: [{ tracks: [{ position: entry.track_position, title: entry.title, length: entry.duration_ms + 10000, "artist-credit": [{ name: entry.artist }], recording: { id: entry.recording_mbid, title: entry.title } }] }] }
  ]) assert.throws(() => validateMusicBrainzRelease(entry, releaseFor(entry, bad)));
});

test("first dry-run plans 17 minimal albums and exactly 20 links", () => {
  const releases = Object.fromEntries(manifest.entries.map(e => [e.source_release_mbid, releaseFor(e)]));
  const plan = buildPlan(manifest, unresolvedSnapshot(), releases);
  assert.deepEqual(plan.counts, { albums_insert: 17, albums_reuse: 2, canonicals_update: 20, songs_insert: 20, chart_rows_update: 20, unchanged: 0 });
});

test("a successful import is idempotent", () => {
  const snapshot = unresolvedSnapshot();
  snapshot.songs = manifest.entries.map((e, index) => ({ id: 20000 + index, title: e.title, artist: e.artist, album_id: e.reuse_album_id || 5000 + index, external_source: "musicbrainz", external_id: e.recording_mbid, canonical_song_id: e.placeholder_canonical_id, is_deleted: false }));
  snapshot.canonicals.forEach((row, index) => { row.musicbrainz_recording_id = manifest.entries[index].recording_mbid; });
  snapshot.chartRows.forEach((row, index) => { row.song_id = snapshot.songs[index].id; row.match_status = "direct_mbid"; });
  for (const entry of manifest.entries.filter(e => !e.reuse_album_id)) if (!snapshot.albums.some(a => a.musicbrainz_release_id === entry.source_release_mbid)) snapshot.albums.push({ id: 5000 + snapshot.albums.length, title: entry.source_album_title, artist: entry.source_album_artist || entry.artist, musicbrainz_release_id: entry.source_release_mbid, musicbrainz_release_group_id: entry.release_group_mbid, is_deleted: false });
  const plan = buildPlan(manifest, snapshot, {});
  assert.equal(plan.counts.songs_insert, 0);
  assert.equal(plan.counts.chart_rows_update, 0);
  assert.equal(plan.counts.albums_insert, 0);
  assert.equal(plan.counts.unchanged, 20);
});

test("generated commit is one locked, guarded transaction", () => {
  const plan = buildPlan(manifest, unresolvedSnapshot(), {});
  const sql = generateTransactionSql(manifest, plan);
  assert.match(sql, /begin;/i);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /for update/gi);
  assert.match(sql, /Exact row-count assertion failed/);
  assert.match(sql, /song_ratings/);
  assert.match(sql, /commit;/i);
});

test("dry-run refuses rated or no-longer-unresolved placeholders", () => {
  const rated = unresolvedSnapshot();
  rated.ratings.push({ id: 1, canonical_song_id: manifest.entries[0].placeholder_canonical_id });
  assert.throws(() => buildPlan(manifest, rated, {}), /unrated placeholder/);
  const linked = unresolvedSnapshot();
  linked.chartRows[0].song_id = 99;
  assert.throws(() => buildPlan(manifest, linked, {}), /no longer unresolved/);
});
