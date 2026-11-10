#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const manifestPath = path.join(root, "christmas-100.json");
const mappingPath = path.join(root, "supabase/operations/christmas-final-mapping-20261110.json");
const [manifest, mapping] = await Promise.all([
  readFile(manifestPath, "utf8").then(JSON.parse),
  readFile(mappingPath, "utf8").then(JSON.parse)
]);
if (manifest.tracks.length !== 100 || mapping.entries.length !== 100) throw new Error("Christmas mapping must cover 100 tracks");
manifest.verifiedOn = "2026-11-10";
manifest.catalogueMatchPolicy = "Every entry has a verified MusicBrainz recording identity. Existing BOM catalogue occurrences retain their catalogueTrackId and canonicalRecordingId; planned identities resolve from musicbrainzRecordingId after the approval-gated canonical import.";
manifest.tracks = manifest.tracks.map((track, index) => {
  const entry = mapping.entries[index];
  if (entry.title !== track.title || entry.artist !== track.artist) throw new Error(`Mapping order mismatch at ${index + 1}`);
  return {
    ...track,
    musicbrainzRecordingId: entry.musicbrainzRecordingId,
    ...(entry.spotify.trackId ? { spotifyId: entry.spotify.trackId } : {})
  };
});
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
