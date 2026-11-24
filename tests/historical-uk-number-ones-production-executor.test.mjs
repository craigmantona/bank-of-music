import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildExecutorBundle, executionQueue, validateApproval, validateExecutorBundle
} from "../scripts/historical-uk-number-ones-production-executor.mjs";

const load = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const bundlePath = "supabase/operations/historical-uk-number-ones-scalable-executor-bundle-20261124.json";

test("the reviewed executor bundle is deterministic, complete and deliberately unapproved", async () => {
  const committed = await load(bundlePath);
  const rebuilt = await buildExecutorBundle();
  assert.deepEqual(rebuilt, committed);
  assert.deepEqual(validateExecutorBundle(committed), []);
  assert.equal(committed.production_authorized, false);
  assert.equal(committed.records.length, 71);
  assert.equal(committed.records.filter(record => record.mutation_payload.action === "import_verified").length, 68);
  assert.equal(committed.records.filter(record => record.mutation_payload.action === "link_existing").length, 3);
  assert.equal(committed.execution_contract.required_transport, "direct-postgres-psql-v1");
  assert.equal(new Set(committed.records.map(record => record.mutation_payload.recording_mbid)).size, 71);
  assert.ok(committed.records.every(record => record.preconditions.canonical_rating_rows === 0 &&
    record.preconditions.historical_rating_rows === 0 && record.preconditions.song_occurrences === 0));
});

test("bundle tampering and stale immutable audit evidence fail closed", async () => {
  const bundle = await load(bundlePath);
  const tampered = structuredClone(bundle);
  tampered.records[0].mutation_payload.track_position += 1;
  assert.ok(validateExecutorBundle(tampered).includes("bundle_digest_mismatch"));
  const record = bundle.records[0];
  assert.deepEqual(executionQueue(bundle, [{ operation_key: record.operation_key, manifest_sha256: record.manifest_sha256 }]).pending.length, 70);
  assert.deepEqual(executionQueue(bundle, [{ operation_key: record.operation_key, manifest_sha256: "0".repeat(64) }]).failures,
    [`${record.operation_key}:audit_digest_conflict`]);
});

test("execution and rollback require a separate digest-bound approval", async () => {
  const bundle = await load(bundlePath);
  const approval = {
    status: "independently_approved", operation_key: bundle.operation_key, bundle_sha256: bundle.bundle_sha256,
    mode: "apply", approved_by: "independent-reviewer", approved_at: "2026-11-24T17:00:00Z",
    approval_reference: "review:executor-head", execution_transport: bundle.execution_contract.required_transport
  };
  assert.deepEqual(validateApproval(approval, bundle, "apply"), []);
  assert.ok(validateApproval({ ...approval, bundle_sha256: "0".repeat(64) }, bundle, "apply").includes("approval_bundle_digest_mismatch"));
  assert.ok(validateApproval(approval, bundle, "rollback").includes("approval_mode_mismatch"));
  assert.ok(validateApproval({ ...approval, execution_transport: "supabase-mcp" }, bundle, "apply").includes("approval_transport_mismatch"));
});

test("reviewed SQL provides one transaction per record with stale, rating, duplicate, audit and rollback guards", async () => {
  const apply = await readFile(new URL("../supabase/operations/20261124_apply_scalable_uk_number_ones_record.sql", import.meta.url), "utf8");
  const rollback = await readFile(new URL("../supabase/operations/20261124_rollback_scalable_uk_number_ones_record.sql", import.meta.url), "utf8");
  for (const sql of [apply, rollback]) {
    assert.match(sql, /^\\set ON_ERROR_STOP on/m);
    assert.match(sql, /begin;/i);
    assert.match(sql, /commit;/i);
    assert.match(sql, /pg_advisory_xact_lock/);
    assert.match(sql, /approved_historical_reconciliation/);
    assert.match(sql, /direct-postgres-psql-v1/);
    assert.match(sql, /historical_chart_reconciliation_operation_audit/);
    assert.match(sql, /bom_executor_song_ratings_before/);
    assert.match(sql, /bom_executor_historical_ratings_before/);
    assert.match(sql, /duplicate canonical/i);
    assert.doesNotMatch(sql, /set_config\s*\(\s*['"]bom\.approved_historical_reconciliation/i);
  }
  assert.match(apply, /stale-state guard failed/);
  assert.match(apply, /duplicate recording identity/);
  assert.match(rollback, /after-state guard failed/);
  assert.match(rollback, /refuses a newly rated candidate/);
});

test("a systemic transport failure stops before attempting a second record", async () => {
  const script = fileURLToPath(new URL("../scripts/historical-uk-number-ones-production-executor.mjs", import.meta.url));
  const bundle = await load(bundlePath);
  const directory = await mkdtemp(join(tmpdir(), "bom-executor-"));
  const approvalPath = join(directory, "approval.json");
  await writeFile(approvalPath, JSON.stringify({
    status: "independently_approved", operation_key: bundle.operation_key, bundle_sha256: bundle.bundle_sha256,
    mode: "apply", approved_by: "independent-reviewer", approved_at: "2026-11-24T17:00:00Z",
    approval_reference: "review:executor-head", execution_transport: bundle.execution_contract.required_transport
  }));
  const execution = spawnSync(process.execPath, [script, "--execute", "--approval-file", approvalPath], {
    encoding: "utf8", env: { ...process.env, BOM_DATABASE_URL: "postgresql://invalid", BOM_PSQL_BIN: join(directory, "missing-psql") }
  });
  assert.equal(execution.status, 2);
  assert.match(execution.stdout, /"succeeded":0,"failed":1/);
});

test("the command is review-only by default and refuses execution before database access without approval", async () => {
  const script = fileURLToPath(new URL("../scripts/historical-uk-number-ones-production-executor.mjs", import.meta.url));
  const review = spawnSync(process.execPath, [script], { encoding: "utf8", env: {} });
  assert.equal(review.status, 0);
  assert.match(review.stdout, /"mode":"review_only"/);
  const execute = spawnSync(process.execPath, [script, "--execute"], { encoding: "utf8", env: {} });
  assert.notEqual(execute.status, 0);
  assert.match(execute.stderr, /requires --approval-file/);
});
