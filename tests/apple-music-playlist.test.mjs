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

test("Soundiiz imports split at 200 tracks without dropping or duplicating songs", () => {
  const tracks = Array.from({ length: 401 }, (_, index) => ({
    title: `Song ${index + 1}`,
    artist: `Artist ${index + 1}`,
    album: `Album ${index + 1}`
  }));
  assert.deepEqual(apple.chunkTracks(tracks).map((chunk) => chunk.length), [200, 200, 1]);
  assert.deepEqual(apple.chunkTracks(tracks.slice(0, 200)).map((chunk) => chunk.length), [200]);

  const imports = apple.buildSoundiizImportRequests({
    playlistName: "BoM • Rated 7+",
    sourceLabel: "your 7+ ratings",
    tracks
  });
  assert.deepEqual(imports.map((item) => item.payload.title), [
    "BoM • Rated 7+ • Part 1 of 3",
    "BoM • Rated 7+ • Part 2 of 3",
    "BoM • Rated 7+ • Part 3 of 3"
  ]);
  assert.ok(imports.every((item) => item.payload.destination === "applemusicapp"));
  assert.deepEqual(imports[0].payload.tracklist[0], {
    title: "Song 1",
    artists: ["Artist 1"],
    album: "Album 1"
  });
  assert.equal(imports.flatMap((item) => item.payload.tracklist).length, 401);
  assert.match(imports[2].payload.description, /Part 3 of 3; Soundiiz accepts up to 200 tracks/);
});

test("Soundiiz uses the Amazon Music destination with the same 200-track splitting", () => {
  const tracks = Array.from({ length: 401 }, (_, index) => ({
    title: `Song ${index + 1}`,
    artist: `Artist ${index + 1}`
  }));
  const imports = apple.buildSoundiizImportRequests({
    playlistName: "BoM • Rated 9+",
    tracks,
    destination: apple.SOUNDIIZ_AMAZON_MUSIC_DESTINATION
  });
  assert.deepEqual(imports.map((item) => item.trackCount), [200, 200, 1]);
  assert.ok(imports.every((item) => item.payload.destination === "amazonmusic"));
  assert.equal(imports.flatMap((item) => item.payload.tracklist).length, 401);
  assert.throws(
    () => apple.buildSoundiizImportRequests({
      playlistName: "Unsafe destination",
      tracks: tracks.slice(0, 1),
      destination: "spotify"
    }),
    /Apple Music or Amazon Music/
  );
});

test("Soundiiz link creation posts each part and accepts only temporary Soundiiz URLs", async () => {
  const requests = [];
  const progress = [];
  const tracks = Array.from({ length: 201 }, (_, index) => ({
    title: `Song ${index + 1}`,
    artist: "Artist"
  }));
  const links = await apple.createSoundiizImportLinks({
    playlistName: "BoM • Rated 8+",
    tracks,
    sourceLabel: "your 8+ ratings",
    request: async (url, options) => {
      requests.push({ url, options, payload: JSON.parse(options.body) });
      const part = requests.length;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          nbTracks: part === 1 ? 200 : 1,
          shareUrl: `https://soundiiz.com/go/import-playlist/safe-token-${part}`,
          expiresAt: 1782220923 + part
        })
      };
    },
    onProgress: (value) => progress.push(value)
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "/api/soundiiz-import");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].payload.tracklist.length, 200);
  assert.equal(requests[1].payload.tracklist.length, 1);
  assert.deepEqual(links.map((link) => link.trackCount), [200, 1]);
  assert.deepEqual(progress.map(({ completed, total }) => [completed, total]), [[1, 2], [2, 2]]);
  assert.equal(apple.isSafeSoundiizShareUrl("https://soundiiz.com/go/import-playlist/token"), true);
  assert.equal(apple.isSafeSoundiizShareUrl("https://evil.example/go/import-playlist/token"), false);
  assert.equal(apple.isSafeSoundiizShareUrl("javascript:alert(1)"), false);
});

test("Soundiiz failures preserve already-created parts for a useful retry message", async () => {
  let requestCount = 0;
  await assert.rejects(
    apple.createSoundiizImportLinks({
      playlistName: "Large list",
      tracks: Array.from({ length: 201 }, (_, index) => ({ title: `Song ${index}`, artist: "Artist" })),
      request: async () => {
        requestCount += 1;
        if (requestCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              shareUrl: "https://soundiiz.com/go/import-playlist/first-part",
              nbTracks: 200,
              expiresAt: 1782220923
            })
          };
        }
        return {
          ok: false,
          status: 429,
          json: async () => ({ message: "Please wait before creating another link." })
        };
      }
    }),
    (error) => {
      assert.match(error.message, /Please wait/);
      assert.equal(error.soundiizLinks.length, 1);
      assert.equal(error.soundiizTotalParts, 2);
      return true;
    }
  );
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
  assert.match(applePanel, /complete the transfer on Soundiiz/i);
  assert.match(applePanel, /200-track maximum/i);
  assert.match(applePanel, /does not\s+directly create or edit your Apple Music library through MusicKit/i);
  assert.match(app, /Copy all track links/);
  assert.match(app, /Transfer with Soundiiz/);
  assert.match(app, /valid for 24 hours/i);
  assert.match(app, /separate \$\{escapeHtml\(serviceName\)\} playlist unless you combine them afterwards/i);
  assert.match(app, /getCurrentUserRatedTracksForSpotify\(minimumRating\)/);
  assert.match(app, /getGlobalTop100TracksForSpotify\(\)/);
  assert.match(app, /navigator\.share/);
  assert.doesNotMatch(app, /api\.music\.apple\.com\/v1\/me\/library\/playlists/);
  assert.match(styles, /\.apple-settings-panel/);
  assert.match(build, /bom-apple-music-playlist\.js/);
  assert.match(html, /<script src="bom-apple-music-playlist\.js\?v=3"><\/script>/);
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
  assert.match(html, /data-listening-service="amazon"/);
  assert.match(html, /data-listening-service="all"/);
  assert.match(app, /syncListeningServiceControls\(getPreferredListeningService\(\)\)/);
  assert.match(app, /bom_preferred_listening_service/);
});
