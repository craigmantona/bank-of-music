begin;

alter table public.songs
  add column duration_ms integer null
  check (duration_ms is null or duration_ms > 0);

-- MusicBrainz durations are carried on each release-track occurrence. Existing
-- song rows remain untouched until their album is explicitly reconciled.
create or replace function public.admin_add_catalogue_album(
  p_album jsonb,
  p_tracks jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_is_service_role boolean := current_user = 'service_role';
  v_title text := btrim(p_album->>'title');
  v_artist text := btrim(p_album->>'artist');
  v_release_id text := btrim(p_album->>'musicbrainz_release_id');
  v_group_id text := btrim(p_album->>'musicbrainz_release_group_id');
  v_existing public.albums%rowtype;
  v_album public.albums%rowtype;
begin
  if not v_is_service_role and (
    v_user_id is null or not exists (
      select 1
      from public.profiles profile
      where profile.id = v_user_id
        and profile.is_admin is true
    )
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_album is null or jsonb_typeof(p_album) <> 'object'
     or nullif(v_title, '') is null or nullif(v_artist, '') is null
     or v_release_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_group_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'A valid MusicBrainz album identity is required' using errcode = '22023';
  end if;

  if p_tracks is null or jsonb_typeof(p_tracks) <> 'array'
     or jsonb_array_length(p_tracks) < 1
     or jsonb_array_length(p_tracks) > 500 then
    raise exception 'A complete track listing is required' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_tracks)
      as track(position integer, title text, artist text, musicbrainz_recording_id text, duration_ms integer)
    where track.position is null or track.position < 1
       or nullif(btrim(track.title), '') is null
       or nullif(btrim(track.artist), '') is null
       or (track.duration_ms is not null and track.duration_ms < 1)
       or track.musicbrainz_recording_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'Every track requires a position, title, artist and MusicBrainz recording ID'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_tracks)
      as track(position integer, title text, artist text, musicbrainz_recording_id text, duration_ms integer)
    group by track.position having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_tracks)
      as track(position integer, title text, artist text, musicbrainz_recording_id text, duration_ms integer)
    group by lower(btrim(track.title)) having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_tracks)
      as track(position integer, title text, artist text, musicbrainz_recording_id text, duration_ms integer)
    group by lower(track.musicbrainz_recording_id) having count(*) > 1
  ) then
    raise exception 'Track positions, titles and recording IDs must be unique within the album'
      using errcode = '23505';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('bom-admin-catalogue:' || lower(v_group_id), 0));

  select album.* into v_existing
  from public.albums album
  where album.musicbrainz_release_group_id = v_group_id
     or album.musicbrainz_release_id = v_release_id
     or (album.external_source = 'musicbrainz' and album.external_id = v_release_id)
     or (
       lower(regexp_replace(album.title, '[^[:alnum:]]+', '', 'g')) =
         lower(regexp_replace(v_title, '[^[:alnum:]]+', '', 'g'))
       and lower(regexp_replace(album.artist, '[^[:alnum:]]+', '', 'g')) =
         lower(regexp_replace(v_artist, '[^[:alnum:]]+', '', 'g'))
     )
  order by
    (album.musicbrainz_release_group_id = v_group_id) desc,
    (album.musicbrainz_release_id = v_release_id) desc,
    album.id
  limit 1
  for update;

  if v_existing.id is not null then
    if coalesce(v_existing.is_deleted, false) then
      return jsonb_build_object(
        'status', 'needs_correction',
        'reason', 'matching_album_is_deleted',
        'album_id', v_existing.id
      );
    end if;
    return jsonb_build_object(
      'status', 'already_exists',
      'album_id', v_existing.id,
      'title', v_existing.title,
      'artist', v_existing.artist
    );
  end if;

  insert into public.albums (
    title, artist, external_source, external_id,
    musicbrainz_release_id, musicbrainz_release_group_id,
    cover_art_url, release_date, original_release_date,
    canonical_release_date, canonical_release_country,
    catalogue_selection_version, is_deleted
  ) values (
    v_title, v_artist, 'musicbrainz', v_release_id,
    v_release_id, v_group_id,
    nullif(btrim(p_album->>'cover_art_url'), ''),
    nullif(p_album->>'uk_release_date', '')::date,
    nullif(p_album->>'original_release_date', '')::date,
    nullif(p_album->>'canonical_release_date', '')::date,
    nullif(btrim(p_album->>'canonical_release_country'), ''),
    1, false
  ) returning * into v_album;

  insert into public.songs (
    title, artist, album_id, track_position,
    external_source, external_id, duration_ms, is_deleted
  )
  select
    btrim(track.title), btrim(track.artist), v_album.id, track.position,
    'musicbrainz', lower(track.musicbrainz_recording_id), track.duration_ms, false
  from jsonb_to_recordset(p_tracks)
    as track(position integer, title text, artist text, musicbrainz_recording_id text, duration_ms integer)
  order by track.position;

  return jsonb_build_object(
    'status', 'added',
    'album_id', v_album.id,
    'title', v_album.title,
    'artist', v_album.artist,
    'track_count', jsonb_array_length(p_tracks)
  );
