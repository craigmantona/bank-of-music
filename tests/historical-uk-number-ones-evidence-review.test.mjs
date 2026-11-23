import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  auditSnapshot,
  auditCandidateState,
  buildManifestPayload,
  candidateEvidencePayload,
  postgresJsonbText,
  SELECTED_TRACK_RISK_NOTE,
  sha256,
  snapshotRowIdentity,
  validateAudit
} from "../scripts/historical-uk-number-ones-evidence-review.mjs";

const audit = JSON.parse(await readFile(
  new URL("../supabase/operations/historical-uk-number-ones-verified-batch-2-audit-20261123.json", import.meta.url),
  "utf8"
));
const candidateStateRaw = await readFile(
  new URL("../supabase/operations/historical-uk-number-ones-verified-batch-2-live-state-20261123.json", import.meta.url)
);
const candidateState = JSON.parse(candidateStateRaw);
const applyOperation = await readFile(
  new URL("../supabase/operations/20261123_reconcile_verified_uk_number_ones_batch_2.sql", import.meta.url),
  "utf8"
);
const rollbackOperation = await readFile(
  new URL("../supabase/operations/20261123_rollback_verified_uk_number_ones_batch_2.sql", import.meta.url),
  "utf8"
);

const clone = value => structuredClone(value);

function resignAudit(value) {
  value.manifest_payload = buildManifestPayload(value);
  value.manifest_sha256 = sha256(value.manifest_payload);
  value.safety_contract.approval_gate =
    `SET bom.approved_historical_reconciliation = '20261123_uk_number_ones_verified_batch_2:${value.manifest_sha256}' before executing the operation in the same session`;
  return value;
}

test("batch-2 evidence covers all 879 unresolved entries without force matching", () => {
  validateAudit(audit);
  assert.equal(audit.status, "proposed_not_executed");
  assert.equal(audit.audit_coverage.inventory_rows_classified, 879);
  assert.deepEqual(
    {
      existing: audit.audit_coverage.verified_existing_link,
      imports: audit.audit_coverage.verified_catalogue_import,
      conflicted: audit.audit_coverage.explicit_ambiguous_or_version_conflict,
      insufficient: audit.audit_coverage.insufficient_authoritative_evidence
    },
    { existing: 1, imports: 19, conflicted: 11, insufficient: 848 }
  );
  assert.equal(audit.selection_policy.force_matching_prohibited, true);
  assert.equal(audit.safety_contract.production_execution_authorized, false);
});

test("all 20 candidates freeze three independent evidence digests and exact versions", () => {
  const ids = audit.proposed_batch.map(candidate => candidate.chart_entry.id);
  assert.deepEqual(ids, [
    2503, 2489, 2488, 2483, 2468, 2460, 2454, 2452, 2451, 2441,
    2022, 2015, 1989, 1969, 1940, 1926, 1919, 1552, 1519, 1353
  ]);
  for (const candidate of audit.proposed_batch) {
    assert.equal(candidate.musicbrainz_recording_evidence.isrc_lookup_count, 1);
    assert.equal(candidate.musicbrainz_release_evidence.matching_track_count, 1);
    assert.equal(
      candidate.musicbrainz_release_evidence.track_recording_id,
      candidate.musicbrainz_recording_evidence.recording_id
    );
    assert.equal(
      candidate.official_charts_evidence.catalogue_number,
      candidate.musicbrainz_release_evidence.track_isrc
    );
    assert.equal(candidate.evidence_sha256, sha256(candidateEvidencePayload(candidate)));
  }

  const byId = new Map(audit.proposed_batch.map(candidate => [candidate.chart_entry.id, candidate]));
  assert.equal(byId.get(1969).musicbrainz_recording_evidence.disambiguation, "clean");
  assert.match(byId.get(1552).musicbrainz_recording_evidence.title, /UK radio edit/);
  assert.equal(byId.get(1926).musicbrainz_release_evidence.release_id, "75f43353-fbe4-41b5-9ee8-c8c562e00480");
  assert.equal(byId.get(2488).musicbrainz_release_evidence.release_id, "579fd7f8-0791-424a-a1e2-2e60518d9709");
  assert.equal(byId.get(2454).musicbrainz_release_evidence.release_id, "ec1c27e7-768d-4458-a73f-03503fe2bfd5");
  assert.equal(byId.get(2441).musicbrainz_release_evidence.release_id, "1fb7517b-2fb9-40ec-910f-0a3a514fb70c");
});

