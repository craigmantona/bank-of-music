#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalise } from "./uk-number-ones-lib.mjs";

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const PROHIBITED = new Set(["--commit", "--execute", "--apply", "--production"]);
const WRITE_ENV = ["BOM_DATABASE_URL", "DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

function option(name, fallback = "") {
  const inline = process.argv.find(value => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function digest(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

export function rowFingerprint(row) {
  return digest({
    id: row.id, collection_key: row.collection_key, source_entry_key: row.source_entry_key,
    chart_year: row.chart_year, title: row.title, artist: row.artist, song_id: row.song_id,
    canonical_song_id: row.canonical_song_id, musicbrainz_recording_id: row.musicbrainz_recording_id,
    match_status: row.match_status, updated_at: row.updated_at, canonical_updated_at: row.canonical_updated_at,
    canonical_recording_id: row.canonical_recording_id, canonical_rating_rows: Number(row.canonical_rating_rows || 0),
    historical_rating_rows: Number(row.historical_rating_rows || 0), song_occurrences: Number(row.song_occurrences || 0),
    chart_reference_rows: Number(row.chart_reference_rows || 0)
  });
}

export function compactSnapshot(snapshot) {
  const fields = ["id", "collection_key", "source_entry_key", "chart_year", "title", "artist", "song_id", "canonical_song_id",
    "musicbrainz_recording_id", "canonical_recording_id", "match_status", "updated_at", "canonical_updated_at",
    "canonical_rating_rows", "historical_rating_rows", "song_occurrences", "chart_reference_rows", "isrc"];
  return {
    schema_version: snapshot.schema_version, captured_at: snapshot.captured_at, project_id: snapshot.project_id,
    read_only: snapshot.read_only, production_integrity: snapshot.production_integrity,
    rows: (snapshot.rows || []).map(row => ({
      ...Object.fromEntries(fields.map(field => [field, row[field] ?? null])),
      source_isrcs: row.source_isrcs || row.source_metadata?.isrcs || []
    }))
  };
}

function storedIsrcs(row) {
  return [...new Set([row.isrc, ...(row.source_isrcs || row.source_metadata?.isrcs || [])].filter(Boolean))];
}

function exactUrl(value, host) {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === host; }
  catch { return false; }
}

export function validateIndependentEvidence(row, evidence) {
  const failures = [];
  if (!evidence || evidence.status !== "independently_verified") failures.push("evidence_not_independently_verified");
  if (!exactUrl(evidence?.official_charts_url, "www.officialcharts.com")) failures.push("official_charts_url_missing_or_invalid");
  if (!ISRC.test(evidence?.official_charts_isrc || "")) failures.push("official_charts_isrc_missing_or_invalid");
  if (!MBID.test(evidence?.recording_mbid || "")) failures.push("musicbrainz_recording_mbid_missing_or_invalid");
  if (!MBID.test(evidence?.release_mbid || "")) failures.push("musicbrainz_release_mbid_missing_or_invalid");
  if (!MBID.test(evidence?.release_group_mbid || "")) failures.push("musicbrainz_release_group_mbid_missing_or_invalid");
  if (!exactUrl(evidence?.musicbrainz_recording_url, "musicbrainz.org")) failures.push("musicbrainz_recording_url_missing_or_invalid");
  if (!exactUrl(evidence?.musicbrainz_release_url, "musicbrainz.org")) failures.push("musicbrainz_release_url_missing_or_invalid");
  if (normalise(evidence?.title) !== normalise(row.title)) failures.push("title_mismatch");
  if (normalise(evidence?.artist) !== normalise(row.artist)) failures.push("artist_mismatch");
  if (!Array.isArray(evidence?.recording_isrcs) || !evidence.recording_isrcs.includes(evidence?.official_charts_isrc)) failures.push("recording_isrc_does_not_match_official_charts");
  const sourceIsrcs = storedIsrcs(row);
  if (sourceIsrcs.length && !sourceIsrcs.includes(evidence?.official_charts_isrc)) failures.push("stored_isrc_conflicts_with_official_charts");
  if (row.musicbrainz_recording_id && row.musicbrainz_recording_id.toLowerCase() !== String(evidence?.recording_mbid || "").toLowerCase()) failures.push("stored_recording_mbid_conflict");
  if (evidence?.release_status !== "Official") failures.push("release_not_official");
  if (!Number.isInteger(evidence?.track_position) || evidence.track_position < 1) failures.push("exact_track_position_missing");
  if (evidence?.track_recording_mbid?.toLowerCase() !== String(evidence?.recording_mbid || "").toLowerCase()) failures.push("release_track_recording_mismatch");
  if (evidence?.release_recording_occurrences !== 1) failures.push("release_track_not_unique");
  if (!Number.isInteger(evidence?.release_track_count) || evidence.release_track_count < 1) failures.push("release_track_count_missing");
  if (evidence?.release_track_count > 1 && !String(evidence?.risk_notes || "").match(/selected[- ]track/i)) failures.push("selected_track_risk_not_disclosed");
  if (!String(evidence?.version_notes || "").trim()) failures.push("version_risk_not_disclosed");
  if (!["existing_recording", "safe_import"].includes(evidence?.action)) failures.push("unsupported_action");
  if (evidence?.action === "existing_recording" && !Number.isInteger(evidence?.existing_song_id)) failures.push("existing_song_id_missing");
  return failures;
}

function priorResult(row, priorStates) {
  const results = priorStates.map(state => state?.results?.[String(row.id)]).filter(Boolean);
  return results.at(-1) || null;
}

function unresolvedReason(row, chartEvidence, prior) {
  if (Number(row.canonical_rating_rows) || Number(row.historical_rating_rows)) return "rated_placeholder_protected";
  if (Number(row.song_occurrences)) return "placeholder_has_catalogue_occurrences";
  if (row.canonical_recording_id || row.musicbrainz_recording_id) return "preexisting_recording_identity_requires_manual_reconciliation";
  const sourceIsrcs = storedIsrcs(row);
  if (sourceIsrcs.length > 1) return "multiple_or_conflicting_stored_isrcs";
  if (chartEvidence?.status === "identity_conflict") return "authoritative_chart_identity_conflict";
  if (chartEvidence?.status === "non_isrc_catalogue") return "authoritative_chart_page_has_no_recording_isrc";
  if (chartEvidence?.status === "chart_identity_only") return "musicbrainz_recording_and_exact_release_track_evidence_missing";
  if (prior?.reason) return `existing_research_exhausted:${prior.reason}`;
  return "authoritative_identity_evidence_missing";
}

export function classifyFullScan(snapshot, { evidence = {}, chartEvidence = {}, priorStates = [] } = {}) {
  if (!Array.isArray(snapshot?.rows)) throw new Error("Live-state snapshot rows are required.");
  const ids = snapshot.rows.map(row => Number(row.id));
  if (ids.some(id => !Number.isInteger(id)) || new Set(ids).size !== ids.length) throw new Error("Snapshot row IDs must be unique integers.");
  const rows = snapshot.rows.map(row => {
    const reviewed = evidence[String(row.id)];
    const failures = reviewed ? validateIndependentEvidence(row, reviewed) : [];
    const prior = priorResult(row, priorStates);
    const base = {
      chart_row_id: Number(row.id), chart_year: Number(row.chart_year), title: row.title, artist: row.artist,
      source_entry_key: row.source_entry_key, placeholder_canonical_id: row.canonical_song_id,
      row_fingerprint: rowFingerprint(row), prior_research_reason: prior?.reason || null,
      evidence_cache_status: chartEvidence[String(row.id)]?.status || "not_cached"
    };
    if (reviewed && failures.length === 0 && !Number(row.canonical_rating_rows) && !Number(row.historical_rating_rows) && !Number(row.song_occurrences) && !row.song_id) {
      return { ...base, category: reviewed.action === "existing_recording" ? "VERIFIED_EXISTING" : "VERIFIED_IMPORT", reason: "exact_independently_verified_identity", evidence: reviewed };
    }
    return {
      ...base, category: "UNRESOLVED",
      reason: reviewed && failures.length ? `evidence_contract_failed:${failures.join(",")}` : unresolvedReason(row, chartEvidence[String(row.id)], prior),
      prior_candidate_count: prior?.candidate_evidence?.length || 0
    };
  });
  const byRecording = new Map();
  for (const row of rows.filter(row => row.category.startsWith("VERIFIED_"))) {
    const key = row.evidence.recording_mbid.toLowerCase();
    byRecording.set(key, [...(byRecording.get(key) || []), row]);
  }
  for (const duplicates of byRecording.values()) if (duplicates.length > 1) {
    for (const duplicate of duplicates) {
      duplicate.category = "UNRESOLVED";
      duplicate.reason = "duplicate_recording_identity_across_chart_rows";
      delete duplicate.evidence;
    }
  }
  return rows;
}

export function buildReviewPlan(scan, snapshot) {
  const snapshotById = new Map(snapshot.rows.map(row => [Number(row.id), row]));
  const records = scan.filter(row => row.category.startsWith("VERIFIED_")).map(row => {
    const source = snapshotById.get(row.chart_row_id);
    const mutationPayload = {
      chart_row_id: row.chart_row_id, action: row.category === "VERIFIED_EXISTING" ? "link_existing" : "import_verified",
      placeholder_canonical_id: row.placeholder_canonical_id, recording_mbid: row.evidence.recording_mbid,
      release_mbid: row.evidence.release_mbid, release_group_mbid: row.evidence.release_group_mbid,
      track_position: row.evidence.track_position, existing_song_id: row.evidence.existing_song_id || null
    };
    const manifestSha256 = digest({ evidence: row.evidence, mutation_payload: mutationPayload, row_fingerprint: row.row_fingerprint });
    return {
      operation_key: `historical-uk-number-ones-v5-row-${row.chart_row_id}-${manifestSha256.slice(0, 12)}`,
      status: "ready_for_independent_review", approval_state: "not_approved", manifest_sha256: manifestSha256,
      preconditions: {
        row_fingerprint: row.row_fingerprint, collection_key: source.collection_key, source_entry_key: source.source_entry_key,
        match_status: "unresolved", song_id: null, canonical_song_id: source.canonical_song_id,
        canonical_rating_rows: 0, historical_rating_rows: 0, song_occurrences: 0
      },
      mutation_payload: mutationPayload,
      safety_contract: {
        isolated_transaction: true, advisory_locks: true, abort_on_stale_state: true, preserve_all_ratings: true,
        prevent_duplicate_recording_and_release: true, immutable_private_audit: true, verify_before_commit: true,
        separate_digest_bound_rollback: true, resume_from_immutable_audit: true
      },
      audit: { required: true, append_only: true, captures_before_and_after: true },
      rollback: { required: true, approval_token_scope: `rollback:${manifestSha256}`, restores_exact_snapshot: true }
    };
  });
  return {
    schema_version: 1, workflow: "historical-uk-number-ones-scalable-reconciliation-v1", executable: false,
    production_authorized: false, max_in_flight: 1, resume_strategy: "skip only immutable-audit verified records",
    snapshot_sha256: digest(snapshot), records,
    plan_sha256: digest(records.map(record => ({ operation_key: record.operation_key, manifest_sha256: record.manifest_sha256 })))
  };
}

export function validateReviewPlan(plan, scan, snapshot) {
  const expected = buildReviewPlan(scan, snapshot);
  const failures = [];
  if (plan.executable !== false || plan.production_authorized !== false) failures.push("review_plan_must_not_authorize_execution");
  if (plan.max_in_flight !== 1) failures.push("per_record_isolation_disabled");
  if (plan.snapshot_sha256 !== digest(snapshot)) failures.push("snapshot_digest_mismatch");
  if (plan.plan_sha256 !== expected.plan_sha256) failures.push("plan_digest_mismatch");
  if (stableJson(plan.records) !== stableJson(expected.records)) failures.push("record_envelope_mismatch");
  for (const record of plan.records || []) {
    if (record.approval_state !== "not_approved") failures.push(`record_${record.operation_key}_unexpected_approval`);
    if (!record.preconditions?.row_fingerprint) failures.push(`record_${record.operation_key}_missing_stale_state_guard`);
    for (const guard of ["isolated_transaction", "advisory_locks", "abort_on_stale_state", "preserve_all_ratings",
      "prevent_duplicate_recording_and_release", "immutable_private_audit", "verify_before_commit",
      "separate_digest_bound_rollback", "resume_from_immutable_audit"]) {
      if (record.safety_contract?.[guard] !== true) failures.push(`record_${record.operation_key}_missing_${guard}`);
    }
    if (record.rollback?.approval_token_scope !== `rollback:${record.manifest_sha256}`) failures.push(`record_${record.operation_key}_rollback_digest_mismatch`);
  }
  return [...new Set(failures)];
}

export function resumableQueue(plan, immutableAuditRows = []) {
  const auditByKey = Map.groupBy(immutableAuditRows, row => row.operation_key);
  const failures = [];
  const pending = [];
  for (const record of plan.records || []) {
    const history = auditByKey.get(record.operation_key) || [];
    if (history.some(row => row.manifest_sha256 !== record.manifest_sha256)) {
      failures.push(`${record.operation_key}:immutable_audit_digest_conflict`);
      continue;
    }
    const verified = history.filter(row => row.status === "verified");
    if (verified.length > 1) {
      failures.push(`${record.operation_key}:duplicate_verified_audit_rows`);
      continue;
    }
    if (!verified.length) pending.push(record);
  }
  return { pending, failures };
}

export function summarise(scan, inputs = {}) {
  const totals = {
    scanned: scan.length,
    verified_existing: scan.filter(row => row.category === "VERIFIED_EXISTING").length,
    verified_imports: scan.filter(row => row.category === "VERIFIED_IMPORT").length,
    verified_total: scan.filter(row => row.category.startsWith("VERIFIED_")).length,
    unresolved: scan.filter(row => row.category === "UNRESOLVED").length
  };
  const unresolved_reasons = Object.fromEntries([...Map.groupBy(scan.filter(row => row.category === "UNRESOLVED"), row => row.reason)]
    .map(([reason, rows]) => [reason, rows.length]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  return { schema_version: 1, workflow: "historical-uk-number-ones-scalable-reconciliation-v1", read_only_scan: true, ...totals, unresolved_reasons, ...inputs };
}

async function readJson(path) { return JSON.parse(await readFile(resolve(path), "utf8")); }
async function writeJson(path, value) { await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(resolve(path), `${JSON.stringify(value, null, 2)}\n`); }

async function main() {
  const prohibited = process.argv.find(value => PROHIBITED.has(value.split("=")[0]));
  if (prohibited) throw new Error(`Read-only reconciliation rejects ${prohibited} before reading inputs.`);
  const leaked = WRITE_ENV.find(name => process.env[name]);
  if (leaked) throw new Error(`Read-only reconciliation refuses write-capable environment variable ${leaked}.`);
  const snapshotPath = option("snapshot");
  const reportPath = option("report");
  const planPath = option("plan");
  const summaryPath = option("summary");
  if (!snapshotPath || !reportPath || !planPath || !summaryPath) throw new Error("--snapshot, --report, --plan and --summary are required.");
  const snapshot = compactSnapshot(await readJson(snapshotPath));
  const evidenceBundle = option("evidence") ? await readJson(option("evidence")) : { entries: {} };
  const chartBundle = option("chart-evidence") ? await readJson(option("chart-evidence")) : { entries: {} };
  const priorStates = [];
  for (const path of option("prior-states").split(",").filter(Boolean)) priorStates.push(await readJson(path));
  const scan = classifyFullScan(snapshot, { evidence: evidenceBundle.entries || {}, chartEvidence: chartBundle.entries || {}, priorStates });
  const report = {
    schema_version: 1, generated_at: new Date().toISOString(), read_only: true,
    snapshot_sha256: digest(snapshot), evidence_sha256: digest(evidenceBundle), chart_evidence_sha256: digest(chartBundle),
    results: scan
  };
  const plan = buildReviewPlan(scan, snapshot);
  const planFailures = validateReviewPlan(plan, scan, snapshot);
  if (planFailures.length) throw new Error(`Generated plan failed closed: ${planFailures.join(", ")}`);
  const summary = summarise(scan, {
    snapshot_sha256: report.snapshot_sha256, report_sha256: digest(report.results), plan_sha256: plan.plan_sha256,
    prior_evidence_rows_reused: scan.filter(row => row.prior_research_reason).length,
    authoritative_chart_cache_hits: scan.filter(row => row.evidence_cache_status !== "not_cached").length
  });
  if (option("compact-snapshot-output")) await writeJson(option("compact-snapshot-output"), snapshot);
  await writeJson(reportPath, report); await writeJson(planPath, plan); await writeJson(summaryPath, summary);
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
