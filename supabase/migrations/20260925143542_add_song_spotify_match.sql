begin;

alter table public.songs
  add column if not exists spotify_track_id text,
  add column if not exists spotify_matched_at timestamptz;

comment on column public.songs.spotify_track_id is
  'Trusted backend-resolved Spotify track identifier for optional playback.';

comment on column public.songs.spotify_matched_at is
  'Time the trusted backend last confirmed spotify_track_id.';

create or replace function public.guard_song_spotify_match_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (
    (tg_op = 'INSERT' and new.spotify_track_id is null and new.spotify_matched_at is null)
    or
    (tg_op = 'UPDATE'
      and new.spotify_track_id is not distinct from old.spotify_track_id
      and new.spotify_matched_at is not distinct from old.spotify_matched_at)
  ) then
    return new;
  end if;

  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or exists (
      select 1
      from public.profiles
      where id = auth.uid() and is_admin = true
    )
  then
    return new;
  end if;

  raise exception 'Spotify matches may only be assigned by a trusted backend or admin'
    using errcode = '42501';
end;
$$;

revoke all on function public.guard_song_spotify_match_write() from public;
revoke all on function public.guard_song_spotify_match_write() from anon;
revoke all on function public.guard_song_spotify_match_write() from authenticated;

drop trigger if exists guard_song_spotify_match_write on public.songs;
create trigger guard_song_spotify_match_write
before insert or update of spotify_track_id, spotify_matched_at on public.songs
for each row execute function public.guard_song_spotify_match_write();

commit;
