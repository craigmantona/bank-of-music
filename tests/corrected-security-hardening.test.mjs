import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20260918124349_corrected_security_hardening.sql", import.meta.url);
const appUrl = new URL("../app.js", import.meta.url);

test("corrected hardening narrows profile writes without changing profile reads", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /revoke insert, update on table public\.profiles from anon, authenticated/i);
  assert.match(sql, /grant insert \(id, handle, birth_year\) on table public\.profiles to authenticated/i);
  assert.match(sql, /grant update \(handle, birth_year\) on table public\.profiles to authenticated/i);
  assert.doesNotMatch(sql, /revoke select on table public\.profiles/i);
});

test("corrected hardening removes anonymous catalogue writes and protects backend tables", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /drop policy if exists "Anyone can insert albums"/i);
  assert.match(sql, /drop policy if exists "Anyone can insert songs"/i);
  assert.match(sql, /revoke insert on table public\.albums from anon/i);
  assert.match(sql, /revoke insert on table public\.songs from anon/i);
  assert.match(sql, /alter table public\.tracked_artists enable row level security/i);
  assert.match(sql, /alter table public\.release_import_runs enable row level security/i);
  assert.match(sql, /grant all on table public\.tracked_artists to service_role/i);
  assert.match(sql, /grant all on table public\.release_import_runs to service_role/i);
});

test("legacy claim remains fenced while the current worker is untouched", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /revoke all on function public\.claim_next_artist_import\(\) from service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.claim_next_artist_import/i);
  assert.doesNotMatch(sql, /catalogue_worker\s*\(/i);
  assert.doesNotMatch(sql, /artist_import_queue/i);
  assert.doesNotMatch(sql, /cron\./i);
});

test("logged-out catalogue auto-save exits before any Supabase write", async () => {
  const app = await readFile(appUrl, "utf8");
  const song = app.slice(app.indexOf("async function autoSaveSelectedSong()"), app.indexOf("async function autoSaveSelectedAlbum()"));
  const album = app.slice(app.indexOf("async function autoSaveSelectedAlbum()"), app.indexOf("async function importSelectedAlbum()"));
  assert.ok(song.indexOf("if (!currentUser) return null;") >= 0);
  assert.ok(album.indexOf("if (!currentUser) return null;") >= 0);
  assert.ok(song.indexOf("if (!currentUser) return null;") < song.indexOf('.from("songs")'));
  assert.ok(album.indexOf("if (!currentUser) return null;") < album.indexOf('.from("albums")'));
});
