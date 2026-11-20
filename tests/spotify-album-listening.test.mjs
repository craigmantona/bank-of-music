import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

const albumResolverStart = app.indexOf("const SPOTIFY_ALBUM_MATCH_CACHE_PREFIX");
const albumResolverEnd = app.indexOf("function buildMusicProviderPanel", albumResolverStart);
const albumResolverSource = app.slice(albumResolverStart, albumResolverEnd);

function normaliseSpotifyMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*(remaster|remastered|live|edit|version)[^)]*\)/gi, "")
    .replace(/\[[^\]]*(remaster|remastered|live|edit|version)[^\]]*\]/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function createAlbumResolverContext({ spotifyResponse = { albums: { items: [] } } } = {}) {
  const requests = [];
  const storage = new Map();
  const context = vm.createContext({
    Date,
    URLSearchParams,
    console: { warn() {} },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    normaliseSpotifyMatchText,
    spotifyApiRequest: async path => {
      requests.push(path);
      return spotifyResponse;
    }
  });
  vm.runInContext(albumResolverSource, context);
  return { context, requests, storage };
}

test("Let England Shake uses the verified Spotify release before stale cache or Search", async () => {
  const { context, requests, storage } = createAlbumResolverContext();
  storage.set(
    "bom_spotify_album_match_pj harvey|let england shake",
    JSON.stringify({
      id: "2f8Rfpdol5jrJe3OL4YH6k",
      externalUrl: "https://open.spotify.com/album/2f8Rfpdol5jrJe3OL4YH6k"
    })
  );

  const match = await context.searchSpotifyAlbumForBoMAlbum({
    title: "  Let England Shake ",
    artist: "PJ HARVEY"
  });

  assert.equal(match.id, "2JfiVMvVhdueC48EmskS7t");
  assert.equal(match.uri, "spotify:album:2JfiVMvVhdueC48EmskS7t");
  assert.equal(match.externalUrl, "https://open.spotify.com/album/2JfiVMvVhdueC48EmskS7t");
  assert.equal(match.external_urls.spotify, match.externalUrl);
  assert.equal(match.identitySource, "verified-direct-link");
  assert.equal(requests.length, 0);
});

test("verified album links require an exact normalized artist and title", () => {
  const { context } = createAlbumResolverContext();

  assert.equal(context.getVerifiedSpotifyAlbumMatch({
    title: "Let England Shake (Demo)",
    artist: "PJ Harvey"
  }), null);
  assert.equal(context.getVerifiedSpotifyAlbumMatch({
    title: "Let England Shake",
    artist: "PJ Harvey & John Parish"
  }), null);
  assert.equal(context.getVerifiedSpotifyAlbumMatch({
    title: "Let England Shake",
    artist: "Another Artist"
  }), null);
});

test("Spotify album Search stays within the current ten-result API limit", async () => {
  const exactCandidate = {
    id: "1234567890123456789012",
    uri: "spotify:album:1234567890123456789012",
    name: "Test Album",
    artists: [{ name: "Test Artist" }],
    external_urls: {
      spotify: "https://open.spotify.com/album/1234567890123456789012"
    }
  };
  const { context, requests } = createAlbumResolverContext({
    spotifyResponse: { albums: { items: [exactCandidate] } }
  });

  const match = await context.searchSpotifyAlbumForBoMAlbum({
    title: "Test Album",
    artist: "Test Artist"
  });

  assert.equal(match.id, exactCandidate.id);
  assert.ok(requests.length > 0);
  requests.forEach(path => {
    const url = new URL(path, "https://api.spotify.com/v1");
    assert.equal(url.searchParams.get("limit"), "10");
  });
});

test("the verified direct album beats stale cache and renders without token refresh or API lookup", async () => {
  const renders = [];
  const requests = [];
  let tokenChecks = 0;
  const storage = new Map();
  const context = vm.createContext({
    Date,
    URLSearchParams,
    console: { error() {}, warn() {} },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    normaliseSpotifyMatchText,
    spotifyApiRequest: async path => {
      requests.push(path);
      throw new Error("Spotify Search must not run for a verified direct link.");
    },
    recordMusicProviderClick: async () => {},
    getSpotifySearchFallbackUrl: ({ title, artist }) =>
      `https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`)}`,
    getCachedSpotifyMatch: () => null,
    getValidSpotifyAccessToken: async () => {
      tokenChecks += 1;
      return null;
    },
    searchSpotifyTrackForBoMTrack: async () => null,
    buildSpotifyEmbedUrl: ({ type, spotifyItem }) =>
      `https://open.spotify.com/embed/${type}/${spotifyItem.id}`,
    renderSpotifyEmbed: options => {
      renders.push(options);
      return true;
    },
    getOrCreateReusableAlbumPreviewFrame: () => false,
    spotifyAlbumRenderRequestGeneration: 0,
    isCurrentSpotifyAlbumRenderRequest: () => true,
    createSpotifyAlbumPlayerSupersededError: () => {
      const error = new Error("superseded");
      error.code = "SPOTIFY_ALBUM_PLAYER_SUPERSEDED";
      return error;
    },
    escapeHtml: value => String(value ?? "")
  });
  vm.runInContext(albumResolverSource, context);
  storage.set(
    "bom_spotify_album_match_pj harvey|let england shake",
    JSON.stringify({
      id: "2f8Rfpdol5jrJe3OL4YH6k",
      externalUrl: "https://open.spotify.com/album/2f8Rfpdol5jrJe3OL4YH6k"
    })
  );
  const openStart = app.indexOf("async function openWithMusicProvider");
  const openEnd = app.indexOf("async function renderSelectedItem", openStart);
  vm.runInContext(app.slice(openStart, openEnd), context);

  const target = {
    id: "album-player",
    innerHTML: "",
    classList: { remove() {} }
  };
  await context.openWithMusicProvider({
    type: "album",
    title: "Let England Shake",
    artist: "PJ Harvey",
    targetElement: target
  });

  assert.equal(tokenChecks, 0);
  assert.equal(requests.length, 0);
  assert.equal(renders.length, 1);
  assert.equal(
    renders[0].embedUrl,
    "https://open.spotify.com/embed/album/2JfiVMvVhdueC48EmskS7t"
  );
  assert.equal(
    renders[0].externalUrl,
    "https://open.spotify.com/album/2JfiVMvVhdueC48EmskS7t"
  );
  assert.doesNotMatch(renders[0].embedUrl, /\/track\//);
  assert.doesNotMatch(renders[0].externalUrl, /\/track\//);
});

