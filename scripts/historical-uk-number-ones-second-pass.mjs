#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CachedMusicBrainz, artistCompatible, parseCsv, reconcileResults, resultsCsv, discoverySummary } from "./historical-uk-number-ones-discovery.mjs";
import { normalise, validateMusicBrainzRelease } from "./historical-uk-number-ones-pilot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REJECTED = /\b(live|demo|bootleg|remix|karaoke|instrumental|cover|re[ -]?record(?:ed|ing)?|acoustic|session|video|mix|extended)\b/i;
const REJECTED_SECONDARY = new Set(["Live", "Remix", "DJ-mix", "Mixtape/Street", "Compilation"]);

function option(name, fallback = "") {
  const inline = process.argv.find(value => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function creditText(credit = []) {
  return credit.map(part => `${part.name || part.artist?.name || ""}${part.joinphrase || ""}`).join("").trim();
}

function releaseYear(release) {
  const year = Number(String(release.date || "").slice(0, 4));
  return Number.isInteger(year) && year > 1900 ? year : null;
}

function eligibleRecording(entry, recording) {
  if (normalise(recording.title) !== normalise(entry.title)) return false;
  if (!artistCompatible(entry.artist, creditText(recording["artist-credit"]))) return false;
  return !REJECTED.test(`${recording.title || ""} ${recording.disambiguation || ""}`);
}

export function evidenceTier(entry, release) {
  const year = releaseYear(release);
  const group = release["release-group"] || {};
  const secondary = group["secondary-types"] || [];
  if (release.status !== "Official" || !year || year > entry.chart_year + 1 || year < entry.chart_year - 5) return null;
  if (secondary.some(value => REJECTED_SECONDARY.has(value)) || REJECTED.test(`${release.title || ""} ${release.disambiguation || ""}`)) return null;
  const exactTitle = normalise(group.title || release.title) === normalise(entry.title);
  if (group["primary-type"] === "Single" && exactTitle && release.country === "GB" && year >= entry.chart_year - 2) return 0;
  if (group["primary-type"] === "Single" && exactTitle && year >= entry.chart_year - 2) return 1;
  return null;
}

function eligibleCommercialRelease(entry, release, primaryType) {
  const year = releaseYear(release), group = release["release-group"] || {}, secondary = group["secondary-types"] || [];
  return release.status === "Official" && year && year >= entry.chart_year - 5 && year <= entry.chart_year + 1 &&
    group["primary-type"] === primaryType && !secondary.some(value => REJECTED_SECONDARY.has(value)) &&
    !REJECTED.test(`${release.title || ""} ${release.disambiguation || ""}`);
}

export function selectSecondPassEvidence(entry, recordings) {
  const ranked = recordings.filter(recording => eligibleRecording(entry, recording)).map(recording => {
    const allReleases = recording.releases || [];
    const releases = allReleases.map(release => ({ release, tier: evidenceTier(entry, release) })).filter(item => item.tier !== null)
      .sort((a, b) => a.tier - b.tier || (a.release.country === "GB" ? -1 : 1) || String(a.release.date).localeCompare(String(b.release.date)) || String(a.release.id).localeCompare(String(b.release.id)));
    if (releases.length) return { recording, release: releases[0].release, tier: releases[0].tier };
    const albumEvidence = allReleases.some(release => eligibleCommercialRelease(entry, release, "Album"));
    const supportingSingles = allReleases.filter(release => eligibleCommercialRelease(entry, release, "Single"))
      .sort((a, b) => (a.country === "GB" ? -1 : 1) || String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
    return albumEvidence && supportingSingles.length ? { recording, release: supportingSingles[0], tier: 2 } : null;
  }).filter(Boolean);
  if (!ranked.length) return { category: "UNAVAILABLE", reason: "second_pass_no_qualifying_official_single_or_original_album", candidates: [] };
  const bestTier = Math.min(...ranked.map(item => item.tier));
  const best = ranked.filter(item => item.tier === bestTier);
  if (best.length !== 1) return { category: "REVIEW", reason: `second_pass_tied_tier_${bestTier}_recordings`, candidates: best };
  if (bestTier === 2 && ranked.length !== 1) return { category: "REVIEW", reason: "second_pass_album_and_single_evidence_not_unique_across_recordings", candidates: ranked };
  return { category: "PENDING_VALIDATION", reason: `second_pass_unique_evidence_tier_${bestTier}`, ...best[0], candidates: ranked };
}

function candidateEvidence(items) {
  return items.slice(0, 8).map(item => {
    const recording = item.recording || item;
    return { recording_mbid: recording.id, duration_ms: recording.length || null, disambiguation: recording.disambiguation || "",
      artist_credit: creditText(recording["artist-credit"]), selected_release_mbid: item.release?.id || "", evidence_tier: item.tier ?? null };
  });
}

async function classifyEntry(entry, previous, mb, catalogue) {
  const placeholder = catalogue.placeholders?.[String(entry.chart_id)];
  if (!placeholder) return { ...entry, category: "REVIEW", reason: "second_pass_missing_current_placeholder", final: true };
  if (Number(placeholder.rating_rows) > 0) return { ...entry, category: "REVIEW", reason: "rated_placeholder_protected", rating_rows: Number(placeholder.rating_rows), final: true };
  if (placeholder.song_id || Number(placeholder.song_occurrences) > 0 || placeholder.musicbrainz_recording_id) {
    return { ...entry, category: "REVIEW", reason: "placeholder_identity_changed_since_first_pass", final: true };
  }
  const exact = catalogue.exact_links?.[String(entry.chart_id)];
  if (exact) return { ...previous, ...entry, category: "SAFE", reason: "unique_existing_bom_title_artist_and_recording_identity",
    recording_mbid: exact.recording_mbid, existing_song_id: exact.song_id, existing_canonical_id: exact.canonical_song_id,
    existing_album_id: exact.album_id, final: true };
  let strict, fallback;
  try {
    strict = await mb.get(mb.searchUrl(entry));
    fallback = await mb.get(mb.fallbackSearchUrl(entry));
  } catch (error) {
    return { ...entry, category: "REVIEW", reason: `second_pass_search_failed: ${error.message}`, final: false };
  }
  const recordings = [...new Map([...(strict.recordings || []), ...(fallback.recordings || [])].map(row => [row.id, row])).values()];
  const selected = selectSecondPassEvidence(entry, recordings);
  if (selected.category !== "PENDING_VALIDATION") return { ...entry, category: selected.category, reason: selected.reason,
    candidate_evidence: candidateEvidence(selected.candidates), final: true };
  let release;
  try { release = await mb.get(mb.releaseUrl(selected.release.id)); }
  catch (error) { return { ...entry, category: "REVIEW", reason: `second_pass_release_failed: ${error.message}`,
    candidate_evidence: candidateEvidence(selected.candidates), final: false }; }
  const track = (release.media || []).flatMap(medium => medium.tracks || []).find(value => value.recording?.id === selected.recording.id);
  if (!track) return { ...entry, category: "REVIEW", reason: "second_pass_release_missing_selected_recording",
    candidate_evidence: candidateEvidence(selected.candidates), final: true };
  const accepted = [...new Set([creditText(track["artist-credit"] || []), creditText(track.recording?.["artist-credit"] || []),
    creditText(selected.recording["artist-credit"] || [])].filter(Boolean))];
  const manifestEntry = { artist: entry.artist, title: entry.title, recording_mbid: selected.recording.id,
    release_group_mbid: release["release-group"]?.id, source_release_mbid: release.id,
    source_album_title: release.title, source_album_artist: creditText(release["artist-credit"]), source_release_country: release.country || "",
    track_position: Number(track.position), duration_ms: track.length || selected.recording.length, duration_tolerance_ms: 5000,
    accepted_artist_credits: accepted, version_note: "second-pass verified commercial recording" };
  try { validateMusicBrainzRelease(manifestEntry, release); }
  catch (error) { return { ...entry, category: "REVIEW", reason: `second_pass_validation_failed: ${error.message}`,
    candidate_evidence: candidateEvidence(selected.candidates), final: true }; }
  const existing = catalogue.recordings?.[selected.recording.id];
  return { ...entry, category: "SAFE", reason: existing ? "second_pass_verified_existing_bom_recording" : `second_pass_verified_evidence_tier_${selected.tier}`,
    recording_mbid: selected.recording.id, artist_credit: creditText(selected.recording["artist-credit"]), duration_ms: track.length || selected.recording.length,
    source_release_mbid: release.id, source_release_title: release.title, source_release_date: release.date || "",
    source_release_artist: creditText(release["artist-credit"]), source_release_country: release.country || "",
    release_group_mbid: release["release-group"].id, track_position: Number(track.position), accepted_artist_credits: accepted,
    existing_song_id: existing?.song_id || "", existing_canonical_id: existing?.canonical_song_id || "",
    existing_album_id: existing?.album_id || "", candidate_evidence: candidateEvidence(selected.candidates), final: true };
}

export function quarantineSecondPassDuplicates(results) {
  const seen = new Map();
  return results.map(row => {
    if (row.category !== "SAFE" || row.existing_song_id || !row.recording_mbid) return row;
    const first = seen.get(row.recording_mbid);
    if (!first) { seen.set(row.recording_mbid, row.chart_id); return row; }
    return { ...row, category: "REVIEW", reason: `second_pass_duplicate_new_recording_requires_sequenced_link_after_chart_${first}` };
  });
}

async function main() {
  if (process.argv.includes("--commit")) throw new Error("Second-pass discovery is read-only and does not support --commit.");
  const review = parseCsv(await readFile(resolve(option("review-input")), "utf8"));
  const unavailable = parseCsv(await readFile(resolve(option("unavailable-input")), "utf8"));
  const entries = [...review, ...unavailable].map(row => ({ chart_id: Number(row.chart_id), chart_year: Number(row.chart_year), artist: row.artist, title: row.title }));
  if (entries.length !== 742) throw new Error(`Second pass requires the reconciled 742 exclusions; received ${entries.length}.`);
  const catalogue = JSON.parse(await readFile(resolve(option("catalogue-check")), "utf8"));
  const firstState = JSON.parse(await readFile(resolve(option("first-state")), "utf8"));
  const statePath = resolve(option("state")); let state = { results: {} };
  try { state = JSON.parse(await readFile(statePath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const mb = new CachedMusicBrainz(resolve(option("cache")), Number(option("interval-ms", "1100"))); await mb.load();
  const batchSize = Number(option("batch-size", "25"));
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25) throw new Error("Batch size must be between 1 and 25.");
  for (let offset = 0; offset < entries.length; offset += batchSize) {
    for (const entry of entries.slice(offset, offset + batchSize)) {
      const prior = state.results[String(entry.chart_id)];
      if (prior?.final && !process.argv.includes("--refresh")) continue;
      state.results[String(entry.chart_id)] = await classifyEntry(entry, firstState.results?.[String(entry.chart_id)] || {}, mb, catalogue);
      await mkdir(dirname(statePath), { recursive: true }); await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    }
    const completed = entries.slice(0, offset + batchSize).map(row => state.results[String(row.chart_id)]).filter(Boolean);
    console.log(JSON.stringify({ batch: Math.floor(offset / batchSize) + 1, completed: completed.length, ...discoverySummary(completed).totals,
      requests: mb.requests, cache_hits: mb.cacheHits }));
  }
  let results = entries.map(entry => state.results[String(entry.chart_id)]);
  reconcileResults(entries, results); results = quarantineSecondPassDuplicates(results);
  for (const row of results) state.results[String(row.chart_id)] = row;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const safe = results.filter(row => row.category === "SAFE"), reviewRows = results.filter(row => row.category === "REVIEW"), unavailableRows = results.filter(row => row.category === "UNAVAILABLE");
  await writeFile(resolve(option("review-output")), resultsCsv(reviewRows));
  await writeFile(resolve(option("unavailable-output")), resultsCsv(unavailableRows));
  const manifest = { schema_version: 1, pilot: "historical-uk-number-ones-second-pass-v1", expected_chart_rows: safe.length,
    entries: safe.map(row => ({ chart_row_id: row.chart_id, chart_year: row.chart_year, title: row.title, artist: row.artist,
      placeholder_canonical_id: catalogue.placeholders[String(row.chart_id)].canonical_song_id, action: row.existing_song_id ? "link_existing" : "import_verified",
      existing_song_id: row.existing_song_id || null, existing_canonical_id: row.existing_canonical_id || null,
      recording_mbid: row.recording_mbid, release_group_mbid: row.release_group_mbid || null, source_release_mbid: row.source_release_mbid || null,
      source_album_title: row.source_release_title || null, source_album_artist: row.source_release_artist || row.artist,
      source_release_country: row.source_release_country || null, track_position: row.track_position || null, duration_ms: row.duration_ms || null,
      accepted_artist_credits: row.accepted_artist_credits || [row.artist_credit].filter(Boolean), duration_tolerance_ms: 5000,
      reuse_album_id: row.existing_album_id || null, version_note: "second-pass verified commercial recording" })) };
  await writeFile(resolve(option("manifest-output")), `${JSON.stringify(manifest, null, 2)}\n`);
  const releases = {}; for (const row of safe.filter(row => row.source_release_mbid)) releases[row.source_release_mbid] = mb.cache[mb.releaseUrl(row.source_release_mbid)];
  await writeFile(resolve(option("release-cache-output")), `${JSON.stringify(releases)}\n`);
  const summary = { generated_at: new Date().toISOString(), ...discoverySummary(results), requests: mb.requests, cache_hits: mb.cacheHits };
  await writeFile(resolve(option("summary-output")), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ mode: "second_pass_dry_run", ...summary.totals, requests: mb.requests, cache_hits: mb.cacheHits }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
