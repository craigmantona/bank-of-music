begin;

create table public.canonical_recordings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null,
  musicbrainz_recording_id text check (
    musicbrainz_recording_id is null or
    musicbrainz_recording_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  wikidata_qid text check (wikidata_qid is null or wikidata_qid ~ '^Q[1-9][0-9]*$'),
  preferred_spotify_track_id text,
  origin_key text unique,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index canonical_recordings_mbid_unique
  on public.canonical_recordings (lower(musicbrainz_recording_id))
  where musicbrainz_recording_id is not null;
alter table public.canonical_recordings enable row level security;
create policy "Canonical recordings are publicly readable"
  on public.canonical_recordings for select to anon, authenticated using (true);
revoke all on table public.canonical_recordings from public, anon, authenticated;
grant select on table public.canonical_recordings to anon, authenticated;
grant all on table public.canonical_recordings to service_role;

alter table public.songs
  add constraint songs_canonical_song_id_fkey
  foreign key (canonical_song_id) references public.canonical_recordings(id) on delete set null;

alter table public.song_ratings
  add column canonical_song_id uuid references public.canonical_recordings(id) on delete restrict;
alter table public.song_ratings
  add constraint song_ratings_user_canonical_unique unique (user_id, canonical_song_id);
create index song_ratings_canonical_song_id_idx
  on public.song_ratings (canonical_song_id)
  where canonical_song_id is not null;

alter table public.quick_rate_collection_tracks
  add column canonical_song_id uuid references public.canonical_recordings(id) on delete set null;
create index quick_rate_collection_tracks_canonical_idx
  on public.quick_rate_collection_tracks (canonical_song_id)
  where canonical_song_id is not null;

create table public.canonical_rating_migration_audit (
  user_id uuid not null,
  canonical_song_id uuid not null references public.canonical_recordings(id) on delete cascade,
  legacy_row_count integer not null,
  distinct_rating_count integer not null,
  ratings numeric[] not null,
  status text not null check (status in ('safe_single', 'safe_duplicate_identical', 'conflict')),
  audited_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, canonical_song_id)
);
alter table public.canonical_rating_migration_audit enable row level security;
revoke all on table public.canonical_rating_migration_audit from public, anon, authenticated;
grant select, insert, update, delete on table public.canonical_rating_migration_audit to service_role;

-- Seed one permanent BOM UUID for each existing valid MusicBrainz recording.
insert into public.canonical_recordings (title, artist, musicbrainz_recording_id, origin_key, source_metadata)
select
  (array_agg(s.title order by s.id))[1],
  (array_agg(s.artist order by s.id))[1],
  lower(s.external_id),
  'musicbrainz:' || lower(s.external_id),
  jsonb_build_object('seed', 'existing_musicbrainz_occurrences')
from public.songs s
where s.external_source = 'musicbrainz'
  and s.external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
group by lower(s.external_id)
on conflict (origin_key) do nothing;

update public.songs s
set canonical_song_id = c.id
from public.canonical_recordings c
where s.canonical_song_id is null
  and s.external_source = 'musicbrainz'
  and lower(s.external_id) = lower(c.musicbrainz_recording_id);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.assign_song_canonical_recording()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recording_id text;
  v_canonical_id uuid;
begin
  if new.canonical_song_id is not null
     or new.external_source is distinct from 'musicbrainz'
     or new.external_id is null
     or new.external_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return new;
  end if;

  if (select auth.uid()) is not null and not exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin is true
  ) then
    raise exception 'Canonical recording management requires admin access' using errcode = '42501';
  end if;

  v_recording_id := lower(new.external_id);
  select c.id into v_canonical_id
  from public.canonical_recordings c
  where lower(c.musicbrainz_recording_id) = v_recording_id;

  if v_canonical_id is null then
    insert into public.canonical_recordings (
      title, artist, musicbrainz_recording_id, origin_key, source_metadata
    ) values (
      new.title, new.artist, v_recording_id, 'musicbrainz:' || v_recording_id,
      jsonb_build_object('seed', 'trusted_song_insert')
    )
    on conflict (origin_key) do update set updated_at = timezone('utc', now())
    returning id into v_canonical_id;
  end if;

  new.canonical_song_id := v_canonical_id;
  return new;
end;
$$;

revoke all on function private.assign_song_canonical_recording() from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.assign_song_canonical_recording() to service_role;

create trigger assign_song_canonical_recording
before insert or update of external_source, external_id on public.songs
for each row execute function private.assign_song_canonical_recording();

insert into public.canonical_rating_migration_audit (
  user_id, canonical_song_id, legacy_row_count, distinct_rating_count, ratings, status
)
select
  r.user_id,
  s.canonical_song_id,
  count(*)::integer,
  count(distinct r.rating)::integer,
  array_agg(distinct r.rating order by r.rating),
  case
    when count(distinct r.rating) > 1 then 'conflict'
    when count(*) > 1 then 'safe_duplicate_identical'
    else 'safe_single'
  end
from public.song_ratings r
join public.songs s on s.id = r.song_id
where r.canonical_song_id is null and s.canonical_song_id is not null
group by r.user_id, s.canonical_song_id
on conflict (user_id, canonical_song_id) do update set
  legacy_row_count = excluded.legacy_row_count,
  distinct_rating_count = excluded.distinct_rating_count,
  ratings = excluded.ratings,
  status = excluded.status,
  audited_at = timezone('utc', now());

-- Add one authoritative canonical row only for non-conflicting groups.
-- Legacy occurrence rows remain intact for rollback and parity checks.
insert into public.song_ratings (user_id, song_id, canonical_song_id, rating, created_at)
select
  a.user_id,
  null,
  a.canonical_song_id,
  a.ratings[1],
  timezone('utc', now())
from public.canonical_rating_migration_audit a
where a.status <> 'conflict'
on conflict (user_id, canonical_song_id) do nothing;

create or replace view public.song_rating_charts
with (security_invoker = true)
as
with effective_ratings as (
  select r.user_id, s.id as song_id, r.rating
  from public.song_ratings r
  join public.songs s on s.canonical_song_id = r.canonical_song_id
  where r.canonical_song_id is not null
  union all
  select r.user_id, r.song_id, r.rating
  from public.song_ratings r
  join public.songs s on s.id = r.song_id
  where r.canonical_song_id is null
    and not exists (
      select 1 from public.song_ratings canonical
      where canonical.user_id = r.user_id
        and canonical.canonical_song_id = s.canonical_song_id
    )
)
select s.id as item_id, 'song'::text as item_type, s.title, s.artist, s.album_id,
  round(avg(r.rating), 1) as average_rating, count(r.rating) as rating_count
from effective_ratings r
join public.songs s on s.id = r.song_id
group by s.id, s.title, s.artist, s.album_id;

grant select on table public.song_rating_charts to anon, authenticated, service_role;

commit;
