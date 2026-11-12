-- Read-only, bounded game projection. It is called only when the disabled-by-default
-- Higher or Lower feature is opened, so Discover's startup query is unaffected.
create or replace function public.get_bom_higher_lower_pool(
  p_mode text,
  p_min_raters integer default 3,
  p_limit integer default 60,
  p_seed text default ''
)
returns table (
  item_id bigint,
  title text,
  artist text,
  artwork_url text,
  average_rating numeric,
  rating_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_mode not in ('songs', 'albums') then
    raise exception 'Unsupported Higher or Lower mode' using errcode = '22023';
  end if;
  if p_min_raters < 3 or p_min_raters > 1000 or p_limit < 2 or p_limit > 100 then
    raise exception 'Invalid Higher or Lower pool bounds' using errcode = '22023';
  end if;

  if p_mode = 'albums' then
    return query
      select c.item_id, c.title, c.artist, c.cover_art_url,
             c.average_rating, c.rating_count
      from public.album_rating_charts c
      join public.albums a on a.id = c.item_id
      where c.rating_count >= p_min_raters
        and coalesce(a.is_deleted, false) = false
        and nullif(trim(c.cover_art_url), '') is not null
      order by md5(c.item_id::text || ':' || p_seed)
      limit p_limit;
  else
    return query
      with identities as (
        select
          coalesce(s.canonical_song_id::text, 'song:' || s.id::text) as identity_key,
          min(s.id) as item_id,
          min(s.title) as title,
          min(s.artist) as artist,
          min(s.album_id) as album_id
        from public.songs s
        where coalesce(s.is_deleted, false) = false
        group by coalesce(s.canonical_song_id::text, 'song:' || s.id::text)
      ), scores as (
        select
          coalesce(r.canonical_song_id::text, 'song:' || r.song_id::text) as identity_key,
          round(avg(r.rating), 1) as average_rating,
          count(distinct r.user_id) as rating_count
        from public.song_ratings r
        group by coalesce(r.canonical_song_id::text, 'song:' || r.song_id::text)
        having count(distinct r.user_id) >= p_min_raters
      )
      select i.item_id, i.title, i.artist, a.cover_art_url,
             s.average_rating, s.rating_count
      from identities i
      join scores s using (identity_key)
      left join public.albums a on a.id = i.album_id
      where nullif(trim(a.cover_art_url), '') is not null
      order by md5(i.identity_key || ':' || p_seed)
      limit p_limit;
  end if;
end;
$$;

-- Preview-only rollout: the admin SECURITY DEFINER preview RPC may call this as
-- its owner, but application roles cannot call the pool directly until a future
-- public-launch permissions migration is explicitly approved.
revoke all on function public.get_bom_higher_lower_pool(text, integer, integer, text) from public, anon, authenticated;
