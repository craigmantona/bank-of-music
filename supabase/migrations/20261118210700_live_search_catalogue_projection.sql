begin;

-- The former materialized view was a one-time snapshot with no refresh path.
-- Keep the same public projection contract, but maintain it transactionally so
-- every catalogue import, edit and deletion is reflected in search at commit.
drop materialized view if exists public.search_catalogue_projection;

create table public.search_catalogue_projection (
  search_key text primary key,
  result_type text not null check (result_type in ('artist', 'album', 'song')),
  local_id bigint,
  title text not null,
  artist text,
  album_id bigint,
  album_title text,
  external_source text,
  external_id text,
  canonical_song_id uuid,
  release_date date,
  cover_art_url text,
  custom_cover text,
  normalised_title text not null,
  normalised_artist text not null,
  normalised_artist_title text not null,
  normalised_title_artist text not null
);

create index search_catalogue_projection_type_title_idx
  on public.search_catalogue_projection
  (result_type, normalised_title text_pattern_ops);

create index search_catalogue_projection_title_idx
  on public.search_catalogue_projection
  (normalised_title text_pattern_ops);

alter table public.search_catalogue_projection enable row level security;

create policy "search catalogue projection public read"
  on public.search_catalogue_projection
  for select
  to anon, authenticated
  using (true);

revoke all on table public.search_catalogue_projection
  from public, anon, authenticated, service_role;
grant select on table public.search_catalogue_projection
  to anon, authenticated, service_role;

create schema if not exists private;

