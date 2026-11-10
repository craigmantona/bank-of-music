import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [manifest, report, productionImport, script] = await Promise.all([
  readFile(new URL("../bond-007.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../supabase/operations/bond-theme-musicbrainz-review-20261110.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../supabase/operations/bond-theme-production-import-20261110.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../scripts/bond-theme-musicbrainz-audit.mjs", import.meta.url), "utf8")
]);

test("historical read-only audit covers every recording that required enrichment", () => {
  const unmatched = [...manifest.films, ...manifest.bonusTracks].filter(row => !row.catalogueTrackId);
  assert.equal(unmatched.length, 0);
  assert.equal(report.entries.length, 23);
  assert.equal(new Set(report.entries.map(row => `${row.filmYear}:${row.themeTitle}`)).size, 23);
});

test("every absent recording has MusicBrainz evidence without fabricated Spotify metadata", () => {
  assert.equal(report.summary["no-candidate"], 0);
  assert.equal(report.summary["single-strong-candidate"], 10);
  assert.equal(report.summary["manual-review"], 13);
  for (const entry of report.entries) {
    assert(entry.candidates.length > 0, `${entry.themeTitle} lacks MusicBrainz evidence`);
    for (const candidate of entry.candidates) assert.match(candidate.musicbrainzRecordingId, /^[0-9a-f-]{36}$/);
  }
  assert([...manifest.films, ...manifest.bonusTracks].every(row => row.spotifyId === ""));
});

test("Another Way to Die fallback is tied to a verified official GB release", () => {
  const entry = report.entries.find(row => row.themeTitle === "Another Way to Die");
  assert.equal(entry.recommendedMusicBrainzRecordingId, "80366c3d-8edd-4a97-95cf-6bc591d1465f");
  assert.equal(entry.candidates[0].verifiedTrack.releaseGroupId, "277fb264-5557-3557-aa66-afdebcc094fc");
  assert.equal(entry.candidates[0].releaseEvidence[0].id, "7fbd6d79-6642-414d-8820-a6bbafa1e691");
  assert.equal(entry.candidates[0].releaseEvidence[0].status, "Official");
});

test("audit cannot write to Supabase, Spotify or the catalogue", () => {
  assert.equal(report.mode, "read-only-musicbrainz-audit");
  assert.equal(report.productionWrites, 0);
  assert.doesNotMatch(script, /SUPABASE_(URL|SERVICE_ROLE_KEY)|supabaseClient|\.from\(|\.insert\(|\.upsert\(|\.update\(|spotify/i);
  assert.doesNotMatch(script, /--commit|apply_migration|execute_sql/);
});

test("active Bond manifest exposes all verified catalogue identities", () => {
  const active = [...manifest.films, ...manifest.bonusTracks];
  assert.equal(active.length, 26);
  assert(active.every(row => Number.isInteger(row.catalogueTrackId) && row.catalogueTrackId > 0));
  assert.equal(new Set(active.map(row => row.catalogueTrackId)).size, active.length);
  assert.equal(new Set(active.map(row => row.canonicalRecordingId)).size, active.length);
  assert(active.every(row => /^[0-9a-f-]{36}$/.test(row.canonicalRecordingId)));
});

test("committed import report and active manifest resolve the same real identities", () => {
  const active = [...manifest.films, ...manifest.bonusTracks];
  const reported = productionImport.tracks;
  assert.equal(productionImport.result, "success_committed");
  assert.deepEqual(productionImport.verifiedDelta, {
    albums: 1,
    songOccurrences: 26,
    canonicalRecordings: 23,
    songRatings: 0
  });
  for (const entry of active) {
    const match = reported.find(row => row.catalogueTrackId === entry.catalogueTrackId);
    assert(match, `missing import evidence for ${entry.themeTitle}`);
    assert.equal(match.canonicalRecordingId, entry.canonicalRecordingId);
  }
});
