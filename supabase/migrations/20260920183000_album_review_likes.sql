create table if not exists public.album_review_likes (
  review_id uuid not null references public.album_reviews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

alter table public.album_review_likes enable row level security;

create policy "Album review likes are readable"
on public.album_review_likes
for select
using (true);

create policy "Users can like another user's album review"
on public.album_review_likes
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.album_reviews review
    where review.id = review_id
      and review.user_id <> (select auth.uid())
  )
);

create policy "Users can remove their own album review like"
on public.album_review_likes
for delete
to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.album_review_likes from public;
grant select on table public.album_review_likes to anon;
grant select, insert, delete on table public.album_review_likes to authenticated;
grant all on table public.album_review_likes to service_role;
