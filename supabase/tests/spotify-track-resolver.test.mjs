import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { loadEdge } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");

const source = readFileSync(
  new URL("../functions/rapid-processor/spotify-token.ts", import.meta.url),
  "utf8"
);
const spotifyId = number => String(number).padStart(22, "0");
const recordingId = "d795c2fd-7d3b-4873-968a-968f9e33765e";

function spotifyTrack(id, { title = "The Song", artist = "The Artist", album = "The Album" } = {}) {
  return {
    id,
    name: title,
    artists: [{ name: artist }],
    album: { name: album },
    is_local: false,
    is_playable: true,
    external_ids: {}
  };
}

function resolver({
  storedId = null,
  candidates = [],
  occurrences = [],
  isrcs = [],
  isrcCandidates = [],
  songOverrides = {},
  searchStatus = 200,
  retryAfter = null
} = {}) {
  let handler;
  const updates = [];
  const requests = [];
  const song = {
    id: 42,
    title: "The Song (2011 Remaster)",
    artist: "The Artist",
    album_id: 9,
    is_deleted: false,
    spotify_track_id: storedId,
    spotify_matched_at: storedId ? "2026-09-25T00:00:00.000Z" : null,
    external_source: "musicbrainz",
    external_id: recordingId,
    ...songOverrides
  };

  function query(table) {
    let operation = "select";
    let updateValues = null;
    let selected = "";
    let occurrenceLookup = false;
    return {
      select(columns = "") { selected = columns; return this; },
      eq(column) { if (column === "external_id") occurrenceLookup = true; return this; },
      ilike(column) { if (column === "external_id") occurrenceLookup = true; return this; },
      not() { return this; },
      is() { return this; },
      update(values) { operation = "update"; updateValues = values; updates.push(values); return this; },
      async maybeSingle() {
        if (table === "albums") return { data: { title: "The Album" }, error: null };
        if (operation === "update") return {
          data: { spotify_track_id: updateValues.spotify_track_id, spotify_matched_at: updateValues.spotify_matched_at },
          error: null
        };
        return { data: selected === "spotify_track_id" ? { spotify_track_id: song.spotify_track_id } : song, error: null };
      },
      async then(resolve) {
        resolve(occurrenceLookup
          ? { data: occurrences, error: null }
          : { data: [], error: null });
      }
    };
  }

  loadEdge(source.replace(/^export /gm, ""), {
    btoa: value => Buffer.from(value).toString("base64"),
    URLSearchParams,
    Deno: {
      env: { get: name => ({
        SUPABASE_URL: "https://project.invalid",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
        SPOTIFY_CLIENT_ID: "client-id",
        SPOTIFY_CLIENT_SECRET: "client-secret",
        SPOTIFY_REDIRECT_URI: "https://example.invalid/callback"
      })[name] || "" },
      serve: fn => { handler = fn; }
    },
    getAdminKey: () => "service-key",
    requireAuthenticatedUser: async () => ({ ok: true, user: { id: "user-id" } }),
    createClient: () => ({ from: query }),
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes("api/token")) {
        return Response.json({ access_token: "app-token", expires_in: 3600 });
      }
      if (String(url).includes("musicbrainz.org")) {
        return Response.json({ id: song.external_id, isrcs });
      }
      const spotifyCandidates = decodeURIComponent(String(url)).includes("q=isrc:")
        ? isrcCandidates
        : candidates;
      return new Response(JSON.stringify({ tracks: { items: spotifyCandidates } }), {
        status: searchStatus,
        headers: {
          "Content-Type": "application/json",
          ...(retryAfter ? { "Retry-After": String(retryAfter) } : {})
        }
      });
    }
  });

  return {
    updates,
    requests,
    run: async () => {
      const response = await handler(new Request("https://project.invalid/functions/v1/rapid-processor", {
        method: "POST",
        headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve_track", song_id: 42 })
      }));
      return { response, body: await response.json() };
    }
  };
}

function spotifyTokenHandler() {
  let handler;
  const requests = [];

  loadEdge(source.replace(/^export /gm, ""), {
    btoa: value => Buffer.from(value).toString("base64"),
    URLSearchParams,
    Deno: {
      env: { get: name => ({
        SPOTIFY_CLIENT_ID: "client-id",
        SPOTIFY_CLIENT_SECRET: "client-secret",
        SPOTIFY_REDIRECT_URI: "https://thebankofmusic.com/"
      })[name] || "" },
      serve: fn => { handler = fn; }
    },
    requireAuthenticatedUser: async () => ({ ok: true, user: { id: "user-id" } }),
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      return Response.json({ access_token: "spotify-user-token", expires_in: 3600 });
    }
  });

  return { handler, requests };
}

