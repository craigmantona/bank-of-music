begin;

-- The voting pool is a server-side projection of the already approved
-- Christmas 100. No song rating or catalogue row is changed by this feature.
create table public.christmas_number_one_candidates (
  canonical_recording_id uuid primary key references public.canonical_recordings(id) on delete restrict,
  sort_order smallint not null unique check (sort_order between 1 and 100)
);

insert into public.christmas_number_one_candidates (canonical_recording_id, sort_order)
select candidate.id, row_number() over (order by candidate.title, candidate.artist, candidate.id)::smallint
from public.canonical_recordings candidate
where candidate.source_metadata ->> 'seed' = 'christmas_special_verified_import'
   or lower(candidate.musicbrainz_recording_id) = any (array[
     'a7387795-2ca2-499d-a96e-05e7d8dc28f7', 'e5a31a61-c284-4fa9-85ac-ceb613162005',
     '5b42bccf-325a-4700-b113-7ee6da3010b8', '4a58bb75-ddea-44f4-a905-4d4e1367ccda',
     '792babf5-f36b-416e-b47a-7291937c7f8b', '5642afa2-f5a6-49b1-99cc-09fa48a00321',
     '3878be92-b782-45e0-870d-9bba23728073', 'a6fab057-cf3a-4456-950e-d3edaf219326',
     '802d8d00-dd01-4a9c-9e60-65c5ce5ea2dd', '23f9b940-c7fb-4db7-b650-9c09e253bbd4'
   ]::text[]);

do $$
begin
  if (select count(*) from public.christmas_number_one_candidates) <> 100 then
    raise exception 'Christmas Number 1 requires exactly the verified Christmas 100 before migration';
  end if;
end;
$$;

create table public.christmas_number_one_years (
  year smallint primary key check (year between 2025 and 2100),
  voting_approved_at timestamptz,
  voting_approved_by uuid references public.profiles(id) on delete restrict,
  reveal_approved_at timestamptz,
  reveal_approved_by uuid references public.profiles(id) on delete restrict,
  result_snapshot jsonb,
  tie_winner_canonical_recording_id uuid references public.christmas_number_one_candidates(canonical_recording_id) on delete restrict,
  tie_resolution_note text check (tie_resolution_note is null or length(trim(tie_resolution_note)) >= 20),
  tie_resolved_at timestamptz,
  tie_resolved_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint christmas_number_one_voting_approval_complete check (
    (voting_approved_at is null and voting_approved_by is null) or
    (voting_approved_at is not null and voting_approved_by is not null)
  ),
  constraint christmas_number_one_reveal_approval_complete check (
    (reveal_approved_at is null and reveal_approved_by is null and result_snapshot is null) or
    (reveal_approved_at is not null and reveal_approved_by is not null and result_snapshot is not null)
  ),
  constraint christmas_number_one_tie_resolution_complete check (
    (tie_winner_canonical_recording_id is null and tie_resolution_note is null and tie_resolved_at is null and tie_resolved_by is null) or
    (tie_winner_canonical_recording_id is not null and tie_resolution_note is not null and tie_resolved_at is not null and tie_resolved_by is not null)
  )
);
create index christmas_number_one_years_voting_approved_by_idx
  on public.christmas_number_one_years(voting_approved_by) where voting_approved_by is not null;
create index christmas_number_one_years_reveal_approved_by_idx
  on public.christmas_number_one_years(reveal_approved_by) where reveal_approved_by is not null;
create index christmas_number_one_years_tie_winner_idx
  on public.christmas_number_one_years(tie_winner_canonical_recording_id) where tie_winner_canonical_recording_id is not null;
create index christmas_number_one_years_tie_resolved_by_idx
  on public.christmas_number_one_years(tie_resolved_by) where tie_resolved_by is not null;

