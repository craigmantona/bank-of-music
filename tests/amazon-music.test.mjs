import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, html, styles] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8")
]);

const panelStart = html.indexOf('<div class="settings-panel amazon-settings-panel">');
const panelEnd = html.indexOf("</section>", panelStart);
const amazonPanel = html.slice(panelStart, panelEnd);

test("Amazon Music settings expose all five BoM playlists through Soundiiz", () => {
  assert.notEqual(panelStart, -1);
  for (const threshold of [7, 8, 9, 10]) {
    assert.match(amazonPanel, new RegExp(`data-minimum-rating="${threshold}"`));
  }
  assert.match(amazonPanel, /data-playlist-type="global-top-100"/);
  assert.equal((amazonPanel.match(/class="amazon-playlist-link-btn/g) || []).length, 5);
  assert.match(amazonPanel, /links expire after 24 hours/i);
  assert.match(amazonPanel, /200-track maximum/i);
  assert.match(amazonPanel, /complete the transfer on Soundiiz/i);
});

test("Amazon Music playlist preparation reuses rating sources and the guarded destination", () => {
  assert.match(app, /prepareAmazonMusicPlaylist/);
  assert.match(app, /getCurrentUserRatedTracksForSpotify\(minimumRating\)/);
  assert.match(app, /getGlobalTop100TracksForSpotify\(\)/);
  assert.match(app, /SOUNDIIZ_AMAZON_MUSIC_DESTINATION/);
  assert.match(app, /serviceName: "Amazon Music"/);
  assert.match(app, /Lists over 200 tracks are split/);
  assert.doesNotMatch(amazonPanel, /automatically creates? (?:an? )?Amazon Music playlist/i);
});

test("Amazon Music listening preferences retain legacy Both and add Amazon and All three", () => {
  assert.match(html, /Existing “Both” choices continue to mean Spotify \+ Apple Music/);
  assert.match(html, /data-listening-service="amazon"/);
  assert.match(html, /data-listening-service="all"/);
  assert.match(app, /if \(preference === "both"\) return new Set\(\["spotify", "apple"\]\)/);
  assert.match(app, /if \(preference === "all"\) return new Set\(\["spotify", "apple", "amazon"\]\)/);
  assert.match(app, /provider: "amazon_music"/);
  assert.match(styles, /\.music-provider-amazon-btn/);
  assert.match(styles, /\.amazon-settings-panel/);
});
