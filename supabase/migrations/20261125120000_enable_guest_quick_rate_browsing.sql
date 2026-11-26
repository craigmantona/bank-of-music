revoke all on function public.get_quick_rate_year(text, integer) from public, anon, authenticated;
grant execute on function public.get_quick_rate_year(text, integer) to anon, authenticated;

comment on function public.get_quick_rate_year(text, integer) is
  'Returns the read-only Quick Rate year projection for guests and members. Personal ratings remain scoped to auth.uid().';
