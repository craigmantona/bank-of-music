import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const edge = await readFile(new URL("../supabase/functions/remote-album-catalogue/index.ts", import.meta.url), "utf8");
const start = app.indexOf("const albumDurationEnrichmentAttempted");
const end = app.indexOf("async function renderStageOneAlbum", start);

function harness({ songs, invoke }) {
  let renders = 0;
  const context = {
    currentUser: { id: "user" },
    allAlbums: [{
      id: 7, is_deleted: false,
      musicbrainz_release_id: "11111111-1111-4111-8111-111111111111"
    }],
    allSongs: songs,
    selectedItem: { id: 7, albumId: 7, savedAlbumId: 7 },
    supabaseClient: { functions: { invoke } },
    renderSelectedItem: async () => { renders += 1; },
    window: { setTimeout: callback => callback() },
    console: { warn() {} },
    Number, Map, Set
  };
  vm.createContext(context);
  vm.runInContext(`${app.slice(start, end)}\nthis.fill = maybeEnrichAlbumDurations;`, context);
  return { context, renders: () => renders };
}

function song(id, duration_ms = null) {
  return { id, album_id: 7, is_deleted: false, duration_ms };
}

test("complete album makes no enrichment request", async () => {
  let calls = 0;
  const testApp = harness({ songs: [song(1, 1000), song(2, 2000)], invoke: async () => { calls += 1; } });
  await testApp.context.fill(7);
  assert.equal(calls, 0);
});

test("incomplete eligible album requests once per session and fills only missing durations", async () => {
  let calls = 0;
  const songs = [song(1, 1000), song(2)];
  const testApp = harness({
    songs,
    invoke: async (name, options) => {
      calls += 1;
      assert.equal(name, "remote-album-catalogue");
      assert.equal(JSON.stringify(options.body), JSON.stringify({ action: "enrich_album_durations", album_id: 7 }));
      return { data: { ok: true, enrichment: { durations: [
        { id: 1, duration_ms: 9999 }, { id: 2, duration_ms: 2000 }
      ] } }, error: null };
    }
  });
  await testApp.context.fill(7);
  await testApp.context.fill(7);
  assert.equal(calls, 1);
  assert.equal(songs[0].duration_ms, 1000);
  assert.equal(songs[1].duration_ms, 2000);
  assert.equal(testApp.renders(), 1);
});

test("unsafe or failed enrichment leaves the page usable and is not repeated", async () => {
  let calls = 0;
  const songs = [song(1)];
  const testApp = harness({ songs, invoke: async () => { calls += 1; throw new Error("unsafe mapping"); } });
  await testApp.context.fill(7);
  await testApp.context.fill(7);
  assert.equal(calls, 1);
  assert.equal(songs[0].duration_ms, null);
  assert.equal(testApp.renders(), 0);
});

test("server action reuses safe mapper and limits writes to missing duration", () => {
  assert.match(edge, /runDurationBackfillBatch/);
  assert.match(edge, /action === "enrich_album_durations"/);
  assert.match(edge, /\.update\(\{ duration_ms: update\.duration_ms \}\)/);
  assert.match(edge, /\.is\("duration_ms", null\)/);
  assert.doesNotMatch(edge, /\.update\(\{[^}]*title|\.update\(\{[^}]*track_position|\.update\(\{[^}]*external_id/);
});
