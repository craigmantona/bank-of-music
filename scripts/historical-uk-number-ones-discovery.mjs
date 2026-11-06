#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalise, validateMusicBrainzRelease } from "./historical-uk-number-ones-pilot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REJECTED = /\b(live|demo|bootleg|remix|karaoke|instrumental|cover|re[ -]?record(?:ed|ing)?|acoustic|session|video|mix|extended intro)\b/i;
const REJECTED_SECONDARY = new Set(["Live", "Remix", "DJ-mix", "Mixtape/Street"]);

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  const inline = process.argv.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export function artistKey(value) {
  return normalise(value).replace(/\b(the|feat(?:uring)?|ft|with|and|vs)\b/g, " ").replace(/\s+/g, " ").trim();
}

function creditText(credit = []) {
  return credit.map(part => `${part.name || part.artist?.name || ""}${part.joinphrase || ""}`).join("").trim();
}

function compactCredit(credit = []) {
  return credit.map(part => ({ name: part.name || part.artist?.name || "", joinphrase: part.joinphrase || "",
    artist: part.artist ? { id: part.artist.id, name: part.artist.name } : undefined }));
}

function compactResponse(url, body) {
  if (url.includes("/recording/?query=")) return { count: body.count, recordings: (body.recordings || []).map(recording => ({
    id: recording.id, score: recording.score, title: recording.title, length: recording.length,
    disambiguation: recording.disambiguation || "", "artist-credit": compactCredit(recording["artist-credit"]),
    releases: (recording.releases || []).map(release => ({ id: release.id, status: release.status, title: release.title,
      date: release.date, country: release.country, disambiguation: release.disambiguation || "",
      "release-group": release["release-group"] ? { id: release["release-group"].id, title: release["release-group"].title,
        "primary-type": release["release-group"]["primary-type"], "secondary-types": release["release-group"]["secondary-types"] || [] } : null }))
  })) };
  if (url.includes("/release/")) return { id: body.id, status: body.status, title: body.title, date: body.date,
    country: body.country, disambiguation: body.disambiguation || "", "artist-credit": compactCredit(body["artist-credit"]),
    "release-group": body["release-group"] ? { id: body["release-group"].id, title: body["release-group"].title,
      "primary-type": body["release-group"]["primary-type"], "secondary-types": body["release-group"]["secondary-types"] || [] } : null,
    media: (body.media || []).map(medium => ({ position: medium.position, format: medium.format,
      tracks: (medium.tracks || []).map(track => ({ position: track.position, number: track.number, title: track.title,
        length: track.length, "artist-credit": compactCredit(track["artist-credit"]), recording: track.recording ? {
          id: track.recording.id, title: track.recording.title, length: track.recording.length,
          disambiguation: track.recording.disambiguation || "", "artist-credit": compactCredit(track.recording["artist-credit"])
        } : null })) })) };
  return body;
}

export function artistCompatible(expected, credit) {
  const a = new Set(artistKey(expected).split(" ").filter(Boolean));
  const b = new Set(artistKey(credit).split(" ").filter(Boolean));
  return a.size > 0 && [...a].every(token => b.has(token)) && [...b].every(token => a.has(token));
}

function releaseYear(release) {
  const year = Number(String(release.date || "").slice(0, 4));
  return Number.isInteger(year) && year > 1900 ? year : null;
}

function trackFor(release, recordingId) {
  return (release.media || []).flatMap(medium => medium.tracks || medium.track || [])
    .find(track => track.recording?.id === recordingId || !track.recording);
}

export function eligibleCandidates(entry, search, minScore = 90) {
  return (search.recordings || []).filter(recording => {
    if (Number(recording.score || 0) < minScore || normalise(recording.title) !== normalise(entry.title)) return false;
    if (!artistCompatible(entry.artist, creditText(recording["artist-credit"]))) return false;
    if (REJECTED.test(`${recording.title || ""} ${recording.disambiguation || ""}`)) return false;
    return (recording.releases || []).some(release => {
      const year = releaseYear(release);
      const secondary = release["release-group"]?.["secondary-types"] || [];
      return release.status === "Official" && !secondary.some(value => REJECTED_SECONDARY.has(value)) &&
        !REJECTED.test(`${release.title || ""} ${release.disambiguation || ""}`) &&
        (!year || year <= entry.chart_year + 1);
    });
  });
}

