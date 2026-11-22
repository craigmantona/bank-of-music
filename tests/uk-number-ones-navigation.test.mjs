import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [app, foundation, discover, publicDiscover, styles, publicStyles] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-discover.js", import.meta.url), "utf8"),
  readFile(new URL("../public/bom-discover.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8"),
  readFile(new URL("../public/bom-foundation.css", import.meta.url), "utf8")
]);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

const FIXED_NOW = Date.parse("2026-11-18T12:00:00Z");
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [FIXED_NOW])); }
  static now() { return FIXED_NOW; }
}

function discoverHarness(source, numberOnes = []) {
  const clickHandlers = [];
  const popstateHandlers = [];
  const historyCalls = [];
  const trackCalls = [];
  const sectionCalls = [];
  let historicalSaveCalls = 0;
  const scroller = { style: { scrollBehavior: "smooth" }, scrollTop: 321 };
  const heading = { focus() {} };
  const root = {
    innerHTML: "",
    querySelector(selector) { return selector === "h1" ? heading : null; },
    querySelectorAll() { return []; }
  };
  const section = { querySelector() { return null; } };
  let browseCalls = 0;
  const history = {
    state: null,
    replaceState(state, title, url) { this.state = state; historyCalls.push({ type: "replace", state, title, url }); },
    pushState(state, title, url) { this.state = state; historyCalls.push({ type: "push", state, title, url }); },
    back() { historyCalls.push({ type: "back" }); }
  };
  const bridge = {
    getState: () => ({ authenticated: true }),
    loadHistoricalDiscovery: async () => ({ albums: [], numberOnes }),
    loadHistoricalChartRatingSummaries: async () => new Map(),
    saveHistoricalChartEntryRating: async () => { historicalSaveCalls += 1; return { ok: true }; },
    showSection(sectionId) { sectionCalls.push(sectionId); },
    refreshDiscover() {},
    showUKNumberOnes() { browseCalls += 1; },
    openTrackById(songId, trigger) { trackCalls.push({ songId, trigger }); }
  };
  const window = {
    BOMUI: { AlbumCard: () => "", SectionState: () => "" },
    BOMPresentationBridge: bridge,
    BOM_HIGHER_LOWER_FEATURE: { enabled: true },
    BOM_QUICKFIRE_FEATURE: { enabled: true },
    BOM_DAILY_CHALLENGE_FEATURE: { enabled: true },
    addEventListener(type, handler) { if (type === "popstate") popstateHandlers.push(handler); },
    setTimeout: () => 0,
    clearTimeout() {},
    requestAnimationFrame(callback) { callback(); },
    history,
    location: { href: "https://example.test/" },
    scrollY: 321,
    scrollTo() {}
  };
  const document = {
    hidden: false,
    scrollingElement: scroller,
    documentElement: scroller,
    addEventListener(type, handler) { if (type === "click") clickHandlers.push(handler); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById(id) {
      if (id === "recommendationsList") return root;
      if (id === "recommendationsSection") return section;
      return null;
    }
  };
  vm.runInNewContext(source, {
    window, document, Intl, Date: FixedDate, Math, Number, String, Object, Array, Map, Set, Promise,
    clearTimeout() {}, setTimeout: () => 0, matchMedia: () => ({ matches: true })
  });
  return {
    window, document, root, clickHandlers, popstateHandlers, history, historyCalls, trackCalls, sectionCalls,
    browseCalls: () => browseCalls,
    historicalSaveCalls: () => historicalSaveCalls
  };
}

test("featured UK No. 1 keeps its detail action and adds the full historical collection", async () => {
  const chartEntry = {
    id: 42,
    title: "The Fate of Ophelia",
    artist: "Taylor Swift",
    chart_year: 2026,
    first_number_one_date: "2026-11-16",
    weeks_at_number_one: 1
  };
  for (const source of [discover, publicDiscover]) {
    const harness = discoverHarness(source, [chartEntry]);
    harness.window.BOMDiscoverUI.updateRowControls(harness.root);
    await Promise.resolve();
    await Promise.resolve();
    const html = harness.window.BOMDiscoverUI.render({ authenticated: true, groups: [], general: [] });
    assert.match(html, /data-bom-action="browse-number-ones"[^>]*>Browse All UK No\. 1s/);
    assert.match(html, /data-bom-featured-history-id="42"[^>]*>View this No\. 1/);

    const target = {
      closest(selector) {
        return selector === "[data-bom-action]" ? { dataset: { bomAction: "browse-number-ones" } } : null;
      }
    };
    harness.clickHandlers.forEach(handler => handler({ target }));
    assert.equal(harness.browseCalls(), 1);
  }
});

test("historical detail back copy and saved state match every origin", () => {
  const item = {
    id: 42,
    title: "The Fate of Ophelia",
    artist: "Taylor Swift",
    chart_year: 2026,
    first_number_one_date: "2026-11-16",
    weeks_at_number_one: 1,
    number_one_runs: 1
  };
  for (const source of [discover, publicDiscover]) {
    const feature = discoverHarness(source);
    feature.history.state = { seed: "discover", bomQuickRate: { selectedCollection: "uk-number-ones" }, bomQuickRateCollection: "uk-number-ones", bomQuickRateTrack: true, bomQuickRateArtist: true };
    feature.window.BOMDiscoverUI.openHistoricalDetail(item, { origin: "feature" });
    assert.match(feature.root.innerHTML, /← Back to Discover/);
    assert.equal(feature.historyCalls[0].type, "replace");
    assert.equal(feature.historyCalls[0].state.bomDiscover, true);
    assert.equal(feature.historyCalls[0].state.bomHistoricalList, false);
    assert.equal(feature.historyCalls[0].state.scrollY, 321);
    assert.equal(feature.historyCalls[0].state.seed, "discover");
    assert.equal(feature.historyCalls[0].state.bomQuickRate, null);
    assert.equal(feature.historyCalls[0].state.bomQuickRateCollection, null);
    assert.equal(feature.historyCalls[0].state.bomQuickRateTrack, false);
    assert.equal(feature.historyCalls[0].state.bomQuickRateArtist, false);
    assert.equal(feature.historyCalls[1].type, "push");
    assert.deepEqual({ ...feature.historyCalls[1].state }, { bomHistoricalDetail: true, historicalId: 42, historicalOrigin: "feature" });

    const featureDestination = feature.historyCalls[1].state;
    feature.root.innerHTML = "";
    feature.popstateHandlers.forEach(handler => handler({ state: featureDestination }));
    assert.match(feature.root.innerHTML, /The Fate of Ophelia/);
    assert.match(feature.root.innerHTML, /← Back to Discover/);
    assert.equal(feature.historyCalls.length, 2);

    const weekly = discoverHarness(source);
    weekly.history.state = { seed: "week" };
    weekly.window.BOMDiscoverUI.openHistoricalDetail(item, { origin: "history" });
    assert.match(weekly.root.innerHTML, /← Back to UK No\. 1s This Week/);
    assert.equal(weekly.historyCalls[0].state.bomHistoricalList, true);
    assert.equal(weekly.historyCalls[0].state.bomDiscover, false);
    assert.equal(weekly.historyCalls[0].state.scrollY, 321);

    const collection = discoverHarness(source);
    collection.history.state = { bomQuickRate: { selectedCollection: "uk-number-ones", selectedYear: 2026, scrollTop: 640 } };
    collection.window.BOMDiscoverUI.openHistoricalDetail(item, { origin: "quick-rate" });
    assert.match(collection.root.innerHTML, /← Back to All UK No\. 1s/);
    assert.deepEqual(collection.historyCalls.map(call => call.type), ["push"]);
    const collectionDestination = collection.historyCalls[0].state;
    collection.root.innerHTML = "";
    collection.popstateHandlers.forEach(handler => handler({ state: collectionDestination }));
    assert.match(collection.root.innerHTML, /← Back to All UK No\. 1s/);
  }
});

test("resolved featured No. 1s use canonical song detail while unresolved entries keep chart detail", async () => {
  const base = { id: 42, title: "The Fate of Ophelia", artist: "Taylor Swift", chart_year: 2026, first_number_one_date: "2026-11-16", weeks_at_number_one: 1, number_one_runs: 1 };
  for (const source of [discover, publicDiscover]) {
    const featuredButton = { dataset: { bomFeaturedHistoryId: "42" } };
    const target = { closest(selector) { return selector === "[data-bom-featured-history-id]" ? featuredButton : null; } };

    const resolved = discoverHarness(source, [{ ...base, match_status: "direct_mbid", resolvedSongId: 777 }]);
    resolved.window.BOMDiscoverUI.updateRowControls(resolved.root);
    await Promise.resolve();
    await Promise.resolve();
    resolved.clickHandlers.forEach(handler => handler({ target }));
    assert.equal(resolved.trackCalls.length, 1);
    assert.equal(resolved.trackCalls[0].songId, 777);
    assert.equal(resolved.trackCalls[0].trigger, featuredButton);
    assert.equal(resolved.historyCalls[0].state.bomDiscover, true);
    assert.equal(resolved.historyCalls[0].state.scrollY, 321);
    assert.deepEqual({ ...resolved.historyCalls[1].state }, { bomNumberOneTrack: true, bomNumberOneSongId: 777, bomNumberOneOrigin: "feature" });
    assert.doesNotMatch(resolved.root.innerHTML, /data-historical-detail-id/);

    const weekly = discoverHarness(source);
    weekly.window.BOMDiscoverUI.openHistoricalDetail({ ...base, match_status: "direct_mbid", resolvedSongId: 777 }, { origin: "history", trigger: featuredButton });
    assert.equal(weekly.trackCalls[0].songId, 777);
    assert.equal(weekly.historyCalls[0].state.bomHistoricalList, true);
    assert.equal(weekly.historyCalls[0].state.scrollY, 321);
    assert.deepEqual({ ...weekly.historyCalls[1].state }, { bomNumberOneTrack: true, bomNumberOneSongId: 777, bomNumberOneOrigin: "history" });

    const unresolved = discoverHarness(source, [{ ...base, match_status: "unresolved", resolvedSongId: null, song_id: null }]);
    unresolved.window.BOMDiscoverUI.updateRowControls(unresolved.root);
    await Promise.resolve();
    await Promise.resolve();
    unresolved.clickHandlers.forEach(handler => handler({ target }));
    assert.equal(unresolved.trackCalls.length, 0);
    assert.match(unresolved.root.innerHTML, /data-historical-detail-id="42"/);
    assert.match(unresolved.root.innerHTML, /data-historical-rating-value="10"/);
  }
});

test("provisional ratings are limited to confirmed unresolved chart entries", () => {
  for (const source of [discover, publicDiscover]) {
    const harness = discoverHarness(source);
    const unresolved = harness.window.BOMDiscoverHelpers.historicalRatingPanel({ id: 1, match_status: "unresolved", song_id: null, resolvedSongId: null });
    const ambiguous = harness.window.BOMDiscoverHelpers.historicalRatingPanel({ id: 2, match_status: "ambiguous", song_id: null, resolvedSongId: null });
    assert.equal((unresolved.match(/data-historical-rating-value=/g) || []).length, 11);
    assert.doesNotMatch(ambiguous, /data-historical-rating-value=|data-historical-rating-clear/);
    assert.match(ambiguous, /Recording identity needs review · ratings unavailable/);

    const ambiguousItem = { id: 2, title: "Shared title", artist: "Several artists", chart_year: 1999, first_number_one_date: "1999-01-01", match_status: "ambiguous" };
    harness.window.BOMDiscoverUI.openHistoricalDetail(ambiguousItem);
    const ratingButton = { hasAttribute: () => false, dataset: { historicalRatingValue: "8" } };
    const target = { closest(selector) { return selector === "[data-historical-rating-value],[data-historical-rating-clear]" ? ratingButton : null; } };
    harness.clickHandlers.forEach(handler => handler({ target }));
    assert.equal(harness.historicalSaveCalls(), 0);
  }
});

test("inactive carousel slides stay out of keyboard navigation", async () => {
  const chartEntry = { id: 42, title: "The Fate of Ophelia", artist: "Taylor Swift", chart_year: 2026, first_number_one_date: "2026-11-16", weeks_at_number_one: 1 };
  for (const source of [discover, publicDiscover]) {
    const harness = discoverHarness(source, [chartEntry]);
    harness.window.BOMDiscoverUI.updateRowControls(harness.root);
    await Promise.resolve();
    await Promise.resolve();
    const html = harness.window.BOMDiscoverUI.render({ authenticated: true, groups: [], general: [] });
    const slideTags = html.match(/<article class="bom-v1-discovery-slide[^>]+>/g) || [];
    assert.equal(slideTags.length, 3);
    assert.equal(slideTags.filter(tag => tag.includes('aria-hidden="true"') && tag.includes(" inert")).length, 2);
    assert.equal(slideTags.filter(tag => tag.includes('aria-hidden="false"') && !tag.includes(" inert")).length, 1);

    const slides = Array.from({ length: 3 }, () => ({ attributes: {}, setAttribute(name, value) { this.attributes[name] = String(value); }, toggleAttribute(name, active) { this.attributes[name] = Boolean(active); } }));
    const dots = Array.from({ length: 3 }, () => ({ attributes: {}, setAttribute(name, value) { this.attributes[name] = String(value); } }));
    const track = { style: { setProperty() {} } };
    const carousel = {
      dataset: {},
      parentElement: null,
      querySelector(selector) { return selector === ".bom-v1-discovery-track" ? track : selector === ".bom-v1-discovery-slide.is-chart" ? null : null; },
      querySelectorAll(selector) { return selector === ".bom-v1-discovery-slide" ? slides : selector === "[data-bom-carousel-go]" ? dots : []; },
      addEventListener() {}, contains() { return false; }
    };
    carousel.parentElement = { querySelector(selector) { return selector === "[data-bom-discovery-carousel]" ? carousel : null; } };
    const go = { dataset: { bomCarouselGo: "1" } };
    const target = { closest(selector) { if (selector === "[data-bom-discovery-carousel]") return carousel; if (selector === "[data-bom-carousel-go]") return go; return null; } };
    harness.clickHandlers.forEach(handler => handler({ target }));
    assert.deepEqual(slides.map(slide => slide.attributes["aria-hidden"]), ["true", "false", "true"]);
    assert.deepEqual(slides.map(slide => slide.attributes.inert), [true, false, true]);
  }
});

test("iPhone chart actions remain visible and touch sized", () => {
  for (const css of [styles, publicStyles]) {
    assert.match(css, /\.bom-v1-discovery-actions \{ display:flex;[^}]*gap:9px;/);
    assert.match(css, /\.bom-v1-discovery-action \{[^}]*min-height:44px;[^}]*touch-action:manipulation;/);
    assert.match(css, /@media\(max-width:700px\)\{[\s\S]*?\.bom-v1-discovery-actions \{ display:grid; grid-template-columns:1fr;[^}]*width:100%; \}/);
    assert.match(css, /@media\(max-width:700px\)\{[\s\S]*?\.bom-v1-discovery-action \{ width:100%; min-height:44px;/);
    assert.match(css, /discovery-carousel > header button \{[^}]*flex:0 0 44px;[^}]*width:44px; min-width:44px; height:44px; min-height:44px;[^}]*touch-action:manipulation;/);
    assert.match(css, /discovery-carousel > header button::before \{[^}]*width:22px; height:3px;/);
    assert.match(css, /@media\(max-width:700px\)\{[\s\S]*?\.bom-v1-discovery-next \{ right:7px; width:44px; height:44px; \}/);
    assert.match(css, /@media\(max-width:420px\)\{[\s\S]*?\.bom-v1-discovery-slide \{ grid-template-columns:72px minmax\(0,1fr\); gap:10px; padding:16px 54px 16px 9px; \}/);
    assert.match(css, /@media\(max-width:420px\)\{[\s\S]*?\.bom-v1-discovery-slide h2 \{ font-size:19px; \}/);
  }
});

test("historical Back controls keep a 44px iPhone touch target", () => {
  for (const css of [styles, publicStyles]) {
    const backRule = css.match(/\.bom-shell-v1 \.bom-v1-history-back \{([^}]*)\}/)?.[1] || "";
    assert.match(backRule, /display:inline-flex/);
    assert.match(backRule, /min-width:44px/);
    assert.match(backRule, /min-height:44px/);
    assert.match(backRule, /touch-action:manipulation/);
    assert.match(backRule, /box-shadow:none/);
    assert.doesNotMatch(backRule, /min-height:0/);
  }
});

test("the full UK No. 1s collection keeps its primary iPhone controls touch sized", () => {
  for (const css of [styles, publicStyles]) {
    const mobile = sourceBetween(css, "@media (max-width: 480px) {", "@media (max-width: 340px)");
    assert.match(mobile, /> header > button \{ min-height: 44px/);
    assert.match(mobile, /\[data-quick-collection\] \{[^}]*min-height: 44px/);
    assert.match(mobile, /quick-year-picker button, \.bom-v1-quick-year-control > summary \{ min-height: 44px/);
    assert.match(mobile, /quick-year-panel button \{ min-height: 44px/);
    assert.match(mobile, /quick-filter button, \.bom-v1-quick-tools > button \{ min-height: 44px/);
    assert.match(mobile, /quick-rate \.bom-v1-track-rating-trigger \{[^}]*min-height: 44px/);
    assert.match(mobile, /quick-rate \.bom-v1-track-rating-choice \{ min-height: 44px !important/);
  }
});

test("Quick Rate replacement preserves saved state and only explicit collection exits consume history", () => {
  const closeNavigation = sourceBetween(
    app,
    "function bindQuickRateCloseNavigation",
    "\n\nasync function openQuickRate"
  );
  let backCalls = 0;
  let currentDialog = null;
  const history = {
    state: { bomQuickRateCollectionView: true, bomQuickRateCollection: "uk-number-ones" },
    replaceState(state) { this.state = state; },
    back() { backCalls += 1; }
  };
  const context = vm.createContext({
    window: { history, location: { href: "https://example.test/" } },
    document: { getElementById() { return currentDialog; } }
  });
  vm.runInContext(closeNavigation, context);

  function dialogHarness() {
    const handlers = { cancel: [], close: [] };
    const exit = {};
    let removed = false;
    let closeCalls = 0;
    return {
      handlers,
      exit,
      open: true,
      get removed() { return removed; },
      get closeCalls() { return closeCalls; },
      addEventListener(type, handler) { handlers[type].push(handler); },
      querySelector() { return exit; },
      close() { closeCalls += 1; this.open = false; handlers.close.forEach((handler) => handler()); },
      remove() { removed = true; }
    };
  }

  const alreadyOpen = dialogHarness();
  currentDialog = alreadyOpen;
  assert.equal(context.prepareQuickRateDialog(), false);
  assert.equal(alreadyOpen.closeCalls, 0);
  assert.equal(alreadyOpen.removed, false);

  const restoredState = { selectedCollection: "uk-number-ones", selectedYear: 1989, scrollTop: 420 };
  const replacement = dialogHarness();
  context.bindQuickRateCloseNavigation(replacement, { collectionHistoryOwned: true });
  currentDialog = replacement;
  history.state = { bomQuickRate: restoredState, bomQuickRateCollectionView: true };
  assert.equal(context.prepareQuickRateDialog(restoredState), true);
  assert.equal(replacement.closeCalls, 1);
  assert.equal(replacement.removed, true);
  assert.deepEqual({ ...history.state.bomQuickRate }, restoredState);
  assert.equal(backCalls, 0);
  currentDialog = null;

  const ordinary = dialogHarness();
  history.state = { bomQuickRateCollectionView: true, bomQuickRateCollection: "uk-number-ones" };
  context.bindQuickRateCloseNavigation(ordinary);
  ordinary.close();
  assert.equal(ordinary.removed, true);
  assert.equal(backCalls, 0, "a programmatic close must ignore a newly current collection marker");

  const programmaticCollection = dialogHarness();
  context.bindQuickRateCloseNavigation(programmaticCollection, { collectionHistoryOwned: true });
  programmaticCollection.close();
  assert.equal(backCalls, 0, "browser Back must not trigger a second Back through dialog close");

  const explicitExit = dialogHarness();
  history.state = { bomQuickRate: restoredState, bomQuickRateCollectionView: true };
  context.bindQuickRateCloseNavigation(explicitExit, { collectionHistoryOwned: true });
  explicitExit.exit.onclick();
  assert.equal(backCalls, 1);

  const escape = dialogHarness();
  history.state = { bomQuickRate: restoredState, bomQuickRateCollectionView: true };
  context.bindQuickRateCloseNavigation(escape, { collectionHistoryOwned: true });
  escape.handlers.cancel[0]();
  escape.close();
  assert.equal(backCalls, 2);
});

test("Browse All creates a collection destination and Back restores the Discover scroll position", async () => {
  const helper = sourceBetween(
    app,
    "function openUKNumberOnesCollection",
    "\n\nwindow.BOMPresentationBridge"
  );
  const appPopstate = sourceBetween(
    app,
    'window.addEventListener("popstate", async (event) => {',
    '\n\nwindow.addEventListener("click"'
  );
  const entries = [{ seed: "discover" }];
  let cursor = 0;
  const openCalls = [];
  const scrollCalls = [];
  const sections = [];
  let dialogOpen = false;
  const popstateHandlers = [];
  const history = {
    get state() { return entries[cursor]; },
    replaceState(state) { entries[cursor] = state; },
    pushState(state) { entries.splice(cursor + 1); entries.push(state); cursor += 1; },
    back() { if (cursor > 0) cursor -= 1; }
  };
  const context = vm.createContext({
    window: {
      history,
      location: { href: "https://example.test/" },
      scrollY: 654,
      addEventListener(type, handler) { if (type === "popstate") popstateHandlers.push(handler); },
      requestAnimationFrame(callback) { callback(); },
      scrollTo(options) { scrollCalls.push(options); }
    },
    document: {
      getElementById(id) {
        if (id !== "bomQuickRate" || !dialogOpen) return null;
        return { close() { dialogOpen = false; } };
      }
    },
    openQuickRate(options, navigationOptions) { dialogOpen = true; openCalls.push({ options, navigationOptions }); },
    openSongDetail: async () => {},
    openUKNumberOnesCollection: undefined,
    isStageOnePresentation: () => true,
    allSongs: [],
    showOnlySection(section) { sections.push(section); },
    renderRecommendations() {},
    handleIncomingShareLink: async () => {},
    selectedItem: null,
    Number,
    Promise
  });
  vm.runInContext(`${helper}\n${appPopstate}`, context);

  context.openUKNumberOnesCollection();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].seed, "discover");
  assert.equal(entries[0].bomDiscover, true);
  assert.equal(entries[0].scrollY, 654);
  assert.equal(entries[0].bomQuickRate, null);
  assert.equal(entries[0].bomHistoricalDetail, false);
  assert.deepEqual({ ...entries[1] }, {
    bomQuickRateCollectionView: true,
    bomQuickRateCollection: "uk-number-ones"
  });
  assert.deepEqual(openCalls.map((call) => ({
    options: { ...call.options },
    navigationOptions: { ...call.navigationOptions }
  })), [{
    options: { selectedCollection: "uk-number-ones" },
    navigationOptions: { collectionHistoryOwned: true }
  }]);

  history.back();
  await popstateHandlers[0]({ state: history.state });
  assert.equal(dialogOpen, false);
  assert.equal(sections.at(-1), "recommendationsSection");
  assert.deepEqual({ ...scrollCalls.at(-1) }, { top: 654, behavior: "auto" });

  cursor += 1;
  await popstateHandlers[0]({ state: history.state });
  assert.equal(dialogOpen, true);
  assert.equal(entries.length, 2);
  assert.deepEqual({ ...openCalls.at(-1).options }, { selectedCollection: "uk-number-ones" });
  assert.deepEqual({ ...openCalls.at(-1).navigationOptions }, { collectionHistoryOwned: true });
});

test("resolved song and artist Forward navigation win the real listener order", async () => {
  const openSongDetail = sourceBetween(
    app,
    "async function openSongDetail",
    "\n\n\n\n\nfunction showOnlySection"
  );
  const appPopstate = sourceBetween(
    app,
    'window.addEventListener("popstate", async (event) => {',
    '\n\nwindow.addEventListener("click"'
  );
  const foundationPopstate = sourceBetween(
    foundation,
    'window.addEventListener("popstate", async (event) => {',
    "\n  activate();\n})();"
  );
  const listeners = [];
  const artistCalls = [];
  let holdArtistOpen = false;
  let resolveArtistOpen = null;
  let selectedArtist = null;
  let activeSection = "recommendationsSection";
  const context = vm.createContext({
    window: {
      location: { search: "" },
      addEventListener(type, handler) { if (type === "popstate") listeners.push(handler); },
      requestAnimationFrame(callback) { callback(); },
      scrollTo() {},
      setTimeout(callback) { callback(); },
      async openArtistPage(artistName, artistId) {
        selectedArtist = { artistName, artistId };
        artistCalls.push({ artistName, artistId });
        if (holdArtistOpen) await new Promise((resolve) => { resolveArtistOpen = resolve; });
      }
    },
    document: {
      getElementById() { return null; },
      scrollingElement: { scrollTop: 0, scrollLeft: 0 },
      documentElement: { style: { scrollBehavior: "" }, scrollTop: 0, scrollLeft: 0 }
    },
    Date: FixedDate,
    Number,
    Promise,
    URLSearchParams,
    history: null,
    allAlbums: [],
    allSongs: [{ id: 777, title: "The Fate of Ophelia", artist: "Taylor Swift" }],
    selectedItemDetail: { querySelector() { return { focus() {} }; } },
    getAlbumNameById: () => "",
    markSongNavigation() {},
    triggerSelectedArtistEasterEgg: () => false,
    showOnlySection(section) { activeSection = section; },
    renderSelectedItem: async () => {},
    scrollSelectedDetailToTop() {},
    openQuickRate: async () => {},
    openUKNumberOnesCollection: async () => {},
    isStageOnePresentation: () => true,
    renderRecommendations() {},
    handleIncomingShareLink: async () => {},
    bridge: () => ({ showDiscover() { selectedArtist = null; activeSection = "recommendationsSection"; } }),
    activate() {}
  });
  context.window.history = { state: null };
  vm.runInContext(`
    let pendingSongNavigationKey = "";
    let lastSongNavigationKey = "";
    let lastSongNavigationAt = 0;
    let selectedItem = null;
    ${openSongDetail}
    globalThis.readSelectedItem = () => selectedItem;
    ${appPopstate}
    ${foundationPopstate}
  `, context);

  await context.openSongDetail(context.allSongs[0]);
  await Promise.all(listeners.map((handler) => handler({ state: { bomDiscover: true, scrollY: 321 } })));
  assert.equal(activeSection, "recommendationsSection");

  await Promise.all(listeners.map((handler) => handler({
    state: { bomNumberOneTrack: true, bomNumberOneSongId: 777, bomNumberOneOrigin: "feature" }
  })));
  assert.equal(activeSection, "detailSection");
  assert.equal(context.readSelectedItem().savedSongId, 777);

  await Promise.all(listeners.map((handler) => handler({ state: { bomDiscover: true, scrollY: 321 } })));
  const artistState = {
    bomQuickRateArtist: true,
    bomQuickRateCollection: "uk-number-ones",
    bomQuickRateArtistName: "Taylor Swift",
    bomQuickRateArtistId: "20244d07-534f-4eff-b4d4-930878889970",
    bomQuickRateArtistToken: "artist-forward-1"
  };
  context.window.history.state = artistState;
  await Promise.all(listeners.map((handler) => handler({ state: artistState })));
  assert.equal(activeSection, "detailSection");
  assert.deepEqual(artistCalls, [{
    artistName: "Taylor Swift",
    artistId: "20244d07-534f-4eff-b4d4-930878889970"
  }]);
  assert.deepEqual(selectedArtist, artistCalls[0]);

  holdArtistOpen = true;
  const interruptedArtistState = { ...artistState, bomQuickRateArtistToken: "artist-forward-2" };
  context.window.history.state = interruptedArtistState;
  const interruptedForward = Promise.all(listeners.map((handler) => handler({ state: interruptedArtistState })));
  for (let attempt = 0; artistCalls.length < 2 && attempt < 8; attempt += 1) await Promise.resolve();
  assert.equal(artistCalls.length, 2);
  const discoverState = { bomDiscover: true, scrollY: 321 };
  context.window.history.state = discoverState;
  await Promise.all(listeners.map((handler) => handler({ state: discoverState })));
  resolveArtistOpen();
  await interruptedForward;
  assert.equal(activeSection, "recommendationsSection");
  assert.equal(selectedArtist, null);

  await Promise.all(listeners.map((handler) => handler({ state: { bomDiscover: true, scrollY: 321 } })));
  await Promise.all(listeners.map((handler) => handler({
    state: { bomQuickRateTrack: true, bomQuickRateCollection: "uk-number-ones", bomQuickRateSongId: 777 }
  })));
  assert.equal(activeSection, "detailSection");
  assert.equal(context.readSelectedItem().savedSongId, 777);
});

test("Browse All reuses UK No. 1s Quick Rate and detail back navigation preserves its context", () => {
  assert.match(app, /showUKNumberOnes: \(\) => openUKNumberOnesCollection\(\)/);
  assert.match(app, /scrollTop:dialog\.scrollTop/);
  assert.match(app, /bomQuickRateTrack:true,bomQuickRateCollection:selectedCollection,bomQuickRateSongId:songId/);
  assert.match(app, /bomQuickRateArtist: true,[\s\S]*?bomQuickRateCollection: selectedCollection,[\s\S]*?bomQuickRateArtistName: artistName,[\s\S]*?bomQuickRateArtistId: artistId,[\s\S]*?bomQuickRateArtistToken: restoreToken/);
  assert.match(app, /getItemDeepLinkUrl\(artistDestination\)/);
  assert.match(app, /Browse every UK chart-topper from 1952 to today and rate verified recordings/);
  assert.doesNotMatch(app, /Rate every UK chart-topper from 1952 to today/);
  const backButton = app.match(/function buildSelectedBackButton\(\)[\s\S]*?\n\}/)?.[0] || "";
  assert.match(backButton, /quickRateCollection === "uk-number-ones"[\s\S]*?"Back to All UK No\. 1s"/);
  assert.match(backButton, /quickRateCollection === "bom-tracks"[\s\S]*?"Back to BOM Tracks by Year"/);
  assert.match(backButton, /navigationState\.bomNumberOneTrack[\s\S]*?bomNumberOneOrigin === "feature"[\s\S]*?"Back to Discover"[\s\S]*?bomNumberOneOrigin === "quick-rate"[\s\S]*?"Back to All UK No\. 1s"[\s\S]*?"Back to UK No\. 1s This Week"/);
  assert.match(app, /event\.state\?\.bomNumberOneTrack[\s\S]*?bomNumberOneSongId[\s\S]*?await openSongDetail\(song, null, \{ force: true \}\)[\s\S]*?showOnlySection\("detailSection"\)/);
  assert.match(app, /event\.state\?\.bomQuickRateArtist && event\.state\.bomQuickRateArtistName\)[\s\S]*?bomQuickRateArtistToken[\s\S]*?isCurrentArtistDestination[\s\S]*?await new Promise\(\(resolve\) => window\.setTimeout\(resolve, 0\)\)[\s\S]*?if \(!isCurrentArtistDestination\(\)\) return;[\s\S]*?await window\.openArtistPage[\s\S]*?if \(!isCurrentArtistDestination\(\)\) return;[\s\S]*?showOnlySection\("detailSection"\)/);
  assert.match(app, /function bindQuickRateCloseNavigation[\s\S]*?dialog\.addEventListener\("cancel"[\s\S]*?dialog\.addEventListener\("close"[\s\S]*?bomQuickRate: null/);
});