test("every multi-track import has a signed selected-track disclosure", () => {
  const selectedTrackImports = audit.proposed_batch.filter(candidate =>
    candidate.action === "import_verified"
      && candidate.musicbrainz_release_evidence.release_track_count > 1
  );
  assert.deepEqual(
    selectedTrackImports.map(candidate => candidate.chart_entry.id),
    [2503, 2489, 2441, 2015, 1940, 1552, 1353]
  );
  assert.deepEqual(
    audit.selection_policy.selected_track_import_chart_entry_ids,
    selectedTrackImports.map(candidate => candidate.chart_entry.id)
  );
  for (const candidate of selectedTrackImports) {
    assert.ok(candidate.risk_notes.includes(SELECTED_TRACK_RISK_NOTE));
  }

  const missingRisk = clone(audit);
  missingRisk.proposed_batch.find(candidate => candidate.chart_entry.id === 2489).risk_notes = [];
  resignAudit(missingRisk);
  assert.throws(
    () => validateAudit(missingRisk),
    /selected-track risk disclosure missing for chart entry 2489/
  );

  const incompleteDisclosure = clone(audit);
  incompleteDisclosure.selection_policy.selected_track_import_chart_entry_ids =
    incompleteDisclosure.selection_policy.selected_track_import_chart_entry_ids
      .filter(chartEntryId => chartEntryId !== 2489);
  resignAudit(incompleteDisclosure);
  assert.throws(
    () => validateAudit(incompleteDisclosure),
    /selected-track disclosure IDs must match every multi-track import/
  );

  const incompleteReleaseNote = clone(audit);
  incompleteReleaseNote.selection_policy.source_release_note =
    incompleteReleaseNote.selection_policy.source_release_note.replace("Too Sweet, ", "");
  resignAudit(incompleteReleaseNote);
  assert.throws(
    () => validateAudit(incompleteReleaseNote),
    /selected-track release note must name every multi-track import/
  );
});

test("Umbrella alone reuses an exact BOM identity and stored credit is preserved", () => {
  const existing = audit.proposed_batch.filter(candidate => candidate.action === "link_existing");
  assert.equal(existing.length, 1);
  assert.equal(existing[0].chart_entry.id, 1519);
  assert.deepEqual(existing[0].target, {
    song_id: 11020,
    canonical_id: "c7f9abc5-7fd7-483b-b557-6c32ed716db5",
    album_id: 816,
    stored_title: "Umbrella",
    stored_artist: "Rihanna",
    track_position: 1,
    duration_ms: null
  });
});

test("ambiguous and historically unsafe versions remain explicit holds", () => {
  const holds = new Map(audit.rejected_version_leads.map(entry => [entry.chart_entry_id, entry.reason_code]));
  assert.equal(holds.get(107), "album_version_postdates_number_one_without_contemporaneous_bridge");
  assert.equal(holds.get(45), "contemporary_uk_single_uses_different_radio_edit_recording");
  assert.equal(holds.get(1959), "stored_isrc_belongs_to_different_artist_version");
  assert.equal(holds.get(2491), "isrc_maps_music_video_not_audio_single");
  assert.equal(holds.get(1996), "isrc_maps_multiple_recordings");
});

