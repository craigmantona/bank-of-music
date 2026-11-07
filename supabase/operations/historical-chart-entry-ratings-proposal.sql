-- REVIEW PROPOSAL ONLY. Do not apply without separate production approval.
-- Provisional ratings belong to an immutable UK No.1 chart entry, never to a
-- guessed song occurrence or canonical recording.

begin;

create table public.historical_chart_entry_ratings (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  chart_entry_id bigint not null references public.quick_rate_collection_tracks(id) on delete restrict,
  rating smallint not null check (rating between 0 and 10),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint historical_chart_entry_ratings_user_entry_key unique (user_id, chart_entry_id)
);

create index historical_chart_entry_ratings_entry_idx
  on public.historical_chart_entry_ratings (chart_entry_id);

alter table public.historical_chart_entry_ratings enable row level security;

-- Raw rows contain user identifiers. They are intentionally unavailable over
-- the Data API; the two narrowly scoped RPCs below are the only client access.
revoke all on table public.historical_chart_entry_ratings from anon, authenticated;
revoke all on sequence public.historical_chart_entry_ratings_id_seq from anon, authenticated;

create or replace function public.set_historical_chart_entry_rating(
  p_chart_entry_id bigint,
  p_rating smallint
)
returns table (chart_entry_id bigint, rating smallint, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.historical_chart_entry_ratings%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_rating is not null and (p_rating < 0 or p_rating > 10) then
    raise exception 'Rating must be between 0 and 10' using errcode = '22003';
  end if;

  -- This row lock serialises rating writes with a future guarded identity-link
  -- transaction. Only genuinely unresolved UK No.1 entries are writable.
  perform 1
  from public.quick_rate_collection_tracks q
  where q.id = p_chart_entry_id
    and q.collection_key = 'uk-number-ones'
    and q.song_id is null
    and q.canonical_song_id is null
  for update;
  if not found then
    raise exception 'Historical entry is not an unresolved UK No.1' using errcode = 'P0002';
  end if;

  if p_rating is null then
    delete from public.historical_chart_entry_ratings r
    where r.user_id = v_user_id and r.chart_entry_id = p_chart_entry_id
    returning r.* into v_row;
  else
    insert into public.historical_chart_entry_ratings as r
      (user_id, chart_entry_id, rating)
    values (v_user_id, p_chart_entry_id, p_rating)
    on conflict (user_id, chart_entry_id) do update
      set rating = excluded.rating,
          updated_at = timezone('utc', now())
    returning r.* into v_row;
  end if;

  return query select p_chart_entry_id, v_row.rating, v_row.updated_at;
end;
$$;

revoke all on function public.set_historical_chart_entry_rating(bigint, smallint) from public, anon;
grant execute on function public.set_historical_chart_entry_rating(bigint, smallint) to authenticated;

create or replace function public.get_historical_chart_entry_rating_summaries(
  p_chart_entry_ids bigint[]
)
returns table (
  chart_entry_id bigint,
  community_average numeric,
  community_rating_count bigint,
  personal_rating smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(array_length(p_chart_entry_ids, 1), 0) > 250 then
    raise exception 'At most 250 chart entries may be requested' using errcode = '54000';
  end if;

  return query
  select
    q.id,
    round(avg(r.rating)::numeric, 1),
    count(r.id),
    max(r.rating) filter (where r.user_id = auth.uid())
  from public.quick_rate_collection_tracks q
  left join public.historical_chart_entry_ratings r on r.chart_entry_id = q.id
  where q.id = any(coalesce(p_chart_entry_ids, array[]::bigint[]))
    and q.collection_key = 'uk-number-ones'
    and q.song_id is null
    and q.canonical_song_id is null
  group by q.id;
end;
$$;

revoke all on function public.get_historical_chart_entry_rating_summaries(bigint[]) from public;
grant execute on function public.get_historical_chart_entry_rating_summaries(bigint[]) to anon, authenticated;

comment on table public.historical_chart_entry_ratings is
  'Provisional user ratings for unresolved UK No.1 chart entries. Never a canonical recording identity.';

-- Before this proposal is approved, validation should run in a disposable
-- Supabase branch and the production migration should use the same statements
-- without this review-only rollback.
rollback;

-- Future reconciliation is deliberately not automated here. A guarded admin
-- operation must first lock every chart entry resolving to the canonical ID,
-- then classify each user as: identical values (copy once if no canonical
-- rating), canonical already equal (audit only), or conflicting values
-- (manual review). It must never overwrite an existing canonical rating, and
-- provisional rows remain as rollback/audit evidence until separately approved.
