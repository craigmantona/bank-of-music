import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [app, artistPresentation, index] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-artist.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8")
]);

function extract(start, end) {
  const startIndex = app.indexOf(start);
  const endIndex = app.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `missing source range: ${start}`);
  return app.slice(startIndex, endIndex);
}

test("artist discography keeps catalogue IDs distinct from MusicBrainz release identities", () => {
  const context = { Number };
  vm.runInNewContext(extract("function buildArtistAlbumSelection", "async function renderArtistDetail"), context);

  const saved = context.buildArtistAlbumSelection({
    title: "Saved", artist: "Sam Fender", savedAlbumId: 42,
    externalId: "release-id", releaseGroupId: "group-id"
  });
  assert.equal(saved.savedAlbumId, 42);
  assert.equal(saved.albumId, 42);
  assert.equal(saved.externalId, "release-id");

  const discovery = context.buildArtistAlbumSelection({
    title: "People Watching", releaseGroupId: "people-watching-group"
  }, "Sam Fender");
  assert.equal(discovery.artist, "Sam Fender");
  assert.equal(discovery.savedAlbumId, "");
  assert.equal(discovery.albumId, "");
  assert.equal(discovery.externalId, "");
  assert.equal(discovery.releaseGroupId, "people-watching-group");
});

test("release-group navigation retries a transient failure and caches the concrete release", async () => {
  const responses = [
    { status: 503, ok: false },
    { status: 200, ok: true, async json() { return { releases: [
      { id: "release-id", status: "Official", country: "GB", date: "2025-12-05" }
    ] }; } }
  ];
  const calls = [];
  const context = {
    Map,
    fetchMusicBrainz: async url => { calls.push(url); return responses.shift(); },
    window: { setTimeout(callback) { callback(); } }
  };
  vm.runInNewContext(extract("const canonicalReleaseByGroupCache", "async function resolveArtistIdFreshFromMusicBrainz"), context);
  assert.equal(await context.fetchCanonicalReleaseForReleaseGroup("group-id"), "release-id");
  assert.equal(await context.fetchCanonicalReleaseForReleaseGroup("group-id"), "release-id");
  assert.equal(calls.length, 2);
});

test("album detail retrieval retries transient release failures and coalesces concurrent renders", async () => {
  const detail = { id: "release-id", title: "People Watching (Deluxe)", media: [{ tracks: Array(19).fill({}) }] };
  const responses = [
    { status: 503, ok: false },
    { status: 200, ok: true, async json() { return detail; } }
  ];
  const calls = [];
  const context = {
    Map,
    albumTrackCache: {},
    albumTrackDetailPromises: new Map(),
    getStoredAlbumDetail: () => null,
    storeAlbumDetail: () => {},
    fetchMusicBrainz: async url => { calls.push(url); return responses.shift(); },
    window: { setTimeout(callback) { callback(); } }
  };
  vm.runInNewContext(extract("async function fetchAlbumDetail", "async function fetchReleaseGroupCover"), context);
  const [first, second] = await Promise.all([
    context.fetchAlbumDetail("release-id"),
    context.fetchAlbumDetail("release-id")
  ]);
  assert.equal(first.media[0].tracks.length, 19);
  assert.equal(second, first);
  assert.equal(calls.length, 2, "one initial request and one bounded transient retry");
});

test("a permanent album detail failure keeps Retry available with the original identity", async () => {
  const detail = { id: "release-id", title: "People Watching (Deluxe)", media: [] };
  const responses = [
    { status: 500, ok: false },
    { status: 200, ok: true, async json() { return detail; } }
  ];
  const context = {
    Map,
    albumTrackCache: {},
    albumTrackDetailPromises: new Map(),
    getStoredAlbumDetail: () => null,
    storeAlbumDetail: () => {},
    fetchMusicBrainz: async () => responses.shift(),
    window: { setTimeout(callback) { callback(); } }
  };
  vm.runInNewContext(extract("async function fetchAlbumDetail", "async function fetchReleaseGroupCover"), context);
  await assert.rejects(context.fetchAlbumDetail("release-id"), /Album detail request failed: 500/);
  assert.equal(context.albumTrackDetailPromises.size, 0);
  assert.equal((await context.fetchAlbumDetail("release-id")).id, "release-id");
  assert.match(app, /title: "Track list temporarily unavailable"/);
  assert.match(app, /action: "retry-album"/);
  assert.match(app, /album: albumSelection/);
});

test("artist albums use the full renderer and preserve artist-page browser history", () => {
  const clickPath = extract('const artistAlbumCard = event.target.closest("[data-artist-album-index]")', "const similarArtistCard");
  assert.match(clickPath, /buildArtistAlbumSelection/);
  assert.match(clickPath, /await renderSelectedItem\(\)/);
  assert.match(clickPath, /showOnlySection\("detailSection"\)/);
  assert.match(artistPresentation, /history\.pushState\(\{ bomShare: true, itemType: "artist" \}/);
  assert.match(artistPresentation, /\.bom-v1-artist \[data-library-type='album'\], \.bom-v1-artist \[data-artist-album-index\]/);
  assert.match(artistPresentation, /\["Enter", " "\]\.includes\(event\.key\)/);
});

test("internal and shared album URLs retain release-group identity", () => {
  const shareBuilder = extract("function buildShareUrl", "async function shareSelectedItem");
  const context = { URL, selectedItem: null, window: { location: { href: "https://thebankofmusic.com/" } } };
  vm.runInNewContext(shareBuilder, context);
  const url = new URL(context.buildShareUrl({
    type: "album", title: "People Watching", artist: "Sam Fender",
    releaseGroupId: "people-watching-group"
  }));
  assert.equal(url.searchParams.get("share"), "album");
  assert.equal(url.searchParams.get("releaseGroup"), "people-watching-group");
  assert.match(app, /releaseGroupId: params\.get\("releaseGroup"\) \|\| ""/);
  assert.match(app, /window\.addEventListener\("popstate"[\s\S]*await handleIncomingShareLink\(\)/);
});

test("album navigation retains the null-ID track guard and deploys under a fresh asset URL", () => {
  assert.match(app, /Number\.isSafeInteger\(catalogueAlbumId\) && catalogueAlbumId > 0/);
  assert.match(index, /app\.js\?v=179&autocomplete=2&search-autosave=1&listening-ui=2/);
});
