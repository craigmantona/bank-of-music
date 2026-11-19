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

function renderProviderPanel(preference, type = "album") {
  const { context } = createContext({ stored: preference });
  context.escapeHtml = value => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const panelStart = app.indexOf("function buildMusicProviderPanel");
  const panelEnd = app.indexOf("function syncListeningServiceControls", panelStart);
  vm.runInNewContext(app.slice(panelStart, panelEnd), context);
  return context.buildMusicProviderPanel({
    type,
    title: type === "album" ? "Album" : "Song",
    artist: "Artist",
    album: "Album"
  });
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

test("album and track provider UI matches the polished panel hierarchy without verbose preference copy", () => {
  const panelStart = app.indexOf("function buildMusicProviderPanel");
  const panelEnd = app.indexOf("function syncListeningServiceControls", panelStart);
  const panel = app.slice(panelStart, panelEnd);
  assert.doesNotMatch(panel, /data-listening-service=/);
  assert.doesNotMatch(panel, /role="radiogroup"/);
  assert.match(panel, /role="group" aria-label="Listen to this/);
  assert.match(panel, /<h3 id="\$\{escapeHtml\(headingId\)\}" class="music-provider-title">Listen to this \$\{itemLabel\}/);
  assert.match(panel, /aria-controls="settingsSection"/);
  assert.match(panel, /data-open-listening-settings="true"/);
  assert.match(panel, /Open music preferences in Settings/);
  assert.match(panel, /data-music-provider-selected-services="true"/);
  assert.match(panel, /data-music-provider-secondary-services="true"/);
  assert.match(panel, /Also available on/);
  assert.doesNotMatch(panel, /preferred service|preferred services|Change this in Settings/);
  assert.match(app, /MUSIC_PROVIDER_ORDER = Object\.freeze\(\["spotify", "apple", "amazon"\]\)/);
  assert.match(panel, /data-music-service="\$\{service\}"/);
  assert.match(panel, /aria-label="Listen on \$\{MUSIC_PROVIDER_LABELS\[service\]\}"/);
  assert.match(panel, /data-service-priority="\$\{priority\}"/);
  assert.match(panel, /music-service-logo/);
  assert.match(app, /data-open-listening-settings[\s\S]*showOnlySection\("settingsSection"\)/);
});

test("rendered single, Both and All three panels keep the exact selected and secondary destinations", () => {
  const spotify = renderProviderPanel("spotify");
  assert.match(spotify, /data-selected-service-count="1"/);
  assert.match(spotify, /data-music-provider-selected-services="true"[\s\S]*data-music-service="spotify"[\s\S]*data-service-priority="primary"/);
  assert.match(spotify, /data-music-provider-secondary-services="true"[\s\S]*data-music-service="apple"[\s\S]*data-music-service="amazon"/);

  const both = renderProviderPanel("both");
  const bothSelected = both.slice(
    both.indexOf('data-music-provider-selected-services="true"'),
    both.indexOf('data-music-provider-secondary-row="true"')
  );
  assert.match(both, /data-selected-service-count="2"/);
  assert.match(bothSelected, /data-music-service="spotify"[\s\S]*data-service-priority="selected"/);
  assert.match(bothSelected, /data-music-service="apple"[\s\S]*data-service-priority="selected"/);
  assert.doesNotMatch(bothSelected, /data-music-service="amazon"/);
  assert.match(both, /data-music-provider-secondary-services="true"[\s\S]*data-music-service="amazon"/);

  const all = renderProviderPanel("all");
  assert.match(all, /data-selected-service-count="3"/);
  assert.match(all, /music-provider-secondary-row hidden/);
  assert.equal((all.match(/data-service-priority="selected"/g) || []).length, 3);
  assert.doesNotMatch(all, /preferred service|preferred services|Change this in Settings/);

  const song = renderProviderPanel("amazon", "song");
  assert.match(song, />Listen to this track</);
  assert.match(song, /role="group" aria-label="Listen to this track"/);
});

test("the five-option preference selector exists only in Settings and keeps keyboard radio behaviour", () => {
  assert.equal((html.match(/role="radiogroup" aria-label="Preferred listening service"/g) || []).length, 1);
  for (const preference of ["spotify", "apple", "amazon", "both", "all"]) {
    assert.match(html, new RegExp(`data-listening-service="${preference}"`));
  }
  assert.match(html, /This preference can only be changed here/);
  assert.match(app, /\["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"\]/);
});

test("single and multi-service layouts use the approved card, branded hierarchy and responsive balance", () => {
  const polishedStyles = styles.slice(styles.indexOf("POLISHED LISTENING PANEL"));
  assert.match(styles, /\.music-provider-preference button\[aria-checked="true"\]/);
  assert.match(styles, /\.music-provider-preference button:focus-visible/);
  assert.match(polishedStyles, /\.music-provider-panel \{[\s\S]*?padding: clamp\(20px, 2\.4vw, 28px\)[\s\S]*?border-radius: 26px[\s\S]*?background: #111714/);
  assert.match(polishedStyles, /\.music-provider-selected-services \.music-provider-play-btn \{[\s\S]*?min-height: 62px[\s\S]*?border-radius: 16px/);
  assert.match(polishedStyles, /data-selected-service-count="2"[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(polishedStyles, /data-selected-service-count="3"[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(polishedStyles, /music-provider-spotify-btn:is[\s\S]*?background: #1ed760 !important/);
  assert.match(polishedStyles, /music-provider-apple-btn:is[\s\S]*?linear-gradient/);
  assert.match(polishedStyles, /music-provider-amazon-btn:is[\s\S]*?background: #17212b !important/);
  assert.match(polishedStyles, /\.music-provider-secondary-services \.music-provider-play-btn \{[\s\S]*?border-radius: 999px[\s\S]*?background: #292e2b !important/);
  assert.match(polishedStyles, /@media \(max-width: 700px\)[\s\S]*?data-selected-service-count="3"[\s\S]*?grid-template-columns: 1fr/);
  assert.match(foundationStyles, /\.music-provider-panel \{[\s\S]*?padding: 24px[\s\S]*?background: #101512[\s\S]*?border-radius: 24px/);
  assert.match(foundationStyles, /music-provider-secondary-services[\s\S]*?background: #292e2b !important/);
});