test("Spotify token function permits the canonical production origin", async () => {
  const { handler } = spotifyTokenHandler();
  const response = await handler(new Request("https://project.invalid/functions/v1/rapid-processor", {
    method: "OPTIONS",
    headers: { Origin: "https://thebankofmusic.com" }
  }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://thebankofmusic.com");
  assert.equal(response.headers.get("Vary"), "Origin");
});

test("Spotify token exchange uses the redirect URI supplied by the canonical frontend", async () => {
  const { handler, requests } = spotifyTokenHandler();
  const response = await handler(new Request("https://project.invalid/functions/v1/rapid-processor", {
    method: "POST",
    headers: {
      Authorization: "Bearer user-token",
      "Content-Type": "application/json",
      Origin: "https://thebankofmusic.com"
    },
    body: JSON.stringify({
      action: "exchange",
      code: "authorization-code",
      redirect_uri: "https://thebankofmusic.com/"
    })
  }));

  assert.equal(response.status, 200, await response.text());
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://thebankofmusic.com");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://accounts.spotify.com/api/token");
  assert.equal(requests[0].options.body.get("redirect_uri"), "https://thebankofmusic.com/");
});

test("Spotify token exchange retains the legacy redirect for cached clients during rollout", async () => {
  const { handler, requests } = spotifyTokenHandler();
  const response = await handler(new Request("https://project.invalid/functions/v1/rapid-processor", {
    method: "POST",
    headers: {
      Authorization: "Bearer user-token",
      "Content-Type": "application/json",
      Origin: "https://bank-of-music.pages.dev"
    },
    body: JSON.stringify({ action: "exchange", code: "authorization-code" })
  }));

  assert.equal(response.status, 200, await response.text());
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://bank-of-music.pages.dev");
  assert.equal(requests[0].options.body.get("redirect_uri"), "https://bank-of-music.pages.dev/");
});

test("Spotify resolver returns a centrally stored track without an API call", async () => {
  const app = resolver({ storedId: spotifyId(1) });
  const result = await app.run();
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body, { status: "matched", spotify_track_id: spotifyId(1), cached: true, identity_source: "stored" });
  assert.equal(app.requests.length, 0);
  assert.equal(app.updates.length, 0);
});

test("Spotify resolver persists one strict confident match", async () => {
  const app = resolver({ candidates: [
    spotifyTrack(spotifyId(2)),
    spotifyTrack(spotifyId(3), { title: "Another Song", album: "Another Album" })
  ] });
  const result = await app.run();
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.spotify_track_id, spotifyId(2));
  assert.equal(result.body.cached, false);
  assert.equal(app.requests.filter(item => item.url.includes("/v1/search?")).length, 1);
  assert.equal(app.updates.length, 1);
  assert.equal(app.updates[0].spotify_track_id, spotifyId(2));
  assert.ok(app.updates[0].spotify_matched_at);
  assert.equal(app.requests.filter(item => item.url.includes("musicbrainz.org")).length, 0);
});

test("Spotify resolver reuses and persists an exact MusicBrainz recording occurrence", async () => {
  const sharedId = spotifyId(6);
  const app = resolver({
    occurrences: [{ id: 99, spotify_track_id: sharedId }],
    songOverrides: { title: "A completely different release title" }
  });
  const result = await app.run();
  assert.deepEqual(result.body, {
    status: "matched", spotify_track_id: sharedId, cached: true, identity_source: "recording"
  });
  assert.equal(app.requests.length, 0);
  assert.equal(app.updates[0].spotify_track_id, sharedId);
});

test("Spotify resolver never propagates by artist/title or missing/different recording identity", async () => {
  for (const externalId of [null, "11111111-1111-4111-8111-111111111111"]) {
    const app = resolver({
      occurrences: [],
      songOverrides: { external_id: externalId },
      candidates: []
    });
    const result = await app.run();
    assert.deepEqual(result.body, { status: "no_match" });
    assert.equal(app.updates.length, 0);
  }
});

