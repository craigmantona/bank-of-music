begin;

create table public.artist_hero_overrides (
  artist_key text primary key,
  artist_name text not null,
  musicbrainz_artist_id text,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index artist_hero_overrides_musicbrainz_id_idx
  on public.artist_hero_overrides (musicbrainz_artist_id)
  where musicbrainz_artist_id is not null;

alter table public.artist_hero_overrides enable row level security;

revoke all on table public.artist_hero_overrides from anon, authenticated;
grant select on table public.artist_hero_overrides to anon, authenticated;
grant insert, update, delete on table public.artist_hero_overrides to authenticated;
grant all on table public.artist_hero_overrides to service_role;

create policy "Artist hero overrides are publicly readable"
  on public.artist_hero_overrides
  for select
  to anon, authenticated
  using (true);

create policy "Admins can insert artist hero overrides"
  on public.artist_hero_overrides
  for insert
  to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.is_admin is true
    )
  );

create policy "Admins can update artist hero overrides"
  on public.artist_hero_overrides
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.is_admin is true
    )
  )
  with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.is_admin is true
    )
  );

create policy "Admins can delete artist hero overrides"
  on public.artist_hero_overrides
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.is_admin is true
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'artist-hero-images',
  'artist-hero-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Admins can inspect artist hero objects"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'artist-hero-images'
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.is_admin is true
    )
  );

create policy "Admins can upload artist hero objects"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'artist-hero-images'
    and owner_id = (select auth.uid()::text)
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.is_admin is true
    )
  );

create policy "Admins can delete artist hero objects"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'artist-hero-images'
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.is_admin is true
    )
  );

commit;
