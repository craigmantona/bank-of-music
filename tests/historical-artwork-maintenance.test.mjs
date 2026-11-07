import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { candidateFingerprint, eligibleCandidates, inspectCandidate, mergeMappings } from "../scripts/historical-artwork-maintenance.mjs";

const candidate = { releaseGroupMbid: "11111111-1111-4111-8111-111111111111",
  approvedReleaseMbids: ["22222222-2222-4222-8222-222222222222"], artist: "Artist", title: "Song" };

test("maintenance candidates are exact reviewed release identities and exclude published entries", async () => {
  const payload = JSON.parse(await readFile(new URL("../scripts/historical-artwork-maintenance-candidates.json", import.meta.url)));
  assert.equal(Object.keys(payload.entries).length, 74);
  const published = JSON.parse(await readFile(new URL("../historical-uk-number-ones-cover-art.json", import.meta.url)));
  for (const [id, entry] of Object.entries(payload.entries)) {
    assert.equal(published.entries[id], undefined);
    assert.match(entry.releaseGroupMbid, /^[0-9a-f-]{36}$/);
    assert.ok(entry.approvedReleaseMbids.length > 0);
  }
  assert.equal(payload.entries[2497], undefined, "Gracie Abrams remains excluded");
});

test("cooldowns, changed evidence and the 25-entry cap are enforced", () => {
  const candidates = { entries: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [String(index + 1), candidate])) };
  const state = { entries: { "1": { fingerprint: candidateFingerprint(candidate), nextCheckAt: "2099-01-01T00:00:00.000Z" } } };
  const result = eligibleCandidates(candidates, { entries: {} }, state, { now: new Date("2026-11-07T00:00:00Z"), limit: 25 });
  assert.equal(result.length, 25);
  assert.equal(result.some(([id]) => id === "1"), false);
});

test("only one front on an exact approved release is SAFE", async () => {
  const result = await inspectCandidate("1", candidate, async releaseMbid => ({ status: "AVAILABLE",
    fronts: [{ imageId: "123", coverUrl: `https://coverartarchive.org/release/${releaseMbid}/123-500.jpg` }] }), new Date("2026-11-07T00:00:00Z"));
  assert.equal(result.category, "SAFE");
  assert.equal(result.evidence.releaseMbid, candidate.approvedReleaseMbids[0]);
});

test("missing, inaccessible and multiple fronts never publish", async () => {
  const missing = await inspectCandidate("1", candidate, async () => ({ status: "MISSING", fronts: [] }));
  const inaccessible = await inspectCandidate("1", candidate, async () => ({ status: "INACCESSIBLE", fronts: [] }));
  const multiple = await inspectCandidate("1", candidate, async () => ({ status: "AVAILABLE", fronts: [
    { imageId: "1", coverUrl: "one" }, { imageId: "2", coverUrl: "two" }
  ] }));
  assert.equal(missing.category, "UNAVAILABLE");
  assert.equal(inaccessible.category, "REVIEW");
  assert.equal(multiple.category, "REVIEW");
});

test("published mappings can only be appended, never overwritten", () => {
  const published = { schemaVersion: 1, entries: { "1": { releaseGroupMbid: "old", coverUrl: "old" } } };
  assert.throws(() => mergeMappings(published, { "1": { releaseGroupMbid: "new", coverUrl: "new" } }), /Refusing to overwrite/);
  assert.equal(Object.keys(mergeMappings(published, { "2": { releaseGroupMbid: "new", coverUrl: "new" } }).entries).length, 2);
});

test("workflow is manual-only until explicitly activated and uses no repository secrets", async () => {
  const workflow = await readFile(new URL("../.github/workflows/historical-artwork-maintenance.yml", import.meta.url), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /# schedule:/);
  assert.doesNotMatch(workflow, /^\s+schedule:/m);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /pull-requests: write/);
});
