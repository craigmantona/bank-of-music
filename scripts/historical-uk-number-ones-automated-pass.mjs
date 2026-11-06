#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CachedMusicBrainz, artistCompatible, parseCsv, reconcileResults, resultsCsv, discoverySummary } from "./historical-uk-number-ones-discovery.mjs";
import { normalise, validateMusicBrainzRelease } from "./historical-uk-number-ones-pilot.mjs";
import { selectSecondPassEvidence } from "./historical-uk-number-ones-second-pass.mjs";

const REJECTED = /\b(live|demo|bootleg|remix|karaoke|instrumental|cover|re[ -]?record(?:ed|ing)?|acoustic|session|video|mix|extended)\b/i;
const EXCLUDED_REASONS = new Set(["rated_placeholder_protected", "placeholder_identity_changed_since_first_pass"]);

function option(name, fallback = "") {
  const inline = process.argv.find(value => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function creditNames(credit = []) { return credit.map(part => part.name || part.artist?.name || "").filter(Boolean).join(" ").trim(); }
function creditText(credit = []) { return credit.map(part => `${part.name || part.artist?.name || ""}${part.joinphrase || ""}`).join("").trim(); }
function lucene(value) { return String(value).replace(/([+\-!(){}\[\]^"~*?:\\/])/g, "\\$1"); }
function year(value) { const result = Number(String(value || "").slice(0, 4)); return Number.isInteger(result) ? result : null; }

export function titleSearchUrl(entry) {
  return `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(`recording:"${lucene(entry.title)}"`)}&fmt=json&limit=100`;
}

export function exactArtistTitleCandidates(entry, searches) {
  const merged = new Map(searches.flatMap(search => search?.recordings || []).map(recording => [recording.id, recording]));
  return [...merged.values()].filter(recording => normalise(recording.title) === normalise(entry.title) &&
    artistCompatible(entry.artist, creditText(recording["artist-credit"])) &&
    !REJECTED.test(`${recording.title || ""} ${recording.disambiguation || ""}`));
}

function eligibleRelease(entry, recording, release) {
  const releaseYear = year(release.date), group = release["release-group"] || {}, secondary = group["secondary-types"] || [];
  return release.status === "Official" && releaseYear && releaseYear >= entry.chart_year - 5 && releaseYear <= entry.chart_year + 1 &&
    !secondary.some(value => ["Live", "Remix", "DJ-mix", "Mixtape/Street", "Compilation"].includes(value)) &&
    !REJECTED.test(`${release.title || ""} ${release.disambiguation || ""}`) &&
    normalise(recording.title) === normalise(entry.title);
}

export function chronologicalTieBreak(entry, candidates) {
  const chartDate = Date.parse(entry.first_number_one_date || `${entry.chart_year}-12-31`);
  const ranked = candidates.map(recording => {
    const releases = (recording.releases || []).filter(release => eligibleRelease(entry, recording, release) &&
      release["release-group"]?.["primary-type"] === "Single" && normalise(release["release-group"]?.title || release.title) === normalise(entry.title));
    const before = releases.filter(release => Date.parse(release.date) <= chartDate).sort((a, b) => {
      const country = (a.country === "GB" ? 0 : 1) - (b.country === "GB" ? 0 : 1);
      return country || Date.parse(b.date) - Date.parse(a.date) || String(a.id).localeCompare(String(b.id));
    });
    const release = before[0];
    return release ? { recording, release, country_rank: release.country === "GB" ? 0 : 1, days_before: Math.floor((chartDate - Date.parse(release.date)) / 86400000) } : null;
  }).filter(Boolean).sort((a, b) => a.country_rank - b.country_rank || a.days_before - b.days_before || String(a.recording.id).localeCompare(String(b.recording.id)));
  if (ranked.length < 1) return null;
  if (ranked.length > 1 && ranked[0].country_rank === ranked[1].country_rank && ranked[0].days_before === ranked[1].days_before) return null;
  return ranked[0];
}

function candidateEvidence(candidates) {
  return candidates.slice(0, 10).map(item => {
    const recording = item.recording || item;
    return { recording_mbid: recording.id, duration_ms: recording.length || null, artist_credit: creditText(recording["artist-credit"]),
      disambiguation: recording.disambiguation || "", official_release_mbids: (recording.releases || []).filter(r => r.status === "Official").slice(0, 8).map(r => r.id) };
  });
}

function releaseCandidates(entry, recording, preferred) {
  const releases = (recording.releases || []).filter(release => eligibleRelease(entry, recording, release)).sort((a, b) => {
    const preferredRank = (a.id === preferred?.id ? 0 : 1) - (b.id === preferred?.id ? 0 : 1);
    const singleRank = (a["release-group"]?.["primary-type"] === "Single" ? 0 : 1) - (b["release-group"]?.["primary-type"] === "Single" ? 0 : 1);
    const titleRank = (normalise(a["release-group"]?.title || a.title) === normalise(entry.title) ? 0 : 1) - (normalise(b["release-group"]?.title || b.title) === normalise(entry.title) ? 0 : 1);
    return preferredRank || singleRank || titleRank || (a.country === "GB" ? -1 : 1) || String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id));
  });
  return [...new Map(releases.map(release => [release.id, release])).values()].slice(0, 6);
}

export function manifestFromRelease(entry, recording, release, track) {
  const duration = Number.isInteger(track.length) ? track.length : recording.length;
  return { artist: entry.artist, title: entry.title, recording_mbid: recording.id,
    release_group_mbid: release["release-group"]?.id, source_release_mbid: release.id,
    source_album_title: release.title, source_album_artist: creditNames(release["artist-credit"]), source_release_country: release.country || "",
    track_position: Number(track.position), duration_ms: duration, duration_tolerance_ms: 5000,
    accepted_artist_credits: [...new Set([creditNames(track["artist-credit"]), creditNames(track.recording?.["artist-credit"]), creditNames(recording["artist-credit"])].filter(Boolean))],
    version_note: "automated evidence pass verified commercial recording" };
}

function releaseWithRecordingDuration(release, recording) {
  return { ...release, media: (release.media || []).map(medium => ({ ...medium, tracks: (medium.tracks || []).map(track =>
    track.recording?.id === recording.id && !Number.isInteger(track.length) && Number.isInteger(recording.length) ? { ...track, length: recording.length } : track) })) };
}

export function releaseCacheWithDuration(release, recordingMbid, durationMs) {
  const copy = structuredClone(release);
  for (const medium of copy.media || []) for (const track of medium.tracks || []) {
    if (track.recording?.id === recordingMbid && !Number.isInteger(track.length) && Number.isInteger(durationMs)) track.length = durationMs;
  }
  return copy;
}

async function validateCandidate(entry, recording, preferredRelease, mb) {
  for (const summary of releaseCandidates(entry, recording, preferredRelease)) {
    let release;
    try { release = await mb.get(mb.releaseUrl(summary.id)); } catch { continue; }
    const tracks = (release.media || []).flatMap(medium => medium.tracks || []);
    const matching = tracks.filter(track => track.recording?.id === recording.id);
    if (matching.length !== 1) continue;
    const track = matching[0], manifest = manifestFromRelease(entry, recording, release, track);
    if (!Number.isInteger(manifest.duration_ms) || !manifest.release_group_mbid || !Number.isInteger(manifest.track_position)) continue;
    try { validateMusicBrainzRelease(manifest, releaseWithRecordingDuration(release, recording)); }
    catch { continue; }
    return { release, track: { ...track, length: manifest.duration_ms }, manifest };
  }
  return null;
}

async function classify(entry, previous, live, mb) {
  if (Number(live.rating_rows) > 0 || previous.reason === "rated_placeholder_protected") return { ...previous, ...entry, category: "REVIEW", reason: "rated_placeholder_protected", final: true };
  if (previous.reason === "placeholder_identity_changed_since_first_pass" || live.placeholder_mbid || Number(live.song_occurrences) > 0) return { ...previous, ...entry, category: "REVIEW", reason: "placeholder_identity_changed_since_first_pass", final: true };
  if (String(previous.reason).includes("unique recording occurrence")) return { ...previous, ...entry, category: "REVIEW", reason: "duplicate_recording_relationship_requires_manual_review", final: true };
  const searches = [];
  for (const url of [mb.searchUrl(entry), mb.fallbackSearchUrl(entry)]) {
    try { searches.push(await mb.get(url)); } catch (error) { return { ...entry, category: "REVIEW", reason: `search_failed: ${error.message}`, final: false }; }
  }
  let recordings = exactArtistTitleCandidates(entry, searches);
  let selected = selectSecondPassEvidence(entry, recordings);
  if (selected.category === "UNAVAILABLE") {
    try { searches.push(await mb.get(titleSearchUrl(entry))); } catch (error) { return { ...entry, category: "REVIEW", reason: `title_search_failed: ${error.message}`, final: false }; }
    recordings = exactArtistTitleCandidates(entry, searches);
    selected = selectSecondPassEvidence(entry, recordings);
  }
  if (selected.category === "UNAVAILABLE") return { ...entry, category: "UNAVAILABLE", reason: "automated_pass_no_qualifying_contemporary_official_release", candidate_evidence: candidateEvidence(recordings), final: true };
  if (selected.category === "REVIEW") {
    const tied = selected.candidates.map(item => item.recording || item);
    const tieBreak = chronologicalTieBreak(entry, tied);
    if (!tieBreak) return { ...entry, category: "REVIEW", reason: "automated_pass_multiple_versions_remain_tied", candidate_evidence: candidateEvidence(selected.candidates), final: true };
    selected = { category: "PENDING_VALIDATION", recording: tieBreak.recording, release: tieBreak.release, tier: 0, candidates: selected.candidates };
  }
  const validated = await validateCandidate(entry, selected.recording, selected.release, mb);
  if (!validated) return { ...entry, category: "REVIEW", reason: "automated_pass_no_single_official_release_validates_recording", candidate_evidence: candidateEvidence(selected.candidates), final: true };
  const { release, track, manifest } = validated;
  return { ...entry, category: "SAFE", reason: "automated_pass_unique_verified_official_recording", recording_mbid: selected.recording.id,
    artist_credit: creditText(selected.recording["artist-credit"]), duration_ms: manifest.duration_ms, source_release_mbid: release.id,
    source_release_title: release.title, source_release_artist: manifest.source_album_artist, source_release_date: release.date || "",
    source_release_country: release.country || "", release_group_mbid: manifest.release_group_mbid, track_position: Number(track.position),
    accepted_artist_credits: manifest.accepted_artist_credits, candidate_evidence: candidateEvidence(selected.candidates), final: true };
}

export function quarantineDuplicates(results) {
  const seen = new Map();
  return results.map(row => {
    if (row.category !== "SAFE") return row;
    if (!seen.has(row.recording_mbid)) { seen.set(row.recording_mbid, row.chart_id); return row; }
    return { ...row, category: "REVIEW", reason: `automated_pass_duplicate_recording_requires_manual_link_after_chart_${seen.get(row.recording_mbid)}` };
  });
}

async function main() {
  if (process.argv.includes("--commit")) throw new Error("Automated evidence pass is discovery-only and does not support --commit.");
  const inputRows = [...parseCsv(await readFile(resolve(option("review-input")), "utf8")), ...parseCsv(await readFile(resolve(option("unavailable-input")), "utf8"))];
  if (inputRows.length !== 703 || new Set(inputRows.map(row => row.chart_id)).size !== 703) throw new Error("Automated pass requires exactly 703 unique rows.");
  const liveSnapshot = JSON.parse(await readFile(resolve(option("production-snapshot")), "utf8"));
  const live = Object.fromEntries(liveSnapshot.rows.map(row => [String(row.chart_id), row]));
  const previousState = JSON.parse(await readFile(resolve(option("previous-state")), "utf8"));
  const entries = inputRows.map(row => ({ chart_id: Number(row.chart_id), chart_year: Number(row.chart_year), artist: row.artist, title: row.title,
    first_number_one_date: live[row.chart_id]?.first_number_one_date || "" }));
  const statePath = resolve(option("state")); let state = { schema_version: 1, results: {} };
  try { state = JSON.parse(await readFile(statePath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const metricsBaseline = state.metrics || { requests: 0, cache_hits: 0 };
  const mb = new CachedMusicBrainz(resolve(option("cache")), Number(option("interval-ms", "1100"))); await mb.load();
  const batchSize = Number(option("batch-size", "25"));
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25) throw new Error("Batch size must be between 1 and 25.");
  for (let offset = 0; offset < entries.length; offset += batchSize) {
    for (const entry of entries.slice(offset, offset + batchSize)) {
      if (state.results[String(entry.chart_id)]?.final && !process.argv.includes("--refresh")) continue;
      const previous = previousState.results[String(entry.chart_id)] || inputRows.find(row => Number(row.chart_id) === entry.chart_id) || {};
      state.results[String(entry.chart_id)] = await classify(entry, previous, live[String(entry.chart_id)], mb);
      state.metrics = { requests: metricsBaseline.requests + mb.requests, cache_hits: metricsBaseline.cache_hits + mb.cacheHits };
      await mkdir(dirname(statePath), { recursive: true }); await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    }
    const complete = entries.slice(0, offset + batchSize).map(row => state.results[String(row.chart_id)]).filter(Boolean);
    console.log(JSON.stringify({ batch: Math.floor(offset / batchSize) + 1, completed: complete.length, ...discoverySummary(complete).totals, requests: mb.requests, cache_hits: mb.cacheHits }));
  }
  let results = entries.map(entry => state.results[String(entry.chart_id)]); reconcileResults(entries, results); results = quarantineDuplicates(results);
  for (const row of results) state.results[String(row.chart_id)] = row;
  state.metrics = { requests: metricsBaseline.requests + mb.requests, cache_hits: metricsBaseline.cache_hits + mb.cacheHits };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const safe = results.filter(row => row.category === "SAFE"), review = results.filter(row => row.category === "REVIEW"), unavailable = results.filter(row => row.category === "UNAVAILABLE");
  await writeFile(resolve(option("review-output")), resultsCsv(review)); await writeFile(resolve(option("unavailable-output")), resultsCsv(unavailable));
  const manifest = { schema_version: 1, pilot: "historical-uk-number-ones-automated-evidence-v1", expected_chart_rows: safe.length,
    entries: safe.map(row => ({ chart_row_id: row.chart_id, chart_year: row.chart_year, title: row.title, artist: row.artist,
      placeholder_canonical_id: live[String(row.chart_id)].canonical_song_id, action: "import_verified", recording_mbid: row.recording_mbid,
      release_group_mbid: row.release_group_mbid, source_release_mbid: row.source_release_mbid, source_album_title: row.source_release_title,
      source_album_artist: row.source_release_artist, source_release_country: row.source_release_country, track_position: row.track_position,
      duration_ms: row.duration_ms, accepted_artist_credits: row.accepted_artist_credits || [row.artist_credit].filter(Boolean), duration_tolerance_ms: 5000,
      reuse_album_id: null, version_note: "automated evidence pass verified commercial recording" })) };
  await writeFile(resolve(option("manifest-output")), `${JSON.stringify(manifest, null, 2)}\n`);
  const releases = {}; for (const row of safe) {
    releases[row.source_release_mbid] = releaseCacheWithDuration(mb.cache[mb.releaseUrl(row.source_release_mbid)], row.recording_mbid, row.duration_ms);
  }
  await writeFile(resolve(option("release-cache-output")), `${JSON.stringify(releases)}\n`);
  const summary = { generated_at: new Date().toISOString(), ...discoverySummary(results), requests: state.metrics.requests, cache_hits: state.metrics.cache_hits,
    rating_integrity_baseline: liveSnapshot.rating_integrity };
  await writeFile(resolve(option("summary-output")), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ mode: "automated_evidence_dry_run", ...summary.totals, requests: summary.requests, cache_hits: summary.cache_hits }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
