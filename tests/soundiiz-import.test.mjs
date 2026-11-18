import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const functionSource = await readFile(
  new URL("../functions/api/soundiiz-import.js", import.meta.url),
  "utf8"
);
const functionModule = await import(
  `data:text/javascript;base64,${Buffer.from(functionSource).toString("base64")}`
);
const { handleSoundiizImport } = functionModule;

function makeRequest(body, { origin = "https://thebankofmusic.com", contentType = "application/json" } = {}) {
  return new Request("https://thebankofmusic.com/api/soundiiz-import", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": contentType
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

test("Soundiiz proxy accepts a same-origin Apple Music import and constrains the upstream payload", async () => {
  let upstreamRequest;
  const request = makeRequest({
    title: "BoM • Rated 9+",
    sourceName: "Untrusted source",
    sourceLogo: "https://evil.example/logo.png",
    destination: "spotify",
    description: "Prepared from your 9+ ratings.",
    tracklist: [
      { title: "Song", artists: ["Artist"], album: "Album", isrc: "INVENTED" }
    ]
  });
  const response = await handleSoundiizImport(request, async (url, options) => {
    upstreamRequest = { url, options, body: JSON.parse(options.body) };
    return Response.json({
      status: "success",
      nbTracks: 1,
      shareUrl: "https://soundiiz.com/go/import-playlist/temporary-token",
      expiresAt: 1782220923
    });
  });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(upstreamRequest.url, "https://soundiiz.com/go/import-playlist");
  assert.equal(upstreamRequest.options.method, "POST");
  assert.equal(upstreamRequest.body.destination, "applemusicapp");
  assert.equal(upstreamRequest.body.sourceName, "Bank of Music");
  assert.equal(upstreamRequest.body.sourceLogo, "https://thebankofmusic.com/logo.jpeg");
  assert.deepEqual(upstreamRequest.body.tracklist, [
    { title: "Song", artists: ["Artist"], album: "Album" }
  ]);
  assert.equal(data.shareUrl, "https://soundiiz.com/go/import-playlist/temporary-token");
  assert.equal(data.expiresAt, 1782220923);
});

test("Soundiiz proxy rejects cross-origin requests and any part above 200 tracks", async () => {
  let calls = 0;
  const neverCall = async () => {
    calls += 1;
    return Response.json({});
  };
  const crossOrigin = await handleSoundiizImport(
    makeRequest({ title: "Playlist", tracklist: [{ title: "Song" }] }, { origin: "https://evil.example" }),
    neverCall
  );
  assert.equal(crossOrigin.status, 403);

  const tooMany = await handleSoundiizImport(makeRequest({
    title: "Playlist",
    tracklist: Array.from({ length: 201 }, (_, index) => ({ title: `Song ${index}` }))
  }), neverCall);
  assert.equal(tooMany.status, 400);
  assert.match((await tooMany.json()).message, /between 1 and 200 tracks/);
  assert.equal(calls, 0);
});

test("Soundiiz proxy validates JSON, track titles and returned share URLs", async () => {
  const invalidJson = await handleSoundiizImport(makeRequest("{"), async () => Response.json({}));
  assert.equal(invalidJson.status, 400);

  const missingTitle = await handleSoundiizImport(
    makeRequest({ title: "Playlist", tracklist: [{ artists: ["Artist"] }] }),
    async () => Response.json({})
  );
  assert.equal(missingTitle.status, 400);

  const unsafeLink = await handleSoundiizImport(
    makeRequest({ title: "Playlist", tracklist: [{ title: "Song" }] }),
    async () => Response.json({ shareUrl: "https://evil.example/go/import-playlist/token" })
  );
  assert.equal(unsafeLink.status, 502);
  assert.match((await unsafeLink.json()).message, /invalid transfer link/);
});

test("Soundiiz proxy returns useful upstream failures without losing the manual-link fallback", async () => {
  const rateLimited = await handleSoundiizImport(
    makeRequest({ title: "Playlist", tracklist: [{ title: "Song", artists: ["Artist"] }] }),
    async () => Response.json(
      { status: "error", message: "Ten requests per minute are allowed." },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  );
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.headers.get("Retry-After"), "60");
  assert.match((await rateLimited.json()).message, /Ten requests per minute/);

  const unavailable = await handleSoundiizImport(
    makeRequest({ title: "Playlist", tracklist: [{ title: "Song" }] }),
    async () => { throw new Error("network unavailable"); }
  );
  assert.equal(unavailable.status, 502);
  assert.match((await unavailable.json()).message, /search links are still available/);
});

test("Cloudflare Pages publishes the same-origin Soundiiz function alongside the static site", async () => {
  const wrangler = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(wrangler, /pages_build_output_dir = "\.\/public"/);
  assert.match(functionSource, /export async function onRequestPost/);
  assert.match(functionSource, /APPLE_MUSIC_DESTINATION = "applemusicapp"/);
});
