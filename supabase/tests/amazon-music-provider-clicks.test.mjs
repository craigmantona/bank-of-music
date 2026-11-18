import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");

const baseline = await readFile(
  new URL("../exports/production_schema.sql", import.meta.url),
  "utf8"
);
const migration = await readFile(
  new URL("../migrations/20261118220000_amazon_music_provider_clicks.sql", import.meta.url),
  "utf8"
);

function extractBaselineTable(name) {
  const start = baseline.indexOf(`CREATE TABLE IF NOT EXISTS "public"."${name}"`);
  assert.notEqual(start, -1);
  return baseline.slice(start, baseline.indexOf("\n);", start) + 3);
}

test("Amazon Music provider clicks are accepted, counted and constrained", async () => {
  const db = new PGlite();
  try {
    await db.exec(extractBaselineTable("music_provider_click_counts"));
    await db.exec(`
      alter table public.music_provider_click_counts
        add primary key (provider, item_type, item_key);
    `);
    await db.exec(migration);

    const first = await db.query(
      "select public.record_music_provider_click($1,$2,$3,$4,$5,$6) total",
      ["amazon_music", "song", "artist|song", "Song", "Artist", "Album"]
    );
    const second = await db.query(
      "select public.record_music_provider_click($1,$2,$3,$4,$5,$6) total",
      ["amazon_music", "song", "artist|song", "Song", "Artist", "Album"]
    );
    assert.equal(Number(first.rows[0].total), 1);
    assert.equal(Number(second.rows[0].total), 2);

    const spotify = await db.query(
      "select public.record_music_provider_click($1,$2,$3,$4,$5,$6) total",
      ["spotify", "album", "artist|album", "Album", "Artist", null]
    );
    assert.equal(Number(spotify.rows[0].total), 1);

    await assert.rejects(
      db.query(
        "select public.record_music_provider_click($1,$2,$3,$4,$5,$6)",
        ["tidal", "song", "artist|song", "Song", "Artist", null]
      ),
      /Unsupported music provider/
    );
  } finally {
    await db.close();
  }
});
