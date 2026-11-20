// Browser-level regression for the real Spotify album-context event shape.
// BOM_PLAYWRIGHT can point to an existing Playwright installation.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import http from "node:http";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BOM_PLAYWRIGHT || "playwright");
const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const app = await readFile(`${root}/app.js`, "utf8");
const playerStart = app.indexOf("const SPOTIFY_IFRAME_API_SRC");
const playerEnd = app.indexOf("async function openWithMusicProvider", playerStart);
assert.ok(playerStart >= 0 && playerEnd > playerStart);
const playerSource = app.slice(playerStart, playerEnd);

const fixture = `<!doctype html>
<html><head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/bom-foundation.css">
</head><body class="bom-shell-v1">
  <main class="bom-v1-album">
    <div id="spotifyEmbedTarget"></div>
    <section class="bom-v1-tracks-section">
      <div class="track-row-table bom-v1-track-row"
        data-track-title="Let England Shake" data-track-artist="PJ Harvey"
        data-track-position="1" data-disc-number="1" data-disc-track-number="1"
        data-track-duration-ms="189000">
        <span class="track-col-number">1</span>
        <span class="track-col-title">Let England Shake</span>
        <span class="spotify-now-playing-status" data-spotify-now-playing-status
          role="status" aria-live="polite" aria-hidden="true">
          <span data-spotify-playback-label>Now Playing</span>
          <span class="spotify-now-playing-equaliser"><span></span><span></span><span></span></span>
        </span>
      </div>
      <div class="track-row-table bom-v1-track-row"
        data-track-title="The Last Living Rose" data-track-artist="PJ Harvey"
        data-track-position="2" data-disc-number="1" data-disc-track-number="2"
        data-track-duration-ms="141000">
        <span class="track-col-number">2</span>
        <span class="track-col-title">The Last Living Rose</span>
        <span class="spotify-now-playing-status" data-spotify-now-playing-status
          role="status" aria-live="polite" aria-hidden="true">
          <span data-spotify-playback-label>Now Playing</span>
          <span class="spotify-now-playing-equaliser"><span></span><span></span><span></span></span>
        </span>
      </div>
    </section>
  </main>
</body></html>`;

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(fixture);
    return;
  }
  if (pathname === "/style.css" || pathname === "/bom-foundation.css") {
    response.setHeader("Content-Type", "text/css");
    response.end(await readFile(`${root}${pathname}`));
    return;
  }
  response.writeHead(404);
  response.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOM_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.BOM_CHROMIUM_EXECUTABLE }
    : {})
});
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 800 },
      isMobile: mobile,
      hasTouch: mobile
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://open.spotify.com/embed/iframe-api/v1", route =>
      route.fulfill({
        contentType: "text/javascript",
        body: `window.onSpotifyIframeApiReady({createController(mount,options,ready){
          const listeners=new Map();
          window.__spotifyController={options,listeners,addListener(name,listener){listeners.set(name,listener)},removeListener(name){listeners.delete(name)},destroy(){}};
          ready(window.__spotifyController);
        }});`
      })
    );
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.addScriptTag({
      content: `
        function normaliseSpotifyMatchText(value) {
          return String(value || "").toLowerCase().normalize("NFD")
            .replace(/[\\u0300-\\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, " ").trim();
        }
        function getSpotifyEntityId(item) { return item?.id || ""; }
        function escapeHtml(value) { return String(value ?? ""); }
        async function getValidSpotifyAccessToken() { return null; }
        async function spotifyApiRequest() { return {items: [], next: null}; }
        var selectedItemDetail = document.querySelector(".bom-v1-album");
        ${playerSource}
        window.spotifyNowPlayingBrowserTest = { createSpotifyAlbumController };
      `
    });
    await page.evaluate(async () => {
      await window.spotifyNowPlayingBrowserTest.createSpotifyAlbumController({
        target: document.querySelector("#spotifyEmbedTarget"),
        title: "Let England Shake",
        artist: "PJ Harvey",
        externalUrl: "https://open.spotify.com/album/2JfiVMvVhdueC48EmskS7t",
        spotifyItem: {
          id: "2JfiVMvVhdueC48EmskS7t",
          tracks: [
            {id: "6DST3HT8zF8WpNmg9tHuaa", title: "Let England Shake", artist: "PJ Harvey", trackNumber: 1, durationMs: 189280},
            {id: "2K7qvmfEWQm41wIJkjDBj4", title: "The Last Living Rose", artist: "PJ Harvey", trackNumber: 2, durationMs: 141280}
          ]
        }
      });
    });

    const emit = (name, data) => page.evaluate(({ name, data }) => {
      window.__spotifyController.listeners.get(name)({ data });
    }, { name, data });
    const albumUri = "spotify:album:2JfiVMvVhdueC48EmskS7t";
    const highlighted = page.locator(".track-row-table.is-spotify-now-playing");

    await emit("playback_started", { playingURI: albumUri });
    assert.equal(await highlighted.count(), 0, "album URI alone must not guess a row");

    await emit("playback_update", {
      playingURI: albumUri,
      duration: 189327,
      position: 258,
      isPaused: false,
      isBuffering: false
    });
    assert.equal(await highlighted.getAttribute("data-track-position"), "1");
    assert.equal(await highlighted.getAttribute("data-spotify-playback-state"), "playing");

    await emit("playback_update", {
      playingURI: albumUri,
      duration: 189327,
      position: 1059,
      isPaused: true,
      isBuffering: false
    });
    assert.equal(await highlighted.getAttribute("data-spotify-playback-state"), "paused");
    assert.equal(
      await highlighted.locator("[data-spotify-playback-label]").textContent(),
      "Paused"
    );

    await emit("playback_update", {
      playingURI: albumUri,
      duration: 189327,
      position: 1059,
      isPaused: false,
      isBuffering: false
    });
    assert.equal(await highlighted.getAttribute("data-spotify-playback-state"), "playing");

    await emit("playback_update", {
      playingURI: albumUri,
      duration: 141327,
      position: 0,
      isPaused: false,
      isBuffering: false
    });
    assert.equal(await highlighted.getAttribute("data-track-position"), "2");
    assert.equal(await page.locator('[data-track-position="1"].is-spotify-now-playing').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);

    const mode = mobile ? "mobile" : "desktop";
    await page.screenshot({
      path: `${tmpdir()}/bom-spotify-now-playing-${mode}.png`,
      fullPage: true
    });
    console.log(`PASS ${mode}: album-context play, pause, resume and track change`);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
