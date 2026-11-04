-- Lightweight, read-only input for the initial Discover screen.
-- Keep the full catalogue tables for features that need songs or recording identity.
create or replace view public.discover_album_catalogue
with (security_invoker = true)
as
select
  albums.id,
  albums.title,
  albums.artist,
  albums.external_id,
  albums.original_release_date,
  albums.release_date,
  albums.custom_cover,
  albums.cover_art_url,
  albums.is_deleted,
  coalesce(track_counts.track_count, 0)::integer as discover_track_count,
  rating_summaries.average_rating as discover_average_rating,
  coalesce(rating_summaries.rating_count, 0)::integer as discover_rating_count
from public.albums
left join (
  select songs.album_id, count(*)::integer as track_count
  from public.songs
  group by songs.album_id
) as track_counts on track_counts.album_id = albums.id
left join (
  select
    ratings.album_id,
    avg(ratings.rating) as average_rating,
    count(ratings.rating)::integer as rating_count
  from public.ratings
  group by ratings.album_id
) as rating_summaries on rating_summaries.album_id = albums.id;

grant select on public.discover_album_catalogue to anon, authenticated;
