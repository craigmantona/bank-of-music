import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan, generateAlbumSql, validateRelease } from "../scripts/historical-album-track-completion.mjs";

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

test("a completed album is idempotent", () => {
  const data=snapshot(); data.albumSongs.push({id:31,album_id:10,title:"Track 2",artist:"Artist",track_position:2,external_source:"musicbrainz",external_id:uuid(4),canonical_song_id:uuid(40),is_deleted:false}); data.canonicals.push({id:uuid(40),title:"Track 2",artist:"Artist",musicbrainz_recording_id:uuid(4)});
  const plan=buildPlan(manifest,{[uuid(1)]:release},data);
  assert.equal(plan.totals.song_occurrence_inserts,0); assert.equal(plan.totals.canonical_inserts,0); assert.equal(plan.totals.unchanged_tracks,2);
});
