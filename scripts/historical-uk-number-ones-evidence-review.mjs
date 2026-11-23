#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export const SELECTED_TRACK_RISK_NOTE =
  "Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted.";

export const sha256 = value => createHash("sha256")
  .update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value))
  .digest("hex");

function compareJsonbKeys(left, right) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length - rightBytes.length || Buffer.compare(leftBytes, rightBytes);
}

export function postgresJsonbText(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Postgres jsonb source metadata numbers must be safe integers");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(postgresJsonbText).join(", ")}]`;
  }
  if (typeof value === "object") {
    const fields = Object.keys(value)
      .sort(compareJsonbKeys)
      .map(key => `${JSON.stringify(key)}: ${postgresJsonbText(value[key])}`);
    return `{${fields.join(", ")}}`;
  }
  throw new TypeError(`Unsupported Postgres jsonb source metadata value: ${typeof value}`);
}

export const postgresJsonbSha256 = value => sha256(postgresJsonbText(value));

export function candidateEvidencePayload(candidate) {
  return {
    chart_entry_id: candidate.chart_entry.id,
    official_charts_evidence: candidate.official_charts_evidence,
    musicbrainz_recording_evidence: candidate.musicbrainz_recording_evidence,
    musicbrainz_release_evidence: candidate.musicbrainz_release_evidence
  };
}

export function buildManifestPayload(audit) {
  const { approval_gate: _approvalGate, ...signedSafetyContract } = audit.safety_contract;
  return {
    operation_key: "20261123_uk_number_ones_verified_batch_2",
    snapshot: audit.snapshot,
    audit_coverage: audit.audit_coverage,
    selection_policy: audit.selection_policy,
    candidates: audit.proposed_batch.map(candidate => ({
      action: candidate.action,
      chart_entry: candidate.chart_entry,
      stale_state_fingerprint: candidate.stale_state_fingerprint,
      target: candidate.target,
      isrc: candidate.official_charts_evidence.catalogue_number,
      recording_id: candidate.musicbrainz_recording_evidence.recording_id,
      release_id: candidate.musicbrainz_release_evidence.release_id,
      release_group_id: candidate.musicbrainz_release_evidence.release_group_id,
      album_title: candidate.musicbrainz_release_evidence.title,
      album_artist: candidate.musicbrainz_release_evidence.artist_credit,
      release_date: candidate.musicbrainz_release_evidence.release_date,
      country: candidate.musicbrainz_release_evidence.country,
      release_track_count: candidate.musicbrainz_release_evidence.release_track_count,
      evidence_sha256: candidate.evidence_sha256,
      risk_notes: candidate.risk_notes
    })),
    rejected_version_leads: audit.rejected_version_leads,
    reviewed_incomplete_leads: audit.reviewed_incomplete_leads,
    expected_deltas: audit.expected_deltas,
    proposed_result: audit.proposed_result,
    safety_contract: signedSafetyContract
  };
}

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

