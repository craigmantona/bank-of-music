import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan, generateAlbumSql, indexReleaseCache, validateManifest, validateRelease } from "../scripts/historical-album-track-completion.mjs";

const uuid = n => `${String(n).padStart(8,"0")}-0000-4000-8000-${String(n).padStart(12,"0")}`;
const album = { album_id: 10, title: "Album", artist: "Artist", release_mbid: uuid(1), release_group_mbid: uuid(2), expected_track_count: 2, historical_chart_rows: [20] };
const release = { id: uuid(1), status: "Official", title: "Album", "artist-credit": [{ name: "Artist" }], "release-group": { id: uuid(2), "primary-type": "Album", "secondary-types": [] }, media: [{ position: 1, tracks: [1,2].map(n => ({ position:n,title:`Track ${n}`,length:200000,recording:{id:uuid(n+2)},"artist-credit":[{name:"Artist"}] })) }] };
const manifest = { schema_version: 1, albums: [album] };
const snapshot = () => ({ albums:[{ id:10,title:"Album",artist:"Artist",musicbrainz_release_id:uuid(1),musicbrainz_release_group_id:uuid(2),cover_art_url:"https://cover",is_deleted:false }], albumSongs:[{id:30,album_id:10,title:"Track 1",artist:"Artist",track_position:1,external_source:"musicbrainz",external_id:uuid(3),canonical_song_id:uuid(30),is_deleted:false}], canonicals:[{id:uuid(30),title:"Track 1",artist:"Artist",musicbrainz_recording_id:uuid(3)}], occurrences:[], ratings:[{id:1,canonical_song_id:uuid(30),rating:9}], chartRows:[{id:20,song_id:30,canonical_song_id:uuid(30),musicbrainz_recording_id:uuid(3)}] });

test("plans only missing album occurrences and preserves ratings/links", () => {
  const plan=buildPlan(manifest,{[uuid(1)]:release},snapshot());
  assert.deepEqual(plan.totals,{album_inserts:0,song_occurrence_inserts:1,canonical_inserts:1,canonical_reuses:0,historical_link_updates:0,rating_updates:0,unchanged_tracks:1});
  const sql=generateAlbumSql(plan.albums[0]);
  assert.match(sql,/Rating integrity changed/); assert.match(sql,/Historical links changed/); assert.match(sql,/Final track-count assertion failed/);
});

test("reuses a unique canonical by recording MBID", () => {
  const data=snapshot(); data.canonicals.push({id:uuid(40),title:"Track 2",artist:"Artist",musicbrainz_recording_id:uuid(4)});
  data.occurrences.push({id:41,album_id:99,external_id:uuid(4),canonical_song_id:uuid(40)});
  const plan=buildPlan(manifest,{[uuid(1)]:release},data);
  assert.equal(plan.totals.canonical_reuses,1); assert.equal(plan.totals.canonical_inserts,0); assert.equal(plan.totals.song_occurrence_inserts,1);
});

test("rejects duplicate album occurrences and competing canonicals", () => {
  const duplicate=snapshot(); duplicate.albumSongs.push({...duplicate.albumSongs[0],id:31});
  assert.throws(()=>buildPlan(manifest,{[uuid(1)]:release},duplicate),/Duplicate album occurrence/);
  const competing=snapshot(); competing.canonicals.push({id:uuid(41),musicbrainz_recording_id:uuid(4)},{id:uuid(42),musicbrainz_recording_id:uuid(4)});
  assert.throws(()=>buildPlan(manifest,{[uuid(1)]:release},competing),/Competing canonical/);
});

test("rejects incorrect editions and excluded release types", () => {
  assert.throws(()=>validateRelease(album,{...release,id:uuid(99)}),/release MBID/);
  assert.throws(()=>validateRelease(album,{...release,"release-group":{...release["release-group"],"primary-type":"Single"}}),/primary type/);
  assert.throws(()=>validateRelease(album,{...release,media:[...release.media,{position:2,tracks:[]}]}),/single medium/);
});

test("rejects unknown durations under normal album validation", () => {
  const missingDuration = structuredClone(release);
  missingDuration.media[0].tracks[1].length = null;
  missingDuration.media[0].tracks[1].recording.length = null;
  assert.throws(() => validateRelease(album, missingDuration), /track duration 2/);
});

