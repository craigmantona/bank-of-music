import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [config, app, foundation, quickfire, daily, results, css, migration, build, html] = await Promise.all([
  read("config.js"), read("app.js"), read("bom-foundation.js"), read("bom-quickfire.js"),
  read("bom-daily-challenge.js"), read("bom-daily-results.js"), read("bom-games.css"),
  read("supabase/migrations/20261112145414_bom_daily_challenge.sql"),
  read("scripts/build-cloudflare-pages.sh"), read("index.html")
]);

test("all three game flags are independent and disabled by default", () => {
  for (const name of ["BOM_HIGHER_LOWER_FEATURE", "BOM_QUICKFIRE_FEATURE", "BOM_DAILY_CHALLENGE_FEATURE"]) {
    assert.match(config, new RegExp(`${name} = Object\\.freeze\\([\\s\\S]*?enabled: false`));
  }
  assert.match(foundation, /BOM_QUICKFIRE_FEATURE\?\.enabled === true/);
  assert.match(foundation, /BOM_DAILY_CHALLENGE_FEATURE\?\.enabled === true/);
  assert.doesNotMatch(html, /bom-(quickfire|daily-challenge)\.js/);
  assert.match(app, /loadBOMGameAsset/);
});
test("Quickfire uses a deadline-based sixty-second timer and live scoring", () => {
  assert.match(config, /durationSeconds: 60/);
  assert.match(quickfire, /state\.deadline=Date\.now\(\)\+\(Number\(settings\(\)\.durationSeconds\)\|\|60\)\*1000/);
  assert.match(quickfire, /Math\.ceil\(\(state\.deadline-Date\.now\(\)\)\/1000\)/);
  assert.match(quickfire, /setInterval\(tick,200\)/);
  assert.match(quickfire, /if\(seconds\(\)<=0\)finish\(\)/);
  assert.match(quickfire, /state\.score\+=1/);
  assert.match(quickfire, /state\.streak\+=1/);
  assert.match(quickfire, /Math\.round\(state\.score\/state\.answered\*100\)/);
  assert.match(quickfire, /localStorage\.setItem\(key\(\),String\(state\.best\)\)/);
});

test("Quickfire filters weak comparisons and never repeats a session pair", () => {
  assert.match(quickfire, /Math\.abs\(left\.rating-right\.rating\)>=gap/);
  assert.match(quickfire, /!state\.seen\.has\(id\)/);
  assert.match(quickfire, /state\.seen\.add\(id\)/);
  assert.match(quickfire, /data-qf-rate/);
});

test("daily snapshots use Europe London dates and remain frozen", () => {
  assert.match(migration, /time zone 'Europe\/London'/g);
  assert.match(migration, /primary key \(challenge_date, mode, position\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /where \(select count\(\*\) from selected\) = 10/);
  assert.match(migration, /left_average_rating numeric not null/);
  assert.match(migration, /right_average_rating numeric not null/);
  assert.doesNotMatch(migration, /update public\.bom_daily_challenge_questions/i);
});

test("London calendar semantics cover both DST transitions", () => {
  const londonDate = instant => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(instant));
  assert.equal(londonDate("2026-03-29T00:30:00Z"), "2026-03-29");
  assert.equal(londonDate("2026-03-29T23:30:00Z"), "2026-03-30");
  assert.equal(londonDate("2026-10-25T00:30:00Z"), "2026-10-25");
  assert.equal(londonDate("2026-10-25T23:30:00Z"), "2026-10-25");
});

test("daily attempts are authenticated, unique and scored server-side", () => {
  assert.match(migration, /primary key \(user_id, challenge_date, mode\)/);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /if v_user_id is null then raise exception 'Authentication required'/);
  assert.match(migration, /case when q\.right_average_rating > q\.left_average_rating then 'higher' else 'lower' end/);
  assert.match(migration, /on conflict \(user_id, challenge_date, mode\) do nothing/);
  assert.match(migration, /jsonb_array_length\(p_answers\) <> 10/);
  assert.match(migration, /start_bom_daily_attempt/);
  assert.match(migration, /for update/);
  assert.match(migration, /completed_at is not null/);
});

test("attempt privacy permits no public rankings", () => {
  assert.match(migration, /revoke all on public\.bom_daily_challenge_attempts from public, anon, authenticated/);
  assert.match(migration, /get_my_bom_daily_attempt/);
  assert.doesNotMatch(migration, /create\s+(?:or replace\s+)?view\s+public\..*leaderboard/i);
  assert.doesNotMatch(migration, /grant select on public\.bom_daily_challenge_attempts/i);
});

test("daily guests get practice behaviour and sharing is spoiler-free", () => {
  assert.match(daily, /Guest practice/);
  assert.match(daily, /if\(state\.authenticated\)/);
  assert.match(daily, /submitDailyChallenge/);
  assert.match(results, /data-daily-share/);
  assert.match(results, /Can you beat my score\?/);
  assert.match(results, /outcomes\(input\.outcomes\)/);
  assert.doesNotMatch(results, /left_average_rating.*writeText|right_average_rating.*writeText/);
  assert.match(daily, /state\.questions\.length!==10/);
  assert.match(results, /navigator\.share/);
  assert.match(results, /wa\.me/);
  assert.match(results, /data-daily-copy/);
});

test("readiness and publication include both games without eager loading", () => {
  assert.match(migration, /get_bom_game_readiness/);
  assert.match(migration, /eligible_items bigint, eligible_pairs bigint/);
  for (const asset of ["bom-quickfire.js", "bom-daily-results.js", "bom-daily-challenge.js", "bom-games.css"]) assert.match(build, new RegExp(asset.replace(".", "\\.")));
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
