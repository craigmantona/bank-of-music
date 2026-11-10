import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const [manifest, config, app, discover, bond, css, foundation, html, build] = await Promise.all([
  readFile(new URL("../bond-007.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../config.js", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-discover.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-bond.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-bond.css", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../scripts/build-cloudflare-pages.sh", import.meta.url), "utf8")
]);

test("manifest contains exactly the 25 official Eon films in chronological order", () => {
  assert.equal(manifest.scope, "Official Eon Productions films only");
  assert.equal(manifest.films.length, 25);
  assert.deepEqual(manifest.films.map(row => row.year), [...manifest.films.map(row => row.year)].sort((a, b) => a - b));
  assert.equal(manifest.films[0].filmTitle, "Dr. No");
  assert.equal(manifest.films.at(-1).filmTitle, "No Time to Die");
  assert.equal(new Set(manifest.films.map(row => `${row.filmTitle}:${row.year}`)).size, 25);
  for (const excluded of ["Never Say Never Again", "Casino Royale (1967)"]) assert.equal(manifest.films.some(row => row.filmTitle === excluded), false);
});

test("special cases and the OHMSS bonus are modelled without theme substitution", () => {
  assert.equal(manifest.films.find(row => row.filmTitle === "Dr. No").instrumental, true);
  const russia = manifest.films.find(row => row.filmTitle === "From Russia with Love");
  assert.equal(russia.originalPerformer, "Matt Monro");
  const ohmss = manifest.films.find(row => row.filmTitle === "On Her Majesty's Secret Service");
  assert.equal(ohmss.instrumental, true);
  assert.equal(ohmss.themeTitle, "On Her Majesty's Secret Service");
  assert.equal(manifest.bonusTracks.length, 1);
  assert.match(manifest.bonusTracks[0].bonusLabel, /bonus track \(not the main title theme\)/i);
});

test("catalogue matches are canonical, unique and do not invent Spotify IDs", () => {
  const matched = manifest.films.filter(row => row.catalogueTrackId !== null);
  assert.deepEqual(matched.map(row => row.catalogueTrackId), [15562, 19649, 19784]);
  assert.equal(new Set(matched.map(row => row.catalogueTrackId)).size, matched.length);
  assert.equal(new Set(matched.map(row => row.canonicalRecordingId)).size, matched.length);
  assert(matched.every(row => /^[0-9a-f-]{36}$/.test(row.canonicalRecordingId)));
  assert([...manifest.films, ...manifest.bonusTracks].every(row => row.spotifyId === ""));
});

test("feature and launch configuration are disabled and unset by default", () => {
  assert.match(config, /BOM_BOND_FEATURE = Object\.freeze/);
  assert.match(config, /enabled: false/);
  assert.match(config, /nextBondActor: ""/);
  assert.match(config, /officialAnnouncementDate: ""/);
  assert.match(config, /filmTitle: ""/);
  assert.match(config, /themeTitle: ""/);
  assert.match(config, /A new 007 has been announced\. Now rate the music that made Bond legendary\./);
});

function renderDiscover(enabled) {
  const listeners = {};
  const document = { addEventListener(type, handler) { listeners[type] = handler; }, querySelectorAll() { return []; }, getElementById() { return null; } };
  const window = {
    BOM_BOND_FEATURE: { enabled },
    BOMUI: { AlbumCard: () => "", SectionState: ({ title }) => title },
    BOMPresentationBridge: {}, addEventListener() {}, setTimeout() {}, clearTimeout() {},
    history: { state: null, replaceState() {}, pushState() {} }, location: { href: "https://example.test" }
  };
  vm.runInNewContext(discover, { window, document, URL, Math, Date, Intl, Set, Map, matchMedia: () => ({ matches: true }), clearTimeout() {}, setTimeout() {} });
  return window.BOMDiscoverUI.render({ authenticated: true, groups: [], general: [] });
}

test("disabled flag produces no card, while activation inserts it above Quick Rate", () => {
  assert.doesNotMatch(renderDiscover(false), /data-bom-bond-banner/);
  const enabled = renderDiscover(true);
  assert.match(enabled, /007 — THE MUSIC OF BOND/);
  assert(enabled.indexOf("data-bom-bond-banner") < enabled.indexOf("data-bom-discovery-carousel"));
  assert(enabled.indexOf("data-bom-bond-banner") < enabled.indexOf("Quick rate"));
});

test("disabled Discover startup does not load Bond assets or make Bond data calls", () => {
  assert.doesNotMatch(discover, /fetch\("bond-007\.json/);
  assert.match(app, /if \(!isBondFeatureEnabled\(\) \|\| !currentUser\) return false/);
  assert.match(app, /style\.href = "bom-bond\.css\?v=1"/);
  assert.match(app, /script\.src = "bom-bond\.js\?v=1"/);
  assert.equal(/<script[^>]+bom-bond\.js/.test(html), false);
  assert.equal(/<link[^>]+bom-bond\.css/.test(html), false);
});

test("rating flow reuses canonical user-scoped persistence and safe community view", () => {
  assert.match(app, /from\("song_ratings"\)[\s\S]*?\.eq\("user_id", currentUser\.id\)/);
  assert.match(app, /from\("song_rating_charts"\)/);
  assert.match(app, /await saveTrackRating\(id, value\)/);
  assert.match(app, /onConflict: canonicalSongId \? "user_id,canonical_song_id"/);
  assert.match(bond, /data-bond-rate/);
  assert.match(bond, /Saving…/);
  assert.match(bond, /aria-live="polite"/);
});

test("experience provides progress, ranking, unrated and film-year controls", () => {
  for (const pattern of [/of \$\{films\.length\} official themes rated/, /data-bond-filter="unrated"/, /value="ranking">My ranking/, /data-bond-year/, /Community ranking unavailable/]) assert.match(bond, pattern);
  assert.match(bond, /Official Eon films only/);
  assert.match(bond, /bonus tracks are labelled/i);
});

test("launch panel requires confirmed actor and announcement date and never creates a theme", () => {
  assert.match(bond, /if \(!launch\?\.nextBondActor \|\| !launch\?\.officialAnnouncementDate\) return ""/);
  assert.doesNotMatch(bond, /bond26\.(themeTitle|originalPerformer)/);
  assert.match(bond, /officialAnnouncementSource/);
});

test("mobile, keyboard, focus and reduced-motion contracts are present", () => {
  assert.match(css, /@media \(max-width:800px\)/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(foundation, /@media \(max-width:700px\)[\s\S]*?\.bom-007-banner/);
  assert.match(foundation, /prefers-reduced-motion:reduce/);
  assert.match(bond, /<button type="button" data-bond-rate/);
  assert.match(bond, /<label>Order<select/);
  assert.match(bond, /aria-labelledby/);
});

test("publication build includes every lazy Bond asset", () => {
  for (const asset of ["bom-bond.js", "bom-bond.css", "bond-007.json"]) assert.match(build, new RegExp(asset.replace(".", "\\.")));
});
