-- Durable catalogue attempt history and protected qualification authority.
begin;

alter table public.artist_import_queue
  drop constraint artist_import_queue_status_check,
  add constraint artist_import_queue_status_check
    check (status = any (array['pending','processing','complete','failed','review']));

create table public.artist_catalogue_events (
  id bigint generated always as identity primary key,
  event_key text,
  job_id bigint not null references public.artist_import_queue(id) on delete cascade,
  artist_name text not null,
  musicbrainz_artist_id text,
  attempt_number integer,
  worker_token uuid,
  event_type text not null check (char_length(event_type) between 1 and 64),
  release_group_id text,
  release_group_title text,
  cursor_before integer,
  cursor_after integer,
  outcome text not null check (outcome in ('success','failure','deferral','review')),
  error_category text,
  error_detail text check (char_length(error_detail) <= 1500),
  details jsonb not null default '{}'::jsonb
    check (octet_length(details::text) <= 4096),
  occurred_at timestamptz not null default clock_timestamp()
);

create unique index artist_catalogue_events_event_key_unique
  on public.artist_catalogue_events(event_key) where event_key is not null;
create index artist_catalogue_events_job_time_idx
  on public.artist_catalogue_events(job_id, occurred_at desc);
create index artist_catalogue_events_type_time_idx
  on public.artist_catalogue_events(event_type, occurred_at desc);

alter table public.artist_catalogue_events enable row level security;
revoke all on public.artist_catalogue_events from public, anon, authenticated, service_role;
grant select, insert on public.artist_catalogue_events to service_role;

