import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [manifest, config, app, discover, christmas, css, foundation, html, build, mapping, proposal] = await Promise.all([
  readFile(new URL("../christmas-100.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../config.js", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-discover.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-christmas.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-christmas.css", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../scripts/build-cloudflare-pages.sh", import.meta.url), "utf8"),
  readFile(new URL("../supabase/operations/christmas-final-mapping-20261110.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../supabase/operations/christmas-canonical-enrichment-proposal.sql", import.meta.url), "utf8")
]);

test("curation contains 100 unique tracks in the requested six-group split", () => {
  assert.equal(manifest.tracks.length, 100);
  assert.deepEqual(Object.fromEntries(manifest.groups.map(group => [group.id, manifest.tracks.filter(track => track.group === group.id).length])), {
    classics: 20, british: 20, pop: 20, modern: 15, alternative: 15, novelty: 10
  });
  assert.equal(new Set(manifest.tracks.map(track => `${track.title.toLowerCase()}::${track.artist.toLowerCase()}`)).size, 100);
  assert.equal(new Set(manifest.tracks.map(track => track.title.toLowerCase())).size, 100);
  assert(manifest.tracks.every(track => Number.isInteger(track.year) && track.year >= 1942 && track.year <= 2023));
});

test("all 100 recording identities are explicit and unique while existing catalogue rows remain protected", () => {
  const matched = manifest.tracks.filter(track => track.catalogueTrackId);
  const planned = manifest.tracks.filter(track => !track.catalogueTrackId);
  assert.equal(matched.length, 10);
  assert.equal(planned.length, 90);
  assert.equal(new Set(matched.map(track => track.catalogueTrackId)).size, matched.length);
  assert.equal(new Set(matched.map(track => track.canonicalRecordingId)).size, matched.length);
  assert(matched.every(track => Number.isSafeInteger(track.catalogueTrackId) && /^[0-9a-f-]{36}$/.test(track.canonicalRecordingId) && /^[0-9a-f-]{36}$/.test(track.musicbrainzRecordingId)));
  assert(planned.every(track => !track.canonicalRecordingId && /^[0-9a-f-]{36}$/.test(track.musicbrainzRecordingId)));
  assert.equal(new Set(manifest.tracks.map(track => track.musicbrainzRecordingId)).size, 100);
  assert.equal(manifest.tracks.filter(track => track.spotifyId).length, 20);
  assert.match(manifest.catalogueMatchPolicy, /verified MusicBrainz recording identity/i);
});

test("feature remains disabled and requires December in Europe/London", () => {
  assert.match(config, /BOM_CHRISTMAS_FEATURE = Object\.freeze/);
  assert.match(config, /enabled: false/);
  assert.match(config, /timeZone: "Europe\/London"/);
  assert.match(app, /function isChristmasFeatureEnabled\(now = new Date\(\)\)/);
  assert.match(app, /Intl\.DateTimeFormat\("en-GB", \{ month: "2-digit", timeZone \}\)/);
  assert.match(app, /=== "12"/);
  assert.match(christmas, /format\(new Date\(\)\) !== "12"/);
});

function renderDiscover({ enabled, date }) {
  const RealDate = Date;
  class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : [date])); } }
  const listeners = {};
  const document = { addEventListener(type, handler) { listeners[type] = handler; }, querySelectorAll() { return []; }, getElementById() { return null; } };
  const window = {
    BOM_CHRISTMAS_FEATURE: { enabled, timeZone: "Europe/London" }, BOM_BOND_FEATURE: { enabled: false },
    BOMUI: { AlbumCard: () => "", SectionState: ({ title }) => title }, BOMPresentationBridge: {},
    addEventListener() {}, requestAnimationFrame() {}, scrollTo() {}, scrollY: 0,
    history: { state: null, replaceState() {}, pushState() {} }, location: { href: "https://example.test" }
  };
  vm.runInNewContext(discover, { window, document, URL, Math, Date: FixedDate, Intl, Set, Map, matchMedia: () => ({ matches: true }), clearTimeout() {}, setTimeout() {} });
  return window.BOMDiscoverUI.render({ authenticated: true, groups: [], general: [] });
}

test("Discover card requires both the explicit flag and the London December gate", () => {
  assert.doesNotMatch(renderDiscover({ enabled: false, date: "2026-12-12T12:00:00Z" }), /data-bom-christmas-banner/);
  assert.doesNotMatch(renderDiscover({ enabled: true, date: "2026-11-30T12:00:00Z" }), /data-bom-christmas-banner/);
  assert.match(renderDiscover({ enabled: true, date: "2026-12-12T12:00:00Z" }), /THE CHRISTMAS TOP 100/);
});