end;
$$;

create or replace function public.admin_reconcile_catalogue_album(
  p_album_id bigint,
  p_album jsonb,
  p_tracks jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_is_service_role boolean := current_user = 'service_role';
  v_album public.albums%rowtype;
  v_track record;
  v_song public.songs%rowtype;
  v_song_id bigint;
  v_inserted integer := 0;
  v_retained integer := 0;
  v_changed boolean := false;
begin
  if not v_is_service_role and (
    v_user_id is null or not exists (
      select 1 from public.profiles profile
      where profile.id = v_user_id and profile.is_admin is true
    )
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_album_id is null or p_album is null or jsonb_typeof(p_album) <> 'object'
     or (p_album->>'id')::bigint is distinct from p_album_id
     or btrim(p_album->>'musicbrainz_release_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or btrim(p_album->>'musicbrainz_release_group_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or p_tracks is null or jsonb_typeof(p_tracks) <> 'array'
     or jsonb_array_length(p_tracks) < 1 or jsonb_array_length(p_tracks) > 500 then
    raise exception 'A complete authoritative album is required' using errcode = '22023';
  end if;

  select album.* into v_album from public.albums album
  where album.id = p_album_id for update;
  if v_album.id is null or coalesce(v_album.is_deleted, false) then
    raise exception 'Active BOM album not found' using errcode = 'P0002';
  end if;
  if lower(regexp_replace(v_album.title, '[^[:alnum:]]+', '', 'g')) <>
       lower(regexp_replace(btrim(p_album->>'title'), '[^[:alnum:]]+', '', 'g'))
     or lower(regexp_replace(v_album.artist, '[^[:alnum:]]+', '', 'g')) <>
       lower(regexp_replace(btrim(p_album->>'artist'), '[^[:alnum:]]+', '', 'g'))
     or (v_album.musicbrainz_release_id is not null and
       lower(v_album.musicbrainz_release_id) <> lower(btrim(p_album->>'musicbrainz_release_id')))
     or (v_album.musicbrainz_release_group_id is not null and
       lower(v_album.musicbrainz_release_group_id) <> lower(btrim(p_album->>'musicbrainz_release_group_id'))) then
    raise exception 'Authoritative release does not match the existing album' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_tracks)
      as track(position integer, title text, artist text, musicbrainz_recording_id text, duration_ms integer)
    where track.position is null or track.position < 1
       or nullif(btrim(track.title), '') is null or nullif(btrim(track.artist), '') is null
       or (track.duration_ms is not null and track.duration_ms < 1)
       or track.musicbrainz_recording_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) or exists (
    select 1 from jsonb_to_recordset(p_tracks)
      as track(position integer, title text, artist text, musicbrainz_recording_id text, duration_ms integer)
    group by track.position having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_tracks)
      as track(position integer, title text, artist text, musicbrainz_recording_id text, duration_ms integer)
    group by lower(btrim(track.title)) having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_tracks)
      as track(position integer, title text, artist text, musicbrainz_recording_id text, duration_ms integer)
    group by lower(track.musicbrainz_recording_id) having count(*) > 1
  ) then
    raise exception 'Authoritative tracks must have unique positions, titles and recording IDs' using errcode = '23505';
  end if;

  create temporary table if not exists pg_temp.catalogue_reconcile_mapping (
    song_id bigint primary key,
    track_position integer unique not null,
    recording_id text unique not null
  ) on commit drop;
  truncate pg_temp.catalogue_reconcile_mapping;

  for v_track in
    select * from jsonb_to_recordset(p_tracks)
      as track(position integer, title text, artist text, musicbrainz_recording_id text, duration_ms integer)
    order by track.position
  loop
    v_song_id := null;
    select song.id into v_song_id from public.songs song
    where song.album_id = p_album_id
      and song.external_source = 'musicbrainz'
      and lower(song.external_id) = lower(v_track.musicbrainz_recording_id)
      and not coalesce(song.is_deleted, false);

    if v_song_id is null then
      select song.id into v_song_id from public.songs song
      where song.album_id = p_album_id
        and not coalesce(song.is_deleted, false)
        and (song.external_id is null or song.external_source is null or song.external_source = 'manual')
        and song.track_position = v_track.position
        and lower(btrim(song.title)) = lower(btrim(v_track.title));
    end if;

    if v_song_id is not null then
      insert into pg_temp.catalogue_reconcile_mapping(song_id, track_position, recording_id)
      values(v_song_id, v_track.position, lower(v_track.musicbrainz_recording_id));
    end if;
  end loop;

  if exists (
    select 1 from public.songs song
    where song.album_id = p_album_id and not coalesce(song.is_deleted, false)
      and not exists (select 1 from pg_temp.catalogue_reconcile_mapping map where map.song_id = song.id)
  ) or exists (
    select 1 from public.songs song
    join jsonb_to_recordset(p_tracks)
      as track(position integer, title text, artist text, musicbrainz_recording_id text, duration_ms integer)
      on (song.external_source = 'musicbrainz' and lower(song.external_id) = lower(track.musicbrainz_recording_id))
        or lower(btrim(song.title)) = lower(btrim(track.title))
    where song.album_id = p_album_id and coalesce(song.is_deleted, false)
  ) then
    raise exception 'Existing album tracks conflict with the authoritative release' using errcode = '23505';
  end if;

  v_changed := v_album.musicbrainz_release_id is distinct from lower(btrim(p_album->>'musicbrainz_release_id'))
    or v_album.musicbrainz_release_group_id is distinct from lower(btrim(p_album->>'musicbrainz_release_group_id'));
  v_changed := v_changed or exists (
    select 1
    from pg_temp.catalogue_reconcile_mapping map
    join public.songs song on song.id = map.song_id
    join jsonb_to_recordset(p_tracks)
      as track(position integer, title text, artist text, musicbrainz_recording_id text, duration_ms integer)
      on track.position = map.track_position
    where song.track_position is distinct from track.position
       or song.title is distinct from btrim(track.title)
       or song.artist is distinct from btrim(track.artist)
       or song.external_source is distinct from 'musicbrainz'
       or lower(coalesce(song.external_id, '')) is distinct from lower(track.musicbrainz_recording_id)
       or song.duration_ms is distinct from track.duration_ms
  );

  -- Free album slots only after every existing row has been mapped. Any error
  -- below rolls the transaction back, including these temporary nulls.
  update public.songs set track_position = null
  where album_id = p_album_id and id in (select song_id from pg_temp.catalogue_reconcile_mapping);

  for v_track in
    select * from jsonb_to_recordset(p_tracks)
      as track(position integer, title text, artist text, musicbrainz_recording_id text, duration_ms integer)
    order by track.position
  loop
    select map.song_id into v_song_id from pg_temp.catalogue_reconcile_mapping map
    where map.track_position = v_track.position;
    if v_song_id is not null then
      select * into v_song from public.songs where id = v_song_id;
      v_changed := v_changed or v_song.title is distinct from btrim(v_track.title)
        or v_song.artist is distinct from btrim(v_track.artist)
        or v_song.external_source is distinct from 'musicbrainz'
        or lower(coalesce(v_song.external_id, '')) is distinct from lower(v_track.musicbrainz_recording_id)
        or v_song.duration_ms is distinct from v_track.duration_ms;
      update public.songs set
        title = btrim(v_track.title), artist = btrim(v_track.artist),
        track_position = v_track.position, external_source = 'musicbrainz',
        external_id = lower(v_track.musicbrainz_recording_id), duration_ms = v_track.duration_ms
      where id = v_song_id and album_id = p_album_id;
      v_retained := v_retained + 1;
    else
      insert into public.songs(title, artist, album_id, track_position, external_source, external_id, duration_ms, is_deleted)
      values(btrim(v_track.title), btrim(v_track.artist), p_album_id, v_track.position,
        'musicbrainz', lower(v_track.musicbrainz_recording_id), v_track.duration_ms, false);
      v_inserted := v_inserted + 1;
      v_changed := true;
    end if;
  end loop;

  update public.albums set
    external_source = 'musicbrainz',
    external_id = lower(btrim(p_album->>'musicbrainz_release_id')),
    musicbrainz_release_id = lower(btrim(p_album->>'musicbrainz_release_id')),
    musicbrainz_release_group_id = lower(btrim(p_album->>'musicbrainz_release_group_id'))
  where id = p_album_id;

  return jsonb_build_object(
    'status', case when v_changed then 'reconciled' else 'unchanged' end,
    'album_id', p_album_id,
    'track_count', jsonb_array_length(p_tracks),
    'retained_count', v_retained,
    'inserted_count', v_inserted
  );
end;
$$;

revoke all on function public.admin_add_catalogue_album(jsonb, jsonb) from public;
revoke all on function public.admin_add_catalogue_album(jsonb, jsonb) from anon;
grant execute on function public.admin_add_catalogue_album(jsonb, jsonb) to authenticated;
grant execute on function public.admin_add_catalogue_album(jsonb, jsonb) to service_role;
revoke all on function public.admin_reconcile_catalogue_album(bigint, jsonb, jsonb) from public;
revoke all on function public.admin_reconcile_catalogue_album(bigint, jsonb, jsonb) from anon;
grant execute on function public.admin_reconcile_catalogue_album(bigint, jsonb, jsonb) to authenticated;
grant execute on function public.admin_reconcile_catalogue_album(bigint, jsonb, jsonb) to service_role;

commit;
