import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8")
]);

test("the shared site footer includes the Bank of Music copyright notice", () => {
  assert.match(html, /<footer class="bom-site-footer">\s*© 2026 Bank of Music\. All rights reserved\.\s*<\/footer>/);
});

test("the copyright notice stays small, centred and visually subtle", () => {
  const rule = styles.match(/\.bom-site-footer\s*\{([^}]+)\}/)?.[1] || "";
  assert.match(rule, /color:\s*#8b909a;/);
  assert.match(rule, /font-size:\s*10px;/);
  assert.match(rule, /text-align:\s*center;/);
  assert.match(rule, /padding:\s*4px 16px;/);
  assert.match(rule, /background:\s*transparent;/);
  assert.match(rule, /border:\s*0;/);
});