create table public.christmas_number_one_votes (
  year smallint not null references public.christmas_number_one_years(year) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  canonical_recording_id uuid not null references public.christmas_number_one_candidates(canonical_recording_id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (year, user_id)
);
create index christmas_number_one_votes_result_idx
  on public.christmas_number_one_votes(year, canonical_recording_id);
create index christmas_number_one_votes_user_idx
  on public.christmas_number_one_votes(user_id);
create index christmas_number_one_votes_candidate_idx
  on public.christmas_number_one_votes(canonical_recording_id);

-- Admin preview selections are deliberately isolated from official annual votes.
create table public.christmas_number_one_preview_votes (
  year smallint not null check (year between 2025 and 2100),
  user_id uuid not null references public.profiles(id) on delete cascade,
  canonical_recording_id uuid not null references public.christmas_number_one_candidates(canonical_recording_id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (year, user_id)
);
create index christmas_number_one_preview_votes_user_idx
  on public.christmas_number_one_preview_votes(user_id);
create index christmas_number_one_preview_votes_candidate_idx
  on public.christmas_number_one_preview_votes(canonical_recording_id);

-- Preview tie decisions are also isolated. They exist only so an administrator
-- can exercise the complete tie workflow without changing an official vote,
-- annual approval, result snapshot or audit record.
create table public.christmas_number_one_preview_tie_resolutions (
  year smallint not null check (year between 2025 and 2100),
  admin_user_id uuid not null references public.profiles(id) on delete cascade,
  winner_canonical_recording_id uuid not null references public.christmas_number_one_candidates(canonical_recording_id) on delete restrict,
  resolution_note text not null check (length(trim(resolution_note)) >= 20),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (year, admin_user_id)
);
create index christmas_number_one_preview_tie_admin_idx
  on public.christmas_number_one_preview_tie_resolutions(admin_user_id);
create index christmas_number_one_preview_tie_winner_idx
  on public.christmas_number_one_preview_tie_resolutions(winner_canonical_recording_id);

create table public.christmas_number_one_admin_audit (
  id bigint generated always as identity primary key,
  year smallint not null check (year between 2025 and 2100),
  action text not null check (action in ('approve_voting', 'revoke_voting', 'resolve_tie', 'approve_reveal', 'revoke_reveal')),
  admin_user_id uuid not null references public.profiles(id) on delete restrict,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index christmas_number_one_admin_audit_admin_idx
  on public.christmas_number_one_admin_audit(admin_user_id);

alter table public.christmas_number_one_candidates enable row level security;
alter table public.christmas_number_one_years enable row level security;
alter table public.christmas_number_one_votes enable row level security;
alter table public.christmas_number_one_preview_votes enable row level security;
alter table public.christmas_number_one_preview_tie_resolutions enable row level security;
alter table public.christmas_number_one_admin_audit enable row level security;

revoke all on table public.christmas_number_one_candidates from public, anon, authenticated;
revoke all on table public.christmas_number_one_years from public, anon, authenticated;
revoke all on table public.christmas_number_one_votes from public, anon, authenticated;
revoke all on table public.christmas_number_one_preview_votes from public, anon, authenticated;
revoke all on table public.christmas_number_one_preview_tie_resolutions from public, anon, authenticated;
revoke all on table public.christmas_number_one_admin_audit from public, anon, authenticated;
revoke all on sequence public.christmas_number_one_admin_audit_id_seq from public, anon, authenticated;
grant all on table public.christmas_number_one_candidates to service_role;
grant all on table public.christmas_number_one_years to service_role;
grant all on table public.christmas_number_one_votes to service_role;
grant all on table public.christmas_number_one_preview_votes to service_role;
grant all on table public.christmas_number_one_preview_tie_resolutions to service_role;
grant all on table public.christmas_number_one_admin_audit to service_role;
grant all on sequence public.christmas_number_one_admin_audit_id_seq to service_role;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Kept behind the private schema so tests can replace the clock without ever
-- accepting a caller-supplied timestamp in a production RPC.
create or replace function private.christmas_number_one_now()
returns timestamptz language sql stable set search_path = ''
as $$ select statement_timestamp() $$;

create or replace function private.require_bom_admin()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or not exists (
    select 1 from public.profiles profile where profile.id = v_user_id and profile.is_admin is true
  ) then
    raise exception 'Christmas Number 1 administration requires administrator access' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;

create or replace function private.christmas_number_one_schedule(p_year smallint)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'opensAt', make_timestamptz(p_year, 12, 1, 0, 0, 0, 'Europe/London'),
    'closesAt', make_timestamptz(p_year, 12, 21, 0, 0, 0, 'Europe/London'),
    'lastVotingMinute', make_timestamptz(p_year, 12, 20, 23, 59, 0, 'Europe/London'),
    'revealsAt', make_timestamptz(p_year, 12, 24, 0, 0, 0, 'Europe/London'),
    'timeZone', 'Europe/London',
    'votingClosesLabel', '20 December at 23:59 UK time',
    'revealLabel', '24 December'
  )
$$;

create or replace function private.christmas_number_one_phase(p_year smallint, p_at timestamptz)
returns text language sql stable set search_path = ''
as $$
  select case
    when p_at < make_timestamptz(p_year, 12, 1, 0, 0, 0, 'Europe/London') then 'scheduled'
    when p_at < make_timestamptz(p_year, 12, 21, 0, 0, 0, 'Europe/London') then 'open'
    when p_at < make_timestamptz(p_year, 12, 24, 0, 0, 0, 'Europe/London') then 'closed'
    else 'reveal'
  end
$$;

create or replace function private.christmas_number_one_results(p_year smallint)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with counts as (
    select candidate.canonical_recording_id id, recording.title, recording.artist,
      recording.preferred_spotify_track_id spotify_id, count(vote.user_id)::integer votes
    from public.christmas_number_one_candidates candidate
    join public.canonical_recordings recording on recording.id = candidate.canonical_recording_id
    left join public.christmas_number_one_votes vote
      on vote.canonical_recording_id = candidate.canonical_recording_id and vote.year = p_year
    group by candidate.canonical_recording_id, recording.title, recording.artist, recording.preferred_spotify_track_id
  ), ranked as (
    select counts.*, row_number() over (order by votes desc, title, artist, id)::integer position,
      dense_rank() over (order by votes desc)::integer vote_rank,
      (votes > 0 and count(*) over (partition by votes) > 1) is_tied
    from counts
  ), leaders as (
    select * from ranked where votes > 0 and votes = (select max(votes) from ranked)
  ), resolution as (
    select annual.tie_winner_canonical_recording_id id from public.christmas_number_one_years annual where annual.year = p_year
  ), selected_winner as (
    select leader.*, ((select count(*) from leaders) > 1) tie_resolved
    from leaders leader
    where (select count(*) from leaders) = 1
       or leader.id = (select id from resolution)
    order by leader.title, leader.artist, leader.id limit 1
  )
  select jsonb_build_object(
    'year', p_year,
    'turnout', (select count(*) from public.christmas_number_one_votes where year = p_year),
    'ranking', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'title', title, 'artist', artist, 'spotifyId', spotify_id,
      'votes', votes, 'position', position, 'voteRank', vote_rank, 'isTied', is_tied
    ) order by position) from ranked where position <= 10), '[]'::jsonb),
    'leaderTie', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'title', title, 'artist', artist, 'votes', votes
    ) order by title, artist, id) from leaders where (select count(*) from leaders) > 1), '[]'::jsonb),
    'winner', (select jsonb_build_object(
      'id', id, 'title', title, 'artist', artist, 'spotifyId', spotify_id,
      'votes', votes, 'tieResolved', tie_resolved
    ) from selected_winner),
    'publicationBlocked', (select count(*) from leaders) > 1 and not exists (select 1 from selected_winner)
  )
