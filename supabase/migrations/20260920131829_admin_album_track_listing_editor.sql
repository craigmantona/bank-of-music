create or replace function public.admin_update_album_track_listing(
  p_album_id bigint,
  p_tracks jsonb
)
returns setof public.songs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = v_user_id
      and profile.is_admin = true
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  perform 1
  from public.albums album
  where album.id = p_album_id
  for update;

  if not found then
    raise exception 'Album not found' using errcode = 'P0002';
  end if;

  if p_tracks is null or jsonb_typeof(p_tracks) <> 'array' then
    raise exception 'Track listing must be a JSON array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_tracks) > 500 then
    raise exception 'Track listing is too large' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_tracks) as track(id bigint, position integer, title text, artist text)
    where track.position is null or track.position < 1
       or nullif(btrim(track.title), '') is null
       or nullif(btrim(track.artist), '') is null
  ) then
    raise exception 'Every track requires a positive position, title and artist' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_tracks) as track(id bigint, position integer, title text, artist text)
    group by track.position
    having count(*) > 1
  ) then
    raise exception 'Track positions must be unique' using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_tracks) as track(id bigint, position integer, title text, artist text)
    group by lower(btrim(track.title))
    having count(*) > 1
  ) then
    raise exception 'Track titles must be unique within an album' using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_tracks) as track(id bigint, position integer, title text, artist text)
    where track.id is not null
    group by track.id
    having count(*) > 1
  ) then
    raise exception 'A track may appear only once' using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_tracks) as track(id bigint, position integer, title text, artist text)
    left join public.songs song on song.id = track.id and song.album_id = p_album_id
    where track.id is not null and song.id is null
  ) then
    raise exception 'Every existing track must belong to the selected album' using errcode = '22023';
  end if;

  -- Omitted tracks are detached, never deleted. Their identity and ratings remain intact.
  update public.songs song
  set album_id = null,
      track_position = null
  where song.album_id = p_album_id
    and not exists (
      select 1
      from jsonb_to_recordset(p_tracks) as track(id bigint, position integer, title text, artist text)
      where track.id = song.id
    );

  update public.songs song
  set title = btrim(track.title),
      artist = btrim(track.artist),
      track_position = track.position
  from jsonb_to_recordset(p_tracks) as track(id bigint, position integer, title text, artist text)
  where track.id is not null
    and song.id = track.id
    and song.album_id = p_album_id;

  insert into public.songs (
    title,
    artist,
    album_id,
    track_position,
    external_source,
    external_id,
    is_deleted
  )
  select
    btrim(track.title),
    btrim(track.artist),
    p_album_id,
    track.position,
    'manual',
    null,
    false
  from jsonb_to_recordset(p_tracks) as track(id bigint, position integer, title text, artist text)
  where track.id is null;

  return query
  select song.*
  from public.songs song
  where song.album_id = p_album_id
  order by song.track_position nulls last, song.id;
end;
$$;

revoke all on function public.admin_update_album_track_listing(bigint, jsonb) from public;
revoke all on function public.admin_update_album_track_listing(bigint, jsonb) from anon;
grant execute on function public.admin_update_album_track_listing(bigint, jsonb) to authenticated;
