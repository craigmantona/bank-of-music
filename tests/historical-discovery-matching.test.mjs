import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const start = app.indexOf("function resolveHistoricalSongCandidate");
const end = app.indexOf("window.BOMPresentationBridge", start);
const source = app.slice(start, end);
const context = vm.createContext({ Map, Set, Number, String, Boolean });
vm.runInContext(source, context);

const normalise = (value) => String(value || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");
const historicalIdentity = (title, artist) => `${normalise(title)}\n${normalise(artist)}`;

function resolve(row, songs, artwork = new Set()) {
  const byId = new Map(songs.map((song) => [Number(song.id), song]));
  const byCanonical = new Map();
  const byRecording = new Map();
  const byIdentity = new Map();
  for (const song of songs) {
    if (song.canonical_song_id) byCanonical.set(song.canonical_song_id, [...(byCanonical.get(song.canonical_song_id) || []), song]);
    if (song.external_id) byRecording.set(song.external_id, [...(byRecording.get(song.external_id) || []), song]);
    const identity = historicalIdentity(song.title, song.artist);
    byIdentity.set(identity, [...(byIdentity.get(identity) || []), song]);
  }
  return context.resolveHistoricalSongCandidate(row, {
    songsById: byId,
    songsByCanonicalId: byCanonical,
    songsByRecordingId: byRecording,
    songsByHistoricalIdentity: byIdentity,
    historicalIdentity
  }, (song) => artwork.has(song.id) ? `art-${song.id}` : "");
}

test("historical matching never links a unique same-title recording by a different artist", () => {
  const cases = [
    [{ title: "A Different Corner", artist: "George Michael" }, { id: 1, title: "A Different Corner", artist: "Wham!" }],
    [{ title: "A Good Heart", artist: "Feargal Sharkey" }, { id: 2, title: "A Good Heart", artist: "Elton John" }],
    [{ title: "A Little Time", artist: "The Beautiful South" }, { id: 3, title: "A Little Time", artist: "Otis Redding" }]
  ];
  for (const [row, wrongSong] of cases) assert.equal(resolve(row, [wrongSong]), null);
});

test("historical matching preserves direct, canonical and MusicBrainz recording links", () => {
  const direct = { id: 10, title: "Direct", artist: "Artist" };
  const canonical = { id: 20, title: "Canonical", artist: "Artist", canonical_song_id: "canonical-20" };
  const recording = { id: 30, title: "Recording", artist: "Artist", external_id: "recording-30" };
  assert.equal(resolve({ song_id: 10, title: "Other", artist: "Other" }, [direct])?.id, 10);
  assert.equal(resolve({ canonical_song_id: "canonical-20", title: "Other", artist: "Other" }, [canonical])?.id, 20);
  assert.equal(resolve({ musicbrainz_recording_id: "recording-30", title: "Other", artist: "Other" }, [recording])?.id, 30);
});

test("unique normalized title-and-artist matches remain linked and prefer artwork", () => {
  const canonicalId = "canonical-breakfast";
  const songs = [
    { id: 40, title: "Breakfast at Tiffany's", artist: "Deep Blue Something", canonical_song_id: canonicalId },
    { id: 41, title: "Breakfast at Tiffany’s", artist: "Deep Blue Something", canonical_song_id: canonicalId }
  ];
  assert.equal(resolve({ title: "Breakfast at Tiffany's", artist: "Deep Blue Something" }, songs, new Set([41]))?.id, 41);
});

test("normalized title-and-artist matches with different recording identities remain unlinked", () => {
  const songs = [
    { id: 50, title: "Example", artist: "Artist", canonical_song_id: "canonical-a" },
    { id: 51, title: "Example", artist: "Artist", canonical_song_id: "canonical-b" }
  ];
  assert.equal(resolve({ title: "Example", artist: "Artist" }, songs), null);
});
