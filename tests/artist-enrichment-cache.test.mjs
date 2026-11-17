import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const [app, artistPresentation, cacheSource, edge, migration] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-artist.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/_shared/artist-enrichment-cache.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/artist-enrichment/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260928085523_musicbrainz_artist_cache.sql", import.meta.url), "utf8")
]);

function loadCache() {
  const context = { Date, Promise };
  vm.runInNewContext(
    stripTypeScriptTypes(cacheSource.replace(/^export /gm, ""), { mode: "strip" }) +
      "\nObject.assign(globalThis, { ARTIST_ENRICHMENT_TTL_MS, resolveArtistEnrichment });",
    context
  );
  return context;
}

const entry = fetchedAt => ({
  artist_id: "20244d07-534f-4eff-b4d4-930878889970",
  artist_detail: { id: "20244d07-534f-4eff-b4d4-930878889970", name: "Taylor Swift" },
  release_groups: [{ id: "album-group", title: "Album" }],
  fetched_at: fetchedAt
});

test("fresh shared cache avoids MusicBrainz refresh", async () => {
  const { resolveArtistEnrichment } = loadCache();
  let refreshes = 0;
  const result = await resolveArtistEnrichment("artist", {
    read: async () => entry("2026-09-26T00:00:00Z"),
    refresh: async () => { refreshes += 1; return entry("2026-09-28T00:00:00Z"); },
    schedule() {},
    now: () => Date.parse("2026-09-28T00:00:00Z")
  });
  assert.equal(result.cache_status, "fresh");
  assert.equal(refreshes, 0);
});

test("stale cache returns immediately and refreshes without replacing good data on failure", async () => {
  const { resolveArtistEnrichment } = loadCache();
  const stale = entry("2026-09-01T00:00:00Z");
  let scheduled;
  const result = await resolveArtistEnrichment("artist", {
    read: async () => stale,
    refresh: async () => { throw new Error("MusicBrainz unavailable"); },
    schedule: task => { scheduled = task; },
    now: () => Date.parse("2026-09-28T00:00:00Z")
  });
  assert.equal(result.cache_status, "stale");
  assert.equal(result.enrichment, stale);
  assert.ok(scheduled instanceof Promise);
  await scheduled;
  assert.equal(result.enrichment, stale);
});

test("missing cache fetches once, stores success, and a second browser reuses it", async () => {
  const { resolveArtistEnrichment } = loadCache();
  let sharedRow = null;
  let refreshes = 0;
  const dependencies = () => ({
    read: async () => sharedRow,
    refresh: async () => {
      refreshes += 1;
      sharedRow = entry("2026-09-28T00:00:00Z");
      return sharedRow;
    },
    schedule() {},
    now: () => Date.parse("2026-09-28T00:00:00Z")
  });
  assert.equal((await resolveArtistEnrichment("artist", dependencies())).cache_status, "miss");
  assert.equal((await resolveArtistEnrichment("artist", dependencies())).cache_status, "fresh");
  assert.equal(refreshes, 1);
});

test("previously cached empty release groups are refreshed before reuse", async () => {
  const { resolveArtistEnrichment } = loadCache();
  const falseEmpty = { ...entry("2026-09-28T00:00:00Z"), release_groups: [] };
  let refreshes = 0;
  const result = await resolveArtistEnrichment("artist", {
    read: async () => falseEmpty,
    refresh: async () => {
      refreshes += 1;
      return entry("2026-09-29T00:00:00Z");
    },
    schedule() {},
    now: () => Date.parse("2026-09-28T00:00:00Z")
  });
  assert.equal(result.ok, true);
  assert.equal(result.cache_status, "miss");
  assert.equal(refreshes, 1);
  assert.equal(result.enrichment.release_groups.length, 1);
});

test("browser session cache makes at most one shared-cache request per artist", async () => {
  const start = app.indexOf("const sharedArtistEnrichmentCache");
  const end = app.indexOf("function mapArtistReleaseGroups", start);
  let calls = 0;
  const context = {
    Map, Set,
    supabaseClient: { functions: { invoke: async () => {
      calls += 1;
      return { data: { ok: true, enrichment: entry("2026-09-28T00:00:00Z") }, error: null };
    } } }
  };
  vm.runInNewContext(app.slice(start, end), context);
  await context.fetchSharedArtistEnrichment("artist-id");
  await context.fetchSharedArtistEnrichment("artist-id");
  assert.equal(calls, 1);
});