export function validateAudit(audit) {
  assert.equal(audit.schema_version, 3);
  assert.equal(audit.status, "proposed_not_executed");
  assert.equal(Object.hasOwn(audit, "executed_at"), false);
  assert.match(audit.snapshot.raw_snapshot_sha256, SHA256);
  assert.match(audit.snapshot.row_identity_sha256, SHA256);
  assert.equal(
    audit.snapshot.candidate_state_artifact,
    "historical-uk-number-ones-verified-batch-2-live-state-20261123.json"
  );
  assert.match(audit.snapshot.candidate_state_sha256, SHA256);

  const coverage = audit.audit_coverage;
  assert.equal(coverage.inventory_rows_classified, 879);
  assert.equal(
    coverage.verified_existing_link
      + coverage.verified_catalogue_import
      + coverage.explicit_ambiguous_or_version_conflict
      + coverage.insufficient_authoritative_evidence,
    coverage.inventory_rows_classified
  );
  assert.equal(
    coverage.reviewed_but_not_selected,
    audit.rejected_version_leads.length + audit.reviewed_incomplete_leads.length
  );
  assert.equal(
    coverage.remaining_inventory_without_a_complete_evidence_chain,
    coverage.insufficient_authoritative_evidence - audit.reviewed_incomplete_leads.length
  );

  const batch = audit.proposed_batch;
  assert.ok(batch.length >= audit.selection_policy.min_batch_size);
  assert.ok(batch.length <= audit.selection_policy.max_batch_size);
  assert.equal(batch.length, audit.selection_policy.batch_size);
  assert.equal(batch.length, 20);
  assert.deepEqual(batch.map(candidate => candidate.batch_order),
    Array.from({ length: batch.length }, (_, index) => index + 1));

  for (const [values, label] of [
    [batch.map(candidate => candidate.chart_entry.id), "chart IDs"],
    [batch.map(candidate => candidate.chart_entry.source_entry_key), "source keys"],
    [batch.map(candidate => candidate.chart_entry.placeholder_canonical_id), "placeholder canonicals"],
    [batch.map(candidate => candidate.musicbrainz_recording_evidence.recording_id), "recording IDs"],
    [batch.map(candidate => candidate.musicbrainz_release_evidence.release_id), "release IDs"],
    [batch.map(candidate => candidate.musicbrainz_release_evidence.release_group_id), "release-group IDs"]
  ]) unique(values, label);

  const classifiedIds = [
    ...batch.map(candidate => candidate.chart_entry.id),
    ...audit.rejected_version_leads.map(entry => entry.chart_entry_id),
    ...audit.reviewed_incomplete_leads.map(entry => entry.chart_entry_id)
  ];
  unique(classifiedIds, "selected, rejected and incomplete chart IDs");

  for (const candidate of batch) {
    const chart = candidate.chart_entry;
    const recording = candidate.musicbrainz_recording_evidence;
    const release = candidate.musicbrainz_release_evidence;
    const official = candidate.official_charts_evidence;

    assert.match(chart.placeholder_canonical_id, UUID);
    assert.match(recording.recording_id, UUID);
    assert.match(release.release_id, UUID);
    assert.match(release.release_group_id, UUID);
    assert.match(official.raw_sha256, SHA256);
    assert.match(recording.isrc_lookup_raw_sha256, SHA256);
    assert.match(release.raw_sha256, SHA256);
    assert.match(candidate.evidence_sha256, SHA256);
    assert.equal(candidate.evidence_sha256, sha256(candidateEvidencePayload(candidate)));

    assert.match(official.url, /^https:\/\/www\.officialcharts\.com\/songs\//);
    assert.match(recording.isrc_lookup_url, /^https:\/\/musicbrainz\.org\/ws\/2\/isrc\//);
    assert.match(release.url, /^https:\/\/musicbrainz\.org\/release\//);
    assert.match(official.catalogue_number, /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/);
    assert.equal(
      new URL(recording.isrc_lookup_url).pathname,
      `/ws/2/isrc/${official.catalogue_number}`
    );
    assert.equal(new URL(release.url).pathname, `/release/${release.release_id}`);
    assert.equal(recording.isrc_lookup_count, 1);
    assert.equal(release.status, "Official");
    assert.equal(release.matching_track_count, 1);
    assert.ok(
      Number.isSafeInteger(release.release_track_count)
        && release.release_track_count >= 1,
      `release track count is invalid for chart entry ${chart.id}`
    );
    assert.ok(
      release.track_position <= release.release_track_count,
      `selected track position exceeds release track count for chart entry ${chart.id}`
    );
    assert.equal(release.track_recording_id, recording.recording_id);
    assert.equal(release.track_isrc, official.catalogue_number);
    assert.equal(candidate.target.track_position, release.track_position);
    assert.ok(Array.isArray(candidate.risk_notes));

    assert.equal(candidate.rating_state.placeholder_canonical_rows, 0);
    assert.equal(candidate.rating_state.historical_chart_entry_rows, 0);
    assert.equal(candidate.rating_state.operation_policy, "abort_if_any_rating_appears");

    if (candidate.action === "link_existing") {
      assert.equal(candidate.classification, "verified_existing_link");
      assert.ok(candidate.target.song_id);
      assert.ok(candidate.target.album_id);
      assert.notEqual(candidate.target.canonical_id, chart.placeholder_canonical_id);
    } else {
      assert.equal(candidate.action, "import_verified");
      assert.equal(candidate.classification, "verified_catalogue_import");
      assert.equal(candidate.target.song_id, null);
      assert.equal(candidate.target.album_id, null);
      assert.equal(candidate.target.canonical_id, chart.placeholder_canonical_id);
      assert.equal(candidate.target.stored_title, chart.title);
      assert.equal(candidate.target.stored_artist, chart.artist);
      assert.equal(candidate.target.duration_ms, release.track_duration_ms);
    }
  }

  const selectedTrackImports = batch.filter(candidate =>
    candidate.action === "import_verified"
      && candidate.musicbrainz_release_evidence.release_track_count > 1
  );
  for (const candidate of batch) {
    const mustDisclose = selectedTrackImports.includes(candidate);
    assert.equal(
      candidate.risk_notes.includes(SELECTED_TRACK_RISK_NOTE),
      mustDisclose,
      mustDisclose
        ? `selected-track risk disclosure missing for chart entry ${candidate.chart_entry.id}`
        : `unexpected selected-track risk disclosure for chart entry ${candidate.chart_entry.id}`
    );
  }
  assert.deepEqual(
    audit.selection_policy.selected_track_import_chart_entry_ids,
    selectedTrackImports.map(candidate => candidate.chart_entry.id),
    "selected-track disclosure IDs must match every multi-track import"
  );
  const selectedTrackTitles = selectedTrackImports.map(candidate => candidate.chart_entry.title);
  const selectedTrackTitleList = selectedTrackTitles.length < 2
    ? selectedTrackTitles.join("")
    : `${selectedTrackTitles.slice(0, -1).join(", ")} and ${selectedTrackTitles.at(-1)}`;
  assert.equal(
    audit.selection_policy.source_release_note,
    `${selectedTrackTitleList} use exact tracks on reviewed official multi-track releases; this matches the selected-track import semantics established by PR #46.`,
    "selected-track release note must name every multi-track import"
  );

  assert.deepEqual(audit.manifest_payload, buildManifestPayload(audit));
  assert.equal(audit.manifest_sha256, sha256(audit.manifest_payload));
  assert.deepEqual(audit.safety_contract, {
    approval_gate: `SET bom.approved_historical_reconciliation = '20261123_uk_number_ones_verified_batch_2:${audit.manifest_sha256}' before executing the operation in the same session`,
    atomic_transaction: true,
    global_stale_baseline_abort: true,
    per_candidate_stale_fingerprint_abort: true,
    deterministic_advisory_lock_order: true,
    immutable_private_operation_evidence: true,
    preserve_all_song_ratings_byte_for_byte: true,
    preserve_all_historical_chart_ratings_byte_for_byte: true,
    preserve_first_batch_papa_dont_preach_reconciliation: true,
    duplicate_and_partial_identity_abort: true,
    rollback_operation_required: true,
    production_execution_authorized: false
  });
  assert.equal(batch.filter(candidate => candidate.action === "link_existing").length, 1);
  assert.equal(batch.filter(candidate => candidate.action === "import_verified").length, 19);
  assert.deepEqual(audit.expected_deltas, {
    albums: 19,
    songs: 19,
    canonical_recordings: 0,
    historical_chart_links: 20,
    ratings: 0
  });
  assert.equal(audit.proposed_result.remaining_unresolved_chart_entries, 859);
  return audit;
}

export function snapshotRowIdentity(snapshot) {
  return snapshot.rows
    .map(row => [
      row.id,
      row.source_entry_key,
      row.canonical_song_id,
      row.match_status,
      row.song_id,
      row.musicbrainz_recording_id
    ])
    .sort((left, right) => left[0] - right[0]);
}

export function auditCandidateState(state, audit) {
  validateAudit(audit);
  assert.equal(state.schema_version, 1);
  assert.equal(state.artifact, "historical-uk-number-ones-verified-batch-2-live-state");
  assert.equal(state.status, "read_only_snapshot");
  assert.equal(state.project_id, "xevxjggauscyrvvtmftx");
  assert.equal(state.captured_at, audit.snapshot.captured_at);
  assert.equal(state.candidates.length, audit.proposed_batch.length);

  const stateByChart = new Map(state.candidates.map(candidate => [candidate.chart_entry.id, candidate]));
  unique([...stateByChart.keys()], "candidate-state chart IDs");
  for (const candidate of audit.proposed_batch) {
    const captured = stateByChart.get(candidate.chart_entry.id);
    assert.ok(captured, `candidate-state row ${candidate.chart_entry.id} is missing`);
    assert.deepEqual(captured.chart_entry, candidate.chart_entry);
    assert.equal(captured.action, candidate.action);
    assert.deepEqual(captured.stale_state_fingerprint, candidate.stale_state_fingerprint);
    assert.equal(typeof captured.source_rows?.chart_source_metadata, "object");
    assert.equal(typeof captured.source_rows?.canonical_source_metadata, "object");
    assert.equal(
      postgresJsonbSha256(captured.source_rows.chart_source_metadata),
      candidate.stale_state_fingerprint.source_metadata_sha256,
      `candidate-state row ${candidate.chart_entry.id} chart source metadata drift`
    );
    assert.equal(
      postgresJsonbSha256(captured.source_rows.canonical_source_metadata),
      candidate.stale_state_fingerprint.canonical_metadata_sha256,
      `candidate-state row ${candidate.chart_entry.id} canonical source metadata drift`
    );
    assert.deepEqual(captured.placeholder, {
      id: candidate.chart_entry.placeholder_canonical_id,
      title: candidate.chart_entry.title,
      artist: candidate.chart_entry.artist,
      origin_key: `quick-rate:uk-number-ones:${candidate.chart_entry.source_entry_key}`,
      chart_references: 1,
      song_occurrences: 0,
      canonical_rating_rows: 0,
      historical_rating_rows: 0,
      musicbrainz_recording_id: null
    });

    const expectedCollisionCount = candidate.action === "link_existing" ? 1 : 0;
    assert.deepEqual(captured.catalogue_collision, {
      song_recording_rows: expectedCollisionCount,
      canonical_recording_rows: expectedCollisionCount,
      album_release_rows: expectedCollisionCount,
      album_release_group_rows: expectedCollisionCount
    });

    if (candidate.action === "import_verified") {
      assert.equal(captured.existing_target, null);
      continue;
    }

    assert.deepEqual(captured.existing_target, {
      song: {
        title: candidate.target.stored_title,
        artist: candidate.target.stored_artist,
        song_id: candidate.target.song_id,
        is_deleted: false,
        duration_ms: candidate.target.duration_ms,
        external_id: candidate.musicbrainz_recording_evidence.recording_id,
        track_position: candidate.target.track_position,
        external_source: "musicbrainz",
        canonical_song_id: candidate.target.canonical_id
      },
      canonical: {
        id: candidate.target.canonical_id,
        title: candidate.target.stored_title,
        artist: candidate.target.stored_artist,
        origin_key: `musicbrainz:${candidate.musicbrainz_recording_evidence.recording_id}`,
        musicbrainz_recording_id: candidate.musicbrainz_recording_evidence.recording_id
      },
      album: {
        id: candidate.target.album_id,
        title: candidate.musicbrainz_release_evidence.title,
        artist: candidate.musicbrainz_release_evidence.artist_credit,
        is_deleted: false,
        external_id: candidate.musicbrainz_release_evidence.release_id,
        release_date: candidate.musicbrainz_release_evidence.release_date,
        external_source: "musicbrainz",
        canonical_release_date: null,
        musicbrainz_release_id: candidate.musicbrainz_release_evidence.release_id,
        canonical_release_country: null,
        musicbrainz_release_group_id: candidate.musicbrainz_release_evidence.release_group_id
      }
    });
  }
  return { checked_candidates: state.candidates.length };
}

export function auditSnapshot(snapshot, audit) {
  validateAudit(audit);
  assert.equal(snapshot.rows.length, audit.snapshot.production_integrity.unresolved_chart_entries);
  unique(snapshot.rows.map(row => row.id), "snapshot chart IDs");
  assert.equal(sha256(snapshotRowIdentity(snapshot)), audit.snapshot.row_identity_sha256);

  const expectedIntegrity = audit.snapshot.production_integrity;
  const actualIntegrity = snapshot.integrity;
  const integrityMap = {
    total_chart_entries: "total_chart_entries",
    resolved_chart_entries: "resolved_chart_entries",
    unresolved_chart_entries: "unresolved_chart_entries",
    albums: "albums",
    songs: "songs",
    canonical_recordings: "canonical_recordings",
    duplicate_recording_mbids: "duplicate_recording_mbids",
    song_rating_rows: "song_rating_rows",
    song_rating_sum: "song_rating_sum",
    invalid_song_rating_rows: "invalid_song_rating_rows",
    historical_rating_rows: "historical_rating_rows",
    historical_rating_sum: "historical_rating_sum",
    first_batch_rating_reconciliation_audit_rows: "reconciliation_audit_rows"
  };
  for (const [expectedKey, actualKey] of Object.entries(integrityMap)) {
    assert.equal(actualIntegrity[actualKey], expectedIntegrity[expectedKey], `integrity drift: ${expectedKey}`);
  }

  const rows = new Map(snapshot.rows.map(row => [row.id, row]));
  for (const candidate of audit.proposed_batch) {
    const expected = candidate.chart_entry;
    const row = rows.get(expected.id);
    assert.ok(row, `candidate ${expected.id} is not unresolved`);
    assert.equal(row.source_entry_key, expected.source_entry_key);
    assert.equal(row.chart_year, expected.chart_year);
    assert.equal(row.title, expected.title);
    assert.equal(row.artist, expected.artist);
    assert.equal(row.source_revision, expected.source_revision);
    assert.equal(row.canonical_song_id, expected.placeholder_canonical_id);
    assert.equal(row.match_status, "unresolved");
    assert.equal(row.song_id, null);
    assert.equal(row.musicbrainz_recording_id, null);

    const placeholder = snapshot.canonical_placeholders[expected.placeholder_canonical_id];
    assert.ok(placeholder, `candidate ${expected.id} placeholder is missing`);
    assert.equal(placeholder.title, expected.title);
    assert.equal(placeholder.artist, expected.artist);
    assert.equal(placeholder.origin_key, `quick-rate:uk-number-ones:${expected.source_entry_key}`);
    assert.equal(placeholder.musicbrainz_recording_id, null);
    assert.equal(placeholder.chart_references, 1);
    assert.equal(placeholder.song_occurrences, 0);
    assert.equal(placeholder.canonical_rating_rows, 0);
    assert.equal(placeholder.historical_rating_rows, 0);
  }

  const verified = new Set(audit.proposed_batch.map(candidate => candidate.chart_entry.id));
  const conflicted = new Set(audit.rejected_version_leads.map(entry => entry.chart_entry_id));
  const counts = {
    verified_existing_link: audit.proposed_batch.filter(candidate => candidate.action === "link_existing").length,
    verified_catalogue_import: audit.proposed_batch.filter(candidate => candidate.action === "import_verified").length,
    explicit_ambiguous_or_version_conflict: snapshot.rows.filter(row => conflicted.has(row.id)).length,
    insufficient_authoritative_evidence: snapshot.rows.filter(row => !verified.has(row.id) && !conflicted.has(row.id)).length
  };
  assert.deepEqual(counts, {
    verified_existing_link: audit.audit_coverage.verified_existing_link,
    verified_catalogue_import: audit.audit_coverage.verified_catalogue_import,
    explicit_ambiguous_or_version_conflict: audit.audit_coverage.explicit_ambiguous_or_version_conflict,
    insufficient_authoritative_evidence: audit.audit_coverage.insufficient_authoritative_evidence
  });
  return { audited_rows: snapshot.rows.length, classification: counts, manifest_sha256: audit.manifest_sha256 };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

async function main() {
  const evidencePath = argumentValue("--evidence")
    || fileURLToPath(new URL("../supabase/operations/historical-uk-number-ones-verified-batch-2-audit-20261123.json", import.meta.url));
  const snapshotPath = argumentValue("--snapshot");
  const candidateStatePath = argumentValue("--candidate-state");
  const outputPath = argumentValue("--output");
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  validateAudit(evidence);

  let report = {
    status: "manifest_structure_valid",
    batch_size: evidence.proposed_batch.length,
    manifest_sha256: evidence.manifest_sha256
  };
  if (snapshotPath) {
    const rawSnapshot = await readFile(snapshotPath);
    assert.equal(sha256(rawSnapshot), evidence.snapshot.raw_snapshot_sha256, "raw snapshot drift");
    report = { status: "snapshot_inventory_and_manifest_valid", ...auditSnapshot(JSON.parse(rawSnapshot), evidence) };
  }
  if (candidateStatePath) {
    const rawCandidateState = await readFile(candidateStatePath);
    assert.equal(sha256(rawCandidateState), evidence.snapshot.candidate_state_sha256, "candidate-state snapshot drift");
    report = {
      ...report,
      status: snapshotPath
        ? "snapshot_candidate_state_and_manifest_valid"
        : "candidate_state_and_manifest_valid",
      ...auditCandidateState(JSON.parse(rawCandidateState), evidence)
    };
  }
  const rendered = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, rendered, "utf8");
  else process.stdout.write(rendered);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
