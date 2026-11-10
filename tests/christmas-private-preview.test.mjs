import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const preview = readFileSync(new URL("../scripts/christmas-private-preview.mjs", import.meta.url), "utf8");
const config = readFileSync(new URL("../config.js", import.meta.url), "utf8");
const publication = readFileSync(new URL("../scripts/build-cloudflare-pages.sh", import.meta.url), "utf8");

test("private preview is loopback-only and blocks production writes", () => {
  assert.match(preview, /const host = "127\.0\.0\.1"/);
  assert.match(preview, /allowedHosts/);
  assert.match(preview, /method !== "GET" && method !== "HEAD"/);
  assert.match(preview, /Private preview is read-only/);
  assert.match(preview, /Cache-Control": "no-store"/);
});

test("preview transforms are response-only and retain the public date gate", () => {
  assert.match(preview, /function transform\(relativePath, source\)/);
  assert.match(preview, /__BOM_CHRISTMAS_PRIVATE_PREVIEW__/);
  assert.match(preview, /christmasEnabled = \(\) => window\.BOM_CHRISTMAS_FEATURE\?\.enabled === true/);
  assert.match(config, /BOM_CHRISTMAS_FEATURE[\s\S]*?enabled: false/);
  assert.match(config, /timeZone: "Europe\/London"/);
  assert.doesNotMatch(config, /PRIVATE_PREVIEW|preview/i);
});

test("preview ratings are simulated locally before application handlers", () => {
  assert.match(preview, /\[data-christmas-rate\]/);
  assert.match(preview, /stopImmediatePropagation/);
  assert.match(preview, /Preview only · not saved/);
  assert.match(preview, /PRIVATE PREVIEW · READ ONLY/);
});

test("preview banner lazy-loads the real Christmas experience", () => {
  assert.match(preview, /openChristmasPreview/);
  assert.match(preview, /bom-christmas\.css\?v=\d+/);
  assert.match(preview, /bom-christmas\.js\?v=\d+/);
  assert.match(preview, /window\.BOMChristmasUI\?\.open/);
  assert.doesNotMatch(publication, /christmas-private-preview/);
});