$$;

create or replace function public.cast_bom_christmas_number_one_vote(
  p_year smallint,
  p_canonical_recording_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := private.christmas_number_one_now();
  v_previous uuid;
begin
  if v_user_id is null or not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'Sign in with a Bank of Music account to vote' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.christmas_number_one_years annual
    where annual.year = p_year and annual.voting_approved_at is not null
  ) then
    raise exception 'Christmas Number 1 voting has not been approved for this year' using errcode = '42501';
  end if;
  if v_now < make_timestamptz(p_year, 12, 1, 0, 0, 0, 'Europe/London')
     or v_now >= make_timestamptz(p_year, 12, 21, 0, 0, 0, 'Europe/London') then
    raise exception 'Voting is open from 1 December at 00:00 until 20 December at 23:59 UK time' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.christmas_number_one_candidates where canonical_recording_id = p_canonical_recording_id
  ) then
    raise exception 'Choose a song from the curated Christmas 100' using errcode = '22023';
  end if;

  select canonical_recording_id into v_previous from public.christmas_number_one_votes
  where year = p_year and user_id = v_user_id;
  insert into public.christmas_number_one_votes(year, user_id, canonical_recording_id)
  values (p_year, v_user_id, p_canonical_recording_id)
  on conflict (year, user_id) do update set
    canonical_recording_id = excluded.canonical_recording_id,
    updated_at = v_now;

  return jsonb_build_object(
    'ok', true, 'year', p_year, 'candidateId', p_canonical_recording_id,
    'changed', v_previous is not null and v_previous is distinct from p_canonical_recording_id,
    'savedAt', v_now
  );
