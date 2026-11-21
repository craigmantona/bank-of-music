import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [app, albumPresentation, foundationStyles] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-album.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);

const actionStart = app.indexOf("function isValidSpotifyTrackId");
const actionEnd = app.indexOf("function getSpotifyAlbumMatchCacheKey", actionStart);
assert.ok(actionStart >= 0 && actionEnd > actionStart);
const actionSource = app.slice(actionStart, actionEnd);

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
})[character]);

function makeActionHarness(verifiedTracks = []) {
  const context = vm.createContext({
    escapeHtml,
    getVerifiedSpotifyAlbumMatch: () => ({ tracks: verifiedTracks }),
    normaliseSpotifyMatchText: (value) => String(value || "").trim().toLowerCase(),
    getSpotifySearchFallbackUrl: ({ title, artist }) =>
      `https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`.trim())}`
  });
  vm.runInContext(actionSource, context);
  return context;
}

test("a verified album track ID renders a safe external Spotify link", () => {
  const context = makeActionHarness();
  const html = context.buildAlbumTrackSpotifyAction({
    spotifyTrackId: "2K7qvmfEWQm41wIJkjDBj4",
    title: "The Last Living Rose",
    artist: "PJ Harvey",
    album: "Let England Shake"
  });

  assert.match(html, /href="https:\/\/open\.spotify\.com\/track\/2K7qvmfEWQm41wIJkjDBj4"/);
  assert.match(html, /data-spotify-track-action="external"/);
  assert.match(html, /data-spotify-link-kind="exact"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, />Open track in Spotify</);
  assert.match(html, /aria-label="Open The Last Living Rose by PJ Harvey in Spotify \(opens in a new tab\)"/);
  assert.doesNotMatch(html, /aria-pressed|▶|data-track-preview/);
});

test("curated track IDs require both album position and title to match", () => {
  const trackId = "2K7qvmfEWQm41wIJkjDBj4";
  const context = makeActionHarness([{
    id: trackId,
    title: "The Last Living Rose",
    trackNumber: 2,
    discNumber: 1
  }]);
  const baseInput = {
    albumTitle: "Let England Shake",
    albumArtist: "PJ Harvey",
    trackNumber: 2,
    discNumber: 1
  };

  assert.equal(context.resolveAlbumTrackSpotifyId({
    ...baseInput,
    trackTitle: "The Last Living Rose"
  }), trackId);
  assert.equal(context.resolveAlbumTrackSpotifyId({
    ...baseInput,
    trackTitle: "Alternate-edition bonus track"
  }), "");
});

test("missing or malformed track IDs use an encoded Spotify search fallback", () => {
  const context = makeActionHarness();
  for (const spotifyTrackId of ["", "not-a-valid-id", "javascript:alert(1)"]) {
    const html = context.buildAlbumTrackSpotifyAction({
      spotifyTrackId,
      title: "Song & Dance",
      artist: "Artist / Guest",
      album: "Album"
    });
    assert.match(
      html,
      /href="https:\/\/open\.spotify\.com\/search\/Song%20%26%20Dance%20Artist%20%2F%20Guest"/
    );
    assert.match(html, /data-spotify-link-kind="search"/);
    assert.match(html, />Search track in Spotify</);
    assert.doesNotMatch(html, /open\.spotify\.com\/track\/(?:not-a-valid-id|javascript)/);
  }
});

test("an action with no safe identity or search terms is non-interactive", () => {
  const context = makeActionHarness();
  const html = context.buildAlbumTrackSpotifyAction({
    spotifyTrackId: "invalid",
    title: "",
    artist: ""
  });
  assert.match(html, /Spotify link unavailable/);
  assert.match(html, /aria-disabled="true"/);
  assert.doesNotMatch(html, /<a\b|href=/);
});

test("album track actions cannot replace or control the album Embed", () => {
  const playerStart = app.indexOf("const SPOTIFY_IFRAME_API_SRC");
  const playerEnd = app.indexOf("async function openWithMusicProvider", playerStart);
  const playerSource = app.slice(playerStart, playerEnd);

  assert.doesNotMatch(app, /data-track-preview|handleAlbumTrackPreviewButton|albumTrackSelectionRow/);
  assert.doesNotMatch(playerSource, /loadSpotifyAlbumTrackIntoPlayer|controller\.loadEntity\s*\(/);
  assert.doesNotMatch(actionSource, /openWithMusicProvider|renderSpotifyEmbed|scrollIntoView|activeSpotifyAlbumPlayer/);
  assert.match(playerSource, /const entityUri = `spotify:album:\$\{entityId\}`/);
  assert.match(playerSource, /height: 352/);
  assert.doesNotMatch(playerSource, /height:\s*152|spotify:track:\$\{entityId\}/);
});

test("both album renderers use external actions and retain playback status markup", () => {
  assert.match(app, /buildAlbumTrackSpotifyAction\(\{/);
  assert.match(app, /\$\{spotifyControlHtml\}/);
  assert.match(albumPresentation, /track\.spotifyControlHtml/);
  assert.match(albumPresentation, /data-spotify-now-playing-status/);
  assert.match(app, /data-spotify-now-playing-status/);
  assert.doesNotMatch(albumPresentation, /data-track-preview|aria-pressed|▶/);
  assert.doesNotMatch(app, /albumTrackPreviewDock|getOrCreateReusableAlbumPreviewFrame/);
  assert.doesNotMatch(albumPresentation, /albumTrackPreviewDock/);
});

test("external track links keep native navigation and cannot auto-scroll", () => {
  const bindStart = app.indexOf("function bindCardClicks");
  const externalStart = app.indexOf("const spotifyExternalLink", bindStart);
  const externalEnd = app.indexOf("const providerPanel", externalStart);
  const externalGuard = app.slice(externalStart, externalEnd);

  assert.match(externalGuard, /\.spotify-open-externally-btn/);
  assert.match(externalGuard, /stopPropagation\(\)/);
  assert.doesNotMatch(externalGuard, /preventDefault|scrollIntoView|openWithMusicProvider|loadEntity/);
  assert.match(app, /\[data-spotify-track-action='external'\]/);
});

test("mobile album rows reserve a readable line for the external action", () => {
  assert.match(
    foundationStyles,
    /grid-template-areas:\s*"number title title" "number time time" "number community yours" "number actions actions"/
  );
  assert.match(
    foundationStyles,
    /\.bom-v1-track-row \.track-spotify-link[\s\S]*?min-height:\s*44px/
  );
  assert.match(foundationStyles, /minmax\(150px, auto\)/);
});

test("album navigation still disposes the old album controller", () => {
  const renderStart = app.indexOf("async function renderSelectedItem");
  const renderSource = app.slice(renderStart, renderStart + 500);
  assert.match(renderSource, /spotifyAlbumRenderRequestGeneration \+= 1/);
  assert.match(renderSource, /disposeSpotifyAlbumPlayer\(\)/);
});
