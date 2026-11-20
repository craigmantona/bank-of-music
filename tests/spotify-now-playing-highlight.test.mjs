import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [app, albumPresentation, styles, foundationStyles] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-album.js", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);

const playerStart = app.indexOf("const SPOTIFY_IFRAME_API_SRC");
const playerEnd = app.indexOf("async function openWithMusicProvider", playerStart);
const playerSource = app.slice(playerStart, playerEnd);

function normaliseSpotifyMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  toggle(value, force) {
    if (force === true) this.values.add(value);
    else if (force === false) this.values.delete(value);
    else if (this.values.has(value)) this.values.delete(value);
    else this.values.add(value);
    return this.values.has(value);
  }
  contains(value) { return this.values.has(value); }
}

function makeRow({ title, artist = "PJ Harvey", spotifyTrackId = "", position = 1 }) {
  const attributes = new Map();
  const statusAttributes = new Map([["aria-hidden", "true"]]);
  const label = { textContent: "Now Playing" };
  const status = {
    setCalls: 0,
    setAttribute(name, value) {
      this.setCalls += 1;
      statusAttributes.set(name, String(value));
    },
    getAttribute(name) { return statusAttributes.get(name) ?? null; }
  };
  return {
    dataset: {
      trackTitle: title,
      trackArtist: artist,
      spotifyTrackId,
      trackPosition: String(position),
      discNumber: "1",
      discTrackNumber: String(position)
    },
    classList: new FakeClassList(),
    querySelector(selector) {
      if (selector === "[data-spotify-now-playing-status]") return status;
      if (selector === "[data-spotify-playback-label]") return label;
      return null;
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    status,
    label
  };
}

function makeRoot(rows) {
  return {
    querySelectorAll() { return rows; }
  };
}

function makeTarget(root) {
  const mount = {};
  return {
    classList: new FakeClassList(),
    innerHTML: "",
    isConnected: true,
    closest() { return root; },
    querySelector(selector) {
      return selector === "[data-spotify-iframe-api-mount]" ? mount : null;
    },
    scrollCalls: [],
    scrollIntoView(options) { this.scrollCalls.push(options); }
  };
}

function makePlayerHarness({
  rows,
  oEmbedTitle = "",
  firstScriptLoadFails = false,
  holdAlbumMetadata = false,
  albumMetadataPagePromise = null,
  oEmbedResponsePromise = null
}) {
  let scriptNode = null;
  let scriptAppendCount = 0;
  let fetchCount = 0;
  const controllers = [];
  const api = {
    createController(mount, options, callback) {
      const listeners = new Map();
      const removed = [];
      const controller = {
        mount,
        options,
        listeners,
        removed,
        destroyed: false,
        addListener(name, listener) { listeners.set(name, listener); },
        removeListener(name, listener) { removed.push([name, listener]); listeners.delete(name); },
        destroy() { this.destroyed = true; }
      };
      controllers.push(controller);
      callback(controller);
    }
  };
  const root = makeRoot(rows);
  const document = {
    head: {
      appendChild(node) {
        scriptNode = node;
        scriptAppendCount += 1;
        queueMicrotask(() => {
          if (firstScriptLoadFails && scriptAppendCount === 1) {
            node.listeners.get("error")?.();
            return;
          }
          context.window.onSpotifyIframeApiReady(api);
        });
      }
    },
    querySelector() { return scriptNode; },
    querySelectorAll() { return rows; },
    createElement() {
      const listeners = new Map();
      const node = {
        dataset: {},
        addEventListener(name, listener) { listeners.set(name, listener); },
        remove() {
          if (scriptNode === node) scriptNode = null;
        },
        listeners
      };
      return node;
    }
  };
  const context = vm.createContext({
    Map,
    Promise,
    URLSearchParams,
    console: { warn() {} },
    document,
    selectedItemDetail: root,
    normaliseSpotifyMatchText,
    getSpotifyEntityId: item => item?.id || "",
    getValidSpotifyAccessToken: holdAlbumMetadata
      ? () => new Promise(() => {})
      : async () => albumMetadataPagePromise ? "access-token" : null,
    spotifyApiRequest: async () => albumMetadataPagePromise
      ? albumMetadataPagePromise
      : ({ items: [], next: null }),
    escapeHtml: value => String(value ?? ""),
    fetch: async () => {
      fetchCount += 1;
      if (oEmbedResponsePromise) return oEmbedResponsePromise;
      return {
        ok: true,
        async json() { return { title: oEmbedTitle }; }
      };
    },
    window: {
      setTimeout,
      clearTimeout
    }
  });
  vm.runInContext(playerSource, context);
  return {
    context,
    root,
    controllers,
    getScriptAppendCount: () => scriptAppendCount,
    getFetchCount: () => fetchCount
  };
}

test("the Spotify iFrame API loader removes a failed script and retries cleanly", async () => {
  const { context, getScriptAppendCount } = makePlayerHarness({
    rows: [],
    firstScriptLoadFails: true
  });
  await assert.rejects(
    context.loadSpotifyIframeApi(),
    /failed to load/
  );
  assert.equal(getScriptAppendCount(), 1);

  const api = await context.loadSpotifyIframeApi();
  assert.equal(typeof api.createController, "function");
  assert.equal(getScriptAppendCount(), 2);
});

test("optional album metadata never blocks the playable controller", async () => {
  const { context, root, controllers } = makePlayerHarness({
    rows: [makeRow({ title: "Track", position: 1 })],
    holdAlbumMetadata: true
  });
  let timeout = null;
  const result = await Promise.race([
    context.createSpotifyAlbumController({
      target: makeTarget(root),
      title: "Album",
      artist: "Artist",
      externalUrl: "https://open.spotify.com/album/1234567890123456789012",
      spotifyItem: { id: "1234567890123456789012", tracks: [] }
    }),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("controller waited for optional metadata")),
        100
      );
    })
  ]).finally(() => clearTimeout(timeout));
  assert.equal(result, true);
  assert.equal(controllers.length, 1);
});