create or replace function private.search_catalogue_normalise(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select trim(regexp_replace(
    translate(
      lower(coalesce(p_value, '')),
      'áàâäãåāéèêëēíìîïīóòôöõōúùûüūçñýÿžš',
      'aaaaaaaeeeeeiiiiioooooouuuuucnyyzs'
    ),
    '[^[:alnum:]]+',
    ' ',
    'g'
  ));
$$;

create or replace function private.sync_search_catalogue_artist(p_artist_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := private.search_catalogue_normalise(p_artist_name);
  v_name text;
  v_musicbrainz_artist_id text;
begin
  if v_key = '' then return; end if;

  select candidates.name
  into v_name
  from (
    select albums.artist as name
    from public.albums
    where coalesce(albums.is_deleted, false) = false
      and private.search_catalogue_normalise(albums.artist) = v_key
    union all
    select coalesce(songs.artist, albums.artist) as name
    from public.songs
    left join public.albums on albums.id = songs.album_id
    where coalesce(songs.is_deleted, false) = false
      and (albums.id is null or coalesce(albums.is_deleted, false) = false)
      and private.search_catalogue_normalise(coalesce(songs.artist, albums.artist)) = v_key
  ) candidates
  where nullif(btrim(candidates.name), '') is not null
  order by length(candidates.name), candidates.name
  limit 1;

  if v_name is null then
    delete from public.search_catalogue_projection
    where search_key = 'artist:' || v_key;
    return;
  end if;

  select identities.musicbrainz_artist_id
  into v_musicbrainz_artist_id
  from (
    select 0 as priority, artist_catalog.musicbrainz_artist_id
    from public.artist_catalog
    where artist_catalog.musicbrainz_artist_id is not null
      and private.search_catalogue_normalise(artist_catalog.artist_name) = v_key
    union all
    select 1, musicbrainz_artist_cache.artist_id::text
    from public.musicbrainz_artist_cache
    where private.search_catalogue_normalise(
      musicbrainz_artist_cache.artist_detail->>'name'
    ) = v_key
  ) identities
  order by identities.priority
  limit 1;

  insert into public.search_catalogue_projection (
    search_key, result_type, local_id, title, artist, album_id, album_title,
    external_source, external_id, canonical_song_id, release_date,
    cover_art_url, custom_cover, normalised_title, normalised_artist,
    normalised_artist_title, normalised_title_artist
  ) values (
    'artist:' || v_key, 'artist', null, v_name, v_name, null, null,
    case when v_musicbrainz_artist_id is not null then 'musicbrainz' end,
    v_musicbrainz_artist_id, null, null, null, null, v_key, v_key,
    v_key || ' ' || v_key, v_key || ' ' || v_key
  )
  on conflict (search_key) do update set
    title = excluded.title,
    artist = excluded.artist,
    external_source = excluded.external_source,
    external_id = excluded.external_id,
    normalised_title = excluded.normalised_title,
    normalised_artist = excluded.normalised_artist,
    normalised_artist_title = excluded.normalised_artist_title,
    normalised_title_artist = excluded.normalised_title_artist;
end;
$$;

create or replace function private.sync_search_catalogue_song(p_song_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.search_catalogue_projection
  where search_key = 'song:' || p_song_id::text;

  insert into public.search_catalogue_projection (
    search_key, result_type, local_id, title, artist, album_id, album_title,
    external_source, external_id, canonical_song_id, release_date,
    cover_art_url, custom_cover, normalised_title, normalised_artist,
    normalised_artist_title, normalised_title_artist
  )
  select
    'song:' || songs.id::text,
    'song',
    songs.id,
    songs.title,
    coalesce(songs.artist, albums.artist),
    songs.album_id,
    albums.title,
    songs.external_source,
    songs.external_id,
    songs.canonical_song_id,
    coalesce(albums.original_release_date, albums.release_date),
    albums.cover_art_url,
    albums.custom_cover,
    normalised.normalised_title,
    normalised.normalised_artist,
    normalised.normalised_artist || ' ' || normalised.normalised_title,
    normalised.normalised_title || ' ' || normalised.normalised_artist
  from public.songs
  left join public.albums on albums.id = songs.album_id
  cross join lateral (
    select
      private.search_catalogue_normalise(songs.title) as normalised_title,
      private.search_catalogue_normalise(coalesce(songs.artist, albums.artist))
        as normalised_artist
  ) normalised
  where songs.id = p_song_id
    and coalesce(songs.is_deleted, false) = false
    and (albums.id is null or coalesce(albums.is_deleted, false) = false);
end;
$$;

create or replace function private.sync_search_catalogue_album(p_album_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_song_id bigint;
begin
  delete from public.search_catalogue_projection
  where search_key = 'album:' || p_album_id::text;

  insert into public.search_catalogue_projection (
    search_key, result_type, local_id, title, artist, album_id, album_title,
    external_source, external_id, canonical_song_id, release_date,
    cover_art_url, custom_cover, normalised_title, normalised_artist,
    normalised_artist_title, normalised_title_artist
  )
  select
    'album:' || albums.id::text,
    'album',
    albums.id,
    albums.title,
    albums.artist,
    albums.id,
    albums.title,
    albums.external_source,
    albums.external_id,
    null,
    coalesce(albums.original_release_date, albums.release_date),
    albums.cover_art_url,
    albums.custom_cover,
    normalised.normalised_title,
    normalised.normalised_artist,
    normalised.normalised_artist || ' ' || normalised.normalised_title,
    normalised.normalised_title || ' ' || normalised.normalised_artist
  from public.albums
  cross join lateral (
    select
      private.search_catalogue_normalise(albums.title) as normalised_title,
      private.search_catalogue_normalise(albums.artist) as normalised_artist
  ) normalised
  where albums.id = p_album_id
    and coalesce(albums.is_deleted, false) = false;

  -- Album edits change the title, artwork, dates and visibility displayed by
  -- every linked track, so update those projection rows in the same commit.
  for v_song_id in
    select songs.id from public.songs where songs.album_id = p_album_id
  loop
    perform private.sync_search_catalogue_song(v_song_id);
  end loop;
end;
$$;

create or replace function private.search_catalogue_album_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_artist text;
begin
  perform private.sync_search_catalogue_album(coalesce(new.id, old.id));

  if tg_op = 'DELETE' or (
    tg_op = 'UPDATE' and (
      private.search_catalogue_normalise(old.artist) is distinct from
        private.search_catalogue_normalise(new.artist)
      or coalesce(old.is_deleted, false) is distinct from
        coalesce(new.is_deleted, false)
    )
  ) then
    perform private.sync_search_catalogue_artist(old.artist);
  end if;
  if tg_op = 'INSERT' or (
    tg_op = 'UPDATE' and (
      private.search_catalogue_normalise(new.artist) is distinct from
        private.search_catalogue_normalise(old.artist)
      or coalesce(new.is_deleted, false) is distinct from
        coalesce(old.is_deleted, false)
    )
  ) then
    perform private.sync_search_catalogue_artist(new.artist);
  end if;

  if tg_op = 'DELETE' or (
    tg_op = 'UPDATE' and
    coalesce(old.is_deleted, false) is distinct from
      coalesce(new.is_deleted, false)
  ) then
    for affected_artist in
      select distinct songs.artist
      from public.songs
      where songs.album_id = coalesce(new.id, old.id)
        and nullif(btrim(songs.artist), '') is not null
    loop
      perform private.sync_search_catalogue_artist(affected_artist);
    end loop;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.search_catalogue_song_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_album_artist text;
  new_album_artist text;
  old_artist_key text;
  new_artist_key text;
begin
  perform private.sync_search_catalogue_song(coalesce(new.id, old.id));

  if tg_op <> 'INSERT' and old.album_id is not null then
    select albums.artist into old_album_artist
    from public.albums where albums.id = old.album_id;
  end if;
  if tg_op <> 'DELETE' and new.album_id is not null then
    select albums.artist into new_album_artist
    from public.albums where albums.id = new.album_id;
  end if;

  if tg_op <> 'INSERT' then
    old_artist_key := private.search_catalogue_normalise(
      coalesce(old.artist, old_album_artist)
    );
  end if;
  if tg_op <> 'DELETE' then
    new_artist_key := private.search_catalogue_normalise(
      coalesce(new.artist, new_album_artist)
    );
  end if;

  if tg_op = 'DELETE' or (
    tg_op = 'UPDATE' and (
      old_artist_key is distinct from new_artist_key
      or coalesce(old.is_deleted, false) is distinct from
        coalesce(new.is_deleted, false)
      or old.album_id is distinct from new.album_id
    )
  ) then
    perform private.sync_search_catalogue_artist(
      coalesce(old.artist, old_album_artist)
    );
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_deleted, false) = false
       and new_artist_key <> ''
       and not exists (
         select 1 from public.search_catalogue_projection
         where search_key = 'artist:' || new_artist_key
       ) then
      perform private.sync_search_catalogue_artist(
        coalesce(new.artist, new_album_artist)
      );
    end if;
  elsif tg_op = 'UPDATE' and (
    old_artist_key is distinct from new_artist_key
    or coalesce(old.is_deleted, false) is distinct from
      coalesce(new.is_deleted, false)
    or old.album_id is distinct from new.album_id
  ) then
    perform private.sync_search_catalogue_artist(
      coalesce(new.artist, new_album_artist)
    );
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

/*
  Identity changes are separate from catalogue membership. A verified
  artist_catalog row wins, while the shared MusicBrainz cache fills the ID for
  locally imported artists (including Status Quo) before a full sync exists.
*/
create or replace function private.search_catalogue_artist_identity_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'artist_catalog' then
    if tg_op <> 'INSERT' then
      perform private.sync_search_catalogue_artist(old.artist_name);
    end if;
    if tg_op <> 'DELETE' then
      perform private.sync_search_catalogue_artist(new.artist_name);
    end if;
  else
    if tg_op <> 'INSERT' then
      perform private.sync_search_catalogue_artist(old.artist_detail->>'name');
    end if;
    if tg_op <> 'DELETE' then
      perform private.sync_search_catalogue_artist(new.artist_detail->>'name');
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.search_catalogue_normalise(text) from public;
revoke all on function private.sync_search_catalogue_artist(text) from public;
revoke all on function private.sync_search_catalogue_song(bigint) from public;
revoke all on function private.sync_search_catalogue_album(bigint) from public;
revoke all on function private.search_catalogue_album_changed() from public;
revoke all on function private.search_catalogue_song_changed() from public;
revoke all on function private.search_catalogue_artist_identity_changed() from public;

drop trigger if exists search_catalogue_album_insert_delete on public.albums;
create trigger search_catalogue_album_insert_delete
after insert or delete on public.albums
for each row execute function private.search_catalogue_album_changed();

drop trigger if exists search_catalogue_album_update on public.albums;
create trigger search_catalogue_album_update
after update of title, artist, external_source, external_id, release_date,
  original_release_date, cover_art_url, custom_cover, is_deleted
on public.albums
for each row execute function private.search_catalogue_album_changed();

drop trigger if exists search_catalogue_song_insert_delete on public.songs;
create trigger search_catalogue_song_insert_delete
after insert or delete on public.songs
for each row execute function private.search_catalogue_song_changed();

drop trigger if exists search_catalogue_song_update on public.songs;
create trigger search_catalogue_song_update
after update of title, artist, album_id, external_source, external_id,
  canonical_song_id, is_deleted
on public.songs
for each row execute function private.search_catalogue_song_changed();

drop trigger if exists search_catalogue_artist_catalog_change on public.artist_catalog;
create trigger search_catalogue_artist_catalog_change
after insert or update of artist_name, musicbrainz_artist_id or delete
on public.artist_catalog
for each row execute function private.search_catalogue_artist_identity_changed();

drop trigger if exists search_catalogue_artist_cache_change on public.musicbrainz_artist_cache;
create trigger search_catalogue_artist_cache_change
after insert or update of artist_id, artist_detail or delete
on public.musicbrainz_artist_cache
for each row execute function private.search_catalogue_artist_identity_changed();

-- Backfill the complete existing catalogue without touching its source rows,
-- IDs, ratings or MusicBrainz links.
insert into public.search_catalogue_projection (
  search_key, result_type, local_id, title, artist, album_id, album_title,
  external_source, external_id, canonical_song_id, release_date,
  cover_art_url, custom_cover, normalised_title, normalised_artist,
  normalised_artist_title, normalised_title_artist
)
select
  'album:' || albums.id::text,
  'album', albums.id, albums.title, albums.artist, albums.id, albums.title,
  albums.external_source, albums.external_id, null,
  coalesce(albums.original_release_date, albums.release_date),
  albums.cover_art_url, albums.custom_cover,
  normalised.normalised_title, normalised.normalised_artist,
  normalised.normalised_artist || ' ' || normalised.normalised_title,
  normalised.normalised_title || ' ' || normalised.normalised_artist
from public.albums
cross join lateral (
  select
    private.search_catalogue_normalise(albums.title) as normalised_title,
    private.search_catalogue_normalise(albums.artist) as normalised_artist
) normalised
where coalesce(albums.is_deleted, false) = false;

insert into public.search_catalogue_projection (
  search_key, result_type, local_id, title, artist, album_id, album_title,
  external_source, external_id, canonical_song_id, release_date,
  cover_art_url, custom_cover, normalised_title, normalised_artist,
  normalised_artist_title, normalised_title_artist
)
select
  'song:' || songs.id::text,
  'song', songs.id, songs.title, coalesce(songs.artist, albums.artist),
  songs.album_id, albums.title, songs.external_source, songs.external_id,
  songs.canonical_song_id,
  coalesce(albums.original_release_date, albums.release_date),
  albums.cover_art_url, albums.custom_cover,
  normalised.normalised_title, normalised.normalised_artist,
  normalised.normalised_artist || ' ' || normalised.normalised_title,
  normalised.normalised_title || ' ' || normalised.normalised_artist
from public.songs
left join public.albums on albums.id = songs.album_id
cross join lateral (
  select
    private.search_catalogue_normalise(songs.title) as normalised_title,
    private.search_catalogue_normalise(coalesce(songs.artist, albums.artist))
      as normalised_artist
) normalised
where coalesce(songs.is_deleted, false) = false
  and (albums.id is null or coalesce(albums.is_deleted, false) = false);

with artist_names as (
  select albums.artist as name
  from public.albums
  where coalesce(albums.is_deleted, false) = false
  union
  select coalesce(songs.artist, albums.artist) as name
  from public.songs
  left join public.albums on albums.id = songs.album_id
  where coalesce(songs.is_deleted, false) = false
    and (albums.id is null or coalesce(albums.is_deleted, false) = false)
), normalised_names as (
  select artist_names.name,
    private.search_catalogue_normalise(artist_names.name) as normalised_name
  from artist_names
  where nullif(btrim(artist_names.name), '') is not null
), canonical_names as (
  select distinct on (normalised_names.normalised_name)
    normalised_names.name,
    normalised_names.normalised_name
  from normalised_names
  where normalised_names.normalised_name <> ''
  order by normalised_names.normalised_name,
    length(normalised_names.name), normalised_names.name
), identities as (
  select canonical_names.normalised_name,
    coalesce(
      (
        select artist_catalog.musicbrainz_artist_id
        from public.artist_catalog
        where artist_catalog.musicbrainz_artist_id is not null
          and private.search_catalogue_normalise(artist_catalog.artist_name) =
            canonical_names.normalised_name
        limit 1
      ),
      (
        select musicbrainz_artist_cache.artist_id::text
        from public.musicbrainz_artist_cache
        where private.search_catalogue_normalise(
          musicbrainz_artist_cache.artist_detail->>'name'
        ) = canonical_names.normalised_name
        limit 1
      )
    ) as musicbrainz_artist_id
  from canonical_names
)
insert into public.search_catalogue_projection (
  search_key, result_type, local_id, title, artist, album_id, album_title,
  external_source, external_id, canonical_song_id, release_date,
  cover_art_url, custom_cover, normalised_title, normalised_artist,
  normalised_artist_title, normalised_title_artist
)
select
  'artist:' || canonical_names.normalised_name,
  'artist', null, canonical_names.name, canonical_names.name, null, null,
  case when identities.musicbrainz_artist_id is not null then 'musicbrainz' end,
  identities.musicbrainz_artist_id, null, null, null, null,
  canonical_names.normalised_name, canonical_names.normalised_name,
  canonical_names.normalised_name || ' ' || canonical_names.normalised_name,
  canonical_names.normalised_name || ' ' || canonical_names.normalised_name
from canonical_names
join identities using (normalised_name);

-- The old SQL implementation expanded every row through generate_series for
-- typo matching. This bounded implementation keeps the same one-edit and
-- adjacent-transposition behaviour without spilling the projection to disk.
create or replace function public.search_catalogue_is_near(
  p_query text,
  p_title text
)
returns boolean
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
declare
  word text;
  candidate text;
  longer text;
  shorter text;
  mismatch_positions integer[];
  position integer;
begin
  foreach word in array regexp_split_to_array(p_title, ' ') loop
    candidate := case
      when length(word) > length(p_query) then left(word, length(p_query))
      else word
    end;

    if abs(length(p_query) - length(candidate)) > 1 then continue; end if;
    if p_query = candidate then return true; end if;

    if length(p_query) = length(candidate) then
      mismatch_positions := array[]::integer[];
      for position in 1..length(p_query) loop
        if substring(p_query from position for 1) <>
           substring(candidate from position for 1) then
          mismatch_positions := array_append(mismatch_positions, position);
          if cardinality(mismatch_positions) > 2 then exit; end if;
        end if;
      end loop;

      if cardinality(mismatch_positions) = 1 then return true; end if;
      if cardinality(mismatch_positions) = 2
         and mismatch_positions[2] = mismatch_positions[1] + 1
         and substring(p_query from mismatch_positions[1] for 1) =
             substring(candidate from mismatch_positions[2] for 1)
         and substring(p_query from mismatch_positions[2] for 1) =
             substring(candidate from mismatch_positions[1] for 1) then
        return true;
      end if;
      continue;
    end if;

    if length(p_query) > length(candidate) then
      longer := p_query;
      shorter := candidate;
    else
      longer := candidate;
      shorter := p_query;
    end if;

    for position in 1..length(longer) loop
      if overlay(longer placing '' from position for 1) = shorter then
        return true;
      end if;
    end loop;
  end loop;

  return false;
end;
$$;

revoke all on function public.search_catalogue_is_near(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.search_catalogue_is_near(text, text)
  to anon, authenticated, service_role;

create or replace function public.search_catalogue(
  p_query text,
  p_per_type_limit integer default 20
)
returns table (
  result_type text,
  local_id bigint,
  title text,
  artist text,
  album_id bigint,
  album_title text,
  external_source text,
  external_id text,
  canonical_song_id uuid,
  release_date date,
  cover_art_url text,
  custom_cover text,
  community_average numeric,
  community_count bigint,
  match_score integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  input as (
    select
      trim(regexp_replace(
        translate(
          lower(coalesce(p_query, '')),
          'áàâäãåāéèêëēíìîïīóòôöõōúùûüūçñýÿžš',
          'aaaaaaaeeeeeiiiiioooooouuuuucnyyzs'
        ),
        '[^[:alnum:]]+',
        ' ',
        'g'
      )) as query_text,
      greatest(1, least(coalesce(p_per_type_limit, 20), 50)) as result_limit
  ),
  strong_scored as materialized (
    select projection.*,
      case
        when projection.result_type = 'artist'
          and projection.normalised_title = input.query_text then 500
        when projection.normalised_title = input.query_text then 400
        when projection.result_type = 'artist'
          and projection.normalised_title like input.query_text || '%' then 350
        when projection.normalised_title like input.query_text || '%' then 300
        when strpos(projection.normalised_title, input.query_text) > 0 then 200
        when strpos(projection.normalised_artist_title, input.query_text) > 0
          or strpos(projection.normalised_title_artist, input.query_text) > 0
          then 180
        else 0
      end as match_score
    from public.search_catalogue_projection projection
    cross join input
    where input.query_text <> ''
      and (
        projection.normalised_title = input.query_text
        or projection.normalised_title like input.query_text || '%'
        or strpos(projection.normalised_title, input.query_text) > 0
        or strpos(projection.normalised_artist_title, input.query_text) > 0
        or strpos(projection.normalised_title_artist, input.query_text) > 0
      )
  ),
  useful_strong as (
    select coalesce(bool_or(strong_scored.match_score >= 300), false) as found
    from strong_scored
  ),
  fuzzy_scored as materialized (
    select projection.*, 100 as match_score
    from public.search_catalogue_projection projection
    cross join input
    cross join useful_strong
    where useful_strong.found = false
      and length(input.query_text) >= 4
      and public.search_catalogue_is_near(
        input.query_text,
        projection.normalised_title
      )
  ),
  candidate_scores as (
    select * from strong_scored
    union all
    select fuzzy_scored.*
    from fuzzy_scored
    where not exists (
      select 1 from strong_scored
      where strong_scored.search_key = fuzzy_scored.search_key
    )
  ),
  selected as materialized (
    select ranked.*
    from (
      select candidate_scores.*,
        row_number() over (
          partition by candidate_scores.result_type
          order by candidate_scores.match_score desc,
            length(candidate_scores.normalised_title),
            candidate_scores.normalised_title,
            candidate_scores.local_id nulls last
        ) as type_rank
      from candidate_scores
    ) ranked
    cross join input
    where ranked.type_rank <= input.result_limit
  ),
  matched_album_ratings as (
    select selected.local_id,
      avg(ratings.rating) as average_rating,
      count(ratings.rating)::bigint as rating_count
    from selected
    join public.ratings on ratings.album_id = selected.local_id
    where selected.result_type = 'album'
    group by selected.local_id
  ),
  matched_song_ratings as (
    select selected.local_id,
      avg(song_ratings.rating) as average_rating,
      count(song_ratings.rating)::bigint as rating_count
    from selected
    join public.song_ratings on
      (selected.canonical_song_id is not null
        and song_ratings.canonical_song_id = selected.canonical_song_id)
      or (selected.canonical_song_id is null
        and song_ratings.song_id = selected.local_id)
    where selected.result_type = 'song'
    group by selected.local_id
  )
  select
    selected.result_type,
    selected.local_id,
    selected.title,
    selected.artist,
    selected.album_id,
    selected.album_title,
    selected.external_source,
    selected.external_id,
    selected.canonical_song_id,
    selected.release_date,
    selected.cover_art_url,
    selected.custom_cover,
    case selected.result_type
      when 'album' then matched_album_ratings.average_rating
      when 'song' then matched_song_ratings.average_rating
      else null::numeric
    end as community_average,
    case selected.result_type
      when 'album' then coalesce(matched_album_ratings.rating_count, 0)
      when 'song' then coalesce(matched_song_ratings.rating_count, 0)
      else 0::bigint
    end as community_count,
    selected.match_score
  from selected
  left join matched_album_ratings
    on matched_album_ratings.local_id = selected.local_id
    and selected.result_type = 'album'
  left join matched_song_ratings
    on matched_song_ratings.local_id = selected.local_id
    and selected.result_type = 'song'
  order by selected.match_score desc,
    case selected.result_type when 'artist' then 0 when 'album' then 1 else 2 end,
    length(selected.normalised_title),
    selected.normalised_title,
    selected.local_id nulls last;
$$;

revoke all on function public.search_catalogue(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_catalogue(text, integer)
  to anon, authenticated, service_role;

commit;
