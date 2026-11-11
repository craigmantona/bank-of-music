import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [app, styles] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8")
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
  assert.equal(context.getPreferredListeningService(), "spotify");
  assert.equal(context.setPreferredListeningService("apple"), "apple");
  assert.equal(values.get("bom_preferred_listening_service"), "apple");
  assert.equal(context.setPreferredListeningService("both"), "both");
  assert.equal(context.setPreferredListeningService("unknown"), "spotify");
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

test("provider UI offers Spotify, Apple Music and both with responsive controls", () => {
  assert.match(app, /value="spotify"/);
  assert.match(app, /value="apple"/);
  assert.match(app, /value="both"/);
  assert.match(app, /data-music-service="apple"/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.music-provider-preference[\s\S]*?width: 100%/);
});