test("failed enrichment is neither cached nor marked resolved and can retry", async () => {
  const start = app.indexOf("const sharedArtistEnrichmentCache");
  const end = app.indexOf("function mapArtistReleaseGroups", start);
  let calls = 0;
  const context = {
    Map, Set, Array,
    supabaseClient: { functions: { invoke: async () => {
      calls += 1;
      return { data: { ok: false, cache_status: "miss", enrichment: null }, error: null };
    } } }
  };
  vm.runInNewContext(app.slice(start, end) +
    "\nObject.assign(globalThis, { sharedArtistEnrichmentCache, sharedArtistEnrichmentResolvedIds });", context);
  for (const artist of ["Status Quo", "Bjork Chong", "Charlie Pughe", "BOWIE", "The Eels"]) {
    assert.equal(await context.fetchSharedArtistEnrichment(artist), null);
    assert.equal(context.sharedArtistEnrichmentCache.has(artist), false);
    assert.equal(context.sharedArtistEnrichmentResolvedIds.has(artist), false);
  }
  assert.equal(await context.fetchSharedArtistEnrichment("Status Quo"), null);
  assert.equal(calls, 6);
});

test("a validated successful empty catalogue is distinct from a loading failure", async () => {
  const start = app.indexOf("const sharedArtistEnrichmentCache");
  const end = app.indexOf("function mapArtistReleaseGroups", start);
  const empty = { ...entry("2026-09-28T00:00:00Z"), release_groups: [] };
  const context = {
    Map, Set, Array,
    supabaseClient: { functions: { invoke: async () => ({ data: { ok: true, enrichment: empty }, error: null }) } }
  };
  vm.runInNewContext(app.slice(start, end) +
    "\nObject.assign(globalThis, { sharedArtistEnrichmentResolvedIds });", context);
  assert.equal((await context.fetchSharedArtistEnrichment("genuine-empty")).release_groups.length, 0);
  assert.equal(context.sharedArtistEnrichmentResolvedIds.has("genuine-empty"), true);
  assert.match(artistPresentation, /Catalogue temporarily unavailable/);
  assert.match(artistPresentation, /catalogueStatus === "failed"/);
});

test("cache infrastructure cannot create catalogue albums or songs", () => {
  assert.doesNotMatch(edge, /\.from\(["'](?:albums|songs)["']\)|admin_add_catalogue_album|artist_import_queue/);
  assert.doesNotMatch(migration, /create\s+table\s+public\.(?:albums|songs)|references\s+public\.(?:albums|songs)/i);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /enable row level security/i);
  assert.match(edge, /result\.ok \? 200 : 503/);
  assert.match(edge, /cache_status: "unavailable"[\s\S]*503/);
});

test("artist page still renders BOM content before any shared or MusicBrainz request", () => {
  const source = app.slice(app.indexOf("async function renderArtistDetail"), app.indexOf("async function renderAlbumDetail"));
  assert.ok(source.indexOf("await renderStageOneArtist") < source.indexOf("const preferredArtistMusicBrainzId"));
  assert.match(source, /albums: localAlbums/);
});

test("active artist detail path reaches shared cache before direct MusicBrainz fallback", () => {
  const renderSource = app.slice(app.indexOf("async function renderArtistDetail"), app.indexOf("async function renderAlbumDetail"));
  const detailSource = app.slice(app.indexOf("async function fetchArtistDetail"), app.indexOf("async function resolveArtistIdentityForImage"));
  const discographySource = app.slice(app.indexOf("async function fetchStudioAlbumsForArtist"), app.indexOf("async function fetchArtistAlbumsFromApi"));

  assert.match(renderSource, /await fetchMostCompleteArtistDiscography/);
  assert.match(renderSource, /resolveArtistIdentityForImage/);
  assert.ok(detailSource.indexOf("fetchSharedArtistEnrichment(externalId)") < detailSource.indexOf("fetchMusicBrainz(url)"));
  assert.ok(discographySource.indexOf("fetchSharedArtistEnrichment(resolvedArtistId)") < discographySource.indexOf("fetchMusicBrainz(url)"));
  assert.match(discographySource, /attempt < 3/);
  assert.match(discographySource, /response\.status === 429 \|\| response\.status === 503/);
  assert.match(discographySource, /artistDiscographyLoadFailures\.add/);
  assert.match(discographySource, /artistDiscographyCache\.delete\(resolvedArtistId\)/);
});

test("local albums remain visible even when remote catalogue loading fails", () => {
  const modelSource = app.slice(app.indexOf("function buildStageOneArtistModel"), app.indexOf("async function renderStageOneArtist"));
  assert.match(modelSource, /albums: normalizedAlbums/);
  assert.match(modelSource, /catalogueLoadFailed && !normalizedAlbums\.length \? "failed" : "ready"/);
  assert.doesNotMatch(modelSource, /insert|upsert|delete/i);
});
