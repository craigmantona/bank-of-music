begin;

-- Additive provenance only. Existing album rows are deliberately untouched.
alter table public.albums
  add column musicbrainz_release_group_id text,
  add column musicbrainz_release_id text,
  add column original_release_date date,
  add column canonical_release_date date,
  add column canonical_release_country text,
  add column catalogue_selection_version integer;

create unique index albums_musicbrainz_release_group_unique
  on public.albums (musicbrainz_release_group_id)
  where musicbrainz_release_group_id is not null and is_deleted is not true;

create table public.artist_catalogue_overrides (
  release_group_id text primary key,
  qualification text not null check (qualification in ('include','exclude','review')),
  canonical_release_id text,
  original_release_date text,
  reason text not null,
  evidence_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.artist_catalogue_shadow_snapshots (
  job_id bigint not null references public.artist_import_queue(id) on delete cascade,
  qualification_version integer not null,
  qualified_release_group_ids jsonb not null default '[]'::jsonb,
  review_release_group_ids jsonb not null default '[]'::jsonb,
  legacy_processed_release_group_ids jsonb not null default '[]'::jsonb,
  proposed_next_index integer not null default 0,
  ready boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (job_id, qualification_version)
);

create table public.artist_catalogue_shadow_decisions (
  job_id bigint not null references public.artist_import_queue(id) on delete cascade,
  release_group_id text not null,
  qualification_version integer not null,
  selection_version integer not null,
  release_group_title text not null,
  original_release_date text,
  qualification text not null check (qualification in ('include','exclude','review')),
  qualification_reason text not null,
  proposed_release_id text,
  proposed_release_date text,
  proposed_release_country text,
  selection_strategy text,
  legacy_release_id text,
  legacy_reason text,
  observed_at timestamptz not null default now(),
  primary key (job_id, release_group_id, qualification_version, selection_version)
);

alter table public.artist_catalogue_overrides enable row level security;
alter table public.artist_catalogue_shadow_snapshots enable row level security;
alter table public.artist_catalogue_shadow_decisions enable row level security;
revoke all on public.artist_catalogue_overrides,
  public.artist_catalogue_shadow_snapshots,
  public.artist_catalogue_shadow_decisions from public, anon, authenticated;
grant select, insert, update, delete on public.artist_catalogue_overrides,
  public.artist_catalogue_shadow_snapshots,
  public.artist_catalogue_shadow_decisions to service_role;

-- Initial reviewed exceptions are data-driven and keyed only by MusicBrainz ID.
insert into public.artist_catalogue_overrides
  (release_group_id, qualification, reason)
values
  ('51c70552-4906-3b27-b3f4-f64e764551d0', 'exclude', 'Collaboration; not a core Fleetwood Mac studio album'),
  ('2fd2b90f-eebc-4a84-93ff-c54397dfb464', 'exclude', 'Duplicate abbreviated representation of an existing studio album'),
  ('84cf1d46-2e8c-430e-8361-f04ebf87f20d', 'review', 'First official publication is much later than the release-group date'),
  ('d2e4838d-90e1-471c-bda0-fd816dabb2d4', 'review', 'Re-recording policy is not yet decided'),
  ('67727253-f1c0-4243-9270-f9f1401c3b8c', 'review', 'Re-recording policy is not yet decided'),
  ('0441b1b2-de57-4a9a-b007-1f6e159921d5', 'review', 'Re-recording policy is not yet decided'),
  ('1c4770b3-b7a3-4d44-a7a9-8e2dbb74b85a', 'review', 'Re-recording policy is not yet decided');

commit;
