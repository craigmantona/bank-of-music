import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [app, albumPresentation] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-album.js", import.meta.url), "utf8")
]);

const handlerStart = app.indexOf("function getAlbumTrackPlayerDestination");
const handlerEnd = app.indexOf("/*\n  Handle track previews in the capture phase", handlerStart);
const handlerSource = app.slice(handlerStart, handlerEnd);

class FakeClassList {
  constructor(...values) { this.values = new Set(values); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
}

function createTrackButton({ title = "The Last Living Rose", row, albumRoot }) {
  const attributes = new Map([["aria-pressed", "false"]]);
  return {
    dataset: {
      providerTitle: title,
      providerArtist: "PJ Harvey",
      providerAlbum: "Let England Shake"
    },
    classList: new FakeClassList(),
    closest(selector) {
      if (selector === ".bom-v1-album, .detail-panel") return albumRoot;
      if (selector === ".track-row-table") return row;
      return null;
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; }
  };
}

function createHandlerHarness({ handled = true } = {}) {
  const calls = [];
  const row = { dataset: { spotifyTrackId: "2K7qvmfEWQm41wIJkjDBj4" } };
  const playerTarget = {};
  const scrollCalls = [];
  const providerPanel = {
    querySelector(selector) {
      return selector === ".spotify-embed-container" ? playerTarget : null;
    },
    scrollIntoView(options) { scrollCalls.push(options); }
  };
  const previousAttributes = new Map([["aria-pressed", "true"]]);
  const previous = {
    classList: new FakeClassList("is-active"),
    setAttribute(name, value) { previousAttributes.set(name, String(value)); },
    getAttribute(name) { return previousAttributes.get(name) ?? null; }
  };
  const albumRoot = {
    querySelector(selector) {
      return selector.includes("data-music-provider-panel") ? providerPanel : null;
    },
    querySelectorAll(selector) {
      return selector === "[data-track-preview='true'].is-active" ? [previous] : [];
    }
  };
  const button = createTrackButton({ row, albumRoot });
  const context = vm.createContext({
    Date,
    selectedItemDetail: null,
    lastMusicProviderInteractionAt: 0,
    openWithMusicProvider: async options => {
      calls.push(options);
      return handled;
    }
  });
  vm.runInContext(handlerSource, context);
  return {
    context,
    button,
    previous,
    playerTarget,
    providerPanel,
    row,
    calls,
    scrollCalls
  };
}

test("album track controls route into the existing top listening panel", async () => {
  const harness = createHandlerHarness();
  await harness.context.handleAlbumTrackPreviewButton(harness.button);

  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].type, "song");
  assert.equal(harness.calls[0].title, "The Last Living Rose");
  assert.equal(harness.calls[0].targetElement, harness.playerTarget);
  assert.equal(harness.calls[0].albumTrackSelectionRow, harness.row);
  assert.equal(harness.button.classList.contains("is-active"), true);
  assert.equal(harness.button.getAttribute("aria-pressed"), "true");
  assert.equal(harness.previous.classList.contains("is-active"), false);
  assert.equal(harness.previous.getAttribute("aria-pressed"), "false");
  assert.equal(harness.scrollCalls[0]?.behavior, "smooth");
  assert.equal(harness.scrollCalls[0]?.block, "center");
});

test("a superseded track selection never scrolls an obsolete album panel", async () => {
  const harness = createHandlerHarness({ handled: false });
  await harness.context.handleAlbumTrackPreviewButton(harness.button);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.scrollCalls.length, 0);
});

test("album markup has one top player destination and no track-list dock", () => {
  assert.doesNotMatch(app, /albumTrackPreviewDock/);
  assert.doesNotMatch(app, /getOrCreateReusableAlbumPreviewFrame/);
  assert.doesNotMatch(albumPresentation, /albumTrackPreviewDock/);
  assert.match(app, /data-music-provider-panel="true" data-provider-type="\$\{escapeHtml\(type\)\}"/);
  assert.match(albumPresentation, /aria-pressed="false"/);
  assert.match(albumPresentation, /data-spotify-now-playing-status/);
  assert.match(app, /title: immediatelySavedAlbum\.title[\s\S]*?buildTrackListHtml/);
  assert.match(app, /title: detail\?\.title \|\| albumSelection\.title[\s\S]*?trackListHtml/);
});

test("track selection switches entities without attempting autoplay", () => {
  const playerStart = app.indexOf("const SPOTIFY_IFRAME_API_SRC");
  const playerEnd = app.indexOf("async function openWithMusicProvider", playerStart);
  const playerSource = app.slice(playerStart, playerEnd);
  assert.match(playerSource, /controller\.loadEntity\(trackUri\)/);
  assert.doesNotMatch(playerSource, /controller\.(?:play|resume|togglePlay)\s*\(/);
  assert.match(playerSource, /pendingSelection/);
  assert.match(playerSource, /state\?\.isPaused !== false/);
});

test("album navigation invalidates pending selections and disposes the old player", () => {
  const renderStart = app.indexOf("async function renderSelectedItem");
  const renderSource = app.slice(renderStart, renderStart + 500);
  assert.match(renderSource, /spotifyAlbumRenderRequestGeneration \+= 1/);
  assert.match(renderSource, /disposeSpotifyAlbumPlayer\(\)/);
});
