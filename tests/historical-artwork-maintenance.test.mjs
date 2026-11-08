import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { candidateFingerprint, createCoverRequester, eligibleCandidates, inspectCandidate, mergeMappings,
  networkErrorDetail, normalizeCoverUrl, processQueue, reportMarkdown } from "../scripts/historical-artwork-maintenance.mjs";

const candidate = { releaseGroupMbid: "11111111-1111-4111-8111-111111111111",
  approvedReleaseMbids: ["22222222-2222-4222-8222-222222222222"], artist: "Artist", title: "Song" };
const clock = () => { let value = 0; return () => (value += 2000); };
const noWait = async () => {};
const response = (status, body = { images: [] }) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test("maintenance candidates are exact reviewed release identities and exclude published entries", async () => {
  const payload = JSON.parse(await readFile(new URL("../scripts/historical-artwork-maintenance-candidates.json", import.meta.url)));
  assert.equal(Object.keys(payload.entries).length, 73);
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

test("a network exception on the first request is retried and remains REVIEW", async () => {
  let calls = 0;
  const request = createCoverRequester({ fetchImpl: async () => { calls += 1; const error = new TypeError("fetch failed");
    error.cause = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }); throw error; },
    sleepImpl: noWait, now: clock(), timeout: () => undefined });
  const result = await inspectCandidate("1", candidate, request);
  assert.equal(calls, 3);
  assert.equal(result.category, "REVIEW");
  assert.match(result.failureReasons[0], /ENOTFOUND/);
});

test("timeouts and temporary server failures remain retryable", async () => {
  const timeoutError = Object.assign(new Error("request timed out"), { name: "TimeoutError", code: "UND_ERR_CONNECT_TIMEOUT" });
  const timeoutRequest = createCoverRequester({ fetchImpl: async () => { throw timeoutError; }, sleepImpl: noWait, now: clock(), timeout: () => undefined });
  const timeoutResult = await timeoutRequest(candidate.approvedReleaseMbids[0]);
  assert.equal(timeoutResult.status, "INACCESSIBLE");
  assert.match(timeoutResult.failureReason, /UND_ERR_CONNECT_TIMEOUT/);
  let serverCalls = 0;
  const serverRequest = createCoverRequester({ fetchImpl: async () => { serverCalls += 1; return response(503); },
    sleepImpl: noWait, now: clock(), timeout: () => undefined });
  const serverResult = await serverRequest(candidate.approvedReleaseMbids[0]);
  assert.equal(serverCalls, 3);
  assert.equal(serverResult.status, "INACCESSIBLE");
  assert.match(serverResult.failureReason, /http_503/);
});

test("a global outage opens the circuit after independent failures", async () => {
  let calls = 0;
  const request = createCoverRequester({ fetchImpl: async () => { calls += 1; throw new TypeError("fetch failed"); },
    sleepImpl: noWait, now: clock(), timeout: () => undefined, outageThreshold: 2 });
  await request("22222222-2222-4222-8222-222222222222");
  await request("33333333-3333-4333-8333-333333333333");
  const stopped = await request("44444444-4444-4444-8444-444444444444");
  assert.equal(calls, 6);
  assert.equal(stopped.failureReason, "cover_service_circuit_open");
  assert.equal(request.metrics().circuitOpen, true);
});

test("a successful response following a transient failure is accepted", async () => {
  let calls = 0;
  const request = createCoverRequester({ fetchImpl: async () => {
    calls += 1; if (calls === 1) throw new TypeError("temporary connection failure");
    return response(200, { images: [{ id: 123, front: true, approved: true, thumbnails: { "500": "https://example.test/front.jpg" } }] });
  }, sleepImpl: noWait, now: clock(), timeout: () => undefined });
  const result = await inspectCandidate("1", candidate, request);
  assert.equal(calls, 2);
  assert.equal(result.category, "SAFE");
  assert.equal(result.mapping.coverUrl, "https://example.test/front.jpg");
});

test("Cover Art Archive URLs are normalized to HTTPS and other insecure URLs are rejected", async () => {
  assert.equal(normalizeCoverUrl("http://coverartarchive.org/release/example/front.jpg"),
    "https://coverartarchive.org/release/example/front.jpg");
  assert.throws(() => normalizeCoverUrl("http://example.test/front.jpg"), /Refusing non-HTTPS artwork URL/);
  const request = createCoverRequester({ fetchImpl: async () => response(200, { images: [{ id: 123, front: true,
    approved: true, thumbnails: { "500": "http://coverartarchive.org/release/example/front.jpg" } }] }),
    sleepImpl: noWait, now: clock(), timeout: () => undefined });
  const result = await inspectCandidate("1", candidate, request);
  assert.equal(result.mapping.coverUrl, "https://coverartarchive.org/release/example/front.jpg");
});

test("multiple failed entries checkpoint state and still produce a valid report", async () => {
  const state = { schemaVersion: 1, entries: {} }, checkpoints = [];
  const queue = [["1", candidate], ["2", { ...candidate, title: "Another song" }]];
  const progress = await processQueue(queue, state, async () => ({ status: "INACCESSIBLE", fronts: [], failureReason: "tls_failure" }),
    new Date("2026-11-08T00:00:00Z"), snapshot => checkpoints.push(JSON.parse(JSON.stringify(snapshot))));
  assert.equal(progress.review.length, 2);
  assert.equal(Object.keys(state.entries).length, 2);
  assert.equal(checkpoints.length, 2);
  const report = { checked: 2, successfulChecks: 0, retryableErrors: 2, newlyVerified: [], review: progress.review,
    unavailable: [], staticMappingCount: 354, remainingPlaceholders: 531 };
  assert.doesNotThrow(() => JSON.stringify(report));
  assert.match(reportMarkdown(report), /Retryable errors: 2/);
  assert.match(reportMarkdown(report), /tls_failure/);
});

test("network error details retain nested transport causes", () => {
  const cause = Object.assign(new Error("certificate rejected"), { code: "CERT_HAS_EXPIRED" });
  assert.match(networkErrorDetail(new TypeError("fetch failed", { cause })), /CERT_HAS_EXPIRED/);
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
  assert.match(workflow, /Upload review report[\s\S]+if: always\(\)/);
  const script = await readFile(new URL("../scripts/historical-artwork-maintenance.mjs", import.meta.url), "utf8");
  assert.ok(script.indexOf("saveProgress({});") < script.indexOf("await processQueue"), "fallback reports exist before network checks");
});
