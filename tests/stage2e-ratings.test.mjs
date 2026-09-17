import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [html, app, ratings, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-ratings.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);

function loadRatingsUI() {
  const document = { addEventListener() {}, querySelector() { return null; } };
  const window = {
    location: { search: "" },
    BOMUI: {
      SegmentedControl({ options, selected }) { return `<div>${options.map((option) => `<button data-value="${option.value}" aria-pressed="${option.value === selected}">${option.text}</button>`).join("")}</div>`; },
      SectionState({ title, message, actionLabel = "" }) { return `<div>${title}|${message}|${actionLabel}</div>`; }
    }
  };
  vm.runInNewContext(ratings, { window, document, URLSearchParams, Number, String });
  return window.BOMRatingsUI;
}

test("Stage 2E loads only within the Stage 1 asset chain", () => {
  assert.match(html, /get\("ui"\) !== "legacy"/);
  assert.match(html, /bom-ratings\.js\?v=2/);
  assert.match(html, /app\.js\?v=119/);
  assert.match(app, /isStageOnePresentation\(\) && window\.BOMRatingsUI/);
});

test("Ratings adapter reuses existing personal and community calculations", () => {
  assert.match(app, /function buildStageOneRatingsModel/);
  assert.match(app, /allAlbumRatings\.filter\(\(row\) => row\.user_id === currentUser\.id\)/);
  assert.match(app, /allSongRatings\.filter\(\(row\) => row\.user_id === currentUser\.id\)/);
  assert.match(app, /getAlbumAverage\(album\.id\)/);
  assert.match(app, /getSongAverage\(track\.id\)/);
  assert.match(app, /getAlbumArtworkUrl\(album\)/);
  assert.doesNotMatch(ratings, /supabaseClient|\.rpc\(|\bfetch\(/i);
});

test("Albums and tracks clearly expose personal and community scores", () => {
  const ui = loadRatingsUI();
  const model = {
    authenticated: true,
    albums: [{ id: 1, title: "A Long Album Title", artist: "The Artist", year: "1999", artworkUrl: "cover.jpg", personal: 9, community: { average: 8.4, count: 21 } }],
    tracks: [{ id: 2, title: "A Long Track Title", artist: "The Artist", albumId: 1, albumTitle: "A Long Album Title", year: "1999", artworkUrl: "", personal: 10, community: { average: 9.1, count: 7 } }]
  };
  const albums = ui.render(model, "albums");
  assert.match(albums, /Your life in records/);
  assert.match(albums, /A Long Album Title/);
  assert.match(albums, /<small>You<\/small><strong>9<\/strong>/);
  assert.match(albums, /<small>Community<\/small><strong>8\.4<\/strong>/);
  assert.match(albums, /21 ratings/);
  const tracks = ui.render(model, "tracks");
  assert.match(tracks, /A Long Track Title/);
  assert.match(tracks, /A Long Album Title · 1999/);
  assert.match(tracks, /Artwork unavailable/);
  assert.match(tracks, /<small>You<\/small><strong>10<\/strong>/);
});

test("Ratings controls support collection-scale filtering and sorting", () => {
  assert.match(ratings, /data-bom-ratings-query/);
  assert.match(ratings, /data-bom-ratings-minimum/);
  assert.match(ratings, /All ratings/);
  assert.match(ratings, /data-bom-ratings-sort/);
  assert.match(ratings, /My rating/);
  assert.match(ratings, /Artist/);
  assert.match(ratings, /Release year/);
  assert.match(ratings, /Number\(b\.personal \|\| 0\) - Number\(a\.personal \|\| 0\)/);
  assert.match(ratings, /items\.slice\(0, visibleLimit\)/);
  assert.match(ratings, /visibleLimit \+= 60/);
  assert.match(ratings, /Show more/);
});

test("Ratings navigate into approved Album and Artist renderers", () => {
  assert.match(ratings, /BOMPresentationBridge\?\.openAlbumById/);
  assert.match(ratings, /BOMPresentationBridge\?\.openArtist/);
  assert.match(app, /openAlbumById: \(albumId\) => openStageOneRatingsAlbum\(albumId\)/);
  assert.match(app, /async function openStageOneRatingsAlbum/);
  assert.match(app, /await renderSelectedItem\(\)/);
});

test("Ratings include signed-out, loading, empty and retryable error states", () => {
  const ui = loadRatingsUI();
  assert.match(ui.render({ authenticated: false, albums: [], tracks: [] }), /Sign in to see your ratings/);
  assert.match(ui.render({ authenticated: true, albums: [], tracks: [] }, "albums"), /No rated albums yet/);
  assert.match(ui.render({ authenticated: true, albums: [], tracks: [] }, "tracks"), /No rated tracks yet/);
  assert.match(ui.renderLoading(), /aria-busy="true"/);
  assert.match(ui.renderError(), /Your ratings couldn’t load/);
  assert.match(ui.renderError(), /Try again/);
});

test("Ratings are namespaced and responsive without legacy visual styling", () => {
  assert.match(styles, /\.bom-shell-v1 \.bom-v1-ratings/);
  assert.match(styles, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(ratings, /purple|glow|gradient|emoji/i);
});

test("legacy Ratings remains available without the Stage 1 flag", () => {
  assert.match(app, /if \(isStageOnePresentation\(\) && window\.BOMRatingsUI\)[\s\S]*return;[\s\S]*const ratedAlbumIds/);
  assert.match(app, /renderPosterCard\(album/);
  assert.match(app, /renderPosterCard\(song/);
});

test("Stage 2E assets contain no catalogue or qualification infrastructure", () => {
  assert.doesNotMatch(ratings + styles, /artist-catalog|qualification-v2|shadow snapshot|artist_import_queue|catalogue worker/i);
});
