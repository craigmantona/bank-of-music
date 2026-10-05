import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadEdge } from "./helpers.mjs";

const source = readFileSync(
  new URL("../functions/admin-catalogue/index.ts", import.meta.url),
  "utf8"
);
const RELEASE_ID = "44444444-4444-4444-8444-444444444444";

function request(action, extra = {}, authorization = true) {
  return new Request("https://project.invalid/functions/v1/admin-catalogue", {
    method: "POST",
    headers: {
      Origin: "https://thebankofmusic.com",
      ...(authorization ? { Authorization: "Bearer user-session" } : {}),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action, ...extra })
  });
}

function loadHandler({ authorization, preview, releases = [] }) {
  let handler;
  let clientCount = 0;
  const rpcCalls = [];
  const resolvedReleaseIds = [];
  loadEdge(source.replace(/^export /gm, ""), {
    Deno: {
      env: { get: () => "test-only" },
      serve: value => { handler = value; }
    },
    getAdminKey: () => "service-key",
    requireAdminUser: async () => authorization,
    searchReleaseCandidates: async () => releases,
    resolveSelectedRelease: async ({ releaseId }) => {
      resolvedReleaseIds.push(releaseId);
      return preview;
    },
    createClient: () => {
      clientCount += 1;
      if (clientCount === 1) return {};
      return {
        rpc: async (name, params) => {
          rpcCalls.push({ name, params });
          return { data: { status: "added", album_id: 92 }, error: null };
        }
      };
    }
  });
  return { handler, rpcCalls, resolvedReleaseIds };
}

test("MusicBrainz release actions reject unauthenticated and ordinary users before lookup or write", async () => {
  for (const [status, message] of [[401, "Authentication required"], [403, "Administrator access required"]]) {
    const app = loadHandler({
      authorization: { ok: false, response: Response.json({ ok: false, error: message }, { status }) },
      preview: null
    });
    const response = await app.handler(request("search_releases", {
      artist_name: "The Smiths", release_title: "Hatful of Hollow"
    }));
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, message);
    assert.deepEqual(app.resolvedReleaseIds, []);
    assert.deepEqual(app.rpcCalls, []);
  }
});

test("add_release refetches one selected release and passes only validated payload to the existing writer", async () => {
  const album = {
    title: "Hatful of Hollow", artist: "The Smiths",
    musicbrainz_release_id: RELEASE_ID,
    musicbrainz_release_group_id: "22222222-2222-4222-8222-222222222222"
  };
  const tracks = [{
    position: 1, title: "William, It Was Really Nothing", artist: "The Smiths",
    musicbrainz_recording_id: "66666666-6666-4666-8666-666666666666"
  }];
  const app = loadHandler({
    authorization: { ok: true },
    preview: { status: "ready", album, tracks }
  });
  const response = await app.handler(request("add_release", {
    release_id: RELEASE_ID,
    album: { title: "Caller controlled" },
    tracks: [{ title: "Caller controlled" }],
    release_ids: [RELEASE_ID, "another-release"]
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(app.resolvedReleaseIds, [RELEASE_ID]);
  assert.deepEqual(JSON.parse(JSON.stringify(app.rpcCalls)), [{
    name: "admin_add_catalogue_album",
    params: { p_album: album, p_tracks: tracks }
  }]);
});

test("add_release does not call the writer when exact validation is unsuitable or already exists", async () => {
  const failed = loadHandler({
    authorization: { ok: true },
    preview: { status: "failed", reason: "official_release_required" }
  });
  const failedResponse = await failed.handler(request("add_release", { release_id: RELEASE_ID }));
  assert.equal(failedResponse.status, 400);
  assert.deepEqual(failed.rpcCalls, []);

  const existing = loadHandler({
    authorization: { ok: true },
    preview: { status: "already_exists", existing_album_id: 91 }
  });
  const existingResponse = await existing.handler(request("add_release", { release_id: RELEASE_ID }));
  assert.equal(existingResponse.status, 200);
  assert.deepEqual(await existingResponse.json(), {
    ok: true,
    result: { status: "already_exists", album_id: 91 }
  });
  assert.deepEqual(existing.rpcCalls, []);
});
