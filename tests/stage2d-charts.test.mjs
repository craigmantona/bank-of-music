import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [html, app, charts, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-charts.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);

function loadChartsUI() {
  const listeners = {};
  const document = {
    addEventListener(type, handler) { listeners[type] = handler; }
  };
  const window = {
    location: { search: "" },
    BOMUI: {
      SegmentedControl({ options, selected }) {
        return `<div>${options.map((option) => `<button data-value="${option.value}" aria-pressed="${option.value === selected}">${option.text}</button>`).join("")}</div>`;
      },
      SectionState({ title, message, actionLabel = "" }) { return `<div>${title}|${message}|${actionLabel}</div>`; }
    }
  };
  vm.runInNewContext(charts, { window, document, Number, String, URLSearchParams });
  return window.BOMChartsUI;
}

test("Stage 2D loads in the approved default chain", () => {
  assert.match(html, /get\("ui"\) !== "legacy"/);
  assert.match(html, /bom-charts\.js\?v=3/);
  assert.match(html, /app\.js\?v=121/);
  assert.match(app, /isStageOnePresentation\(\) && window\.BOMChartsUI/);
});

test("the direct Charts preview route opens Stage 2D after its asset loads", () => {
  assert.match(charts, /new URLSearchParams\(window\.location\.search\)\.get\("view"\) === "charts"/);
  assert.match(charts, /BOMPresentationBridge\?\.openRequestedRoute\(\)/);
  assert.match(app, /!stageOneInitialDataReady \|\| params\.get\("ui"\) === "legacy"/);
  assert.match(app, /params\.get\("view"\) === "charts" && window\.BOMChartsUI/);
});

test("Charts retain the existing production views, ordering and limits", () => {
  assert.match(app, /from\("album_rating_charts"\)[\s\S]*order\("average_rating", \{ ascending: false \}\)[\s\S]*order\("rating_count", \{ ascending: false \}\)[\s\S]*limit\(20\)/);
  assert.match(app, /from\("song_rating_charts"\)[\s\S]*order\("average_rating", \{ ascending: false \}\)[\s\S]*order\("rating_count", \{ ascending: false \}\)[\s\S]*limit\(20\)/);
  assert.match(charts, /rows\.slice\(0, 10\)/);
  assert.doesNotMatch(charts, /supabaseClient|\.rpc\(|\bfetch\(/i);
});

test("Charts render scannable album and track rankings with useful context", () => {
  const ui = loadChartsUI();
  const model = {
    albums: [{ id: 1, title: "A Very Long Album Title That Still Needs to Wrap Cleanly", artist: "The Artist", year: "1977", artworkUrl: "cover.jpg", averageRating: 9.4, ratingCount: 12 }],
    tracks: [{ id: 2, title: "A Track", artist: "The Artist", albumTitle: "The Album", year: "1977", artworkUrl: "", averageRating: 9.7, ratingCount: 3 }]
  };
  const albums = ui.render(model, "albums");
  assert.match(albums, /Top 10 Albums/);
  assert.match(albums, /A Very Long Album Title/);
  assert.match(albums, /The Artist · 1977/);
  assert.match(albums, /9\.4/);
  assert.match(albums, /12 community ratings/);
  assert.match(albums, /data-chart-type="album"/);

  const tracks = ui.render(model, "tracks");
  assert.match(tracks, /Top 10 Tracks/);
  assert.match(tracks, /The Artist · The Album · 1977/);
  assert.match(tracks, /Artwork unavailable/);
  assert.match(tracks, /data-chart-type="song"/);
});

test("Charts include loading, empty and retryable error states", () => {
  const ui = loadChartsUI();
  assert.match(ui.renderLoading(), /aria-busy="true"/);
  assert.match(ui.render({ albums: [], tracks: [] }, "albums"), /No rated albums yet/);
  assert.match(ui.render({ albums: [], tracks: [] }, "tracks"), /No rated tracks yet/);
  assert.match(ui.renderError(), /The charts couldn’t load/);
  assert.match(ui.renderError(), /Try again/);
  assert.match(app, /refreshCharts: \(\) => loadCharts\(\)/);
});

test("Charts preserve existing item navigation and legacy rollback", () => {
  assert.match(charts, /class="chart-row bom-v1-chart-row"/);
  assert.match(app, /event\.target\.closest\("\.chart-row"\)/);
  assert.match(app, /if \(itemType === "album"\)[\s\S]*from\("albums"\)/);
  assert.match(app, /if \(itemType === "song"\)[\s\S]*from\("songs"\)/);
  assert.match(app, /globalAlbumCharts\.innerHTML = `[\s\S]*renderChartRows\(albums \|\| \[\]\)/);
});

test("Charts are namespaced, responsive and avoid legacy visual styling", () => {
  assert.match(styles, /\.bom-shell-v1 \.bom-v1-charts/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(charts, /purple|gradient|glow|emoji|🔥|🎵/i);
});

test("Stage 2D assets contain no catalogue or qualification infrastructure", () => {
  assert.doesNotMatch(charts + styles, /artist-catalog|qualification-v2|shadow snapshot|artist_import_queue|catalogue worker/i);
});
