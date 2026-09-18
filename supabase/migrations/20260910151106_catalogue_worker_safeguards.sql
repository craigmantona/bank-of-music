-- Local migration only. Drain old workers before applying/deploying (see runbook).
begin;

alter table public.artist_import_queue
  add column consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  add column next_attempt_at timestamptz;

-- No album copies: only discovery cursor and compact release-group metadata.
create table public.artist_catalogue_discovery (
  job_id bigint primary key references public.artist_import_queue(id) on delete cascade,
  revision integer not null default 0,
  state jsonb not null default '{"offset":0,"groups":[],"ready":false}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.catalogue_worker_state (
  singleton boolean primary key default true check (singleton),
  owner_token uuid,
  job_id bigint references public.artist_import_queue(id),
  expires_at timestamptz,
  heartbeat_at timestamptz,
  next_musicbrainz_at timestamptz not null default '-infinity'
);
insert into public.catalogue_worker_state(singleton) values (true);

alter table public.artist_catalogue_discovery enable row level security;
alter table public.catalogue_worker_state enable row level security;
revoke all on public.artist_catalogue_discovery, public.catalogue_worker_state from public, anon, authenticated;
grant select, insert, update, delete on public.artist_catalogue_discovery, public.catalogue_worker_state to service_role;

-- One transactional entry point keeps lease checking and every catalogue write
-- in the same transaction. Invoker security; only service_role may execute it.
create function public.catalogue_worker(
  p_action text, p_token uuid, p_job_id bigint default null, p_data jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
set lock_timeout = '2s'
set statement_timeout = '5s'
as $$
declare
  lease public.catalogue_worker_state;
  job public.artist_import_queue;
  discovery public.artist_catalogue_discovery;
  stamp timestamptz;
  album jsonb;
  changed bigint;
  is_complete boolean;
begin
  if p_token is null then raise exception 'Missing lease token'; end if;
  select * into lease from public.catalogue_worker_state where singleton for update;
  stamp := clock_timestamp();

  if p_action = 'acquire' then
    if lease.owner_token is not null and lease.expires_at > stamp then
      return jsonb_build_object('busy', true);
    end if;
    -- Expired leases and legacy interrupted jobs can be recovered without
    -- moving their cursor. Crashes count as real consecutive failures.
    update public.artist_import_queue q set
      consecutive_failures = consecutive_failures + 1,
      status = case when consecutive_failures + 1 >= 5 then 'failed' else 'pending' end,
      next_attempt_at = stamp + interval '1 minute',
      last_error = 'Catalogue worker lease expired', updated_at = stamp
    where q.status = 'processing' and (
      q.id = lease.job_id or
      greatest(q.started_at, q.last_heartbeat_at, q.updated_at) < stamp - interval '10 minutes'
    );
    -- Do not run alongside a still-live legacy worker during rollout.
    if exists(select 1 from public.artist_import_queue where status = 'processing') then
      return jsonb_build_object('busy', true);
    end if;

    if coalesce(p_data->>'kind', 'importer') = 'importer' then
      select * into job from public.artist_import_queue
      where status in ('pending', 'failed') and consecutive_failures < 5
        and (next_attempt_at is null or next_attempt_at <= stamp)
      order by priority, id for update skip locked limit 1;
      if job.id is null then
        update public.catalogue_worker_state set owner_token=null, job_id=null, expires_at=null where singleton;
        return jsonb_build_object('idle', true);
      end if;
      update public.artist_import_queue set status='processing', attempts=attempts+1,
        started_at=stamp, last_heartbeat_at=stamp, updated_at=stamp, last_error=null
      where id=job.id returning * into job;
      insert into public.artist_catalogue_discovery(job_id) values(job.id) on conflict do nothing;
      select * into discovery from public.artist_catalogue_discovery where job_id=job.id;
    elsif p_data->>'kind' <> 'inspector' then
      raise exception 'Unknown worker kind';
    end if;
    update public.catalogue_worker_state set owner_token=p_token, job_id=job.id,
      expires_at=stamp + interval '10 minutes', heartbeat_at=stamp where singleton;
    return jsonb_build_object('job', to_jsonb(job), 'discovery', to_jsonb(discovery));
  end if;

  if lease.owner_token is distinct from p_token or lease.expires_at <= stamp
     or lease.job_id is distinct from p_job_id then
    raise exception 'Catalogue lease expired or superseded' using errcode='55000';
  end if;
  -- Every RPC is a heartbeat. Expired owners may never renew themselves.
  update public.catalogue_worker_state set expires_at=stamp + interval '10 minutes', heartbeat_at=stamp where singleton;
  if p_job_id is not null then
    select * into job from public.artist_import_queue where id=p_job_id for update;
    if job.status <> 'processing' then raise exception 'Job is not owned'; end if;
    update public.artist_import_queue set last_heartbeat_at=stamp where id=p_job_id;
  end if;

  if p_action = 'heartbeat' then return '{}'::jsonb;
  elsif p_action = 'rate' then
    if lease.next_musicbrainz_at > stamp then
      return jsonb_build_object('wait_ms', ceil(extract(epoch from (lease.next_musicbrainz_at-stamp))*1000));
    end if;
    update public.catalogue_worker_state set next_musicbrainz_at=stamp + interval '1100 milliseconds' where singleton;
    return jsonb_build_object('wait_ms', 0);
  elsif p_action = 'cooldown' then
    update public.catalogue_worker_state set next_musicbrainz_at=greatest(next_musicbrainz_at,
      stamp + make_interval(secs => greatest(1.1, least(86400, coalesce((p_data->>'milliseconds')::double precision,1100)/1000))))
    where singleton;
    return '{}'::jsonb;
  elsif p_action = 'inspection' and p_job_id is null then
    -- Preserve the inspector's replace-by-artist semantics, now atomically fenced.
    delete from public.artist_release_group_debug where artist_name=p_data->>'artist';
    insert into public.artist_release_group_debug(artist_name,musicbrainz_artist_id,release_group_id,title,
      first_release_date,primary_type,secondary_types,inspected_at)
    select p_data->>'artist',p_data->>'artist_id',g->>'id',g->>'title',nullif(g->>'first-release-date',''),
      g->>'primary-type',array(select jsonb_array_elements_text(g->'secondary-types')),stamp
    from jsonb_array_elements(p_data->'groups') g;
    return '{}'::jsonb;
  elsif p_action = 'discovery' and p_job_id is not null then
    select * into discovery from public.artist_catalogue_discovery where job_id=p_job_id for update;
    if discovery.revision is distinct from (p_data->>'revision')::integer or (discovery.state->>'ready')::boolean then
      raise exception 'Discovery checkpoint is stale or already frozen';
    end if;
    if (p_data->'state'->>'offset')::integer < (discovery.state->>'offset')::integer then
      raise exception 'Discovery cursor cannot move backwards';
    end if;
    if (p_data->'state'->>'ready')::boolean and job.next_album_index > jsonb_array_length(p_data->'state'->'groups') then
      raise exception 'Existing cursor exceeds discovered catalogue; operator review required';
    end if;
    update public.artist_catalogue_discovery set state=p_data->'state',revision=revision+1,updated_at=stamp
      where job_id=p_job_id returning * into discovery;
    update public.artist_import_queue set musicbrainz_artist_id=coalesce(discovery.state->>'artist_id',musicbrainz_artist_id),
      total_studio_albums=case when (discovery.state->>'ready')::boolean then jsonb_array_length(discovery.state->'groups') else total_studio_albums end,
      consecutive_failures=0,next_attempt_at=null,last_error=null,updated_at=stamp where id=p_job_id;
    return to_jsonb(discovery);
  elsif p_action = 'album' and p_job_id is not null then
    select * into discovery from public.artist_catalogue_discovery where job_id=p_job_id;
    if not (discovery.state->>'ready')::boolean or job.next_album_index is distinct from (p_data->>'index')::integer
       or job.next_album_index >= jsonb_array_length(discovery.state->'groups') or p_data->>'group_id' is null
       or (discovery.state->'groups'->job.next_album_index->>'id') is distinct from (p_data->>'group_id') then
      raise exception 'Album checkpoint is stale';
    end if;
    album := p_data->'album';
    if album is not null and album <> 'null'::jsonb then
      if nullif(album->>'existing_id','') is not null then
        update public.albums set
          external_source=coalesce(nullif(external_source,''),album->'payload'->>'external_source'),
          external_id=coalesce(nullif(external_id,''),album->'payload'->>'external_id'),
          cover_art_url=coalesce(nullif(cover_art_url,''),album->'payload'->>'cover_art_url'),
          release_date=coalesce(release_date,(album->'payload'->>'release_date')::date)
        where id=(album->>'existing_id')::bigint returning id into changed;
        if changed is null then raise exception 'Album disappeared before checkpoint'; end if;
      else
        insert into public.albums(title,artist,external_source,external_id,cover_art_url,release_date)
        values(album->'payload'->>'title',job.artist_name,album->'payload'->>'external_source',
          album->'payload'->>'external_id',album->'payload'->>'cover_art_url',(album->'payload'->>'release_date')::date)
        on conflict do nothing;
      end if;
    end if;
    update public.artist_import_queue set next_album_index=next_album_index+1,
      studio_albums_imported=studio_albums_imported+case when album is null or album='null'::jsonb then 0 else 1 end,
      consecutive_failures=0,next_attempt_at=null,last_error=null,updated_at=stamp
    where id=p_job_id returning * into job;
    return to_jsonb(job);
  elsif p_action in ('finish','failure') then
    if p_job_id is not null then
      select * into discovery from public.artist_catalogue_discovery where job_id=p_job_id;
      is_complete := (discovery.state->>'ready')::boolean and job.next_album_index >= jsonb_array_length(discovery.state->'groups');
      if p_action='failure' then
        update public.artist_import_queue set consecutive_failures=consecutive_failures+1,
          status=case when consecutive_failures+1 >= 5 then 'failed' else 'pending' end,
          next_attempt_at=stamp+make_interval(secs => least(3600,60*power(2,consecutive_failures))::integer),
          last_error=left(p_data->>'error',1500),updated_at=stamp where id=p_job_id;
      else
        update public.artist_import_queue set status=case when is_complete then 'complete' else 'pending' end,
          consecutive_failures=case when is_complete then 0 else consecutive_failures end,
          completed_at=case when is_complete then stamp else null end,
          next_attempt_at=case when (p_data->>'defer_ms')::double precision > 0
            then stamp+make_interval(secs => least(86400,(p_data->>'defer_ms')::double precision/1000)) else null end,
          updated_at=stamp where id=p_job_id;
        if is_complete then
          insert into public.artist_catalog(artist_name,musicbrainz_artist_id,studio_album_count,catalog_complete,last_synced_at,last_error,updated_at)
          values(job.artist_name,job.musicbrainz_artist_id,job.studio_albums_imported,true,stamp,null,stamp)
          on conflict(artist_name) do update set musicbrainz_artist_id=excluded.musicbrainz_artist_id,
            studio_album_count=excluded.studio_album_count,catalog_complete=true,last_synced_at=stamp,last_error=null,updated_at=stamp;
        end if;
      end if;
      select * into job from public.artist_import_queue where id=p_job_id;
    end if;
    update public.catalogue_worker_state set owner_token=null,job_id=null,expires_at=null where singleton;
    return to_jsonb(job);
  end if;
  raise exception 'Unknown catalogue worker action';
end;
$$;

revoke all on function public.catalogue_worker(text,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.catalogue_worker(text,uuid,bigint,jsonb) to service_role;
-- Prevent old/manual clients bypassing the lease. Kept for rollback, not dropped.
revoke execute on function public.claim_next_artist_import() from public,anon,authenticated,service_role;
commit;
;
