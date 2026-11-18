begin;

-- On-demand imports have very different costs from rating an album that is
-- already present. Keep the import coordinator private to the service-role
-- Edge Function and account for completed outcomes, not merely button taps.
alter table public.remote_album_import_attempts
  add column if not exists release_id uuid,
  add column if not exists release_group_id uuid,
  add column if not exists lease_token uuid,
  add column if not exists outcome text,
  add column if not exists completed_at timestamptz;

update public.remote_album_import_attempts
set outcome = 'legacy'
where outcome is null;

alter table public.remote_album_import_attempts
  alter column outcome set default 'legacy',
  alter column outcome set not null;

alter table public.remote_album_import_attempts
  drop constraint if exists remote_album_import_attempts_outcome_check;

alter table public.remote_album_import_attempts
  add constraint remote_album_import_attempts_outcome_check check (outcome in (
    'legacy', 'started', 'succeeded', 'already_exists',
    'transient_failure', 'invalid_failure'
  ));

create unique index if not exists remote_album_import_attempts_lease_token_idx
  on public.remote_album_import_attempts(lease_token)
  where lease_token is not null;

create index if not exists remote_album_import_attempts_outcome_time_idx
  on public.remote_album_import_attempts(outcome, attempted_at desc);

create table if not exists public.remote_album_import_leases (
  release_id uuid primary key,
  release_group_id uuid,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id bigint not null references public.remote_album_import_attempts(id) on delete cascade,
  lease_token uuid not null unique,
  acquired_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  constraint remote_album_import_lease_expiry check (expires_at > acquired_at)
);

create index if not exists remote_album_import_leases_user_idx
  on public.remote_album_import_leases(user_id, expires_at);

alter table public.remote_album_import_leases enable row level security;

revoke all on table public.remote_album_import_leases from public, anon, authenticated;
revoke all on table public.remote_album_import_attempts from public, anon, authenticated;
revoke all on sequence public.remote_album_import_attempts_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.remote_album_import_leases to service_role;
grant select, insert, update, delete on table public.remote_album_import_attempts to service_role;
grant usage, select on sequence public.remote_album_import_attempts_id_seq to service_role;

