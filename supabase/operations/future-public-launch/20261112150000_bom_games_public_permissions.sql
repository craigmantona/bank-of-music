-- FUTURE PUBLIC LAUNCH ONLY. Do not include in the admin-preview deployment.
-- Requires separate approval after rating readiness and production launch review.
begin;

grant execute on function public.get_bom_higher_lower_pool(text, integer, integer, text)
  to anon, authenticated;
grant execute on function public.get_bom_daily_challenge(text)
  to anon, authenticated;
grant execute on function public.get_my_bom_daily_attempt(text)
  to authenticated;
grant execute on function public.start_bom_daily_attempt(text, date)
  to authenticated;
grant execute on function public.submit_bom_daily_attempt(text, date, jsonb)
  to authenticated;
grant execute on function public.get_bom_game_readiness()
  to anon, authenticated;

commit;
