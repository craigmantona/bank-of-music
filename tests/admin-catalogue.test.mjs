import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [app, catalogue, html, styles, edge, migration] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-admin-catalogue.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/admin-catalogue/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260926120000_admin_catalogue_v1.sql", import.meta.url), "utf8")
]);

test("Admin Catalogue is loaded after the application and is admin-rendered", () => {
  assert.ok(html.indexOf("app.js?v=125") < html.indexOf("bom-admin-catalogue.js?v=2"));
  assert.match(catalogue, /if \(!adminDashboard \|\| !host\.canRender\(\)\) return/);
  assert.match(catalogue, /Add Artist &amp; Albums/);
  assert.match(catalogue, /state\.rows\.length < 10/);
});

test("separate browser script initialises through the narrow host and preserves base Admin rendering", () => {
  const listeners = new Map();
  let cataloguePanel = null;
  let baseAdminRenders = 0;
  let installedAdminRender = null;
  const root = {
    addEventListener() {},
    prepend(panel) { cataloguePanel = panel; },
    querySelector(selector) {
      if (selector === "[data-admin-catalogue]") return cataloguePanel;
      return null;
    },
    querySelectorAll() { return []; }
  };
  const document = {
    addEventListener(name, listener) { listeners.set(name, listener); },
    createElement() { return { className: "", dataset: {}, innerHTML: "" }; },
    querySelector() { return cataloguePanel; }
  };
  const host = Object.freeze({
    getRoot: () => root,
    canRender: () => true,
    getExistingAlbums: () => [],
    invoke: async () => ({ data: { ok: true }, error: null }),
    refreshAfterCommit: async () => {},
    openAdmin: () => {},
    installRenderExtension(extension) {
      const baseRender = () => { baseAdminRenders += 1; };
      installedAdminRender = () => { baseRender(); extension(); };
    }
  });
  const window = { BOMAdminCatalogueHost: host };
  vm.runInNewContext(catalogue, { window, document, crypto: webcrypto, console });

  assert.equal(typeof window.BOMAdminCatalogue?.render, "function");
  assert.match(cataloguePanel.innerHTML, /Add Artist &amp; Albums/);
  assert.equal(baseAdminRenders, 0);
  installedAdminRender();
  assert.equal(baseAdminRenders, 1);
  assert.match(cataloguePanel.innerHTML, /Search MusicBrainz/);
  assert.ok(listeners.has("bom:admin-catalogue-host-ready"));
  assert.doesNotMatch(catalogue, /\brenderAdminDashboard\b|\bcurrentUser\b|\bisAdmin\b|\bsupabaseClient\b/);
});

