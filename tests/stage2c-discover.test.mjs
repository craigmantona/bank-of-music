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
  assert.match(html, /get\("ui"\) === "stage1"/);
  assert.match(html, /bom-foundation\.js\?v=2/);
  assert.match(html, /bom-discover\.js\?v=2/);
  assert.match(app, /isStageOnePresentation\(\) && window\.BOMDiscoverUI/);
  assert.match(app, /window\.BOMDiscoverUI\.render\(buildStageOneDiscoverModel\(\)\)/);
});

test("Discover adapter preserves production recommendation semantics", () => {
  assert.match(app, /function buildStageOneDiscoverModel/);
  assert.match(app, /Number\(row\.rating\) >= 8/);
  assert.match(app, /\.sort\(\(a, b\) => b\.rating - a\.rating\)/);
  assert.match(app, /\.slice\(0, 3\)/);
  assert.match(app, /normaliseCompare\(album\.artist\) === normaliseCompare\(ratedItem\.album\.artist\)/);
  assert.match(app, /!ratedAlbumIds\.has\(Number\(album\.id\)\)/);
  assert.match(app, /isLikelyStudioAlbum\(album\)/);
  assert.match(app, /\.slice\(0, 4\)/);
  assert.match(app, /getAlbumTrackCount\(Number\(b\.id\)\) - getAlbumTrackCount\(Number\(a\.id\)\)/);
  assert.match(app, /\.slice\(0, 8\)/);
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
  const rendered = window.BOMDiscoverUI.render({ authenticated: true, groups: [{ key: "1", reason: { title: "The Masterplan", rating: 10 }, albums: [{ id: 2, title: longTitle, artist: "A Very Long Artist Name", artworkUrl: "", year: "1997", community: null }] }], general: [] });
  assert.match(rendered, /Because you rated <strong>The Masterplan<\/strong> 10 \/ 10/);
  assert.match(rendered, new RegExp(longTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(rendered, /Not rated/);
  assert.match(rendered, /Artwork unavailable/);
  assert.match(window.BOMDiscoverUI.render({ authenticated: true, groups: [], general: [] }), /Your next record is waiting/);
  assert.match(window.BOMDiscoverUI.render({ authenticated: false, groups: [], general: [] }), /Sign in to make Discover yours/);
  assert.match(window.BOMDiscoverUI.renderLoading(), /aria-busy="true"/);
  assert.match(window.BOMDiscoverUI.renderError(), /Discover couldn’t load/);
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
  assert.doesNotMatch(discover, /supabaseClient|\.rpc\(|\bfetch\(/i);
  assert.doesNotMatch(discover, /smart-recommendation-block|poster-card|purple|gradient|emoji/i);
  assert.match(styles, /\.bom-v1-discover-row/);
  assert.match(styles, /scroll-snap-type: inline proximity/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.match(styles, /grid-auto-columns: minmax\(156px, 44vw\)/);
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
