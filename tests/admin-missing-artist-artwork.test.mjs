import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [app, html] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8")
]);

function buildRows(identities, heroes, songs = [], albums = [], ukRows = []) {
  const source = app.slice(app.indexOf("function buildMissingArtistArtworkRows"), app.indexOf("async function loadMissingArtistArtwork"));
  const context = vm.createContext({
    normaliseText: value => String(value || "").trim(),
    normaliseCompare: value => String(value || "").trim().toLowerCase(),
    getAlbumArtworkUrl: album => album?.cover_art_url || "",
    Set, Map
  });
  vm.runInContext(`${source};globalThis.buildRows=buildMissingArtistArtworkRows`, context);
  return context.buildRows(identities, heroes, songs, albums, ukRows);
}

test("missing heroes appear, existing heroes do not, and UK impact orders first", () => {
  const rows = buildRows(
    [{ artist_name: "BOM Giant", musicbrainz_artist_id: "a" }, { artist_name: "Chart Star", musicbrainz_artist_id: "b" }, { artist_name: "Covered", musicbrainz_artist_id: "c" }],
    [{ artist_key: "covered", musicbrainz_artist_id: "c" }],
    [{ id: 1, artist: "BOM Giant" }, { id: 2, artist: "BOM Giant" }, { id: 3, artist: "Chart Star", album_id: 9 }],
    [{ id: 9, cover_art_url: "cover.jpg" }],
    [{ collection_key: "uk-number-ones", artist: "Chart Star", song_id: 3 }]
  );
  assert.deepEqual(rows.map(row => row.artist), ["Chart Star", "BOM Giant"]);
  assert.equal(rows[0].releaseArtwork, 1);
});

test("Admin view provides filters, name search and preselected existing uploader", () => {
  assert.match(html, /id="missingArtistArtworkBtn">Missing Artist Artwork/);
  assert.match(app, /missingArtistArtworkFilter === "all" \|\| row\.ukCount > 0/);
  assert.match(app, /normaliseCompare\(row\.artist\)\.includes\(query\)/);
  assert.match(app, /openArtistPage\(addMissingArtistImage\.dataset\.artist, addMissingArtistImage\.dataset\.mbid, true\)/);
  assert.match(app, /querySelector\("\[data-bom-artist-hero-pick\]"\)\?\.click\(\)/);
});

test("successful hero save refreshes the live list without external requests", () => {
  assert.match(app, /if \(missingArtistArtworkRows\) await loadMissingArtistArtwork\(\)/);
  const loader = app.slice(app.indexOf("async function loadMissingArtistArtwork"), app.indexOf("function renderMissingArtistArtwork"));
  assert.match(loader, /artist_catalog/);
  assert.match(loader, /artist_hero_overrides/);
  assert.match(loader, /quick_rate_collection_tracks/);
  assert.doesNotMatch(loader, /fetch\(|functions\.invoke|https?:\/\//i);
});