create or replace function public.reserve_remote_album_import_slot(
  p_user_id uuid,
  p_release_id uuid,
  p_release_group_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lease_token uuid := gen_random_uuid();
  v_attempt_id bigint;
  v_existing_lease public.remote_album_import_leases%rowtype;
  v_oldest timestamptz;
  v_count integer;
  v_retry_after integer;
begin
  if p_user_id is null or p_release_id is null then
    raise exception 'Authenticated user and exact release identities are required' using errcode = '22023';
  end if;

  -- A user lock makes all budget checks and reservations atomic. The release
  -- lock coalesces the same exact MusicBrainz release across users/processes.
  perform pg_advisory_xact_lock(hashtextextended('bom-remote-album-user:' || p_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('bom-remote-album-release:' || p_release_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('bom-remote-album-global-capacity', 0));

  -- A crashed Edge invocation must not hold capacity forever. Treat expiry as
  -- a transient failure, which is deliberately separate from success quota.
  update public.remote_album_import_attempts attempt
  set outcome = 'transient_failure', completed_at = v_now
  from public.remote_album_import_leases lease
  where lease.expires_at <= v_now
    and attempt.id = lease.attempt_id
    and attempt.outcome = 'started';

  delete from public.remote_album_import_leases lease
  where lease.expires_at <= v_now;

  select * into v_existing_lease
  from public.remote_album_import_leases lease
  where lease.release_id = p_release_id;

  if found then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_existing_lease.expires_at - v_now)))::integer);
    return jsonb_build_object(
      'allowed', false,
      'reason', 'release_in_progress',
      'retry_after_seconds', least(v_retry_after, 10),
      'coalesced', true
    );
  end if;

  select count(*), min(lease.acquired_at)
    into v_count, v_oldest
  from public.remote_album_import_leases lease
  where lease.user_id = p_user_id;

  if v_count >= 1 then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'user_import_in_progress',
      'retry_after_seconds', 5,
      'coalesced', false
    );
  end if;

  select count(*) into v_count
  from public.remote_album_import_leases;

  if v_count >= 4 then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'global_capacity',
      'retry_after_seconds', 5,
      'coalesced', false
    );
  end if;

  -- Fifty completed imports is roughly five times the observed busiest-user
  -- day. Existing-album opens and ratings never enter this function.
  select count(*), min(attempt.attempted_at)
    into v_count, v_oldest
  from public.remote_album_import_attempts attempt
  where attempt.user_id = p_user_id
    and attempt.outcome = 'succeeded'
    and attempt.attempted_at >= v_now - interval '24 hours';

  if v_count >= 50 then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_oldest + interval '24 hours' - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'reason', 'success_budget',
      'retry_after_seconds', v_retry_after, 'window', '24_hours');
  end if;

  -- A global completed-import ceiling protects Free Plan database growth even
  -- if many accounts simultaneously exhaust their generous individual quota.
  select count(*), min(attempt.attempted_at)
    into v_count, v_oldest
  from public.remote_album_import_attempts attempt
  where attempt.outcome in ('started', 'succeeded')
    and attempt.attempted_at >= v_now - interval '24 hours';

  if v_count >= 100 then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_oldest + interval '24 hours' - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'reason', 'global_success_budget',
      'retry_after_seconds', v_retry_after, 'window', '24_hours');
  end if;

  -- This is an automation/abuse ceiling, not the primary capacity control.
  -- Twenty distinct starts per ten minutes is over three times the observed
  -- normal cadence; active leases and the shared MusicBrainz slot do the real
  -- resource protection.
  select count(*), min(attempt.attempted_at)
    into v_count, v_oldest
  from public.remote_album_import_attempts attempt
  where attempt.user_id = p_user_id
    and attempt.outcome <> 'legacy'
    and attempt.attempted_at >= v_now - interval '10 minutes';

  if v_count >= 20 then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_oldest + interval '10 minutes' - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'reason', 'start_budget',
      'retry_after_seconds', v_retry_after, 'window', '10_minutes');
  end if;

  -- Transient upstream failures do not consume success quota. Their own
  -- bounded retry budget prevents an outage from becoming a retry storm.
  select count(*), min(attempt.attempted_at)
    into v_count, v_oldest
  from public.remote_album_import_attempts attempt
  where attempt.user_id = p_user_id
    and attempt.outcome = 'transient_failure'
    and attempt.attempted_at >= v_now - interval '15 minutes';

  if v_count >= 8 then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_oldest + interval '15 minutes' - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'reason', 'failure_budget',
      'retry_after_seconds', v_retry_after, 'window', '15_minutes');
  end if;

  -- Invalid identities/lists are non-retryable. A separate hourly allowance
  -- tolerates upstream data corrections without rewarding scripted abuse.
  select count(*), min(attempt.attempted_at)
    into v_count, v_oldest
  from public.remote_album_import_attempts attempt
  where attempt.user_id = p_user_id
    and attempt.outcome = 'invalid_failure'
    and attempt.attempted_at >= v_now - interval '1 hour';

  if v_count >= 10 then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'reason', 'invalid_budget',
      'retry_after_seconds', v_retry_after, 'window', '1_hour');
  end if;

  insert into public.remote_album_import_attempts(
    user_id, release_id, release_group_id, lease_token, outcome, attempted_at
  ) values (
    p_user_id, p_release_id, p_release_group_id, v_lease_token, 'started', v_now
  ) returning id into v_attempt_id;

  insert into public.remote_album_import_leases(
    release_id, release_group_id, user_id, attempt_id, lease_token, acquired_at, expires_at
  ) values (
    p_release_id, p_release_group_id, p_user_id, v_attempt_id, v_lease_token,
    v_now, v_now + interval '2 minutes'
  );

  return jsonb_build_object(
    'allowed', true,
    'lease_token', v_lease_token,
    'remaining_successes_24_hours', 49 - (
      select count(*) from public.remote_album_import_attempts attempt
      where attempt.user_id = p_user_id and attempt.outcome = 'succeeded'
        and attempt.attempted_at >= v_now - interval '24 hours'
    )
  );
end;
$$;

create or replace function public.complete_remote_album_import_slot(
  p_user_id uuid,
  p_lease_token uuid,
  p_outcome text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt_id bigint;
begin
  if p_user_id is null or p_lease_token is null or p_outcome not in (
    'succeeded', 'already_exists', 'transient_failure', 'invalid_failure'
  ) then
    raise exception 'Valid import completion is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('bom-remote-album-user:' || p_user_id::text, 0));

  update public.remote_album_import_attempts attempt
  set outcome = p_outcome, completed_at = clock_timestamp()
  where attempt.user_id = p_user_id
    and attempt.lease_token = p_lease_token
    and attempt.outcome = 'started'
  returning attempt.id into v_attempt_id;

  delete from public.remote_album_import_leases lease
  where lease.user_id = p_user_id
    and lease.lease_token = p_lease_token;

  return jsonb_build_object(
    'completed', v_attempt_id is not null,
    'outcome', p_outcome
  );
end;
$$;

revoke all on function public.reserve_remote_album_import_slot(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_remote_album_import_slot(uuid, uuid, uuid) to service_role;
revoke all on function public.complete_remote_album_import_slot(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_remote_album_import_slot(uuid, uuid, text) to service_role;

commit;
