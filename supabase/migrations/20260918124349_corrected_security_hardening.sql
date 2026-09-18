begin;

-- Browser profile writes must never include privilege-bearing or generated
-- columns. Existing profile reads and service-role administration are retained.
revoke insert, update on table public.profiles from anon, authenticated;
grant insert (id, handle, birth_year) on table public.profiles to authenticated;
grant update (handle, birth_year) on table public.profiles to authenticated;

-- Catalogue rows may still be created by signed-in users and admins through
-- their existing policies. Anonymous browsing remains read-only.
drop policy if exists "Anyone can insert albums" on public.albums;
drop policy if exists "Anyone can insert songs" on public.songs;
revoke insert on table public.albums from anon;
revoke insert on table public.songs from anon;

-- Import bookkeeping is backend-only. The current catalogue worker uses the
-- service role, which retains explicit table and sequence access.
alter table public.tracked_artists enable row level security;
alter table public.release_import_runs enable row level security;

revoke all on table public.tracked_artists from anon, authenticated;
revoke all on table public.release_import_runs from anon, authenticated;
revoke all on sequence public.tracked_artists_id_seq from anon, authenticated;
revoke all on sequence public.release_import_runs_id_seq from anon, authenticated;

grant all on table public.tracked_artists to service_role;
grant all on table public.release_import_runs to service_role;
grant all on sequence public.tracked_artists_id_seq to service_role;
grant all on sequence public.release_import_runs_id_seq to service_role;

-- The lease-fenced catalogue_worker RPC supersedes this legacy claim function.
-- Keep it unavailable to every application role, including service_role.
revoke all on function public.claim_next_artist_import() from public;
revoke all on function public.claim_next_artist_import() from anon;
revoke all on function public.claim_next_artist_import() from authenticated;
revoke all on function public.claim_next_artist_import() from service_role;

commit;
