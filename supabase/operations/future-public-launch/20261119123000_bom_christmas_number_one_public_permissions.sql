-- FUTURE PUBLIC LAUNCH ONLY.
-- Do not apply with the schema migration. Applying this file requires explicit
-- owner approval, a configured annual row, completed staging verification and
-- a reviewed deployment with BOM_CHRISTMAS_NUMBER_ONE_FEATURE.enabled = true.
begin;
grant execute on function public.cast_bom_christmas_number_one_vote(smallint, uuid) to authenticated;
grant execute on function public.get_bom_christmas_number_one_state(smallint) to anon, authenticated;
grant execute on function public.get_bom_christmas_number_one_archive() to anon, authenticated;
commit;
