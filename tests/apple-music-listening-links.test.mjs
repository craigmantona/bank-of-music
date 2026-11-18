import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [app, styles, foundationStyles, html] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8")
]);

const start = app.indexOf("const MUSIC_PROVIDER_PREFERENCE_KEY");
const end = app.indexOf("const SPOTIFY_ALBUM_MATCH_CACHE_PREFIX", start);
const source = app.slice(start, end);

function createContext({ stored = null, fetchImpl = async () => ({ ok: false }) } = {}) {
  const values = new Map(stored ? [["bom_preferred_listening_service", stored]] : []);
  const context = {
    URL,
    URLSearchParams,
    Set,
    fetch: fetchImpl,
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    },
    normaliseSpotifyMatchText: value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  };
  vm.runInNewContext(source, context);
  return { context, values };
}

test("listening preference defaults safely and persists all supported choices", () => {
  const { context, values } = createContext();
  assert.equal(context.getPreferredListeningService(), "both");
  assert.equal(context.setPreferredListeningService("apple"), "apple");
  assert.equal(values.get("bom_preferred_listening_service"), "apple");
  assert.equal(context.setPreferredListeningService("both"), "both");
  assert.equal(context.setPreferredListeningService("amazon"), "amazon");
  assert.equal(context.setPreferredListeningService("all"), "all");
  assert.equal(context.setPreferredListeningService("unknown"), "both");
});

test("legacy Both stays Spotify plus Apple while All three includes Amazon", () => {
  const { context } = createContext({ stored: "both" });
  assert.deepEqual(
    [...context.getListeningServicesForPreference(context.getPreferredListeningService())],
    ["spotify", "apple"]
  );
  assert.deepEqual(
    [...context.getListeningServicesForPreference("all")],
    ["spotify", "apple", "amazon"]
  );
});

test("single and multi-service preferences assign prominence without dropping destinations", () => {
  const { context } = createContext();
  assert.equal(context.getListeningServicePriority("spotify", "spotify"), "primary");
  assert.equal(context.getListeningServicePriority("apple", "spotify"), "secondary");
  assert.equal(context.getListeningServicePriority("amazon", "spotify"), "secondary");

  assert.equal(context.getListeningServicePriority("spotify", "both"), "selected");
  assert.equal(context.getListeningServicePriority("apple", "both"), "selected");
  assert.equal(context.getListeningServicePriority("amazon", "both"), "secondary");

  for (const service of ["spotify", "apple", "amazon"]) {
    assert.equal(context.getListeningServicePriority(service, "all"), "selected");
  }
  assert.equal(
    context.getListeningPreferenceSummary("both"),
    "Your preferred services are Spotify and Apple Music."
  );
});

test("Amazon Music search links use the official HTTPS UK search route and encode metadata", () => {
  const { context } = createContext();
  assert.equal(
    context.getAmazonMusicSearchUrl({
      type: "song",
      title: "Rock & Roll",
      artist: "Artist/Guest",
      album: "Hits?"
    }),
    "https://music.amazon.co.uk/search/Rock%20%26%20Roll%20Artist%2FGuest%20Hits%3F"
  );
});

test("Apple Music fallback is HTTPS and safely encodes track, artist and album", () => {
  const { context } = createContext();
  const url = context.getAppleMusicSearchFallbackUrl({
    type: "song",
    title: "Rock & Roll",
    artist: "Artist/Guest",
    album: "Hits?"
  });
  assert.equal(url, "https://music.apple.com/gb/search?term=Rock%20%26%20Roll%20Artist%2FGuest%20Hits%3F");
});

test("resolver accepts only an exact Apple Music entity and falls back on unsafe URLs", async () => {
  let requests = 0;
  const { context } = createContext({
    fetchImpl: async () => {
      requests += 1;
      return {
        ok: true,
        json: async () => ({ results: [{
          trackName: "Song",
          artistName: "Artist",
          collectionName: "Album",
          trackViewUrl: "https://music.apple.com/gb/album/album/123?i=456"
        }] })
      };
    }
  });
  assert.equal(requests, 0, "Apple lookup must not run during initialization");
  const exact = await context.resolveAppleMusicUrl({ type: "song", title: "Song", artist: "Artist", album: "Album" });
  assert.equal(requests, 1);
  assert.match(exact, /^https:\/\/music\.apple\.com\/gb\/album\/album\/123\?i=456$/);
  const fallback = context.safeAppleMusicUrl("javascript:alert(1)", "https://music.apple.com/gb/search?term=Song");
  assert.equal(fallback, "https://music.apple.com/gb/search?term=Song");
});

test("track resolution falls back when the album identity does not agree", async () => {
  const { context } = createContext({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ results: [{
        trackName: "Song",
        artistName: "Artist",
        collectionName: "Wrong Album",
        trackViewUrl: "https://music.apple.com/gb/album/wrong/999?i=888"
      }] })
    })
  });
  const url = await context.resolveAppleMusicUrl({ type: "song", title: "Song", artist: "Artist", album: "Right Album" });
  assert.equal(url, "https://music.apple.com/gb/search?term=Song%20Artist%20Right%20Album");
});

test("album and track provider UI keeps every service in one accessible compact action group", () => {
  const panelStart = app.indexOf("function buildMusicProviderPanel");
  const panelEnd = app.indexOf("function syncListeningServiceControls", panelStart);
  const panel = app.slice(panelStart, panelEnd);
  assert.doesNotMatch(panel, /data-listening-service=/);
  assert.doesNotMatch(panel, /role="radiogroup"/);
  assert.match(panel, /role="group" aria-label="Listen to this/);
  assert.match(panel, /data-music-provider-summary="true"/);
  assert.match(panel, /data-music-service="spotify"/);
  assert.match(panel, /data-music-service="apple"/);
  assert.match(panel, /data-music-service="amazon"/);
  assert.equal((panel.match(/aria-label="Listen on /g) || []).length, 3);
  assert.equal((panel.match(/data-service-priority=/g) || []).length, 3);
  assert.match(panel, /music-service-logo/);
});

test("the five-option preference selector exists only in Settings and keeps keyboard radio behaviour", () => {
  assert.equal((html.match(/role="radiogroup" aria-label="Preferred listening service"/g) || []).length, 1);
  for (const preference of ["spotify", "apple", "amazon", "both", "all"]) {
    assert.match(html, new RegExp(`data-listening-service="${preference}"`));
  }
  assert.match(html, /This preference can only be changed here/);
  assert.match(app, /\["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"\]/);
});

test("single and multi-service layouts remain visible, touch-sized and responsive", () => {
  assert.match(styles, /\.music-provider-preference button\[aria-checked="true"\]/);
  assert.match(styles, /\.music-provider-preference button:focus-visible/);
  assert.match(styles, /\.music-provider-play-btn \{[\s\S]*?min-height: 44px/);
  assert.match(styles, /data-service-priority="primary"[\s\S]*?min-height: 50px/);
  assert.match(styles, /data-service-priority="selected"[\s\S]*?flex: 1 1 160px/);
  assert.match(styles, /data-service-priority="secondary"[\s\S]*?border-color: transparent/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.music-provider-preference button[\s\S]*?min-height: 48px/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?data-service-priority="primary"[\s\S]*?width: 100%/);
  assert.match(foundationStyles, /data-service-priority="secondary"[\s\S]*?border-color: transparent !important/);
});
