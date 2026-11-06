import assert from "node:assert/strict";
import test from "node:test";
import { chronologicalTieBreak, exactArtistTitleCandidates, manifestFromRelease, quarantineDuplicates, releaseCacheWithDuration, titleSearchUrl } from "../../scripts/historical-uk-number-ones-automated-pass.mjs";

const credit = name => [{ name, artist: { id: `id-${name}`, name } }];

test("title search escapes MusicBrainz query syntax", () => {
  const url = titleSearchUrl({ title: "What Was I Made For?" });
  assert.match(decodeURIComponent(url), /recording:\"What Was I Made For\\\?\"/);
});

test("artist-title candidates reject unrelated covers", () => {
  const entry = { title: "Moon River", artist: "Danny Williams" };
  const rows = exactArtistTitleCandidates(entry, [{ recordings: [
    { id: "correct", title: "Moon River", "artist-credit": credit("Danny Williams"), releases: [] },
    { id: "cover", title: "Moon River", "artist-credit": credit("Andy Williams"), releases: [] },
  ] }]);
  assert.deepEqual(rows.map(row => row.id), ["correct"]);
});

test("chronology resolves only a unique contemporary official single", () => {
  const entry = { title: "Example", artist: "Artist", chart_year: 2000, first_number_one_date: "2000-06-01" };
  const make = (id, date) => ({ id, title: "Example", "artist-credit": credit("Artist"), releases: [{ id: `r-${id}`, status: "Official", title: "Example", date, country: "GB", "release-group": { id: `g-${id}`, title: "Example", "primary-type": "Single", "secondary-types": [] } }] });
  assert.equal(chronologicalTieBreak(entry, [make("older", "2000-01-01"), make("newer", "2000-05-01")]).recording.id, "newer");
  assert.equal(chronologicalTieBreak(entry, [make("a", "2000-05-01"), make("b", "2000-05-01")]), null);
});

test("manifest uses stable credit names and exact recording duration fallback", () => {
  const recording = { id: "rec", length: 200000, "artist-credit": [{ name: "Artist", joinphrase: " feat. ", artist: { id: "a", name: "Artist" } }, { name: "Guest", artist: { id: "b", name: "Guest" } }] };
  const release = { id: "rel", title: "Song", country: "GB", "release-group": { id: "grp" }, "artist-credit": credit("Artist") };
  const manifest = manifestFromRelease({ artist: "Artist featuring Guest", title: "Song" }, recording, release, { position: 1, length: null, "artist-credit": recording["artist-credit"], recording });
  assert.equal(manifest.duration_ms, 200000);
  assert.equal(manifest.source_album_artist, "Artist");
  assert.equal(manifest.accepted_artist_credits[0], "Artist Guest");
});

test("duplicate SAFE recording identities are quarantined", () => {
  const rows = quarantineDuplicates([{ chart_id: 1, category: "SAFE", recording_mbid: "same" }, { chart_id: 2, category: "SAFE", recording_mbid: "same" }]);
  assert.equal(rows[0].category, "SAFE"); assert.equal(rows[1].category, "REVIEW");
});

test("release cache carries exact recording duration when the release track omits it", () => {
  const release = { media: [{ tracks: [{ length: null, recording: { id: "target" } }, { length: null, recording: { id: "other" } }] }] };
  const updated = releaseCacheWithDuration(release, "target", 123000);
  assert.equal(updated.media[0].tracks[0].length, 123000);
  assert.equal(updated.media[0].tracks[1].length, null);
  assert.equal(release.media[0].tracks[0].length, null);
});
