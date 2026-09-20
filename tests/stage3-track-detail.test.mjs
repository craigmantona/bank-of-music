import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, styles] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);

const selectedTrackBranch = app.match(/if \(selectedItem\.type === "song"\) \{[\s\S]*?\n  return;\n\}/)?.[0] || "";

test("selected tracks use the modern detail hierarchy without the legacy card", () => {
  assert.match(selectedTrackBranch, /bom-v1-track-detail/);
  assert.match(selectedTrackBranch, /bom-v1-album-hero bom-v1-track-detail-hero/);
  assert.match(selectedTrackBranch, />Track</);
  assert.doesNotMatch(selectedTrackBranch, /detail-panel|detail-info-panel|media-title|renderStarSelector/);
});

test("track detail retains navigation, linked entities, ratings and provider actions", () => {
  for (const contract of [
    /buildSelectedBackButton\(\)/,
    /song-artist-link/,
    /song-album-link/,
    /data-open-song-album-id/,
    /buildCompactTrackRatingControl/,
    /Community/,
    /Your track rating/,
    /buildMusicProviderPanel/,
    /data-library-type="song"/
  ]) assert.match(selectedTrackBranch, contract);
});

test("track detail follows the Album surface system and has focused mobile rules", () => {
  assert.match(styles, /\.bom-shell-v1 \.bom-v1-track-detail-hero/);
  assert.match(styles, /var\(--bom-v1-surface\)/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.bom-v1-track-detail/);
  assert.match(styles, /min-height: 44px/);
  assert.doesNotMatch(styles.match(/\/\* Selected track detail[\s\S]*?(?=\.bom-shell-v1 \.bom-v1-album-section)/)?.[0] || "", /purple|gradient|#[a-f0-9]{6}/i);
});

test("modern track album links and cards reset the legacy global button glow", () => {
  assert.match(styles, /\.bom-v1-track-detail-album strong \{[^}]*box-shadow: none;/);
  assert.match(styles, /\.bom-v1-track-album-card \{[^}]*box-shadow: none;/);
});
