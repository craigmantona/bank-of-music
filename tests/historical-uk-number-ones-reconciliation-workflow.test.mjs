import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildReviewPlan, classifyFullScan, compactSnapshot, digest, exclusionRegistryDigest, historicalExclusion,
  resumableQueue, rowFingerprint, stableJson, summarise, validateIndependentEvidence, validateReviewPlan
} from "../scripts/historical-uk-number-ones-reconciliation-workflow.mjs";

const row = (overrides = {}) => ({
  id: 1, collection_key: "uk-number-ones", source_entry_key: "2015:1:artist:song", chart_year: 2015,
  title: "Song", artist: "Artist", song_id: null, canonical_song_id: "11111111-1111-4111-8111-111111111111",
  musicbrainz_recording_id: null, canonical_recording_id: null, match_status: "unresolved",
  updated_at: "2026-01-01T00:00:00Z", canonical_updated_at: "2026-01-01T00:00:00Z",
  canonical_rating_rows: 0, historical_rating_rows: 0, song_occurrences: 0, chart_reference_rows: 1,
  isrc: "USAAA1500001", source_metadata: { isrcs: ["USAAA1500001"] }, ...overrides
});

const evidence = (overrides = {}) => ({
  status: "independently_verified", title: "Song", artist: "Artist", action: "safe_import",
  official_charts_url: "https://www.officialcharts.com/songs/artist-song/", official_charts_isrc: "USAAA1500001",
  recording_mbid: "11111111-1111-4111-8111-111111111112",
  musicbrainz_recording_url: "https://musicbrainz.org/recording/11111111-1111-4111-8111-111111111112",
  recording_isrcs: ["USAAA1500001"], release_mbid: "11111111-1111-4111-8111-111111111113",
  musicbrainz_release_url: "https://musicbrainz.org/release/11111111-1111-4111-8111-111111111113",
  release_group_mbid: "11111111-1111-4111-8111-111111111114", release_status: "Official",
  track_position: 1, track_recording_mbid: "11111111-1111-4111-8111-111111111112",
  release_recording_occurrences: 1, release_track_count: 1, duration_ms: 212000,
  version_notes: "Original studio recording; no remix, live or cover indicators.",
  risk_notes: "Single-track official release.",
  recording_selection: {
    basis: "single_exact_title_artist_recording",
    isrc_candidate_recording_mbids: ["11111111-1111-4111-8111-111111111112"],
    exact_release_validated_recording_mbids: ["11111111-1111-4111-8111-111111111112"],
    rejected_recording_candidates: []
  }, ...overrides
});

const exclusionRegistry = (overrides = {}) => ({
  schema_version: 1, policy: "fail_closed_until_exact_evidence_is_independently_approved",
  entries: [{ chart_row_id: 1, source_entry_key: row().source_entry_key, title: "Song", artist: "Artist",
    reason_code: "isrc_maps_multiple_recordings", approved_overrides: [], ...overrides }]
});

test("stable digests and row fingerprints are deterministic", () => {
  assert.equal(stableJson({ b: 2, a: 1 }), stableJson({ a: 1, b: 2 }));
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  assert.equal(rowFingerprint(row()), rowFingerprint({ ...row() }));
});

test("only a complete independent evidence contract qualifies", () => {
  assert.deepEqual(validateIndependentEvidence(row(), evidence()), []);
  const [verified] = classifyFullScan({ rows: [row()] }, { evidence: { "1": evidence() } });
  assert.equal(verified.category, "VERIFIED_IMPORT");
  assert.equal(summarise([verified]).verified_total, 1);
});

test("selected-track imports require explicit risk disclosure", () => {
  const failures = validateIndependentEvidence(row(), evidence({ release_track_count: 4, risk_notes: "" }));
  assert.ok(failures.includes("selected_track_risk_not_disclosed"));
  assert.deepEqual(validateIndependentEvidence(row(), evidence({ release_track_count: 4, risk_notes: "Selected-track import: track 1 only from a four-track official release." })), []);
});

test("multiple ISRC recordings require exactly one independently release-validated identity", () => {
  const ambiguous = evidence({ recording_selection: {
    basis: "unique_exact_release_evidence",
    isrc_candidate_recording_mbids: [evidence().recording_mbid, "22222222-2222-4222-8222-222222222222"],
    exact_release_validated_recording_mbids: [evidence().recording_mbid, "22222222-2222-4222-8222-222222222222"],
    rejected_recording_candidates: []
  } });
  assert.ok(validateIndependentEvidence(row(), ambiguous).includes("unique_exact_release_recording_not_proven"));
});

