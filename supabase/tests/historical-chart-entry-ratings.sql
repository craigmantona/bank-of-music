-- Execute only after creating the Phase 1 objects inside the same rollback-only
-- transaction. Every temporary rating written here is rolled back by the caller.
create temp table historical_rating_test_context as
select
  (select id from auth.users order by id limit 1) as user_one,
  (select id from auth.users order by id offset 1 limit 1) as user_two,
  (select id from public.quick_rate_collection_tracks where collection_key='uk-number-ones' and match_status='unresolved' and song_id is null order by id limit 1) as unresolved_entry,
  (select id from public.quick_rate_collection_tracks where collection_key='uk-number-ones' and song_id is not null order by id limit 1) as verified_entry;
grant select on historical_rating_test_context to anon, authenticated;

select set_config('request.jwt.claim.sub',(select user_one::text from historical_rating_test_context),true);
set local role authenticated;
select * from public.set_historical_chart_entry_rating((select unresolved_entry from historical_rating_test_context),0::smallint);
do $$ begin
  if not exists(select 1 from public.historical_chart_entry_ratings r where r.user_id=(select auth.uid()) and r.rating=0) then raise exception 'zero boundary failed'; end if;
end $$;
select * from public.set_historical_chart_entry_rating((select unresolved_entry from historical_rating_test_context),10::smallint);
do $$ begin
  if not exists(select 1 from public.historical_chart_entry_ratings r where r.user_id=(select auth.uid()) and r.rating=10) then raise exception 'ten boundary or update failed'; end if;
end $$;
do $$ begin
  perform public.set_historical_chart_entry_rating((select unresolved_entry from historical_rating_test_context),11::smallint);
  raise exception 'invalid high accepted';
exception when numeric_value_out_of_range then null; end $$;
do $$ begin
  perform public.set_historical_chart_entry_rating((select unresolved_entry from historical_rating_test_context),(-1)::smallint);
  raise exception 'invalid low accepted';
exception when numeric_value_out_of_range then null; end $$;
do $$ begin
  perform public.set_historical_chart_entry_rating((select verified_entry from historical_rating_test_context),5::smallint);
  raise exception 'verified entry accepted a provisional rating';
exception when no_data_found then null; end $$;
do $$ begin
  insert into public.historical_chart_entry_ratings(user_id,chart_entry_id,rating)
  values ((select auth.uid()),(select unresolved_entry from historical_rating_test_context),5);
  raise exception 'direct insert succeeded';
exception when insufficient_privilege then null; end $$;

reset role;
select set_config('request.jwt.claim.sub',(select user_two::text from historical_rating_test_context),true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.historical_chart_entry_ratings) then raise exception 'user isolation failed'; end if;
end $$;
select * from public.set_historical_chart_entry_rating((select unresolved_entry from historical_rating_test_context),6::smallint);
do $$ declare s record; begin
  select * into s from public.get_historical_chart_entry_rating_summaries(array[(select unresolved_entry from historical_rating_test_context)]);
  if s.community_average<>8.0 or s.community_rating_count<>2 or s.personal_rating<>6 then raise exception 'authenticated aggregate mismatch: %',row_to_json(s); end if;
end $$;
select * from public.set_historical_chart_entry_rating((select unresolved_entry from historical_rating_test_context),null::smallint);
do $$ declare s record; begin
  select * into s from public.get_historical_chart_entry_rating_summaries(array[(select unresolved_entry from historical_rating_test_context)]);
  if s.community_average<>10.0 or s.community_rating_count<>1 or s.personal_rating is not null then raise exception 'clear mismatch: %',row_to_json(s); end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
  perform public.set_historical_chart_entry_rating((select unresolved_entry from historical_rating_test_context),5::smallint);
  raise exception 'anonymous write succeeded';
exception when insufficient_privilege then null; end $$;
do $$ declare s record; begin
  select * into s from public.get_historical_chart_entry_rating_summaries(array[(select unresolved_entry from historical_rating_test_context)]);
  if s.community_average<>10.0 or s.community_rating_count<>1 or s.personal_rating is not null then raise exception 'anonymous aggregate mismatch: %',row_to_json(s); end if;
end $$;
reset role;

select jsonb_build_object(
  'boundaries','pass','invalid_ratings','pass','verified_exclusion','pass','direct_write_block','pass',
  'user_isolation','pass','atomic_update','pass','clear','pass','authenticated_summary','pass','anonymous_summary','pass',
  'public_summary_shape',pg_get_function_result('public.get_historical_chart_entry_rating_summaries(bigint[])'::regprocedure)
) as behavioural_validation;
