import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [html, app, foundation, discover, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-discover.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);

test("Stage 2C loads only with the opt-in Stage 1 assets", () => {
  assert.match(html, /get\("ui"\) !== "legacy"/);
  assert.match(html, /bom-foundation\.js\?v=12/);
  assert.match(html, /bom-discover\.js\?v=17&history=10&bond=2/);
  assert.match(app, /isStageOnePresentation\(\) && window\.BOMDiscoverUI/);
  assert.match(app, /window\.BOMDiscoverUI\.render\(buildStageOneDiscoverModel\(\)\)/);
});

test("Discover adapter preserves production recommendation semantics", () => {
  assert.match(app, /function buildStageOneDiscoverModel/);
  assert.match(app, /Number\(row\.rating\) >= 8/);
  assert.match(app, /\.sort\(\(a, b\) => b\.rating - a\.rating\)/);
  assert.doesNotMatch(app.match(/function buildStageOneDiscoverModel[\s\S]*?return \{ authenticated/)?.[0] || "", /\.slice\(0, 3\)/);
  assert.match(app, /normaliseCompare\(album\.artist\) === normaliseCompare\(ratedItem\.album\.artist\)/);
  assert.match(app, /!ratedAlbumIds\.has\(Number\(album\.id\)\)/);
  assert.match(app, /isLikelyStudioAlbum\(album\)/);
  assert.match(app, /\.slice\(0, 4\)/);
  assert.match(app, /getAlbumTrackCount\(Number\(b\.id\)\) - getAlbumTrackCount\(Number\(a\.id\)\)/);
  assert.match(app, /buildStageOneNextListenAlbums\(highRatedAlbums, ratedAlbumIds\)/);
});

function buildRecommendationGroups(ratedAlbums, ratedIds, candidates, maxGroups = 3) {
  const start = app.indexOf("function buildStageOneRatedRecommendationGroups");
  const end = app.indexOf("function buildStageOneDiscoverModel", start);
  const source = app.slice(start, end);
  const context = {
    normaliseCompare: (value) => String(value).toLowerCase(),
    isLikelyStudioAlbum: () => true,
    buildStageOneDiscoverAlbum: (album) => ({ ...album })
  };
  return vm.runInNewContext(
    `${source}; buildStageOneRatedRecommendationGroups(ratedAlbums, ratedIds, candidates, maxGroups);`,
    { ...context, ratedAlbums, ratedIds, candidates, maxGroups, Set, Number }
  );
}

test("rating-based recommendation groups contain up to four unique unrated albums", () => {
  const ratedAlbums = [
    { album: { id: 1, title: "First favourite", artist: "Same Artist" }, rating: 10 },
    { album: { id: 2, title: "Second favourite", artist: "Same Artist" }, rating: 9 }
  ];
  const candidates = Array.from({ length: 8 }, (_, index) => ({
    id: index + 3,
    title: `Candidate ${index + 1}`,
    artist: "Same Artist"
  }));
  const result = buildRecommendationGroups(ratedAlbums, new Set([1, 2]), candidates);
  assert.deepEqual(Array.from(result[0].albums, (album) => album.id), [3, 4, 5, 6]);
  assert.deepEqual(Array.from(result[1].albums, (album) => album.id), [7, 8, 9, 10]);
  assert.equal(new Set(result.flatMap((group) => group.albums.map((album) => album.id))).size, 8);
});

test("rated recommendations are excluded and the next eligible album backfills", () => {
  const seeds = [{ album: { id: 1, title: "Seed", artist: "Artist" }, rating: 10 }];
  const candidates = Array.from({ length: 6 }, (_, index) => ({ id: index + 2, title: `Album ${index + 2}`, artist: "Artist" }));
  const result = buildRecommendationGroups(seeds, new Set([1, 3]), candidates);
  assert.deepEqual(Array.from(result[0].albums, (album) => album.id), [2, 4, 5, 6]);
});

test("exhausted seeds fall through to later eligible highly-rated albums", () => {
  const seeds = [
    { album: { id: 1, title: "Exhausted", artist: "No More Albums" }, rating: 10 },
    { album: { id: 2, title: "Also exhausted", artist: "Still Empty" }, rating: 9 },
    { album: { id: 3, title: "Reseed", artist: "Productive Artist" }, rating: 8 }
  ];
  const candidates = Array.from({ length: 4 }, (_, index) => ({ id: index + 4, title: `Recommendation ${index + 1}`, artist: "Productive Artist" }));
  const result = buildRecommendationGroups(seeds, new Set([1, 2, 3]), candidates);
  assert.equal(result.length, 1);
  assert.equal(result[0].reason.title, "Reseed");
  assert.deepEqual(Array.from(result[0].albums, (album) => album.id), [4, 5, 6, 7]);
});

test("rating-based sections disappear only when no seed has a valid recommendation", () => {
  const seeds = [
    { album: { id: 1, title: "One", artist: "Artist A" }, rating: 10 },
    { album: { id: 2, title: "Two", artist: "Artist B" }, rating: 8 }
  ];
  const candidates = [{ id: 3, title: "Already rated", artist: "Artist B" }];
  assert.equal(buildRecommendationGroups(seeds, new Set([1, 2, 3]), candidates).length, 0);
});

function buildNextListen(ratedAlbums, ratedIds, candidates, trackCounts = {}, limit = 8) {
  const start = app.indexOf("function buildStageOneNextListenAlbums");
  const end = app.indexOf("function buildStageOneDiscoverModel", start);
  const source = app.slice(start, end);
  const context = {
    normaliseCompare: (value) => String(value || "").trim().toLowerCase(),
    isLikelyStudioAlbum: () => true,
    getAlbumTrackCount: (id) => trackCounts[id] || 0,
    buildStageOneDiscoverAlbum: (album) => ({ ...album })
  };
  return vm.runInNewContext(
    `${source}; buildStageOneNextListenAlbums(ratedAlbums, ratedIds, candidates, limit);`,
    { ...context, ratedAlbums, ratedIds, candidates, trackCounts, limit, Map, Set, Number, Math }
  );
}

test("Your next listen ranks albums from highly rated artists ahead of global popularity", () => {
  const favourites = [{ album: { id: 1, artist: "Favourite Artist" }, rating: 9 }];
  const candidates = [
    { id: 2, title: "Popular unrelated album", artist: "Other Artist" },
    { id: 3, title: "Related album", artist: "Favourite Artist" }
  ];
  const result = buildNextListen(favourites, new Set([1]), candidates, { 2: 20, 3: 8 });
  assert.equal(result[0].id, 3);
});

test("Your next listen excludes every album the user has already rated", () => {
  const candidates = [
    { id: 1, title: "Rated album", artist: "Rated Artist" },
    { id: 2, title: "Unrated album", artist: "Unrated Artist" }
  ];
  const result = buildNextListen([], new Set([1]), candidates);
  assert.deepEqual(Array.from(result, (album) => album.id), [2]);
});

test("Your next listen returns up to eight albums with one normalized artist each", () => {
  const candidates = [
    { id: 1, title: "First", artist: "The Artist" },
    { id: 2, title: "Duplicate", artist: " the artist " },
    ...Array.from({ length: 9 }, (_, index) => ({ id: index + 3, title: `Album ${index + 3}`, artist: `Artist ${index + 1}` }))
  ];
  const result = buildNextListen([], new Set(), candidates, Object.fromEntries(candidates.map((album, index) => [album.id, 100 - index])));
  assert.equal(result.length, 8);
  assert.equal(new Set(result.map((album) => album.artist.trim().toLowerCase())).size, 8);
  assert.equal(result.filter((album) => album.artist.trim().toLowerCase() === "the artist").length, 1);
});

test("Discover view model includes artwork, reliable year and community rating", () => {
  assert.match(app, /function buildStageOneDiscoverAlbum/);
  assert.match(app, /getAlbumArtworkUrl\(album\)/);
  assert.match(app, /getStageOneDiscoverYear\(album\)/);
  assert.match(app, /getAlbumAverage\(album\.id\)/);
  assert.match(app, /BOMAlbumUI\?\.formatReleaseDate/);
  assert.match(foundation, /AlbumCard\(\{ id, title, artist = "", artworkUrl = "", year = "", community = null \}/);
  assert.match(foundation, /Artwork unavailable/);
  assert.match(foundation, /Not rated/);
});

test("Discover renders recommendation reasons, long titles and low-data states", () => {
  const listeners = {};
  const document = {
    addEventListener(type, handler) { listeners[type] = handler; },
    querySelectorAll() { return []; },
    getElementById() { return null; }
  };
  const window = {
    BOMUI: {
      AlbumCard(album) { return `<article>${album.title}|${album.artist}|${album.year}|${album.community?.average ?? "Not rated"}|${album.artworkUrl || "Artwork unavailable"}</article>`; },
      SectionState({ title, message, actionLabel }) { return `<div>${title}|${message}|${actionLabel}</div>`; }
    },
    addEventListener() {}, setTimeout() {}, history: { state: null, replaceState() {}, pushState() {} }, location: { href: "http://localhost/" }
  };
  vm.runInNewContext(discover, { window, document, URL, Math });
  const longTitle = "The Record That Took the Long Way Home (Expanded Anniversary Edition)";
  const rendered = window.BOMDiscoverUI.render({ authenticated: true, groups: [{ key: "1", reason: { title: "The Masterplan", rating: 10 }, albums: [{ id: 2, title: longTitle, artist: "A Very Long Artist Name", artworkUrl: "", year: "1997", community: null }] }], general: [{ id: 3, title: "Next Album", artist: "Next Artist", artworkUrl: "", year: "2001", community: null }] });
  assert.ok(rendered.indexOf("Your next listen") < rendered.indexOf("Because you rated"));
  assert.match(rendered, /Because you rated <strong>The Masterplan<\/strong> 10 \/ 10/);
  assert.match(rendered, new RegExp(longTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(rendered, /Not rated/);
  assert.match(rendered, /Artwork unavailable/);
  assert.match(window.BOMDiscoverUI.render({ authenticated: true, groups: [], general: [] }), /Your next record is waiting/);
  const guest = window.BOMDiscoverUI.render({ authenticated: false, groups: [], general: [] });
  assert.match(guest, /Sign in to make Discover yours/);
  assert.match(guest, /data-bom-discovery-carousel/);
  assert.ok(guest.indexOf("Quick rate") < guest.indexOf("BOM GAMES · COMING SOON"));
  assert.match(window.BOMDiscoverUI.renderLoading(), /aria-busy="true"/);
  assert.match(window.BOMDiscoverUI.renderError(), /Discover couldn’t load/);
});

test("guest first paint defers historical data and viewer changes never reuse personal history", async () => {
  let state = { authenticated: false, viewerKey: "guest" };
  let historicalLoads = 0;
  let rerenders = 0;
  let releaseGuestLoad;
  let deferGuestLoad = false;
  const clickHandlers = [];
  const document = {
    hidden: false,
    addEventListener(type, handler) { if (type === "click") clickHandlers.push(handler); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; }
  };
  const window = {
    BOMUI: { AlbumCard: () => "", SectionState: () => "" },
    BOMPresentationBridge: {
      getState: () => state,
      loadHistoricalDiscovery: async () => {
        historicalLoads += 1;
        if (deferGuestLoad) return new Promise(resolve => { releaseGuestLoad = resolve; });
        return { albums: [], numberOnes: [] };
      },
      rerenderDiscover() { rerenders += 1; },
      refreshDiscover() {}
    },
    addEventListener() {},
    setTimeout: () => 0,
    clearTimeout() {},
    history: { state: null, replaceState() {}, pushState() {} },
    location: { href: "http://localhost/" }
  };
  vm.runInNewContext(discover, { window, document, URL, Math, Promise, matchMedia: () => ({ matches: true }), clearTimeout() {}, setTimeout: () => 0 });
  const root = { querySelector: () => null, querySelectorAll: () => [] };

  window.BOMDiscoverUI.render({ authenticated: false, groups: [], general: [] });
  window.BOMDiscoverUI.updateRowControls(root);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(historicalLoads, 0, "guest Quick Rate should not download historical slides on first paint");

  deferGuestLoad = true;
  const slides = Array.from({ length: 3 }, () => ({ setAttribute() {}, toggleAttribute() {} }));
  const dots = Array.from({ length: 3 }, () => ({ setAttribute() {} }));
  const carousel = {
    isConnected: true,
    dataset: {},
    matches: selector => selector === "[data-bom-discovery-carousel]",
    querySelector: selector => selector === ".bom-v1-discovery-track" ? { style: { setProperty() {} } } : null,
    querySelectorAll: selector => selector === ".bom-v1-discovery-slide" ? slides : selector === "[data-bom-carousel-go]" ? dots : [],
    addEventListener() {},
    contains() { return false; }
  };
  carousel.parentElement = { querySelector: selector => selector === "[data-bom-discovery-carousel]" ? carousel : null };
  const go = { dataset: { bomCarouselGo: "1" } };
  const target = { closest(selector) { if (selector === "[data-bom-discovery-carousel]") return carousel; if (selector === "[data-bom-carousel-go]") return go; return null; } };
  clickHandlers.forEach(handler => handler({ target }));
  assert.equal(historicalLoads, 1);
  assert.equal(rerenders, 0);
  deferGuestLoad = false;
  releaseGuestLoad({ albums: [], numberOnes: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rerenders, 1, "advancing a guest carousel should rerender its newly hydrated slide");

  state = { authenticated: true, viewerKey: "member:one" };
  window.BOMDiscoverUI.render({ authenticated: true, groups: [], general: [] });
  deferGuestLoad = true;
  carousel.isConnected = true;
  clickHandlers.forEach(handler => handler({ target }));
  assert.equal(historicalLoads, 2);
  carousel.isConnected = false;
  deferGuestLoad = false;
  releaseGuestLoad({ albums: [], numberOnes: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rerenders, 1, "a detached carousel must not replace a newer destination after its load resolves");

  state = { authenticated: true, viewerKey: "member:two" };
  window.BOMDiscoverUI.render({ authenticated: true, groups: [], general: [] });
  deferGuestLoad = true;
  carousel.isConnected = true;
  clickHandlers.forEach(handler => handler({ target }));
  assert.equal(historicalLoads, 3, "a different member must receive a fresh personal projection");
  carousel.isConnected = false;
  const liveCarousel = { ...carousel, isConnected: true, dataset: {} };
  liveCarousel.parentElement = { querySelector: selector => selector === "[data-bom-discovery-carousel]" ? liveCarousel : null };
  const liveTarget = { closest(selector) { if (selector === "[data-bom-discovery-carousel]") return liveCarousel; if (selector === "[data-bom-carousel-go]") return go; return null; } };
  clickHandlers.forEach(handler => handler({ target: liveTarget }));
  deferGuestLoad = false;
  releaseGuestLoad({ albums: [], numberOnes: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rerenders, 2, "a live carousel joining after a detached one must still receive the hydrated render");

  state = { authenticated: false, viewerKey: "guest" };
  window.BOMDiscoverUI.render({ authenticated: false, groups: [], general: [] });
  window.BOMDiscoverUI.updateRowControls(root);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(historicalLoads, 4, "sign-out on an active history slide must reload the guest-safe projection");
});

test("a transient historical load failure remains retryable", async () => {
  let calls = 0;
  const document = { hidden: false, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
  const window = {
    BOMUI: { AlbumCard: () => "", SectionState: ({ title }) => `<div>${title}</div>` },
    BOMPresentationBridge: {
      getState: () => ({ authenticated: true, viewerKey: "member:retry" }),
      loadHistoricalDiscovery: async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary");
        return { albums: [], numberOnes: [] };
      },
      rerenderDiscover() {}
    },
    addEventListener() {}, setTimeout: () => 0, clearTimeout() {},
    history: { state: null, replaceState() {}, pushState() {} }, location: { href: "http://localhost/" }
  };
  vm.runInNewContext(discover, { window, document, URL, Math, Promise, matchMedia: () => ({ matches: true }), clearTimeout() {}, setTimeout: () => 0 });
  const root = { querySelector: () => null, querySelectorAll: () => [] };
  window.BOMDiscoverUI.render({ authenticated: true, groups: [], general: [] });
  window.BOMDiscoverUI.updateRowControls(root);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  window.BOMDiscoverUI.updateRowControls(root);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.match(discover, /historyLoadError/);
});

test("Discover navigation targets approved Album and Artist routes and restores browser state", () => {
  assert.match(foundation, /data-library-type="album" data-album-id/);
  assert.match(foundation, /data-bom-discover-artist/);
  assert.match(discover, /BOMPresentationBridge\?\.openArtist/);
  assert.match(discover, /replaceState\(\{ \.\.\.\(window\.history\.state \|\| \{\}\), bomDiscover: true, scrollY: window\.scrollY \}/);
  assert.match(discover, /pushState\(\{ bomDiscoverDestination: true \}/);
  assert.match(app, /event\.state\?\.bomDiscover/);
  assert.match(app, /showOnlySection\("recommendationsSection"\)/);
});

test("Discover presentation is progressive, responsive and free of legacy styling", () => {
  assert.match(discover, /renderLoading/);
  assert.match(discover, /renderError/);
  assert.match(discover, /updateRowControls/);
  assert.match(discover, /rerenderDiscover\?\.\(\)/);
  assert.match(app, /rerenderDiscover: \(\) => renderRecommendations\(\)/);
  assert.doesNotMatch(discover, /supabaseClient|\.rpc\(|\bfetch\(/i);
  assert.doesNotMatch(discover, /smart-recommendation-block|poster-card|purple|gradient|emoji/i);
  assert.match(styles, /\.bom-v1-discover-row/);
  assert.match(styles, /scroll-snap-type: inline proximity/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.match(styles, /grid-auto-columns: minmax\(156px, 44vw\)/);
  assert.match(styles, /\.bom-v1-discover-group \.bom-v1-discover-row \{ grid-auto-columns: calc\(\(100% - 66px\) \/ 4\); \}/);
});

test("legacy Discover renderer remains available without the Stage 1 flag", () => {
  assert.match(app, /if \(isStageOnePresentation\(\) && window\.BOMDiscoverUI\)[\s\S]*return;[\s\S]*if \(!currentUser\)/);
  assert.match(app, /buildSmartRecommendationHtml\(\)/);
  assert.match(app, /smart-recommendation-block/);
  assert.match(app, /poster-empty/);
});

test("Stage 2C assets contain no catalogue or qualification infrastructure", () => {
  assert.doesNotMatch(discover + foundation + styles, /artist-catalog|qualification-v2|shadow snapshot|artist_import_queue|catalogue worker/i);
});
