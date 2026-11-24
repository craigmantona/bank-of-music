#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compactSnapshot, digest, stableJson, validateIndependentEvidence, validateReviewPlan
} from "./historical-uk-number-ones-reconciliation-workflow.mjs";

const OPERATION_KEY = "20261124_uk_number_ones_scalable_executor_v1";
const EXECUTION_TRANSPORT = "direct-postgres-psql-v1";
const DEFAULTS = {
  snapshot: "supabase/operations/historical-uk-number-ones-reconciliation-scan-live-state-20261124.json",
  report: "supabase/operations/historical-uk-number-ones-scalable-scan-report-20261124.json",
  plan: "supabase/operations/historical-uk-number-ones-scalable-review-plan-20261124.json",
  cache: "supabase/operations/historical-uk-number-ones-active-musicbrainz-cache",
  bundle: "supabase/operations/historical-uk-number-ones-scalable-executor-bundle-20261124.json",
  applySql: "supabase/operations/20261124_apply_scalable_uk_number_ones_record.sql",
  rollbackSql: "supabase/operations/20261124_rollback_scalable_uk_number_ones_record.sql"
};

function option(name, fallback = "") {
  const inline = process.argv.find(value => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function json(path) { return JSON.parse(await readFile(resolve(path), "utf8")); }

async function shardedCache(directory) {
  const names = (await readdir(resolve(directory))).filter(name => /^[0-9a-f]\.json$/.test(name));
  return Object.assign({}, ...await Promise.all(names.map(name => json(resolve(directory, name)))));
}

function credit(artistCredit = []) {
  return artistCredit.map(part => `${part.name || ""}${part.joinphrase || ""}`).join("").trim();
}

function rawSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function buildExecutorBundle(paths = DEFAULTS) {
  const snapshot = compactSnapshot(await json(paths.snapshot));
  const report = await json(paths.report);
  const plan = await json(paths.plan);
  const cache = await shardedCache(paths.cache);
  const planFailures = validateReviewPlan(plan, report.results, snapshot);
  if (planFailures.length) throw new Error(`Review plan failed validation: ${planFailures.join(", ")}`);
  const snapshotRows = new Map(snapshot.rows.map(row => [Number(row.id), row]));
  const reportRows = new Map(report.results.map(row => [Number(row.chart_row_id), row]));
  const records = plan.records.map(record => {
    const row = snapshotRows.get(Number(record.mutation_payload.chart_row_id));
    const reviewed = reportRows.get(Number(record.mutation_payload.chart_row_id));
    if (!row || !reviewed?.evidence) throw new Error(`Missing reviewed evidence for ${record.operation_key}`);
    const evidenceFailures = validateIndependentEvidence(row, reviewed.evidence);
    if (evidenceFailures.length) throw new Error(`${record.operation_key}: ${evidenceFailures.join(", ")}`);
    const releaseUrl = `https://musicbrainz.org/ws/2/release/${reviewed.evidence.release_mbid}?inc=recordings+artist-credits+release-groups&fmt=json`;
    const release = cache[releaseUrl];
    if (!release) throw new Error(`${record.operation_key}: exact release is absent from the reviewed cache`);
    const releaseTracks = (release.media || []).flatMap(medium => medium.tracks || []);
    if (releaseTracks.filter(track => track.recording?.id === reviewed.evidence.recording_mbid).length !== 1) {
      throw new Error(`${record.operation_key}: exact release track occurrence is not unique`);
    }
    return {
      operation_key: record.operation_key,
      manifest_sha256: record.manifest_sha256,
      evidence_sha256: digest(reviewed.evidence),
      preconditions: record.preconditions,
      mutation_payload: record.mutation_payload,
      chart: {
        chart_year: row.chart_year,
        title: row.title,
        artist: row.artist,
        updated_at: row.updated_at,
        canonical_updated_at: row.canonical_updated_at
      },
      evidence: {
        official_charts_isrc: reviewed.evidence.official_charts_isrc,
        release_title: reviewed.evidence.release_title,
        release_artist: credit(release.artist_credit),
        release_date: reviewed.evidence.release_date || null,
        release_country: reviewed.evidence.release_country || null,
        duration_ms: reviewed.evidence.duration_ms,
        version_notes: reviewed.evidence.version_notes,
        risk_notes: reviewed.evidence.risk_notes
      }
    };
  });
  const body = {
    schema_version: 1,
    operation_key: OPERATION_KEY,
    production_authorized: false,
    approval_state: "awaiting_separate_independent_review",
    source_plan_sha256: plan.plan_sha256,
    source_snapshot_sha256: plan.snapshot_sha256,
    expected_live_baseline: (await json(paths.snapshot)).production_integrity,
    execution_contract: {
      required_transport: EXECUTION_TRANSPORT,
      max_in_flight: 1,
      one_transaction_per_record: true,
      continue_after_record_failure: true,
      stale_state_abort_per_record: true,
      preserve_all_ratings: true,
      duplicate_prevention: true,
      append_only_private_apply_and_rollback_audit: true,
      approval_file_required: true,
      exact_bundle_and_record_digest_binding: true
    },
    records
  };
  return { ...body, bundle_sha256: digest(body) };
}

export function validateExecutorBundle(bundle) {
  const failures = [];
  if (bundle?.production_authorized !== false || bundle?.approval_state !== "awaiting_separate_independent_review") failures.push("bundle_must_remain_unapproved");
  if (!Array.isArray(bundle?.records) || bundle.records.length !== 71) failures.push("expected_71_records");
  const body = structuredClone(bundle || {});
  delete body.bundle_sha256;
  if (bundle?.bundle_sha256 !== digest(body)) failures.push("bundle_digest_mismatch");
  if (new Set((bundle?.records || []).map(record => record.operation_key)).size !== 71) failures.push("duplicate_operation_key");
  if (new Set((bundle?.records || []).map(record => record.mutation_payload?.chart_row_id)).size !== 71) failures.push("duplicate_chart_row");
  if (new Set((bundle?.records || []).map(record => record.mutation_payload?.recording_mbid)).size !== 71) failures.push("duplicate_recording_mbid");
  if ((bundle?.records || []).some(record => record.preconditions?.canonical_rating_rows !== 0 ||
      record.preconditions?.historical_rating_rows !== 0 || record.preconditions?.song_occurrences !== 0)) failures.push("rating_or_occurrence_precondition_missing");
  if ((bundle?.records || []).some(record => !/^[0-9a-f]{64}$/.test(record.manifest_sha256 || "") ||
      !/^[0-9a-f]{64}$/.test(record.evidence_sha256 || ""))) failures.push("record_digest_invalid");
  if (bundle?.execution_contract?.required_transport !== EXECUTION_TRANSPORT) failures.push("execution_transport_invalid");
  return failures;
}

export function validateApproval(approval, bundle, mode = "apply") {
  const failures = [];
  if (approval?.status !== "independently_approved") failures.push("approval_status_invalid");
  if (approval?.operation_key !== bundle.operation_key) failures.push("approval_operation_mismatch");
  if (approval?.bundle_sha256 !== bundle.bundle_sha256) failures.push("approval_bundle_digest_mismatch");
  if (approval?.mode !== mode) failures.push("approval_mode_mismatch");
  if (approval?.execution_transport !== bundle.execution_contract.required_transport) failures.push("approval_transport_mismatch");
  if (!String(approval?.approved_by || "").trim() || !String(approval?.approval_reference || "").trim() ||
      !Number.isFinite(Date.parse(approval?.approved_at || ""))) failures.push("approval_provenance_incomplete");
  return failures;
}

function recordEnvelope(bundle, record) {
  const value = {
    bundle_sha256: bundle.bundle_sha256,
    executor_operation_key: bundle.operation_key,
    execution_transport: bundle.execution_contract.required_transport,
    record
  };
  const raw = stableJson(value);
  return { raw, sha256: rawSha256(raw), base64: Buffer.from(raw).toString("base64") };
}

export function executionQueue(bundle, completedAudit = []) {
  const audited = new Map(completedAudit.map(row => [row.operation_key, row]));
  const pending = [], failures = [];
  for (const record of bundle.records || []) {
    const previous = audited.get(record.operation_key);
    if (!previous) pending.push(record);
    else if (previous.manifest_sha256 !== record.manifest_sha256) failures.push(`${record.operation_key}:audit_digest_conflict`);
  }
  return { pending, failures };
}

async function writeJson(path, value) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(resolve(path), `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const paths = { ...DEFAULTS,
    snapshot: option("snapshot", DEFAULTS.snapshot), report: option("report", DEFAULTS.report),
    plan: option("plan", DEFAULTS.plan), cache: option("cache", DEFAULTS.cache),
    bundle: option("bundle", DEFAULTS.bundle), applySql: option("apply-sql", DEFAULTS.applySql),
    rollbackSql: option("rollback-sql", DEFAULTS.rollbackSql)
  };
  if (process.argv.includes("--build-bundle")) {
    const bundle = await buildExecutorBundle(paths);
    await writeJson(paths.bundle, bundle);
    console.log(JSON.stringify({ records: bundle.records.length, bundle_sha256: bundle.bundle_sha256, production_authorized: false }));
    return;
  }
  const bundle = await json(paths.bundle);
  const bundleFailures = validateExecutorBundle(bundle);
  if (bundleFailures.length) throw new Error(`Executor bundle failed closed: ${bundleFailures.join(", ")}`);
  const mode = process.argv.includes("--rollback") ? "rollback" : "apply";
  if (!process.argv.includes("--execute")) {
    console.log(JSON.stringify({ mode: "review_only", records: bundle.records.length, bundle_sha256: bundle.bundle_sha256, production_authorized: false }));
    return;
  }
  const approvalPath = option("approval-file");
  if (!approvalPath) throw new Error("Execution requires --approval-file with a separate independent approval.");
  const approval = await json(approvalPath);
  const approvalFailures = validateApproval(approval, bundle, mode);
  if (approvalFailures.length) throw new Error(`Independent approval failed closed: ${approvalFailures.join(", ")}`);
  const databaseUrl = process.env.BOM_DATABASE_URL;
  if (!databaseUrl) throw new Error("Execution requires BOM_DATABASE_URL.");
  const sql = resolve(mode === "rollback" ? paths.rollbackSql : paths.applySql);
  const records = mode === "rollback" ? [...bundle.records].reverse() : bundle.records;
  const results = [];
  for (const record of records) {
    const envelope = recordEnvelope(bundle, record);
    const token = `${mode}:${bundle.operation_key}:${bundle.bundle_sha256}:${envelope.sha256}`;
    const child = spawnSync(process.env.BOM_PSQL_BIN || "psql", [databaseUrl, "-X", "--set", "ON_ERROR_STOP=1", "--set", `record_base64=${envelope.base64}`, "--file", sql], {
      encoding: "utf8", env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS || ""} -c bom.approved_historical_reconciliation=${token}`.trim() }
    });
    const transportFailure = Boolean(child.error) || child.status === null;
    results.push({
      operation_key: record.operation_key,
      status: child.status === 0 ? "succeeded" : "failed",
      failure_scope: child.status === 0 ? null : transportFailure ? "systemic_transport" : "record_transaction",
      error: child.status === 0 ? null : String(child.error?.message || child.stderr || child.stdout).slice(-2000)
    });
    if (transportFailure) break;
  }
  const resultPath = option("result");
  if (resultPath) await writeJson(resultPath, { schema_version: 1, mode, bundle_sha256: bundle.bundle_sha256, results });
  console.log(JSON.stringify({ mode, succeeded: results.filter(row => row.status === "succeeded").length, failed: results.filter(row => row.status === "failed").length }));
  if (results.some(row => row.status === "failed")) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
