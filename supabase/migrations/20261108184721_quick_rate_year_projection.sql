create or replace function public.get_quick_rate_year(
  p_collection_key text,
  p_chart_year integer default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with selected_year as (
    select coalesce(
      p_chart_year,
      max(q.chart_year)
    ) as chart_year
    from public.quick_rate_collection_tracks q
    where p_collection_key = 'uk-number-ones'
      and q.collection_key = p_collection_key
  ),
  chart_rows as (
    select q.*
    from public.quick_rate_collection_tracks q
    join selected_year y on y.chart_year = q.chart_year
    where p_collection_key = 'uk-number-ones'
      and q.collection_key = p_collection_key
  ),
  projected as (
    select
      q.*,
      c.title as canonical_title,
      c.artist as canonical_artist,
      c.preferred_spotify_track_id,
      s.id as resolved_song_id,
      s.title as song_title,
      s.artist as song_artist,
      s.album_id,
      s.external_source as song_external_source,
      s.external_id as song_external_id,
      coalesce(s.spotify_track_id, q.spotify_track_id) as resolved_spotify_track_id,
      a.title as album_title,
      a.artist as album_artist,
      a.custom_cover,
      a.cover_art_url,
      r.rating as personal_rating
    from chart_rows q
    left join public.canonical_recordings c on c.id = q.canonical_song_id
    left join lateral (
      select candidate.*
      from public.songs candidate
      left join public.albums candidate_album on candidate_album.id = candidate.album_id
      where candidate.is_deleted is not true
        and (
          candidate.id = q.song_id
          or (q.song_id is null and candidate.canonical_song_id = q.canonical_song_id)
        )
      order by
        (candidate.id = q.song_id) desc,
        (candidate_album.id is not null and candidate_album.is_deleted is not true) desc,
        coalesce(candidate_album.original_release_date, candidate_album.release_date, '9999-12-31'::date),
        candidate.id
      limit 1
    ) s on true
    left join public.albums a on a.id = s.album_id and a.is_deleted is not true
    left join lateral (
      select candidate_rating.rating
      from public.song_ratings candidate_rating
      where candidate_rating.user_id = (select auth.uid())
        and (
          (q.canonical_song_id is not null and candidate_rating.canonical_song_id = q.canonical_song_id)
          or (q.canonical_song_id is null and candidate_rating.song_id = s.id)
        )
      order by (candidate_rating.canonical_song_id = q.canonical_song_id) desc
      limit 1
    ) r on true
  ),
  overall as (
    select
      count(distinct coalesce('canonical:' || q.canonical_song_id::text, 'song:' || q.song_id::text))
        filter (where q.canonical_song_id is not null or q.song_id is not null) as total,
      count(distinct coalesce('canonical:' || q.canonical_song_id::text, 'song:' || q.song_id::text))
        filter (where r.id is not null) as rated
    from public.quick_rate_collection_tracks q
    left join public.song_ratings r on r.user_id = (select auth.uid())
      and (
        (q.canonical_song_id is not null and r.canonical_song_id = q.canonical_song_id)
        or (q.canonical_song_id is null and r.song_id = q.song_id)
      )
    where p_collection_key = 'uk-number-ones'
      and q.collection_key = p_collection_key
  )
  select jsonb_build_object(
    'selected_year', (select chart_year from selected_year),
    'years', coalesce((
      select jsonb_agg(years.chart_year order by years.chart_year desc)
      from (
        select distinct q.chart_year
        from public.quick_rate_collection_tracks q
        where p_collection_key = 'uk-number-ones'
          and q.collection_key = p_collection_key
      ) years
    ), '[]'::jsonb),
    'overall_total', (select total from overall),
    'overall_rated', (select rated from overall),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'collection_key', p.collection_key,
        'chart_year', p.chart_year,
        'title', p.title,
        'artist', p.artist,
        'first_number_one_date', p.first_number_one_date,
        'weeks_at_number_one', p.weeks_at_number_one,
        'number_one_runs', p.number_one_runs,
        'musicbrainz_recording_id', p.musicbrainz_recording_id,
        'song_id', p.song_id,
        'canonical_song_id', p.canonical_song_id,
        'match_status', p.match_status,
        'match_method', p.match_method,
        'canonical_title', p.canonical_title,
        'canonical_artist', p.canonical_artist,
        'preferred_spotify_track_id', p.preferred_spotify_track_id,
        'resolved_song_id', p.resolved_song_id,
        'song_title', p.song_title,
        'song_artist', p.song_artist,
        'album_id', p.album_id,
        'song_external_source', p.song_external_source,
        'song_external_id', p.song_external_id,
        'spotify_track_id', p.resolved_spotify_track_id,
        'album_title', p.album_title,
        'album_artist', p.album_artist,
        'custom_cover', p.custom_cover,
        'cover_art_url', p.cover_art_url,
        'personal_rating', p.personal_rating
      ) order by p.id)
      from projected p
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_quick_rate_year(text, integer) from public, anon, authenticated;
grant execute on function public.get_quick_rate_year(text, integer) to authenticated;

comment on function public.get_quick_rate_year(text, integer) is
  'Returns one authenticated caller''s read-only Quick Rate year projection, including only that caller''s rating.';
