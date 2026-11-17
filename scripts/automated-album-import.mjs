#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { runDailyImport } from "./lib/automated-album-import.mjs";

if (!/^(1|true)$/i.test(process.env.AUTOMATED_ALBUM_IMPORT_ENABLED || "")) {
  console.warn("::warning title=Album import automation disabled::Set AUTOMATED_ALBUM_IMPORT_ENABLED=true to activate.");
  process.exit(0);
}

const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const cronSecret = process.env.BOM_CRON_SECRET || "";
const target = Number(process.env.ALBUM_IMPORT_TARGET || 50);
const maxCalls = Number(process.env.ALBUM_IMPORT_MAX_CALLS || 150);
const dryRun = /^(1|true)$/i.test(process.env.ALBUM_IMPORT_DRY_RUN || "");
const runId = randomUUID();

if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
if (!Number.isInteger(target) || target < 1 || target > 200) throw new Error("Target must be 1-200");

const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
async function request(path, options = {}) {
  const response = await fetch(`${url}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${body.message || body.error || "unknown error"}`);
  return body;
}
async function status() {
  return request("/rest/v1/rpc/automated_album_import_status", {
    method: "POST", body: JSON.stringify({ p_run_id: runId })
  });
}
async function invoke() {
  const response = await request("/functions/v1/daily-artist-import", {
    method: "POST",
    headers: cronSecret ? { "x-bom-cron-secret": cronSecret } : {},
    body: JSON.stringify({ action: "run", automation_run_id: runId })
  });
  return response.importer || response;
}
async function record(values) {
  await request("/rest/v1/automated_album_import_runs", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: runId, target_albums: target, dry_run: dryRun, ...values })
  });
}

const actionLog = {
  info: message => console.log(message),
  warn: message => console.warn(`::warning title=Album discovery::${message}`)
};

await record({ status: "running", started_at: new Date().toISOString() });
try {
  const result = await runDailyImport({ target, maxCalls, dryRun, status, invoke, log: actionLog });
  const imported = Number(result.snapshot.albums_imported_this_run || 0);
  await record({ status: result.status, reason: result.reason || null, invocation_count: result.calls,
    albums_imported: imported, database_size_bytes: result.snapshot.database_size_bytes,
    warning_emitted: Number(result.snapshot.database_size_bytes) >= 350 * 1024 * 1024,
    finished_at: new Date().toISOString() });
  console.log(JSON.stringify({ event: "daily_import_complete", run_id: runId, imported, ...result }));
  if (result.status === "paused") {
    console.error(`::error title=Album imports paused::Database storage is at or above 400 MB.`);
    process.exitCode = 2;
  } else if (result.status === "incomplete") process.exitCode = 1;
} catch (error) {
  await record({ status: "failed", reason: String(error.message || error).slice(0, 1500),
    finished_at: new Date().toISOString() }).catch(recordError =>
    console.error("Failed to record run failure", recordError));
  throw error;
}
