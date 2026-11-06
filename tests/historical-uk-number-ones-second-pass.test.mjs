import test from "node:test";
import assert from "node:assert/strict";
import { evidenceTier, quarantineSecondPassDuplicates, selectSecondPassEvidence } from "../scripts/historical-uk-number-ones-second-pass.mjs";

const entry = { chart_id: 1, chart_year: 1990, artist: "Example Artist", title: "Example Song" };
const release = (overrides = {}) => ({ id: "release", status: "Official", title: "Example Song", date: "1990-01-01", country: "GB",
  "release-group": { id: "group", title: "Example Song", "primary-type": "Single", "secondary-types": [] }, ...overrides });
const recording = (id, releases, overrides = {}) => ({ id, title: "Example Song", length: 200000,
  "artist-credit": [{ name: "Example Artist" }], releases, ...overrides });

test("evidence ranking prefers a contemporary official UK single", () => {
  assert.equal(evidenceTier(entry, release()), 0);
  assert.equal(evidenceTier(entry, release({ country: "US" })), 1);
  assert.equal(evidenceTier(entry, release({ "release-group": { id: "g", title: "Album", "primary-type": "Album", "secondary-types": [] } })), null);
});

test("live, remix, compilation and future evidence is rejected", () => {
  assert.equal(evidenceTier(entry, release({ disambiguation: "live" })), null);
  assert.equal(evidenceTier(entry, release({ "release-group": { id: "g", title: "Example Song", "primary-type": "Single", "secondary-types": ["Compilation"] } })), null);
  assert.equal(evidenceTier(entry, release({ date: "1995" })), null);
});

test("one uniquely strongest commercial recording advances", () => {
  const selected = selectSecondPassEvidence(entry, [recording("uk", [release()]), recording("album", [release({ country: "US", "release-group": { id: "a", title: "Album", "primary-type": "Album", "secondary-types": [] } })])]);
  assert.equal(selected.category, "PENDING_VALIDATION");
  assert.equal(selected.recording.id, "uk");
});

test("tied recording identities remain REVIEW", () => {
  const selected = selectSecondPassEvidence(entry, [recording("one", [release({ id: "one" })]), recording("two", [release({ id: "two" })])]);
  assert.equal(selected.category, "REVIEW");
  assert.match(selected.reason, /tied/);
});

test("album evidence requires the same recording on a contemporary official single", () => {
  const album = release({ "release-group": { id: "a", title: "Album", "primary-type": "Album", "secondary-types": [] } });
  const supportingSingle = release({ id: "support", title: "Double A-side", "release-group": { id: "s", title: "Double A-side", "primary-type": "Single", "secondary-types": [] } });
  const selected = selectSecondPassEvidence(entry, [recording("one", [album, supportingSingle]), recording("two", [release({ status: "Bootleg" })])]);
  assert.equal(selected.category, "PENDING_VALIDATION");
  assert.equal(selected.recording.id, "one");
  assert.equal(selected.tier, 2);
  assert.equal(selected.release.id, "support");
  assert.equal(selectSecondPassEvidence(entry, [recording("album-only", [album])]).category, "UNAVAILABLE");
});

test("duplicate new recordings are quarantined but existing BOM links are retained", () => {
  const rows = quarantineSecondPassDuplicates([
    { chart_id: 1, category: "SAFE", recording_mbid: "same", existing_song_id: "" },
    { chart_id: 2, category: "SAFE", recording_mbid: "same", existing_song_id: "" },
    { chart_id: 3, category: "SAFE", recording_mbid: "same", existing_song_id: 99 }
  ]);
  assert.equal(rows[0].category, "SAFE");
  assert.equal(rows[1].category, "REVIEW");
  assert.equal(rows[2].category, "SAFE");
});
