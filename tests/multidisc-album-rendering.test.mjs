import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

function extract(startMarker, endMarker) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);
  return app.slice(start, end);
}

function renderTracks(media) {
  const context = {
    selectedItem: { title: "Album", artist: "Artist" },
    allSongs: [],
    normaliseCompare: value => String(value).toLowerCase(),
    escapeHtml: value => String(value),
    getSongAverage: () => null,
    getYourSongRating: () => null,
    buildCompactTrackRatingControl: () => ""
  };
  vm.createContext(context);
  vm.runInContext(extract("function buildStageOneAlbumTrackModels", "function buildStageOneAlbumModel"), context);
  return context.buildStageOneAlbumTrackModels({
    title: "Album", "artist-credit": [{ name: "Artist" }], media
  }, 91);
}

function medium(position, count) {
  return {
    position,
    tracks: Array.from({ length: count }, (_, index) => ({
      position: index + 1,
      title: `Disc ${position} Track ${index + 1}`,
      recording: { id: `${position}-${index + 1}` }
    }))
  };
}

test("17+13 media render one unique album-wide sequence while preserving medium positions", () => {
  const rows = renderTracks([medium(1, 17), medium(2, 13)]);
  assert.deepEqual(Array.from(rows, row => row.number), Array.from({ length: 30 }, (_, index) => index + 1));
  assert.equal(new Set(rows.map(row => row.number)).size, 30);
  assert.equal(rows[17].mediumPosition, 2);
  assert.equal(rows[17].mediumTrackPosition, 1);
});

test("single-disc rendering is unchanged", () => {
  assert.deepEqual(Array.from(renderTracks([medium(1, 3)]), row => row.number), [1, 2, 3]);
});

test("remote album tracks do not expose or bind the obsolete Save action", () => {
  const rows = renderTracks([medium(1, 2)]);
  assert.ok(rows.every(row => row.saveControlHtml === ""));
  assert.doesNotMatch(app, /class="save-track-btn"|function saveTrackFromAlbum/);
});
