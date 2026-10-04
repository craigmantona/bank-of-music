begin;

-- The authenticated Edge Function resolves MusicBrainz metadata itself and
-- calls this existing atomic writer with the service role. Direct ordinary
-- user calls still fail the administrator check below.
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
      as track(position integer, title text, artist text, musicbrainz_recording_id text)
    where track.position is null or track.position < 1
       or nullif(btrim(track.title), '') is null
       or nullif(btrim(track.artist), '') is null
       or track.musicbrainz_recording_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'Every track requires a position, title, artist and MusicBrainz recording ID'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_tracks)
      as track(position integer, title text, artist text, musicbrainz_recording_id text)
    group by track.position having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_tracks)
      as track(position integer, title text, artist text, musicbrainz_recording_id text)
    group by lower(btrim(track.title)) having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_tracks)
      as track(position integer, title text, artist text, musicbrainz_recording_id text)
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
    external_source, external_id, is_deleted
  )
  select
    btrim(track.title), btrim(track.artist), v_album.id, track.position,
    'musicbrainz', lower(track.musicbrainz_recording_id), false
  from jsonb_to_recordset(p_tracks)
    as track(position integer, title text, artist text, musicbrainz_recording_id text)
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

revoke all on function public.admin_add_catalogue_album(jsonb, jsonb) from public;
revoke all on function public.admin_add_catalogue_album(jsonb, jsonb) from anon;
grant execute on function public.admin_add_catalogue_album(jsonb, jsonb) to authenticated;
grant execute on function public.admin_add_catalogue_album(jsonb, jsonb) to service_role;

commit;
