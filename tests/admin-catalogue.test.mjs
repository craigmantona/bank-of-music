import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [app, catalogue, html, styles, edge, migration, deleteMigration] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-admin-catalogue.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/admin-catalogue/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260926120000_admin_catalogue_v1.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260927160832_admin_catalogue_delete_album.sql", import.meta.url), "utf8")
]);

test("Admin Catalogue is loaded after the application and is admin-rendered", () => {
  assert.ok(html.indexOf("app.js?v=130") < html.indexOf("bom-admin-catalogue.js?v=5"));
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

test("album deletion previews dependencies, confirms explicitly and refreshes authoritative admin counts", () => {
  assert.match(catalogue, /data-catalogue-delete-album=/);
  assert.match(catalogue, /action: "delete_album_preview"/);
  assert.match(catalogue, /Tracks: \$\{preview\.track_count\}/);
  assert.match(catalogue, /Album ratings: \$\{preview\.album_rating_count\}/);
  assert.match(catalogue, /Album reviews: \$\{preview\.album_review_count\}/);
  assert.match(catalogue, /Track ratings: \$\{preview\.track_rating_count\}/);
  assert.match(catalogue, /global\.confirm/);
  const deleteStart = catalogue.indexOf("async function deleteAlbum(albumId)");
  const deleteEnd = catalogue.indexOf("function resetArtist()", deleteStart);
  const source = catalogue.slice(deleteStart, deleteEnd);
  assert.ok(source.indexOf('action: "delete_album"') < source.indexOf("await host.refreshAfterCommit();"));
  assert.doesNotMatch(source, /\.from\(|\.delete\(|is_deleted\s*=/);
  assert.match(app, /getExistingAlbums:[\s\S]*!album\.is_deleted/);
});

test("Please Please Me album card exposes and routes the existing release-date workflow", async () => {
  let panel = null;
  let clickHandler = null;
  let refreshes = 0;
  const calls = [];
  const root = {
    addEventListener(name, handler) { if (name === "click") clickHandler = handler; },
    prepend(value) { panel = value; },
    querySelector(selector) { return selector === "[data-admin-catalogue]" ? panel : null; },
    querySelectorAll() { return []; }
  };
  const document = { addEventListener() {}, createElement() { return { className: "", dataset: {}, innerHTML: "" }; }, querySelector() { return panel; } };
  const album = { id: 27, artist: "The Beatles", title: "Please Please Me", original_release_date: "1987-02-26", release_date: "1987-02-26", canonical_release_date: "1987-02-26" };
  const host = Object.freeze({
    getRoot: () => root, canRender: () => true, getExistingAlbums: () => [album],
    invoke: async body => { calls.push(body); return { data: { ok: true, album: { ...album, original_release_date: body.original_release_date } }, error: null }; },
    refreshAfterCommit: async () => { refreshes += 1; }, openAdmin() {}, installRenderExtension() {}
  });
  let promptMessage = "";
  const window = { BOMAdminCatalogueHost: host, prompt: message => { promptMessage = message; return "1963-03-22"; }, confirm: () => true };
  vm.runInNewContext(catalogue, { window, document, crypto: webcrypto, console });
  window.BOMAdminCatalogue.state.artist = { name: "The Beatles" };
  window.BOMAdminCatalogue.render();
  assert.match(app, /admin-edit-release-date-btn[\s\S]*Edit release date/);
  assert.match(app, /window\.BOMAdminCatalogue\?\.editAlbumDate\(album\)/);
  await window.BOMAdminCatalogue.editAlbumDate(album);
  assert.match(promptMessage, /The Beatles — Please Please Me[\s\S]*Current: 1987-02-26/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ action: "edit_album_date", album_id: 27, original_release_date: "1963-03-22" }]);
  assert.equal(refreshes, 1);
  assert.match(panel.innerHTML, /now uses 1963-03-22 for chronology/);
});

test("album date Edge action validates a full real ISO date and updates only original_release_date", () => {
  assert.match(edge, /body\?\.action === "edit_album_date"/);
  assert.match(edge, /validFullIsoDate\(originalReleaseDate\)/);
  assert.match(edge, /parsed\.toISOString\(\)\.slice\(0, 10\) === date/);
  const start = edge.indexOf('body?.action === "edit_album_date"');
  const end = edge.indexOf('body?.action === "delete_album_preview"', start);
  const source = edge.slice(start, end);
  assert.match(source, /\.update\(\{ original_release_date: originalReleaseDate \}\)/);
  assert.doesNotMatch(source, /canonical_release_date|canonical_release_country|musicbrainz_release|external_id|(?<!original_)release_date:/);
  assert.ok(edge.indexOf("await requireAdminUser(request)") < start);
});

test("chronology and material album cards prefer original date with historical fallback", () => {
  assert.match(app, /savedAlbum\?\.original_release_date \|\|[\s\S]{0,80}savedAlbum\?\.release_date/);
  assert.match(app, /savedAlbum\.original_release_date \|\|[\s\S]{0,80}savedAlbum\.release_date/);
  assert.match(app, /year: String\(album\?\.original_release_date \|\| album\?\.release_date \|\| ""\)/);
  assert.match(app, /year: String\(album\.original_release_date \|\| album\.release_date \|\| ""\)/);
  assert.match(app, /releaseDate: album\.original_release_date \|\| album\.release_date \|\| ""/);
  assert.match(app, /immediatelySavedAlbum\.original_release_date \|\|[\s\S]{0,80}immediatelySavedAlbum\.release_date/);
});

test("successful album deletion refreshes counts through the normal authoritative host", async () => {
  let panel = null;
  let clickHandler = null;
  let refreshes = 0;
  const calls = [];
  const root = {
    addEventListener(name, handler) { if (name === "click") clickHandler = handler; },
    prepend(value) { panel = value; },
    querySelector(selector) { return selector === "[data-admin-catalogue]" ? panel : null; },
    querySelectorAll() { return []; }
  };
  const document = {
    addEventListener() {},
    createElement() { return { className: "", dataset: {}, innerHTML: "" }; },
    querySelector() { return panel; }
  };
  const deletion = {
    album_id: 27, artist: "The Example", title: "Delete Me", track_count: 2,
    album_rating_count: 0, album_review_count: 0, track_rating_count: 0,
    deletion_mode: "delete", status: "deleted"
  };
  const host = Object.freeze({
    getRoot: () => root,
    canRender: () => true,
    getExistingAlbums: () => [{ id: 27, artist: "The Example", title: "Delete Me" }],
    invoke: async body => { calls.push(body); return { data: { ok: true, deletion }, error: null }; },
    refreshAfterCommit: async () => { refreshes += 1; },
    openAdmin() {},
    installRenderExtension() {}
  });
  const window = { BOMAdminCatalogueHost: host, confirm: () => true };
  vm.runInNewContext(catalogue, { window, document, crypto: webcrypto, console });
  window.BOMAdminCatalogue.state.artist = { name: "The Example" };
  window.BOMAdminCatalogue.render();
  const button = { dataset: { catalogueDeleteAlbum: "27" } };
  await clickHandler({ target: { closest: selector => selector === "[data-catalogue-delete-album]" ? button : null } });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { action: "delete_album_preview", album_id: 27 },
    { action: "delete_album", album_id: 27 }
  ]);
  assert.equal(refreshes, 1);
  assert.match(panel.innerHTML, /was permanently deleted/);
});

