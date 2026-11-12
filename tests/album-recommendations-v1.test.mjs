import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [app, album, styles] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-album.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);

const rankingStart = app.indexOf("function albumRecommendationTerms");
const rankingEnd = app.indexOf("async function fetchAlbumRecommendationCandidates", rankingStart);
const rankingSource = app.slice(rankingStart, rankingEnd);

function rank(current, candidates, rated = []) {
  const context = { normaliseCompare: value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "") };
  vm.runInNewContext(rankingSource, context);
  return context.rankSimilarAlbums(current, candidates, new Set(rated), 12);
}

test("similar albums exclude the current and every previously rated album", () => {
  const current = { id: 1, artist: "Artist A", release_date: "1995-01-01", genres: ["Rock"] };
  const candidates = [current, ...Array.from({ length: 14 }, (_, index) => ({
    id: index + 2, title: `Album ${index + 2}`, artist: index < 4 ? "Artist A" : `Artist ${index}`,
    release_date: `${1990 + index}-01-01`, genre: index % 2 ? "Rock" : "Pop"
  }))];
  const result = rank(current, candidates, [3, 7]);
  assert.equal(result.length, 12);
  assert.equal(result.some(item => [1, 3, 7].includes(item.id)), false);
});

test("ranking prioritises shared artist, genre and release era while varying artists", () => {
  const current = { id: 20, artist: "The Source", release_date: "2001", tags: "alternative rock" };
  const candidates = [
    { id: 21, artist: "The Source", release_date: "1980", genre: "jazz" },
    { id: 22, artist: "Another", release_date: "2003", genre: "alternative rock" },
    { id: 23, artist: "Third", release_date: "2002", genre: "alternative rock" },
    { id: 24, artist: "Distant", release_date: "1950", genre: "classical" }
  ];
  const result = rank(current, candidates);
  assert.deepEqual(Array.from(result.slice(0, 3), item => item.id).sort((a, b) => a - b), [21, 22, 23]);
  assert.equal(new Set(result.slice(0, 3).map(item => item.artist)).size, 3);
});

test("diversity backfill never exceeds the 12-album carousel limit", () => {
  const current = { id: 100, artist: "Source", release_date: "2000", genre: "rock" };
  const candidates = Array.from({ length: 30 }, (_, index) => ({
    id: index + 101,
    artist: index < 10 ? "Source" : `Artist ${index}`,
    release_date: `${1990 + index}`,
    genre: "rock"
  }));
  assert.equal(rank(current, candidates).length, 12);
});

test("album page lazy-hydrates a responsive, navigable carousel", () => {
  assert.match(album, /id="bomV1AlbumRecommendations"/);
  assert.match(album, /loading="lazy"/);
  assert.match(album, /data-library-type="album" data-album-id=/);
  assert.match(app, /IntersectionObserver/);
  assert.match(app, /rootMargin: "500px 0px"/);
  assert.match(app, /from\("ratings"\)\.select\("album_id,rating"\)\.eq\("user_id", currentUser\.id\)/);
  assert.match(app, /Number\(currentRating\) >= 7 \? "Because you liked this album" : "Discover something similar"/);
  assert.match(styles, /\.bom-v1-recommendation-carousel[^}]*overflow-x: auto/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.bom-v1-recommendation-carousel/);
});

test("dragging the recommendation scrollbar does not trigger album swipe navigation", async () => {
  const bindStart = app.indexOf("function bindSelectedAlbumSwipe");
  const bindEnd = app.indexOf("const originalShowOnlySectionV32", bindStart);
  const listeners = new Map();
  let navigations = 0;
  const selectedItemDetail = {
    dataset: {},
    addEventListener(type, listener) { listeners.set(type, listener); },
    classList: { add() {}, remove() {} }
  };
  const context = {
    selectedItemDetail,
    selectedItem: { type: "album" },
    lastMusicProviderInteractionAt: 0,
    swipeToAdjacentAlbum: async () => { navigations += 1; },
    setTimeout
  };
  vm.runInNewContext(app.slice(bindStart, bindEnd), context);
  context.bindSelectedAlbumSwipe();

  const carouselTarget = {
    closest(selector) {
      return selector.includes(".bom-v1-recommendation-carousel") ? this : null;
    }
  };
  listeners.get("pointerdown")({ target: carouselTarget, clientX: 300, clientY: 20 });
  await listeners.get("pointerup")({ target: carouselTarget, clientX: 100, clientY: 20 });

  assert.equal(navigations, 0);
  assert.match(app.slice(bindStart, bindEnd), /\.bom-v1-recommendation-carousel/);
});

test("recommendations use existing metadata without AI or schema changes", () => {
  const feature = app.slice(app.indexOf("const albumRecommendationLoads"), app.indexOf("function validStoredMusicBrainzReleaseId"));
  assert.match(feature, /album\?\.genre/);
  assert.match(feature, /original_release_date \|\| album\?\.release_date/);
  assert.doesNotMatch(feature, /openai|embedding|vector|\.rpc\(/i);
});