test("permits unknown durations only for the reviewed Eddie Calvert release", () => {
  const reviewed = {
    ...album,
    album_id: 1818,
    release_mbid: "fa4d5f86-0d3b-4fcc-b51a-bbe8caacbec1",
    release_group_mbid: "20a3673b-556c-4f34-b6fe-2fe0d24bb1f7",
    allow_missing_durations: true
  };
  const reviewedRelease = structuredClone(release);
  reviewedRelease.id = reviewed.release_mbid;
  reviewedRelease["release-group"].id = reviewed.release_group_mbid;
  reviewedRelease.media[0].tracks[1].length = null;
  reviewedRelease.media[0].tracks[1].recording.length = null;
  const tracks = validateRelease(reviewed, reviewedRelease);
  assert.equal(tracks[0].duration_ms, 200000);
  assert.equal(tracks[1].duration_ms, null);

  const unrelatedRelease = structuredClone(release);
  unrelatedRelease.media[0].tracks[1].length = null;
  unrelatedRelease.media[0].tracks[1].recording.length = null;
  assert.throws(() => validateRelease({ ...album, allow_missing_durations: true }, unrelatedRelease), /track duration 2/);
  assert.throws(() => validateManifest({ schema_version: 1, albums: [{ ...album, allow_missing_durations: true }] }), /not permitted/);
});

test("a completed album is idempotent", () => {
  const data=snapshot(); data.albumSongs.push({id:31,album_id:10,title:"Track 2",artist:"Artist",track_position:2,external_source:"musicbrainz",external_id:uuid(4),canonical_song_id:uuid(40),is_deleted:false}); data.canonicals.push({id:uuid(40),title:"Track 2",artist:"Artist",musicbrainz_recording_id:uuid(4)});
  const plan=buildPlan(manifest,{[uuid(1)]:release},data);
  assert.equal(plan.totals.song_occurrence_inserts,0); assert.equal(plan.totals.canonical_inserts,0); assert.equal(plan.totals.unchanged_tracks,2);
});

test("indexes both direct and persistent MusicBrainz response caches", () => {
  assert.equal(indexReleaseCache({ [uuid(1)]: release })[uuid(1)].id, uuid(1));
  assert.equal(indexReleaseCache({ [`https://musicbrainz.org/ws/2/release/${uuid(1)}?fmt=json`]: release })[uuid(1)].id, uuid(1));
});

test("plans guarded album identity and existing-track metadata corrections", () => {
  const data = snapshot();
  data.albums[0].musicbrainz_release_id = null;
  data.albums[0].musicbrainz_release_group_id = null;
  data.albumSongs[0].track_position = null;
  data.albumSongs[0].duration_ms = null;
  const corrected = structuredClone(album);
  corrected.album_identity_correction = { expected_release_mbid: null, expected_release_group_mbid: null };
  corrected.existing_track_corrections = [{
    song_id: 30, recording_mbid: uuid(3), canonical_id: uuid(30),
    expected_track_position: null, new_track_position: 1, expected_duration_ms: null, new_duration_ms: 200000
  }];
  const plan = buildPlan({ schema_version: 1, albums: [corrected] }, { [uuid(1)]: release }, data);
  assert.equal(plan.totals.unchanged_tracks, 1);
  assert.equal(plan.totals.song_occurrence_inserts, 1);
  const sql = generateAlbumSql(plan.albums[0]);
  assert.match(sql, /a\.musicbrainz_release_id is null/);
  assert.match(sql, /update public\.albums set musicbrainz_release_id/);
  assert.match(sql, /where id=30 and album_id=10/);
  assert.match(sql, /track_position is null/);
  assert.match(sql, /duration_ms is null/);
  assert.match(sql, /Album rating integrity changed/);
});

test("rejects stale metadata-correction preconditions", () => {
  const data = snapshot();
  data.albums[0].musicbrainz_release_id = uuid(99);
  const corrected = { ...album, album_identity_correction: { expected_release_mbid: null, expected_release_group_mbid: null } };
  assert.throws(() => buildPlan({ schema_version: 1, albums: [corrected] }, { [uuid(1)]: release }, data), /correction precondition/);
});

test("metadata corrections are idempotent after they are applied", () => {
  const data = snapshot();
  data.albumSongs[0].duration_ms = 200000;
  const corrected = structuredClone(album);
  corrected.album_identity_correction = { expected_release_mbid: null, expected_release_group_mbid: null };
  corrected.existing_track_corrections = [{
    song_id: 30, recording_mbid: uuid(3), canonical_id: uuid(30),
    expected_track_position: null, new_track_position: 1, expected_duration_ms: null, new_duration_ms: 200000
  }];
  data.albumSongs.push({id:31,album_id:10,title:"Track 2",artist:"Artist",track_position:2,external_source:"musicbrainz",external_id:uuid(4),canonical_song_id:uuid(40),duration_ms:200000,is_deleted:false});
  data.canonicals.push({id:uuid(40),title:"Track 2",artist:"Artist",musicbrainz_recording_id:uuid(4)});
  const plan = buildPlan({ schema_version: 1, albums: [corrected] }, { [uuid(1)]: release }, data);
  assert.equal(plan.totals.song_occurrence_inserts, 0);
  assert.equal(plan.totals.unchanged_tracks, 2);
  assert.equal(plan.albums[0].album_identity_correction, null);
  assert.deepEqual(plan.albums[0].existing_track_corrections, []);
});
