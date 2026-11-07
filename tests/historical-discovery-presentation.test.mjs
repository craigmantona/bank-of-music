import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, discover, styles] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-discover.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);

test("historical songs distinguish canonical community ratings from personal ratings", () => {
  assert.match(discover, /communityRatingCount/);
  assert.match(discover, /communityAverage/);
  assert.match(discover, /community rating/);
  assert.match(discover, /No community ratings yet/);
  assert.match(discover, /Your rating/);
  assert.match(styles, /\.bom-v1-history-ratings \.bom-v1-history-community/);
  const mapping = app.match(/numberOnes: resolvedRows\.map[\s\S]*?\n      \}\)/)?.[0] || "";
  assert.match(mapping, /getSongAverage\(song\.id\)/);
  assert.doesNotMatch(mapping, /supabaseClient|fetch\(/);
});

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

test("every historical chart card has an accessible destination", () => {
  const card = discover.match(/function historyCard[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(card, /tabindex=\"0\" role=\"link\"/);
  assert.match(card, /data-history-id/);
  assert.match(discover, /openHistoricalDetail\(item\)/);
  assert.match(app, /openHistoricalDetail\?\.\(entry,\{origin:\"quick-rate\"\}\)/);
  assert.match(discover, /Recording not yet verified/);
});

test("unresolved historical details are non-rateable and use cached chart facts", () => {
  const detail = discover.match(/function historicalDetail[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(detail, /weeks_at_number_one/);
  assert.match(detail, /number_one_runs/);
  assert.match(detail, /first_number_one_date/);
  assert.match(detail, /community ratings and personal rating controls will appear only after/);
  assert.doesNotMatch(detail, /Rate this|data-rating|supabaseClient|MusicBrainz/);
});

test("historical detail navigation resets once and restores the listing on back", () => {
  const reset = discover.match(/function resetHistoricalDetailScroll[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(reset, /document\.scrollingElement\|\|document\.documentElement/);
  assert.match(reset, /scroller\.scrollTop=0/);
  assert.doesNotMatch(reset, /setTimeout|requestAnimationFrame/);
  assert.match(discover, /bomHistoricalList:true/);
  assert.match(discover, /window\.addEventListener\(\"popstate\"/);
});
