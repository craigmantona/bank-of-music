create table public.bom_daily_challenge_questions (
  challenge_date date not null,
  mode text not null check (mode in ('songs', 'albums')),
  position smallint not null check (position between 1 and 10),
  left_item_id bigint not null,
  left_title text not null,
  left_artist text not null,
  left_artwork_url text not null,
  left_average_rating numeric not null,
  left_rating_count bigint not null check (left_rating_count >= 3),
  right_item_id bigint not null,
  right_title text not null,
  right_artist text not null,
  right_artwork_url text not null,
  right_average_rating numeric not null,
  right_rating_count bigint not null check (right_rating_count >= 3),
  created_at timestamptz not null default now(),
  primary key (challenge_date, mode, position),
  check (left_item_id <> right_item_id),
  check (abs(left_average_rating - right_average_rating) >= 0.2)
);

create table public.bom_daily_challenge_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_date date not null,
  mode text not null check (mode in ('songs', 'albums')),
  correct_answers smallint not null check (correct_answers between 0 and 10),
  answered_count smallint not null check (answered_count between 0 and 10),
  accuracy_points smallint not null default 0 check (accuracy_points between 0 and 900),
  speed_bonus smallint not null default 0 check (speed_bonus between 0 and 100),
  total_score smallint not null default 0 check (total_score between 0 and 1000),
  elapsed_seconds integer check (elapsed_seconds between 0 and 86400),
  scoring_version smallint not null default 2,
  answers jsonb not null,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key (user_id, challenge_date, mode)
);

-- Private leaderboard foundation only. No public view or identity-bearing read API
-- is created. Future approved rankings sort score, accuracy, then verified time.
create index bom_daily_challenge_result_order
  on public.bom_daily_challenge_attempts
  (challenge_date, mode, total_score desc, correct_answers desc, elapsed_seconds asc)
  where completed_at is not null;

alter table public.bom_daily_challenge_questions enable row level security;
alter table public.bom_daily_challenge_attempts enable row level security;
revoke all on public.bom_daily_challenge_questions from public, anon, authenticated;
revoke all on public.bom_daily_challenge_attempts from public, anon, authenticated;

create or replace function public.get_bom_daily_challenge(p_mode text)
returns table (
  challenge_date date, "position" smallint,
  left_item_id bigint, left_title text, left_artist text, left_artwork_url text,
  left_average_rating numeric, left_rating_count bigint,
  right_item_id bigint, right_title text, right_artist text, right_artwork_url text,
  right_average_rating numeric, right_rating_count bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  london_date date := (now() at time zone 'Europe/London')::date;
begin
  if p_mode not in ('songs', 'albums') then
    raise exception 'Unsupported Daily BOM mode' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('bom-daily:' || london_date::text || ':' || p_mode));

  if not exists (
    select 1 from public.bom_daily_challenge_questions q
    where q.challenge_date = london_date and q.mode = p_mode
  ) then
    with pool as materialized (
      select * from public.get_bom_higher_lower_pool(p_mode, 3, 100, london_date::text || ':' || p_mode)
    ), candidates as (
      select
        row_number() over (order by md5(london_date::text || ':' || p_mode || ':' || a.item_id || ':' || b.item_id)) as position,
        a.item_id as left_item_id, a.title as left_title, a.artist as left_artist,
        a.artwork_url as left_artwork_url, a.average_rating as left_average_rating, a.rating_count as left_rating_count,
        b.item_id as right_item_id, b.title as right_title, b.artist as right_artist,
        b.artwork_url as right_artwork_url, b.average_rating as right_average_rating, b.rating_count as right_rating_count
      from pool a join pool b on a.item_id < b.item_id
      where abs(a.average_rating - b.average_rating) >= 0.2
    ), selected as (
      select * from candidates order by position limit 10
    )
    insert into public.bom_daily_challenge_questions (
      challenge_date, mode, position,
      left_item_id, left_title, left_artist, left_artwork_url, left_average_rating, left_rating_count,
      right_item_id, right_title, right_artist, right_artwork_url, right_average_rating, right_rating_count
    )
    select london_date, p_mode, selected.position::smallint,
      selected.left_item_id, selected.left_title, selected.left_artist, selected.left_artwork_url, selected.left_average_rating, selected.left_rating_count,
      selected.right_item_id, selected.right_title, selected.right_artist, selected.right_artwork_url, selected.right_average_rating, selected.right_rating_count
    from selected
    where (select count(*) from selected) = 10;
  end if;

  return query select q.challenge_date, q.position,
    q.left_item_id, q.left_title, q.left_artist, q.left_artwork_url, q.left_average_rating, q.left_rating_count,
    q.right_item_id, q.right_title, q.right_artist, q.right_artwork_url, q.right_average_rating, q.right_rating_count
  from public.bom_daily_challenge_questions q
  where q.challenge_date = london_date and q.mode = p_mode
  order by q.position;
