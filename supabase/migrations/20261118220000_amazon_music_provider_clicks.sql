-- Extend existing listening-link analytics without changing any Spotify or
-- Apple Music provider identities.
alter table public.music_provider_click_counts
  drop constraint music_provider_click_counts_provider_check;

alter table public.music_provider_click_counts
  add constraint music_provider_click_counts_provider_check
  check (provider in ('spotify', 'apple_music', 'amazon_music'));

create or replace function public.record_music_provider_click(
  p_provider text,
  p_item_type text,
  p_item_key text,
  p_title text,
  p_artist text,
  p_album text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_total bigint;
begin
  if p_provider not in ('spotify', 'apple_music', 'amazon_music') then
    raise exception 'Unsupported music provider';
  end if;

  if p_item_type not in ('song', 'album') then
    raise exception 'Unsupported item type';
  end if;

  if nullif(trim(p_item_key), '') is null
     or char_length(p_item_key) > 500 then
    raise exception 'Invalid item key';
  end if;

  if nullif(trim(p_title), '') is null
     or char_length(p_title) > 300 then
    raise exception 'Invalid title';
  end if;

  if nullif(trim(p_artist), '') is null
     or char_length(p_artist) > 300 then
    raise exception 'Invalid artist';
  end if;

  insert into public.music_provider_click_counts (
    provider,
    item_type,
    item_key,
    title,
    artist,
    album,
    total_clicks,
    first_clicked_at,
    last_clicked_at
  )
  values (
    p_provider,
    p_item_type,
    p_item_key,
    trim(p_title),
    trim(p_artist),
    nullif(trim(coalesce(p_album, '')), ''),
    1,
    now(),
    now()
  )
  on conflict (provider, item_type, item_key)
  do update set
    title = excluded.title,
    artist = excluded.artist,
    album = coalesce(
      excluded.album,
      public.music_provider_click_counts.album
    ),
    total_clicks = public.music_provider_click_counts.total_clicks + 1,
    last_clicked_at = now()
  returning total_clicks into updated_total;

  return updated_total;
end;
$$;
