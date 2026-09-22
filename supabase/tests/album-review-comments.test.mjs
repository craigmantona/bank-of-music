import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL("../migrations/20260922120000_album_review_comments.sql", import.meta.url),
  "utf8"
);

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const COMMENTER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const REVIEW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
    create table public.profiles (id uuid primary key, is_admin boolean not null default false);
    create table public.album_reviews (
      id uuid primary key,
      user_id uuid not null references auth.users(id) on delete cascade
    );
    alter table public.album_reviews enable row level security;
    create policy "Reviews are readable" on public.album_reviews for select to anon, authenticated using (true);
    insert into auth.users(id) values ('${OWNER_ID}'),('${COMMENTER_ID}'),('${OTHER_ID}'),('${ADMIN_ID}');
    insert into profiles(id,is_admin) values
      ('${OWNER_ID}',false),('${COMMENTER_ID}',false),('${OTHER_ID}',false),('${ADMIN_ID}',true);
    insert into album_reviews(id,user_id) values ('${REVIEW_ID}','${OWNER_ID}');
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant select on public.album_reviews, public.profiles to anon, authenticated;
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

async function addComment(db, userId = COMMENTER_ID, text = "Thoughtful take") {
  return asRole(db, "authenticated", userId, `
    insert into album_review_comments(review_id,user_id,comment_text)
    values ('${REVIEW_ID}','${userId}','${text.replaceAll("'", "''")}') returning id
  `);
}

test("comments follow review visibility and authenticated users can only create as themselves", async () => {
  const db = await fixture();
  try {
    await assert.rejects(
      asRole(db, "anon", null, `insert into album_review_comments(review_id,user_id,comment_text) values ('${REVIEW_ID}','${COMMENTER_ID}','No')`),
      /permission denied/
    );
    await assert.rejects(
      asRole(db, "authenticated", COMMENTER_ID, `insert into album_review_comments(review_id,user_id,comment_text) values ('${REVIEW_ID}','${OTHER_ID}','Spoofed')`),
      /row-level security/
    );
    await addComment(db);
    assert.equal((await asRole(db, "anon", null, "select * from album_review_comments")).rows.length, 1);
  } finally {
    await db.close();
  }
});

test("only comment owners can edit and review ownership does not grant deletion", async () => {
  const db = await fixture();
  try {
    const commentId = (await addComment(db)).rows[0].id;
    const otherUpdate = await asRole(db, "authenticated", OTHER_ID, `update album_review_comments set comment_text='Changed' where id='${commentId}' returning id`);
    assert.equal(otherUpdate.rows.length, 0);
    const ownerDelete = await asRole(db, "authenticated", OWNER_ID, `delete from album_review_comments where id='${commentId}' returning id`);
    assert.equal(ownerDelete.rows.length, 0);
    const ownUpdate = await asRole(db, "authenticated", COMMENTER_ID, `update album_review_comments set comment_text='Edited' where id='${commentId}' returning comment_text`);
    assert.equal(ownUpdate.rows[0].comment_text, "Edited");
    const ownDelete = await asRole(db, "authenticated", COMMENTER_ID, `delete from album_review_comments where id='${commentId}' returning id`);
    assert.equal(ownDelete.rows.length, 1);
  } finally {
    await db.close();
  }
});

test("admins can moderate any comment but ordinary users cannot", async () => {
  const db = await fixture();
  try {
    const commentId = (await addComment(db)).rows[0].id;
    assert.equal((await asRole(db, "authenticated", OTHER_ID, `delete from album_review_comments where id='${commentId}' returning id`)).rows.length, 0);
    assert.equal((await asRole(db, "authenticated", ADMIN_ID, `delete from album_review_comments where id='${commentId}' returning id`)).rows.length, 1);
  } finally {
    await db.close();
  }
});

test("database validates comment length and cascades review deletion", async () => {
  const db = await fixture();
  try {
    await assert.rejects(addComment(db, COMMENTER_ID, " "), /check constraint/);
    await assert.rejects(addComment(db, COMMENTER_ID, "x".repeat(501)), /check constraint/);
    await addComment(db, COMMENTER_ID, "x".repeat(500));
    await db.query(`delete from album_reviews where id='${REVIEW_ID}'`);
    assert.equal((await db.query("select count(*)::int count from album_review_comments")).rows[0].count, 0);
  } finally {
    await db.close();
  }
});
