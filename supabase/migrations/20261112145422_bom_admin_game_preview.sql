-- Server-authorised private preview. Simulated values are computed in-memory and
-- are never inserted into catalogue, community rating or official attempt tables.
create or replace function public.get_bom_admin_game_preview_pool(
  p_mode text,
  p_seed text default 'preview'
)
returns table (
  item_id bigint, title text, artist text, artwork_url text,
  average_rating numeric, rating_count bigint, simulated boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_real_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.is_admin is true
  ) then
    raise exception 'Game preview requires administrator access' using errcode = '42501';
  end if;
  if p_mode not in ('songs', 'albums') then
    raise exception 'Unsupported game preview mode' using errcode = '22023';
  end if;

  select count(*) into v_real_count
  from public.get_bom_higher_lower_pool(p_mode, 3, 60, p_seed);

  if v_real_count >= 12 then
    return query select pool.item_id, pool.title, pool.artist, pool.artwork_url,
      pool.average_rating, pool.rating_count, false
    from public.get_bom_higher_lower_pool(p_mode, 3, 60, p_seed) pool;
  elsif p_mode = 'albums' then
    return query
      select a.id, a.title, a.artist, coalesce(a.custom_cover, a.cover_art_url),
        (6 + (abs(hashtext(p_seed || ':album:' || a.id::text)::bigint) % 40) / 10.0)::numeric(3,1),
        (3 + abs(hashtext('raters:' || a.id::text)::bigint) % 28)::bigint, true
      from public.albums a
      where coalesce(a.is_deleted, false) = false
        and nullif(trim(coalesce(a.custom_cover, a.cover_art_url)), '') is not null
      order by md5(p_seed || ':album:' || a.id::text)
      limit 40;
  else
    return query
      with identities as (
        select coalesce(s.canonical_song_id::text, 'song:' || s.id::text) identity_key,
          min(s.id) item_id, min(s.title) title, min(s.artist) artist, min(s.album_id) album_id
        from public.songs s where coalesce(s.is_deleted, false) = false
        group by coalesce(s.canonical_song_id::text, 'song:' || s.id::text)
      )
      select i.item_id, i.title, i.artist, coalesce(a.custom_cover, a.cover_art_url),
        (6 + (abs(hashtext(p_seed || ':song:' || i.identity_key)::bigint) % 40) / 10.0)::numeric(3,1),
        (3 + abs(hashtext('raters:' || i.identity_key)::bigint) % 28)::bigint, true
      from identities i join public.albums a on a.id = i.album_id
      where nullif(trim(coalesce(a.custom_cover, a.cover_art_url)), '') is not null
      order by md5(p_seed || ':song:' || i.identity_key)
      limit 40;
  end if;
end;
$$;

revoke all on function public.get_bom_admin_game_preview_pool(text, text) from public, anon;
grant execute on function public.get_bom_admin_game_preview_pool(text, text) to authenticated;
