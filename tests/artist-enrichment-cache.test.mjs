import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const [app, cacheSource, edge, migration] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/_shared/artist-enrichment-cache.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/artist-enrichment/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260928082227_musicbrainz_artist_cache.sql", import.meta.url), "utf8")
]);

function loadCache() {
  const context = { Date, Promise };
  vm.runInNewContext(
    stripTypeScriptTypes(cacheSource.replace(/^export /gm, ""), { mode: "transform" }) +
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

test("cache infrastructure cannot create catalogue albums or songs", () => {
  assert.doesNotMatch(edge, /\.from\(["'](?:albums|songs)["']\)|admin_add_catalogue_album|artist_import_queue/);
  assert.doesNotMatch(migration, /create\s+table\s+public\.(?:albums|songs)|references\s+public\.(?:albums|songs)/i);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /enable row level security/i);
});

test("artist page still renders BOM content before any shared or MusicBrainz request", () => {
  const source = app.slice(app.indexOf("async function renderArtistDetail"), app.indexOf("async function renderAlbumDetail"));
  assert.ok(source.indexOf("await renderStageOneArtist") < source.indexOf("const preferredArtistMusicBrainzId"));
  assert.match(source, /albums: localAlbums/);
});
