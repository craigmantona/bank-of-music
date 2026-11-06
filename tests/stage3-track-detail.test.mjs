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
  assert.match(selectedTrackBranch, /bom-v1-track-full-album/);
  assert.match(selectedTrackBranch, /bom-v1-track-release-section/);
  assert.match(selectedTrackBranch, /linkedAlbum\.id/);
  assert.doesNotMatch(selectedTrackBranch, /\$\{song\.album_id\s*\? `<button[^`]*data-open-song-album-id/);
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

test("the full-album action is prominent, keyboard visible and touch sized", () => {
  assert.match(styles, /\.bom-v1-track-full-album \{[^}]*display: inline-flex !important;[^}]*min-height: 46px;[^}]*background: var\(--bom-v1-accent\) !important;/);
  assert.match(styles, /\.bom-v1-track-full-album:focus-visible/);
  assert.match(styles, /\.bom-v1-track-full-album:active/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.bom-v1-track-release-layout \.bom-v1-track-full-album \{ width: 100%; \}/);
});

test("More from Artist rows cannot inherit legacy purple button styling", () => {
  assert.match(styles, /\.bom-v1-track-detail-related \.bom-v1-track-related-row \{[^}]*background-image:none !important;[^}]*border-radius: 0 !important;[^}]*box-shadow:none !important;/);
});

test("album context precedes ordered album tracks and secondary artist discovery", () => {
  const releaseIndex = selectedTrackBranch.indexOf("bom-v1-track-release-section");
  const albumTracksIndex = selectedTrackBranch.indexOf("bom-v1-track-album-tracks");
  const artistIndex = selectedTrackBranch.indexOf("bom-v1-track-detail-related");
  assert.ok(releaseIndex > 0);
  assert.ok(albumTracksIndex > releaseIndex);
  assert.ok(artistIndex > albumTracksIndex);
  assert.match(selectedTrackBranch, /Number\(a\.track_position \|\| 9999\) - Number\(b\.track_position \|\| 9999\)/);
  assert.match(selectedTrackBranch, /Also on this album/);
  assert.match(selectedTrackBranch, /aria-current="true"/);
  assert.match(selectedTrackBranch, /Now viewing/);
});

test("single-track releases stay compact and same-album tracks are excluded from artist discovery", () => {
  assert.match(selectedTrackBranch, /const isSingleRelease = Boolean\(linkedAlbum && albumTracks\.length <= 1\)/);
  assert.match(selectedTrackBranch, /isSingleRelease \? "Single release" : "From the album"/);
  assert.match(selectedTrackBranch, /linkedAlbum && !isSingleRelease && albumTracks\.length/);
  assert.match(selectedTrackBranch, /!albumTrackIds\.has\(Number\(candidate\.id\)\)/);
  assert.match(selectedTrackBranch, /Number\(candidate\.album_id\) !== Number\(linkedAlbum\.id\)/);
});

test("album track navigation reuses loaded catalogue ratings without new requests", () => {
  assert.match(selectedTrackBranch, /getSongAverage\(albumTrack\.id\)/);
  assert.match(selectedTrackBranch, /getYourSongRating\(albumTrack\.id\)/);
  assert.match(selectedTrackBranch, /data-library-type="song" data-song-id="\$\{albumTrack\.id\}"/);
  assert.doesNotMatch(selectedTrackBranch, /supabase\.|fetch\(|musicbrainz/i);
});

test("album track rows are clean, responsive and keyboard visible", () => {
  assert.match(styles, /\.bom-v1-track-album-row \{[^}]*background-image: none !important;[^}]*box-shadow: none !important;/);
  assert.match(styles, /\.bom-v1-track-album-row\.is-current \{[^}]*var\(--bom-v1-accent\)/);
  assert.match(styles, /button\.bom-v1-track-album-row:focus-visible/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.bom-v1-track-album-row \{[^}]*grid-template-areas:/);
});
