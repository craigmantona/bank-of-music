import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [html, app, shell, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);

test("the approved shell is default and legacy remains an explicit rollback", () => {
  assert.match(html, /get\("ui"\) !== "legacy"/);
  assert.match(html, /style\.css\?v=\d+[^\"]*/);
  assert.match(html, /bom-foundation\.css\?v=\d+&autocomplete=1/);
  assert.match(html, /config\.js\?v=\d+/);
  assert.match(html, /app\.js\?v=\d+&autocomplete=2&search-autosave=1&listening-ui=6/);
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
  assert.match(app, /showProfile: async \(\) => \{[\s\S]*?await ensureFullCatalogue\(\);[\s\S]*?return showUserProfile\(\);[\s\S]*?\}/);
  assert.match(app, /logout: \(\) => logOut\(\)/);
  assert.match(app, /return runGlobalSearch\(\)/);
});

test("the presentation bridge and Discover helpers initialize outside section navigation", () => {
  const navigationStart = app.indexOf("function showOnlySection(targetId)");
  const bridgeStart = app.indexOf("Stage 1 presentation bridge", navigationStart);
  const helperStart = app.indexOf("async function syncChristmasNumberOnePublicEntry", bridgeStart);
  const discoverRenderStart = app.indexOf("function renderRecommendations()", helperStart);
  const spotifyStateStart = app.indexOf("let spotifyConnectionState = false", discoverRenderStart);
  const readyEventStart = app.indexOf('window.dispatchEvent(new CustomEvent("bom:presentation-ready"))', bridgeStart);
  const initialDiscoverStart = app.lastIndexOf('showOnlySection("recommendationsSection");', readyEventStart);

  assert.ok(navigationStart >= 0 && bridgeStart > navigationStart);
  assert.ok(helperStart > bridgeStart, "the Christmas entry helper should initialize with the bridge");
  assert.ok(discoverRenderStart > helperStart, "Discover should call an in-scope helper");
  assert.ok(readyEventStart > spotifyStateStart, "the bridge must not signal ready while later state is in its temporal dead zone");
  assert.ok(readyEventStart > initialDiscoverStart, "the bridge should signal ready after selecting the initial section");
  assert.match(html, /app\.js\?v=191&autocomplete=2&search-autosave=1&listening-ui=6/);
});

test("the real Stage 1 Discover renderer can call its helper before any navigation", () => {
  const navigationStart = app.indexOf("function showOnlySection(targetId)");
  const profileModalStart = app.indexOf("function createProfileModal()", navigationStart);
  const discoverRenderStart = app.indexOf("function renderRecommendations()", profileModalStart);
  const libraryRenderStart = app.indexOf("function renderLibrary()", discoverRenderStart);
  const updates = [];
  const context = vm.createContext({
    currentUser: null,
    document: { querySelector: () => null },
    isStageOnePresentation: () => true,
    buildStageOneDiscoverModel: () => ({ authenticated: false }),
    recommendationsList: { innerHTML: "" },
    window: {
      BOM_CHRISTMAS_NUMBER_ONE_FEATURE: { enabled: false },
      BOMDiscoverUI: {
        render: () => '<section data-test="discover">Discover</section>',
        updateRowControls: target => updates.push(target)
      },
      requestAnimationFrame: callback => callback()
    }
  });

  vm.runInContext(app.slice(navigationStart, profileModalStart), context);
  vm.runInContext(app.slice(discoverRenderStart, libraryRenderStart), context);

  assert.equal(typeof context.syncChristmasNumberOnePublicEntry, "function");
  assert.ok(context.window.BOMPresentationBridge, "the bridge should exist before showOnlySection is called");
  assert.doesNotThrow(() => context.renderRecommendations());
  assert.match(context.recommendationsList.innerHTML, /data-test="discover"/);
  assert.deepEqual(updates, [context.recommendationsList]);
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
  assert.match(styles, /\.bom-v1-spotify-control\.is-connected \{ min-height: 40px; padding-inline: 7px/);
  assert.match(styles, /\.bom-v1-nav \{[\s\S]*justify-content: space-between/);
});

test("the mobile header keeps its controls within narrow phone widths", () => {
  const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 600px)"));
  assert.match(mobileStyles, /grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(mobileStyles, /\.bom-v1-brand img \{ width: 124px; height: auto; \}/);
  assert.match(mobileStyles, /\.bom-v1-account \{ gap: 6px; \}/);
  assert.match(mobileStyles, /\.bom-v1-spotify-control \{ min-height: 40px; padding-inline: 7px; gap: 5px;/);
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


test("primary navigation uses the editorial active indicator", () => {
  assert.match(styles, /\.bom-v1-nav button::before[\s\S]*width: 24px;[\s\S]*height: 2px;[\s\S]*background: var\(--bom-v1-accent\)/);
  assert.match(styles, /\.bom-v1-nav button\[aria-current="page"\]::before[\s\S]*opacity: 1;[\s\S]*scaleX\(1\)/);
  assert.doesNotMatch(styles, /\.bom-v1-nav button\[aria-current="page"\][^{]*\{[^}]*border-bottom-color/);
  assert.match(styles, /\.bom-v1-nav button \{[\s\S]*min-height: 44px;[\s\S]*color: var\(--bom-v1-muted\)/);
  assert.match(styles, /\.bom-v1-nav button\[aria-current="page"\] \{[\s\S]*color: var\(--bom-v1-text\)/);
  assert.match(styles, /\.bom-v1-nav button \{ flex: 1 1 0; min-width: 0; min-height: 48px;/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*\.bom-v1-nav button::before \{ transition: none; \}/);
});