test("disabled startup lazy-loads no Christmas asset or data", () => {
  assert.doesNotMatch(discover, /fetch\("christmas-100\.json/);
  assert.match(app, /if \(!isChristmasFeatureEnabled\(\) \|\| !currentUser\) return false/);
  assert.match(app, /style\.href = "bom-christmas\.css\?v=2"/);
  assert.match(app, /script\.src = "bom-christmas\.js\?v=2"/);
  assert.equal(/<script[^>]+bom-christmas\.js/.test(html), false);
  assert.equal(/<link[^>]+bom-christmas\.css/.test(html), false);
});

test("rating flow reuses canonical personal persistence and community chart data", () => {
  assert.match(app, /loadChristmasMusicData[\s\S]*?from\("canonical_recordings"\)/);
  assert.match(app, /loadChristmasMusicData[\s\S]*?from\("song_ratings"\)[\s\S]*?\.in\("canonical_song_id", canonicalIds\)/);
  assert.match(app, /saveChristmasTrackRating[\s\S]*?await saveCanonicalRecordingRating\(id, value\)/);
  assert.match(christmas, /data-christmas-rate/);
  assert.match(christmas, /Verified identity · catalogue approval pending/);
  assert.match(christmas, /aria-live="polite"/);
});

test("community ranking, unrated separation, Next Unrated and filters are present", () => {
  for (const pattern of [/Community Top 100/, /Not Yet Rated/, /data-christmas-next/, /Next unrated/, /data-christmas-group/, /data-christmas-decade/, /data-community-rated/, /data-personal-rated/]) assert.match(christmas, pattern);
  assert.match(christmas, /Number\(right\.dataset\.community\) - Number\(left\.dataset\.community\)/);
  assert.match(christmas, /Number\(right\.dataset\.communityCount\) - Number\(left\.dataset\.communityCount\)/);
  assert.match(christmas, /querySelector\("\[data-christmas-rating-group\]"\)/);
});

test("responsive, keyboard, focus and reduced-motion contracts are present", () => {
  assert.match(css, /@media \(max-width:800px\)/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(foundation, /@media \(max-width:700px\)[\s\S]*?\.bom-christmas-banner/);
  assert.match(christmas, /<button type="button" data-christmas-rate/);
  assert.match(christmas, /aria-labelledby/);
  assert.match(christmas, /tabindex="-1"/);
  assert.match(christmas, /\[data-christmas-close\]"\)\.focus/);
  assert.match(christmas, /prefers-reduced-motion: reduce/);
  assert.match(christmas, /class="bom-xmas-snow" aria-hidden="true"/);
  assert.match(christmas, /Array\.from\(\{ length: 20 \}/);
  assert.match(christmas, /--snow-opacity:/);
  assert.match(css, /\.bom-xmas-snow[^}]*pointer-events:none/);
  assert.match(css, /box-shadow:0 0 0 \.65px rgba\(76,104,119,\.3\),0 1px 2px rgba\(76,104,119,\.22\)/);
  assert.match(css, /@keyframes xmasFlake/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)[\s\S]*?\.bom-xmas-snow \{ display:none; \}/);
});

test("verified Spotify identities are exposed only as safe track links", () => {
  assert.match(app, /spotifyId: canonical\?\.preferred_spotify_track_id \|\| entry\.spotifyId \|\| ""/);
  assert.match(christmas, /\^\[A-Za-z0-9\]\{22\}\$/);
  assert.match(christmas, /https:\/\/open\.spotify\.com\/track/);
  assert.match(christmas, /rel="noopener noreferrer"/);
});

test("approval-gated canonical import is idempotent, transactional and rating-safe", () => {
  assert.deepEqual(mapping.summary, {
    tracks: 100,
    existingCanonicalRecords: 10,
    plannedCanonicalRecords: 90,
    unmatched: 0,
    verifiedSpotifyTrackIds: 20,
    ambiguousSpotifyRelations: 14
  });
  assert.match(proposal, /CHRISTMAS_IMPORT_APPROVED/);
  assert.match(proposal, /CHRISTMAS_IMPORT_COMMIT/);
  assert.match(proposal, /begin;/i);
  assert.match(proposal, /rollback;/i);
  assert.match(proposal, /pg_advisory_xact_lock/);
  assert.match(proposal, /on conflict \(origin_key\) do nothing/i);
  assert.doesNotMatch(proposal, /update\s+public\.canonical_recordings/i);
  assert.match(proposal, /Rating count changed unexpectedly/);
  assert.doesNotMatch(proposal, /update\s+public\.song_ratings/i);
  assert.doesNotMatch(proposal, /delete\s+from\s+public\.(song_ratings|songs|canonical_recordings)/i);
});

test("publication build includes every lazy Christmas asset", () => {
  for (const asset of ["bom-christmas.js", "bom-christmas.css", "christmas-100.json"]) assert.match(build, new RegExp(asset.replace(".", "\\.")));
});
