import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

await import(`../bom-spotify-playlist.js?test=${Date.now()}`);
const sync = globalThis.BOMSpotifyPlaylistSync;
const id = (number) => String(number).padStart(22, "0");

test("428 desired tracks reuse 420 persisted IDs and match only the unresolved 8", async () => {
  const tracks = Array.from({ length: 428 }, (_, index) => ({
    title: `Track ${index}`,
    artist: "Artist",
    spotify_track_id: index < 420 ? id(index + 1) : ""
  }));
  const calls = [];
  const result = await sync.resolveDesiredTracks({
    tracks,
    getCachedMatch: () => null,
    resolveMissing: async (track) => {
      calls.push(track.title);
      return { id: id(1000 + calls.length) };
    }
  });
  assert.equal(calls.length, 8);
  assert.equal(result.reused, 420);
  assert.equal(result.newlyMatched, 8);
  assert.equal(result.tracks.length, 428);
});

test("persisted IDs work with an empty browser cache", async () => {
  let cacheChecks = 0;
  let resolverCalls = 0;
  const storedId = id(77);
  const result = await sync.resolveDesiredTracks({
    tracks: [{ title: "Stored", artist: "Artist", spotify_track_id: storedId }],
    getCachedMatch: () => { cacheChecks += 1; return null; },
    resolveMissing: async () => { resolverCalls += 1; return null; }
  });
  assert.equal(result.tracks[0].spotify_track_id, storedId);
  assert.equal(cacheChecks, 0);
  assert.equal(resolverCalls, 0);
});

test("progress reports all pre-existing stored IDs before reaching them", async () => {
  const progress = [];
  await sync.resolveDesiredTracks({
    tracks: [
      { title: "First", artist: "Artist", spotify_track_id: "" },
      { title: "Later", artist: "Artist", spotify_track_id: id(88) }
    ],
    getRecordingMatch: async () => ({ id: id(87) }),
    getCachedMatch: () => null,
    resolveMissing: async () => { throw new Error("recording reuse should precede search"); },
    onProgress: value => progress.push(value)
  });
  assert.equal(progress[0].storedTotal, 1);
  assert.equal(progress[0].recordingReused, 1);
  assert.equal(progress[0].newlyMatched, 0);
});

test("existing playlist contents are paginated and compared", async () => {
  const requests = [];
  const first = id(1);
  const second = id(2);
  const request = async (path) => {
    requests.push(path);
    if (requests.length === 1) {
      return {
        items: [{ track: { id: first } }],
        next: "https://api.spotify.com/v1/playlists/list/items?limit=100&offset=100"
      };
    }
    return { items: [{ track: { id: second } }], next: null };
  };
  const existing = await sync.fetchSpotifyPlaylistTrackIds(request, "list");
  assert.deepEqual(existing, [first, second]);
  assert.deepEqual(requests, [
    "/playlists/list/items?limit=100",
    "/playlists/list/items?limit=100&offset=100"
  ]);
  assert.deepEqual(sync.calculateSpotifyPlaylistDelta([first, second], existing), {
    desired: [first, second], alreadyPresent: [first, second], additions: [], removals: []
  });
});

test("delta writes only additions and removals and writes nothing when unchanged", async () => {
  const present = id(1);
  const added = id(2);
  const removed = id(3);
  const additions = sync.calculateSpotifyPlaylistDelta([present, added], [present]);
  const additionWrites = [];
  await sync.applySpotifyPlaylistDelta(async (path, options) => {
    additionWrites.push({ path, options });
  }, "playlist", additions);
  assert.equal(additionWrites.length, 1);
  assert.equal(additionWrites[0].options.method, "POST");
  assert.deepEqual(JSON.parse(additionWrites[0].options.body).uris, [`spotify:track:${added}`]);

  const removals = sync.calculateSpotifyPlaylistDelta([present], [present, removed]);
  const removalWrites = [];
  await sync.applySpotifyPlaylistDelta(async (path, options) => {
    removalWrites.push({ path, options });
  }, "playlist", removals);
  assert.equal(removalWrites.length, 1);
  assert.equal(removalWrites[0].options.method, "DELETE");
  assert.deepEqual(JSON.parse(removalWrites[0].options.body).tracks, [
    { uri: `spotify:track:${removed}` }
  ]);

  const unchanged = sync.calculateSpotifyPlaylistDelta([present], [present]);
  let unchangedWrites = 0;
  assert.equal(await sync.applySpotifyPlaylistDelta(async () => { unchangedWrites += 1; }, "playlist", unchanged), 0);
  assert.equal(unchangedWrites, 0);
});

