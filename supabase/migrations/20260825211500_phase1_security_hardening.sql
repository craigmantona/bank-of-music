begin;

-- Profiles are created and edited by the browser, but users must never be
-- able to supply or change privilege-bearing columns such as is_admin.
revoke insert, update on table public.profiles from anon, authenticated;
grant insert (id, handle, birth_year) on table public.profiles to authenticated;
grant update (handle, birth_year) on table public.profiles to authenticated;

-- Preserve authenticated catalogue auto-save while removing anonymous writes.
drop policy if exists "Anyone can insert albums" on public.albums;
drop policy if exists "Anyone can insert songs" on public.songs;

-- Import bookkeeping is backend-only. service_role bypasses RLS and retains
-- its existing explicit grants.
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

-- Queue claiming is an internal worker operation, never a public RPC.
revoke all on function public.claim_next_artist_import() from public;
revoke all on function public.claim_next_artist_import() from anon;
revoke all on function public.claim_next_artist_import() from authenticated;
grant execute on function public.claim_next_artist_import() to service_role;

commit;