test("album deletion is routed through the authenticated transactional RPC", () => {
  assert.match(edge, /body\?\.action === "delete_album_preview" \|\| body\?\.action === "delete_album"/);
  assert.match(edge, /userClient\.rpc\("admin_catalogue_delete_album"/);
  assert.match(edge, /p_execute: body\.action === "delete_album"/);
  assert.match(deleteMigration, /security invoker/);
  assert.match(deleteMigration, /where id = p_album_id[\s\S]*for update/);
  assert.match(deleteMigration, /delete from public\.songs[\s\S]*where album_id = p_album_id/);
  assert.match(deleteMigration, /update public\.songs[\s\S]*set is_deleted = true[\s\S]*where album_id = p_album_id/);
  assert.match(deleteMigration, /revoke all on function public\.admin_catalogue_delete_album[\s\S]*from anon/);
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

test("ordinary member creation uses only the narrow server path", () => {
  const song = app.slice(app.indexOf("async function autoSaveSelectedSong()"), app.indexOf("const albumAutoSaveInFlight"));
  const album = app.slice(app.indexOf("async function autoSaveSelectedAlbum()"), app.indexOf("async function importSelectedAlbum()"));
  assert.ok(song.indexOf("return savedSong || null;") < song.indexOf('.from("songs")'));
  const activeAlbum = album.slice(0, album.indexOf("const key ="));
  assert.match(activeAlbum, /functions\.invoke\("remote-album-catalogue"/);
  assert.doesNotMatch(activeAlbum, /\.from\(["'](?:albums|songs)["']\)/);
  assert.match(app, /This album needs catalogue confirmation before ratings can be saved/);
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
