import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [html, app, artist, policySource, migration, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-artist.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-artist-hero.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260917075006_artist_hero_overrides.sql", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);

function loadPolicy() {
  const window = {};
  vm.runInNewContext(policySource, { window, Object, Number, Math });
  return window.BOMArtistHeroPolicy;
}

test("manual hero persistence, replacement and removal short-circuit automatic resolution", async () => {
  const policy = loadPolicy();
  let stored = null;
  let automaticCalls = 0;
  const automatic = async () => { automaticCalls += 1; return { url: "automatic.jpg", provider: "automatic" }; };
  assert.equal((await policy.select(stored, automatic)).url, "automatic.jpg");
  stored = { url: "manual-one.jpg", isManual: true };
  assert.equal((await policy.select(stored, automatic)).url, "manual-one.jpg");
  assert.equal((await policy.select(stored, automatic)).url, "manual-one.jpg");
  stored = { url: "manual-two.jpg", isManual: true };
  assert.equal((await policy.select(stored, automatic)).url, "manual-two.jpg");
  assert.equal(automaticCalls, 1);
  stored = null;
  assert.equal((await policy.select(stored, automatic)).url, "automatic.jpg");
  assert.equal(automaticCalls, 2);
});

test("uploads are validated, immutable and cached for a year", () => {
  const policy = loadPolicy();
  assert.equal(policy.validateFile({ type: "image/jpeg", size: 1024 }), "");
  assert.equal(policy.validateFile({ type: "image/webp", size: 5 * 1024 * 1024 }), "");
  assert.match(policy.validateFile({ type: "image/gif", size: 1024 }), /JPEG, PNG or WebP/);
  assert.match(policy.validateFile({ type: "image/png", size: 5 * 1024 * 1024 + 1 }), /5 MB/);
  assert.match(app, /cacheControl: "31536000"/);
  assert.match(app, /upsert: false/);
  assert.match(app, /randomUUID/);
});

test("only admins receive controls and mutation calls remain guarded", () => {
  assert.match(app, /if \(!currentUser \|\| !isAdmin \|\| selectedItem\?\.type !== "artist"\)/);
  assert.match(app, /heroAdmin: \{ enabled: Boolean\(isAdmin\)/);
  assert.match(artist, /if \(!model\.heroAdmin\?\.enabled\) return ""/);
  assert.match(artist, /data-bom-artist-hero-pick/);
  assert.match(artist, /data-bom-artist-hero-preview/);
  assert.match(artist, /data-bom-artist-hero-save/);
  assert.match(artist, /data-bom-artist-hero-remove/);
});

test("manual Storage URLs are narrowly allowlisted and preserve Artist hero fitting", () => {
  assert.match(artist, /\/storage\/v1\/object\/public\/artist-hero-images\//);
  assert.match(artist, /imageUrl\.hostname === projectUrl\.hostname/);
  assert.match(policySource, /ratio >= 1\.25 && ratio <= 2\.6 \? "cover" : "contain"/);
  assert.match(styles, /\.bom-shell-v1 \.bom-v1-artist-hero-editor/);
});

test("migration provides public reads with admin-only table and object mutation", () => {
  assert.match(migration, /create table public\.artist_hero_overrides/);
  assert.match(migration, /alter table public\.artist_hero_overrides enable row level security/);
  assert.match(migration, /grant select on table public\.artist_hero_overrides to anon, authenticated/);
  assert.match(migration, /profiles\.is_admin is true/g);
  assert.match(migration, /'artist-hero-images'/);
  assert.match(migration, /5242880/);
  assert.match(migration, /array\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  assert.match(migration, /owner_id = \(select auth\.uid\(\)::text\)/);
  assert.doesNotMatch(migration, /qualification|artist_import_queue|catalogue worker|cron/i);
});

test("the policy module loads before the application", () => {
  assert.ok(html.indexOf("bom-artist-hero.js?v=1") < html.indexOf("app.js?v=122"));
});
