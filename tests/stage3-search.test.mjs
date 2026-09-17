import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [html, app, search, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-search.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);
const foundation = await readFile(new URL("../bom-foundation.js", import.meta.url), "utf8");

function loadSearchUI() {
  const document = { addEventListener() {}, getElementById() { return null; } };
  const window = { location: { search: "" } };
  vm.runInNewContext(search, { window, document, Number, String, Array, Object, URLSearchParams });
  return window.BOMSearchUI;
}

test("Stage 3 search presentation loads only in the Stage 1 chain", () => {
  assert.match(html, /get\("ui"\) !== "legacy"/);
  assert.match(html, /bom-search\.js\?v=2/);
  assert.match(app, /isStageOnePresentation\(\) && window\.BOMSearchUI/);
});

test("universal results retain existing selection and expansion contracts", () => {
  const output = loadSearchUI().render({
    query: "Radiohead",
    artists: [{ index: 0, name: "Radiohead", country: "GB" }],
    albums: [{ index: 0, title: "OK Computer", artist: "Radiohead", year: "1997", artworkUrl: "cover.jpg", community: { average: 9.1, count: 50 } }],
    songs: [{ index: 0, title: "Paranoid Android", artist: "Radiohead", albumTitle: "OK Computer", year: "1997" }]
  });
  assert.match(output, /Artists/);
  assert.match(output, /Albums/);
  assert.match(output, /Tracks/);
  assert.match(output, /data-group="artists" data-index="0"/);
  assert.match(output, /data-group="albums" data-index="0"/);
  assert.match(output, /data-group="songs" data-index="0"/);
  assert.match(output, /9\.1/);
});

test("search preserves existing requests, ranking and selection handlers", () => {
  assert.match(app, /Promise\.all\(\[/);
  assert.match(app, /musicbrainz\.org\/ws\/2\/artist/);
  assert.match(app, /musicbrainz\.org\/ws\/2\/release/);
  assert.match(app, /musicbrainz\.org\/ws\/2\/recording/);
  assert.match(app, /sortBySearchScore/);
  assert.match(app, /globalSearchResults\.addEventListener\("click"/);
  assert.match(app, /selectedItem = groupedResults\[group\]\[index\]/);
  assert.doesNotMatch(search, /supabaseClient|\.rpc\(|\bfetch\(/i);
});

test("search includes loading, empty and retryable error states", () => {
  const ui = loadSearchUI();
  assert.match(ui.renderLoading("Bowie"), /aria-busy="true"/);
  assert.match(ui.renderEmpty("Bowie"), /No results found/);
  assert.match(ui.renderError("Bowie"), /Search couldn’t load/);
  assert.match(ui.renderError("Bowie"), /Try again/);
});

test("search is namespaced, responsive and avoids legacy styling", () => {
  assert.match(styles, /\.bom-shell-v1 \.bom-v1-search-results/);
  assert.match(styles, /@media \(max-width: 700px\)/);
  assert.doesNotMatch(search, /purple|glow|gradient|star/i);
});

test("Stage 1 top-level routes replace stale detail parameters and restore on popstate", () => {
  assert.match(foundation, /function rememberRoute/);
  assert.match(foundation, /"share", "id", "albumId", "songId"/);
  assert.match(foundation, /history\.pushState\(\{ bomStageOneRoute: route, query \}/);
  assert.match(foundation, /route === "charts"/);
  assert.match(foundation, /route === "ratings"/);
  assert.match(foundation, /route === "search"/);
  assert.match(app, /params\.get\("view"\) === "search" && window\.BOMSearchUI/);
  assert.match(search, /get\("view"\) === "search"/);
});

test("Stage 1 Profile removes legacy glow and star presentation without changing its behavior", () => {
  assert.match(styles, /\.bom-shell-v1 \.profile-card-panel/);
  assert.match(styles, /background: var\(--bom-v1-surface\) !important/);
  assert.match(styles, /\.bom-shell-v1 \.profile-album-rating/);
  assert.match(app, /isStageOnePresentation\(\) \? "" : "⭐ "/);
});