function strongSourceReleases(entry, recording) {
  return (recording.releases || []).filter(release => {
    const year = releaseYear(release);
    const secondary = release["release-group"]?.["secondary-types"] || [];
    return release.status === "Official" && year && year >= entry.chart_year - 5 && year <= entry.chart_year + 1 &&
      normalise(release["release-group"]?.title || release.title) === normalise(entry.title) &&
      !secondary.some(value => REJECTED_SECONDARY.has(value) || value === "Compilation") &&
      !REJECTED.test(`${release.title || ""} ${release.disambiguation || ""}`);
  });
}

export function selectRelease(entry, recording) {
  const strong = strongSourceReleases(entry, recording);
  const eligible = (strong.length ? strong : recording.releases || []).filter(release => {
    const year = releaseYear(release);
    const secondary = release["release-group"]?.["secondary-types"] || [];
    return release.status === "Official" && !secondary.some(value => REJECTED_SECONDARY.has(value)) &&
      !REJECTED.test(`${release.title || ""} ${release.disambiguation || ""}`) &&
      (!year || year <= entry.chart_year + 1);
  });
  return eligible.sort((a, b) => {
    const aCountry = a.country === "GB" ? 0 : 1, bCountry = b.country === "GB" ? 0 : 1;
    const aYear = releaseYear(a) || 9999, bYear = releaseYear(b) || 9999;
    return aCountry - bCountry || aYear - bYear || String(a.id).localeCompare(String(b.id));
  })[0] || null;
}

export function classifySearch(entry, search, minScore = 90) {
  const candidates = eligibleCandidates(entry, search, minScore);
  if (!candidates.length) return { category: "UNAVAILABLE", reason: "no_exact_artist_title_official_release", candidates: [] };
  const strong = candidates.filter(recording => strongSourceReleases(entry, recording).length > 0);
  if (strong.length > 1) return { category: "REVIEW", reason: "multiple_recordings_with_contemporary_official_source_releases", candidates };
  if (!strong.length && candidates.length > 1) return { category: "REVIEW", reason: "multiple_plausible_recordings", candidates };
  if (!strong.length) return { category: "REVIEW", reason: "no_contemporary_official_source_release", candidates };
  const recording = strong[0] || candidates[0], release = selectRelease(entry, recording);
  if (!release?.["release-group"]?.id) return { category: "REVIEW", reason: "official_release_missing_release_group", candidates };
  return { category: "PENDING_VALIDATION", reason: "unique_search_candidate", candidates, recording, release };
}

