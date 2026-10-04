begin;

create or replace function public.admin_cleanup_malformed_pet_sounds(
  p_execute boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id constant uuid := '076d961e-c330-4cf7-a820-e0b45a8b8cd0';
  v_source_album public.albums%rowtype;
  v_source_song public.songs%rowtype;
  v_destination_album public.albums%rowtype;
  v_destination_song public.songs%rowtype;
begin
  if current_user <> 'service_role' and (
    auth.uid() is null or not exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid() and profile.is_admin is true
    )
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(9139, 3);

  select * into v_source_album from public.albums where id = 3 for update;
  select * into v_source_song from public.songs where id = 1 for update;
  select * into v_destination_album from public.albums where id = 9 for update;
  select * into v_destination_song from public.songs where id = 227 for update;
  perform 1 from public.song_ratings where id in (1, 165) for update;
  perform 1 from public.ratings where id in (13, 18) for update;

  if v_source_album.id is null
     or v_source_album.title is distinct from 'Pet Sounds'
     or v_source_album.artist is distinct from 'Pet Sounds'
     or coalesce(v_source_album.is_deleted, false)
     or v_source_album.external_source is not null
     or v_source_album.external_id is not null
     or v_source_album.musicbrainz_release_id is not null
     or v_source_album.musicbrainz_release_group_id is not null
     or v_source_song.id is null
     or v_source_song.album_id is distinct from 3::bigint
     or v_source_song.title is distinct from 'God only knows'
     or v_source_song.artist is distinct from 'The Beach Boys'
     or coalesce(v_source_song.is_deleted, false)
     or v_source_song.external_source is not null
     or v_source_song.external_id is not null
     or v_source_song.spotify_track_id is not null
     or v_source_song.track_position is not null
     or (select count(*) from public.songs where album_id = 3) <> 1
     or not exists (
       select 1 from public.song_ratings
       where id = 1 and song_id = 1 and user_id = v_user_id and rating = 8
     )
     or (select count(*) from public.song_ratings where song_id = 1) <> 1
     or not exists (
       select 1 from public.ratings
       where id = 13 and album_id = 3 and user_id = v_user_id and rating = 8
     )
     or (select count(*) from public.ratings where album_id = 3) <> 1
     or exists (select 1 from public.album_reviews where album_id = 3)
  then
    raise exception 'Malformed Pet Sounds source state has changed; cleanup aborted'
      using errcode = '23514';
  end if;

  if v_destination_album.id is null
     or v_destination_album.title is distinct from 'Pet Sounds'
     or v_destination_album.artist is distinct from 'The Beach Boys'
     or coalesce(v_destination_album.is_deleted, false)
     or v_destination_album.external_source is distinct from 'musicbrainz'
     or lower(coalesce(v_destination_album.external_id, '')) is distinct from
       '554484cc-7e87-3066-ab01-12133d9e47ca'
     or v_destination_song.id is null
     or v_destination_song.album_id is distinct from 9::bigint
     or v_destination_song.title is distinct from 'God Only Knows'
     or v_destination_song.artist is distinct from 'The Beach Boys'
     or coalesce(v_destination_song.is_deleted, false)
     or v_destination_song.external_source is distinct from 'musicbrainz'
     or lower(coalesce(v_destination_song.external_id, '')) is distinct from
       'e69ad76d-d2c0-4981-a39b-78d8794c7f0d'
     or not exists (
       select 1 from public.song_ratings
       where id = 165 and song_id = 227 and user_id = v_user_id and rating = 8
     )
     or not exists (
       select 1 from public.ratings
       where id = 18 and album_id = 9 and user_id = v_user_id and rating = 10
     )
  then
    raise exception 'Authoritative Pet Sounds destination state has changed; cleanup aborted'
      using errcode = '23514';
  end if;

  if not p_execute then
    return jsonb_build_object(
      'status', 'preview',
      'album_id', 3,
      'song_id', 1,
      'album_rating_id', 13,
      'song_rating_id', 1,
      'destination_album_id', 9,
      'destination_song_id', 227
    );
  end if;

  delete from public.song_ratings where id = 1 and song_id = 1;
  if not found then raise exception 'Expected source song rating was not deleted'; end if;

  delete from public.ratings where id = 13 and album_id = 3;
  if not found then raise exception 'Expected source album rating was not deleted'; end if;

  delete from public.songs where id = 1 and album_id = 3;
  if not found then raise exception 'Expected source song was not deleted'; end if;

  delete from public.albums where id = 3;
  if not found then raise exception 'Expected source album was not deleted'; end if;

  if exists (select 1 from public.albums where id = 3)
     or exists (select 1 from public.songs where id = 1)
     or exists (select 1 from public.song_ratings where id = 1)
     or exists (select 1 from public.ratings where id = 13)
     or not exists (select 1 from public.albums where id = 9)
     or not exists (select 1 from public.songs where id = 227)
     or not exists (select 1 from public.song_ratings where id = 165)
     or not exists (select 1 from public.ratings where id = 18)
  then
    raise exception 'Malformed Pet Sounds cleanup verification failed';
  end if;

  return jsonb_build_object(
    'status', 'deleted',
    'album_id', 3,
    'song_id', 1,
    'album_rating_id', 13,
    'song_rating_id', 1,
    'destination_album_id', 9,
    'destination_song_id', 227
  );
end;
$$;

revoke all on function public.admin_cleanup_malformed_pet_sounds(boolean) from public, anon;
grant execute on function public.admin_cleanup_malformed_pet_sounds(boolean) to authenticated, service_role;

commit;
