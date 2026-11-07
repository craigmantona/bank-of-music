import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("published historical cover allowlist contains only the 58 reviewed chart identities", async () => {
  const [sourceText, publicText] = await Promise.all([
    read("historical-uk-number-ones-cover-art.json"),
    read("public/historical-uk-number-ones-cover-art.json")
  ]);
  assert.equal(publicText, sourceText);
  assert.ok(Buffer.byteLength(publicText) < 25 * 1024);

  const payload = JSON.parse(publicText);
  assert.equal(payload.schemaVersion, 1);
  const entries = Object.entries(payload.entries);
  assert.equal(entries.length, 58);
  assert.equal(new Set(entries.map(([id]) => id)).size, 58);
  assert.equal(new Set(entries.map(([, entry]) => entry.releaseGroupMbid)).size, 56);

  for (const [id, entry] of entries) {
    assert.match(id, /^\d+$/);
    assert.deepEqual(Object.keys(entry).sort(), ["coverUrl", "releaseGroupMbid"]);
    assert.match(entry.releaseGroupMbid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(entry.coverUrl, `https://coverartarchive.org/release-group/${entry.releaseGroupMbid}/front-500`);
  }

  for (const id of [178, 184, 191, 1369, 1403, 1451, 1511, 1909, 486, 504]) {
    assert.equal(payload.entries[id], undefined);
  }
  for (const id of [45, 81, 129, 171]) assert.ok(payload.entries[id]);
});

test("historical artwork is cached once, keyed only by chart ID, and never replaces BOM artwork", async () => {
  const [app, discover, styles, html] = await Promise.all([
    read("app.js"), read("bom-discover.js"), read("bom-foundation.css"), read("index.html")
  ]);

  assert.match(app, /let historicalCoverAllowlistPromise = null/);
  assert.match(app, /if \(!historicalCoverAllowlistPromise\)/);
  assert.match(app, /historical-uk-number-ones-cover-art\.json\?v=1/);
  assert.match(app, /historicalCovers\.get\(Number\(row\.id\)\)/);
  assert.match(app, /artworkForSong\(song\) \|\| historicalCovers\.get/);
  assert.match(app, /historicalCovers\.get\(Number\(entry\.id\)\)/);
  assert.doesNotMatch(app, /historicalCovers\.get\([^)]*(?:title|artist)/);
  assert.match(discover, /item\.artworkUrl\?`<img[^`]+loading="lazy"[^`]+onerror="this\.style\.display='none'/);
  assert.match(styles, /\.bom-v1-historical-placeholder img \{[^}]+object-fit:cover/);
  assert.match(html, /app\.js\?v=161/);
  assert.match(html, /bom-discover\.js\?v=9&history=7/);
  assert.match(html, /bom-foundation\.css\?v=42/);
});