test("historical identity exclusions fail closed and require a digest-bound independent approval", () => {
  const registry = exclusionRegistry();
  const [excluded] = classifyFullScan({ rows: [row()] }, { evidence: { "1": evidence() }, exclusionRegistry: registry });
  assert.equal(excluded.category, "UNRESOLVED");
  assert.equal(excluded.reason, "historical_identity_conflict_excluded:isrc_maps_multiple_recordings");
  assert.equal(historicalExclusion(row(), evidence(), registry).entry.chart_row_id, 1);

  const approved = exclusionRegistry({ approved_overrides: [{
    status: "independently_approved", recording_mbid: evidence().recording_mbid,
    evidence_sha256: digest(evidence()), approved_by: "independent-reviewer", approved_at: "2026-11-24T12:00:00Z",
    approval_reference: "review:exact-version-evidence"
  }] });
  const [qualified] = classifyFullScan({ rows: [row()] }, { evidence: { "1": evidence() }, exclusionRegistry: approved });
  assert.equal(qualified.category, "VERIFIED_IMPORT");
  const tamperedEvidence = evidence({ duration_ms: 213000 });
  const [tampered] = classifyFullScan({ rows: [row()] }, { evidence: { "1": tamperedEvidence }, exclusionRegistry: approved });
  assert.equal(tampered.category, "UNRESOLVED");
  assert.match(tampered.reason, /^historical_identity_conflict_excluded:/);
  assert.match(exclusionRegistryDigest(registry), /^[0-9a-f]{64}$/);
});

test("rating, identity, ISRC, exact-track and release failures fail closed", () => {
  const cases = [
    [row({ canonical_rating_rows: 1 }), evidence()],
    [row(), evidence({ official_charts_isrc: "GBBBB1500001" })],
    [row(), evidence({ track_recording_mbid: "22222222-2222-4222-8222-222222222222" })],
    [row(), evidence({ release_recording_occurrences: 2 })],
    [row(), evidence({ release_status: "Bootleg" })]
  ];
  for (const [source, reviewed] of cases) {
    const [result] = classifyFullScan({ rows: [source] }, { evidence: { "1": reviewed } });
    assert.equal(result.category, "UNRESOLVED");
  }
});

test("duplicate recording identities are quarantined together", () => {
  const second = row({ id: 2, source_entry_key: "2015:2:artist:song", canonical_song_id: "22222222-2222-4222-8222-222222222221" });
  const scan = classifyFullScan({ rows: [row(), second] }, { evidence: { "1": evidence(), "2": evidence() } });
  assert.ok(scan.every(result => result.category === "UNRESOLVED"));
  assert.ok(scan.every(result => result.reason === "duplicate_recording_identity_across_chart_rows"));
});

test("every unresolved row is retained with a reason and prior evidence is reused", () => {
  const rows = [row(), row({ id: 2, isrc: null, source_metadata: { isrcs: [] } })];
  const priorStates = [{ results: { "2": { final: true, reason: "multiple_versions_remain_tied", candidate_evidence: [{ recording_mbid: "x" }] } } }];
  const scan = classifyFullScan({ rows }, { priorStates });
  assert.equal(scan.length, 2);
  assert.match(scan[1].reason, /^existing_research_exhausted:/);
  assert.equal(scan[1].prior_candidate_count, 1);
});

test("production snapshots are compacted without dropping stale-state or rating guards", () => {
  const source = row({ source_metadata: { isrcs: ["USAAA1500001"], bulky_unused_value: "x".repeat(1000) } });
  const compact = compactSnapshot({ schema_version: 1, captured_at: "now", project_id: "project", read_only: true, production_integrity: {}, rows: [source] });
  assert.equal(compact.rows[0].source_metadata, undefined);
  assert.deepEqual(compact.rows[0].source_isrcs, ["USAAA1500001"]);
  assert.equal(compact.rows[0].canonical_rating_rows, 0);
  assert.equal(compact.rows[0].updated_at, source.updated_at);
});

test("review plan is per-record, digest-bound, resumable and never executable", () => {
  const snapshot = { rows: [row()] };
  const scan = classifyFullScan(snapshot, { evidence: { "1": evidence() } });
  const plan = buildReviewPlan(scan, snapshot);
  assert.equal(plan.executable, false);
  assert.equal(plan.production_authorized, false);
  assert.equal(plan.max_in_flight, 1);
  assert.equal(plan.records.length, 1);
  assert.equal(plan.records[0].approval_state, "not_approved");
  assert.equal(plan.records[0].safety_contract.preserve_all_ratings, true);
  assert.equal(plan.records[0].safety_contract.separate_digest_bound_rollback, true);
  assert.equal(plan.records[0].safety_contract.resume_from_immutable_audit, true);
  assert.deepEqual(validateReviewPlan(plan, scan, snapshot), []);
  const tampered = structuredClone(plan);
  tampered.records[0].mutation_payload.track_position = 99;
  assert.ok(validateReviewPlan(tampered, scan, snapshot).includes("record_envelope_mismatch"));
});

test("resume skips one verified record and fails closed on audit conflicts", () => {
  const snapshot = { rows: [row()] };
  const scan = classifyFullScan(snapshot, { evidence: { "1": evidence() } });
  const plan = buildReviewPlan(scan, snapshot);
  const record = plan.records[0];
  assert.equal(resumableQueue(plan, []).pending.length, 1);
  assert.equal(resumableQueue(plan, [{ operation_key: record.operation_key, manifest_sha256: record.manifest_sha256, status: "verified" }]).pending.length, 0);
  const conflict = resumableQueue(plan, [{ operation_key: record.operation_key, manifest_sha256: "0".repeat(64), status: "verified" }]);
  assert.equal(conflict.pending.length, 0);
  assert.deepEqual(conflict.failures, [`${record.operation_key}:immutable_audit_digest_conflict`]);
});

