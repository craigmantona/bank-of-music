create table public.catalogue_release_group_exclusions (
  musicbrainz_release_group_id text primary key
    check (musicbrainz_release_group_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  artist text not null,
  title text not null,
  excluded_at timestamptz not null default now(),
  excluded_by uuid default auth.uid()
);

alter table public.catalogue_release_group_exclusions enable row level security;

revoke all on public.catalogue_release_group_exclusions from public;
grant select on public.catalogue_release_group_exclusions to anon, authenticated;
grant insert, delete on public.catalogue_release_group_exclusions to authenticated;
grant all on public.catalogue_release_group_exclusions to service_role;

create policy "Catalogue exclusions are publicly readable"
on public.catalogue_release_group_exclusions
for select
to anon, authenticated
using (true);

create policy "Admins can insert catalogue exclusions"
on public.catalogue_release_group_exclusions
for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.is_admin is true
  )
);

create policy "Admins can restore catalogue exclusions"
on public.catalogue_release_group_exclusions
for delete
to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.is_admin is true
  )
);

insert into public.catalogue_release_group_exclusions
  (musicbrainz_release_group_id, artist, title, excluded_by)
values
  ('653895d1-b592-3758-8bb1-8b9ba2bd6cb0', 'The Beatles', 'Introducing… The Beatles', null),
  ('387bc6cc-ac60-365f-819b-fbc78c486065', 'The Beatles', 'The Beatles’ Second Album', null),
  ('d0c93a59-fc4d-3d76-ac38-9c1d11071802', 'The Beatles', 'The Beatles’ Long Tall Sally', null)
on conflict (musicbrainz_release_group_id) do nothing;

create or replace function public.admin_catalogue_delete_album(
  p_album_id bigint,
  p_execute boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_album public.albums%rowtype;
  v_track_count integer;
  v_album_rating_count integer;
  v_album_review_count integer;
  v_review_comment_count integer;
  v_review_like_count integer;
  v_track_rating_count integer;
  v_has_user_data boolean;
  v_status text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_admin is true
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_album_id is null or p_album_id <= 0 then
    raise exception 'Invalid album ID' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(9137, p_album_id::integer);

  select * into v_album
  from public.albums
  where id = p_album_id
  for update;

  if not found then
    raise exception 'Album not found' using errcode = '22023';
  end if;

  perform 1 from public.songs where album_id = p_album_id for update;

  select count(*)::integer into v_track_count from public.songs where album_id = p_album_id;
  select count(*)::integer into v_album_rating_count from public.ratings where album_id = p_album_id;
  select count(*)::integer into v_album_review_count from public.album_reviews where album_id = p_album_id;
  select count(*)::integer into v_review_comment_count
    from public.album_review_comments c join public.album_reviews r on r.id = c.review_id
    where r.album_id = p_album_id;
  select count(*)::integer into v_review_like_count
    from public.album_review_likes l join public.album_reviews r on r.id = l.review_id
    where r.album_id = p_album_id;
  select count(*)::integer into v_track_rating_count
    from public.song_ratings sr join public.songs s on s.id = sr.song_id
    where s.album_id = p_album_id;

  v_has_user_data := v_album_rating_count > 0 or v_album_review_count > 0
    or v_review_comment_count > 0 or v_review_like_count > 0 or v_track_rating_count > 0;

  if not p_execute then
    v_status := 'preview';
  else
    if coalesce(v_album.musicbrainz_release_group_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      insert into public.catalogue_release_group_exclusions
        (musicbrainz_release_group_id, artist, title, excluded_by)
      values
        (lower(v_album.musicbrainz_release_group_id), v_album.artist, v_album.title, auth.uid())
      on conflict (musicbrainz_release_group_id) do nothing;
    end if;

    if v_has_user_data then
      update public.songs set is_deleted = true where album_id = p_album_id;
      update public.albums set is_deleted = true where id = p_album_id;
      v_status := 'hidden';
    else
      delete from public.songs where album_id = p_album_id;
      delete from public.albums where id = p_album_id;
      v_status := 'deleted';
    end if;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'deletion_mode', case when v_has_user_data then 'hide' else 'delete' end,
    'album_id', v_album.id,
    'artist', v_album.artist,
    'title', v_album.title,
    'track_count', v_track_count,
    'album_rating_count', v_album_rating_count,
    'album_review_count', v_album_review_count,
    'review_comment_count', v_review_comment_count,
    'review_like_count', v_review_like_count,
    'track_rating_count', v_track_rating_count
  );
end;
$$;

revoke all on function public.admin_catalogue_delete_album(bigint, boolean) from public, anon;
grant execute on function public.admin_catalogue_delete_album(bigint, boolean) to authenticated;
