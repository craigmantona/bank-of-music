import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../supabase/operations/historical-chart-entry-ratings-proposal.sql", import.meta.url), "utf8");

test("provisional ratings are entry-scoped, unique per listener and never canonical", () => {
  assert.match(sql, /unique \(user_id, chart_entry_id\)/i);
  assert.match(sql, /references public\.quick_rate_collection_tracks\(id\)/i);
  assert.doesNotMatch(sql.match(/create table[\s\S]*?\n\);/)?.[0] || "", /canonical_song_id|song_id/);
});

test("writes require authentication and a still-unresolved UK No.1 row", () => {
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(sql, /q\.collection_key = 'uk-number-ones'/);
  assert.match(sql, /q\.song_id is null/);
  assert.match(sql, /q\.canonical_song_id is null/);
  assert.match(sql, /for update/);
  assert.match(sql, /on conflict \(user_id, chart_entry_id\) do update/);
});

test("raw ratings remain private and summaries are fetched in one bounded batch", () => {
  assert.match(sql, /revoke all on table public\.historical_chart_entry_ratings from anon, authenticated/);
  assert.match(sql, /At most 250 chart entries may be requested/);
  assert.match(sql, /community_average numeric/);
  assert.match(sql, /community_rating_count bigint/);
  assert.match(sql, /personal_rating smallint/);
  assert.match(sql, /grant execute on function public\.get_historical_chart_entry_rating_summaries\(bigint\[\]\) to anon, authenticated/);
});

test("proposal is non-mutating and documents guarded reconciliation", () => {
  assert.match(sql, /^-- REVIEW PROPOSAL ONLY/m);
  assert.match(sql, /rollback;/);
  assert.match(sql, /must never overwrite an existing canonical rating/);
});
