#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { artistCompatible } from "./historical-uk-number-ones-discovery.mjs";
import { compactSnapshot, rowFingerprint } from "./historical-uk-number-ones-reconciliation-workflow.mjs";
import { normalise } from "./uk-number-ones-lib.mjs";

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const REJECTED = /\b(live|demo|bootleg|remix|karaoke|instrumental|cover|re[ -]?record(?:ed|ing)?|acoustic|session|video|mix|extended)\b/i;
const REJECTED_SECONDARY = new Set(["Live", "Remix", "DJ-mix", "Mixtape/Street", "Compilation"]);
const PROHIBITED = new Set(["--commit", "--execute", "--apply", "--production"]);
const WRITE_ENV = ["BOM_DATABASE_URL", "DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

function option(name, fallback = "") {
  const inline = process.argv.find(value => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function decodeHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function creditText(credit = []) {
  return credit.map(part => `${part.name || part.artist?.name || ""}${part.joinphrase || ""}`).join("").trim();
}

function compactCredit(credit = []) {
  return credit.map(part => ({ name: part.name || part.artist?.name || "", joinphrase: part.joinphrase || "" }));
}

function releaseYear(release) {
  const year = Number(String(release?.date || "").slice(0, 4));
  return Number.isInteger(year) && year > 1900 ? year : null;
}

function dateValue(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function isNotFound(error) {
  return /_http_404$/.test(String(error?.message || ""));
}

function responseBody(kind, body) {
  if (kind === "official_search") return { singles: (body?.results?.single || []).map(row => ({ title: row.title, artist: row.artist, url: row.url })) };
  if (kind === "official_song") return body;
  if (kind === "mb_isrc") return { isrc: body.isrc, recordings: (body.recordings || []).map(recording => ({
    id: recording.id, title: recording.title, length: recording.length || null, disambiguation: recording.disambiguation || "",
    first_release_date: recording["first-release-date"] || "", artist_credit: compactCredit(recording["artist-credit"])
  })) };
  if (kind === "mb_recording") return {
    id: body.id, title: body.title, length: body.length || null, disambiguation: body.disambiguation || "", isrcs: body.isrcs || [],
    first_release_date: body["first-release-date"] || "", artist_credit: compactCredit(body["artist-credit"]),
    releases: (body.releases || []).map(release => ({ id: release.id, status: release.status, title: release.title,
      date: release.date || "", country: release.country || "", disambiguation: release.disambiguation || "",
      release_group: release["release-group"] ? { id: release["release-group"].id, title: release["release-group"].title,
        primary_type: release["release-group"]["primary-type"] || "", secondary_types: release["release-group"]["secondary-types"] || [] } : null }))
  };
  if (kind === "mb_release") return {
    id: body.id, status: body.status, title: body.title, date: body.date || "", country: body.country || "",
    disambiguation: body.disambiguation || "", artist_credit: compactCredit(body["artist-credit"]),
    release_group: body["release-group"] ? { id: body["release-group"].id, title: body["release-group"].title,
      primary_type: body["release-group"]["primary-type"] || "", secondary_types: body["release-group"]["secondary-types"] || [] } : null,
    media: (body.media || []).map(medium => ({ position: medium.position, tracks: (medium.tracks || []).map(track => ({
      position: track.position, number: track.number, title: track.title, length: track.length || null,
      artist_credit: compactCredit(track["artist-credit"]), recording: track.recording ? { id: track.recording.id,
        title: track.recording.title, length: track.recording.length || null, disambiguation: track.recording.disambiguation || "",
        artist_credit: compactCredit(track.recording["artist-credit"]) } : null
    })) }))
  };
  return body;
}

export class ShardedCache {
  constructor(directory) { this.directory = resolve(directory); this.entries = {}; this.shards = new Map(); this.writeQueues = new Map(); }
  shard(url) { return createHash("sha256").update(url).digest("hex")[0]; }
  async load() {
    await mkdir(this.directory, { recursive: true });
    for (const name of (await readdir(this.directory)).filter(name => /^[0-9a-f]\.json$/.test(name))) {
      const values = JSON.parse(await readFile(join(this.directory, name), "utf8"));
      Object.assign(this.entries, values); this.shards.set(name[0], values);
    }
  }
  get(url) { return this.entries[url]; }
  async set(url, value) {
    const key = this.shard(url), values = this.shards.get(key) || {};
    values[url] = value; this.entries[url] = value; this.shards.set(key, values);
    const previous = this.writeQueues.get(key) || Promise.resolve();
    const next = previous.then(() => writeFile(join(this.directory, `${key}.json`), `${JSON.stringify(values, null, 2)}\n`));
    this.writeQueues.set(key, next); await next;
  }
}

export class EvidenceFetcher {
  constructor({ officialCache, musicbrainzCache, baseMusicbrainzCache = {}, officialIntervalMs = 1100, musicbrainzIntervalMs = 1100, fetchImpl = fetch }) {
    this.officialCache = officialCache; this.musicbrainzCache = musicbrainzCache; this.baseMusicbrainzCache = baseMusicbrainzCache;
    this.intervals = { "backstage.officialcharts.com": officialIntervalMs, "www.officialcharts.com": officialIntervalMs, "musicbrainz.org": musicbrainzIntervalMs };
    this.nextStart = {}; this.startQueues = {}; this.fetchImpl = fetchImpl; this.metrics = { official_requests: 0, musicbrainz_requests: 0, cache_hits: 0 };
  }
  async wait(host) {
    const interval = this.intervals[host] || 1100, previous = this.startQueues[host] || Promise.resolve();
    const next = previous.then(async () => {
      const remaining = Math.max(0, (this.nextStart[host] || 0) - Date.now());
      if (remaining) await new Promise(done => setTimeout(done, remaining));
      this.nextStart[host] = Date.now() + interval;
    });
    this.startQueues[host] = next.catch(() => {}); await next;
  }
  async get(url, kind, text = false) {
    const host = new URL(url).hostname, cache = host.includes("officialcharts.com") ? this.officialCache : this.musicbrainzCache;
    const cached = cache.get(url) ?? this.baseMusicbrainzCache[url];
    if (cached !== undefined) { this.metrics.cache_hits += 1; return cached; }
    await this.wait(host);
    let response;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 25000);
      try { response = await this.fetchImpl(url, { headers: { Accept: text ? "text/html" : "application/json", "User-Agent": "BankOfMusic-HistoricalReconciliation/1.0 (https://thebankofmusic.com/)" }, signal: controller.signal }); }
      finally { clearTimeout(timeout); }
      if (response.ok || ![429, 502, 503, 504].includes(response.status) || attempt === 3) break;
      const retryAfter = Math.min(60, Math.max(1, Number(response.headers.get("retry-after")) || 2));
      await new Promise(done => setTimeout(done, retryAfter * 1000));
    }
    if (!response?.ok) throw new Error(`${host}_http_${response?.status || "network"}`);
    let body;
    if (text) {
      const html = await response.text();
      if (html.length > 2_000_000) throw new Error(`${host}_response_too_large`);
      body = { catalogue_numbers: parseOfficialChartCatalogueNumbers(html) };
    } else body = responseBody(kind, await response.json());
    await cache.set(url, body);
    if (host === "musicbrainz.org") this.metrics.musicbrainz_requests += 1; else this.metrics.official_requests += 1;
    return body;
  }
}

export function parseOfficialChartCatalogueNumbers(html) {
  return [...new Set([...String(html).matchAll(/Catalogue number<\/span><span[^>]*>([^<]+)<\/span>/gi)]
    .map(match => decodeHtml(match[1]).replace(/\s+/g, "").toUpperCase()).filter(Boolean))];
}

export function selectOfficialChartResult(entry, search) {
  const exact = (search?.singles || []).filter(result => normalise(result.title) === normalise(entry.title) && artistCompatible(entry.artist, result.artist));
  const urls = [...new Set(exact.map(result => String(result.url || "").replace(/\/$/, "")))];
  if (!urls.length) return { reason: "official_charts_exact_title_artist_not_found" };
  if (urls.length > 1) return { reason: "official_charts_multiple_exact_title_artist_pages", candidates: urls };
  if (!urls[0].startsWith("https://www.officialcharts.com/songs/")) return { reason: "official_charts_song_url_invalid" };
  return { url: `${urls[0]}/` };
}

function selectRecording(entry, isrcResult) {
  const exact = (isrcResult?.recordings || []).filter(recording => normalise(recording.title) === normalise(entry.title) &&
    artistCompatible(entry.artist, creditText(recording.artist_credit)) && !REJECTED.test(`${recording.title} ${recording.disambiguation}`));
  if (!exact.length) return { reason: "musicbrainz_isrc_has_no_exact_title_artist_recording" };
  const ranked = exact.map(recording => ({ recording, distance: Math.abs((releaseYear({ date: recording.first_release_date }) || 9999) - entry.chart_year) }))
    .sort((a, b) => a.distance - b.distance || String(a.recording.id).localeCompare(String(b.recording.id)));
  if (ranked.length > 1 && ranked[0].distance === ranked[1].distance) return { reason: "musicbrainz_isrc_has_multiple_exact_recordings", candidates: exact.map(row => row.id) };
  return { recording: ranked[0].recording };
}

function eligibleRelease(entry, release) {
  const year = releaseYear(release), secondary = release.release_group?.secondary_types || [];
  return release.status === "Official" && year && year >= entry.chart_year - 5 && year <= entry.chart_year + 1 &&
    !secondary.some(value => REJECTED_SECONDARY.has(value)) && !REJECTED.test(`${release.title} ${release.disambiguation}`);
}

export function rankReleases(entry, releases) {
  const chartDate = dateValue(entry.first_number_one_date) || Date.UTC(entry.chart_year, 11, 31);
  return releases.filter(release => eligibleRelease(entry, release)).sort((a, b) => {
    const aDate = dateValue(a.date) || 0, bDate = dateValue(b.date) || 0;
    const aBefore = aDate <= chartDate ? 0 : 1, bBefore = bDate <= chartDate ? 0 : 1;
    const aSingle = a.release_group?.primary_type === "Single" ? 0 : 1, bSingle = b.release_group?.primary_type === "Single" ? 0 : 1;
    const aTitle = normalise(a.release_group?.title || a.title) === normalise(entry.title) ? 0 : 1;
    const bTitle = normalise(b.release_group?.title || b.title) === normalise(entry.title) ? 0 : 1;
    const aCountry = a.country === "GB" ? 0 : a.country === "XW" ? 1 : 2, bCountry = b.country === "GB" ? 0 : b.country === "XW" ? 1 : 2;
    return aBefore - bBefore || aSingle - bSingle || aTitle - bTitle || aCountry - bCountry ||
      Math.abs(chartDate - aDate) - Math.abs(chartDate - bDate) || String(a.id).localeCompare(String(b.id));
  });
}

function releaseEvidence(entry, officialUrl, isrc, recording, details, release, catalogue) {
  const tracks = (release.media || []).flatMap(medium => (medium.tracks || []).map(track => ({ ...track, medium_position: medium.position })));
  const occurrences = tracks.filter(track => track.recording?.id === recording.id);
  if (occurrences.length !== 1) return { reason: "exact_release_recording_occurrence_not_unique" };
  const track = occurrences[0], artist = creditText(track.artist_credit?.length ? track.artist_credit : track.recording?.artist_credit);
  if (normalise(track.title) !== normalise(entry.title) || !artistCompatible(entry.artist, artist)) return { reason: "exact_release_track_identity_mismatch" };
  if (REJECTED.test(`${track.title} ${track.recording?.title} ${track.recording?.disambiguation}`)) return { reason: "exact_release_track_version_rejected" };
  const duration = track.length || track.recording?.length || details.length || recording.length;
  if (!Number.isInteger(duration) || duration < 30000) return { reason: "exact_release_track_duration_missing" };
  const existing = catalogue.recordings?.[recording.id] || null;
  return { evidence: {
    status: "independently_verified", title: entry.title, artist: entry.artist,
    official_charts_url: officialUrl, official_charts_isrc: isrc,
    recording_mbid: recording.id, musicbrainz_recording_url: `https://musicbrainz.org/recording/${recording.id}`,
    recording_isrcs: details.isrcs, release_mbid: release.id, musicbrainz_release_url: `https://musicbrainz.org/release/${release.id}`,
    release_group_mbid: release.release_group.id, release_status: release.status, release_date: release.date,
    release_country: release.country, release_title: release.title, medium_position: track.medium_position,
    track_position: Number(track.position), track_recording_mbid: track.recording.id, release_recording_occurrences: occurrences.length,
    release_track_count: tracks.length, duration_ms: duration,
    version_notes: "Exact title, artist and ISRC; official MusicBrainz release track has no prohibited live, remix, cover or alternate-version markers.",
    risk_notes: tracks.length > 1 ? `Selected-track import: track ${track.position} only from a ${tracks.length}-track official release.` : "Single-track official release.",
    action: existing ? "existing_recording" : "safe_import", existing_song_id: existing?.song_id || null,
    reuse_album_id: catalogue.releases?.[release.id]?.album_id || catalogue.release_groups?.[release.release_group.id]?.album_id || null
  } };
}

export async function retrieveEntryEvidence(entry, fetcher, catalogue = {}, seededChartEvidence = null) {
  let officialUrl = seededChartEvidence?.url || null, catalogueNumbers = seededChartEvidence?.catalogue_number ? [seededChartEvidence.catalogue_number] : null;
  if (!officialUrl) {
    const url = `https://backstage.officialcharts.com/ajax/search-suggestions?terms=${encodeURIComponent(entry.title)}`;
    const selected = selectOfficialChartResult(entry, await fetcher.get(url, "official_search"));
    if (!selected.url) return selected;
    officialUrl = selected.url;
  }
  if (!catalogueNumbers) catalogueNumbers = (await fetcher.get(officialUrl, "official_song", true)).catalogue_numbers;
  const isrcs = [...new Set(catalogueNumbers.filter(value => ISRC.test(value)))];
  if (!isrcs.length) return { reason: "official_charts_page_has_no_isrc", official_charts_url: officialUrl, catalogue_numbers: catalogueNumbers };
  if (isrcs.length > 1) return { reason: "official_charts_page_has_multiple_isrcs", official_charts_url: officialUrl, isrcs };
  const isrc = isrcs[0], sourceIsrcs = [...new Set([entry.isrc, ...(entry.source_isrcs || [])].filter(Boolean))];
  if (sourceIsrcs.length && !sourceIsrcs.includes(isrc)) return { reason: "official_charts_isrc_conflicts_with_stored_evidence", official_charts_url: officialUrl, isrc };
  const isrcUrl = `https://musicbrainz.org/ws/2/isrc/${isrc}?inc=artist-credits+releases&fmt=json`;
  let isrcResult;
  try { isrcResult = await fetcher.get(isrcUrl, "mb_isrc"); }
  catch (error) { if (isNotFound(error)) return { reason: "musicbrainz_isrc_not_found", official_charts_url: officialUrl, isrc }; throw error; }
  const selected = selectRecording(entry, isrcResult);
  if (!selected.recording) return { ...selected, official_charts_url: officialUrl, isrc };
  const recording = selected.recording;
  if (entry.musicbrainz_recording_id && entry.musicbrainz_recording_id.toLowerCase() !== recording.id.toLowerCase()) return { reason: "musicbrainz_recording_conflicts_with_stored_evidence", official_charts_url: officialUrl, isrc, recording_mbid: recording.id };
  const recordingUrl = `https://musicbrainz.org/ws/2/recording/${recording.id}?inc=isrcs+artist-credits+releases+release-groups&fmt=json`;
  let details;
  try { details = await fetcher.get(recordingUrl, "mb_recording"); }
  catch (error) { if (isNotFound(error)) return { reason: "musicbrainz_recording_not_found", official_charts_url: officialUrl, isrc, recording_mbid: recording.id }; throw error; }
  if (!(details.isrcs || []).includes(isrc)) return { reason: "musicbrainz_recording_does_not_confirm_official_isrc", official_charts_url: officialUrl, isrc, recording_mbid: recording.id };
  const releases = rankReleases(entry, details.releases || []);
  if (!releases.length) return { reason: "musicbrainz_no_contemporary_official_release", official_charts_url: officialUrl, isrc, recording_mbid: recording.id };
  let lastFailure = "musicbrainz_no_exact_release_track_validated";
  for (const summary of releases.slice(0, 8)) {
    const releaseUrl = `https://musicbrainz.org/ws/2/release/${summary.id}?inc=recordings+artist-credits+release-groups&fmt=json`;
    let release;
    try { release = await fetcher.get(releaseUrl, "mb_release"); }
    catch (error) { if (isNotFound(error)) { lastFailure = "musicbrainz_release_not_found"; continue; } throw error; }
    const result = releaseEvidence(entry, officialUrl, isrc, recording, details, release, catalogue);
    if (result.evidence) return result;
    lastFailure = result.reason;
  }
  return { reason: lastFailure, official_charts_url: officialUrl, isrc, recording_mbid: recording.id };
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(resolve(path), "utf8")); }
  catch (error) { if (error.code === "ENOENT" && fallback !== null) return fallback; throw error; }
}
async function writeJson(path, value) { await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(resolve(path), `${JSON.stringify(value, null, 2)}\n`); }

