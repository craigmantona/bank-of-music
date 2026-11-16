import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [discover, publicDiscover, styles, publicStyles] = await Promise.all([
  readFile(new URL("../bom-discover.js", import.meta.url), "utf8"),
  readFile(new URL("../public/bom-discover.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8"),
  readFile(new URL("../public/bom-foundation.css", import.meta.url), "utf8")
]);

function helpers(source = discover) {
  const window = { addEventListener() {} };
  const document = { addEventListener() {} };
  vm.runInNewContext(source, { window, document, Intl, Date, Math, Number, String, Object, Array, Map, Set, Promise, clearTimeout, setTimeout, matchMedia: () => ({ matches: true }) });
  return window.BOMDiscoverHelpers;
}

test("historical UK No. 1 candidates deduplicate normalized song and artist pairs", () => {
  const rows = [
    { id: 1, title: "The Fate of Ophelia", artist: "Taylor Swift" },
    { id: 2, title: " the fate of ophelia ", artist: "TAYLOR SWIFT" },
    { id: 3, title: "Distinct Song", artist: "Another Artist" }
  ];
  assert.deepEqual(Array.from(helpers().distinctNumberOnes(rows), row => row.id), [1, 3]);
  assert.deepEqual(Array.from(helpers(publicDiscover).distinctNumberOnes(rows), row => row.id), [1, 3]);
});

test("homepage rotates the complete historical feature in place every ten seconds", () => {
  for (const source of [discover, publicDiscover]) {
    assert.match(source, /numberOneTimer=setTimeout\(\(\)=>updateFeaturedNumberOne\(root\),10000\)/);
    assert.match(source, /artwork\.innerHTML=artworkStack\(ordered,"01","chart"\)/);
    assert.match(source, /title\.textContent=item\.title/);
    assert.match(source, /copy\.textContent=`\$\{item\.artist\} · \$\{item\.chart_year\}/);
    assert.match(source, /action\.dataset\.bomFeaturedHistoryId=item\.id/);
    assert.match(source, /openHistoricalDetail\(item,\{origin:"feature"\}\)/);
    assert.match(source, /A historical UK chart-topper from this calendar week\./);
  }
});

test("rotation pauses for interaction and stops for reduced motion or hidden pages", () => {
  for (const source of [discover, publicDiscover]) {
    assert.match(source, /root\.addEventListener\("mouseenter",pauseCarousel\)/);
    assert.match(source, /root\.addEventListener\("focusin",pauseCarousel\)/);
    assert.match(source, /root\.addEventListener\("pointerdown",e=>\{x=e\.clientX;pauseCarousel\(\);\}\)/);
    assert.match(source, /document\.hidden\|\|matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
    assert.match(source, /if\(document\.hidden\)pauseCarousel\(\)/);
    assert.doesNotMatch(source.match(/function updateFeaturedNumberOne[\s\S]*?\n  \}/)?.[0] || "", /fetch\(|refreshDiscover|load\(/);
  }
});

test("responsive heading and fade are present on desktop and mobile", () => {
  for (const css of [styles, publicStyles]) {
    assert.match(css, /\.bom-v1-discovery-slide\.is-chart \.bom-v1-discovery-label \{[^}]*font-size:clamp\(16px,1\.8vw,22px\)/);
    assert.match(css, /@media\(max-width:700px\)[\s\S]*?\.bom-v1-discovery-slide\.is-chart \.bom-v1-discovery-label \{[^}]*font-size:16px/);
    assert.match(css, /transition:opacity \.18s ease/);
    assert.match(css, /@media\(prefers-reduced-motion:reduce\)[^{]*\{[^}]*\.bom-v1-number-one-artwork/);
  }
});
