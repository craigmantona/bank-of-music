begin;

alter table public.artist_catalogue_overrides
  add column musicbrainz_artist_id text,
  add column artist_name text,
  add column release_group_title text,
  add column release_group_original_date text,
  add column review_reason text,
  add column proposed_release_id text,
  add column proposed_release_date text,
  add column proposed_release_country text,
  add column proposed_selection_strategy text,
  add column decision_note text,
  add column decided_at timestamptz;

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
    release_group_id, qualification, reason, musicbrainz_artist_id, artist_name,
    release_group_title, release_group_original_date, review_reason,
    proposed_release_id, proposed_release_date, proposed_release_country,
    proposed_selection_strategy
  ) values (
    p_release_group_id, 'review', p_review_reason, p_musicbrainz_artist_id, p_artist_name,
    p_release_group_title, p_release_group_original_date, p_review_reason,
    p_proposed_release_id, p_proposed_release_date, p_proposed_release_country,
    p_proposed_selection_strategy
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
  where artist_catalogue_overrides.qualification = 'review'
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

insert into public.artist_catalogue_overrides
  (release_group_id, qualification, reason, review_reason, musicbrainz_artist_id,
   artist_name, release_group_title, release_group_original_date,
   proposed_release_id, proposed_release_date, proposed_release_country,
   proposed_selection_strategy)
values
  ('84f508a9-beae-3e97-b59e-3a8886c6e901', 'review',
   'Editorial policy review: soundtrack relationship is ambiguous',
   'Editorial policy review: soundtrack relationship is ambiguous',
   '0383dadf-2a4e-4d10-a46a-e9e041da8eb3', 'Queen', 'A Kind of Magic', '1986-06-02',
   '9297ff86-54ad-45dc-9590-dbdbac9f5455', '1986', 'GB', 'gb_original_period')
on conflict (release_group_id) do nothing;

commit;