test("the command rejects every write mode before reading inputs", () => {
  const script = fileURLToPath(new URL("../scripts/historical-uk-number-ones-reconciliation-workflow.mjs", import.meta.url));
  for (const flag of ["--commit", "--execute", "--apply", "--production"]) {
    const result = spawnSync(process.execPath, [script, flag], { encoding: "utf8", env: {} });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Read-only reconciliation rejects/);
    assert.doesNotMatch(result.stderr, /snapshot.*required/i);
  }
});

test("the committed active scan reports and safely classifies every one of the 819 live rows exactly once", async () => {
  const load = async name => JSON.parse(await readFile(new URL(`../supabase/operations/${name}`, import.meta.url), "utf8"));
  const snapshot = await load("historical-uk-number-ones-reconciliation-scan-live-state-20261124.json");
  const report = await load("historical-uk-number-ones-scalable-scan-report-20261124.json");
  const summary = await load("historical-uk-number-ones-scalable-scan-summary-20261124.json");
  const plan = await load("historical-uk-number-ones-scalable-review-plan-20261124.json");
  const activeEvidence = await load("historical-uk-number-ones-active-verified-evidence-20261124.json");
  const activeFailures = await load("historical-uk-number-ones-active-failures-20261124.json");
  const activeState = await load("historical-uk-number-ones-active-evidence-state-20261124.json");
  const exclusions = await load("historical-uk-number-ones-identity-exclusions.json");
  const authoritative = await load("historical-uk-number-ones-authoritative-chart-evidence.json");
  const priorAudits = await Promise.all([
    "historical-uk-number-ones-verified-batch-2-audit-20261123.json",
    "historical-uk-number-ones-verified-batch-3-audit-20261124.json",
    "historical-uk-number-ones-verified-batch-4-audit-20261124.json"
  ].map(load));
  assert.equal(snapshot.read_only, true);
  assert.equal(snapshot.rows.length, 819);
  assert.equal(report.read_only, true);
  assert.equal(report.results.length, 819);
  assert.equal(new Set(report.results.map(result => result.chart_row_id)).size, 819);
  assert.ok(report.results.every(result => result.category === "UNRESOLVED" ? Boolean(result.reason) :
    ["VERIFIED_EXISTING", "VERIFIED_IMPORT"].includes(result.category) && Boolean(result.evidence)));
  assert.equal(exclusions.entries.length, 15);
  const documentedIds = new Set(priorAudits.flatMap(audit => audit.rejected_version_leads || []).map(entry => entry.chart_entry_id));
  for (const [id, entry] of Object.entries(authoritative.entries)) if (entry.status === "identity_conflict") documentedIds.add(Number(id));
  assert.deepEqual(exclusions.entries.map(entry => entry.chart_row_id).sort((a, b) => a - b), [...documentedIds].sort((a, b) => a - b));
  const blockedRecordingMbids = exclusions.entries.flatMap(entry => entry.blocked_recording_mbids || []);
  assert.equal(blockedRecordingMbids.length, 7);
  assert.ok(Object.values(activeEvidence.entries).every(entry => !blockedRecordingMbids.includes(entry.recording_mbid)));
  assert.equal(Object.keys(activeEvidence.entries).length, 85);
  assert.equal(activeFailures.failures.length, 734);
  assert.equal(Object.keys(activeState.results).length, 819);
  assert.equal(activeState.exclusion_registry_sha256, summary.exclusion_registry_sha256);
  assert.ok(Object.values(activeState.results).every(result => result.final === true));
  assert.ok(Object.values(activeEvidence.entries).every(entry =>
    entry.recording_selection?.exact_release_validated_recording_mbids?.length === 1 &&
    entry.recording_selection.exact_release_validated_recording_mbids[0] === entry.recording_mbid));
  assert.equal(Object.values(activeEvidence.entries).filter(entry =>
    entry.recording_selection.isrc_candidate_recording_mbids.length > 1).length, 26);
  assert.equal(Object.values(activeState.results).filter(result =>
    result.reason === "musicbrainz_isrc_has_multiple_exact_release_recordings").length, 6);
  assert.equal(summary.verified_existing, 3);
  assert.equal(summary.verified_imports, 68);
  assert.equal(summary.verified_total, 71);
  assert.equal(summary.unresolved, 748);
  assert.equal(summary.historically_excluded, 15);
  assert.equal(summary.prior_evidence_rows_reused, 576);
  assert.equal(plan.production_authorized, false);
  assert.equal(plan.records.length, 71);
  assert.ok(plan.records.every(record => record.preconditions.canonical_rating_rows === 0 &&
    record.preconditions.historical_rating_rows === 0 && record.safety_contract.preserve_all_ratings === true));
});
