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
  const fronts = responses.flatMap((value, index) => (value.fronts || []).map(front => ({
    ...front, releaseMbid: candidate.approvedReleaseMbids[index]
  })));
  const fingerprint = candidateFingerprint(candidate);
  if (transient) return { category: "REVIEW", reason: "cover_service_temporarily_inaccessible", fingerprint,
    nextCheckAt: isoAfter(now, 7), candidates: fronts };
  if (fronts.length === 0) return { category: "UNAVAILABLE", reason: "no_front_cover_on_approved_releases", fingerprint,
    nextCheckAt: isoAfter(now, 90), candidates: [] };
  if (fronts.length !== 1) return { category: "REVIEW", reason: "multiple_front_covers_on_approved_releases", fingerprint,
    nextCheckAt: null, candidates: fronts };
  const front = fronts[0];
  return { category: "SAFE", reason: "unique_front_on_exact_approved_release", fingerprint, nextCheckAt: null,
    mapping: { releaseGroupMbid: candidate.releaseGroupMbid, coverUrl: front.coverUrl },
    evidence: { releaseMbid: front.releaseMbid, imageId: front.imageId } };
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
    `- Checked: ${report.checked}`, `- Newly verified: ${report.newlyVerified.length}`,
    `- Review: ${report.review.length}`, `- Still unavailable: ${report.unavailable.length}`,
    `- Published static mappings after this run: ${report.staticMappingCount}`,
    `- Estimated remaining placeholders: ${report.remainingPlaceholders}`, ""
  ];
  for (const [title, rows] of [["Newly verified", report.newlyVerified], ["Needs review", report.review]]) {
    if (!rows.length) continue;
    lines.push(`## ${title}`, "", ...rows.map(row => `- ${row.chartEntryId}: ${row.artist} — ${row.title} (${row.reason})`), "");
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
  let lastRequestAt = 0, requestCount = 0;
  async function requestCover(releaseMbid) {
    if (++requestCount > 100) throw new Error("Cover Art Archive request limit exceeded");
    const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt));
    if (wait) await sleep(wait);
    let response;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      response = await fetch(`https://coverartarchive.org/release/${releaseMbid}`, {
        headers: { Accept: "application/json", "User-Agent": "BankOfMusic-HistoricalArtworkMaintenance/1.0 (https://thebankofmusic.com/)" },
        signal: AbortSignal.timeout(20000)
      });
      lastRequestAt = Date.now();
      if (response.ok || response.status === 404 || ![429, 502, 503, 504].includes(response.status) || attempt === 3) break;
      await sleep(attempt * 2000);
    }
    if (response.status === 404) return { status: "MISSING", fronts: [] };
    if (!response.ok) return { status: "INACCESSIBLE", httpStatus: response.status, fronts: [] };
    const payload = await response.json();
    return { status: "AVAILABLE", fronts: (payload.images || [])
      .filter(image => image.approved !== false && (image.front === true || (image.types || []).includes("Front")))
      .map(image => ({ imageId: String(image.id || ""), coverUrl: image.thumbnails?.["500"] || image.image })) };
  }

  const additions = {}, newlyVerified = [], review = [], unavailable = [], checkedAt = new Date();
  for (const [chartEntryId, candidate] of queue) {
    const result = await inspectCandidate(chartEntryId, candidate, requestCover, checkedAt);
    state.entries[chartEntryId] = { fingerprint: result.fingerprint, category: result.category, reason: result.reason,
      checkedAt: checkedAt.toISOString(), nextCheckAt: result.nextCheckAt };
    const summary = { chartEntryId: Number(chartEntryId), artist: candidate.artist, title: candidate.title, reason: result.reason };
    if (result.category === "SAFE") { additions[chartEntryId] = result.mapping; newlyVerified.push({ ...summary, ...result.evidence }); }
    else if (result.category === "REVIEW") review.push(summary);
    else unavailable.push(summary);
  }
  const merged = mergeMappings(published, additions);
  const report = { generatedAt: checkedAt.toISOString(), checked: queue.length, requests: requestCount,
    newlyVerified, review, unavailable, staticMappingCount: Object.keys(merged.entries).length,
    remainingPlaceholders: candidates.chartEntryCount - candidates.verifiedBomArtworkCount - Object.keys(merged.entries).length };
  if (!options.dryRun && newlyVerified.length) { writeJson(sourcePath, merged); writeJson(publicPath, merged); }
  writeJson(options.statePath, state); writeJson(options.reportJsonPath, report);
  fs.mkdirSync(path.dirname(options.reportMarkdownPath), { recursive: true });
  fs.writeFileSync(options.reportMarkdownPath, reportMarkdown(report));
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.stack || error.message); process.exitCode = 1;
});