test("manifest digest rejects any evidence or operational mutation", () => {
  assert.deepEqual(audit.manifest_payload, buildManifestPayload(audit));
  assert.equal(audit.manifest_sha256, sha256(audit.manifest_payload));

  const evidenceMutation = clone(audit);
  evidenceMutation.proposed_batch[0].official_charts_evidence.catalogue_number = "USUG12504305";
  assert.throws(() => validateAudit(evidenceMutation), /Expected values to be strictly equal/);

  const operationMutation = clone(audit);
  operationMutation.proposed_batch[0].target.duration_ms += 1;
  assert.throws(() => validateAudit(operationMutation), /strictly equal/);

  const evidenceDescriptionMutation = clone(audit);
  evidenceDescriptionMutation.proposed_batch[8].musicbrainz_recording_evidence.disambiguation = "clean";
  assert.throws(() => validateAudit(evidenceDescriptionMutation), /strictly equal/);

  const riskMutation = clone(audit);
  riskMutation.proposed_batch[0].risk_notes = [];
  assert.throws(() => validateAudit(riskMutation), /selected-track risk disclosure missing/);

  const safetyMutation = clone(audit);
  safetyMutation.safety_contract.production_execution_authorized = true;
  assert.throws(() => validateAudit(safetyMutation), /strictly deep-equal/);
});

function syntheticSnapshot() {
  const rows = audit.proposed_batch.map(candidate => ({
    id: candidate.chart_entry.id,
    source_entry_key: candidate.chart_entry.source_entry_key,
    chart_year: candidate.chart_entry.chart_year,
    title: candidate.chart_entry.title,
    artist: candidate.chart_entry.artist,
    source_revision: candidate.chart_entry.source_revision,
    canonical_song_id: candidate.chart_entry.placeholder_canonical_id,
    match_status: "unresolved",
    song_id: null,
    musicbrainz_recording_id: null
  }));
  const used = new Set(rows.map(row => row.id));
  for (const hold of audit.rejected_version_leads) {
    rows.push({
      id: hold.chart_entry_id,
      source_entry_key: `hold:${hold.chart_entry_id}`,
      canonical_song_id: `00000000-0000-4000-8000-${String(hold.chart_entry_id).padStart(12, "0")}`,
      match_status: "unresolved",
      song_id: null,
      musicbrainz_recording_id: null
    });
    used.add(hold.chart_entry_id);
  }
  for (let id = 100000; rows.length < 879; id += 1) {
    if (used.has(id)) continue;
    rows.push({
      id,
      source_entry_key: `insufficient:${id}`,
      canonical_song_id: `00000000-0000-4000-8001-${String(id).padStart(12, "0")}`,
      match_status: "unresolved",
      song_id: null,
      musicbrainz_recording_id: null
    });
  }
  const canonicalPlaceholders = Object.fromEntries(audit.proposed_batch.map(candidate => [
    candidate.chart_entry.placeholder_canonical_id,
    {
      title: candidate.chart_entry.title,
      artist: candidate.chart_entry.artist,
      origin_key: `quick-rate:uk-number-ones:${candidate.chart_entry.source_entry_key}`,
      chart_references: 1,
      song_occurrences: 0,
      canonical_rating_rows: 0,
      historical_rating_rows: 0,
      musicbrainz_recording_id: null
    }
  ]));
  return {
    rows,
    canonical_placeholders: canonicalPlaceholders,
    integrity: {
      ...audit.snapshot.production_integrity,
      reconciliation_audit_rows: audit.snapshot.production_integrity.first_batch_rating_reconciliation_audit_rows
    }
  };
}

test("snapshot audit is deterministic and fails closed on stale rows", () => {
  const snapshot = syntheticSnapshot();
  const syntheticAudit = clone(audit);
  syntheticAudit.snapshot.row_identity_sha256 = sha256(snapshotRowIdentity(snapshot));
  syntheticAudit.manifest_payload = buildManifestPayload(syntheticAudit);
  syntheticAudit.manifest_sha256 = sha256(syntheticAudit.manifest_payload);
  syntheticAudit.safety_contract.approval_gate =
    `SET bom.approved_historical_reconciliation = '20261123_uk_number_ones_verified_batch_2:${syntheticAudit.manifest_sha256}' before executing the operation in the same session`;

  const result = auditSnapshot(snapshot, syntheticAudit);
  assert.equal(result.audited_rows, 879);
  assert.deepEqual(result.classification, {
    verified_existing_link: 1,
    verified_catalogue_import: 19,
    explicit_ambiguous_or_version_conflict: 11,
    insufficient_authoritative_evidence: 848
  });

  snapshot.rows.find(row => row.id === 2503).match_status = "direct_mbid";
  assert.throws(() => auditSnapshot(snapshot, syntheticAudit), /row_identity|strictly equal/i);
});