create or replace function public.catalogue_worker(
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
  request_token uuid;
  coordinated_at timestamptz;
  protected_decision public.artist_catalogue_overrides;
  cursor_before integer;
  candidate jsonb;
begin
  if p_token is null then raise exception 'Missing lease token'; end if;
  select * into lease from public.catalogue_worker_state where singleton for update;
  stamp := clock_timestamp();

  if p_action = 'acquire' then
    -- A PostgREST response can be lost after this transaction commits. A retry
    -- with the original token recovers only that exact, still-live ownership.
    -- This branch deliberately performs no heartbeat, queue, or discovery write.
    if lease.owner_token = p_token and lease.expires_at > stamp then
      if lease.job_id is null then
        if coalesce(p_data->>'kind', 'importer') <> 'inspector' then
          raise exception 'Catalogue lease state is inconsistent' using errcode='55000';
        end if;
        return jsonb_build_object('job', null, 'discovery', null, 'recovered', true);
      end if;
      if coalesce(p_data->>'kind', 'importer') <> 'importer' then
        raise exception 'Catalogue lease state is inconsistent' using errcode='55000';
      end if;
      select * into job from public.artist_import_queue where id=lease.job_id for update;
      select * into discovery from public.artist_catalogue_discovery where job_id=lease.job_id;
      if job.id is null or job.status <> 'processing' or discovery.job_id is null then
        raise exception 'Catalogue lease state is inconsistent' using errcode='55000';
      end if;
      return jsonb_build_object('job', to_jsonb(job), 'discovery', to_jsonb(discovery), 'recovered', true);
    end if;
    if lease.owner_token is not null and lease.expires_at > stamp then
      return jsonb_build_object('busy', true);
    end if;
    -- Expired leases and legacy interrupted jobs can be recovered without
    -- moving their cursor. Crashes count as real consecutive failures.
    with expired as (
      update public.artist_import_queue q set
        consecutive_failures = consecutive_failures + 1,
        status = case when consecutive_failures + 1 >= 5 then 'failed' else 'pending' end,
        next_attempt_at = stamp + interval '1 minute',
        last_error = 'Catalogue worker lease expired', updated_at = stamp
      where q.status = 'processing' and (
        q.id = lease.job_id or
        greatest(q.started_at, q.last_heartbeat_at, q.updated_at) < stamp - interval '10 minutes'
      ) returning q.*
    )
    insert into public.artist_catalogue_events(event_key,job_id,artist_name,musicbrainz_artist_id,
      attempt_number,worker_token,event_type,cursor_before,cursor_after,outcome,error_category,error_detail)
    select 'lease-expired:'||id||':'||attempts,id,artist_name,musicbrainz_artist_id,attempts,
      case when id=lease.job_id then lease.owner_token else null end,'lease_expired',
      next_album_index,next_album_index,'failure','lease_expired','Catalogue worker lease expired'
    from expired on conflict do nothing;
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
    if job.id is not null then
      insert into public.artist_catalogue_events(event_key,job_id,artist_name,musicbrainz_artist_id,
        attempt_number,worker_token,event_type,cursor_before,cursor_after,outcome,details)
      values('attempt:'||job.id||':'||job.attempts,job.id,job.artist_name,job.musicbrainz_artist_id,
        job.attempts,p_token,'attempt_started',job.next_album_index,job.next_album_index,'success',
        jsonb_build_object('recovered',false)) on conflict do nothing;
    end if;
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
    request_token := nullif(p_data->>'request_token','')::uuid;
    if request_token is null then raise exception 'Missing coordination request token'; end if;
    if lease.coordination_request_token = request_token and lease.coordination_action = 'rate' then
      return jsonb_build_object('wait_ms', greatest(0, ceil(extract(epoch from
        (lease.coordination_not_before-stamp))*1000)), 'reserved_at', lease.coordination_not_before,
        'recovered', true);
    end if;
    coordinated_at := greatest(stamp, lease.next_musicbrainz_at);
    update public.catalogue_worker_state set next_musicbrainz_at=coordinated_at + interval '1100 milliseconds',
      coordination_request_token=request_token,coordination_action='rate',
      coordination_not_before=coordinated_at,coordination_created_at=stamp where singleton;
    return jsonb_build_object('wait_ms', greatest(0, ceil(extract(epoch from (coordinated_at-stamp))*1000)),
      'reserved_at', coordinated_at);
  elsif p_action = 'cooldown' then
    request_token := nullif(p_data->>'request_token','')::uuid;
    if request_token is null then raise exception 'Missing coordination request token'; end if;
    if lease.coordination_request_token = request_token and lease.coordination_action = 'cooldown' then
      return jsonb_build_object('not_before', lease.coordination_not_before, 'recovered', true);
    end if;
    coordinated_at := greatest(lease.next_musicbrainz_at, stamp + make_interval(secs => greatest(1.1,
      least(86400, coalesce((p_data->>'milliseconds')::double precision,1100)/1000))));
    update public.catalogue_worker_state set next_musicbrainz_at=coordinated_at,
      coordination_request_token=request_token,coordination_action='cooldown',
      coordination_not_before=coordinated_at,coordination_created_at=stamp where singleton;
    return jsonb_build_object('not_before', coordinated_at);
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
    insert into public.artist_catalogue_events(job_id,artist_name,musicbrainz_artist_id,attempt_number,
      worker_token,event_type,cursor_before,cursor_after,outcome,details)
    values(job.id,job.artist_name,coalesce(discovery.state->>'artist_id',job.musicbrainz_artist_id),job.attempts,
      p_token,'discovery_checkpoint',job.next_album_index,job.next_album_index,'success',
      jsonb_build_object('revision',discovery.revision,'offset',discovery.state->'offset',
        'ready',discovery.state->'ready','candidate_count',jsonb_array_length(discovery.state->'groups')));
    return to_jsonb(discovery);
  elsif p_action = 'review' and p_job_id is not null then
    select * into discovery from public.artist_catalogue_discovery where job_id=p_job_id;
    cursor_before := job.next_album_index;
    candidate := discovery.state->'groups'->cursor_before;
    if not (discovery.state->>'ready')::boolean or cursor_before is distinct from (p_data->>'index')::integer
       or cursor_before >= jsonb_array_length(discovery.state->'groups') or p_data->>'group_id' is null
       or (candidate->>'id') is distinct from (p_data->>'group_id') then
      raise exception 'Review checkpoint is stale';
    end if;
    select * into protected_decision from public.artist_catalogue_overrides
      where release_group_id=p_data->>'group_id' and qualification='review'
        and decision_source in ('policy','human');
    if protected_decision.release_group_id is null then
      raise exception 'Review checkpoint requires a protected review decision';
    end if;
    update public.artist_import_queue set status='review',next_attempt_at=null,last_error=null,updated_at=stamp
      where id=p_job_id returning * into job;
    insert into public.artist_catalogue_events(event_key,job_id,artist_name,musicbrainz_artist_id,
      attempt_number,worker_token,event_type,release_group_id,release_group_title,cursor_before,cursor_after,
      outcome,details)
    values('review:'||job.id||':'||(candidate->>'id'),job.id,job.artist_name,job.musicbrainz_artist_id,
      job.attempts,p_token,'candidate_review',candidate->>'id',candidate->>'title',cursor_before,cursor_before,
      'review',jsonb_build_object('qualification','review','reason',protected_decision.reason,
        'decision_source',protected_decision.decision_source)) on conflict do nothing;
    update public.catalogue_worker_state set owner_token=null,job_id=null,expires_at=null where singleton;
    return jsonb_build_object('job',to_jsonb(job),'review_pending',true,
      'release_group_id',candidate->>'id','release_group_title',candidate->>'title');
  elsif p_action = 'album' and p_job_id is not null then
    select * into discovery from public.artist_catalogue_discovery where job_id=p_job_id;
    if not (discovery.state->>'ready')::boolean or job.next_album_index is distinct from (p_data->>'index')::integer
       or job.next_album_index >= jsonb_array_length(discovery.state->'groups') or p_data->>'group_id' is null
       or (discovery.state->'groups'->job.next_album_index->>'id') is distinct from (p_data->>'group_id') then
      raise exception 'Album checkpoint is stale';
    end if;
    cursor_before := job.next_album_index;
    candidate := discovery.state->'groups'->cursor_before;
    select * into protected_decision from public.artist_catalogue_overrides
      where release_group_id=p_data->>'group_id' and qualification in ('review','exclude')
        and decision_source in ('policy','human');
    if protected_decision.qualification = 'review' then
      raise exception 'Protected review decision cannot be committed as an album' using errcode='55000';
    end if;
    album := case when protected_decision.release_group_id is not null then null else p_data->'album' end;
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
    insert into public.artist_catalogue_events(event_key,job_id,artist_name,musicbrainz_artist_id,
      attempt_number,worker_token,event_type,release_group_id,release_group_title,cursor_before,cursor_after,
      outcome,details)
    values('candidate:'||job.id||':'||(candidate->>'id'),job.id,job.artist_name,job.musicbrainz_artist_id,
      job.attempts,p_token,'candidate_checkpoint',candidate->>'id',candidate->>'title',cursor_before,
      job.next_album_index,'success',jsonb_build_object(
        'album_action',case when protected_decision.release_group_id is not null then 'excluded'
          when album is null or album='null'::jsonb then 'skipped' when nullif(album->>'existing_id','') is not null
          then 'existing' else 'inserted' end,
        'qualification',case when protected_decision.release_group_id is not null then 'exclude' else null end,
        'decision_source',protected_decision.decision_source)) on conflict do nothing;
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
      insert into public.artist_catalogue_events(event_key,job_id,artist_name,musicbrainz_artist_id,
        attempt_number,worker_token,event_type,cursor_before,cursor_after,outcome,error_category,error_detail,details)
      values('outcome:'||job.id||':'||job.attempts,job.id,job.artist_name,job.musicbrainz_artist_id,
        job.attempts,p_token,case when p_action='failure' then 'attempt_failed'
          when nullif(p_data->>'defer_reason','') is not null then 'attempt_deferred'
          when job.status='complete' then 'job_completed' else 'attempt_finished' end,
        job.next_album_index,job.next_album_index,
        case when p_action='failure' then 'failure' when nullif(p_data->>'defer_reason','') is not null
          then 'deferral' else 'success' end,nullif(p_data->>'error_category',''),
        left(nullif(p_data->>'error',''),1500),jsonb_strip_nulls(jsonb_build_object(
          'defer_reason',nullif(p_data->>'defer_reason',''),'defer_ms',nullif(p_data->>'defer_ms','')::double precision,
          'status',job.status))) on conflict do nothing;
    end if;
    update public.catalogue_worker_state set owner_token=null,job_id=null,expires_at=null where singleton;
    return to_jsonb(job);
  end if;
  raise exception 'Unknown catalogue worker action';
end;
$$;


revoke all on function public.catalogue_worker(text,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.catalogue_worker(text,uuid,bigint,jsonb) to service_role;

commit;
