import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

test("MusicBrainz requests have a bounded timeout", async () => {
  const start = app.indexOf("const MUSICBRAINZ_REQUEST_TIMEOUT_MS");
  const end = app.indexOf("async function runGlobalSearch", start);
  const context = {
    AbortController,
    window: { setTimeout, clearTimeout },
    fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    })
  };
  vm.runInNewContext(app.slice(start, end), context);
  await assert.rejects(context.fetchMusicBrainz("https://musicbrainz.test", { timeoutMs: 5 }), /aborted/);
});

test("new searches abort and supersede stale searches without stale rendering", () => {
  const source = app.slice(app.indexOf("async function runGlobalSearch"), app.indexOf("function buildStageOneSearchModel"));
  assert.match(source, /globalSearchAbortController\?\.abort\(\)/);
  assert.ok((source.match(/searchGeneration !== globalSearchGeneration/g) || []).length >= 3);
  assert.match(source, /renderError\(query\)/);
  assert.match(source, /finally[\s\S]*globalSearchAbortController === searchController/);
});

test("artist catalogue renders before MusicBrainz enrichment starts", () => {
  const source = app.slice(app.indexOf("async function renderArtistDetail"), app.indexOf("async function renderAlbumDetail"));
  const localRender = source.indexOf("await renderStageOneArtist");
  const enrichment = source.indexOf("await fetchMostCompleteArtistDiscography");
  assert.ok(localRender >= 0 && enrichment > localRender);
  assert.match(source.slice(0, enrichment), /albums: localAlbums/);
});

test("artist discography is cached by MusicBrainz artist ID", async () => {
  const start = app.indexOf("const artistDiscographyCache");
  const end = app.indexOf("async function fetchArtistAlbumsFromApi", start);
  let requests = 0;
  const context = {
    resolveArtistIdByName: async () => "artist-id",
    fetchSharedArtistEnrichment: async () => null,
    mapArtistReleaseGroups: (rows, artistId, artistName) => rows.map(row => ({ ...row, artistId, artist: artistName })),
    fetchMusicBrainz: async () => {
      requests += 1;
      return { ok: true, json: async () => ({ "release-groups": [{ id: "group", title: "Album", "primary-type": "Album" }] }) };
    },
    sortReleaseGroupsByDate: rows => rows,
    isStudioReleaseGroup: () => true,
    selectedItem: null,
    Map,
    encodeURIComponent
  };
  vm.runInNewContext(app.slice(start, end), context);
  assert.equal((await context.fetchStudioAlbumsForArtist("artist-id", "Artist")).length, 1);
  assert.equal((await context.fetchStudioAlbumsForArtist("artist-id", "Artist")).length, 1);
  assert.equal(requests, 1);
});

test("artist detail is cached by MusicBrainz artist ID", async () => {
  const start = app.indexOf("const artistDetailCache");
  const end = app.indexOf("async function resolveArtistIdentityForImage", start);
  let requests = 0;
  const context = {
    fetchSharedArtistEnrichment: async () => null,
    fetchMusicBrainz: async () => {
      requests += 1;
      return { ok: true, json: async () => ({ id: "artist-id" }) };
    },
    window: { setTimeout },
    Map,
    encodeURIComponent
  };
  vm.runInNewContext(app.slice(start, end), context);
  assert.equal((await context.fetchArtistDetail("artist-id")).id, "artist-id");
  assert.equal((await context.fetchArtistDetail("artist-id")).id, "artist-id");
  assert.equal(requests, 1);
});
