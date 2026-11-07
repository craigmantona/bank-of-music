import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, discover, styles, html] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-discover.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8")
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

test("historical discovery batches complete canonical rating rows before deriving the personal rating", () => {
  const loading = app.match(/const \[occurrenceRatingResult, canonicalRatingResult\][\s\S]*?const ratingByCanonicalId[^;]+;/)?.[0] || "";
  assert.match(loading, /select\("user_id,song_id,canonical_song_id,rating"\)/);
  assert.match(loading, /historicalCanonicalRatings = mergeRatingRows/);
  assert.match(loading, /allSongRatings = mergeRatingRows/);
  assert.match(loading, /rating\.user_id === currentUser\.id/);
  assert.doesNotMatch(loading, /\.eq\("user_id", currentUser\.id\)/);
});

test("historical cards render one artwork surface and a separate No. 1 badge", () => {
  assert.match(discover, /const historyArt = .*bom-v1-history-art/);
  assert.match(discover, /bom-v1-history-position/);
  assert.match(discover, /historyArt\(item,albums\)/);
  assert.doesNotMatch(discover.match(/function historyCard[\s\S]*?\n  \}/)?.[0] || "", /art\(item,albums\?"LP":"01"\)/);
});

test("failed asynchronous artwork hides the image without revealing a second surface early", () => {
  assert.match(discover, /this\.style\.display='none';this\.nextElementSibling\.hidden=false/);
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
  assert.match(discover, /recording not yet verified/);
});

test("unresolved historical details use chart-entry ratings and cached chart facts", () => {
  const detail = discover.match(/function historicalDetail[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(detail, /weeks_at_number_one/);
  assert.match(detail, /number_one_runs/);
  assert.match(detail, /first_number_one_date/);
  assert.match(detail, /historicalRatingPanel\(item\)/);
  assert.match(detail, /bom-v1-historical-copy/);
  assert.doesNotMatch(detail, /bom-v1-historical-unverified/);
  assert.doesNotMatch(detail, /supabaseClient|MusicBrainz/);
});

test("historical-only details use the compact responsive hero and rating layout", () => {
  const detail = discover.match(/function historicalDetail[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(detail, /bom-v1-album bom-v1-track-detail bom-v1-historical-detail/);
  assert.match(detail, /bom-v1-album-hero bom-v1-track-detail-hero bom-v1-historical-hero/);
  assert.match(detail, /bom-v1-album-artwork-missing/);
  assert.match(discover, /bom-v1-album-ratings bom-v1-historical-rating-panel/);
  assert.match(styles, /#recommendationsSection:has\(\.bom-v1-historical-detail\)[^{]*\{[^}]+background: transparent/);
  assert.match(styles, /@media\(max-width:700px\)[\s\S]+\.bom-v1-historical-rating-choices button \{ min-height:44px/);
  assert.doesNotMatch(styles, /\.bom-v1-historical-unverified/);
});

test("provisional ratings use bridge RPCs, preserve zero and remain separately labelled", () => {
  assert.match(app, /rpc\("get_historical_chart_entry_rating_summaries"/);
  assert.match(app, /rpc\("set_historical_chart_entry_rating"/);
  assert.match(app, /personal_rating === null \|\| row\?\.personal_rating === undefined/);
  assert.match(discover, /Array\.from\(\{length:11\}/);
  assert.match(discover, /data-historical-rating-value="\$\{rating\}"/);
  assert.match(discover, /Historical community/);
  assert.match(discover, /Historical chart entry — recording not yet verified/);
  assert.match(discover, /data-historical-rating-clear/);
  assert.doesNotMatch(discover, /\.from\("song_ratings"\)|canonical_recordings/);
});

test("provisional summaries are batched and writes suppress duplicate interaction", () => {
  assert.match(app, /offset \+= 250/);
  assert.match(app, /p_chart_entry_ids: batch/);
  assert.match(discover, /historicalRatingPending/);
  assert.match(discover, /if\(ratingButton&&historicalDetailItem&&!historicalRatingPending\)/);
  assert.match(discover, /Saving…/);
  assert.match(discover, /result\?\.ok/);
});

test("historical detail navigation resets once and restores the listing on back", () => {
  const reset = discover.match(/function resetHistoricalDetailScroll[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(reset, /document\.scrollingElement\|\|document\.documentElement/);
  assert.match(reset, /scroller\.scrollTop=0/);
  assert.doesNotMatch(reset, /setTimeout|requestAnimationFrame/);
  assert.match(discover, /bomHistoricalList:true/);
  assert.match(discover, /window\.addEventListener\(\"popstate\"/);
});

test("historical detail replaces only the legacy recommendation heading", () => {
  assert.match(html, /<h2>Recommended Albums<\/h2>/);
  assert.match(html, /Albums you may want to rate next\./);
  const heading = discover.match(/function setHistoricalDetailHeading[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(heading, /UK No\.1s — Music History/);
  assert.match(heading, /verified chart stories that reached No\.1/);
  assert.match(heading, /Recommended Albums/);
  assert.match(discover, /setHistoricalDetailHeading\(true\);[\s\S]*?root\.innerHTML=historicalDetail\(item\)/);
  assert.match(discover, /if\(!root\.querySelector\?\.\("\.bom-v1-historical-detail"\)\)setHistoricalDetailHeading\(false\)/);
});
