-- Album inserts synchronize the backend-only tracked artist queue through this
-- trigger function. Run only that trigger body with its owner's privileges;
-- keep the function unavailable as a client-callable RPC.
alter function public.sync_tracked_artist_from_album() security definer;
alter function public.sync_tracked_artist_from_album() set search_path = pg_catalog;

revoke execute on function public.sync_tracked_artist_from_album() from public;
revoke execute on function public.sync_tracked_artist_from_album() from anon;
revoke execute on function public.sync_tracked_artist_from_album() from authenticated;
