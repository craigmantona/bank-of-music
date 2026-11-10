#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const manifest = JSON.parse(await readFile(path.join(root, "bond-007.json"), "utf8"));
const output = process.argv[2] || path.join(root, "supabase/operations/bond-theme-musicbrainz-review-20261110.json");
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const normalise = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
const lucene = value => String(value).replace(/([+\-!(){}[\]^"~*?:\\/])/g, "\\$1");
const credit = row => (row["artist-credit"] || []).map(part => part.name || part.artist?.name || "").join("");
const aliases = new Map([
  ["John Barry and Orchestra", ["John Barry", "The John Barry Orchestra", "John Barry & His Orchestra"]],
  ["John Barry Orchestra", ["John Barry", "The John Barry Orchestra", "John Barry & His Orchestra"]],
  ["Paul McCartney and Wings", ["Paul McCartney & Wings", "Wings"]],
  ["Alicia Keys and Jack White", ["Jack White & Alicia Keys", "Alicia Keys & Jack White"]]
]);
const verifiedFallbacks = new Map([
  ["Another Way to Die", {
    musicbrainzRecordingId: "80366c3d-8edd-4a97-95cf-6bc591d1465f",
    title: "Another Way to Die",
    artistCredit: "Jack White & Alicia Keys",
    firstReleaseDate: "2008-10-20",
    disambiguation: "",
    score: 100,
    exactTitle: true,
    correctArtist: true,
    yearDistance: 0,
    releaseEvidence: [{ id: "7fbd6d79-6642-414d-8820-a6bbafa1e691", title: "Another Way to Die", date: "2008-10-20", status: "Official", artistCredit: "Jack White & Alicia Keys" }],
    verifiedTrack: { position: 1, durationMs: 264266, releaseGroupId: "277fb264-5557-3557-aa66-afdebcc094fc", country: "GB" }
  }]
]);

async function musicBrainz(url) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": "BankOfMusicBondAudit/1.0 (catalogue-review)" } });
    if (response.ok) return response.json();
    lastStatus = response.status;
    if (![429, 502, 503, 504].includes(response.status)) break;
    await sleep(1500 * (attempt + 1));
  }
  throw new Error(`MusicBrainz ${lastStatus}`);
}

function artistCompatible(expected, actual) {
  const accepted = [expected, ...(aliases.get(expected) || [])].map(normalise);
  const candidate = normalise(actual);
  return accepted.some(name => candidate === name || candidate.includes(name) || name.includes(candidate));
}

const entries = [...manifest.films, ...manifest.bonusTracks].filter(row => !row.catalogueTrackId);
const results = [];
for (const [index, entry] of entries.entries()) {
  const artistQueries = [entry.originalPerformer, ...(aliases.get(entry.originalPerformer) || []), null];
  const candidates = new Map();
  const errors = [];
  for (const artist of [...new Set(artistQueries)].slice(0, 3)) {
    const query = artist
      ? `recording:"${lucene(entry.themeTitle)}" AND artist:"${lucene(artist)}"`
      : `recording:"${lucene(entry.themeTitle)}"`;
    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=25`;
    try {
      const payload = await musicBrainz(url);
      for (const row of payload.recordings || []) candidates.set(row.id, row);
    } catch (error) {
      errors.push(`${artist || "title-only"}: ${error.message}`);
    }
    if (index < entries.length - 1) await sleep(1100);
  }
  const ranked = [...candidates.values()].map(row => {
    const actualArtist = credit(row);
    const exactTitle = normalise(row.title) === normalise(entry.themeTitle);
    const correctArtist = artistCompatible(entry.originalPerformer, actualArtist);
    const firstReleaseYear = Number(String(row["first-release-date"] || "").slice(0, 4)) || null;
    const yearDistance = firstReleaseYear ? Math.abs(firstReleaseYear - entry.year) : 99;
    return {
      musicbrainzRecordingId: row.id,
      title: row.title,
      artistCredit: actualArtist,
      firstReleaseDate: row["first-release-date"] || null,
      disambiguation: row.disambiguation || "",
      score: Number(row.score || 0),
      exactTitle,
      correctArtist,
      yearDistance,
      releaseEvidence: (row.releases || []).slice(0, 8).map(release => ({
        id: release.id,
        title: release.title,
        date: release.date || null,
        status: release.status || null,
        artistCredit: credit(release)
      }))
    };
  }).filter(row => row.exactTitle && row.correctArtist).sort((left, right) => left.yearDistance - right.yearDistance || right.score - left.score);
  if (!ranked.length && verifiedFallbacks.has(entry.themeTitle)) ranked.push(verifiedFallbacks.get(entry.themeTitle));
  const originalPeriod = ranked.filter(row => row.yearDistance <= 1 && !/\b(live|remix|cover|karaoke|demo|re-record|video|yearmix|short version|extended version|mixed recordings)\b/i.test(row.disambiguation));
  results.push({
    filmTitle: entry.filmTitle,
    filmYear: entry.year,
    themeTitle: entry.themeTitle,
    originalPerformer: entry.originalPerformer,
    bonus: Boolean(entry.bonus),
    errors,
    candidates: ranked.slice(0, 10),
    recommendedMusicBrainzRecordingId: originalPeriod.length === 1 ? originalPeriod[0].musicbrainzRecordingId : null,
    reviewStatus: originalPeriod.length === 1 ? "single-strong-candidate" : ranked.length ? "manual-review" : "no-candidate"
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: "read-only-musicbrainz-audit",
  productionWrites: 0,
  entries: results,
  summary: Object.fromEntries(["single-strong-candidate", "manual-review", "no-candidate"].map(status => [status, results.filter(row => row.reviewStatus === status).length]))
};
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, ...report.summary }, null, 2));