test("application exposes only the dedicated Admin Catalogue integration surface", () => {
  assert.match(app, /window\.BOMAdminCatalogueHost = Object\.freeze\(\{/);
  assert.match(app, /installRenderExtension: \(extension\) => \{[\s\S]*renderBaseAdminDashboard\(\);[\s\S]*extension\(\);/);
  assert.match(app, /dispatchEvent\(new CustomEvent\("bom:admin-catalogue-host-ready"\)\)/);
  assert.doesNotMatch(app, /window\.(?:renderAdminDashboard|supabaseClient|allAlbums|currentUser|isAdmin)\s*=/);
});

test("catalogue commits refresh the Admin Dashboard from authoritative library data without losing results", () => {
  const hostStart = app.indexOf("window.BOMAdminCatalogueHost = Object.freeze({");
  const hostEnd = app.indexOf("document.dispatchEvent(new CustomEvent", hostStart);
  const hostSource = app.slice(hostStart, hostEnd);
  const refreshStart = hostSource.indexOf("refreshAfterCommit: async () => {");
  const refreshEnd = hostSource.indexOf("openAdmin:", refreshStart);
  const refreshSource = hostSource.slice(refreshStart, refreshEnd);
  const commitStart = catalogue.indexOf("async function commitAlbums()");
  const commitEnd = catalogue.indexOf("function bindEvents()", commitStart);
  const commitSource = catalogue.slice(commitStart, commitEnd);

  assert.ok(refreshSource.indexOf("await loadLibrary();") < refreshSource.indexOf("renderAdminDashboard();"));
  assert.match(refreshSource, /renderLibrary\(\);[\s\S]*renderRecommendations\(\);[\s\S]*renderAdminDashboard\(\);/);
  assert.doesNotMatch(refreshSource, /(?:allAlbums|allSongs|allAlbumRatings|allSongRatings)\.(?:push|splice)|\+\+/);
  assert.ok(commitSource.indexOf("state.results = data.results || [];") < commitSource.indexOf("await host.refreshAfterCommit();"));
  assert.match(commitSource, /finally \{[\s\S]*render\(\);[\s\S]*\}/);
});

test("workflow requires explicit artist choice, preview and selected commit", () => {
  assert.match(catalogue, /data-catalogue-choose-artist/);
  assert.match(catalogue, /action: "preview"/);
  assert.match(catalogue, /Nothing has been written/);
  assert.match(catalogue, /row\.selected && previewById\(row\.client_id\)\?\.status === "ready"/);
  assert.match(catalogue, /action: "commit"/);
  assert.match(catalogue, /Already exists/);
  assert.match(catalogue, /Needs correction/);
  assert.match(catalogue, /Failed/);
});

test("ambiguity controls expose release-group and edition choices", () => {
  assert.match(catalogue, /data-catalogue-group-choice/);
  assert.match(catalogue, /data-catalogue-release-choice/);
  assert.match(catalogue, /BOM will not guess/);
});

test("desktop and iPad/mobile layouts are present", () => {
  assert.match(styles, /\.admin-catalogue-row \{ display: grid; grid-template-columns:/);
  assert.match(styles, /@media \(max-width: 780px\)[\s\S]*\.admin-catalogue-row \{ grid-template-columns: 38px minmax\(0, 1fr\)/);
});

test("ordinary member album and song opening exits before catalogue writes", () => {
  const song = app.slice(app.indexOf("async function autoSaveSelectedSong()"), app.indexOf("const albumAutoSaveInFlight"));
  const album = app.slice(app.indexOf("async function autoSaveSelectedAlbum()"), app.indexOf("async function importSelectedAlbum()"));
  assert.ok(song.indexOf("return savedSong || null;") < song.indexOf('.from("songs")'));
  assert.ok(album.indexOf("return existingCatalogueAlbum;") < album.indexOf('.from("albums")'));
  assert.match(app, /Not yet in the BOM catalogue/);
  assert.match(app, /Legacy direct import is intentionally retired[\s\S]*window\.BOMAdminCatalogue\?\.render\(\);[\s\S]*return;/);
});

test("database policy closes direct member writes as defense in depth", () => {
  assert.match(migration, /drop policy if exists "Logged in users can insert albums"/);
  assert.match(migration, /drop policy if exists "Logged in users can insert songs"/);
  assert.match(migration, /drop trigger if exists trg_sync_tracked_artist_from_album/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /profile\.is_admin is true/);
  assert.match(migration, /revoke all on function public\.admin_add_catalogue_album[\s\S]*from anon/);
});

test("Edge Function authorizes before parsing or resolving catalogue requests", () => {
  const auth = edge.indexOf("await requireAdminUser(request)");
  const body = edge.indexOf("const body = await request.json()");
  const resolve = edge.indexOf("const previews = await resolveAll");
  assert.ok(auth >= 0 && auth < body && body < resolve);
  assert.match(edge, /body\?\.action === "preview"/);
  assert.ok(edge.indexOf('body?.action === "preview"') < edge.indexOf('userClient.rpc("admin_add_catalogue_album"'));
});

test("new path does not invoke old importer, queue, discovery or qualification", () => {
  assert.doesNotMatch(edge, /artist-catalog-importer|daily-artist-import|artist_import_queue|discoverCatalogue|qualifyStudioReleaseGroup/);
  assert.doesNotMatch(catalogue, /artist-catalog-importer|daily-artist-import/);
});
