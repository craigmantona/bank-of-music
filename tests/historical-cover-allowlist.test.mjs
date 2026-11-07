import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("published historical cover allowlist contains only the 354 reviewed chart identities", async () => {
  const [sourceText, publicText] = await Promise.all([
    read("historical-uk-number-ones-cover-art.json"),
    read("public/historical-uk-number-ones-cover-art.json")
  ]);
  assert.equal(publicText, sourceText);
  assert.ok(Buffer.byteLength(publicText) < 128 * 1024);

  const payload = JSON.parse(publicText);
  assert.equal(payload.schemaVersion, 1);
  const entries = Object.entries(payload.entries);
  assert.equal(entries.length, 354);
  assert.equal(new Set(entries.map(([id]) => id)).size, 354);
  assert.equal(new Set(entries.map(([, entry]) => entry.releaseGroupMbid)).size, 350);

  for (const [id, entry] of entries) {
    assert.match(id, /^\d+$/);
    assert.deepEqual(Object.keys(entry).sort(), ["coverUrl", "releaseGroupMbid"]);
    assert.match(entry.releaseGroupMbid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.match(entry.coverUrl, /^https:\/\/coverartarchive\.org\/(?:release-group\/[0-9a-f-]{36}\/front-500|release\/[0-9a-f-]{36}\/(?:front-500|\d+-500\.jpg))$/);
  }

  for (const id of [486, 1403, 1451, 2497]) {
    assert.equal(payload.entries[id], undefined);
  }
  for (const id of [4, 8, 35, 45, 76, 81, 129, 141, 171, 178, 184, 191, 396, 432, 492, 504, 720, 1001, 1338, 1369, 1400, 1511, 1808, 1899, 1909, 2264, 2439, 2440]) {
    assert.ok(payload.entries[id]);
  }
});

test("historical artwork is cached once, keyed only by chart ID, and never replaces BOM artwork", async () => {
  const [app, discover, styles, html] = await Promise.all([
    read("app.js"), read("bom-discover.js"), read("bom-foundation.css"), read("index.html")
  ]);

  assert.match(app, /let historicalCoverAllowlistPromise = null/);
  assert.match(app, /if \(!historicalCoverAllowlistPromise\)/);
  assert.match(app, /historical-uk-number-ones-cover-art\.json\?v=4/);
  assert.match(app, /historicalCovers\.get\(Number\(row\.id\)\)/);
  assert.match(app, /artworkForSong\(song\) \|\| historicalCovers\.get/);
  assert.match(app, /historicalCovers\.get\(Number\(entry\.id\)\)/);
  assert.doesNotMatch(app, /historicalCovers\.get\([^)]*(?:title|artist)/);
  assert.match(discover, /item\.artworkUrl\?`<img[^`]+loading="lazy"[^`]+onerror="this\.style\.display='none'/);
  assert.match(discover, /class="bom-v1-album-artwork"[^>]+loading="lazy"/);
  assert.match(styles, /\.bom-v1-album-artwork \{[^}]+object-fit: cover/);
  assert.match(html, /app\.js\?v=164/);
  assert.match(html, /bom-discover\.js\?v=11&history=9/);
  assert.match(html, /bom-foundation\.css\?v=44/);
});
