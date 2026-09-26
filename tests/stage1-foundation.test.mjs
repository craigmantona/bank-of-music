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
  assert.match(html, /app\.js\?v=120/);
  assert.match(shell, /params\.get\("ui"\) === "legacy"/);
});

test("the approved navigation and account destinations are present", () => {
  for (const label of ["Discover", "Charts", "Your Ratings", "Spotify Sync", "Profile", "Log out"]) {
    assert.match(shell, new RegExp(label));
  }
  assert.match(shell, /Search artists, albums and tracks/);
  assert.match(shell, /data-bom-spotify/);
  assert.match(shell, /Connect Spotify/);
  assert.match(shell, /Spotify connected ✓/);
  assert.match(shell, /viewBox="0 0 24 24"/);
});

test("the bridge delegates to existing functions", () => {
  assert.match(app, /showDiscover: \(\) =>/);
  assert.match(app, /showCharts: \(\) => window\.goCharts\(\)/);
  assert.match(app, /showSpotify: \(\) =>/);
  assert.match(app, /connectSpotify: \(\) =>/);
  assert.match(app, /showProfile: \(\) => showUserProfile\(\)/);
  assert.match(app, /logout: \(\) => logOut\(\)/);
  assert.match(app, /return runGlobalSearch\(\)/);
});

test("Spotify connection state is shared with the primary header", () => {
  assert.match(app, /publishSpotifyConnectionState\(true\)/);
  assert.match(app, /publishSpotifyConnectionState\(false\)/);
  assert.match(app, /bom:spotify-connection/);
  assert.match(shell, /bom:spotify-connection/);
  assert.match(styles, /\.bom-v1-spotify-control svg/);
});

test("Spotify connection lives with the account control and leaves mobile navigation clear", () => {
  const navigationStart = shell.indexOf('<nav class="bom-v1-nav"');
  const accountStart = shell.indexOf('<div class="bom-v1-account">');
  const navigation = shell.slice(navigationStart, shell.indexOf("</nav>", navigationStart) + 6);
  const account = shell.slice(accountStart, shell.indexOf("</header>", accountStart));
  assert.doesNotMatch(navigation, /data-bom-spotify/);
  assert.match(account, /data-bom-spotify[\s\S]*bom-v1-account-button/);
  assert.match(styles, /\.bom-v1-account \{[\s\S]*display: flex/);
  assert.match(shell, /bom-v1-spotify-compact[^>]*aria-hidden="true">✓/);
  assert.doesNotMatch(shell, /bom-v1-spotify-compact[^>]*>Connected/);
  assert.match(styles, /\.bom-v1-spotify-control\.is-connected \{ min-height: 42px; padding-inline: 8px/);
  assert.match(styles, /\.bom-v1-nav \{[\s\S]*justify-content: space-between/);
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
