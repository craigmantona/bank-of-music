import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [html, app, artist, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-artist.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);

test("Stage 2B loads only with the opt-in Stage 1 presentation", () => {
  assert.match(html, /get\("ui"\) === "stage1"/);
  assert.match(html, /bom-album\.js\?v=3/);
  assert.match(html, /bom-artist\.js\?v=3/);
  assert.match(app, /if \(isStageOnePresentation\(\)\)[\s\S]*renderStageOneArtist/);
});

test("Artist presentation is namespaced and contains no data access", () => {
  assert.match(artist, /bom-v1-artist/);
  assert.doesNotMatch(artist, /supabaseClient|musicbrainz|\.from\(|\.rpc\(|\bfetch\(/i);
  assert.doesNotMatch(artist, /fixture|prototype|mock/i);
  assert.match(artist, /renderLoading/);
  assert.match(artist, /Loading discography/);
});

test("Artist adapter reuses catalogue, ratings, artwork and follow functions", () => {
  for (const functionName of ["fetchMostCompleteArtistDiscography", "fetchArtistDetail", "fetchArtistImagePremium", "getAlbumAverage", "getYourAlbumRating", "getSongAverage", "getYourSongRating", "getAlbumArtworkUrl", "followArtistByName", "unfollowArtistByName"]) {
    assert.match(app, new RegExp(`${functionName}\\(`));
  }
  assert.match(app, /buildStageOneArtistModel/);
  assert.match(app, /window\.BOMArtistBridge/);
  assert.match(app, /2a96cbd8b46e442fc41c2b86b821562f/);
  assert.match(app, /imageUrl:[\s\S]*\? ""[\s\S]*: premiumArtistImage/);
  assert.doesNotMatch(app.match(/if \(isStageOnePresentation\(\)\)[\s\S]*?return;/)?.[0] || "", /displayAlbums\.find\(\(album\) => album\.coverUrl\)/);
});

test("Discography supports release, community and personal ordering", () => {
  assert.match(artist, />The records</);
  assert.match(artist, /A selection from the discography\./);
  assert.match(artist, /value="release">Release date/);
  assert.match(artist, /value="community">Highest community rated/);
  assert.match(artist, /value="personal">Highest personally rated/);
  assert.match(artist, /data-library-type="album"/);
  assert.match(artist, /data-artist-album-index/);
});

test("Top tracks use community track ratings with competition ranks and Top 10 or 50", () => {
  assert.match(app, /displayedScore = track\.community\.average\.toFixed\(1\)/);
  assert.match(app, /priorRank = index \+ 1/);
  assert.match(artist, /trackLimit = 10/);
  assert.match(artist, /trackLimit === 10 \? 50 : 10/);
  assert.match(artist, /View Top 50/);
  assert.match(artist, /community track rating/i);
});

test("responsive Artist layouts and missing artwork states are present", () => {
  assert.match(styles, /\.bom-v1-artist-discography/);
  assert.match(styles, /repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.match(styles, /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(artist, /Artist image unavailable/);
  assert.match(artist, /bom-v1-artist-eyebrow">The artist/);
  assert.match(artist, /Artwork unavailable/);
});

test("Artist hero rejects album, release, composite and unapproved image URLs", () => {
  const window = { location: { href: "http://localhost/" }, BOMUI: {} };
  const document = { addEventListener() {} };
  vm.runInNewContext(artist, { window, document, URL });
  const accepts = window.BOMArtistUI.isApprovedArtistImageUrl;

  assert.equal(accepts("https://coverartarchive.org/release-group/example/front-500"), false);
  assert.equal(accepts("https://thumb.wikimedia.org/wikipedia/commons/example/Radiohead_composite.jpg"), false);
  assert.equal(accepts("https://example.com/artist.jpg"), false);
  assert.equal(accepts("https://thumb.wikimedia.org/wikipedia/commons/example/artist-performing.jpg"), true);
  assert.equal(accepts("https://e-cdns-images.dzcdn.net/images/artist/example/1000x1000.jpg"), true);
});

test("artist deep links preserve Stage 1 rollback and Album navigation", () => {
  assert.match(app, /shareType === "artist"/);
  assert.match(app, /\["album", "song", "artist"\]\.includes/);
  assert.match(app, /data-library-type="album"/);
  assert.match(app, /data-artist-album-index/);
  assert.match(artist, /history\.pushState/);
});

test("catalogue and qualification infrastructure is absent from Stage 2B assets", () => {
  assert.doesNotMatch(artist + styles, /artist-catalog|qualification-v2|shadow snapshot|artist_import_queue|catalogue worker/i);
});
