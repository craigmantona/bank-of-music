import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, app, foundation] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.js", import.meta.url), "utf8")
]);

test("the approved UI is the default while stage1 links remain compatible", () => {
  assert.equal(new URL("http://localhost/").searchParams.get("ui") !== "legacy", true);
  assert.equal(new URL("http://localhost/?ui=stage1").searchParams.get("ui") !== "legacy", true);
  assert.match(html, /get\("ui"\) !== "legacy"/);
  assert.match(app, /get\("ui"\) !== "legacy"/);
});

test("legacy remains available only through the explicit rollback parameter", () => {
  assert.equal(new URL("http://localhost/?ui=legacy").searchParams.get("ui") !== "legacy", false);
  assert.match(foundation, /if \(params\.get\("ui"\) === "legacy"\) return/);
  assert.match(html, /bomStageOneShell/);
});

test("default direct route dispatch remains available for Charts, Ratings and Search", () => {
  assert.match(app, /params\.get\("view"\) === "charts" && window\.BOMChartsUI/);
  assert.match(app, /params\.get\("view"\) === "ratings" && window\.BOMRatingsUI/);
  assert.match(app, /params\.get\("view"\) === "search" && window\.BOMSearchUI/);
  assert.match(app, /shareType === "artist"/);
  assert.match(app, /shareType === "album"/);
});

test("default switch contains no data or catalogue changes", () => {
  assert.doesNotMatch(html + foundation, /artist_import_queue|qualification-v2|catalogue worker|shadow snapshot/i);
});
