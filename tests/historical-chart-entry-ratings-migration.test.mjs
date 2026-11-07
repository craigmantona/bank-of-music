import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20261107151647_historical_chart_entry_ratings.sql", import.meta.url), "utf8");
const reconciliation = await readFile(new URL("../supabase/operations/historical-chart-entry-rating-reconciliation-procedure.sql", import.meta.url), "utf8");

test("migration isolates provisional ratings without changing canonical storage", () => {
  assert.match(migration, /create table public\.historical_chart_entry_ratings/);
  assert.match(migration, /unique \(user_id, chart_entry_id\)/i);
  assert.match(migration, /rating between 0 and 10/);
  assert.match(migration, /on conflict on constraint historical_chart_entry_ratings_user_entry_key/);
  assert.doesNotMatch(migration, /(?:update|delete from|alter table) public\.song_ratings/i);
  assert.doesNotMatch(migration, /(?:insert into|update) public\.canonical_recordings/i);
});

test("only unresolved chart entries can receive provisional ratings", () => {
  assert.match(migration, /q\.collection_key = 'uk-number-ones'/);
  assert.match(migration, /q\.match_status = 'unresolved'/);
  assert.match(migration, /q\.song_id is null/);
  assert.match(migration, /for update/);
});

test("raw access is private and public RPCs do not run as definers", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(migration, /revoke all on table .* from anon, authenticated/);
  assert.match(migration, /create or replace function private\.set_historical/);
  assert.match(migration, /create or replace function public\.set_historical[\s\S]*?security invoker/);
  assert.match(migration, /create or replace function public\.get_historical[\s\S]*?security invoker/);
});

test("batched summaries are bounded and expose no user identifier", () => {
  const publicRead = migration.match(/create or replace function public\.get_historical[\s\S]*?\$\$;/)?.[0] || "";
  assert.match(migration, /At most 250 chart entries may be requested/);
  assert.match(publicRead, /community_average numeric/);
  assert.match(publicRead, /community_rating_count bigint/);
  assert.match(publicRead, /personal_rating smallint/);
  assert.doesNotMatch(publicRead, /user_id/);
});

test("future reconciliation preserves canonical precedence and conflicts", () => {
  assert.match(reconciliation, /No canonical row: copy/);
  assert.match(reconciliation, /do not overwrite either value/);
  assert.match(reconciliation, /conflict_manual_review/);
  assert.match(reconciliation, /Retain provisional rows as rollback evidence/);
});