end;
$$;

create or replace function public.get_bom_christmas_number_one_state(p_year smallint default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_now timestamptz := private.christmas_number_one_now();
  v_year smallint := coalesce(p_year, extract(year from v_now at time zone 'Europe/London')::smallint);
  v_user_id uuid := (select auth.uid());
  v_annual public.christmas_number_one_years%rowtype;
  v_phase text;
  v_candidates jsonb := '[]'::jsonb;
  v_selection uuid;
  v_results jsonb;
begin
  if v_year < 2025 or v_year > 2100 then raise exception 'Unsupported voting year' using errcode = '22023'; end if;
  select * into v_annual from public.christmas_number_one_years where year = v_year;
  v_phase := private.christmas_number_one_phase(v_year, v_now);

  if v_annual.voting_approved_at is not null and (v_user_id is not null or v_annual.reveal_approved_at is not null) then
    select jsonb_agg(jsonb_build_object(
      'id', candidate.canonical_recording_id, 'title', recording.title, 'artist', recording.artist,
      'spotifyId', recording.preferred_spotify_track_id, 'sortOrder', candidate.sort_order
    ) order by candidate.sort_order) into v_candidates
    from public.christmas_number_one_candidates candidate
    join public.canonical_recordings recording on recording.id = candidate.canonical_recording_id;
  end if;
  if v_user_id is not null then
    select canonical_recording_id into v_selection from public.christmas_number_one_votes where year = v_year and user_id = v_user_id;
  end if;
  if v_annual.reveal_approved_at is not null
     and v_now >= make_timestamptz(v_year, 12, 24, 0, 0, 0, 'Europe/London') then
    v_results := v_annual.result_snapshot;
    v_phase := 'revealed';
  elsif v_phase = 'reveal' then
    v_phase := 'awaiting_reveal_approval';
  elsif v_annual.voting_approved_at is null then
    v_phase := 'disabled';
  end if;

  return jsonb_build_object(
    'year', v_year, 'phase', v_phase, 'schedule', private.christmas_number_one_schedule(v_year),
    'votingApproved', v_annual.voting_approved_at is not null,
    'revealApproved', v_annual.reveal_approved_at is not null,
    'eligible', v_user_id is not null and v_annual.voting_approved_at is not null,
    'selectedCandidateId', v_selection, 'candidates', coalesce(v_candidates, '[]'::jsonb), 'results', v_results
  );
end;
$$;

create or replace function public.get_bom_christmas_number_one_archive()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_now timestamptz := private.christmas_number_one_now();
  v_row record;
  v_results jsonb;
  v_archive jsonb := '[]'::jsonb;
begin
  for v_row in
    select year, result_snapshot from public.christmas_number_one_years
    where reveal_approved_at is not null
      and v_now >= make_timestamptz(year, 12, 24, 0, 0, 0, 'Europe/London')
    order by year desc
  loop
    v_results := v_row.result_snapshot;
    if v_results -> 'winner' is not null and v_results -> 'winner' <> 'null'::jsonb then
      v_archive := v_archive || jsonb_build_array((v_results -> 'winner') || jsonb_build_object('year', v_row.year));
    end if;
  end loop;
  return v_archive;
end;
$$;

create or replace function public.cast_bom_admin_christmas_number_one_preview_vote(
  p_year smallint,
  p_canonical_recording_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_admin_id uuid := private.require_bom_admin();
  v_now timestamptz := private.christmas_number_one_now();
begin
  if p_year < 2025 or p_year > 2100 then raise exception 'Unsupported preview year' using errcode = '22023'; end if;
  if not exists (select 1 from public.christmas_number_one_candidates where canonical_recording_id = p_canonical_recording_id) then
    raise exception 'Choose a song from the curated Christmas 100' using errcode = '22023';
  end if;
  insert into public.christmas_number_one_preview_votes(year, user_id, canonical_recording_id)
  values (p_year, v_admin_id, p_canonical_recording_id)
  on conflict (year, user_id) do update set canonical_recording_id = excluded.canonical_recording_id, updated_at = v_now;
  return jsonb_build_object('ok', true, 'preview', true, 'officialVotesAffected', false, 'year', p_year, 'candidateId', p_canonical_recording_id);
end;
$$;

create or replace function public.get_bom_admin_christmas_number_one_preview(p_year smallint)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_admin_id uuid := private.require_bom_admin();
  v_selection uuid;
  v_candidates jsonb;
begin
  if p_year < 2025 or p_year > 2100 then raise exception 'Unsupported preview year' using errcode = '22023'; end if;
  select canonical_recording_id into v_selection from public.christmas_number_one_preview_votes
  where year = p_year and user_id = v_admin_id;
  select jsonb_agg(jsonb_build_object(
    'id', candidate.canonical_recording_id, 'title', recording.title, 'artist', recording.artist,
    'spotifyId', recording.preferred_spotify_track_id, 'sortOrder', candidate.sort_order
  ) order by candidate.sort_order) into v_candidates
  from public.christmas_number_one_candidates candidate
  join public.canonical_recordings recording on recording.id = candidate.canonical_recording_id;
  return jsonb_build_object(
    'preview', true, 'officialVotesAffected', false, 'year', p_year,
    'schedule', private.christmas_number_one_schedule(p_year),
    'selectedCandidateId', v_selection, 'candidates', coalesce(v_candidates, '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_bom_admin_christmas_number_one_results(
  p_year smallint,
  p_preview boolean default true,
  p_scenario text default 'leader'
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_admin_id uuid := private.require_bom_admin();
  v_results jsonb;
  v_archive jsonb := '[]'::jsonb;
begin
  if p_year < 2025 or p_year > 2100 then raise exception 'Unsupported results year' using errcode = '22023'; end if;
  if p_scenario not in ('leader', 'tie') then raise exception 'Unsupported preview results scenario' using errcode = '22023'; end if;
  if not p_preview then
    return private.christmas_number_one_results(p_year) || jsonb_build_object('preview', false);
  end if;

  with ordered as (
    select candidate.canonical_recording_id id, recording.title, recording.artist,
      recording.preferred_spotify_track_id spotify_id,
      row_number() over (order by recording.title, recording.artist, candidate.canonical_recording_id)::integer sequence
    from public.christmas_number_one_candidates candidate
    join public.canonical_recordings recording on recording.id = candidate.canonical_recording_id
  ), counts as (
    select ordered.*, case
      when sequence = 1 then 64
      when sequence = 2 then case when p_scenario = 'tie' then 64 else 58 end
      when sequence <= 10 then 60 - sequence * 2
      else abs(hashtext(id::text)) % 35
    end::integer votes from ordered
  ), ranked as (
    select counts.*, row_number() over (order by votes desc, title, artist, id)::integer position,
      dense_rank() over (order by votes desc)::integer vote_rank,
      (count(*) over (partition by votes) > 1) is_tied
    from counts
  ), leaders as (
    select * from ranked where votes = (select max(votes) from ranked)
  ), resolution as (
    select winner_canonical_recording_id id, resolution_note note, updated_at
    from public.christmas_number_one_preview_tie_resolutions
    where year = p_year and admin_user_id = v_admin_id
  ), winner as (
    select leader.* from leaders leader
    where p_scenario = 'leader'
       or (p_scenario = 'tie' and leader.id = (select id from resolution))
    order by title, artist, id limit 1
  )
  select jsonb_build_object(
    'preview', true, 'officialVotesAffected', false, 'scenario', p_scenario, 'year', p_year,
    'turnout', 347 + (select count(*) from public.christmas_number_one_preview_votes where year = p_year),
    'ranking', (select jsonb_agg(jsonb_build_object(
      'id', id, 'title', title, 'artist', artist, 'spotifyId', spotify_id,
      'votes', votes, 'position', position, 'voteRank', vote_rank, 'isTied', is_tied
    ) order by position) from ranked where position <= 10),
    'leaderTie', case when p_scenario = 'tie' then (select jsonb_agg(jsonb_build_object(
      'id', id, 'title', title, 'artist', artist, 'votes', votes
    ) order by title, artist, id) from leaders) else '[]'::jsonb end,
    'winner', (select jsonb_build_object(
      'id', id, 'title', title, 'artist', artist, 'spotifyId', spotify_id,
      'votes', votes, 'tieResolved', p_scenario = 'tie'
    ) from winner),
    'tieResolution', case when p_scenario = 'tie' and exists (select 1 from winner)
      then (select jsonb_build_object('winnerCandidateId', id, 'note', note, 'resolvedAt', updated_at) from resolution)
      else null end,
    'publicationBlocked', p_scenario = 'tie' and not exists (select 1 from winner),
    'archive', v_archive
  ) into v_results;
  return v_results;
end;
$$;

create or replace function public.resolve_bom_admin_christmas_number_one_preview_tie(
  p_year smallint,
  p_winner_canonical_recording_id uuid,
  p_note text
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_admin_id uuid := private.require_bom_admin();
  v_now timestamptz := private.christmas_number_one_now();
  v_leader_ids uuid[];
begin
  if p_year < 2025 or p_year > 2100 then raise exception 'Unsupported preview year' using errcode = '22023'; end if;
  if length(trim(coalesce(p_note, ''))) < 20 then
    raise exception 'Document the preview tie-resolution reason in at least 20 characters' using errcode = '22023';
  end if;

  with ordered as (
    select candidate.canonical_recording_id id,
      row_number() over (order by recording.title, recording.artist, candidate.canonical_recording_id)::integer sequence
    from public.christmas_number_one_candidates candidate
    join public.canonical_recordings recording on recording.id = candidate.canonical_recording_id
  ), counts as (
    select ordered.id, case when sequence in (1, 2) then 64 when sequence <= 10 then 60 - sequence * 2
      else abs(hashtext(id::text)) % 35 end::integer votes
    from ordered
  )
  select array_agg(id order by id) into v_leader_ids
  from counts where votes = (select max(votes) from counts);

  if coalesce(array_length(v_leader_ids, 1), 0) < 2
     or not (p_winner_canonical_recording_id = any(v_leader_ids)) then
    raise exception 'Choose one of the simulated tied first-place songs' using errcode = '22023';
  end if;

  insert into public.christmas_number_one_preview_tie_resolutions(
    year, admin_user_id, winner_canonical_recording_id, resolution_note, created_at, updated_at
  ) values (
    p_year, v_admin_id, p_winner_canonical_recording_id, trim(p_note), v_now, v_now
  ) on conflict (year, admin_user_id) do update set
    winner_canonical_recording_id = excluded.winner_canonical_recording_id,
    resolution_note = excluded.resolution_note,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true, 'preview', true, 'officialVotesAffected', false,
    'officialApprovalsAffected', false, 'year', p_year,
    'winnerCandidateId', p_winner_canonical_recording_id, 'recordedAt', v_now
  );
end;
$$;

create or replace function public.admin_set_bom_christmas_number_one_year(
  p_year smallint,
  p_action text,
  p_winner_canonical_recording_id uuid default null,
  p_note text default null
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_admin_id uuid := private.require_bom_admin();
  v_now timestamptz := private.christmas_number_one_now();
  v_results jsonb;
  v_leader_ids uuid[];
begin
  if p_year < 2025 or p_year > 2100 then raise exception 'Unsupported administration year' using errcode = '22023'; end if;
  if p_action not in ('approve_voting', 'revoke_voting', 'resolve_tie', 'approve_reveal', 'revoke_reveal') then
    raise exception 'Unsupported Christmas Number 1 action' using errcode = '22023';
  end if;
  insert into public.christmas_number_one_years(year) values (p_year) on conflict (year) do nothing;

  if p_action = 'approve_voting' then
    update public.christmas_number_one_years set voting_approved_at = v_now, voting_approved_by = v_admin_id, updated_at = v_now where year = p_year;
  elsif p_action = 'revoke_voting' then
    if exists (select 1 from public.christmas_number_one_votes where year = p_year) then
      raise exception 'Voting approval cannot be revoked after official votes exist' using errcode = '23514';
    end if;
    update public.christmas_number_one_years set voting_approved_at = null, voting_approved_by = null, updated_at = v_now where year = p_year;
  elsif p_action = 'resolve_tie' then
    if v_now >= make_timestamptz(p_year, 12, 24, 0, 0, 0, 'Europe/London')
       and exists (select 1 from public.christmas_number_one_years where year = p_year and reveal_approved_at is not null) then
      raise exception 'A published Christmas Number 1 archive is permanent' using errcode = '23514';
    end if;
    if v_now < make_timestamptz(p_year, 12, 21, 0, 0, 0, 'Europe/London') then
      raise exception 'A tie can be resolved only after voting closes on 20 December at 23:59 UK time' using errcode = '22023';
    end if;
    if length(trim(coalesce(p_note, ''))) < 20 then
      raise exception 'Document the tie-resolution reason in at least 20 characters' using errcode = '22023';
    end if;
    with counts as (
      select canonical_recording_id, count(*) votes from public.christmas_number_one_votes where year = p_year group by canonical_recording_id
    ) select array_agg(canonical_recording_id order by canonical_recording_id) into v_leader_ids
      from counts where votes = (select max(votes) from counts);
    if coalesce(array_length(v_leader_ids, 1), 0) < 2 or not (p_winner_canonical_recording_id = any(v_leader_ids)) then
      raise exception 'The documented winner must be one of the tied first-place songs' using errcode = '22023';
    end if;
    update public.christmas_number_one_years set
      tie_winner_canonical_recording_id = p_winner_canonical_recording_id,
      tie_resolution_note = trim(p_note), tie_resolved_at = v_now, tie_resolved_by = v_admin_id,
      reveal_approved_at = null, reveal_approved_by = null, result_snapshot = null, updated_at = v_now
    where year = p_year;
  elsif p_action = 'approve_reveal' then
    if v_now >= make_timestamptz(p_year, 12, 24, 0, 0, 0, 'Europe/London')
       and exists (select 1 from public.christmas_number_one_years where year = p_year and reveal_approved_at is not null) then
      raise exception 'A published Christmas Number 1 archive is permanent' using errcode = '23514';
    end if;
    if v_now < make_timestamptz(p_year, 12, 21, 0, 0, 0, 'Europe/London') then
      raise exception 'Reveal approval is available only after voting closes' using errcode = '22023';
    end if;
    v_results := private.christmas_number_one_results(p_year);
    if coalesce((v_results ->> 'turnout')::integer, 0) = 0 then raise exception 'A year with no votes cannot be revealed' using errcode = '22023'; end if;
    if coalesce((v_results ->> 'publicationBlocked')::boolean, false) then
      raise exception 'Resolve and document the first-place tie before approving the reveal' using errcode = '22023';
    end if;
    update public.christmas_number_one_years set
      reveal_approved_at = v_now, reveal_approved_by = v_admin_id, result_snapshot = v_results, updated_at = v_now
    where year = p_year;
  elsif p_action = 'revoke_reveal' then
    if v_now >= make_timestamptz(p_year, 12, 24, 0, 0, 0, 'Europe/London')
       and exists (select 1 from public.christmas_number_one_years where year = p_year and reveal_approved_at is not null) then
      raise exception 'A published Christmas Number 1 archive is permanent' using errcode = '23514';
    end if;
    update public.christmas_number_one_years set reveal_approved_at = null, reveal_approved_by = null, result_snapshot = null, updated_at = v_now where year = p_year;
  end if;

  insert into public.christmas_number_one_admin_audit(year, action, admin_user_id, details)
  values (p_year, p_action, v_admin_id, jsonb_strip_nulls(jsonb_build_object(
    'winnerCandidateId', p_winner_canonical_recording_id, 'note', nullif(trim(coalesce(p_note, '')), '')
  )));
  return jsonb_build_object('ok', true, 'year', p_year, 'action', p_action, 'recordedAt', v_now);
end;
$$;

-- Official public functions exist behind a hard permission gate. The separate
-- future-launch operation grants them only after explicit release approval.
revoke all on function public.cast_bom_christmas_number_one_vote(smallint, uuid) from public, anon, authenticated;
revoke all on function public.get_bom_christmas_number_one_state(smallint) from public, anon, authenticated;
revoke all on function public.get_bom_christmas_number_one_archive() from public, anon, authenticated;

-- These are the only browser-callable functions in the default-off migration;
-- every one verifies profiles.is_admin inside a SECURITY DEFINER boundary.
revoke all on function public.cast_bom_admin_christmas_number_one_preview_vote(smallint, uuid) from public, anon;
revoke all on function public.get_bom_admin_christmas_number_one_preview(smallint) from public, anon;
revoke all on function public.get_bom_admin_christmas_number_one_results(smallint, boolean, text) from public, anon;
revoke all on function public.resolve_bom_admin_christmas_number_one_preview_tie(smallint, uuid, text) from public, anon;
revoke all on function public.admin_set_bom_christmas_number_one_year(smallint, text, uuid, text) from public, anon;
grant execute on function public.cast_bom_admin_christmas_number_one_preview_vote(smallint, uuid) to authenticated;
grant execute on function public.get_bom_admin_christmas_number_one_preview(smallint) to authenticated;
grant execute on function public.get_bom_admin_christmas_number_one_results(smallint, boolean, text) to authenticated;
grant execute on function public.resolve_bom_admin_christmas_number_one_preview_tie(smallint, uuid, text) to authenticated;
grant execute on function public.admin_set_bom_christmas_number_one_year(smallint, text, uuid, text) to authenticated;

commit;
