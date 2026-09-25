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

function spotifyTrack(id, { title = "The Song", artist = "The Artist", album = "The Album" } = {}) {
  return {
    id,
    name: title,
    artists: [{ name: artist }],
    album: { name: album },
    is_local: false,
    is_playable: true
  };
}

function resolver({ storedId = null, candidates = [], searchStatus = 200, retryAfter = null } = {}) {
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
    spotify_matched_at: storedId ? "2026-09-25T00:00:00.000Z" : null
  };

  function query(table) {
    let operation = "select";
    let updateValues = null;
    return {
      select() { return this; },
      eq() { return this; },
      is() { return this; },
      update(values) { operation = "update"; updateValues = values; updates.push(values); return this; },
      async maybeSingle() {
        if (table === "albums") return { data: { title: "The Album" }, error: null };
        if (operation === "update") return {
          data: { spotify_track_id: updateValues.spotify_track_id, spotify_matched_at: updateValues.spotify_matched_at },
          error: null
        };
        return { data: song, error: null };
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
      return new Response(JSON.stringify({ tracks: { items: candidates } }), {
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

test("Spotify resolver returns a centrally stored track without an API call", async () => {
  const app = resolver({ storedId: "stored123" });
  const result = await app.run();
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body, { status: "matched", spotify_track_id: "stored123", cached: true });
  assert.equal(app.requests.length, 0);
  assert.equal(app.updates.length, 0);
});

test("Spotify resolver persists one strict confident match", async () => {
  const app = resolver({ candidates: [
    spotifyTrack("confident123"),
    spotifyTrack("unrelated456", { title: "Another Song", album: "Another Album" })
  ] });
  const result = await app.run();
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.spotify_track_id, "confident123");
  assert.equal(result.body.cached, false);
  assert.equal(app.requests.filter(item => item.url.includes("/v1/search?")).length, 1);
  assert.equal(app.updates.length, 1);
  assert.equal(app.updates[0].spotify_track_id, "confident123");
  assert.ok(app.updates[0].spotify_matched_at);
});

test("Spotify resolver does not persist an ambiguous match", async () => {
  const app = resolver({ candidates: [spotifyTrack("first123"), spotifyTrack("second456")] });
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
