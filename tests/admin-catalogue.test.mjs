import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, catalogue, html, styles, edge, migration] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-admin-catalogue.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/admin-catalogue/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260926120000_admin_catalogue_v1.sql", import.meta.url), "utf8")
]);

test("Admin Catalogue is loaded after the application and is admin-rendered", () => {
  assert.ok(html.indexOf("app.js?v=123") < html.indexOf("bom-admin-catalogue.js?v=1"));
  assert.match(catalogue, /if \(!adminDashboard \|\| !currentUser \|\| !isAdmin\) return/);
  assert.match(catalogue, /Add Artist &amp; Albums/);
  assert.match(catalogue, /state\.rows\.length < 10/);
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