test("a superseded request cannot destroy the current album controller", async () => {
  const { context, root, controllers } = makePlayerHarness({ rows: [] });
  vm.runInContext("spotifyAlbumRenderRequestGeneration = 2", context);
  await context.createSpotifyAlbumController({
    target: makeTarget(root),
    title: "Current Album",
    artist: "Artist",
    externalUrl: "https://open.spotify.com/album/1234567890123456789012",
    spotifyItem: { id: "1234567890123456789012", tracks: [] },
    requestGeneration: 2
  });
  const currentController = controllers[0];

  await assert.rejects(
    context.createSpotifyAlbumController({
      target: makeTarget(root),
      title: "Stale Album",
      artist: "Artist",
      externalUrl: "https://open.spotify.com/album/ABCDEFGHIJ123456789012",
      spotifyItem: { id: "ABCDEFGHIJ123456789012", tracks: [] },
      requestGeneration: 1
    }),
    error => error?.code === "SPOTIFY_ALBUM_PLAYER_SUPERSEDED"
  );
  assert.equal(currentController.destroyed, false);
  assert.equal(controllers.length, 1);
});

test("late album metadata immediately resolves an already-playing row", async () => {
  let resolveMetadata;
  const albumMetadataPagePromise = new Promise(resolve => {
    resolveMetadata = resolve;
  });
  const row = makeRow({ title: "Late Match", position: 1 });
  const { context, root, controllers } = makePlayerHarness({
    rows: [row],
    albumMetadataPagePromise
  });
  await context.createSpotifyAlbumController({
    target: makeTarget(root),
    title: "Album",
    artist: "Artist",
    externalUrl: "https://open.spotify.com/album/1234567890123456789012",
    spotifyItem: { id: "1234567890123456789012", tracks: [] }
  });

  controllers[0].listeners.get("playback_started")({
    data: { playingURI: "spotify:track:1234567890123456789012" }
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(row.classList.contains("is-spotify-now-playing"), false);

  resolveMetadata({
    items: [{
      id: "1234567890123456789012",
      name: "Late Match",
      artists: [{ name: "Artist" }],
      track_number: 1,
      disc_number: 1
    }],
    next: null
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(row.classList.contains("is-spotify-now-playing"), true);
});

test("failed oEmbed matching is cached briefly across recurrent updates", async () => {
  const { context, root, controllers, getFetchCount } = makePlayerHarness({
    rows: [makeRow({ title: "Different title", position: 1 })],
    oEmbedTitle: ""
  });
  await context.createSpotifyAlbumController({
    target: makeTarget(root),
    title: "Album",
    artist: "Artist",
    externalUrl: "https://open.spotify.com/album/1234567890123456789012",
    spotifyItem: { id: "1234567890123456789012", tracks: [] }
  });
  const controller = controllers[0];
  const playingURI = "spotify:track:ABCDEFGHIJ123456789012";
  controller.listeners.get("playback_started")({ data: { playingURI } });
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let index = 0; index < 3; index += 1) {
    controller.listeners.get("playback_update")({
      data: { playingURI, isPaused: false, isBuffering: false }
    });
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(getFetchCount(), 1);
});

test("switching to an unresolved track clears the previous row immediately", async () => {
  let resolveOEmbed;
  const oEmbedResponsePromise = new Promise(resolve => {
    resolveOEmbed = resolve;
  });
  const mappedId = "1234567890123456789012";
  const unresolvedId = "ABCDEFGHIJ123456789012";
  const mapped = makeRow({ title: "Mapped", position: 1 });
  const { context, root, controllers } = makePlayerHarness({
    rows: [mapped],
    oEmbedResponsePromise
  });
  await context.createSpotifyAlbumController({
    target: makeTarget(root),
    title: "Album",
    artist: "Artist",
    externalUrl: "https://open.spotify.com/album/1234567890123456789012",
    spotifyItem: {
      id: "1234567890123456789012",
      tracks: [{ id: mappedId, title: "Mapped", artist: "Artist", trackNumber: 1, discNumber: 1 }]
    }
  });
  const started = controllers[0].listeners.get("playback_started");
  started({ data: { playingURI: `spotify:track:${mappedId}` } });
  assert.equal(mapped.classList.contains("is-spotify-now-playing"), true);

  started({ data: { playingURI: `spotify:track:${unresolvedId}` } });
  assert.equal(
    mapped.classList.contains("is-spotify-now-playing"),
    false,
    "the previous track must clear before fallback metadata resolves"
  );

  resolveOEmbed({ ok: true, async json() { return { title: "" }; } });
  await new Promise(resolve => setTimeout(resolve, 0));
});

test("exact album metadata may use a unique disc and track position for title variants", () => {
  const discOne = makeRow({ title: "Other song", position: 1 });
  discOne.dataset.discNumber = "1";
  discOne.dataset.discTrackNumber = "1";
  const discTwo = makeRow({ title: "Song", position: 8 });
  discTwo.dataset.discNumber = "2";
  discTwo.dataset.discTrackNumber = "1";
  const mapped = contextForPositionFallback().buildSpotifyAlbumTrackRowMap([
    {
      id: "ABCDEFGHIJ123456789012",
      name: "Song - 2011 Remaster",
      artists: [{ name: "Artist" }],
      disc_number: 2,
      track_number: 1
    }
  ], makeRoot([discOne, discTwo]));
  assert.equal(mapped.rowByTrackId.get("ABCDEFGHIJ123456789012"), discTwo);
});

function contextForPositionFallback() {
  return makePlayerHarness({ rows: [] }).context;
}

test("the verified Let England Shake release retains all twelve exact track IDs", () => {
  const verifiedStart = app.indexOf("const VERIFIED_SPOTIFY_ALBUM_LINKS");
  const verifiedEnd = app.indexOf(
    "function getSpotifyAlbumMatchCacheKey",
    verifiedStart
  );
  const context = vm.createContext({ normaliseSpotifyMatchText });
  vm.runInContext(app.slice(verifiedStart, verifiedEnd), context);
  const match = context.getVerifiedSpotifyAlbumMatch({
    title: "Let England Shake",
    artist: "PJ Harvey"
  });
  assert.deepEqual(
    Array.from(match.tracks, track => track.id),
    [
      "6DST3HT8zF8WpNmg9tHuaa",
      "2K7qvmfEWQm41wIJkjDBj4",
      "5eAcmyKEmOkdIEBopUqM4J",
      "64EePXuDYpMZMvaTT7k8vi",
      "7Bw5XYKi9fBoFbXFoE8PVN",
      "1u0lFRxxwIqigbkFCRprpV",
      "24AljyKuKotlF2cypaBler",
      "0fAoPbcLqVYS11D3Eds7J7",
      "7wRQFEIEpRsO3ULL0XGezV",
      "1BgtlF5x3xm5jXA3qwMzX8",
      "3DG8F4L82QAQzpcdCQonab",
      "2DIwxNx5knXRodNGruJdtM"
    ]
  );
});

test("the album controller follows exact Spotify playback events and pause state", async () => {
  const first = makeRow({ title: "Let England Shake", position: 1 });
  const second = makeRow({
    title: "Hanging In The Wire",
    spotifyTrackId: "1BgtlF5x3xm5jXA3qwMzX8",
    position: 10
  });
  const { context, root, controllers } = makePlayerHarness({ rows: [first, second] });
  const target = makeTarget(root);
  await context.createSpotifyAlbumController({
    target,
    title: "Let England Shake",
    artist: "PJ Harvey",
    externalUrl: "https://open.spotify.com/album/2JfiVMvVhdueC48EmskS7t",
    spotifyItem: {
      id: "2JfiVMvVhdueC48EmskS7t",
      tracks: [
        { id: "6DST3HT8zF8WpNmg9tHuaa", title: "Let England Shake", artist: "PJ Harvey", trackNumber: 1 },
        { id: "1BgtlF5x3xm5jXA3qwMzX8", title: "Hanging In The Wire", artist: "PJ Harvey", trackNumber: 10 }
      ]
    }
  });

  const controller = controllers[0];
  assert.equal(controller.options.uri, "spotify:album:2JfiVMvVhdueC48EmskS7t");
  assert.equal(controller.options.width, "100%");
  assert.equal(controller.options.height, 352);
  assert.ok(controller.listeners.has("playback_started"));
  assert.ok(controller.listeners.has("playback_update"));
  assert.equal(target.scrollCalls.length, 1);
  assert.equal(target.scrollCalls[0].behavior, "smooth");
  assert.equal(target.scrollCalls[0].block, "nearest");

  controller.listeners.get("playback_update")({
    data: { playingURI: "spotify:track:6DST3HT8zF8WpNmg9tHuaa", isPaused: true, isBuffering: false }
  });
  assert.equal(first.classList.contains("is-spotify-now-playing"), false, "an initial paused update must not create a false Now Playing row");

  controller.listeners.get("playback_started")({
    data: { playingURI: "spotify:track:6DST3HT8zF8WpNmg9tHuaa" }
  });
  assert.equal(first.classList.contains("is-spotify-now-playing"), true);
  assert.equal(first.dataset.spotifyPlaybackState, "playing");
  assert.equal(first.label.textContent, "Now Playing");
  assert.equal(first.status.getAttribute("aria-hidden"), "false");
  const stableStatusSetCalls = first.status.setCalls;

  controller.listeners.get("playback_update")({
    data: { playingURI: "spotify:track:6DST3HT8zF8WpNmg9tHuaa", isPaused: false, isBuffering: false }
  });
  assert.equal(
    first.status.setCalls,
    stableStatusSetCalls,
    "unchanged playback updates must not toggle the live status"
  );

  controller.listeners.get("playback_started")({
    data: { playingURI: "spotify:track:1BgtlF5x3xm5jXA3qwMzX8" }
  });
  assert.equal(first.classList.contains("is-spotify-now-playing"), false);
  assert.equal(second.classList.contains("is-spotify-now-playing"), true);

  controller.listeners.get("playback_update")({
    data: { playingURI: "spotify:track:1BgtlF5x3xm5jXA3qwMzX8", isPaused: true, isBuffering: false }
  });
  assert.equal(second.classList.contains("is-spotify-playback-paused"), true);
  assert.equal(second.dataset.spotifyPlaybackState, "paused");
  assert.equal(second.label.textContent, "Paused");

  controller.listeners.get("playback_update")({
    data: { playingURI: "spotify:album:2JfiVMvVhdueC48EmskS7t", isPaused: true, isBuffering: false }
  });
  assert.equal(second.classList.contains("is-spotify-now-playing"), false);

  context.disposeSpotifyAlbumPlayer();
  assert.equal(controller.destroyed, true);
  assert.deepEqual(controller.removed.map(([name]) => name), ["playback_started", "playback_update"]);
});

test("an unmapped event uses Spotify oEmbed title only when the album row is unique", async () => {
  const trackId = "0fAoPbcLqVYS11D3Eds7J7";
  const unique = makeRow({ title: "In The Dark Places", position: 8 });
  const { context, root, controllers } = makePlayerHarness({
    rows: [unique],
    oEmbedTitle: "In The Dark Places"
  });
  await context.createSpotifyAlbumController({
    target: makeTarget(root),
    title: "Album",
    artist: "Artist",
    externalUrl: "https://open.spotify.com/album/1234567890123456789012",
    spotifyItem: { id: "1234567890123456789012", tracks: [] }
  });
  controllers[0].listeners.get("playback_started")({ data: { playingURI: `spotify:track:${trackId}` } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(unique.classList.contains("is-spotify-now-playing"), true);
});

test("ambiguous oEmbed titles clear the indicator instead of guessing", async () => {
  const trackId = "24AljyKuKotlF2cypaBler";
  const rows = [
    makeRow({ title: "England", position: 1 }),
    makeRow({ title: "England", position: 2 })
  ];
  const { context, root, controllers } = makePlayerHarness({ rows, oEmbedTitle: "England" });
  await context.createSpotifyAlbumController({
    target: makeTarget(root),
    title: "Album",
    artist: "Artist",
    externalUrl: "https://open.spotify.com/album/1234567890123456789012",
    spotifyItem: { id: "1234567890123456789012", tracks: [] }
  });
  controllers[0].listeners.get("playback_started")({ data: { playingURI: `spotify:track:${trackId}` } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(rows.some(row => row.classList.contains("is-spotify-now-playing")), false);
});

test("track rows expose stable identities and accessible playback status without disturbing controls", () => {
  assert.match(app, /spotifyTrackId: savedSong\?\.spotify_track_id \|\| ""/);
  assert.match(albumPresentation, /data-spotify-track-id="\$\{escapeHtml\(track\.spotifyTrackId \|\| ""\)\}"/);
  assert.match(albumPresentation, /data-track-title=/);
  assert.match(albumPresentation, /data-track-artist=/);
  assert.match(albumPresentation, /data-spotify-now-playing-status role="status" aria-live="polite" aria-atomic="true" aria-hidden="true"/);
  assert.match(albumPresentation, /spotify-now-playing-equaliser[\s\S]*?<span><\/span><span><\/span><span><\/span>/);
  assert.match(albumPresentation, /track-col-average/);
  assert.match(albumPresentation, /track-col-your-rating/);
  assert.match(albumPresentation, /track-preview-btn/);
});

test("responsive styling is subtle, animated only while playing, and respects reduced motion", () => {
  assert.match(styles, /\.spotify-iframe-api-mount > iframe/);
  assert.doesNotMatch(styles, /\.spotify-embed-container > iframe[\s\S]*?height:\s*352px/);
  assert.match(playerSource, /type === "album" \? 352 : 152/);
  assert.match(styles, /\.track-row-table\.is-spotify-now-playing[\s\S]*?rgba\(29,185,84/);
  assert.match(styles, /bom-spotify-equaliser/);
  assert.match(styles, /is-spotify-playback-paused/);
  assert.match(styles, /is-spotify-playback-buffering/);
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?spotify-now-playing-equaliser/);
  assert.match(foundationStyles, /\.bom-v1-tracks-section \.track-row-table\.bom-v1-track-row\.is-spotify-now-playing/);
  assert.match(foundationStyles, /@media \(max-width: 900px\)[\s\S]*?spotify-now-playing-status/);
});

test("playback identity comes from playingURI events, never elapsed-time inference", () => {
  assert.match(playerSource, /addListener\([\s\S]*?"playback_started"/);
  assert.match(playerSource, /addListener\([\s\S]*?"playback_update"/);
  assert.match(playerSource, /playingURI/);
  assert.doesNotMatch(playerSource, /setInterval\s*\(/);
  assert.doesNotMatch(playerSource, /position\s*[><=]/);
  assert.doesNotMatch(playerSource, /duration\s*[><=]/);
});

test("Textastic fallback uses delegated contextual Settings navigation", () => {
  const openStart = app.indexOf("async function openWithMusicProvider");
  const openEnd = app.indexOf("async function renderSelectedItem", openStart);
  const openSource = app.slice(openStart, openEnd);
  assert.match(openSource, /data-connect-spotify-from-player="true"/);
  assert.match(openSource, /Open Spotify settings/);
  assert.doesNotMatch(openSource, /Connect Spotify here/);
  assert.doesNotMatch(openSource, /onclick=[\s\S]*?showOnlySection\('settingsSection'\)/);
  assert.match(app, /\[data-connect-spotify-from-player\][\s\S]*?openContextualMusicSettings\(\)/);
  assert.match(app, /connectSpotifyBtn[\s\S]*?scrollIntoView/);
  assert.match(app, /connectSpotifyBtn[\s\S]*?focus/);
});

test("Textastic Settings shortcut runs in capture phase before card navigation", () => {
  const listenerStart = app.indexOf(
    'document.addEventListener("click", event => {',
    app.indexOf("function openWithAmazonMusic")
  );
  const listenerEnd = app.indexOf("}, true);", listenerStart) + "}, true);".length;
  const listenerSource = app.slice(listenerStart, listenerEnd);
  let clickHandler = null;
  let capture = null;
  let settingsOpened = 0;
  let scrolled = 0;
  let focused = 0;
  const connectButton = {
    scrollIntoView(options) {
      scrolled += 1;
      assert.equal(options.block, "center");
    },
    focus(options) {
      focused += 1;
      assert.equal(options.preventScroll, true);
    }
  };
  vm.runInNewContext(listenerSource, {
    document: {
      addEventListener(type, handler, options) {
        assert.equal(type, "click");
        clickHandler = handler;
        capture = options;
      },
      getElementById(id) {
        return id === "connectSpotifyBtn" ? connectButton : null;
      }
    },
    window: {
      requestAnimationFrame(callback) { callback(); }
    },
    openContextualMusicSettings() { settingsOpened += 1; },
    returnFromContextualMusicSettings() {},
    syncListeningServiceControls() {},
    setPreferredListeningService() {}
  });
  let prevented = 0;
  let stopped = 0;
  const shortcut = {};
  clickHandler({
    target: {
      closest(selector) {
        return selector === "[data-connect-spotify-from-player]"
          ? shortcut
          : null;
      }
    },
    preventDefault() { prevented += 1; },
    stopPropagation() { stopped += 1; }
  });

  assert.equal(capture, true);
  assert.equal(settingsOpened, 1);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(scrolled, 1);
  assert.equal(focused, 1);
});
