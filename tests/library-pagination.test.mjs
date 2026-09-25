import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

function extract(start, end) {
  const from = app.indexOf(start);
  return app.slice(from, app.indexOf(end, from));
}

function makeRows(length, prefix) {
  return Array.from({ length }, (_, index) => ({
    id: index + 1,
    title: `${prefix} ${String(index).padStart(4, "0")}`,
    artist_name: `${prefix} ${String(index).padStart(4, "0")}`
  }));
}

function createLibraryContext(tableRows, fail = null) {
  const calls = [];
  const supabaseClient = {
    from(table) {
      const query = {
        select(columns) {
          calls.push([table, "select", columns]);
          return this;
        },
        order(column, options) {
          calls.push([table, "order", column, options]);
          return this;
        },
        async range(from, to) {
          calls.push([table, "range", from, to]);
          if (fail?.table === table && fail?.from === from) {
            return { data: null, error: new Error(fail.message) };
          }
          return { data: (tableRows[table] || []).slice(from, to + 1), error: null };
        }
      };
      return query;
    }
  };
  const context = vm.createContext({
    supabaseClient,
    console: { error() {} },
    allAlbums: [],
    allSongs: [],
    allAlbumRatings: [],
    allSongRatings: [],
    followedArtists: []
  });
  vm.runInContext(
    extract("async function fetchAllRows", "async function followArtistByName"),
    context
  );
  return { context, calls };
}

test("loadLibrary loads all 1,141 albums and preserves title ordering", async () => {
  const albums = makeRows(1141, "Album");
  const { context, calls } = createLibraryContext({
    albums,
    songs: [],
    ratings: [],
    song_ratings: [],
    followed_artists: []
  });

  await context.loadLibrary();

  assert.equal(context.allAlbums.length, 1141);
  assert.equal(context.allAlbums[0].title, "Album 0000");
  assert.equal(context.allAlbums.at(-1).title, "Album 1140");
  assert.deepEqual(calls.filter(call => call[0] === "albums" && call[1] === "range"), [
    ["albums", "range", 0, 999],
    ["albums", "range", 1000, 1999]
  ]);
  assert.deepEqual(
    calls.filter(call => call[0] === "albums" && call[1] === "order")
      .map(call => [call[2], call[3]?.ascending]),
    [["title", true], ["id", true], ["title", true], ["id", true]]
  );
});

test("pagination continues through full pages until a short final page", async () => {
  const { context, calls } = createLibraryContext({ albums: makeRows(2001, "Album") });

  const albums = await context.fetchAllRows("albums", "title");

  assert.equal(albums.length, 2001);
  assert.deepEqual(calls.filter(call => call[1] === "range").map(call => call.slice(2)), [
    [0, 999],
    [1000, 1999],
    [2000, 2999]
  ]);
});

test("pagination propagates a later-page error instead of returning partial rows", async () => {
  const { context } = createLibraryContext(
    { albums: makeRows(1141, "Album") },
    { table: "albums", from: 1000, message: "page unavailable" }
  );

  await assert.rejects(context.fetchAllRows("albums", "title"), /page unavailable/);
});

test("loadLibrary paginates ratings, song ratings, and followed artists", async () => {
  const tableRows = {
    albums: [],
    songs: [],
    ratings: makeRows(1001, "Rating"),
    song_ratings: makeRows(1002, "Song rating"),
    followed_artists: makeRows(1003, "Artist")
  };
  const { context, calls } = createLibraryContext(tableRows);

  await context.loadLibrary();

  assert.equal(context.allAlbumRatings.length, 1001);
  assert.equal(context.allSongRatings.length, 1002);
  assert.equal(context.followedArtists.length, 1003);
  for (const table of ["ratings", "song_ratings", "followed_artists"]) {
    assert.deepEqual(calls.filter(call => call[0] === table && call[1] === "range").map(call => call.slice(2)), [
      [0, 999],
      [1000, 1999]
    ]);
  }
  assert.equal(calls.find(call => call[0] === "ratings" && call[1] === "select")?.[2], "user_id, album_id, rating");
  assert.equal(calls.find(call => call[0] === "song_ratings" && call[1] === "select")?.[2], "user_id, song_id, rating");
  assert.equal(calls.find(call => call[0] === "followed_artists" && call[1] === "select")?.[2], "artist_name");
});

test("search and Quick Rate retain their existing pagination implementations", () => {
  const loadLibrary = extract("async function loadLibrary", "async function followArtistByName");
  assert.match(loadLibrary, /fetchAllRows\("albums", "title"\)/);
  assert.match(app, /function getPredictiveCatalogue\(\)[\s\S]*?\.range\(offset, offset \+ 999\)/);
  assert.match(app, /async function fetchQuickRateRows[\s\S]*?\.range\(offset, offset \+ 999\)/);
});
