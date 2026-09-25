create table public.album_review_comments (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.album_reviews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  comment_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint album_review_comments_text_length
    check (char_length(btrim(comment_text)) between 1 and 500)
);

create index album_review_comments_review_created_idx
  on public.album_review_comments (review_id, created_at);

alter table public.album_review_comments enable row level security;

create policy "Comments follow review visibility"
on public.album_review_comments
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.album_reviews review
    where review.id = review_id
  )
);

create policy "Authenticated users can create their own comments"
on public.album_review_comments
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and exists (
    select 1
    from public.album_reviews review
    where review.id = review_id
  )
);

create policy "Users can update their own comments"
on public.album_review_comments
for update
to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.album_reviews review
    where review.id = review_id
  )
);

create policy "Users can delete their own comments"
on public.album_review_comments
for delete
to authenticated
using (user_id = (select auth.uid()));

create policy "Admins can delete any comment"
on public.album_review_comments
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.is_admin is true
  )
);

revoke all on table public.album_review_comments from public, anon, authenticated;
grant select on table public.album_review_comments to anon;
grant select, delete on table public.album_review_comments to authenticated;
grant insert (review_id, user_id, comment_text) on table public.album_review_comments to authenticated;
grant update (comment_text, updated_at) on table public.album_review_comments to authenticated;
grant all on table public.album_review_comments to service_role;
