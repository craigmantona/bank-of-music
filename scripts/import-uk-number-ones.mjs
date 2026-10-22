#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  applyMusicBrainzEnrichment, applyWikidata, matchCollectionEntries, musicBrainzSearchPath,
  canonicalRecordingSeed, normalise, parseNumberOneWikitext, sourcePagesForRange, summariseMatches,
  summariseMusicBrainzEnrichment, wikidataSparql
} from "./uk-number-ones-lib.mjs";

function option(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const startYear = Number(option("start-year", "1990"));
const endYear = Number(option("end-year", "1999"));
const commit = process.argv.includes("--commit");
const useMusicBrainz = process.argv.includes("--musicbrainz");
let supabaseUrl = process.env.SUPABASE_URL || "";
let supabaseKey = commit ? process.env.SUPABASE_SERVICE_ROLE_KEY : (process.env.SUPABASE_PUBLISHABLE_KEY || "");
if (!commit && (!supabaseUrl || !supabaseKey)) {
  const config = await readFile(new URL("../config.js", import.meta.url), "utf8");
  supabaseUrl ||= config.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1] || "";
  supabaseKey ||= config.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)?.[1] || "";
}
if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear) throw new Error("Invalid --start-year/--end-year range.");
if (commit && (!supabaseUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY)) throw new Error("--commit requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");

async function json(url, options) {
  const response = await fetch(url, { ...options, headers: { Accept: "application/json", "User-Agent": "BankOfMusic-WikimediaImporter/1.0 (manual proof import)", ...options?.headers } });
  if (!response.ok) {
    const error = new Error(`${url} returned HTTP ${response.status}`);
    error.status = response.status;
    error.retryAfter = Number(response.headers.get("retry-after") || 0);
    throw error;
  }
  return response.json();
}

const sourceFile = option("source-file");
const sourcePages = option("source-page") ? [option("source-page")] : sourcePagesForRange(startYear, endYear);
const sources = sourceFile
  ? [JSON.parse(await readFile(sourceFile, "utf8"))]
  : await Promise.all(sourcePages.map(page => json(`https://en.wikipedia.org/w/api.php?action=parse&page=${page}&prop=wikitext%7Crevid&format=json&formatversion=2`)));
const parsed = sources.flatMap((source, index) => parseNumberOneWikitext(source.parse.wikitext, {
  startYear, endYear, revision: source.parse.revid,
  sourceUrl: `https://en.wikipedia.org/wiki/${sourceFile ? source.parse.title.replaceAll(" ", "_") : sourcePages[index]}`
}));
const sparql = wikidataSparql(parsed.flatMap(row => row.article_titles));
const wikidataFile = option("wikidata-file");
const enrichedResponse = wikidataFile ? JSON.parse(await readFile(wikidataFile, "utf8")) : await json("https://query.wikidata.org/sparql", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
  body: new URLSearchParams({ query: sparql, format: "json" })
});
if (option("wikidata-output")) await writeFile(option("wikidata-output"), `${JSON.stringify(enrichedResponse)}\n`);

let songs = [];
const songsFile = option("songs-file");
if (songsFile) songs = JSON.parse(await readFile(songsFile, "utf8"));
else if (supabaseUrl && supabaseKey) {
  for (let offset = 0; ; offset += 1000) {
    const page = await json(`${supabaseUrl}/rest/v1/songs?select=id,title,artist,external_source,external_id,spotify_track_id,canonical_song_id,is_deleted&order=id.asc`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Range: `${offset}-${offset + 999}` } });
    songs.push(...page);
    if (page.length < 1000) break;
  }
}

let matched = matchCollectionEntries(applyWikidata(parsed, enrichedResponse.results?.bindings), songs);
const report = { range: `${startYear}-${endYear}`, external_requests: (sourceFile ? 0 : sources.length) + (wikidataFile ? 0 : 1), ...summariseMatches(matched) };
console.log(JSON.stringify(report, null, 2));
console.log(JSON.stringify(matched.filter(row => row.match_status === "ambiguous").slice(0, 12).map(row => ({ year: row.chart_year, artist: row.artist, title: row.title, reason: row.match_notes })), null, 2));

if (useMusicBrainz) {
  const cacheFile = option("musicbrainz-cache", new URL(".cache/uk-number-ones-musicbrainz.json", import.meta.url).pathname);
  const musicBrainzIntervalMs = Math.max(1100, Number(option("musicbrainz-interval-ms", "2100")) || 2100);
  let cache = {};
  try { cache = JSON.parse(await readFile(cacheFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const unresolved = matched.filter(row => row.match_status === "unresolved");
  let requests = 0, cacheHits = 0, httpAttempts = 0, lastRequestAt = 0;
  for (const [index, entry] of unresolved.entries()) {
    const key = `${normalise(entry.artist)}|||${normalise(entry.title)}`;
    if (cache[key]) { cacheHits += 1; continue; }
    const waitMs = Math.max(0, musicBrainzIntervalMs - (Date.now() - lastRequestAt));
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    const url = `https://musicbrainz.org/ws/2${musicBrainzSearchPath(entry)}`;
    let response = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        httpAttempts += 1;
        response = await json(url, { headers: { "User-Agent": "BankOfMusic-UKNo1Importer/1.0 (https://thebankofmusic.com/)" } });
        break;
      } catch (error) {
        if (![429, 503].includes(error.status) || attempt === 3) throw error;
        const retryMs = Math.max(5000 * attempt, Number(error.retryAfter || 0) * 1000);
        console.error(`MusicBrainz HTTP ${error.status}; retrying in ${Math.ceil(retryMs / 1000)}s`);
        await new Promise(resolve => setTimeout(resolve, retryMs));
      } finally {
        lastRequestAt = Date.now();
      }
    }
    cache[key] = response;
    requests += 1;
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, `${JSON.stringify(cache)}\n`);
    if ((index + 1) % 10 === 0 || index + 1 === unresolved.length) console.error(`MusicBrainz ${index + 1}/${unresolved.length} (${requests} requests, ${cacheHits} cache hits)`);
  }
  matched = applyMusicBrainzEnrichment(matched, cache, songs);
  const musicBrainzReport = { musicbrainz_requests: requests, musicbrainz_http_attempts: httpAttempts, cache_hits: cacheHits, ...summariseMusicBrainzEnrichment(matched) };
  console.log(JSON.stringify(musicBrainzReport, null, 2));
  for (const confidence of ["high", "probable", "ambiguous", "none"]) {
    console.log(JSON.stringify({ confidence, examples: matched.filter(row => row.musicbrainz_enrichment?.confidence === confidence).slice(0, 8).map(row => ({ year: row.chart_year, artist: row.artist, title: row.title, ...row.musicbrainz_enrichment })) }, null, 2));
  }
}

