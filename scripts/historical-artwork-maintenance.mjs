#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
};
const isoAfter = (now, days) => new Date(now.getTime() + days * 86400000).toISOString();
const mbidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function normalizeCoverUrl(value) {
  const url = new URL(value);
  if (url.hostname === "coverartarchive.org") url.protocol = "https:";
  if (url.protocol !== "https:") throw new Error(`Refusing non-HTTPS artwork URL: ${value}`);
  return url.toString();
}

export function candidateFingerprint(candidate) {
  return `${candidate.releaseGroupMbid}:${[...candidate.approvedReleaseMbids].sort().join(",")}`;
}

export function eligibleCandidates(candidates, published, state, { now = new Date(), force = false, limit = 25 } = {}) {
  return Object.entries(candidates.entries)
    .filter(([chartEntryId]) => !published.entries[chartEntryId])
    .filter(([chartEntryId, candidate]) => {
      const previous = state.entries?.[chartEntryId];
      if (force || !previous || previous.fingerprint !== candidateFingerprint(candidate)) return true;
      return previous.nextCheckAt && new Date(previous.nextCheckAt) <= now;
    })
    .sort(([leftId], [rightId]) => Number(leftId) - Number(rightId))
    .slice(0, Math.max(0, Math.min(25, Number(limit) || 25)));
}

export async function inspectCandidate(chartEntryId, candidate, requestCover, now = new Date()) {
  if (!mbidPattern.test(candidate.releaseGroupMbid) || !candidate.approvedReleaseMbids?.length ||
      candidate.approvedReleaseMbids.some(value => !mbidPattern.test(value))) {
    throw new Error(`Invalid reviewed identity for chart entry ${chartEntryId}`);
  }
  const responses = [];
  for (const releaseMbid of candidate.approvedReleaseMbids) responses.push(await requestCover(releaseMbid));
  const transient = responses.some(value => value.status === "INACCESSIBLE");
  const failureReasons = responses.filter(value => value.status === "INACCESSIBLE")
    .map(value => value.failureReason || `http_${value.httpStatus || "unknown"}`);
  const fronts = responses.flatMap((value, index) => (value.fronts || []).map(front => ({
    ...front, releaseMbid: candidate.approvedReleaseMbids[index]
  })));
  const fingerprint = candidateFingerprint(candidate);
  if (transient) return { category: "REVIEW", reason: "cover_service_temporarily_inaccessible", fingerprint,
    nextCheckAt: isoAfter(now, 7), candidates: fronts, failureReasons, networkSuccessful: false };
  if (fronts.length === 0) return { category: "UNAVAILABLE", reason: "no_front_cover_on_approved_releases", fingerprint,
    nextCheckAt: isoAfter(now, 90), candidates: [], failureReasons: [], networkSuccessful: true };
  if (fronts.length !== 1) return { category: "REVIEW", reason: "multiple_front_covers_on_approved_releases", fingerprint,
    nextCheckAt: null, candidates: fronts, failureReasons: [], networkSuccessful: true };
  const front = fronts[0];
  return { category: "SAFE", reason: "unique_front_on_exact_approved_release", fingerprint, nextCheckAt: null,
    mapping: { releaseGroupMbid: candidate.releaseGroupMbid, coverUrl: front.coverUrl },
    evidence: { releaseMbid: front.releaseMbid, imageId: front.imageId }, failureReasons: [], networkSuccessful: true };
}

export function networkErrorDetail(error) {
  const details = [];
  for (let current = error, depth = 0; current && depth < 3; current = current.cause, depth += 1) {
    const label = [current.name, current.code, current.message].filter(Boolean).join(": ");
    if (label && !details.includes(label)) details.push(label);
  }
  return details.join("; caused by ") || "unknown_network_error";
}

