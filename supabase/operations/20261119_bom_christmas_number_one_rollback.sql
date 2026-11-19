-- REVIEWED ROLLBACK PLAN — DO NOT APPLY AUTOMATICALLY.
-- 1. Set BOM_CHRISTMAS_NUMBER_ONE_FEATURE.enabled=false and deploy that change.
-- 2. Revoke official RPC grants, then export the six Christmas Number 1 tables.
-- 3. Confirm no required annual result would be lost before running the drops.
begin;
revoke all on function public.cast_bom_christmas_number_one_vote(smallint, uuid) from public, anon, authenticated;
revoke all on function public.get_bom_christmas_number_one_state(smallint) from public, anon, authenticated;
revoke all on function public.get_bom_christmas_number_one_archive() from public, anon, authenticated;
drop function if exists public.admin_set_bom_christmas_number_one_year(smallint, text, uuid, text);
drop function if exists public.get_bom_admin_christmas_number_one_results(smallint, boolean, text);
drop function if exists public.resolve_bom_admin_christmas_number_one_preview_tie(smallint, uuid, text);
drop function if exists public.get_bom_admin_christmas_number_one_preview(smallint);
drop function if exists public.cast_bom_admin_christmas_number_one_preview_vote(smallint, uuid);
drop function if exists public.get_bom_christmas_number_one_archive();
drop function if exists public.get_bom_christmas_number_one_state(smallint);
drop function if exists public.cast_bom_christmas_number_one_vote(smallint, uuid);
drop function if exists private.christmas_number_one_results(smallint);
drop function if exists private.christmas_number_one_phase(smallint, timestamptz);
drop function if exists private.christmas_number_one_schedule(smallint);
drop function if exists private.require_bom_admin();
drop function if exists private.christmas_number_one_now();
drop table if exists public.christmas_number_one_admin_audit;
drop table if exists public.christmas_number_one_preview_tie_resolutions;
drop table if exists public.christmas_number_one_preview_votes;
drop table if exists public.christmas_number_one_votes;
drop table if exists public.christmas_number_one_years;
drop table if exists public.christmas_number_one_candidates;
commit;
