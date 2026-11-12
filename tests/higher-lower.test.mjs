import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");
const [config, app, game, css, foundation, migration, build, html] = await Promise.all([
  read("config.js"), read("app.js"), read("bom-higher-lower.js"), read("bom-higher-lower.css"),
  read("bom-foundation.js"), read("supabase/migrations/20261112145405_bom_higher_lower_pool.sql"),
  read("scripts/build-cloudflare-pages.sh"), read("index.html")
]);

test("feature is disabled by default and its assets remain lazy", () => {
  assert.match(config, /BOM_HIGHER_LOWER_FEATURE = Object\.freeze\([\s\S]*?enabled: false/);
  assert.match(foundation, /BOM_HIGHER_LOWER_FEATURE\?\.enabled === true/);
  assert.equal(/<script[^>]+bom-higher-lower\.js/.test(html), false);
  assert.equal(/<link[^>]+bom-higher-lower\.css/.test(html), false);
  assert.match(app, /style\.href = "bom-higher-lower\.css\?v=1"/);
  assert.match(app, /script\.src = "bom-higher-lower\.js\?v=1"/);
});

test("pool query is bounded, read-only and counts independent raters", () => {
  assert.match(migration, /p_limit integer default 60/);
  assert.match(migration, /p_limit > 100/);
  assert.match(migration, /count\(distinct r\.user_id\)/i);
  assert.match(migration, /rating_count >= p_min_raters/);
  assert.match(migration, /p_min_raters < 3/);
  assert.match(migration, /coalesce\(r\.canonical_song_id::text/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.doesNotMatch(migration, /\b(insert|update|delete)\b/i);
  assert.match(migration, /revoke all on function public\.get_bom_higher_lower_pool[^;]+from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant execute[^;]+get_bom_higher_lower_pool/s);
});

test("game freezes returned snapshots and avoids weak or repeated comparisons", () => {
  assert.match(app, /Object\.freeze\(\(data \|\| \[\]\)\.map\(row => Object\.freeze/);
  assert.match(game, /minimumRatingGap/);
  assert.match(game, /Math\.abs\(a\.rating - b\.rating\) >= minimumGap/);
  assert.match(game, /state\.seen\.has\(key\)/);
  assert.match(game, /state\.seen\.add\(key\)/);
  assert.match(game, /localStorage\.setItem\(bestKey\(\)/);
  assert.match(game, /data-hl-guess="higher"/);
  assert.match(game, /data-hl-guess="lower"/);
  assert.match(game, /independent rater/);
  assert.match(game, /openHigherLowerItem/);
});

test("songs and albums are separate modes with mobile and accessibility support", () => {
  assert.match(game, /data-hl-mode="songs"/);
  assert.match(game, /data-hl-mode="albums"/);
  assert.match(game, /aria-live="polite"/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("publication build contains the lazy game assets", () => {
  assert.match(build, /bom-higher-lower\.js/);
  assert.match(build, /bom-higher-lower\.css/);
});
