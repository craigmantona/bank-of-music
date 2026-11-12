import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [app, foundation, preview, daily, extras, scoring, previewSql, futureGrants, build] = await Promise.all([
  read("app.js"), read("bom-foundation.js"), read("bom-game-preview.js"), read("bom-daily-challenge.js"),
  read("bom-game-preview.css"), read("supabase/migrations/20261112145414_bom_daily_challenge.sql"),
  read("supabase/migrations/20261112145422_bom_admin_game_preview.sql"),
  read("supabase/operations/future-public-launch/20261112150000_bom_games_public_permissions.sql"),
  read("scripts/build-cloudflare-pages.sh")
]);

const score = (correct, elapsed) => {
  const accuracy = correct * 90;
  const bonus = Math.max(0, 100 - Math.floor(elapsed / 3));
  return { accuracy, bonus, total: Math.min(1000, accuracy + bonus), percentage: Math.min(100, (accuracy + bonus) / 10) };
};

test("v2 scoring keeps accuracy dominant with bounded percentage", () => {
  assert.deepEqual(score(10, 0), { accuracy:900, bonus:100, total:1000, percentage:100 });
  assert.deepEqual(score(10, 3), { accuracy:900, bonus:99, total:999, percentage:99.9 });
  assert.equal(score(9, 0).total, 910);
  assert.equal(score(0, 0).total, 100);
  assert.equal(score(10, 299).bonus, 1);
  assert.equal(score(10, 300).bonus, 0);
  assert.equal(score(10, 999).percentage, 90);
  assert.equal(875 / 10, 87.5);
  assert.match(scoring, /v_accuracy := v_correct \* 90/);
  assert.match(scoring, /100 - floor\(v_elapsed \/ 3\.0\)/);
  assert.match(scoring, /least\(1000, v_accuracy \+ v_bonus\)/);
  assert.match(scoring, /scoring_version = 2/);
  assert.match(scoring, /total_score desc, correct_answers desc, elapsed_seconds asc/);
});

test("official elapsed time and idempotency are entirely server authoritative", () => {
  assert.match(scoring, /started_at timestamptz not null default clock_timestamp\(\)/);
  assert.match(scoring, /v_completed timestamptz := clock_timestamp\(\)/);
  assert.match(scoring, /extract\(epoch from \(v_completed - a\.started_at\)\)/);
  assert.match(scoring, /for update/);
  assert.match(scoring, /completed_at is not null/);
  assert.match(scoring, /return query select false/);
  assert.doesNotMatch(scoring, /p_elapsed|p_score|p_bonus/);
  assert.match(app, /p_challenge_date: challengeDate/);
});

test("private preview is authorized by the server and simulations never write", () => {
  assert.match(previewSql, /profile\.id = auth\.uid\(\) and profile\.is_admin is true/);
  assert.match(previewSql, /raise exception 'Game preview requires administrator access'/);
  assert.match(previewSql, /revoke all on function public\.get_bom_admin_game_preview_pool[^;]+from public, anon/);
  assert.match(previewSql, /simulated boolean/);
  assert.doesNotMatch(previewSql, /\b(insert|update|delete)\b/i);
  assert.match(preview, /SIMULATED RATINGS — never written to community data/);
  assert.match(preview, /UNOFFICIAL PREVIEW/);
  assert.match(foundation, /state\.isAdmin \? '<button[^']+game-preview/);
  assert.match(app, /get_bom_admin_game_preview_pool/);
});

test("preview rollout denies every official game RPC to application roles", () => {
  for (const signature of [
    "get_bom_daily_challenge\\(text\\)", "get_my_bom_daily_attempt\\(text\\)",
    "start_bom_daily_attempt\\(text, date\\)", "submit_bom_daily_attempt\\(text, date, jsonb\\)",
    "get_bom_game_readiness\\(\\)"
  ]) {
    assert.match(scoring, new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated`));
  }
  assert.doesNotMatch(scoring, /grant execute/);
  assert.match(previewSql, /grant execute on function public\.get_bom_admin_game_preview_pool[^;]+to authenticated/s);
  assert.match(futureGrants, /FUTURE PUBLIC LAUNCH ONLY/);
  assert.match(futureGrants, /grant execute on function public\.get_bom_daily_challenge/);
});

test("preview offers every game, both modes, reset and unlimited local replays", () => {
  for (const value of ["higher-lower", "quickfire", "daily", "songs", "albums"]) assert.match(preview, new RegExp(`value="${value}"`));
  assert.match(preview, /data-preview-reset/);
  assert.match(preview, /state\.seed\+\+/);
  assert.match(preview, /Date\.now\(\)\+60000/);
  assert.doesNotMatch(preview, /submitDailyChallenge|startDailyChallenge/);
});

test("results expose percentage breakdown, tie rules and sharing fallbacks", () => {
  assert.match(daily, /Math\.min\(100,Math\.max\(0,Number\(points\|\|0\)\/10\)\)/);
  assert.match(daily, /90 points per correct answer/);
  assert.match(daily, /Accuracy breaks ties first, then verified shorter time/);
  assert.match(daily, /navigator\.canShare/);
  assert.match(daily, /new File/);
  assert.match(daily, /https:\/\/wa\.me/);
  assert.match(daily, /clipboard\?\.writeText/);
  assert.match(daily, /daily-bom-story\.png/);
  assert.match(daily, /challenge_date/);
});

test("share artwork and mobile preview assets are publishable", async () => {
  for (const path of ["assets/game-share/daily-bom-square.png", "assets/game-share/daily-bom-story.png"]) {
    assert((await stat(new URL(`../${path}`, import.meta.url))).size > 100_000);
    assert.match(build, new RegExp(path.split("/").at(-1).replace(".", "\\.")));
  }
  assert.match(extras, /@media\(max-width:700px\)/);
  assert.match(foundation, /game-preview/);
});