test("Spotify API failures are not mislabeled as exact-match misses", async () => {
  let apiFails = true;
  const context = vm.createContext({
    console: { error() {} },
    recordMusicProviderClick: async () => {},
    getSpotifySearchFallbackUrl: () => "https://open.spotify.com/search/Unknown%20Album",
    getCachedSpotifyMatch: () => null,
    getVerifiedSpotifyAlbumMatch: () => null,
    getCachedSpotifyAlbumMatch: () => null,
    getValidSpotifyAccessToken: async () => "access-token",
    searchSpotifyTrackForBoMTrack: async () => null,
    searchSpotifyAlbumForBoMAlbum: async () => {
      if (apiFails) {
        throw new Error("Spotify API request failed with HTTP 400.");
      }
      return null;
    },
    buildSpotifyEmbedUrl: () => "",
    renderSpotifyEmbed: () => false,
    getOrCreateReusableAlbumPreviewFrame: () => false,
    spotifyAlbumRenderRequestGeneration: 0,
    isCurrentSpotifyAlbumRenderRequest: () => true,
    createSpotifyAlbumPlayerSupersededError: () => {
      const error = new Error("superseded");
      error.code = "SPOTIFY_ALBUM_PLAYER_SUPERSEDED";
      return error;
    },
    escapeHtml: value => String(value ?? "")
  });
  const openStart = app.indexOf("async function openWithMusicProvider");
  const openEnd = app.indexOf("async function renderSelectedItem", openStart);
  vm.runInContext(app.slice(openStart, openEnd), context);
  const target = {
    id: "album-player",
    innerHTML: "",
    classList: { remove() {} }
  };

  await context.openWithMusicProvider({
    type: "album",
    title: "Unknown Album",
    artist: "Unknown Artist",
    targetElement: target
  });

  assert.match(target.innerHTML, /Spotify lookup is temporarily unavailable/);
  assert.doesNotMatch(target.innerHTML, /could not find an exact Spotify match/);
  assert.match(target.innerHTML, /Search in Spotify/);

  apiFails = false;
  target.innerHTML = "";
  await context.openWithMusicProvider({
    type: "album",
    title: "Unknown Album",
    artist: "Unknown Artist",
    targetElement: target
  });
  assert.match(target.innerHTML, /could not find an exact Spotify match/);
});

test("provider click handling keeps Spotify local and preserves Apple and Amazon routing", async () => {
  const calls = [];
  const listeners = new Map();
  const context = vm.createContext({
    Date,
    console: { log() {} },
    lastMusicProviderInteractionAt: 0,
    lastTrackRatingInteractionAt: 0,
    openWithMusicProvider: async options => calls.push(["spotify", options]),
    openWithAppleMusic: async options => calls.push(["apple", options]),
    openWithAmazonMusic: async options => calls.push(["amazon", options])
  });
  const bindStart = app.indexOf("function bindCardClicks");
  const bindEnd = app.indexOf("bindCardClicks(recommendationsList)", bindStart);
  vm.runInContext(app.slice(bindStart, bindEnd), context);
  context.bindCardClicks({
    addEventListener(type, listener) {
      listeners.set(type, listener);
    }
  });

  async function click(service) {
    const button = {
      dataset: {
        musicService: service,
        providerType: "album",
        providerTitle: "Let England Shake",
        providerArtist: "PJ Harvey",
        providerAlbum: "",
        playerTarget: "spotify-player"
      }
    };
    const stopped = [];
    const event = {
      target: {
        closest(selector) {
          return selector === ".music-provider-play-btn" ? button : null;
        }
      },
      preventDefault: () => stopped.push("preventDefault"),
      stopPropagation: () => stopped.push("stopPropagation"),
      stopImmediatePropagation: () => stopped.push("stopImmediatePropagation")
    };
    await listeners.get("click")(event);
    assert.deepEqual(stopped, [
      "preventDefault",
      "stopPropagation",
      "stopImmediatePropagation"
    ]);
  }

  await click("spotify");
  await click("apple");
  await click("amazon");

  assert.deepEqual(calls.map(([service]) => service), ["spotify", "apple", "amazon"]);
  assert.equal(calls[0][1].type, "album");
  assert.equal(calls[0][1].title, "Let England Shake");
  assert.equal(calls[0][1].artist, "PJ Harvey");
  assert.equal(calls[0][1].playerTarget, "spotify-player");
});