export function createCoverRequester({ fetchImpl = fetch, sleepImpl = sleep, now = () => Date.now(),
  timeout = milliseconds => AbortSignal.timeout(milliseconds), maxRequests = 100, outageThreshold = 3 } = {}) {
  let lastRequestAt = 0, requestCount = 0, successfulRequests = 0, consecutiveUnavailable = 0, circuitOpen = false;
  const transientStatuses = new Set([429, 502, 503, 504]);
  const requestCover = async releaseMbid => {
    if (circuitOpen) return { status: "INACCESSIBLE", fronts: [], failureReason: "cover_service_circuit_open" };
    const failures = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (requestCount >= maxRequests) {
        circuitOpen = true;
        return { status: "INACCESSIBLE", fronts: [], failureReason: "request_limit_reached" };
      }
      const wait = Math.max(0, 1100 - (now() - lastRequestAt));
      if (wait) await sleepImpl(wait);
      requestCount += 1;
      try {
        const response = await fetchImpl(`https://coverartarchive.org/release/${releaseMbid}`, {
          headers: { Accept: "application/json", "User-Agent": "BankOfMusic-HistoricalArtworkMaintenance/1.0 (https://thebankofmusic.com/)" },
          signal: timeout(20000)
        });
        lastRequestAt = now();
        if (response.status === 404) {
          successfulRequests += 1; consecutiveUnavailable = 0;
          return { status: "MISSING", fronts: [] };
        }
        if (!response.ok) {
          failures.push(`http_${response.status}`);
          if (transientStatuses.has(response.status) && attempt < 3) { await sleepImpl(attempt * 2000); continue; }
          break;
        }
        const payload = await response.json();
        successfulRequests += 1; consecutiveUnavailable = 0;
        return { status: "AVAILABLE", fronts: (payload.images || [])
          .filter(image => image.approved !== false && (image.front === true || (image.types || []).includes("Front")))
          .map(image => ({ imageId: String(image.id || ""),
            coverUrl: normalizeCoverUrl(image.thumbnails?.["500"] || image.image) })) };
      } catch (error) {
        lastRequestAt = now();
        failures.push(networkErrorDetail(error));
        if (attempt < 3) { await sleepImpl(attempt * 2000); continue; }
      }
    }
    consecutiveUnavailable += 1;
    if (consecutiveUnavailable >= outageThreshold) circuitOpen = true;
    return { status: "INACCESSIBLE", fronts: [], failureReason: [...new Set(failures)].join(" | ") || "cover_service_unavailable" };
  };
  requestCover.metrics = () => ({ requestCount, successfulRequests, consecutiveUnavailable, circuitOpen });
  return requestCover;
}

export async function processQueue(queue, state, requestCover, checkedAt = new Date(), checkpoint = () => {}) {
  const additions = {}, newlyVerified = [], review = [], unavailable = [];
  for (const [chartEntryId, candidate] of queue) {
    let result;
    try {
      result = await inspectCandidate(chartEntryId, candidate, requestCover, checkedAt);
    } catch (error) {
      result = { category: "REVIEW", reason: "candidate_check_failed", fingerprint: candidateFingerprint(candidate),
        nextCheckAt: isoAfter(checkedAt, 7), failureReasons: [networkErrorDetail(error)], networkSuccessful: false };
    }
    state.entries[chartEntryId] = { fingerprint: result.fingerprint, category: result.category, reason: result.reason,
      checkedAt: checkedAt.toISOString(), nextCheckAt: result.nextCheckAt, failureReasons: result.failureReasons || [] };
    const summary = { chartEntryId: Number(chartEntryId), artist: candidate.artist, title: candidate.title,
      reason: result.reason, failureReasons: result.failureReasons || [] };
    if (result.category === "SAFE") { additions[chartEntryId] = result.mapping; newlyVerified.push({ ...summary, ...result.evidence }); }
    else if (result.category === "REVIEW") review.push(summary);
    else unavailable.push(summary);
    checkpoint({ additions, newlyVerified, review, unavailable });
  }
  return { additions, newlyVerified, review, unavailable };
}

export function mergeMappings(published, additions) {
  const entries = { ...published.entries };
  for (const [chartEntryId, mapping] of Object.entries(additions)) {
    if (entries[chartEntryId]) throw new Error(`Refusing to overwrite published chart entry ${chartEntryId}`);
    entries[chartEntryId] = mapping;
  }
  return { schemaVersion: published.schemaVersion, entries: Object.fromEntries(Object.entries(entries)
    .sort(([left], [right]) => Number(left) - Number(right))) };
}

