import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, edge, migration, adminEdge, deleteMigration, exclusionMigration, occurrenceTests, quickRateTests] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/remote-album-catalogue/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260928103000_authenticated_remote_album_creation.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/admin-catalogue/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260927160832_admin_catalogue_delete_album.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260929092636_catalogue_release_group_exclusions.sql", import.meta.url), "utf8"),
  readFile(new URL("./song-occurrence-identity.test.mjs", import.meta.url), "utf8"),
  readFile(new URL("./quick-rate.test.mjs", import.meta.url), "utf8")
]);

const saveSource = app.slice(app.indexOf("const albumAutoSaveInFlight"), app.indexOf("async function importSelectedAlbum"));
const albumRender = app.slice(app.indexOf("async function renderSelectedItem"), app.indexOf("function getSavedAlbumByTitleArtist"));

test("ordinary users receive only an exact-release server-side catalogue operation", () => {
  assert.match(edge, /requireAuthenticatedUser\(request\)/);
  assert.ok(edge.indexOf("requireAuthenticatedUser(request)") < edge.indexOf("await request.json()"));
  assert.match(edge, /release_id/);
  assert.match(edge, /release_group_id/);
  assert.doesNotMatch(edge, /requireAdminUser|delete_album|search_artist/);
  assert.doesNotMatch(edge, /\.from\(["'](?:albums|songs)["']\)\.(?:insert|upsert|update|delete)/);
  assert.match(edge, /resolveRequestedAlbum/);
  assert.match(edge, /service\.rpc\("admin_add_catalogue_album"/);
});

test("server derives artist, title, group and complete tracks from MusicBrainz", () => {
  assert.match(edge, /\/release\/\$\{encodeURIComponent\(releaseId\)\}\?inc=recordings\+artist-credits\+release-groups/);
  assert.match(edge, /artistFromRelease\(exactRelease\)/);
  assert.match(edge, /expectedGroupId && expectedGroupId !== groupId/);
  assert.match(edge, /request: \{ title, release_group_id: groupId, release_id: releaseId \}/);
  assert.match(edge, /preview\.status !== "ready"/);
});

test("excluded release groups are rejected before catalogue resolution while unrelated releases retain the normal path", () => {
  assert.match(edge, /async function isReleaseGroupExcluded/);
  assert.match(edge, /\.from\("catalogue_release_group_exclusions"\)/);
  assert.match(edge, /reason: "release_group_excluded_by_administrator"/);
  const earlyCheck = edge.indexOf("await isReleaseGroupExcluded(expectedGroupId)");
  const musicBrainzLookup = edge.indexOf("const exactRelease = await musicBrainzGet", earlyCheck);
  assert.ok(earlyCheck >= 0 && musicBrainzLookup > earlyCheck);
  const confirmedCheck = edge.indexOf("await isReleaseGroupExcluded(groupId)");
  const resolution = edge.indexOf("await resolveRequestedAlbum", confirmedCheck);
  assert.ok(confirmedCheck >= 0 && resolution > confirmedCheck);
  assert.match(edge.slice(resolution), /service\.rpc\("admin_add_catalogue_album"/);
  assert.match(exclusionMigration, /catalogue_release_group_exclusions/);
});

test("album opening renders remote content before background creation and then rerenders", () => {
  const trigger = albumRender.indexOf("void autoSaveSelectedAlbum().then");
  const render = albumRender.indexOf("await renderStageOneAlbum(buildStageOneAlbumModel", trigger);
  assert.ok(trigger >= 0 && render > trigger);
  assert.match(albumRender, /catalogueAutoAddStarted/);
  assert.match(albumRender, /window\.setTimeout\(\(\) => \{ void renderSelectedItem\(\); \}, 0\)/);
  assert.match(app, /This album needs catalogue confirmation before ratings can be saved\./);
});

test("only a deliberate album detail render triggers automatic creation", () => {
  assert.equal((app.match(/autoSaveSelectedAlbum\(\)/g) || []).length, 2);
  assert.doesNotMatch(app.slice(app.indexOf("async function renderArtistDetail"), app.indexOf("async function renderSelectedItem")), /autoSaveSelectedAlbum/);
  assert.doesNotMatch(app.slice(app.indexOf("async function runGlobalSearch"), app.indexOf("function buildStageOneSearchModel")), /autoSaveSelectedAlbum/);
  assert.doesNotMatch(app.slice(app.indexOf("function renderRecommendations"), app.indexOf("async function renderSelectedItem")), /autoSaveSelectedAlbum/);
});

test("client performs no direct catalogue writes and coalesces concurrent release requests", () => {
  const activeSource = saveSource.slice(0, saveSource.indexOf("const key ="));
  assert.match(activeSource, /albumAutoSaveInFlight\.has\(requestKey\)/);
  assert.match(activeSource, /functions\.invoke\("remote-album-catalogue"/);
  assert.doesNotMatch(activeSource, /\.from\(["'](?:albums|songs)["']\)/);
});

test("atomic writer remains idempotent and occurrence-safe for shared recordings", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /musicbrainz_release_group_id = v_group_id/);
  assert.match(migration, /insert into public\.songs[\s\S]*album_id, track_position/);
  assert.doesNotMatch(migration, /recording_already_belongs_to_another_catalogue_row/);
  assert.match(occurrenceTests, /catalogue occurrences remain separate while user ratings may follow confirmed recordings/);
  assert.match(quickRateTests, /track rating follows an exact confirmed MusicBrainz recording across album occurrences/);
  assert.match(quickRateTests, /getYourSongRating\(202\), null/);
});

test("ordinary authenticated callers still cannot use arbitrary admin writes", () => {
  assert.match(migration, /v_is_service_role boolean := current_user = 'service_role'/);
  assert.match(migration, /if not v_is_service_role and[\s\S]*profile\.is_admin is true/);
  assert.match(migration, /revoke all on function public\.admin_add_catalogue_album[\s\S]*from anon/);
  assert.match(migration, /grant execute on function public\.admin_add_catalogue_album[\s\S]*to authenticated/);
  assert.match(migration, /grant execute on function public\.admin_add_catalogue_album[\s\S]*to service_role/);
  assert.match(adminEdge, /requireAdminUser\(request\)/);
});

test("existing Admin Catalogue and deletion architecture are unchanged", () => {
  assert.match(adminEdge, /body\?\.action === "preview"/);
  assert.match(adminEdge, /body\?\.action !== "commit"/);
  assert.match(deleteMigration, /admin_catalogue_delete_album/);
  assert.doesNotMatch(edge, /admin_catalogue_delete_album/);
});