if (commit) {
  let persistedRows = matched.map(row => {
    const { musicbrainz_enrichment: enrichment, ...persisted } = row;
    if (!enrichment) return persisted;
    return {
      ...persisted,
      musicbrainz_recording_id: enrichment.confidence === "high" ? enrichment.candidate_mbid : persisted.musicbrainz_recording_id,
      source_metadata: { ...persisted.source_metadata, musicbrainz_enrichment: enrichment }
    };
  });
  const canonicalHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" };
  const existingCanonical = await json(`${supabaseUrl}/rest/v1/canonical_recordings?select=*`, { headers: canonicalHeaders });
  const byMbid = new Map(existingCanonical.filter(row => row.musicbrainz_recording_id).map(row => [row.musicbrainz_recording_id.toLowerCase(), row]));
  const byOrigin = new Map(existingCanonical.filter(row => row.origin_key).map(row => [row.origin_key, row]));
  const seeds = [], seedKeys = new Set(), identifierUpdates = [];
  for (const row of persistedRows) {
    if (row.canonical_song_id) continue;
    const seed = canonicalRecordingSeed(row);
    if (!seed) continue;
    const originExisting = byOrigin.get(seed.origin_key);
    const mbidExisting = seed.musicbrainz_recording_id && byMbid.get(seed.musicbrainz_recording_id.toLowerCase());
    if (originExisting) {
      row.canonical_song_id = originExisting.id;
      if (seed.musicbrainz_recording_id && !originExisting.musicbrainz_recording_id && !mbidExisting) {
        identifierUpdates.push({ id: originExisting.id, musicbrainz_recording_id: seed.musicbrainz_recording_id });
        originExisting.musicbrainz_recording_id = seed.musicbrainz_recording_id;
        byMbid.set(seed.musicbrainz_recording_id.toLowerCase(), originExisting);
      }
    }
    else if (mbidExisting) row.canonical_song_id = mbidExisting.id;
    else {
      const seedKey = seed.musicbrainz_recording_id ? `mbid:${seed.musicbrainz_recording_id.toLowerCase()}` : seed.origin_key;
      if (!seedKeys.has(seedKey)) { seeds.push(seed); seedKeys.add(seedKey); }
    }
  }
  for (const update of identifierUpdates) {
    const identifierResponse = await fetch(`${supabaseUrl}/rest/v1/canonical_recordings?id=eq.${encodeURIComponent(update.id)}`, {
      method: "PATCH",
      headers: { ...canonicalHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ musicbrainz_recording_id: update.musicbrainz_recording_id })
    });
    if (!identifierResponse.ok) throw new Error(`Canonical identifier attachment failed: ${identifierResponse.status} ${await identifierResponse.text()}`);
  }
  if (seeds.length) {
    const canonicalResponse = await fetch(`${supabaseUrl}/rest/v1/canonical_recordings?on_conflict=origin_key`, {
      method: "POST",
      headers: { ...canonicalHeaders, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(seeds)
    });
    if (!canonicalResponse.ok) throw new Error(`Canonical recording upsert failed: ${canonicalResponse.status} ${await canonicalResponse.text()}`);
    const created = await canonicalResponse.json();
    created.forEach(row => {
      if (row.origin_key) byOrigin.set(row.origin_key, row);
      if (row.musicbrainz_recording_id) byMbid.set(row.musicbrainz_recording_id.toLowerCase(), row);
    });
    persistedRows = persistedRows.map(row => ({
      ...row,
      canonical_song_id: row.canonical_song_id ||
        (row.musicbrainz_recording_id && byMbid.get(row.musicbrainz_recording_id.toLowerCase())?.id) ||
        byOrigin.get(`quick-rate:${row.collection_key}:${row.source_entry_key}`)?.id || null
    }));
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/quick_rate_collection_tracks?on_conflict=collection_key,chart_year,source_entry_key`, {
    method: "POST",
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(persistedRows)
  });
  if (!response.ok) throw new Error(`Supabase upsert failed: ${response.status} ${await response.text()}`);
  console.log(`Imported ${persistedRows.length} rows.`);
} else console.log("Dry run only. No database rows were written; pass --commit with service credentials after review.");
