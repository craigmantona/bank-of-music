import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, app, shell, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);

test("the approved shell is default and legacy remains an explicit rollback", () => {
  assert.match(html, /get\("ui"\) !== "legacy"/);
  assert.match(html, /style\.css\?v=80/);
  assert.match(html, /app\.js\?v=119/);
  assert.match(shell, /params\.get\("ui"\) === "legacy"/);
});

test("the approved navigation and account destinations are present", () => {
  for (const label of ["Discover", "Charts", "Your Ratings", "Spotify Sync", "Profile", "Log out"]) {
    assert.match(shell, new RegExp(label));
  }
  assert.match(shell, /Search artists, albums and tracks/);
});

test("the bridge delegates to existing functions", () => {
  assert.match(app, /showDiscover: \(\) =>/);
  assert.match(app, /showCharts: \(\) => window\.goCharts\(\)/);
  assert.match(app, /showSpotify: \(\) =>/);
  assert.match(app, /showProfile: \(\) => showUserProfile\(\)/);
  assert.match(app, /logout: \(\) => logOut\(\)/);
  assert.match(app, /return runGlobalSearch\(\)/);
});

test("the new presentation is namespaced and contains no data access", () => {
  assert.match(styles, /\.bom-shell-v1 \.bom-v1-shell/);
  assert.doesNotMatch(styles, /(^|\n)\s*(\.card|\.top-nav|\.detail-panel)\s*[{,]/);
  assert.doesNotMatch(shell, /supabaseClient|\.rpc\(|\bfetch\(/i);
  assert.doesNotMatch(shell, /artist_import_queue|qualification|shadow/i);
});

test("foundation primitives are exported for later stages", () => {
  for (const primitive of ["Artwork", "CommunityRating", "PersonalRating", "Skeleton", "SectionState", "SectionHeading", "SegmentedControl"]) {
    assert.match(shell, new RegExp(`${primitive}\\(`));
  }
  assert.match(shell, /bom-v1-menu/);
});

test("responsive, focus and reduced-motion foundations exist", () => {
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(max-width: 980px\)/);
  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});
