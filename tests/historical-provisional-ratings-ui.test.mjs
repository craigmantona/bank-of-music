import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [app, discover] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-discover.js", import.meta.url), "utf8")
]);

function ratingContext({ user = { id: "listener" }, rpc, getSession } = {}) {
  const start = app.indexOf("const historicalChartRatingSummaries");
  const end = app.indexOf("window.BOMPresentationBridge = Object.freeze", start);
  const context = {
    currentUser: user,
    supabaseClient: {
      rpc: rpc || (async () => ({ data: [], error: null })),
      auth: { getSession: getSession || (async () => ({ data: { session: { user } }, error: null })) }
    },
    Map, Set, Number, String, Promise
  };
  vm.runInNewContext(`let currentUser=context.currentUser; const supabaseClient=context.supabaseClient;${app.slice(start, end)};context.load=loadHistoricalChartRatingSummaries;context.save=saveHistoricalChartEntryRating;`, { context, Map, Set, Number, String, Promise });
  return context;
}

test("summary loading batches once, caches results and preserves a personal zero", async () => {
  const calls = [];
  const context = ratingContext({ rpc: async (name, args) => {
    calls.push([name, args]);
    return { data: [{ chart_entry_id: 12, community_average: 0, community_rating_count: 1, personal_rating: 0 }], error: null };
  } });
  const first = await context.load([12, 12]);
  const second = await context.load([12]);
  assert.equal(calls.length, 1);
  assert.equal(first.get(12).personalRating, 0);
  assert.equal(first.get(12).communityAverage, 0);
  assert.equal(second.get(12).communityRatingCount, 1);
});

test("successful writes refresh summaries only after persistence", async () => {
  const calls = [];
  const context = ratingContext({ rpc: async (name) => {
    calls.push(name);
    if (name === "set_historical_chart_entry_rating") return { data: [{ rating: 5 }], error: null };
    return { data: [{ chart_entry_id: 44, community_average: 5, community_rating_count: 1, personal_rating: 5 }], error: null };
  } });
  const result = await context.save(44, 5);
  assert.deepEqual(calls, ["set_historical_chart_entry_rating", "get_historical_chart_entry_rating_summaries"]);
  assert.equal(result.ok, true);
  assert.equal(result.summary.personalRating, 5);
});

test("zero, ten and clearing remain distinct while invalid values never reach the RPC", async () => {
  const writes = [];
  const context = ratingContext({ rpc: async (name, args) => {
    if (name === "set_historical_chart_entry_rating") writes.push(args);
    return { data: [], error: null };
  } });
  assert.equal((await context.save(71, 0)).ok, true);
  assert.equal((await context.save(71, 10)).ok, true);
  assert.equal((await context.save(71, null)).ok, true);
  assert.equal((await context.save(71, 11)).code, "invalid");
  assert.deepEqual(writes.map(write => write.p_rating), [0, 10, null]);
  assert.ok(writes.every(write => write.p_chart_entry_id === 71));
});

test("expired sessions and resolved-entry races fail without confirmation", async () => {
  const expired = ratingContext({ getSession: async () => ({ data: { session: null }, error: { message: "expired" } }) });
  assert.equal((await expired.save(1, 10)).code, "authentication");
  const resolved = ratingContext({ rpc: async () => ({ data: null, error: { code: "P0002" } }) });
  const result = await resolved.save(1, 10);
  assert.equal(result.ok, false);
  assert.equal(result.code, "resolved");
  const denied = ratingContext({ rpc: async () => ({ data: null, error: { code: "42501" } }) });
  assert.equal((await denied.save(1, 5)).code, "authentication");
});

test("historical panel distinguishes unrated from zero and supports logged-out rendering", () => {
  const document = { addEventListener() {}, querySelectorAll() { return []; }, getElementById() { return null; } };
  const window = {
    BOMUI: { AlbumCard: () => "", SectionState: () => "" },
    BOMPresentationBridge: { getState: () => ({ authenticated: true }) },
    addEventListener() {}, history: { state: null, replaceState() {}, pushState() {} }, location: { href: "http://localhost/" }
  };
  vm.runInNewContext(discover, { window, document, URL, Math, Map, Set, Number, String });
  const panel = window.BOMDiscoverHelpers.historicalRatingPanel({ provisionalRatingSummary: { communityAverage: 0, communityRatingCount: 1, personalRating: 0 } });
  assert.match(panel, /<strong>0 \/ 10<\/strong>/);
  assert.match(panel, /aria-pressed="true"[^>]*>0<\/button>/);
  assert.doesNotMatch(panel, /<strong>Not rated<\/strong>/);
  window.BOMPresentationBridge.getState = () => ({ authenticated: false });
  assert.match(window.BOMDiscoverHelpers.historicalRatingPanel({}), /Sign in to add your historical rating/);
});
