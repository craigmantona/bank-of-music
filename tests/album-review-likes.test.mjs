import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, styles, migration] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260920183000_album_review_likes.sql", import.meta.url), "utf8")
]);

test("review likes load with each review and current-user state", () => {
  assert.match(app, /\.from\("album_review_likes"\)[\s\S]*?\.select\("review_id,user_id"\)/);
  assert.match(app, /like_count:/);
  assert.match(app, /liked_by_current_user:/);
});

test("community review cards expose an in-place Like and Unlike toggle", () => {
  assert.match(app, /function renderAlbumReviewLikeControl/);
  assert.match(app, /review\.liked_by_current_user \? "Unlike" : "Like"/);
  assert.match(app, /async function toggleAlbumReviewLike/);
  assert.match(app, /\.from\("album_review_likes"\)[\s\S]*?\.delete\(\)[\s\S]*?\.insert\(/);
  assert.match(app, /section\.outerHTML = renderAlbumReviewsSection\(albumId, reviews\)/);
});

test("own reviews show a count without a like control", () => {
  assert.match(app, /currentUser\.id === review\.user_id[\s\S]*?review-like-count/);
  assert.match(app, /if \(currentUser\.id === reviewOwnerId\) return/);
});

test("review likes use the existing modern pill treatment", () => {
  assert.match(styles, /\.review-like-btn,[\s\S]*?border-radius: 999px/);
  assert.match(styles, /\.review-like-btn\.is-liked/);
});

test("migration enforces identity, uniqueness, cascading cleanup and narrow grants", () => {
  assert.match(migration, /primary key \(review_id, user_id\)/i);
  assert.match(migration, /references public\.album_reviews\(id\) on delete cascade/i);
  assert.match(migration, /references auth\.users\(id\) on delete cascade/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /for insert[\s\S]*?to authenticated[\s\S]*?user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /review\.user_id <> \(select auth\.uid\(\)\)/i);
  assert.match(migration, /for delete[\s\S]*?to authenticated[\s\S]*?user_id = \(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(migration, /grant (?:insert|delete|all)[^;]* to anon/i);
});
