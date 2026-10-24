import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BOM_PLAYWRIGHT || "playwright");
const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.goto(`file://${root}/tests/quick-rate-visual-fixture.html`);
  for (const width of [360, 375, 390, 1200]) {
    await page.setViewportSize({ width, height: width === 1200 ? 900 : 844 });
    const layout = await page.evaluate(() => {
      const drawer = document.querySelector(".bom-v1-quick-discovery").getBoundingClientRect();
      const artist = document.querySelector(".bom-v1-quick-discovery button").getBoundingClientRect();
      const listen = document.querySelector(".bom-v1-quick-discovery-listen").getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        drawerLeft: drawer.left,
        drawerRight: drawer.right,
        artistHeight: artist.height,
        listenHeight: listen.height
      };
    });
    assert.equal(layout.overflow, false, `${width}px must not overflow: ${JSON.stringify(layout)}`);
    assert.ok(layout.drawerLeft >= 0 && layout.drawerRight <= width, `${width}px drawer must fit: ${JSON.stringify(layout)}`);
    assert.ok(layout.artistHeight >= 38, `${width}px artist action must be comfortably tappable`);
    assert.ok(layout.listenHeight >= 38, `${width}px Listen action must be comfortably tappable`);
    await page.screenshot({ path: `${tmpdir()}/bom-quick-rate-discovery-${width}.png`, fullPage: true });
  }
  console.log("PASS Quick Rate discovery drawer at 360, 375, 390 and 1200px");
} finally {
  await browser.close();
}
