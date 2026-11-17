begin;

alter table public.albums
  add column automated_import_run_id uuid,
  add column automated_imported_at timestamptz;

create index albums_automated_imported_at_idx
  on public.albums (automated_imported_at)
  where automated_import_run_id is not null;

create or replace function public.automated_catalogue_album(
  p_token uuid, p_job_id bigint, p_data jsonb
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
  protected_decision public.artist_catalogue_overrides;
  candidate jsonb;
  album jsonb;
  payload jsonb;
  existing public.albums%rowtype;
  committed_id bigint;
  stamp timestamptz := clock_timestamp();
  cursor_before integer;
  run_id uuid := nullif(p_data->>'automation_run_id','')::uuid;
  release_id text;
  group_id text;
begin
  if p_token is null or p_job_id is null then raise exception 'Missing catalogue ownership'; end if;
  select * into lease from public.catalogue_worker_state where singleton for update;
  if lease.owner_token is distinct from p_token or lease.expires_at <= stamp
     or lease.job_id is distinct from p_job_id then
    raise exception 'Catalogue lease expired or superseded' using errcode='55000';
  end if;
  select * into job from public.artist_import_queue where id=p_job_id for update;
  select * into discovery from public.artist_catalogue_discovery where job_id=p_job_id for update;
  if job.status <> 'processing' then raise exception 'Job is not owned'; end if;
  cursor_before := job.next_album_index;
  candidate := discovery.state->'groups'->cursor_before;
  if not (discovery.state->>'ready')::boolean
     or cursor_before is distinct from (p_data->>'index')::integer
     or cursor_before >= jsonb_array_length(discovery.state->'groups')
     or candidate->>'id' is distinct from p_data->>'group_id' then
    raise exception 'Album checkpoint is stale';
  end if;
  select * into protected_decision from public.artist_catalogue_overrides
    where release_group_id=p_data->>'group_id' and qualification in ('review','exclude')
      and decision_source in ('policy','human');
  if protected_decision.qualification = 'review' then
    raise exception 'Protected review decision cannot be committed as an album' using errcode='55000';
  end if;
  album := case when protected_decision.release_group_id is not null then null else p_data->'album' end;
  if album is not null and album <> 'null'::jsonb then
    payload := album->'payload';
    release_id := nullif(payload->>'musicbrainz_release_id','');
    group_id := nullif(payload->>'musicbrainz_release_group_id','');
    if release_id is null or group_id is null then
      raise exception 'MusicBrainz release and release-group IDs are required';
    end if;

    if nullif(album->>'existing_id','') is not null then
      select a.* into existing from public.albums a
      where a.id=(album->>'existing_id')::bigint and a.is_deleted is not true for update;
      if existing.id is null then raise exception 'Album disappeared before checkpoint'; end if;
      if lower(btrim(existing.artist)) <> lower(btrim(job.artist_name)) then
        raise exception 'Existing album artist does not match owned job' using errcode='23505';
      end if;
    end if;
    if existing.id is null then
      select a.* into existing from public.albums a
      where a.is_deleted is not true and (
        a.musicbrainz_release_group_id = group_id
        or a.musicbrainz_release_id = release_id
        or (a.external_source='musicbrainz' and a.external_id=release_id)
        or (lower(regexp_replace(a.title,'[^[:alnum:]]+','','g')) =
            lower(regexp_replace(payload->>'title','[^[:alnum:]]+','','g'))
          and lower(regexp_replace(a.artist,'[^[:alnum:]]+','','g')) =
            lower(regexp_replace(job.artist_name,'[^[:alnum:]]+','','g')))
      ) order by (a.musicbrainz_release_group_id=group_id) desc,
        (a.musicbrainz_release_id=release_id) desc, a.id limit 1 for update;
    end if;

    if existing.id is not null then
      if existing.musicbrainz_release_group_id is not null
         and existing.musicbrainz_release_group_id <> group_id then
        raise exception 'Album identity conflicts with a different release group' using errcode='23505';
      end if;
      update public.albums set
        external_source=coalesce(nullif(external_source,''),'musicbrainz'),
        external_id=coalesce(nullif(external_id,''),release_id),
        musicbrainz_release_id=coalesce(musicbrainz_release_id,release_id),
        musicbrainz_release_group_id=coalesce(musicbrainz_release_group_id,group_id),
        cover_art_url=coalesce(nullif(cover_art_url,''),payload->>'cover_art_url'),
        release_date=coalesce(release_date,(payload->>'release_date')::date)
      where id=existing.id returning id into committed_id;
    else
      insert into public.albums(title,artist,external_source,external_id,cover_art_url,release_date,
        musicbrainz_release_id,musicbrainz_release_group_id,automated_import_run_id,automated_imported_at)
      values(payload->>'title',job.artist_name,'musicbrainz',release_id,payload->>'cover_art_url',
        (payload->>'release_date')::date,release_id,group_id,run_id,case when run_id is null then null else stamp end)
      returning id into committed_id;
    end if;
  end if;

  update public.artist_import_queue set next_album_index=next_album_index+1,
    studio_albums_imported=studio_albums_imported+case when committed_id is null then 0 else 1 end,
    consecutive_failures=0,next_attempt_at=null,last_error=null,updated_at=stamp,last_heartbeat_at=stamp
  where id=p_job_id returning * into job;
  update public.catalogue_worker_state set expires_at=stamp+interval '10 minutes',heartbeat_at=stamp
    where singleton;
  insert into public.artist_catalogue_events(event_key,job_id,artist_name,musicbrainz_artist_id,
    attempt_number,worker_token,event_type,release_group_id,release_group_title,cursor_before,cursor_after,
    outcome,details)
  values('candidate:'||job.id||':'||(candidate->>'id'),job.id,job.artist_name,job.musicbrainz_artist_id,
    job.attempts,p_token,'candidate_checkpoint',candidate->>'id',candidate->>'title',cursor_before,
    job.next_album_index,'success',jsonb_strip_nulls(jsonb_build_object(
      'album_action',case when protected_decision.release_group_id is not null then 'excluded'
        when album is null or album='null'::jsonb then 'skipped'
        when existing.id is not null then 'existing' else 'inserted' end,
      'album_id',committed_id,'automation_run_id',run_id))) on conflict do nothing;
  return to_jsonb(job);
end;
$$;

revoke all on function public.automated_catalogue_album(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.automated_catalogue_album(uuid,bigint,jsonb) to service_role;

create or replace function public.automated_album_import_status(p_run_id uuid default null)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select jsonb_build_object(
    'database_size_bytes', pg_database_size(current_database()),
    'albums_imported_today', count(*) filter (
      where albums.automated_imported_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
        and albums.automated_import_run_id is not null and albums.is_deleted is not true),
    'albums_imported_this_run', count(*) filter (
      where p_run_id is not null and albums.automated_import_run_id=p_run_id
        and albums.is_deleted is not true),
    'external_musicbrainz_albums_today', count(*) filter (
      where albums.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
        and albums.external_source='musicbrainz' and albums.automated_import_run_id is null
        and albums.is_deleted is not true),
    'queue_available', (select count(*) from public.artist_import_queue
      where status in ('pending','failed') and consecutive_failures < 5
        and (next_attempt_at is null or next_attempt_at <= now())),
    'checked_at', now()
  ) from public.albums;
$$;

revoke all on function public.automated_album_import_status(uuid) from public,anon,authenticated;
grant execute on function public.automated_album_import_status(uuid) to service_role;

commit;
