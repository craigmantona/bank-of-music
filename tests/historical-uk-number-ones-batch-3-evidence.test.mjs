import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  auditCandidateState,
  buildManifestPayload,
  SELECTED_TRACK_RISK_NOTE,
  sha256,
  validateAudit
} from "../scripts/historical-uk-number-ones-evidence-review.mjs";

const audit = JSON.parse(await readFile(new URL(
  "../supabase/operations/historical-uk-number-ones-verified-batch-3-audit-20261124.json",
  import.meta.url
)));
const stateRaw = await readFile(new URL(
  "../supabase/operations/historical-uk-number-ones-verified-batch-3-live-state-20261124.json",
  import.meta.url
));
const state = JSON.parse(stateRaw);
const operation = await readFile(new URL(
  "../supabase/operations/20261124_reconcile_verified_uk_number_ones_batch_3.sql",
  import.meta.url
), "utf8");
const rollback = await readFile(new URL(
  "../supabase/operations/20261124_rollback_verified_uk_number_ones_batch_3.sql",
  import.meta.url
), "utf8");

test("batch 3 binds all 20 prior verified identities to fresh collision-free state", () => {
  validateAudit(audit);
  auditCandidateState(state, audit);
  assert.equal(sha256(stateRaw), audit.snapshot.candidate_state_sha256);
  assert.equal(audit.audit_coverage.inventory_rows_classified, 859);
  assert.equal(audit.audit_coverage.verified_catalogue_import, 20);
  assert.equal(audit.audit_coverage.verified_existing_link, 0);
  assert.equal(state.production_integrity.resolved_chart_entries, 439);
  assert.equal(state.production_integrity.unresolved_chart_entries, 859);
  assert.ok(state.candidates.every(candidate =>
    Object.values(candidate.catalogue_collision).every(count => count === 0)
  ));
});

test("selected tracks, versions and the shared Ed Sheeran release are explicit", () => {
  const selected = audit.proposed_batch.filter(candidate =>
    candidate.musicbrainz_release_evidence.release_track_count > 1
  );
  assert.deepEqual(selected.map(candidate => candidate.chart_entry.id),
    [2478, 2475, 2462, 2030, 2029, 2007]);
  assert.ok(selected.every(candidate =>
    candidate.risk_notes.includes(SELECTED_TRACK_RISK_NOTE)
  ));

  const byId = new Map(audit.proposed_batch.map(candidate => [candidate.chart_entry.id, candidate]));
  assert.match(byId.get(2004).risk_notes.join(" "), /clean version/);
  assert.match(byId.get(2021).risk_notes.join(" "), /audience noises/);
  assert.match(byId.get(2478).risk_notes.join(" "), /Hardwell remix/);
  assert.equal(byId.get(2030).musicbrainz_release_evidence.release_id,
    byId.get(2029).musicbrainz_release_evidence.release_id);
  assert.deepEqual(audit.expected_deltas,
    { albums: 19, songs: 20, canonical_recordings: 0, historical_chart_links: 20, ratings: 0 });
});

test("manifest, approval gate, apply SQL and rollback are byte-bound", () => {
  assert.deepEqual(audit.manifest_payload, buildManifestPayload(audit));
  assert.equal(audit.manifest_sha256, sha256(audit.manifest_payload));
  const embedded = operation.match(/\$batch_manifest\$([\s\S]*?)\$batch_manifest\$::text/);
  assert.ok(embedded);
  assert.deepEqual(JSON.parse(embedded[1]), audit.manifest_payload);
  assert.equal(operation.split(audit.manifest_sha256).length - 1, 1);
  assert.equal(rollback.split(audit.manifest_sha256).length - 1, 1);
  assert.match(operation, /unapproved existing shared release/);
  assert.match(rollback, /rollback shared album changed early/);
});

test("incomplete selected-track evidence fails closed", () => {
  const changed = structuredClone(audit);
  changed.proposed_batch.find(candidate => candidate.chart_entry.id === 2478).risk_notes = [];
  changed.manifest_payload = buildManifestPayload(changed);
  changed.manifest_sha256 = sha256(changed.manifest_payload);
  changed.safety_contract.approval_gate =
    `SET bom.approved_historical_reconciliation = '20261124_uk_number_ones_verified_batch_3:${changed.manifest_sha256}' before executing the operation in the same session`;
  assert.throws(() => validateAudit(changed), /selected-track risk disclosure missing/);
});