test("candidate-state evidence binds stale fingerprints, zero collisions and Umbrella target", () => {
  assert.equal(sha256(candidateStateRaw), audit.snapshot.candidate_state_sha256);
  assert.deepEqual(auditCandidateState(candidateState, audit), { checked_candidates: 20 });
  assert.equal(
    postgresJsonbText({ longer: [true, null, "value"], a: 1 }),
    '{"a": 1, "longer": [true, null, "value"]}'
  );

  const staleMutation = clone(candidateState);
  staleMutation.candidates[0].stale_state_fingerprint.chart_updated_at = "2026-11-23T00:00:00Z";
  assert.throws(() => auditCandidateState(staleMutation, audit), /strictly deep-equal/);

  const chartSourceMutation = clone(candidateState);
  chartSourceMutation.candidates[0].source_rows.chart_source_metadata.source_number = 999999;
  assert.throws(() => auditCandidateState(chartSourceMutation, audit), /chart source metadata drift/);

  const canonicalSourceMutation = clone(candidateState);
  canonicalSourceMutation.candidates[0].source_rows.canonical_source_metadata.match_status = "matched";
  assert.throws(() => auditCandidateState(canonicalSourceMutation, audit), /canonical source metadata drift/);

  const collisionMutation = clone(candidateState);
  collisionMutation.candidates[1].catalogue_collision.song_recording_rows = 1;
  assert.throws(() => auditCandidateState(collisionMutation, audit), /strictly deep-equal/);

  const targetMutation = clone(candidateState);
  targetMutation.candidates.find(candidate => candidate.chart_entry.id === 1519).existing_target.song.artist =
    "Rihanna featuring Jay-Z";
  assert.throws(() => auditCandidateState(targetMutation, audit), /strictly deep-equal/);
});

test("reviewed SQL is bound byte-for-byte to the signed candidate manifest and approval token", () => {
  const embedded = applyOperation.match(/\$batch_manifest\$([\s\S]*?)\$batch_manifest\$::text/);
  assert.ok(embedded, "apply operation must contain one parseable embedded manifest");
  assert.deepEqual(JSON.parse(embedded[1]), audit.manifest_payload);
  assert.equal(sha256(embedded[1]), audit.manifest_sha256);
  assert.match(applyOperation, /extensions\.digest\([\s\S]*signed_manifest\.payload/);
  assert.match(applyOperation, /verified_manifest\.payload::jsonb\)->'candidates'/);
  assert.match(
    applyOperation,
    /extensions\.digest\([\s\S]*split_part\([\s\S]*current_setting\('bom\.approved_historical_reconciliation'/
  );

  const approvalToken = `20261123_uk_number_ones_verified_batch_2:${audit.manifest_sha256}`;
  assert.match(applyOperation, /current_setting\('bom\.approved_historical_reconciliation', true\)/);
  assert.match(rollbackOperation, /'bom\.approved_historical_reconciliation_rollback'/);
  assert.equal(applyOperation.includes(approvalToken), true);
  assert.equal(rollbackOperation.includes(approvalToken), true);
  assert.equal(applyOperation.split(audit.manifest_sha256).length - 1, 1);
  assert.equal(rollbackOperation.split(audit.manifest_sha256).length - 1, 1);
  assert.doesNotMatch(applyOperation, /set_config\s*\(/i);
  assert.doesNotMatch(rollbackOperation, /set_config\s*\(/i);

  for (const sql of [applyOperation, rollbackOperation]) {
    assert.match(sql, /^begin;/);
    assert.match(sql, /order by lock_key/);
    assert.match(sql, /pg_advisory_xact_lock/);
    assert.match(sql, /lock table public\.song_ratings in share row exclusive mode/);
    assert.match(sql, /lock table private\.historical_chart_reconciliation_operation_audit/);
    assert.match(sql, /commit;\s*$/);
  }
});
