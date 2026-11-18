import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL(
  "../supabase/migrations/20261118210700_live_search_catalogue_projection.sql",
  import.meta.url
), "utf8");

test("search projection is maintained from catalogue and artist identity writes", () => {
  assert.match(migration, /create table public\.search_catalogue_projection/);
  assert.doesNotMatch(migration, /create materialized view public\.search_catalogue_projection/);
  assert.match(migration, /after insert or delete on public\.albums/);
  assert.match(migration, /after insert or delete on public\.songs/);
  assert.match(migration, /search_catalogue_artist_catalog_change/);
  assert.match(migration, /search_catalogue_artist_cache_change/);
  assert.match(migration, /musicbrainz_artist_cache\.artist_detail->>'name'/);
});

test("artist exact and prefix matches receive explicit ranking priority", () => {
  assert.match(migration, /result_type = 'artist'[\s\S]*normalised_title = input\.query_text then 500/);
  assert.match(migration, /result_type = 'artist'[\s\S]*normalised_title like input\.query_text \|\| '%' then 350/);
  assert.match(migration, /case selected\.result_type when 'artist' then 0 when 'album' then 1 else 2 end/);
});

test("search migration is additive to catalogue data and keeps client writes closed", () => {
  assert.doesNotMatch(migration, /(?:update|delete from) public\.(?:albums|songs|ratings|song_ratings)/i);
  assert.match(migration, /revoke all on table public\.search_catalogue_projection[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /grant select on table public\.search_catalogue_projection[\s\S]*to anon, authenticated, service_role/);
  assert.match(migration, /security invoker[\s\S]*create or replace function public\.search_catalogue|create or replace function public\.search_catalogue[\s\S]*security invoker/);
});
