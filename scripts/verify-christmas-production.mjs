#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const [config, mapping] = await Promise.all([
  readFile(path.join(root, "config.js"), "utf8"),
  readFile(path.join(root, "supabase/operations/christmas-final-mapping-20261110.json"), "utf8").then(JSON.parse)
]);
const url = config.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
const key = config.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)?.[1];
if (!url || !key) throw new Error("Public Supabase configuration is missing");
const ids = mapping.entries.map(entry => entry.musicbrainzRecordingId);
const filter = `(${ids.map(id => `"${id}"`).join(",")})`;
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const response = await fetch(`${url}/rest/v1/canonical_recordings?select=id,title,artist,musicbrainz_recording_id,preferred_spotify_track_id&musicbrainz_recording_id=in.${encodeURIComponent(filter)}`, { headers });
if (!response.ok) throw new Error(`Canonical verification failed: ${response.status} ${await response.text()}`);
const canonicals = await response.json();
const canonicalByMbid = new Map(canonicals.map(row => [String(row.musicbrainz_recording_id).toLowerCase(), row]));
const matched = mapping.entries.filter(entry => canonicalByMbid.has(entry.musicbrainzRecordingId));
const report = {
  generatedAt: new Date().toISOString(),
  mode: "read-only-production-verification",
  productionWrites: 0,
  totalChristmasTracks: mapping.entries.length,
  existingCanonicalRecords: matched.length,
  plannedCanonicalRecords: mapping.entries.length - matched.length,
  existingSpotifyIds: matched.filter(entry => canonicalByMbid.get(entry.musicbrainzRecordingId)?.preferred_spotify_track_id).length,
  existing: matched.map(entry => ({
    title: entry.title,
    artist: entry.artist,
    musicbrainzRecordingId: entry.musicbrainzRecordingId,
    canonicalRecordingId: canonicalByMbid.get(entry.musicbrainzRecordingId).id,
    preferredSpotifyTrackId: canonicalByMbid.get(entry.musicbrainzRecordingId).preferred_spotify_track_id || null
  }))
};
await writeFile(path.join(root, "supabase/operations/christmas-production-verification-20261110.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
