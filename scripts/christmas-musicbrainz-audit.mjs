#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const manifest = JSON.parse(await readFile(path.join(root, "christmas-100.json"), "utf8"));
const output = process.argv[2] || path.join(root, "supabase/operations/christmas-musicbrainz-review-20261110.json");
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const normalise = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
const lucene = value => String(value).replace(/([+\-!(){}[\]^"~*?:\\/])/g, "\\$1");
const credit = row => (row["artist-credit"] || []).map(part => part.name || part.artist?.name || "").join("");
const versionWarning = /\b(live|remix|karaoke|demo|re-record|rerecord|instrumental|acoustic|edit|extended|mix|version|session|medley)\b/i;
const aliases = new Map([
  ["Bing Crosby & David Bowie", ["Bing Crosby and David Bowie", "David Bowie & Bing Crosby", "David Bowie and Bing Crosby"]],
  ["John Lennon & Yoko Ono", ["John Lennon and Yoko Ono", "John & Yoko / Plastic Ono Band with the Harlem Community Choir", "John Lennon, Yoko Ono and The Plastic Ono Band"]],
  ["The Pogues feat. Kirsty MacColl", ["The Pogues featuring Kirsty MacColl", "The Pogues feat Kirsty MacColl", "The Pogues"]],
  ["The Pretenders", ["Pretenders"]],
  ["*NSYNC", ["NSYNC", "’N Sync", "'N Sync"]],
  ["Matthew Hall & Meagan Moore", ["Matthew Hall and Meagan Moore"]],
  ["Gwen Stefani feat. Blake Shelton", ["Gwen Stefani featuring Blake Shelton", "Gwen Stefani & Blake Shelton"]],
  ["Ed Sheeran & Elton John", ["Ed Sheeran and Elton John", "Ed Sheeran / Elton John"]],
  ["Dan + Shay", ["Dan and Shay", "Dan & Shay"]],
  ["Jimmy Fallon & Meghan Trainor", ["Jimmy Fallon and Meghan Trainor", "Jimmy Fallon feat. Meghan Trainor"]],
  ["Tom Petty and the Heartbreakers", ["Tom Petty & the Heartbreakers", "Tom Petty and The Heartbreakers"]],
  ["blink-182", ["Blink-182"]],
  ["Elmo & Patsy", ["Elmo and Patsy"]],
  ["The Chipmunks with David Seville", ["David Seville and The Chipmunks", "The Chipmunks", "David Seville"]],
  ["The Go-Go's", ["The Go-Go’s", "The Go Go's"]],
]);

async function musicBrainz(url) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": "BankOfMusicChristmasAudit/1.0 (https://thebankofmusic.com)" } });
    if (response.ok) return response.json();
    lastStatus = response.status;
    if (![429, 502, 503, 504].includes(response.status)) break;
    await sleep(1600 * (attempt + 1));
  }
  throw new Error(`MusicBrainz ${lastStatus}`);
}

function artistCompatible(expected, actual) {
  const accepted = [expected, ...(aliases.get(expected) || [])].map(normalise);
  const candidate = normalise(actual);
  return accepted.some(name => candidate === name || candidate.includes(name) || name.includes(candidate));
}

const results = [];
for (const [index, entry] of manifest.tracks.entries()) {
  const artistQueries = [entry.artist, ...(aliases.get(entry.artist) || [])];
  const candidates = new Map();
  const errors = [];
  for (const artist of [...new Set(artistQueries)].slice(0, 2)) {
    const query = `recording:"${lucene(entry.title)}" AND artist:"${lucene(artist)}"`;
    try {
      const payload = await musicBrainz(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=100`);
      for (const row of payload.recordings || []) candidates.set(row.id, row);
    } catch (error) {
      errors.push(`${artist}: ${error.message}`);
    }
    await sleep(1100);
  }
  if (!candidates.size) {
    const query = `recording:"${lucene(entry.title)}"`;
    try {
      const payload = await musicBrainz(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=100`);
      for (const row of payload.recordings || []) candidates.set(row.id, row);
    } catch (error) {
      errors.push(`title-only: ${error.message}`);
    }
    await sleep(1100);
  }
  const ranked = [...candidates.values()].map(row => {
    const actualArtist = credit(row);
    const firstReleaseYear = Number(String(row["first-release-date"] || "").slice(0, 4)) || null;
    return {
      musicbrainzRecordingId: row.id,
      title: row.title,
      artistCredit: actualArtist,
      firstReleaseDate: row["first-release-date"] || null,
      disambiguation: row.disambiguation || "",
      score: Number(row.score || 0),
      exactTitle: normalise(row.title) === normalise(entry.title),
      correctArtist: artistCompatible(entry.artist, actualArtist),
      yearDistance: firstReleaseYear ? Math.abs(firstReleaseYear - entry.year) : 99,
      isrcs: row.isrcs || [],
      releaseEvidence: (row.releases || []).slice(0, 12).map(release => ({
        id: release.id,
        title: release.title,
        date: release.date || null,
        status: release.status || null,
        country: release.country || null,
        releaseGroupId: release["release-group"]?.id || null,
        artistCredit: credit(release)
      }))
    };
  }).filter(row => row.exactTitle && row.correctArtist)
    .sort((left, right) => left.yearDistance - right.yearDistance || Number(versionWarning.test(left.disambiguation)) - Number(versionWarning.test(right.disambiguation)) || right.score - left.score);
  const originalPeriod = ranked.filter(row => row.yearDistance <= 1 && !versionWarning.test(row.disambiguation));
  const existingMatches = entry.musicbrainzRecordingId ? ranked.filter(row => row.musicbrainzRecordingId === entry.musicbrainzRecordingId) : [];
  results.push({
    index,
    group: entry.group,
    title: entry.title,
    artist: entry.artist,
    year: entry.year,
    existingCatalogueTrackId: entry.catalogueTrackId || null,
    existingMusicBrainzRecordingId: entry.musicbrainzRecordingId || null,
    errors,
    candidates: ranked.slice(0, 12),
    recommendedMusicBrainzRecordingId: entry.musicbrainzRecordingId || (originalPeriod.length === 1 ? originalPeriod[0].musicbrainzRecordingId : null),
    reviewStatus: entry.musicbrainzRecordingId
      ? (existingMatches.length ? "existing-verified" : "existing-needs-review")
      : originalPeriod.length === 1 ? "single-strong-candidate" : ranked.length ? "manual-review" : "no-candidate"
  });
  console.log(`${index + 1}/100 ${entry.artist} — ${entry.title}: ${results.at(-1).reviewStatus} (${ranked.length})`);
}

const statuses = ["existing-verified", "existing-needs-review", "single-strong-candidate", "manual-review", "no-candidate"];
const report = {
  generatedAt: new Date().toISOString(),
  mode: "read-only-musicbrainz-audit",
  productionWrites: 0,
  entries: results,
  summary: Object.fromEntries(statuses.map(status => [status, results.filter(row => row.reviewStatus === status).length]))
};
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, ...report.summary }, null, 2));