async function main() {
  const prohibited = process.argv.find(value => PROHIBITED.has(value.split("=")[0]));
  if (prohibited) throw new Error(`Read-only evidence retrieval rejects ${prohibited} before reading inputs.`);
  const leaked = WRITE_ENV.find(name => process.env[name]);
  if (leaked) throw new Error(`Read-only evidence retrieval refuses write-capable environment variable ${leaked}.`);
  const snapshot = compactSnapshot(await readJson(option("snapshot")));
  const statePath = option("state"), evidenceOutput = option("evidence-output"), failuresOutput = option("failures-output");
  if (!statePath || !evidenceOutput || !failuresOutput || !option("official-cache-dir") || !option("musicbrainz-cache-dir")) throw new Error("State, evidence/failure outputs and both cache directories are required.");
  const state = await readJson(statePath, { schema_version: 1, results: {}, metrics: {} });
  const officialCache = new ShardedCache(option("official-cache-dir")), musicbrainzCache = new ShardedCache(option("musicbrainz-cache-dir"));
  await officialCache.load(); await musicbrainzCache.load();
  const baseMusicbrainzCache = option("base-musicbrainz-cache") ? await readJson(option("base-musicbrainz-cache"), {}) : {};
  const chartEvidence = option("chart-evidence") ? await readJson(option("chart-evidence"), { entries: {} }) : { entries: {} };
  const catalogue = option("catalogue-snapshot") ? await readJson(option("catalogue-snapshot"), {}) : {};
  const fetcher = new EvidenceFetcher({ officialCache, musicbrainzCache, baseMusicbrainzCache,
    officialIntervalMs: Number(option("official-interval-ms", "1100")), musicbrainzIntervalMs: Number(option("musicbrainz-interval-ms", "1100")) });
  let completed = 0;
  const concurrency = Number(option("concurrency", "4"));
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("Concurrency must be between 1 and 8.");
  const processEntry = async entry => {
    const key = String(entry.id), fingerprint = rowFingerprint(entry), previous = state.results[key];
    if (previous?.final && previous.row_fingerprint === fingerprint && !process.argv.includes("--refresh")) return;
    try {
      const result = await retrieveEntryEvidence(entry, fetcher, catalogue, chartEvidence.entries?.[key]);
      state.results[key] = { chart_row_id: entry.id, title: entry.title, artist: entry.artist, chart_year: entry.chart_year,
        row_fingerprint: fingerprint, ...result, final: true };
    } catch (error) {
      state.results[key] = { chart_row_id: entry.id, title: entry.title, artist: entry.artist, chart_year: entry.chart_year,
        row_fingerprint: fingerprint, reason: `retrieval_failed:${error.message}`, final: false };
    }
  };
  for (let offset = 0; offset < snapshot.rows.length; offset += concurrency) {
    await Promise.all(snapshot.rows.slice(offset, offset + concurrency).map(processEntry));
    completed = Math.min(snapshot.rows.length, offset + concurrency); state.metrics = { ...fetcher.metrics, completed, total: snapshot.rows.length };
    await writeJson(statePath, state);
    if (completed % 20 === 0 || completed === snapshot.rows.length) console.log(JSON.stringify({ ...state.metrics, verified: Object.values(state.results).filter(row => row.evidence).length }));
  }
  const ordered = snapshot.rows.map(row => state.results[String(row.id)]);
  const evidence = Object.fromEntries(ordered.filter(row => row?.evidence).map(row => [String(row.chart_row_id), row.evidence]));
  const failures = ordered.filter(row => !row?.evidence).map(row => ({ chart_row_id: row.chart_row_id, chart_year: row.chart_year,
    title: row.title, artist: row.artist, reason: row.reason, final: row.final }));
  await writeJson(evidenceOutput, { schema_version: 1, generated_at: new Date().toISOString(), entries: evidence });
  await writeJson(failuresOutput, { schema_version: 1, generated_at: new Date().toISOString(), failures });
  console.log(JSON.stringify({ scanned: ordered.length, verified: Object.keys(evidence).length, unresolved: failures.length, ...fetcher.metrics }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
