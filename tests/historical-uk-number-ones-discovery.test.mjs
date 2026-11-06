import test from "node:test";
import assert from "node:assert/strict";
import { artistCompatible, classifySearch, discoverEntry, discoverySummary, eligibleCandidates, parseCsv,
  quarantineDuplicateRecordings, reconcileResults, resultsCsv, selectRelease } from "../scripts/historical-uk-number-ones-discovery.mjs";

const entry = { chart_id: 1, chart_year: 1980, artist: "Pretenders", title: "Brass in Pocket" };
const release = (overrides = {}) => ({ id: "11111111-1111-4111-8111-111111111111", status: "Official", title: "Brass in Pocket", date: "1980-01-01", country: "GB", "release-group": { id: "22222222-2222-4222-8222-222222222222", title: "Brass in Pocket", "secondary-types": [] }, ...overrides });
const recording = (overrides = {}) => ({ id: "33333333-3333-4333-8333-333333333333", score: 100, title: "Brass in Pocket", length: 185000, "artist-credit": [{ name: "The Pretenders" }], releases: [release()], ...overrides });

test("artist credits tolerate presentation conjunctions but not different artists", () => {
  assert.equal(artistCompatible("Eminem featuring Juice Wrld", "Eminem feat. Juice WRLD"), true);
  assert.equal(artistCompatible("Emile Ford and the Checkmates", "Emile Ford & The Checkmates"), true);
  assert.equal(artistCompatible("George Michael", "Wham!"), false);
});

test("candidate discovery rejects unsuitable versions and release evidence", () => {
  const search = { recordings: [recording(), recording({ id: "44444444-4444-4444-8444-444444444444", disambiguation: "live" }), recording({ id: "55555555-5555-4555-8555-555555555555", releases: [release({ status: "Bootleg" })] })] };
  assert.deepEqual(eligibleCandidates(entry, search).map(row => row.id), ["33333333-3333-4333-8333-333333333333"]);
});

test("only one plausible recording reaches release validation", () => {
  assert.equal(classifySearch(entry, { recordings: [recording()] }).category, "PENDING_VALIDATION");
  assert.equal(classifySearch(entry, { recordings: [recording(), recording({ id: "66666666-6666-4666-8666-666666666666" })] }).category, "REVIEW");
  assert.equal(classifySearch(entry, { recordings: [] }).category, "UNAVAILABLE");
});

test("a unique contemporary official single release resolves duplicate search noise", () => {
  const original = recording({ releases: [release({ title: "Brass in Pocket", "release-group": { id: "22222222-2222-4222-8222-222222222222", title: "Brass in Pocket", "secondary-types": [] } })] });
  const laterDuplicate = recording({ id: "66666666-6666-4666-8666-666666666666", releases: [release({ date: "1999", title: "Hits", "release-group": { id: "77777777-7777-4777-8777-777777777777", title: "Hits", "secondary-types": ["Compilation"] } })] });
  const result = classifySearch(entry, { recordings: [original, laterDuplicate] });
  assert.equal(result.category, "PENDING_VALIDATION");
  assert.equal(result.recording.id, original.id);
});

test("source release selection prefers official UK evidence and rejects future releases", () => {
  const chosen = selectRelease(entry, recording({ releases: [release({ id: "a", country: "US", date: "1979" }), release({ id: "b", country: "GB", date: "1980" }), release({ id: "c", country: "GB", date: "1990" })] }));
  assert.equal(chosen.id, "b");
});

test("CSV contains complete evidence columns", () => {
  const csv = resultsCsv([{ ...entry, category: "SAFE", reason: "verified", candidate_evidence: [{ recording_mbid: "x" }] }]);
  assert.match(csv, /source_release_mbid/);
  assert.match(csv, /source_release_artist/);
  assert.match(csv, /candidate_evidence/);
  assert.match(csv, /recording_mbid/);
});

test("resume skips MusicBrainz but reapplies current catalogue safety checks", async () => {
  const prior = { ...entry, category: "SAFE", reason: "verified_genuinely_missing_recording", recording_mbid: "mbid", final: true };
  const mb = { get: async () => { throw new Error("must not fetch"); } };
  const result = await discoverEntry(entry, mb, { results: { "1": prior }, placeholders: { "1": { rating_rows: 1, song_occurrences: 0, musicbrainz_recording_id: null } } });
  assert.equal(result.category, "REVIEW");
  assert.equal(result.resumed, true);
});

test("a title-only fallback still requires the exact expected artist credit", async () => {
  const collaboration = { ...entry, artist: "Pretenders featuring Guest" };
  const mb = {
    searchUrl: () => "strict", fallbackSearchUrl: () => "fallback", releaseUrl: () => "release",
    get: async url => url === "strict" ? { recordings: [] } : url === "fallback" ? { recordings: [recording()] } : {}
  };
  const result = await discoverEntry(collaboration, mb, {});
  assert.equal(result.category, "UNAVAILABLE");
});

test("full discovery input parsing preserves quoted chart evidence", () => {
  const rows = parseCsv('chart_id,chart_year,artist,title\n"1","1990","Artist, The","A ""Quoted"" Song"\n');
  assert.deepEqual(rows, [{ chart_id: "1", chart_year: "1990", artist: "Artist, The", title: 'A "Quoted" Song' }]);
});

test("reconciliation rejects missing and duplicate chart rows", () => {
  assert.doesNotThrow(() => reconcileResults([{ chart_id: 1 }, { chart_id: 2 }], [{ chart_id: 1 }, { chart_id: 2 }]));
  assert.throws(() => reconcileResults([{ chart_id: 1 }, { chart_id: 1 }], [{ chart_id: 1 }, { chart_id: 1 }]), /reconciliation failed/);
  assert.throws(() => reconcileResults([{ chart_id: 1 }, { chart_id: 2 }], [{ chart_id: 1 }]), /missing=1/);
});

test("duplicate recording identities are quarantined for sequenced review", () => {
  const rows = quarantineDuplicateRecordings([
    { chart_id: 1, category: "SAFE", recording_mbid: "same" },
    { chart_id: 2, category: "SAFE", recording_mbid: "same" },
    { chart_id: 3, category: "REVIEW", recording_mbid: "same" }
  ]);
  assert.equal(rows[0].category, "SAFE");
  assert.equal(rows[1].category, "REVIEW");
  assert.match(rows[1].reason, /chart_1/);
  assert.equal(rows[2].category, "REVIEW");
});

test("summary reconciles category totals by decade and reason", () => {
  const summary = discoverySummary([
    { chart_year: 1980, category: "SAFE", reason: "verified" },
    { chart_year: 1989, category: "REVIEW", reason: "ambiguous" },
    { chart_year: 1990, category: "UNAVAILABLE", reason: "missing" }
  ]);
  assert.deepEqual(summary.totals, { SAFE: 1, REVIEW: 1, UNAVAILABLE: 1 });
  assert.deepEqual(summary.by_decade["1980s"], { SAFE: 1, REVIEW: 1, UNAVAILABLE: 0 });
  assert.equal(summary.by_reason.verified, 1);
});
