import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [discover, styles] = await Promise.all([
  readFile(new URL("../bom-discover.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);

test("historical cards render one artwork surface and a separate No. 1 badge", () => {
  assert.match(discover, /const historyArt = .*bom-v1-history-art/);
  assert.match(discover, /bom-v1-history-position/);
  assert.match(discover, /historyArt\(item,albums\)/);
  assert.doesNotMatch(discover.match(/function historyCard[\s\S]*?\n  \}/)?.[0] || "", /art\(item,albums\?"LP":"01"\)/);
});

test("failed asynchronous artwork hides the image without revealing a second surface early", () => {
  assert.match(discover, /this\.hidden=true;this\.nextElementSibling\.hidden=false/);
  assert.match(styles, /\.bom-v1-discovery-art-fallback\[hidden\] \{ display:none !important; \}/);
});

test("historical artwork and its mobile size remain scoped to discovery cards", () => {
  assert.match(styles, /\.bom-v1-history-art \{[^}]*width:110px;[^}]*height:110px;/);
  assert.match(styles, /@media\(max-width:700px\)[\s\S]*?\.bom-v1-history-art \{ width:82px; height:82px; \}/);
});