end;
$$;

create or replace function public.get_my_bom_daily_attempt(p_mode text)
returns table (challenge_date date, mode text, correct_answers smallint, answered_count smallint,
  accuracy_points smallint, speed_bonus smallint, total_score smallint, elapsed_seconds integer,
  scoring_version smallint, started_at timestamptz, completed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.challenge_date, a.mode, a.correct_answers, a.answered_count,
    a.accuracy_points, a.speed_bonus, a.total_score, a.elapsed_seconds,
    a.scoring_version, a.started_at, a.completed_at
  from public.bom_daily_challenge_attempts a
  where a.user_id = auth.uid()
    and a.challenge_date = (now() at time zone 'Europe/London')::date
    and a.mode = p_mode;
$$;

create or replace function public.start_bom_daily_attempt(p_mode text, p_challenge_date date)
returns table (challenge_date date, mode text, correct_answers smallint, answered_count smallint,
  accuracy_points smallint, speed_bonus smallint, total_score smallint, elapsed_seconds integer,
  scoring_version smallint, started_at timestamptz, completed_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  london_date date := (clock_timestamp() at time zone 'Europe/London')::date;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_mode not in ('songs', 'albums') or p_challenge_date <> london_date then
    raise exception 'Only today''s Daily BOM attempt may be started' using errcode = '22023';
  end if;
  if (select count(*) from public.bom_daily_challenge_questions q where q.challenge_date = p_challenge_date and q.mode = p_mode) <> 10 then
    raise exception 'Daily BOM challenge is not available' using errcode = 'P0002';
  end if;

  insert into public.bom_daily_challenge_attempts
    (user_id, challenge_date, mode, correct_answers, answered_count, answers, scoring_version, started_at)
  values (v_user_id, p_challenge_date, p_mode, 0, 0, '[]'::jsonb, 2, clock_timestamp())
  on conflict (user_id, challenge_date, mode) do nothing;

  return query select a.challenge_date, a.mode, a.correct_answers, a.answered_count,
    a.accuracy_points, a.speed_bonus, a.total_score, a.elapsed_seconds,
    a.scoring_version, a.started_at, a.completed_at
  from public.bom_daily_challenge_attempts a
  where a.user_id = v_user_id and a.challenge_date = p_challenge_date and a.mode = p_mode;
end;
$$;

create or replace function public.submit_bom_daily_attempt(p_mode text, p_challenge_date date, p_answers jsonb)
returns table (accepted boolean, challenge_date date, mode text, correct_answers smallint, answered_count smallint,
  accuracy_points smallint, speed_bonus smallint, total_score smallint, elapsed_seconds integer,
  scoring_version smallint, started_at timestamptz, completed_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  answer_count integer;
  v_correct smallint;
  v_elapsed integer;
  v_accuracy smallint;
  v_bonus smallint;
  v_completed timestamptz := clock_timestamp();
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_mode not in ('songs', 'albums') or jsonb_typeof(p_answers) <> 'array' then
    raise exception 'Invalid Daily BOM attempt' using errcode = '22023';
  end if;
  if (select count(*) from public.bom_daily_challenge_questions q where q.challenge_date = p_challenge_date and q.mode = p_mode) <> 10 then
    raise exception 'Daily BOM challenge is not available' using errcode = 'P0002';
  end if;

  select count(*) into answer_count
  from (select distinct (entry->>'position')::integer as position from jsonb_array_elements(p_answers) entry
        where entry->>'guess' in ('higher', 'lower') and (entry->>'position')::integer between 1 and 10) valid;
  if answer_count <> 10 or jsonb_array_length(p_answers) <> 10 then
    raise exception 'A complete set of ten unique answers is required' using errcode = '22023';
  end if;

  perform 1 from public.bom_daily_challenge_attempts a
  where a.user_id = v_user_id and a.challenge_date = p_challenge_date and a.mode = p_mode
  for update;
  if not found then raise exception 'Daily BOM attempt was not started' using errcode = 'P0002'; end if;

  if exists (select 1 from public.bom_daily_challenge_attempts a where a.user_id = v_user_id and a.challenge_date = p_challenge_date and a.mode = p_mode and a.completed_at is not null) then
    return query select false, a.challenge_date, a.mode, a.correct_answers, a.answered_count,
      a.accuracy_points, a.speed_bonus, a.total_score, a.elapsed_seconds,
      a.scoring_version, a.started_at, a.completed_at
    from public.bom_daily_challenge_attempts a
    where a.user_id = v_user_id and a.challenge_date = p_challenge_date and a.mode = p_mode;
    return;
  end if;

  select count(*) filter (where (entry->>'guess') = case when q.right_average_rating > q.left_average_rating then 'higher' else 'lower' end)::smallint
  into v_correct
  from jsonb_array_elements(p_answers) entry
  join public.bom_daily_challenge_questions q
    on q.challenge_date = p_challenge_date and q.mode = p_mode and q.position = (entry->>'position')::integer;

  select least(86400, greatest(0, floor(extract(epoch from (v_completed - a.started_at)))::integer))
  into v_elapsed from public.bom_daily_challenge_attempts a
  where a.user_id = v_user_id and a.challenge_date = p_challenge_date and a.mode = p_mode;
  v_accuracy := v_correct * 90;
  v_bonus := greatest(0, 100 - floor(v_elapsed / 3.0)::integer)::smallint;

  update public.bom_daily_challenge_attempts a set
    correct_answers = v_correct, answered_count = 10, answers = p_answers,
    accuracy_points = v_accuracy, speed_bonus = v_bonus,
    total_score = least(1000, v_accuracy + v_bonus), elapsed_seconds = v_elapsed,
    scoring_version = 2, completed_at = v_completed
  where a.user_id = v_user_id and a.challenge_date = p_challenge_date and a.mode = p_mode;

  return query select true, a.challenge_date, a.mode, a.correct_answers, a.answered_count,
    a.accuracy_points, a.speed_bonus, a.total_score, a.elapsed_seconds,
    a.scoring_version, a.started_at, a.completed_at
  from public.bom_daily_challenge_attempts a
  where a.user_id = v_user_id and a.challenge_date = p_challenge_date and a.mode = p_mode;
end;
$$;

create or replace function public.get_bom_game_readiness()
returns table (mode text, eligible_items bigint, eligible_pairs bigint, classic_ready boolean, quickfire_ready boolean, daily_ready boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with modes(mode) as (values ('songs'::text), ('albums'::text)), pools as (
    select modes.mode, pool.item_id, pool.average_rating
    from modes cross join lateral public.get_bom_higher_lower_pool(modes.mode, 3, 100, 'readiness') pool
  ), counts as (
    select p.mode, count(distinct p.item_id) as items,
      count(*) filter (where p.item_id < other.item_id and abs(p.average_rating - other.average_rating) >= 0.2) as pairs
    from pools p left join pools other on other.mode = p.mode
    group by p.mode
  )
  select modes.mode, coalesce(counts.items, 0), coalesce(counts.pairs, 0),
    coalesce(counts.pairs, 0) >= 1, coalesce(counts.pairs, 0) >= 10, coalesce(counts.pairs, 0) >= 10
  from modes left join counts using (mode);
$$;

-- Preview-only rollout: no official game or readiness RPC is callable from an
-- application role. Public launch grants live in a separate, non-deployed script.
revoke all on function public.get_bom_daily_challenge(text) from public, anon, authenticated;
revoke all on function public.get_my_bom_daily_attempt(text) from public, anon, authenticated;
revoke all on function public.start_bom_daily_attempt(text, date) from public, anon, authenticated;
revoke all on function public.submit_bom_daily_attempt(text, date, jsonb) from public, anon, authenticated;
revoke all on function public.get_bom_game_readiness() from public, anon, authenticated;

-- No public leaderboard view is created. Attempts contain only private user IDs and
-- remain inaccessible except through the current-user RPC above.
