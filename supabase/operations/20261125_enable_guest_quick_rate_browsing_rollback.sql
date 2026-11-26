-- Phase 1A database rollback. Run only after the guest frontend has been
-- removed or Cloudflare has been rolled back to the recorded production target.
-- This changes function permissions and documentation only; it does not mutate data.
begin;

revoke all
on function public.get_quick_rate_year(text, integer)
from public, anon, authenticated;

grant execute
on function public.get_quick_rate_year(text, integer)
to authenticated;

comment on function public.get_quick_rate_year(text, integer) is
  'Returns a lightweight authenticated Quick Rate projection for UK No.1s or catalogue tracks by original release year.';

commit;
