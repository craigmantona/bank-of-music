import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, styles, migration] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260920131829_admin_album_track_listing_editor.sql", import.meta.url), "utf8")
]);

test("Admin albums expose one complete track-listing editor", () => {
  assert.match(app, /admin-edit-track-listing-btn/);
  assert.match(app, /function renderAdminTrackListingEditor/);
  assert.match(app, /Number\(song\.album_id\) === Number\(album\.id\)/);
  assert.match(app, /track_position \|\| 9999/);
  assert.match(app, /Save complete listing/);
});

test("editor submits edits, additions, removals and ordering in one RPC", () => {
  assert.match(app, /data-admin-track-position/);
  assert.match(app, /data-admin-track-title/);
  assert.match(app, /data-admin-track-artist/);
  assert.match(app, /admin-track-listing-add/);
  assert.match(app, /admin-track-listing-remove/);
  assert.match(app, /supabaseClient\.rpc\("admin_update_album_track_listing"/);
});

test("RPC authorizes admins and validates the complete set before mutation", () => {
  assert.match(migration, /v_user_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(migration, /profile\.id = v_user_id[\s\S]*profile\.is_admin = true/);
  assert.match(migration, /raise exception 'Admin access required'.*'42501'/);
  assert.match(migration, /Every existing track must belong to the selected album/);
  assert.match(migration, /Track positions must be unique/);
  assert.match(migration, /Track titles must be unique within an album/);
  assert.ok(migration.indexOf("Every existing track must belong") < migration.indexOf("update public.songs song"));
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on function[\s\S]*from public/);
  assert.match(migration, /where album\.id = p_album_id[\s\S]*for update/);
});

test("removal preserves ratings and external identities", () => {
  assert.match(migration, /set album_id = null,[\s\S]*track_position = null/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.songs/i);
  assert.doesNotMatch(migration, /(?:update|delete\s+from)\s+public\.song_ratings/i);
  assert.doesNotMatch(migration, /set[\s\S]{0,120}external_(?:source|id)\s*=/i);
  assert.match(migration, /'manual',[\s\S]*null,[\s\S]*false/);
});

test("database function remains atomic and returns the final ordered listing", () => {
  assert.match(migration, /language plpgsql/);
  assert.match(migration, /returns setof public\.songs/);
  assert.match(migration, /order by song\.track_position nulls last, song\.id/);
  assert.doesNotMatch(migration, /commit|rollback/i);
});

test("editor has a desktop table and a non-breaking mobile fallback", () => {
  assert.match(styles, /\.admin-track-listing-row \{ display: grid; grid-template-columns: 82px/);
  assert.match(styles, /@media \(max-width: 780px\)[\s\S]*\.admin-track-listing-row \{ grid-template-columns: 68px minmax\(0, 1fr\); \}/);
});

test("Admin add-track album selector does not eagerly render the catalogue", () => {
  const selectorMarkup = app.match(/<select id="adminTrackAlbumSelect">([\s\S]*?)<\/select>/)?.[1] || "";
  assert.match(selectorMarkup, /<option value="">Select album<\/option>/);
  assert.doesNotMatch(selectorMarkup, /allAlbums\.map/);
});

test("Admin album search populates only a small matching result set", () => {
  assert.match(app, /var matchingAlbums = query[\s\S]*?normaliseCompare\(album\.title\)\.includes\(query\)[\s\S]*?normaliseCompare\(album\.artist\)\.includes\(query\)[\s\S]*?\.slice\(0, 24\)[\s\S]*?: \[\]/);
  assert.match(app, /select\.innerHTML = `[\s\S]*?\$\{matchingAlbums[\s\S]*?<option value="\$\{album\.id\}">/);
});
