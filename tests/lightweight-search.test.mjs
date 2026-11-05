import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const autocomplete = await readFile(new URL("../bom-autocomplete.js", import.meta.url), "utf8");
const foundation = await readFile(new URL("../bom-foundation.js", import.meta.url), "utf8");
const searchSource = app.slice(app.indexOf("async function runGlobalSearch"), app.indexOf("function buildStageOneSearchModel"));
const localSource = app.slice(app.indexOf("const localCatalogueSearchCache"), app.indexOf("// One shared search index"));

function localContext(rows) {
  let calls = 0;
  let receivedSignal = null;
  const request = {
    abortSignal(signal) { receivedSignal = signal; return request; },
    then(resolve) { return Promise.resolve(resolve({ data: rows, error: null })); }
  };
  const context = {
    window: { BOMAutocomplete: { normalise: (value) => String(value).toLowerCase().trim() } },
    supabaseClient: { rpc(name, args, options) {
      calls += 1;
      assert.equal(name, "search_catalogue");
      assert.equal(args.p_per_type_limit, 20);
      assert.equal(options.get, true);
      return request;
    } },
    normaliseCompare: (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
    Map, Number, String
  };
  vm.createContext(context);
  vm.runInContext(localSource, context);
  return { context, calls: () => calls, signal: () => receivedSignal };
}

test("submitted Search no longer waits for the full catalogue", () => {
  assert.doesNotMatch(searchSource, /ensureFullCatalogue/);
  assert.match(searchSource, /searchLocalCatalogue\(query/);
  assert.match(searchSource, /renderAvailableResults\(localResults\)/);
  assert.ok(searchSource.indexOf("renderAvailableResults(localResults)") < searchSource.indexOf("await musicBrainzPromise"));
  assert.match(searchSource, /mergeSearchResultGroups\(localResults/);
});

test("bounded RPC results retain local identity, canonical identity, artwork and aggregate ratings", async () => {
  const rows = [{
    result_type: "song", local_id: 10, title: "Paranoid Android", artist: "Radiohead",
    album_id: 1, album_title: "OK Computer", external_id: "recording-id",
    canonical_song_id: "canonical-id", release_date: "1997-05-21", cover_art_url: "cover.jpg",
    community_average: 9, community_count: 2, match_score: 400
  }];
  const { context } = localContext(rows);
  const grouped = await context.searchLocalCatalogue("Paranoid Android");
  assert.equal(grouped.songs[0].savedSongId, 10);
  assert.equal(grouped.songs[0].albumId, 1);
  assert.equal(grouped.songs[0].canonicalSongId, "canonical-id");
  assert.equal(grouped.songs[0].coverUrl, "cover.jpg");
  assert.equal(grouped.songs[0].community.average, 9);
  assert.match(app, /community\.average \?\? community\.avg/);
});

test("identical local queries are cached and in-flight RPC requests receive AbortSignal", async () => {
  const { context, calls, signal } = localContext([]);
  const controller = new AbortController();
  await context.searchLocalCatalogue("Radiohead", { signal: controller.signal });
  await context.searchLocalCatalogue("radiohead", { signal: new AbortController().signal });
  assert.equal(calls(), 1);
  assert.equal(signal(), controller.signal);
});

test("autocomplete keeps its interaction contract while using cancellable bounded search", () => {
  assert.match(autocomplete, /normalise\(query\)\.length < 2/);
  assert.match(autocomplete, /}, 180\)/);
  assert.match(localSource, /items: items\.slice\(0, 7\)/);
  assert.match(autocomplete, /requestController\?\.abort\(\)/);
  assert.match(autocomplete, /actions\.search\(query, \{ signal: requestController\.signal \}\)/);
  assert.match(foundation, /searchCatalogueSuggestions\(query, options\)/);
});

test("local results lead and conservative identifiers prevent duplicate remote rows", () => {
  const { context } = localContext([]);
  const local = {
    artists: [],
    albums: [{ type: "album", title: "OK Computer", artist: "Radiohead", externalId: "release-id", savedAlbumId: 1 }],
    songs: [{ type: "song", title: "Paranoid Android", artist: "Radiohead", externalId: "recording-id", savedSongId: 10 }]
  };
  const remote = {
    artists: [],
    albums: [{ type: "album", title: "OK Computer", artist: "Radiohead", externalId: "release-id", country: "GB" }],
    songs: [{ type: "song", title: "Paranoid Android", artist: "Radiohead", externalId: "recording-id", versionCount: 3 }]
  };
  const merged = context.mergeSearchResultGroups(local, remote);
  assert.equal(merged.albums.length, 1);
  assert.equal(merged.albums[0].savedAlbumId, 1);
  assert.equal(merged.albums[0].country, "GB");
  assert.equal(merged.songs.length, 1);
  assert.equal(merged.songs[0].savedSongId, 10);
  assert.equal(merged.songs[0].versionCount, 3);
});