export function reportMarkdown(report) {
  const lines = [
    "# Historical artwork maintenance", "",
    `- Checked: ${report.checked}`, `- Successful checks: ${report.successfulChecks}`, `- Retryable errors: ${report.retryableErrors}`,
    `- Newly verified: ${report.newlyVerified.length}`,
    `- Review: ${report.review.length}`, `- Still unavailable: ${report.unavailable.length}`,
    `- Published static mappings after this run: ${report.staticMappingCount}`,
    `- Estimated remaining placeholders: ${report.remainingPlaceholders}`, ""
  ];
  for (const [title, rows] of [["Newly verified", report.newlyVerified], ["Needs review", report.review]]) {
    if (!rows.length) continue;
    lines.push(`## ${title}`, "", ...rows.map(row => `- ${row.chartEntryId}: ${row.artist} — ${row.title} (${row.reason}${row.failureReasons?.length ? `: ${row.failureReasons.join("; ")}` : ""})`), "");
  }
  return `${lines.join("\n")}\n`;
}

function argumentsFrom(values) {
  const value = name => values.find(item => item.startsWith(`${name}=`))?.slice(name.length + 1);
  return {
    dryRun: values.includes("--dry-run"), force: values.includes("--force"),
    limit: Math.min(25, Number(value("--limit")) || 25),
    statePath: value("--state") || path.join(root, ".cache/historical-artwork-maintenance-state.json"),
    reportJsonPath: value("--report-json") || path.join(root, ".cache/historical-artwork-maintenance-report.json"),
    reportMarkdownPath: value("--report-markdown") || path.join(root, ".cache/historical-artwork-maintenance-report.md")
  };
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const candidates = readJson(path.join(root, "scripts/historical-artwork-maintenance-candidates.json"));
  const sourcePath = path.join(root, "historical-uk-number-ones-cover-art.json");
  const publicPath = path.join(root, "public/historical-uk-number-ones-cover-art.json");
  const published = readJson(sourcePath);
  if (JSON.stringify(published) !== JSON.stringify(readJson(publicPath))) throw new Error("Source and public artwork allowlists differ");
  const state = fs.existsSync(options.statePath) ? readJson(options.statePath) : { schemaVersion: 1, entries: {} };
  state.entries ||= {};
  const queue = eligibleCandidates(candidates, published, state, options);
  const checkedAt = new Date(), requestCover = createCoverRequester();
  const buildReport = ({ additions = {}, newlyVerified = [], review = [], unavailable = [] }) => {
    const merged = mergeMappings(published, additions), metrics = requestCover.metrics();
    return { generatedAt: checkedAt.toISOString(), checked: newlyVerified.length + review.length + unavailable.length,
      successfulChecks: newlyVerified.length + unavailable.length + review.filter(row => row.reason === "multiple_front_covers_on_approved_releases").length,
      retryableErrors: review.filter(row => row.failureReasons?.length).length, requests: metrics.requestCount,
      apiErrors: review.flatMap(row => row.failureReasons || []), serviceCircuitOpen: metrics.circuitOpen,
      newlyVerified, review, unavailable, staticMappingCount: Object.keys(merged.entries).length,
      remainingPlaceholders: candidates.chartEntryCount - candidates.verifiedBomArtworkCount - Object.keys(merged.entries).length };
  };
  const saveProgress = progress => {
    const report = buildReport(progress);
    writeJson(options.statePath, state); writeJson(options.reportJsonPath, report);
    fs.mkdirSync(path.dirname(options.reportMarkdownPath), { recursive: true });
    fs.writeFileSync(options.reportMarkdownPath, reportMarkdown(report));
  };
  saveProgress({});
  const progress = await processQueue(queue, state, requestCover, checkedAt, saveProgress);
  const { additions, newlyVerified } = progress, merged = mergeMappings(published, additions), report = buildReport(progress);
  if (!options.dryRun && newlyVerified.length) { writeJson(sourcePath, merged); writeJson(publicPath, merged); }
  saveProgress(progress);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.stack || error.message); process.exitCode = 1;
});
