import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, styles, migration] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260922121436_album_review_comments.sql", import.meta.url), "utf8")
]);

test("reviews load comments, commenter profiles and counts", () => {
  assert.match(app, /\.from\("album_review_comments"\)[\s\S]*?\.select\("id,review_id,user_id,comment_text,created_at,updated_at"\)/);
  assert.match(app, /\[\.\.\.reviews, \.\.\.\(comments \|\| \[\]\)\]/);
  assert.match(app, /comments: \(comments \|\| \[\]\)/);
  assert.match(app, /comments\.length} comment/);
});

test("review cards provide compact expandable in-place comment controls", () => {
  assert.match(app, /function renderAlbumReviewComments/);
  assert.match(app, /aria-expanded=/);
  assert.match(app, /Add comment/);
  assert.match(app, /async function saveAlbumReviewComment/);
  assert.match(app, /async function editAlbumReviewComment/);
  assert.match(app, /async function deleteAlbumReviewComment/);
  assert.match(app, /section\.outerHTML = renderAlbumReviewsSection\(albumId, reviews\)/);
  assert.match(styles, /\.review-comment-toggle/);
  assert.match(styles, /\.review-comment-form/);
});

test("comment controls reflect ownership and admin moderation without review-owner privilege", () => {
  assert.match(app, /const ownsComment = currentUser\?\.id === comment\.user_id/);
  assert.match(app, /const canDelete = ownsComment \|\| isAdmin/);
  assert.match(app, /Delete\$\{isAdmin && !ownsComment \? " as Admin"/);
  assert.doesNotMatch(app, /review\.user_id === currentUser\?\.id[\s\S]{0,120}deleteAlbumReviewComment/);
});

test("migration enforces identity, ownership, moderation, length, visibility and cascade", () => {
  assert.match(migration, /id uuid primary key default gen_random_uuid\(\)/i);
  assert.match(migration, /references public\.album_reviews\(id\) on delete cascade/i);
  assert.match(migration, /char_length\(btrim\(comment_text\)\) between 1 and 500/i);
  assert.match(migration, /for select[\s\S]*?exists \([\s\S]*?from public\.album_reviews/i);
  assert.match(migration, /for insert[\s\S]*?to authenticated[\s\S]*?user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /for update[\s\S]*?using \(user_id = \(select auth\.uid\(\)\)\)[\s\S]*?with check/i);
  assert.match(migration, /Users can delete their own comments[\s\S]*?user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /Admins can delete any comment[\s\S]*?profile\.is_admin is true/i);
  assert.doesNotMatch(migration, /album_reviews[\s\S]*?review\.user_id = \(select auth\.uid\(\)\)[\s\S]*?for delete/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[^;]* to anon/i);
});
