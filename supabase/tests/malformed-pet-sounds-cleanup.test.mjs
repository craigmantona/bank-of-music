import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL("../migrations/20261004130000_cleanup_malformed_pet_sounds.sql", import.meta.url),
  "utf8"
);

const ADMIN_ID = "076d961e-c330-4cf7-a820-e0b45a8b8cd0";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const RELEASE_ID = "554484cc-7e87-3066-ab01-12133d9e47ca";
const RECORDING_ID = "e69ad76d-d2c0-4981-a39b-78d8794c7f0d";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';

    create table public.profiles(id uuid primary key, is_admin boolean not null default false);
    create table public.albums(
      id bigint primary key, title text not null, artist text not null,
      external_source text, external_id text, is_deleted boolean default false,
      musicbrainz_release_id text, musicbrainz_release_group_id text,
      cover_art_url text
    );
    create table public.songs(
      id bigint primary key, title text not null, artist text not null,
      album_id bigint references public.albums(id) on delete set null,
      external_source text, external_id text, is_deleted boolean default false,
      spotify_track_id text, track_position integer
    );
    create table public.song_ratings(
      id bigint primary key, user_id uuid not null, song_id bigint references public.songs(id) on delete cascade,
      rating numeric not null, created_at timestamptz not null default now(), unique(user_id,song_id)
    );
    create table public.ratings(
      id bigint primary key, user_id uuid not null, album_id bigint,
      rating numeric not null, created_at timestamptz not null default now(), unique(user_id,album_id)
    );
    create table public.album_reviews(id uuid primary key, user_id uuid not null, album_id bigint not null);
    create table public.catalogue_release_group_exclusions(
      musicbrainz_release_group_id text primary key, artist text not null, title text not null
    );
    create view public.album_rating_charts as
      select a.id item_id, a.title, a.artist, avg(r.rating) average_rating, count(r.rating) rating_count
      from public.ratings r join public.albums a on a.id=r.album_id group by a.id,a.title,a.artist;
    create view public.song_rating_charts as
      select s.id item_id, s.title, s.artist, s.album_id, avg(r.rating) average_rating, count(r.rating) rating_count
      from public.song_ratings r join public.songs s on s.id=r.song_id group by s.id,s.title,s.artist,s.album_id;

    insert into public.profiles values('${ADMIN_ID}',true),('${MEMBER_ID}',false);
    insert into public.albums(id,title,artist,external_source,external_id,is_deleted) values
      (3,'Pet Sounds','Pet Sounds',null,null,false),
      (9,'Pet Sounds','The Beach Boys','musicbrainz','${RELEASE_ID}',false);
    insert into public.songs(id,title,artist,album_id,external_source,external_id,is_deleted,spotify_track_id) values
      (1,'God only knows','The Beach Boys',3,null,null,false,null),
      (227,'God Only Knows','The Beach Boys',9,'musicbrainz','${RECORDING_ID}',false,null);
    insert into public.song_ratings(id,user_id,song_id,rating,created_at) values
      (1,'${ADMIN_ID}',1,8,'2026-04-09T10:18:19Z'),
      (165,'${ADMIN_ID}',227,8,'2026-05-04T17:31:32Z');
    insert into public.ratings(id,user_id,album_id,rating,created_at) values
      (13,'${ADMIN_ID}',3,8,'2026-04-09T10:18:42Z'),
      (18,'${ADMIN_ID}',9,10,'2026-04-10T10:29:10Z');

    grant usage on schema public,auth to authenticated,service_role;
    grant select on public.profiles to authenticated;
    grant select,update,delete on public.albums,public.songs,public.song_ratings,public.ratings,public.album_reviews to authenticated;
    alter table public.albums enable row level security;
    alter table public.songs enable row level security;
    alter table public.song_ratings enable row level security;
    alter table public.ratings enable row level security;
    create policy albums_admin on public.albums to authenticated using(
      exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_admin));
    create policy songs_admin on public.songs to authenticated using(
      exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_admin));
    create policy song_ratings_admin on public.song_ratings to authenticated using(
      exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_admin));
    create policy ratings_admin on public.ratings to authenticated using(
      exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_admin));
  `);
  await db.exec(migration);
  return db;
}

async function asUser(db, userId, execute) {
  await db.exec(`set role authenticated; set "request.jwt.claim.sub"='${userId}'`);
  try {
    return await db.query("select public.admin_cleanup_malformed_pet_sounds($1) result", [execute]);
  } finally {
    await db.exec('reset role; reset "request.jwt.claim.sub"');
  }
}

test("admin cleanup permanently deletes only the four malformed records atomically", async () => {
  const db = await fixture();
  try {
    const preview = (await asUser(db, ADMIN_ID, false)).rows[0].result;
    assert.equal(preview.status, "preview");
    assert.equal((await db.query("select count(*)::int n from albums where id=3")).rows[0].n, 1);

    const result = (await asUser(db, ADMIN_ID, true)).rows[0].result;
    assert.equal(result.status, "deleted");
    assert.equal((await db.query("select count(*)::int n from albums where id=3")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from songs where id=1")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from ratings where id=13")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from song_ratings where id=1")).rows[0].n, 0);

    const destination = (await db.query(`select a.id album_id,a.external_id release_id,s.id song_id,
      s.external_id recording_id,sr.id song_rating_id,sr.rating song_rating,r.id album_rating_id,r.rating album_rating
      from albums a join songs s on s.album_id=a.id join song_ratings sr on sr.song_id=s.id
      join ratings r on r.album_id=a.id where a.id=9 and s.id=227`)).rows[0];
    assert.equal(Number(destination.album_id), 9);
    assert.equal(destination.release_id, RELEASE_ID);
    assert.equal(Number(destination.song_id), 227);
    assert.equal(destination.recording_id, RECORDING_ID);
    assert.equal(Number(destination.song_rating_id), 165);
    assert.equal(Number(destination.song_rating), 8);
    assert.equal(Number(destination.album_rating_id), 18);
    assert.equal(Number(destination.album_rating), 10);
    assert.equal((await db.query("select count(*)::int n from catalogue_release_group_exclusions")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("permanent cleanup removes malformed catalogue, search source and chart rows", async () => {
  const db = await fixture();
  try {
    await asUser(db, ADMIN_ID, true);
    assert.equal((await db.query("select count(*)::int n from albums where id=3 and not is_deleted")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from songs where id=1 and not is_deleted")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from album_rating_charts where item_id=3")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from song_rating_charts where item_id=1")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from album_rating_charts where item_id=9")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int n from song_rating_charts where item_id=227")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("changed expected state aborts the entire cleanup", async () => {
  const db = await fixture();
  try {
    await db.exec("update songs set title='Changed' where id=1");
    await assert.rejects(asUser(db, ADMIN_ID, true), /source state has changed/);
    for (const [table, id] of [["albums",3],["songs",1],["ratings",13],["song_ratings",1]]) {
      assert.equal((await db.query(`select count(*)::int n from ${table} where id=$1`, [id])).rows[0].n, 1);
    }
    assert.equal((await db.query("select count(*)::int n from albums where id=9")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int n from songs where id=227")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("ordinary users cannot invoke the cleanup", async () => {
  const db = await fixture();
  try {
    await assert.rejects(asUser(db, MEMBER_ID, true), /Admin access required/);
    assert.equal((await db.query("select count(*)::int n from albums where id in (3,9)")).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::int n from songs where id in (1,227)")).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::int n from ratings where id in (13,18)")).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::int n from song_ratings where id in (1,165)")).rows[0].n, 2);
  } finally { await db.close(); }
});
