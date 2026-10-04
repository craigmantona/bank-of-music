create table public.musicbrainz_artist_cache (
  artist_id uuid primary key,
  artist_detail jsonb not null,
  release_groups jsonb not null,
  fetched_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint musicbrainz_artist_cache_detail_object
    check (jsonb_typeof(artist_detail) = 'object'),
  constraint musicbrainz_artist_cache_release_groups_array
    check (jsonb_typeof(release_groups) = 'array')
);

comment on table public.musicbrainz_artist_cache is
  'Seven-day shared cache for the MusicBrainz artist detail and release-group responses used by artist pages. It is not BOM catalogue data.';

alter table public.musicbrainz_artist_cache enable row level security;

revoke all on table public.musicbrainz_artist_cache from public, anon, authenticated;
grant select, insert, update on table public.musicbrainz_artist_cache to service_role;
