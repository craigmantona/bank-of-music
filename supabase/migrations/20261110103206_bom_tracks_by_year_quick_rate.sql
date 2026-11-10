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
  with canonical_track_dates as (
    select q.canonical_song_id, min(q.first_number_one_date) as reliable_track_date
    from public.quick_rate_collection_tracks q
    where q.canonical_song_id is not null and q.first_number_one_date is not null
    group by q.canonical_song_id
  ),
  song_track_dates as (
    select q.song_id, min(q.first_number_one_date) as reliable_track_date
    from public.quick_rate_collection_tracks q
    where q.canonical_song_id is null and q.song_id is not null and q.first_number_one_date is not null
    group by q.song_id
  ),
  catalogue_occurrences as (
    select
      s.*,
      a.title as album_title,
      a.artist as album_artist,
      a.custom_cover,
      a.cover_art_url,
      least(
        coalesce(a.original_release_date, a.release_date),
        coalesce(canonical_date.reliable_track_date, song_date.reliable_track_date)
      ) as effective_release_date
    from public.songs s
    join public.albums a on a.id = s.album_id and a.is_deleted is not true
    left join canonical_track_dates canonical_date on canonical_date.canonical_song_id = s.canonical_song_id
    left join song_track_dates song_date on song_date.song_id = s.id and s.canonical_song_id is null
    where s.is_deleted is not true
      and coalesce(
        a.original_release_date, a.release_date,
        canonical_date.reliable_track_date, song_date.reliable_track_date
      ) is not null
  ),
  catalogue_tracks as (
    select distinct on (coalesce('canonical:' || s.canonical_song_id::text, 'song:' || s.id::text))
      s.id,
      s.canonical_song_id,
      s.title,
      s.artist,
      s.album_id,
      s.external_source,
      s.external_id,
      s.spotify_track_id,
      extract(year from s.effective_release_date)::integer as release_year,
      s.album_title,
      s.album_artist,
      s.custom_cover,
      s.cover_art_url
    from catalogue_occurrences s
    order by
      coalesce('canonical:' || s.canonical_song_id::text, 'song:' || s.id::text),
      s.effective_release_date,
      s.id
  ),
  catalogue_bounds as (
    select min(release_year) as first_year, max(release_year) as last_year from catalogue_tracks
  ),
  catalogue_years as (
    select generate_series(first_year, last_year)::integer as chart_year
    from catalogue_bounds
    where first_year is not null and last_year is not null
  ),
  collection_years as (
    select distinct q.chart_year
    from public.quick_rate_collection_tracks q
    where p_collection_key = 'uk-number-ones' and q.collection_key = p_collection_key
    union all
    select chart_year from catalogue_years where p_collection_key = 'bom-tracks'
  ),
  selected_year as (
    select coalesce(p_chart_year, max(chart_year)) as chart_year from collection_years
  ),
  selected_catalogue_tracks as (
    select s.*
    from catalogue_tracks s
    join selected_year y on y.chart_year = s.release_year
    where p_collection_key = 'bom-tracks'
  ),
  effective_ratings as (
    select r.user_id, s.id as song_id, r.rating
    from public.song_ratings r
    join selected_catalogue_tracks s on s.canonical_song_id = r.canonical_song_id
    where r.canonical_song_id is not null
    union all
    select r.user_id, r.song_id, r.rating
    from public.song_ratings r
    join selected_catalogue_tracks s on s.id = r.song_id
    where r.canonical_song_id is null
      and not exists (
        select 1 from public.song_ratings canonical
        where canonical.user_id = r.user_id and canonical.canonical_song_id = s.canonical_song_id
      )
  ),
  community as (
    select song_id, avg(rating)::numeric as average_rating, count(*)::bigint as rating_count
    from effective_ratings group by song_id
  ),
  community_prior as (
    select coalesce(avg(rating), 5)::numeric as mean_rating from effective_ratings
  ),
  bom_rows as (
    select
      s.id,
      'bom-tracks'::text as collection_key,
      s.release_year as chart_year,
      s.title,
      s.artist,
      null::date as first_number_one_date,
      null::integer as weeks_at_number_one,
      null::integer as number_one_runs,
      null::text as musicbrainz_recording_id,
      s.id as song_id,
      s.canonical_song_id,
      'matched'::text as match_status,
      'catalogue'::text as match_method,
      c.title as canonical_title,
      c.artist as canonical_artist,
      c.preferred_spotify_track_id,
      s.id as resolved_song_id,
      s.title as song_title,
      s.artist as song_artist,
      s.album_id,
      s.external_source as song_external_source,
      s.external_id as song_external_id,
      coalesce(s.spotify_track_id, c.preferred_spotify_track_id) as spotify_track_id,
      s.album_title,
      s.album_artist,
      s.custom_cover,
      s.cover_art_url,
      mine.rating as personal_rating,
      community.average_rating as community_average,
      coalesce(community.rating_count, 0) as community_rating_count,
      case when community.rating_count > 0 then
        ((community.rating_count * community.average_rating) + (5 * prior.mean_rating)) / (community.rating_count + 5)
      end as weighted_score
    from selected_catalogue_tracks s
    left join public.canonical_recordings c on c.id = s.canonical_song_id
    left join lateral (
      select candidate_rating.rating
      from public.song_ratings candidate_rating
      where candidate_rating.user_id = (select auth.uid()) and (
        (s.canonical_song_id is not null and candidate_rating.canonical_song_id = s.canonical_song_id)
        or (s.canonical_song_id is null and candidate_rating.song_id = s.id)
      )
      order by (candidate_rating.canonical_song_id = s.canonical_song_id) desc
      limit 1
    ) mine on true
    left join community on community.song_id = s.id
    cross join community_prior prior
    where p_collection_key = 'bom-tracks'
  ),
  number_one_rows as (
    select
      q.id, q.collection_key, q.chart_year, q.title, q.artist, q.first_number_one_date,
      q.weeks_at_number_one, q.number_one_runs, q.musicbrainz_recording_id, q.song_id, q.canonical_song_id,
      q.match_status, q.match_method, c.title as canonical_title, c.artist as canonical_artist,
      c.preferred_spotify_track_id, s.id as resolved_song_id, s.title as song_title,
      s.artist as song_artist, s.album_id, s.external_source as song_external_source,
      s.external_id as song_external_id, coalesce(s.spotify_track_id, q.spotify_track_id) as spotify_track_id,
      a.title as album_title, a.artist as album_artist, a.custom_cover, a.cover_art_url,
      mine.rating as personal_rating, null::numeric as community_average,
      0::bigint as community_rating_count, null::numeric as weighted_score
    from public.quick_rate_collection_tracks q
    join selected_year y on y.chart_year = q.chart_year
    left join public.canonical_recordings c on c.id = q.canonical_song_id
    left join lateral (
      select candidate.* from public.songs candidate
      left join public.albums candidate_album on candidate_album.id = candidate.album_id
      where candidate.is_deleted is not true and
        (candidate.id = q.song_id or (q.song_id is null and candidate.canonical_song_id = q.canonical_song_id))
      order by (candidate.id = q.song_id) desc,
        (candidate_album.id is not null and candidate_album.is_deleted is not true) desc,
        coalesce(candidate_album.original_release_date, candidate_album.release_date, '9999-12-31'::date), candidate.id
      limit 1
    ) s on true
    left join public.albums a on a.id = s.album_id and a.is_deleted is not true
    left join lateral (
      select candidate_rating.rating
      from public.song_ratings candidate_rating
      where candidate_rating.user_id = (select auth.uid()) and (
        (q.canonical_song_id is not null and candidate_rating.canonical_song_id = q.canonical_song_id)
        or (q.canonical_song_id is null and candidate_rating.song_id = s.id)
      )
      order by (candidate_rating.canonical_song_id = q.canonical_song_id) desc
      limit 1
    ) mine on true
    where p_collection_key = 'uk-number-ones' and q.collection_key = p_collection_key
  ),
  projected as (select * from bom_rows union all select * from number_one_rows),
  overall as (
    select count(*)::bigint as total, count(*) filter (where mine.rating is not null)::bigint as rated
    from catalogue_tracks s
    left join lateral (
      select r.rating
      from public.song_ratings r
      where r.user_id = (select auth.uid()) and (
        (s.canonical_song_id is not null and r.canonical_song_id = s.canonical_song_id)
        or (s.canonical_song_id is null and r.song_id = s.id)
      )
      limit 1
    ) mine on true
    where p_collection_key = 'bom-tracks'
  ),
  number_one_overall as (
    select
      count(distinct coalesce('canonical:' || q.canonical_song_id::text, 'song:' || q.song_id::text))
        filter (where q.canonical_song_id is not null or q.song_id is not null) as total,
      count(distinct coalesce('canonical:' || q.canonical_song_id::text, 'song:' || q.song_id::text))
        filter (where mine.id is not null) as rated
    from public.quick_rate_collection_tracks q
    left join public.song_ratings mine on mine.user_id = (select auth.uid()) and (
      (q.canonical_song_id is not null and mine.canonical_song_id = q.canonical_song_id)
      or (q.canonical_song_id is null and mine.song_id = q.song_id)
    )
    where p_collection_key = 'uk-number-ones' and q.collection_key = p_collection_key
  )
  select jsonb_build_object(
    'selected_year', (select chart_year from selected_year),
    'years', coalesce((select jsonb_agg(chart_year order by chart_year desc) from collection_years), '[]'::jsonb),
    'overall_total', case when p_collection_key = 'bom-tracks' then (select total from overall) else (select total from number_one_overall) end,
    'overall_rated', case when p_collection_key = 'bom-tracks' then (select rated from overall) else (select rated from number_one_overall) end,
    'entries', coalesce((select jsonb_agg(to_jsonb(p) order by
      (p.community_rating_count = 0), p.weighted_score desc nulls last, p.community_rating_count desc, p.title, p.id)
      from projected p), '[]'::jsonb)
  );
$$;

revoke all on function public.get_quick_rate_year(text, integer) from public, anon, authenticated;
grant execute on function public.get_quick_rate_year(text, integer) to authenticated;

comment on function public.get_quick_rate_year(text, integer) is
  'Returns a lightweight authenticated Quick Rate projection for UK No.1s or catalogue tracks by original release year.';
