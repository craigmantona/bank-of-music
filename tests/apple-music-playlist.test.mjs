import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

await import(`../bom-apple-music-playlist.js?test=${Date.now()}`);
const apple = globalThis.BOMAppleMusicPlaylist;

test("Apple Music playlist preparation builds safe usable search links and removes duplicates", () => {
  const prepared = apple.preparePlaylist({
    playlistName: "BoM • Rated 8+",
    storefront: "GB",
    tracks: [
      { title: "Rock & Roll", artist: "Artist/Guest", album: "Hits?" },
      { title: "rock & roll", artist: "Artist/Guest", album: "Duplicate" },
      { title: "Another Song", artist: "Another Artist", album: "Second" },
      { title: "Missing artist", artist: "" }
    ]
  });

  assert.equal(prepared.playlistName, "BoM • Rated 8+");
  assert.equal(prepared.tracks.length, 2);
  assert.equal(
    prepared.tracks[0].appleMusicUrl,
    "https://music.apple.com/gb/search?term=Rock%20%26%20Roll%20Artist%2FGuest%20Hits%3F"
  );
  assert.match(prepared.tracks[1].appleMusicUrl, /^https:\/\/music\.apple\.com\/gb\/search\?term=/);
  assert.equal(
    apple.buildAppleMusicSearchUrl({ title: "Song", artist: "Artist" }, "not-a-storefront"),
    "https://music.apple.com/gb/search?term=Song%20Artist"
  );
});

test("Apple Music playlist share text includes every prepared link without claiming creation", () => {
  const prepared = apple.preparePlaylist({
    playlistName: "BoM • Perfect 10s",
    tracks: [
      { title: "Song One", artist: "Artist One" },
      { title: "Song Two", artist: "Artist Two" }
    ]
  });
  const text = apple.buildShareText(prepared);
  assert.match(text, /^BoM • Perfect 10s\nApple Music links prepared by Bank of Music/);
  assert.match(text, /1\. Song One — Artist One\nhttps:\/\/music\.apple\.com\/gb\/search/);
  assert.match(text, /2\. Song Two — Artist Two\nhttps:\/\/music\.apple\.com\/gb\/search/);
  assert.doesNotMatch(text, /playlist (created|synchronised)/i);
});

test("Apple Music playlist sharing uses native share and falls back to copying", async () => {
  const prepared = apple.preparePlaylist({
    playlistName: "BoM • Rated 7+",
    tracks: [{ title: "Song", artist: "Artist" }]
  });
  let payload;
  let copied = "";
  assert.equal(await apple.sharePlaylist({
    ...prepared,
    share: async (value) => { payload = value; },
    copy: async (value) => { copied = value; }
  }), "shared");
  assert.equal(payload.title, prepared.playlistName);
  assert.equal(copied, "");

  assert.equal(await apple.sharePlaylist({
    ...prepared,
    share: async () => { throw new Error("share unavailable"); },
    copy: async (value) => { copied = value; }
  }), "copied");
  assert.match(copied, /Song — Artist/);
});

test("Apple Music settings mirror Spotify playlist choices and publish the link helper", async () => {
  const [app, html, styles, build] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../style.css", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build-cloudflare-pages.sh", import.meta.url), "utf8")
  ]);
  const applePanel = html.slice(
    html.indexOf('<div class="settings-panel apple-settings-panel">'),
    html.indexOf('</section>', html.indexOf('<div class="settings-panel apple-settings-panel">'))
  );

  for (const threshold of [7, 8, 9, 10]) {
    assert.match(applePanel, new RegExp(`data-minimum-rating="${threshold}"`));
  }
  assert.match(applePanel, /data-playlist-type="global-top-100"/);
  assert.match(applePanel, /does not automatically create or edit an Apple Music playlist/i);
  assert.match(applePanel, /MusicKit developer token/);
  assert.match(app, /Copy all track links/);
  assert.match(app, /getCurrentUserRatedTracksForSpotify\(minimumRating\)/);
  assert.match(app, /getGlobalTop100TracksForSpotify\(\)/);
  assert.match(app, /navigator\.share/);
  assert.doesNotMatch(app, /api\.music\.apple\.com\/v1\/me\/library\/playlists/);
  assert.match(styles, /\.apple-settings-panel/);
  assert.match(build, /bom-apple-music-playlist\.js/);
  assert.match(html, /<script src="bom-apple-music-playlist\.js\?v=1"><\/script>/);
});

test("settings reuse the existing Spotify, Apple and Both listening preference", async () => {
  const [app, html] = await Promise.all([
    readFile(new URL("../app.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8")
  ]);
  assert.match(html, /listening-preference-settings/);
  assert.match(html, /data-listening-service="spotify"/);
  assert.match(html, /data-listening-service="apple"/);
  assert.match(html, /data-listening-service="both"/);
  assert.match(app, /syncListeningServiceControls\(getPreferredListeningService\(\)\)/);
  assert.match(app, /bom_preferred_listening_service/);
});