function lucene(value) { return String(value).replace(/([+\-!(){}\[\]^"~*?:\\/])/g, "\\$1"); }

export class CachedMusicBrainz {
  constructor(cachePath, intervalMs = 1100) { this.cachePath = cachePath; this.intervalMs = intervalMs; this.cache = {}; this.requests = 0; this.cacheHits = 0; this.lastRequestAt = 0; }
  async load() {
    try {
      const loaded = JSON.parse(await readFile(this.cachePath, "utf8"));
      this.cache = Object.fromEntries(Object.entries(loaded).map(([url, body]) => [url, compactResponse(url, body)]));
      await writeFile(this.cachePath, `${JSON.stringify(this.cache)}\n`);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  async get(url) {
    if (this.cache[url]) { this.cacheHits += 1; return this.cache[url]; }
    const wait = Math.max(0, this.intervalMs - (Date.now() - this.lastRequestAt));
    if (wait) await new Promise(done => setTimeout(done, wait));
    let response;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "BankOfMusic-HistoricalDiscovery/1.0 (https://thebankofmusic.com/)" } });
      this.lastRequestAt = Date.now();
      if (response.ok || ![429, 502, 503, 504].includes(response.status) || attempt === 2) break;
      await new Promise(done => setTimeout(done, this.intervalMs * 2));
    }
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    const body = compactResponse(url, await response.json());
    this.cache[url] = body; this.requests += 1;
    await mkdir(dirname(this.cachePath), { recursive: true });
    await writeFile(this.cachePath, `${JSON.stringify(this.cache)}\n`);
    return body;
  }
  searchUrl(entry) {
    const query = `recording:\"${lucene(entry.title)}\" AND artist:\"${lucene(entry.artist)}\"`;
    return `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=25`;
  }
  fallbackSearchUrl(entry) {
    const primaryArtist = String(entry.artist).split(/\b(?:feat(?:uring)?|ft\.?|with)\b/i)[0].trim();
    const query = `recording:\"${lucene(entry.title)}\" AND artist:\"${lucene(primaryArtist)}\"`;
    return `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=25`;
  }
  releaseUrl(id) { return `https://musicbrainz.org/ws/2/release/${id}?inc=recordings+artist-credits+release-groups&fmt=json`; }
}

function evidenceCandidates(candidates) {
  return candidates.slice(0, 8).map(recording => ({ recording_mbid: recording.id, duration_ms: recording.length || null,
    disambiguation: recording.disambiguation || "", artist_credit: creditText(recording["artist-credit"]),
    official_release_mbids: (recording.releases || []).filter(release => release.status === "Official").slice(0, 6).map(release => release.id) }));
}

export async function discoverEntry(entry, mb, catalogue = {}) {
  const previous = catalogue.results?.[String(entry.chart_id)];
  if (previous?.final && !catalogue.refresh) {
    if (previous.category === "SAFE") {
      const placeholder = catalogue.placeholders?.[String(entry.chart_id)];
      if (placeholder && (Number(placeholder.rating_rows) > 0 || Number(placeholder.song_occurrences) > 0 || placeholder.musicbrainz_recording_id)) {
        return { ...previous, category: "REVIEW", reason: "canonical_placeholder_is_not_empty_or_unrated", resumed: true };
      }
      const existing = catalogue.recordings?.[previous.recording_mbid];
      if (existing) return { ...previous, reason: "verified_existing_bom_recording", existing_song_id: existing.song_id, resumed: true };
    }
    return { ...previous, resumed: true };
  }
  let search;
  try { search = await mb.get(mb.searchUrl(entry)); }
  catch (error) { return { ...entry, category: "REVIEW", reason: `musicbrainz_search_failed: ${error.message}`, final: false }; }
  const initial = classifySearch(entry, search);
  if (initial.category === "UNAVAILABLE") {
    try {
      const fallback = classifySearch(entry, await mb.get(mb.fallbackSearchUrl(entry)), 75);
      if (fallback.category !== "UNAVAILABLE") return discoverValidated(entry, fallback, mb, catalogue);
    } catch (error) {
      return { ...entry, category: "REVIEW", reason: `musicbrainz_fallback_search_failed: ${error.message}`, final: false };
    }
  }
  return discoverValidated(entry, initial, mb, catalogue);
}

async function discoverValidated(entry, initial, mb, catalogue) {
  if (initial.category !== "PENDING_VALIDATION") return { ...entry, category: initial.category, reason: initial.reason,
    candidate_evidence: evidenceCandidates(initial.candidates), final: true };
  const recording = initial.recording, releaseSummary = initial.release;
  let release;
  try { release = await mb.get(mb.releaseUrl(releaseSummary.id)); }
  catch (error) { return { ...entry, category: "REVIEW", reason: `release_validation_failed: ${error.message}`,
    candidate_evidence: evidenceCandidates(initial.candidates), final: false }; }
  const track = (release.media || []).flatMap(medium => medium.tracks || []).find(value => value.recording?.id === recording.id);
  if (!track) return { ...entry, category: "REVIEW", reason: "selected_release_does_not_contain_recording",
    candidate_evidence: evidenceCandidates(initial.candidates), final: true };
  const manifestEntry = { artist: entry.artist, title: entry.title, recording_mbid: recording.id,
    release_group_mbid: release["release-group"]?.id, source_release_mbid: release.id,
    source_album_title: release.title, source_album_artist: creditText(release["artist-credit"]),
    source_release_country: release.country || "",
    track_position: track.position, duration_ms: track.length || recording.length,
    duration_tolerance_ms: 5000, accepted_artist_credits: [creditText(track["artist-credit"] || recording["artist-credit"])] };
  try { validateMusicBrainzRelease(manifestEntry, release); }
  catch (error) { return { ...entry, category: "REVIEW", reason: `pilot_validation_failed: ${error.message}`,
    candidate_evidence: evidenceCandidates(initial.candidates), final: true }; }
  const existing = catalogue.recordings?.[recording.id] || null;
  const existingAlbum = catalogue.releases?.[release.id] || catalogue.release_groups?.[release["release-group"].id] || null;
  const placeholder = catalogue.placeholders?.[String(entry.chart_id)];
  if (placeholder && (Number(placeholder.rating_rows) > 0 || Number(placeholder.song_occurrences) > 0 || placeholder.musicbrainz_recording_id)) {
    return { ...entry, category: "REVIEW", reason: "canonical_placeholder_is_not_empty_or_unrated",
      recording_mbid: recording.id, source_release_mbid: release.id, release_group_mbid: release["release-group"].id,
      candidate_evidence: evidenceCandidates(initial.candidates), final: true };
  }
  return { ...entry, category: "SAFE", reason: existing ? "verified_existing_bom_recording" : "verified_genuinely_missing_recording",
    recording_mbid: recording.id, artist_credit: creditText(recording["artist-credit"]), duration_ms: track.length || recording.length || null,
    source_release_mbid: release.id, source_release_title: release.title, source_release_date: release.date || "",
    source_release_artist: creditText(release["artist-credit"]), source_release_country: release.country || "", release_group_mbid: release["release-group"].id,
    track_position: track.position, existing_song_id: existing?.song_id || "", existing_album_id: existingAlbum?.album_id || "",
    candidate_evidence: evidenceCandidates(initial.candidates), final: true };
}

export function resultsCsv(results) {
  const headers = ["chart_id","chart_year","artist","title","category","reason","recording_mbid","artist_credit","duration_ms","source_release_mbid","source_release_title","source_release_artist","source_release_date","source_release_country","release_group_mbid","track_position","existing_song_id","existing_album_id","candidate_evidence"];
  const cell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return `${headers.join(",")}\n${results.map(row => headers.map(key => cell(key === "candidate_evidence" ? JSON.stringify(row[key] || []) : row[key])).join(",")).join("\n")}\n`;
}

async function main() {
  if (process.argv.includes("--commit")) throw new Error("Discovery is dry-run only and does not support --commit.");
  const sample = JSON.parse(await readFile(resolve(option("sample", resolve(HERE, "historical-uk-number-ones-discovery.sample.json"))), "utf8"));
  if (sample.entries?.length !== 25) throw new Error("Discovery sample must contain exactly 25 entries.");
  const cachePath = resolve(option("cache", resolve(HERE, ".cache/historical-uk-number-ones-discovery.json")));
  const statePath = resolve(option("state", resolve(HERE, ".cache/historical-uk-number-ones-discovery-state.json")));
  const outputPath = resolve(option("output", resolve(HERE, "../supabase/exports/historical-uk-number-ones-discovery-sample.csv")));
  const manifestPath = resolve(option("manifest-output", resolve(HERE, "historical-uk-number-ones-discovery.safe-manifest.json")));
  const releaseCachePath = resolve(option("release-cache-output", resolve(HERE, "../supabase/operations/historical-uk-number-ones-discovery-validated-releases.json")));
  const cataloguePath = option("catalogue-check");
  const catalogue = cataloguePath ? JSON.parse(await readFile(resolve(cataloguePath), "utf8")) : {};
  let state = { results: {} };
  try { state = JSON.parse(await readFile(statePath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  catalogue.results = state.results;
  catalogue.refresh = process.argv.includes("--refresh");
  const mb = new CachedMusicBrainz(cachePath, Number(option("interval-ms", "1100"))); await mb.load();
  for (const entry of sample.entries) {
    const result = await discoverEntry(entry, mb, catalogue);
    state.results[String(entry.chart_id)] = result;
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }
  const results = sample.entries.map(entry => state.results[String(entry.chart_id)]);
  await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, resultsCsv(results));
  const safe = results.filter(row => row.category === "SAFE");
  const manifest = { schema_version: 1, pilot: "historical-uk-number-ones-automated-discovery-sample-v1", expected_chart_rows: safe.length,
    entries: safe.map(row => ({ chart_row_id: row.chart_id, chart_year: row.chart_year, title: row.title, artist: row.artist,
      placeholder_canonical_id: catalogue.placeholders?.[String(row.chart_id)]?.canonical_song_id || null,
      recording_mbid: row.recording_mbid, release_group_mbid: row.release_group_mbid, source_release_mbid: row.source_release_mbid,
      source_album_title: row.source_release_title, source_album_artist: row.source_release_artist || row.artist,
      source_release_country: row.source_release_country, track_position: row.track_position, duration_ms: row.duration_ms,
      duration_tolerance_ms: 5000, reuse_album_id: row.existing_album_id || null, version_note: "automatically verified original chart recording on contemporary official source release" })) };
  if (manifest.entries.some(entry => !entry.placeholder_canonical_id)) throw new Error("SAFE manifest requires a current catalogue placeholder check.");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const validatedReleases = {};
  for (const row of safe) validatedReleases[row.source_release_mbid] = mb.cache[mb.releaseUrl(row.source_release_mbid)];
  await writeFile(releaseCachePath, `${JSON.stringify(validatedReleases)}\n`);
  const counts = Object.fromEntries(["SAFE","REVIEW","UNAVAILABLE"].map(category => [category, results.filter(row => row.category === category).length]));
  console.log(JSON.stringify({ mode: "discovery_dry_run", sample: results.length, ...counts, requests: mb.requests, cache_hits: mb.cacheHits,
    output: outputPath, safe_manifest: manifestPath, validated_release_cache: releaseCachePath }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
