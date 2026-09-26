import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const spotifyAuth = app.slice(
  app.indexOf("const SPOTIFY_CLIENT_ID"),
  app.indexOf("/* ============================================================\n   SPOTIFY PLAYLIST SYNCHRONISATION")
);

function createStorage(values = {}) {
  const entries = new Map(Object.entries(values));
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: key => entries.delete(key),
    entries
  };
}

function createContext({ response }) {
  const localStorage = createStorage({
    bom_spotify_access_token: "expired-access",
    bom_spotify_refresh_token: "persistent-refresh",
    bom_spotify_expires_at: "1"
  });
  const requests = [];
  const context = vm.createContext({
    console: { error() {} },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    Date,
    localStorage,
    TextEncoder,
    URL,
    URLSearchParams,
    window: {
      SPOTIFY_CLIENT_ID: "public-client-id",
      SPOTIFY_REDIRECT_URI: "https://example.invalid/",
      SUPABASE_URL: "https://project.invalid",
      SUPABASE_ANON_KEY: "anon-key",
      dispatchEvent() {},
      crypto: globalThis.crypto
    },
    supabaseClient: {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "bom-session" } }, error: null })
      }
    },
    fetch: async (...args) => {
      requests.push(args);
      return response();
    }
  });
  vm.runInContext(spotifyAuth, context);
  return { context, localStorage, requests };
}

test("expired Spotify access tokens refresh through the existing authenticated edge function", async () => {
  const { context, localStorage, requests } = createContext({
    response: () => new Response(JSON.stringify({ access_token: "fresh-access", expires_in: 3600 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  });

  assert.equal(await context.getValidSpotifyAccessToken(), "fresh-access");
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], "https://project.invalid/functions/v1/rapid-processor");
  assert.equal(requests[0][1].headers.Authorization, "Bearer bom-session");
  assert.deepEqual(JSON.parse(requests[0][1].body), {
    action: "refresh",
    refresh_token: "persistent-refresh"
  });
  assert.equal(localStorage.getItem("bom_spotify_access_token"), "fresh-access");
  assert.equal(localStorage.getItem("bom_spotify_refresh_token"), "persistent-refresh");
});

test("concurrent Spotify token checks share one refresh request", async () => {
  const { context, requests } = createContext({
    response: () => new Response(JSON.stringify({ access_token: "fresh-access", expires_in: 3600 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  });

  const tokens = await Promise.all([
    context.getValidSpotifyAccessToken(),
    context.getValidSpotifyAccessToken()
  ]);
  assert.deepEqual(tokens, ["fresh-access", "fresh-access"]);
  assert.equal(requests.length, 1);
});

test("an invalid Spotify refresh grant clears stale connection state", async () => {
  const { context, localStorage } = createContext({
    response: () => new Response(JSON.stringify({ error: "invalid_grant" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    })
  });

  assert.equal(await context.getValidSpotifyAccessToken(), null);
  assert.equal(localStorage.getItem("bom_spotify_access_token"), null);
  assert.equal(localStorage.getItem("bom_spotify_refresh_token"), null);
});
