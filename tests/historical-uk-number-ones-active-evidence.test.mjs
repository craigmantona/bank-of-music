import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  EvidenceFetcher, parseOfficialChartCatalogueNumbers, rankReleases, retrieveEntryEvidence, reusableCheckpoint,
  selectOfficialChartResult
} from "../scripts/historical-uk-number-ones-active-evidence.mjs";

const entry = (overrides = {}) => ({
  id: 1, chart_year: 2017, title: "Symphony", artist: "Clean Bandit featuring Zara Larsson",
  first_number_one_date: "2017-04-30", isrc: "GBAHS1700199", source_isrcs: ["GBAHS1700199"],
  musicbrainz_recording_id: null, ...overrides
});

const recordingId = "072fc090-5b35-4ae7-9976-cb785fd0983a";
const releaseId = "11111111-1111-4111-8111-111111111113";
const groupId = "11111111-1111-4111-8111-111111111114";
const credit = [{ name: "Clean Bandit", joinphrase: " feat. " }, { name: "Zara Larsson", joinphrase: "" }];

class MemoryCache {
  constructor(values = {}) { this.values = values; }
  get(url) { return this.values[url]; }
  async set(url, value) { this.values[url] = value; }
}

function fixtures() {
  const officialUrl = "https://www.officialcharts.com/songs/clean-bandit-ft-zara-larsson-symphony/";
  return {
    officialUrl,
    values: {
      [officialUrl]: { catalogue_numbers: ["GBAHS1700199"] },
      "https://musicbrainz.org/ws/2/isrc/GBAHS1700199?inc=artist-credits+releases&fmt=json": {
        isrc: "GBAHS1700199", recordings: [{ id: recordingId, title: "Symphony", length: 212733, disambiguation: "", first_release_date: "2017-03-17", artist_credit: credit }]
      },
      [`https://musicbrainz.org/ws/2/recording/${recordingId}?inc=isrcs+artist-credits+releases+release-groups&fmt=json`]: {
        id: recordingId, title: "Symphony", length: 212733, disambiguation: "", isrcs: ["GBAHS1700199"], artist_credit: credit,
        releases: [{ id: releaseId, status: "Official", title: "Symphony", date: "2017-03-17", country: "GB", disambiguation: "",
          release_group: { id: groupId, title: "Symphony", primary_type: "Single", secondary_types: [] } }]
      },
      [`https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits+release-groups&fmt=json`]: {
        id: releaseId, status: "Official", title: "Symphony", date: "2017-03-17", country: "GB", disambiguation: "", artist_credit: credit,
        release_group: { id: groupId, title: "Symphony", primary_type: "Single", secondary_types: [] },
        media: [{ position: 1, tracks: [{ position: 1, number: "1", title: "Symphony", length: 212733, artist_credit: credit,
          recording: { id: recordingId, title: "Symphony", length: 212733, disambiguation: "", artist_credit: credit } }] }]
      }
    }
  };
}

test("Official Charts HTML yields unique catalogue values and exact title/artist selection", () => {
  const html = '<span>Catalogue number</span><span class="x"> GBAHS1700199 </span><span>Catalogue number</span><span>GBAHS1700199</span>';
  assert.deepEqual(parseOfficialChartCatalogueNumbers(html), ["GBAHS1700199"]);
  const selected = selectOfficialChartResult(entry(), { singles: [
    { title: "Symphony", artist: "Clean Bandit ft Zara Larsson", url: "https://www.officialcharts.com/songs/clean-bandit-ft-zara-larsson-symphony" },
    { title: "Symphony", artist: "Donell Rush", url: "https://www.officialcharts.com/songs/donell-rush-symphony-0" }
  ] });
  assert.match(selected.url, /clean-bandit/);
});

test("release ranking rejects unsuitable versions and prefers a contemporary official UK single", () => {
  const releases = [
    { id: "live", status: "Official", title: "Symphony live", date: "2017-03-01", country: "GB", release_group: { primary_type: "Single", secondary_types: ["Live"] } },
    { id: "album", status: "Official", title: "Album", date: "2017-03-01", country: "US", release_group: { primary_type: "Album", secondary_types: [] } },
    { id: "single", status: "Official", title: "Symphony", date: "2017-03-17", country: "GB", release_group: { primary_type: "Single", secondary_types: [] } }
  ];
  assert.deepEqual(rankReleases(entry(), releases).map(row => row.id), ["single", "album"]);
});

test("cached exact Official Charts, ISRC, recording and release evidence qualifies without network", async () => {
  const fixture = fixtures(), cache = new MemoryCache(fixture.values);
  const fetcher = new EvidenceFetcher({ officialCache: cache, musicbrainzCache: cache, officialIntervalMs: 0, musicbrainzIntervalMs: 0,
    fetchImpl: async () => { throw new Error("network must not be used"); } });
  const result = await retrieveEntryEvidence(entry(), fetcher, {}, { url: fixture.officialUrl, catalogue_number: "GBAHS1700199" });
  assert.equal(result.evidence.recording_mbid, recordingId);
  assert.equal(result.evidence.release_mbid, releaseId);
  assert.equal(result.evidence.action, "safe_import");
  assert.equal(result.evidence.release_track_count, 1);
});

