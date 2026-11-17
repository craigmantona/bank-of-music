begin;

-- Keep on-demand imports bounded independently of the scheduled catalogue
-- importer. This table is not exposed to browser roles; only the service role
-- used by the authenticated Edge Function can reserve a slot.
create table if not exists public.remote_album_import_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default clock_timestamp()
);

create index if not exists remote_album_import_attempts_user_time_idx
  on public.remote_album_import_attempts(user_id, attempted_at desc);

alter table public.remote_album_import_attempts enable row level security;

revoke all on table public.remote_album_import_attempts from public, anon, authenticated;
revoke all on sequence public.remote_album_import_attempts_id_seq from public, anon, authenticated;
grant select, insert, delete on table public.remote_album_import_attempts to service_role;
grant usage, select on sequence public.remote_album_import_attempts_id_seq to service_role;

create or replace function public.reserve_remote_album_import_slot(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_short_count integer;
  v_daily_count integer;
  v_oldest_short timestamptz;
  v_oldest_daily timestamptz;
  v_retry_after integer;
begin
  if p_user_id is null then
    raise exception 'Authenticated user identity required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('bom-remote-album-rate:' || p_user_id::text, 0));

  delete from public.remote_album_import_attempts attempt
  where attempt.user_id = p_user_id
    and attempt.attempted_at < v_now - interval '24 hours';

  select count(*), min(attempt.attempted_at)
    into v_short_count, v_oldest_short
  from public.remote_album_import_attempts attempt
  where attempt.user_id = p_user_id
    and attempt.attempted_at >= v_now - interval '10 minutes';

  select count(*), min(attempt.attempted_at)
    into v_daily_count, v_oldest_daily
  from public.remote_album_import_attempts attempt
  where attempt.user_id = p_user_id
    and attempt.attempted_at >= v_now - interval '24 hours';

  if v_short_count >= 5 then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_oldest_short + interval '10 minutes' - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'retry_after_seconds', v_retry_after, 'window', '10_minutes');
  end if;

  if v_daily_count >= 20 then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_oldest_daily + interval '24 hours' - v_now)))::integer);
    return jsonb_build_object('allowed', false, 'retry_after_seconds', v_retry_after, 'window', '24_hours');
  end if;

  insert into public.remote_album_import_attempts(user_id, attempted_at)
  values (p_user_id, v_now);

  return jsonb_build_object('allowed', true, 'remaining_10_minutes', 4 - v_short_count, 'remaining_24_hours', 19 - v_daily_count);
end;
$$;

revoke all on function public.reserve_remote_album_import_slot(uuid) from public, anon, authenticated;
grant execute on function public.reserve_remote_album_import_slot(uuid) to service_role;

commit;
