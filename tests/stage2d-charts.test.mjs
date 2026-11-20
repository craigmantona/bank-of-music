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

function extract(start, end) {
  const from = app.indexOf(start);
  return app.slice(from, app.indexOf(end, from));
}

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
  assert.match(html, /app\.js\?v=\d+&autocomplete=2&search-autosave=1&listening-ui=6/);
  assert.match(app, /isStageOnePresentation\(\) && window\.BOMChartsUI/);
});

test("the direct Charts preview route opens Stage 2D after its asset loads", () => {
  assert.match(charts, /new URLSearchParams\(window\.location\.search\)\.get\("view"\) === "charts"/);
  assert.match(charts, /BOMPresentationBridge\?\.openRequestedRoute\(\)/);
  assert.match(app, /!stageOneInitialDataReady \|\| params\.get\("ui"\) === "legacy"/);
  assert.match(app, /params\.get\("view"\) === "charts" && window\.BOMChartsUI/);
});

test("Charts retain the existing production views, ordering and limits", () => {
  const loadCharts = extract("async function loadCharts", "function buildStageOneChartsModel");
  assert.match(loadCharts, /Promise\.all\(\[/);
  assert.match(loadCharts, /from\("album_rating_charts"\)[\s\S]*select\("item_id,item_type,title,artist,cover_art_url,average_rating,rating_count"\)[\s\S]*order\("average_rating", \{ ascending: false \}\)[\s\S]*order\("rating_count", \{ ascending: false \}\)[\s\S]*limit\(20\)/);
  assert.match(loadCharts, /from\("song_rating_charts"\)[\s\S]*select\("item_id,item_type,title,artist,album_id,average_rating,rating_count"\)[\s\S]*order\("average_rating", \{ ascending: false \}\)[\s\S]*order\("rating_count", \{ ascending: false \}\)[\s\S]*limit\(20\)/);
  assert.match(charts, /rows\.slice\(0, 10\)/);
  assert.doesNotMatch(charts, /supabaseClient|\.rpc\(|\bfetch\(/i);
});

test("Charts show their skeleton before bounded parallel data loading", () => {
  const loadCharts = extract("async function loadCharts", "function buildStageOneChartsModel");
  const goCharts = extract("window.goCharts = async function", "\n};");
  assert.ok(loadCharts.indexOf("renderLoading()") < loadCharts.indexOf("Promise.all(["));
  assert.match(app, /refreshCharts: \(\) => loadCharts\(\)/);
  assert.doesNotMatch(loadCharts, /ensureFullCatalogue|loadLibrary|fetchAllRows|canonical_recordings|followed_artists/);
  assert.doesNotMatch(goCharts, /ensureFullCatalogue/);
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
  assert.match(app, /Chart context load failed[\s\S]*renderError\(\)/);
});

test("Charts hydrate only matching recording context and relevant ratings", async () => {
  const canonicalId = "11111111-1111-4111-8111-111111111111";
  const recordingId = "22222222-2222-4222-8222-222222222222";
  const calls = [];
  const rows = {
    "songs:id": [
      { id: 11, album_id: 1, canonical_song_id: canonicalId, external_source: "musicbrainz", external_id: recordingId },
      { id: 21, album_id: 3, canonical_song_id: null, external_source: "musicbrainz", external_id: recordingId }
    ],
    "songs:canonical_song_id": [
      { id: 11, album_id: 1, canonical_song_id: canonicalId, external_source: "musicbrainz", external_id: recordingId },
      { id: 12, album_id: 2, canonical_song_id: canonicalId, external_source: "musicbrainz", external_id: recordingId }
    ],
    "songs:external_id": [
      { id: 21, album_id: 3, canonical_song_id: null, external_source: "musicbrainz", external_id: recordingId },
      { id: 22, album_id: 4, canonical_song_id: null, external_source: "musicbrainz", external_id: recordingId }
    ],
    "albums:id": [{ id: 4, title: "Original album", is_deleted: false }],
    "song_ratings:canonical_song_id": [
      { id: 1, user_id: "alice", song_id: null, canonical_song_id: canonicalId, rating: 9 }
    ],
    "song_ratings:song_id": [
      { id: 2, user_id: "bob", song_id: 21, canonical_song_id: null, rating: 8 },
      { id: 3, user_id: "bob", song_id: 22, canonical_song_id: null, rating: 8 }
    ]
  };
  const context = {
    fullCatalogueReady: false,
    allAlbums: [{ id: 1 }, { id: 2 }, { id: 3 }],
    allSongs: [],
    allSongRatings: [],
    async fetchRowsInChunks(table, column, values, columns) {
      calls.push({ table, column, values: [...values], columns });
      return rows[`${table}:${column}`] || [];
    },
    getCanonicalSongId: song => String(song?.canonical_song_id || ""),
    getConfirmedMusicBrainzRecordingId: song => song?.external_source === "musicbrainz" ? String(song.external_id || "") : "",
    mergeRowsById(existing, incoming) {
      const merged = new Map(existing.map(row => [String(row.id), row]));
      incoming.forEach(row => merged.set(String(row.id), { ...(merged.get(String(row.id)) || {}), ...row }));
      return [...merged.values()];
    }
  };
  vm.runInNewContext(extract("async function loadChartSongContext", "async function loadCharts"), context);

  await context.loadChartSongContext([{ item_id: 11 }, { item_id: 21 }]);

  assert.deepEqual(context.allSongs.map(row => row.id).sort((a, b) => a - b), [11, 12, 21, 22]);
  assert.deepEqual(context.allAlbums.map(row => row.id).sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.equal(context.allSongRatings.length, 3);
  assert.deepEqual(calls.filter(call => call.table === "songs").map(call => call.column), ["id", "canonical_song_id", "external_id"]);
  assert.deepEqual(calls.find(call => call.table === "albums")?.values, [4]);
  assert.equal(calls.some(call => ["canonical_recordings", "followed_artists", "catalogue_release_group_exclusions"].includes(call.table)), false);
});

test("Charts reuse an already loaded full catalogue", async () => {
  let calls = 0;
  const context = {
    fullCatalogueReady: true,
    async fetchRowsInChunks() {
      calls += 1;
      return [];
    }
  };
  vm.runInNewContext(extract("async function loadChartSongContext", "async function loadCharts"), context);

  await context.loadChartSongContext([{ item_id: 11 }]);

  assert.equal(calls, 0);
});

test("Charts retain full-catalogue rating order for conflicting recording occurrences", async () => {
  const recordingId = "22222222-2222-4222-8222-222222222222";
  const rows = {
    "songs:id": [
      { id: 21, album_id: 1, canonical_song_id: null, external_source: "musicbrainz", external_id: recordingId }
    ],
    "songs:canonical_song_id": [],
    "songs:external_id": [
      { id: 21, album_id: 1, canonical_song_id: null, external_source: "musicbrainz", external_id: recordingId },
      { id: 22, album_id: 2, canonical_song_id: null, external_source: "musicbrainz", external_id: recordingId }
    ],
    "albums:id": [],
    "song_ratings:canonical_song_id": [],
    "song_ratings:song_id": [
      { id: 12, user_id: "alice", song_id: 22, canonical_song_id: null, rating: 2 },
      { id: 5, user_id: "alice", song_id: 21, canonical_song_id: null, rating: 9 }
    ]
  };
  const context = {
    fullCatalogueReady: false,
    allAlbums: [{ id: 1 }, { id: 2 }],
    allSongs: [],
    allSongRatings: [],
    async fetchRowsInChunks(table, column) {
      return rows[`${table}:${column}`] || [];
    },
    getCanonicalSongId: () => "",
    getConfirmedMusicBrainzRecordingId: song => song?.external_source === "musicbrainz" ? String(song.external_id || "") : "",
    getSongRatingOccurrenceIds: () => [21, 22],
    mergeRowsById(existing, incoming) {
      const merged = new Map(existing.map(row => [String(row.id), row]));
      incoming.forEach(row => merged.set(String(row.id), { ...(merged.get(String(row.id)) || {}), ...row }));
      return [...merged.values()];
    }
  };
  vm.runInNewContext(extract("async function loadChartSongContext", "async function loadCharts"), context);
  vm.runInNewContext(extract("function getSongAverage", "function getYourAlbumRating"), context);

  await context.loadChartSongContext([{ item_id: 21 }]);

  assert.deepEqual(Array.from(context.allSongRatings, row => row.id), [5, 12]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.getSongAverage(21))),
    { avg: 9, count: 1 }
  );
});

test("Charts preserve shared ratings and preferred recording occurrences", () => {
  const canonicalId = "11111111-1111-4111-8111-111111111111";
  const context = {
    allAlbums: [
      { id: 1, title: "The Compilation", original_release_date: "2005-01-01", cover_art_url: "compilation.jpg" },
      { id: 2, title: "The Original Album", original_release_date: "1999-01-01", cover_art_url: "original.jpg" }
    ],
    allSongs: [
      { id: 11, album_id: 1, title: "The Track", artist: "The Artist", canonical_song_id: canonicalId },
      { id: 12, album_id: 2, title: "The Track", artist: "The Artist", canonical_song_id: canonicalId }
    ],
    dedupeChartRows: rows => rows,
    getSongRatingIdentity: song => `canonical:${song.canonical_song_id}`,
    getPreferredSongOccurrence: songs => songs.find(song => song.id === 12),
    getSongAverage: () => ({ avg: 9, count: 2 }),
    getAlbumArtworkUrl: album => album.cover_art_url || ""
  };
  vm.runInNewContext(extract("function buildStageOneChartsModel", "function renderAlbumCharts"), context);

  const model = context.buildStageOneChartsModel([], [{
    item_id: 11, title: "The Track", artist: "The Artist", album_id: 1,
    average_rating: 6, rating_count: 1
  }]);

  assert.equal(model.tracks[0].id, 12);
  assert.equal(model.tracks[0].albumTitle, "The Original Album");
  assert.equal(model.tracks[0].averageRating, 9);
  assert.equal(model.tracks[0].ratingCount, 2);
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
