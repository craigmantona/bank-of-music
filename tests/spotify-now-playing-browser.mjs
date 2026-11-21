// Browser-level regression for the real Spotify album-context event shape.
// BOM_PLAYWRIGHT can point to an existing Playwright installation.
// BOM_BROWSER can select chromium (default) or webkit.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import http from "node:http";

const require = createRequire(import.meta.url);
const playwright = require(process.env.BOM_PLAYWRIGHT || "playwright");
const browserName = process.env.BOM_BROWSER || "chromium";
const browserType = playwright[browserName];
assert.ok(browserType, `Unsupported Playwright browser: ${browserName}`);
const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const app = await readFile(`${root}/app.js`, "utf8");
const playerStart = app.indexOf("const SPOTIFY_IFRAME_API_SRC");
const playerEnd = app.indexOf("async function openWithMusicProvider", playerStart);
assert.ok(playerStart >= 0 && playerEnd > playerStart);
const playerSource = app.slice(playerStart, playerEnd);
const trackHandlerStart = app.indexOf("function getAlbumTrackPlayerDestination");
const trackHandlerEnd = app.indexOf(
  "/*\n  Handle track previews in the capture phase",
  trackHandlerStart
);
assert.ok(trackHandlerStart >= 0 && trackHandlerEnd > trackHandlerStart);
const trackHandlerSource = app.slice(trackHandlerStart, trackHandlerEnd);
const providerStart = app.indexOf("async function openWithMusicProvider");
const providerEnd = app.indexOf("async function renderSelectedItem", providerStart);
assert.ok(providerStart >= 0 && providerEnd > providerStart);
const providerSource = app.slice(providerStart, providerEnd);