test("already-present desired tracks are not rewritten and duplicates are repaired", async () => {
  const present = id(1);
  const duplicate = id(2);
  const delta = sync.calculateSpotifyPlaylistDelta(
    [present, duplicate],
    [present, duplicate, duplicate]
  );
  assert.deepEqual(delta.alreadyPresent, [present]);
  assert.deepEqual(delta.removals, [duplicate]);
  assert.deepEqual(delta.additions, [duplicate]);
});

test("new resolutions are retained and completed work is not restarted after 429", async () => {
  const attempts = new Map();
  const sleeps = [];
  const tracks = [1, 2, 3].map((number) => ({ title: `Track ${number}`, artist: "Artist" }));
  const result = await sync.resolveDesiredTracks({
    tracks,
    getCachedMatch: () => null,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    resolveMissing: async (track) => {
      const attempt = (attempts.get(track.title) || 0) + 1;
      attempts.set(track.title, attempt);
      if (track.title === "Track 2" && attempt === 1) {
        const error = new Error("limited");
        error.status = 429;
        error.retryAfter = 7;
        throw error;
      }
      return { id: id(Number(track.title.at(-1)) + 10) };
    }
  });
  assert.deepEqual(sleeps, [7000]);
  assert.deepEqual([...attempts.entries()], [["Track 1", 1], ["Track 2", 2], ["Track 3", 1]]);
  assert.deepEqual(result.tracks.map((track) => track.spotify_track_id), [id(11), id(12), id(13)]);
});

test("an unresolved track is reported while later tracks resolve", async () => {
  const result = await sync.resolveDesiredTracks({
    tracks: [
      { song: { id: 41 }, title: "Missing", artist: "Artist" },
      { song: { id: 42 }, title: "Later", artist: "Artist" }
    ],
    getCachedMatch: () => null,
    resolveMissing: async (track) => track.title === "Missing" ? null : { id: id(42) }
  });

  assert.deepEqual(result.tracks.map(track => track.title), ["Later"]);
  assert.deepEqual(result.unresolved.map(track => ({
    songId: track.songId, artist: track.artist, title: track.title
  })), [{ songId: 41, artist: "Artist", title: "Missing" }]);
});

test("unresolved tracks protect existing entries while resolved additions still sync", async () => {
  const present = id(1);
  const staleOrUnresolved = id(2);
  const added = id(3);
  const protectedDelta = sync.calculateSpotifyPlaylistDelta(
    [present, added],
    [present, staleOrUnresolved],
    { preserveExisting: true }
  );
  assert.deepEqual(protectedDelta, {
    desired: [present, added],
    alreadyPresent: [present],
    additions: [added],
    removals: []
  });

  const writes = [];
  await sync.applySpotifyPlaylistDelta(async (path, options) => {
    writes.push({ path, options });
  }, "playlist", protectedDelta);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.method, "POST");

  const fullyResolved = sync.calculateSpotifyPlaylistDelta([present, added], [present, staleOrUnresolved]);
  assert.deepEqual(fullyResolved.additions, [added]);
  assert.deepEqual(fullyResolved.removals, [staleOrUnresolved]);
});

test("rate-limit exhaustion still aborts resolution", async () => {
  let writes = 0;

  let attempts = 0;
  const waits = [];
  await assert.rejects(
    sync.resolveDesiredTracks({
      tracks: [{ title: "Limited", artist: "Artist" }],
      getCachedMatch: () => null,
      maxRateLimitRetries: 1,
      sleep: async (milliseconds) => { waits.push(milliseconds); },
      resolveMissing: async () => {
        attempts += 1;
        const error = new Error("limited");
        error.status = 429;
        error.retryAfter = 2;
        throw error;
      }
    }),
    /API limit has been reached/
  );
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [2000]);
  assert.equal(writes, 0);
});

test("playlist integration uses the trusted resolver and preserves playlist definitions", async () => {
  const [app, html, resolver] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/rapid-processor/spotify-token.ts", import.meta.url), "utf8")
  ]);
  assert.match(app, /resolveQuickRateSpotifyTrack\(track\.song\)/);
  assert.match(resolver, /persistSpotifyTrackId\(admin, song\.id, match\.id\)/);
  for (const threshold of [7, 8, 9, 10]) {
    assert.match(html, new RegExp(`data-minimum-rating="${threshold}"`));
  }
  assert.match(html, /data-playlist-type="global-top-100"/);
  assert.match(app, /track\.ratingCount >= 3/);
  assert.match(app, /\.slice\(0, 100\)/);
});