test("ratings remain outside evidence qualification and catalogue collisions become existing links", async () => {
  const fixture = fixtures(), cache = new MemoryCache(fixture.values);
  const fetcher = new EvidenceFetcher({ officialCache: cache, musicbrainzCache: cache, officialIntervalMs: 0, musicbrainzIntervalMs: 0,
    fetchImpl: async () => { throw new Error("network must not be used"); } });
  const result = await retrieveEntryEvidence(entry({ canonical_rating_rows: 9 }), fetcher,
    { recordings: { [recordingId]: { song_id: 42 } } }, { url: fixture.officialUrl, catalogue_number: "GBAHS1700199" });
  assert.equal(result.evidence.action, "existing_recording");
  assert.equal(result.evidence.existing_song_id, 42);
});

test("a changed exclusion registry invalidates completed checkpoints", () => {
  const previous = { final: true, row_fingerprint: "row-digest" };
  assert.equal(reusableCheckpoint(previous, "row-digest", "registry-a", "registry-a"), true);
  assert.equal(reusableCheckpoint(previous, "row-digest", "registry-a", "registry-b"), false);
  assert.equal(reusableCheckpoint(previous, "row-digest", "registry-a", "registry-a", true), false);
});

test("multiple ISRCs, wrong stored ISRCs and duplicate release occurrences fail closed", async () => {
  const fixture = fixtures();
  for (const [source, official, expected] of [
    [entry(), { catalogue_numbers: ["GBAHS1700199", "USAAA1700001"] }, "official_charts_page_has_multiple_isrcs"],
    [entry({ isrc: "USAAA1700001", source_isrcs: ["USAAA1700001"] }), { catalogue_numbers: ["GBAHS1700199"] }, "official_charts_isrc_conflicts_with_stored_evidence"]
  ]) {
    const cache = new MemoryCache({ ...fixture.values, [fixture.officialUrl]: official });
    const fetcher = new EvidenceFetcher({ officialCache: cache, musicbrainzCache: cache, officialIntervalMs: 0, musicbrainzIntervalMs: 0 });
    const result = await retrieveEntryEvidence(source, fetcher, {}, { url: fixture.officialUrl });
    assert.equal(result.reason, expected);
  }
  const duplicated = structuredClone(fixtures());
  duplicated.values[`https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits+release-groups&fmt=json`].media[0].tracks.push(
    structuredClone(duplicated.values[`https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits+release-groups&fmt=json`].media[0].tracks[0]));
  const cache = new MemoryCache(duplicated.values), fetcher = new EvidenceFetcher({ officialCache: cache, musicbrainzCache: cache, officialIntervalMs: 0, musicbrainzIntervalMs: 0 });
  const result = await retrieveEntryEvidence(entry(), fetcher, {}, { url: duplicated.officialUrl, catalogue_number: "GBAHS1700199" });
  assert.equal(result.reason, "exact_release_recording_occurrence_not_unique");
});

test("a removed MusicBrainz release is a final evidence miss and the next exact release can qualify", async () => {
  const fixture = fixtures(), missingReleaseId = "00000000-0000-4000-8000-000000000001";
  const recordingUrl = `https://musicbrainz.org/ws/2/recording/${recordingId}?inc=isrcs+artist-credits+releases+release-groups&fmt=json`;
  fixture.values[recordingUrl].releases.unshift({
    id: missingReleaseId, status: "Official", title: "Symphony", date: "2017-03-17", country: "GB", disambiguation: "",
    release_group: { id: groupId, title: "Symphony", primary_type: "Single", secondary_types: [] }
  });
  const cache = new MemoryCache(fixture.values);
  const fetcher = new EvidenceFetcher({ officialCache: cache, musicbrainzCache: cache, officialIntervalMs: 0, musicbrainzIntervalMs: 0,
    fetchImpl: async url => new Response("", { status: url.includes(missingReleaseId) ? 404 : 500 }) });
  const result = await retrieveEntryEvidence(entry(), fetcher, {}, { url: fixture.officialUrl, catalogue_number: "GBAHS1700199" });
  assert.equal(result.evidence.release_mbid, releaseId);
});

test("the active scanner rejects every write mode before reading inputs", () => {
  const script = fileURLToPath(new URL("../scripts/historical-uk-number-ones-active-evidence.mjs", import.meta.url));
  for (const flag of ["--commit", "--execute", "--apply", "--production"]) {
    const result = spawnSync(process.execPath, [script, flag], { encoding: "utf8", env: {} });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Read-only evidence retrieval rejects/);
  }
});
