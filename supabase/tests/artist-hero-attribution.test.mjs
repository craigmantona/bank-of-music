import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../migrations/20261025135640_add_artist_hero_attribution.sql", import.meta.url), "utf8");

async function database() {
  const db = new PGlite();
  await db.exec(`create table artist_hero_overrides (
    artist_key text primary key,
    artist_name text not null,
    storage_path text not null unique
  );
  insert into artist_hero_overrides values ('existing', 'Existing Artist', 'existing/hero.webp');`);
  await db.exec(migration);
  return db;
}

test("attribution migration is additive and preserves existing NULL-attribution rows", async () => {
  const db = await database();
  const row = (await db.query("select * from artist_hero_overrides where artist_key='existing'")).rows[0];
  for (const field of ["image_credit", "image_source_url", "image_license_name", "image_license_url", "image_modification_note"]) {
    assert.equal(row[field], null);
  }
  await db.close();
});

test("the four core fields are all present and nonblank or all NULL", async () => {
  const db = await database();
  await db.exec(`insert into artist_hero_overrides values
    ('licensed','Licensed Artist','licensed/hero.webp','Creator','https://example.com/image','CC BY 4.0','https://creativecommons.org/licenses/by/4.0','Resized');`);
  for (const values of [
    "'Creator',null,'CC BY 4.0','https://creativecommons.org/licenses/by/4.0'",
    "'   ','https://example.com/image','CC BY 4.0','https://creativecommons.org/licenses/by/4.0'",
    "'Creator','   ','CC BY 4.0','https://creativecommons.org/licenses/by/4.0'",
    "'Creator','https://example.com/image',' ','https://creativecommons.org/licenses/by/4.0'",
    "'Creator','https://example.com/image','CC BY 4.0','   '"
  ]) {
    await assert.rejects(db.exec(`insert into artist_hero_overrides
      (artist_key,artist_name,storage_path,image_credit,image_source_url,image_license_name,image_license_url)
      values ('bad-${Math.random()}','Bad','bad/${Math.random()}',${values})`));
  }
  await db.close();
});

test("migration changes no RLS policy or grant", () => {
  assert.doesNotMatch(migration, /create policy|drop policy|grant |revoke |row level security/i);
});
