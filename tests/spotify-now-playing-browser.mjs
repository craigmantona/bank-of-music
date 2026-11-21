// Browser-level regression for album-Embed preservation and confirmed playback state.
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
    <div aria-hidden="true" style="height:700px"></div>
    <section class="bom-v1-album-section bom-v1-tracks-section">
      <header class="bom-v1-album-section-header"><h2>Tracks</h2></header>
      <div class="bom-v1-track-table">
        <div class="track-row-table bom-v1-track-row"
          data-track-title="Let England Shake" data-track-artist="PJ Harvey"
          data-track-position="1" data-disc-number="1" data-disc-track-number="1"
          data-track-duration-ms="189000"
          data-spotify-track-id="6DST3HT8zF8WpNmg9tHuaa">
          <span class="track-col-number">1</span>
          <span class="track-col-title">Let England Shake
            <span class="spotify-now-playing-status" data-spotify-now-playing-status
              role="status" aria-live="polite" aria-hidden="true">
              <span data-spotify-playback-label>Now Playing</span>
              <span class="spotify-now-playing-equaliser"><span></span><span></span><span></span></span>
            </span>
          </span>
          <span class="bom-v1-track-time">3:09</span><span class="track-col-average">—</span>
          <span class="track-col-your-rating">—</span>
          <span class="track-col-actions"><a class="spotify-open-externally-btn track-spotify-link"
            data-spotify-track-action="external" data-spotify-link-kind="exact"
            href="https://open.spotify.com/track/6DST3HT8zF8WpNmg9tHuaa"
            target="_blank" rel="noopener noreferrer">Open track in Spotify</a></span>
        </div>
        <div class="track-row-table bom-v1-track-row"
          data-track-title="The Last Living Rose" data-track-artist="PJ Harvey"
          data-track-position="2" data-disc-number="1" data-disc-track-number="2"
          data-track-duration-ms="141000" data-spotify-track-id="">
          <span class="track-col-number">2</span>
          <span class="track-col-title">The Last Living Rose
            <span class="spotify-now-playing-status" data-spotify-now-playing-status
              role="status" aria-live="polite" aria-hidden="true">
              <span data-spotify-playback-label>Now Playing</span>
              <span class="spotify-now-playing-equaliser"><span></span><span></span><span></span></span>
            </span>
          </span>
          <span class="bom-v1-track-time">2:21</span><span class="track-col-average">—</span>
          <span class="track-col-your-rating">—</span>
          <span class="track-col-actions"><a class="spotify-open-externally-btn track-spotify-link"
            data-spotify-track-action="external" data-spotify-link-kind="search"
            href="https://open.spotify.com/search/The%20Last%20Living%20Rose%20PJ%20Harvey"
            target="_blank" rel="noopener noreferrer">Search track in Spotify</a></span>
        </div>
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
            options,listeners,loadEntityCalls:[],autoplayCalls:[],destroyed:false,
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
        async function getValidSpotifyAccessToken() { return null; }
        async function spotifyApiRequest() { return {items: [], next: null}; }
        var selectedItemDetail = document.querySelector(".bom-v1-album");
        window.__scrollIntoViewCalls = [];
        window.__trackActions = [];
        const nativeScrollIntoView = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function(options) {
          window.__scrollIntoViewCalls.push({
            id: this.id || "", behavior: options?.behavior || "", block: options?.block || ""
          });
          return nativeScrollIntoView.call(this, options);
        };
        document.addEventListener("click", event => {
          const action = event.target.closest("[data-spotify-track-action='external']");
          if (!action) return;
          window.__trackActions.push({href: action.href, kind: action.dataset.spotifyLinkKind});
          event.preventDefault();
          event.stopPropagation();
        }, true);
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
    const firstTrackUri = "spotify:track:6DST3HT8zF8WpNmg9tHuaa";
    const secondTrackUri = "spotify:track:2K7qvmfEWQm41wIJkjDBj4";
    const highlighted = page.locator(".track-row-table.is-spotify-now-playing");

    assert.deepEqual(await page.evaluate(() => ({
      count: window.__spotifyControllerCreateCount,
      uri: window.__spotifyController.options.uri,
      height: window.__spotifyController.options.height
    })), {
      count: 1,
      uri: "spotify:album:2JfiVMvVhdueC48EmskS7t",
      height: 352
    });

    await emit("playback_started", { playingURI: secondTrackUri });
    assert.equal(await highlighted.getAttribute("data-track-position"), "2");

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const beforeActions = await page.evaluate(() => ({
      scrollY,
      scrollCalls: window.__scrollIntoViewCalls.length
    }));
    const firstAction = page.locator('[data-track-position="1"] [data-spotify-track-action="external"]');
    const secondAction = page.locator('[data-track-position="2"] [data-spotify-track-action="external"]');
    await firstAction.click();
    await secondAction.click();
    await firstAction.click();

    assert.deepEqual(await page.evaluate(() => window.__trackActions), [
      {href: "https://open.spotify.com/track/6DST3HT8zF8WpNmg9tHuaa", kind: "exact"},
      {href: "https://open.spotify.com/search/The%20Last%20Living%20Rose%20PJ%20Harvey", kind: "search"},
      {href: "https://open.spotify.com/track/6DST3HT8zF8WpNmg9tHuaa", kind: "exact"}
    ]);
    assert.equal(await highlighted.getAttribute("data-track-position"), "2");
    assert.deepEqual(await page.evaluate(() => ({
      count: window.__spotifyControllerCreateCount,
      uri: window.__spotifyController.options.uri,
      height: window.__spotifyController.options.height,
      loads: window.__spotifyController.loadEntityCalls,
      autoplay: window.__spotifyController.autoplayCalls,
      destroyed: window.__spotifyController.destroyed,
      scrollCalls: window.__scrollIntoViewCalls.length
    })), {
      count: 1,
      uri: "spotify:album:2JfiVMvVhdueC48EmskS7t",
      height: 352,
      loads: [],
      autoplay: [],
      destroyed: false,
      scrollCalls: beforeActions.scrollCalls
    });
    assert.equal(
      await page.locator("#topListeningPanel iframe[data-spotify-mock-frame]").count(),
      1
    );
    assert.equal(await page.locator("#albumTrackPreviewDock").count(), 0);
    assert.equal(await page.evaluate(() => scrollY), beforeActions.scrollY);

    await emit("playback_started", { playingURI: firstTrackUri });
    assert.equal(await highlighted.getAttribute("data-track-position"), "1");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);

    const mode = mobile ? "mobile" : "desktop";
    await page.screenshot({
      path: `${tmpdir()}/bom-spotify-album-preserved-${mode}.png`,
      fullPage: true
    });

    await page.evaluate(() => {
      window.__oldSpotifyController = window.__spotifyController;
      spotifyAlbumRenderRequestGeneration += 1;
      disposeSpotifyAlbumPlayer();
      document.querySelector("main").innerHTML = `
        <section id="replacementAlbum"><h2>Replacement album</h2></section>
      `;
      selectedItemDetail = document.querySelector("main");
    });
    assert.equal(await page.evaluate(() => window.__oldSpotifyController.destroyed), true);
    assert.equal(await page.locator("#replacementAlbum").getByText("Replacement album").count(), 1);
    assert.equal(await page.locator("iframe, [data-spotify-iframe-api-mount]").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${browserName} ${mode}: album Embed preserved, external actions inert, playback event confirmed`
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
