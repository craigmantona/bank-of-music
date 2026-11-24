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
  "../supabase/operations/historical-uk-number-ones-verified-batch-4-audit-20261124.json",
  import.meta.url
)));
const stateRaw = await readFile(new URL(
  "../supabase/operations/historical-uk-number-ones-verified-batch-4-live-state-20261124.json",
  import.meta.url
));
const state = JSON.parse(stateRaw);
const operation = await readFile(new URL(
  "../supabase/operations/20261124_reconcile_verified_uk_number_ones_batch_4.sql",
  import.meta.url
), "utf8");
const rollback = await readFile(new URL(
  "../supabase/operations/20261124_rollback_verified_uk_number_ones_batch_4.sql",
  import.meta.url
), "utf8");

test("batch 4 binds 20 verified identities to the reviewed live state", () => {
  validateAudit(audit);
  auditCandidateState(state, audit);
  assert.equal(sha256(stateRaw), audit.snapshot.candidate_state_sha256);
  assert.equal(audit.audit_coverage.inventory_rows_classified, 839);
  assert.equal(audit.audit_coverage.verified_catalogue_import, 18);
  assert.equal(audit.audit_coverage.verified_existing_link, 2);
  assert.equal(state.production_integrity.resolved_chart_entries, 459);
  assert.equal(state.production_integrity.unresolved_chart_entries, 839);
  assert.deepEqual(
    state.candidates.filter(candidate =>
      Object.values(candidate.catalogue_collision).some(count => count !== 0)
    ).map(candidate => candidate.chart_entry.id),
    [2440, 2027, 1920]
  );
});
test("seven selected tracks, versions and existing targets are explicit", () => {
  const selected = audit.proposed_batch.filter(candidate =>
    candidate.musicbrainz_release_evidence.release_track_count > 1
  );
  const selectedImports = selected.filter(candidate =>
    candidate.action === "import_verified"
  );
  assert.deepEqual(
    selectedImports.map(candidate => candidate.chart_entry.id),
    [2471, 2027, 2020, 1976, 1971, 1958, 1904]
  );
  assert.ok(selectedImports.every(candidate =>
    candidate.risk_notes.includes(SELECTED_TRACK_RISK_NOTE)
  ));

  const byId = new Map(audit.proposed_batch.map(candidate => [candidate.chart_entry.id, candidate]));
  assert.match(byId.get(1998).risk_notes.join(" "), /Justin Bieber remix/);
  assert.match(byId.get(1966).risk_notes.join(" "), /Red Nose Day duet/);
  assert.match(byId.get(1920).risk_notes.join(" "), /clean recording/);
  assert.equal(byId.get(2440).action, "link_existing");
  assert.equal(byId.get(1920).action, "link_existing");
  assert.equal(byId.get(2027).target.album_id, 1937);
  assert.deepEqual(audit.expected_deltas,
    { albums: 17, songs: 18, canonical_recordings: 0, historical_chart_links: 20, ratings: 0 });
});

test("manifest, approval gate, apply SQL and rollback are byte-bound", () => {
  assert.deepEqual(audit.manifest_payload, buildManifestPayload(audit));
  assert.equal(audit.manifest_sha256, sha256(audit.manifest_payload));
  const embedded = operation.match(/\$batch_manifest\$([\s\S]*?)\$batch_manifest\$::text/);
  assert.ok(embedded);
  assert.deepEqual(JSON.parse(embedded[1]), audit.manifest_payload);
  assert.equal(operation.split(audit.manifest_sha256).length - 1, 1);
  assert.equal(rollback.split(audit.manifest_sha256).length - 1, 1);
  assert.match(operation, /reviewed existing album target failed/);
  assert.match(rollback, /rollback reviewed existing album changed/);
});

test("incomplete selected-track evidence fails closed", () => {
  const changed = structuredClone(audit);
  changed.proposed_batch.find(candidate => candidate.chart_entry.id === 2471).risk_notes = [];
  changed.manifest_payload = buildManifestPayload(changed);
  changed.manifest_sha256 = sha256(changed.manifest_payload);
  changed.safety_contract.approval_gate =
    `SET bom.approved_historical_reconciliation = '20261124_uk_number_ones_verified_batch_4:${changed.manifest_sha256}' before executing the operation in the same session`;
  assert.throws(() => validateAudit(changed), /selected-track risk disclosure missing/);
});