test("Libertines combined title resolves only through an exact authoritative ISRC", async () => {
  const exactIsrc = "GBCVZ0300876";
  const matchedId = spotifyId(8);
  const candidate = spotifyTrack(matchedId, {
    title: "What Became of the Likely Lads",
    artist: "The Libertines",
    album: "The Libertines"
  });
  candidate.external_ids.isrc = exactIsrc;
  const app = resolver({
    songOverrides: {
      id: 6369,
      title: "What Became of the Likely Lads / France",
      artist: "The Libertines",
      external_id: recordingId
    },
    isrcs: [exactIsrc],
    isrcCandidates: [candidate]
  });
  const result = await app.run();
  assert.equal(result.body.spotify_track_id, matchedId);
  assert.equal(result.body.identity_source, "isrc");
  assert.equal(app.updates[0].spotify_track_id, matchedId);
  const searches = app.requests.filter(item => item.url.includes("/v1/search?"));
  assert.equal(searches.length, 2);
  assert.equal(new URL(searches[0].url).searchParams.get("q"),
    "track:What Became of the Likely Lads / France artist:The Libertines");
  assert.equal(new URL(searches[1].url).searchParams.get("q"), "isrc:GBCVZ0300876");
});

test("Spotify resolver rejects an ISRC candidate that does not exactly match MusicBrainz", async () => {
  const candidate = spotifyTrack(spotifyId(9), { title: "Shorter title" });
  candidate.external_ids.isrc = "GBCVZ9999999";
  const app = resolver({ isrcs: ["GBCVZ0300876"], isrcCandidates: [candidate] });
  const result = await app.run();
  assert.deepEqual(result.body, { status: "no_match" });
  assert.equal(app.updates.length, 0);
});

test("Spotify resolver does not persist an ambiguous match", async () => {
  const app = resolver({ candidates: [spotifyTrack(spotifyId(4)), spotifyTrack(spotifyId(5))] });
  const result = await app.run();
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { status: "no_match" });
  assert.equal(app.updates.length, 0);
});

test("Spotify resolver preserves 429 Retry-After and makes no write", async () => {
  const app = resolver({ searchStatus: 429, retryAfter: 7 });
  const result = await app.run();
  assert.equal(result.response.status, 429, JSON.stringify(result.body));
  assert.equal(result.response.headers.get("Retry-After"), "7");
  assert.equal(result.body.retry_after, 7);
  assert.equal(app.updates.length, 0);
});

test("Spotify match migration keeps fields nullable and blocks ordinary client assignment", () => {
  const migration = readFileSync(
    new URL("../migrations/20260925143542_add_song_spotify_match.sql", import.meta.url),
    "utf8"
  );
  const schema = readFileSync(new URL("../exports/production_schema.sql", import.meta.url), "utf8");
  assert.match(migration, /add column if not exists spotify_track_id text/);
  assert.match(migration, /add column if not exists spotify_matched_at timestamptz/);
  assert.doesNotMatch(migration, /not null|grant\s+update|create\s+policy/i);
  assert.match(migration, /before insert or update of spotify_track_id, spotify_matched_at/);
  assert.match(migration, /auth\.jwt\(\) ->> 'role'.*'service_role'/s);
  assert.match(migration, /where id = auth\.uid\(\) and is_admin = true/);
  assert.match(migration, /raise exception 'Spotify matches may only be assigned/);
  assert.match(schema, /CREATE POLICY "Admins can do anything on songs"[\s\S]*?"is_admin" = true/);
  assert.doesNotMatch(schema, /CREATE POLICY "[^"]+" ON "public"\."songs" FOR UPDATE/);
});

test("ordinary database clients cannot assign Spotify matches but service role can", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.jwt() returns jsonb language sql stable as
        'select coalesce(nullif(current_setting(''request.jwt.claims'', true), ''''), ''{}'')::jsonb';
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      create table public.profiles(id uuid primary key, is_admin boolean default false);
      create table public.songs(id bigint generated by default as identity primary key, title text);
    `);
    await db.exec(readFileSync(
      new URL("../migrations/20260925143542_add_song_spotify_match.sql", import.meta.url),
      "utf8"
    ));

    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "authenticated" })]);
    await assert.rejects(
      db.query("insert into songs(title,spotify_track_id) values('Blocked','client123')"),
      /trusted backend or admin/
    );
    await db.query("insert into songs(title) values('Ordinary insert')");

    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "service_role" })]);
    await db.query("insert into songs(title,spotify_track_id,spotify_matched_at) values('Trusted','server456',now())");
    const rows = await db.query("select spotify_track_id from songs where title='Trusted'");
    assert.equal(rows.rows[0].spotify_track_id, "server456");
  } finally {
    await db.close();
  }
});
