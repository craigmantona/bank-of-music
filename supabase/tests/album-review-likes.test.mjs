import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL("../migrations/20260920183000_album_review_likes.sql", import.meta.url),
  "utf8"
);

const AUTHOR_ID = "11111111-1111-4111-8111-111111111111";
const READER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    create table auth.users (id uuid primary key);
    create table public.album_reviews (
      id uuid primary key,
      user_id uuid not null references auth.users(id) on delete cascade,
      album_id bigint not null,
      review_text text not null
    );
    insert into auth.users(id) values ('${AUTHOR_ID}'),('${READER_ID}'),('${OTHER_ID}');
    insert into album_reviews(id,user_id,album_id,review_text) values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${AUTHOR_ID}',35,'Great record');
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant select on public.album_reviews to authenticated;
  `);
  await db.exec(migration);
  return db;
}

async function asRole(db, role, userId, sql) {
  await db.exec(`set role ${role}; set "request.jwt.claim.sub" = '${userId || ""}'`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec('reset role; reset "request.jwt.claim.sub"');
  }
}

test("authenticated users can like another user's review once and remove their own like", async () => {
  const db = await fixture();
  try {
    await asRole(db, "authenticated", READER_ID, `
      insert into album_review_likes(review_id,user_id)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${READER_ID}')
    `);
    await assert.rejects(
      asRole(db, "authenticated", READER_ID, `
        insert into album_review_likes(review_id,user_id)
        values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${READER_ID}')
      `),
      /duplicate key/
    );
    const hiddenDelete = await asRole(db, "authenticated", OTHER_ID, `
      delete from album_review_likes
      where review_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='${READER_ID}'
      returning user_id
    `);
    assert.equal(hiddenDelete.rows.length, 0);
    const ownDelete = await asRole(db, "authenticated", READER_ID, `
      delete from album_review_likes
      where review_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='${READER_ID}'
      returning user_id
    `);
    assert.equal(ownDelete.rows.length, 1);
  } finally {
    await db.close();
  }
});

test("anonymous writes, identity spoofing and liking one's own review are rejected", async () => {
  const db = await fixture();
  try {
    await assert.rejects(
      asRole(db, "anon", null, `
        insert into album_review_likes(review_id,user_id)
        values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${READER_ID}')
      `),
      /permission denied/
    );
    await assert.rejects(
      asRole(db, "authenticated", READER_ID, `
        insert into album_review_likes(review_id,user_id)
        values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${OTHER_ID}')
      `),
      /row-level security/
    );
    await assert.rejects(
      asRole(db, "authenticated", AUTHOR_ID, `
        insert into album_review_likes(review_id,user_id)
        values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${AUTHOR_ID}')
      `),
      /row-level security/
    );
  } finally {
    await db.close();
  }
});

test("likes are readable and cascade when their review is deleted", async () => {
  const db = await fixture();
  try {
    await asRole(db, "authenticated", READER_ID, `
      insert into album_review_likes(review_id,user_id)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${READER_ID}')
    `);
    const publicLikes = await asRole(db, "anon", null, "select review_id,user_id from album_review_likes");
    assert.equal(publicLikes.rows.length, 1);
    await db.query("delete from album_reviews where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
    assert.equal((await db.query("select count(*)::int count from album_review_likes")).rows[0].count, 0);
  } finally {
    await db.close();
  }
});