const fixture = `<!doctype html>
<html><head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/bom-foundation.css">
</head><body class="bom-shell-v1">
  <main class="bom-v1-album">
    <section id="topListeningPanel" class="music-provider-panel"
      data-music-provider-panel="true" data-provider-type="album">
      <h2>Listen to this album</h2>
      <div id="spotifyEmbedTarget" class="spotify-embed-container"></div>
    </section>
    <section class="bom-v1-tracks-section">
      <div class="track-row-table bom-v1-track-row"
        data-track-title="Let England Shake" data-track-artist="PJ Harvey"
        data-track-position="1" data-disc-number="1" data-disc-track-number="1"
        data-track-duration-ms="189000"
        data-spotify-track-id="6DST3HT8zF8WpNmg9tHuaa">
        <span class="track-col-number">1</span>
        <span class="track-col-title">Let England Shake</span>
        <span class="spotify-now-playing-status" data-spotify-now-playing-status
          role="status" aria-live="polite" aria-hidden="true">
          <span data-spotify-playback-label>Now Playing</span>
          <span class="spotify-now-playing-equaliser"><span></span><span></span><span></span></span>
        </span>
        <button type="button" data-track-preview="true"
          data-provider-title="Let England Shake" data-provider-artist="PJ Harvey"
          data-provider-album="Let England Shake" aria-pressed="false">Play</button>
      </div>
      <div class="track-row-table bom-v1-track-row"
        data-track-title="The Last Living Rose" data-track-artist="PJ Harvey"
        data-track-position="2" data-disc-number="1" data-disc-track-number="2"
        data-track-duration-ms="141000"
        data-spotify-track-id="2K7qvmfEWQm41wIJkjDBj4">
        <span class="track-col-number">2</span>
        <span class="track-col-title">The Last Living Rose</span>
        <span class="spotify-now-playing-status" data-spotify-now-playing-status
          role="status" aria-live="polite" aria-hidden="true">
          <span data-spotify-playback-label>Now Playing</span>
          <span class="spotify-now-playing-equaliser"><span></span><span></span><span></span></span>
        </span>
        <button type="button" data-track-preview="true"
          data-provider-title="The Last Living Rose" data-provider-artist="PJ Harvey"
          data-provider-album="Let England Shake" aria-pressed="false">Play</button>
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

const browser = await browserType.launch({
  headless: true,
  ...(browserName === "chromium" && process.env.BOM_CHROMIUM_EXECUTABLE
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
          const frame=document.createElement("iframe");
          frame.dataset.spotifyMockFrame="true";
          frame.title="Mock Spotify player";
          mount.appendChild(frame);
          window.__spotifyControllerCreateCount=(window.__spotifyControllerCreateCount||0)+1;
          window.__spotifyController={
            options,
            listeners,
            loadEntityCalls:[],
            autoplayCalls:[],
            loadEntity(uri){this.loadEntityCalls.push(uri)},
            play(){this.autoplayCalls.push("play")},
            resume(){this.autoplayCalls.push("resume")},
            togglePlay(){this.autoplayCalls.push("togglePlay")},
            addListener(name,listener){listeners.set(name,listener)},
            removeListener(name){listeners.delete(name)},
            destroy(){this.destroyed=true}
          };
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
        function getSpotifySearchFallbackUrl() { return "https://open.spotify.com/search"; }
        function getCachedSpotifyMatch() { return null; }
        function getVerifiedSpotifyAlbumMatch() { return null; }
        function getCachedSpotifyAlbumMatch() { return null; }
        async function getValidSpotifyAccessToken() { return null; }
        async function searchSpotifyTrackForBoMTrack() { return null; }
        async function searchSpotifyAlbumForBoMAlbum() { return null; }
        async function spotifyApiRequest() { return {items: [], next: null}; }
        async function recordMusicProviderClick() {
          if (window.__providerClickGate) await window.__providerClickGate;
        }
        function buildSpotifyEmbedUrl({type, spotifyItem}) {
          return "https://open.spotify.com/embed/" + type + "/" + spotifyItem.id;
        }
        var selectedItemDetail = document.querySelector(".bom-v1-album");
        var lastMusicProviderInteractionAt = 0;
        window.__scrollIntoViewCalls = [];
        Element.prototype.scrollIntoView = function(options) {
          window.__scrollIntoViewCalls.push({
            id: this.id || "",
            behavior: options?.behavior || "",
            block: options?.block || ""
          });
        };
        ${playerSource}
        ${providerSource}
        ${trackHandlerSource}
        window.spotifyNowPlayingBrowserTest = {
          createSpotifyAlbumController,
          handleAlbumTrackPreviewButton
        };
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
    const firstTrackUri = "spotify:track:6DST3HT8zF8WpNmg9tHuaa";
    const secondTrackUri = "spotify:track:2K7qvmfEWQm41wIJkjDBj4";
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

    const selectTrack = position => page.evaluate(async trackPosition => {
      const button = document.querySelector(
        `[data-track-position="${trackPosition}"] [data-track-preview="true"]`
      );
      await window.spotifyNowPlayingBrowserTest.handleAlbumTrackPreviewButton(button);
    }, position);

    await selectTrack("2");
    assert.equal(
      await page.evaluate(() => window.__spotifyControllerCreateCount),
      1,
      "the existing top controller must be reused"
    );
    assert.deepEqual(
      await page.evaluate(() => window.__spotifyController.loadEntityCalls),
      [secondTrackUri]
    );
    assert.deepEqual(
      await page.evaluate(() => window.__spotifyController.autoplayCalls),
      [],
      "selecting a track must not call play, resume or togglePlay"
    );
    assert.equal(
      await page.locator("#topListeningPanel [data-spotify-iframe-api-mount]").count(),
      1
    );
    assert.equal(
      await page.locator("#topListeningPanel iframe[data-spotify-mock-frame]").count(),
      1
    );
    assert.equal(await page.locator("#albumTrackPreviewDock").count(), 0);
    assert.equal(await highlighted.count(), 0, "selection alone must not claim playback");
    assert.equal(
      await page.locator('[data-track-position="2"] [data-track-preview="true"]').getAttribute("aria-pressed"),
      "true"
    );
    assert.equal(
      await page.locator("#spotifyEmbedTarget").getAttribute("data-spotify-selected-uri"),
      secondTrackUri
    );
    assert.ok(
      await page.evaluate(() => window.__scrollIntoViewCalls.some(call =>
        call.id === "topListeningPanel" &&
        call.behavior === "smooth" &&
        call.block === "center"
      )),
      "track selection must smoothly reveal the top listening panel"
    );

    await emit("playback_started", { playingURI: albumUri });
    assert.equal(await highlighted.count(), 0, "album context alone must not confirm the selection");

    await emit("playback_update", {
      playingURI: albumUri,
      duration: 189327,
      position: 0,
      isPaused: false,
      isBuffering: false
    });
    assert.equal(await highlighted.count(), 0, "a stale prior-track update must not re-highlight it");

    await emit("playback_update", {
      playingURI: albumUri,
      duration: 141327,
      position: 0,
      isPaused: false,
      isBuffering: false
    });
    assert.equal(await highlighted.getAttribute("data-track-position"), "2");

    await selectTrack("2");
    assert.deepEqual(
      await page.evaluate(() => window.__spotifyController.loadEntityCalls),
      [secondTrackUri],
      "reselecting the same track must not reload or create another player"
    );
    assert.equal(await highlighted.getAttribute("data-track-position"), "2");

    await selectTrack("1");
    assert.deepEqual(
      await page.evaluate(() => window.__spotifyController.loadEntityCalls),
      [secondTrackUri, firstTrackUri]
    );
    assert.equal(await highlighted.count(), 0, "switching selection must await confirmed playback");

    await emit("playback_started", { playingURI: firstTrackUri });
    assert.equal(await highlighted.getAttribute("data-track-position"), "1");
    assert.equal(
      await page.locator('[data-track-position="2"].is-spotify-now-playing').count(),
      0
    );
    assert.equal(
      await page.locator("#topListeningPanel iframe[data-spotify-mock-frame]").count(),
      1
    );
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);

    const mode = mobile ? "mobile" : "desktop";
    await page.screenshot({
      path: `${tmpdir()}/bom-spotify-now-playing-${mode}.png`,
      fullPage: true
    });

    const scrollCountBeforeNavigation = await page.evaluate(
      () => window.__scrollIntoViewCalls.length
    );
    await page.evaluate(() => {
      window.__providerClickGate = new Promise(resolve => {
        window.__resolveProviderClick = resolve;
      });
      const button = document.querySelector(
        '[data-track-position="2"] [data-track-preview="true"]'
      );
      window.__pendingNavigationSelection =
        window.spotifyNowPlayingBrowserTest.handleAlbumTrackPreviewButton(button);
    });
    await page.waitForFunction(() =>
      document.querySelector("#spotifyEmbedTarget")?.getAttribute("aria-busy") === "true"
    );
    await page.evaluate(() => {
      window.__oldSpotifyController = window.__spotifyController;
      spotifyAlbumRenderRequestGeneration += 1;
      disposeSpotifyAlbumPlayer();
      document.querySelector("main").innerHTML = `
        <section id="replacementAlbum" class="music-provider-panel"
          data-music-provider-panel="true" data-provider-type="album">
          <h2>Replacement album</h2>
          <div id="replacementSpotifyTarget" class="spotify-embed-container"></div>
        </section>
      `;
      selectedItemDetail = document.querySelector("main");
      window.__resolveProviderClick();
    });
    await page.evaluate(() => window.__pendingNavigationSelection);
    assert.equal(
      await page.evaluate(() => window.__oldSpotifyController.destroyed),
      true,
      "album navigation must destroy the previous controller"
    );
    assert.equal(
      await page.locator("#replacementAlbum").getByText("Replacement album").count(),
      1,
      "a stale track lookup must not overwrite the replacement album"
    );
    assert.equal(
      await page.locator(
        "#replacementAlbum iframe, #replacementAlbum [data-spotify-iframe-api-mount]"
      ).count(),
      0
    );
    assert.equal(
      await page.evaluate(() => window.__scrollIntoViewCalls.length),
      scrollCountBeforeNavigation,
      "a stale selection must not scroll the detached album panel"
    );
    assert.deepEqual(errors, [], "album navigation must not emit browser errors");
    console.log(
      `PASS ${browserName} ${mode}: one top player, confirmed highlight and track reuse`
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
