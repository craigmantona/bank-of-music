begin;

alter table public.artist_catalogue_overrides
  add column decision_source text not null default 'automatic'
    check (decision_source in ('automatic', 'policy', 'human'));

-- Preserve deliberate seeded policy and completed human decisions. Rows created by
-- shadow review discovery remain automatic evidence and may be re-evaluated.
update public.artist_catalogue_overrides
set decision_source = case
  when decided_at is not null then 'human'
  when release_group_id in (
    '51c70552-4906-3b27-b3f4-f64e764551d0',
    '2fd2b90f-eebc-4a84-93ff-c54397dfb464',
    '84cf1d46-2e8c-430e-8361-f04ebf87f20d',
    'd2e4838d-90e1-471c-bda0-fd816dabb2d4',
    '67727253-f1c0-4243-9270-f9f1401c3b8c',
    '0441b1b2-de57-4a9a-b007-1f6e159921d5',
    '1c4770b3-b7a3-4d44-a7a9-8e2dbb74b85a',
    '84f508a9-beae-3e97-b59e-3a8886c6e901'
  ) then 'policy'
  when qualification in ('include', 'exclude') then 'policy'
  else 'automatic'
end;

alter table public.artist_catalogue_shadow_decisions
  add column artist_credit jsonb not null default '[]'::jsonb;

create or replace function public.upsert_artist_catalogue_review(
  p_release_group_id text,
  p_musicbrainz_artist_id text,
  p_artist_name text,
  p_release_group_title text,
  p_release_group_original_date text,
  p_review_reason text,
  p_proposed_release_id text default null,
  p_proposed_release_date text default null,
  p_proposed_release_country text default null,
  p_proposed_selection_strategy text default null
) returns public.artist_catalogue_overrides
language plpgsql security definer
set search_path = public
as $$
declare result public.artist_catalogue_overrides;
begin
  insert into public.artist_catalogue_overrides (
    release_group_id, qualification, reason, decision_source,
    musicbrainz_artist_id, artist_name, release_group_title,
    release_group_original_date, review_reason, proposed_release_id,
    proposed_release_date, proposed_release_country, proposed_selection_strategy
  ) values (
    p_release_group_id, 'review', p_review_reason, 'automatic',
    p_musicbrainz_artist_id, p_artist_name, p_release_group_title,
    p_release_group_original_date, p_review_reason, p_proposed_release_id,
    p_proposed_release_date, p_proposed_release_country, p_proposed_selection_strategy
  )
  on conflict (release_group_id) do update set
    musicbrainz_artist_id = excluded.musicbrainz_artist_id,
    artist_name = excluded.artist_name,
    release_group_title = excluded.release_group_title,
    release_group_original_date = excluded.release_group_original_date,
    review_reason = excluded.review_reason,
    proposed_release_id = coalesce(excluded.proposed_release_id, artist_catalogue_overrides.proposed_release_id),
    proposed_release_date = coalesce(excluded.proposed_release_date, artist_catalogue_overrides.proposed_release_date),
    proposed_release_country = coalesce(excluded.proposed_release_country, artist_catalogue_overrides.proposed_release_country),
    proposed_selection_strategy = coalesce(excluded.proposed_selection_strategy, artist_catalogue_overrides.proposed_selection_strategy),
    updated_at = now()
  where artist_catalogue_overrides.decision_source = 'automatic'
    and artist_catalogue_overrides.qualification = 'review'
  returning * into result;

  if result.release_group_id is null then
    select * into result from public.artist_catalogue_overrides
      where release_group_id = p_release_group_id;
  end if;
  return result;
end;
$$;

revoke all on function public.upsert_artist_catalogue_review(
  text,text,text,text,text,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.upsert_artist_catalogue_review(
  text,text,text,text,text,text,text,text,text,text
) to service_role;

commit;
