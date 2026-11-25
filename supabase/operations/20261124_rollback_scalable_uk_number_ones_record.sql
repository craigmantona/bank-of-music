\set ON_ERROR_STOP on

begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

create temporary table bom_executor_input(raw_payload text not null, item jsonb not null) on commit drop;
insert into bom_executor_input(raw_payload, item)
select raw_payload, raw_payload::jsonb
from (select convert_from(pg_catalog.decode(:'record_base64', 'base64'), 'UTF8') as raw_payload) decoded;

create temporary table bom_executor_song_ratings_before on commit drop as table public.song_ratings;
create temporary table bom_executor_historical_ratings_before on commit drop as table public.historical_chart_entry_ratings;
create temporary table bom_executor_rating_audit_before on commit drop as table private.historical_chart_rating_reconciliation_audit;

do $rollback_record$
declare
  v_input jsonb;
  v_raw text;
  v_record jsonb;
  v_executor_key text;
  v_record_key text;
  v_manifest text;
  v_payload_sha text;
  v_expected_token text;
  applied private.historical_chart_reconciliation_operation_audit%rowtype;
  v_current_chart jsonb;
  v_current_placeholder jsonb;
  v_current_target_canonical jsonb;
  v_current_target_song jsonb;
  v_current_target_album jsonb;
  v_after_chart jsonb;
  v_after_placeholder jsonb;
  v_after_target_song jsonb;
  v_after_target_album jsonb;
  v_changed integer;
  v_lock text;
begin
  select raw_payload, item into v_raw, v_input from pg_temp.bom_executor_input;
  v_record := v_input->'record';
  v_executor_key := v_input->>'executor_operation_key';
  v_record_key := v_record->>'operation_key';
  v_manifest := v_record->>'manifest_sha256';
  v_payload_sha := pg_catalog.encode(extensions.digest(v_raw, 'sha256'), 'hex');
  v_expected_token := 'rollback:' || v_executor_key || ':' || (v_input->>'bundle_sha256') || ':' || v_payload_sha;
  if nullif(current_setting('bom.approved_historical_reconciliation', true), '') is distinct from v_expected_token then
    raise exception 'rollback approval token missing or does not bind the reviewed bundle and record';
  end if;
  if v_executor_key <> '20261124_uk_number_ones_scalable_executor_v1'
     or v_input->>'execution_transport' is distinct from 'direct-postgres-psql-v1'
     or v_record_key is null or v_manifest !~ '^[0-9a-f]{64}$' then
    raise exception 'rollback executor envelope shape failed';
  end if;

  if exists (select 1 from private.historical_chart_reconciliation_operation_audit
             where operation_key = v_record_key and event_kind = 'rollback'
               and manifest_sha256 = v_manifest) then
    return;
  end if;
  select * into applied
  from private.historical_chart_reconciliation_operation_audit
  where operation_key = v_record_key and event_kind = 'apply' and manifest_sha256 = v_manifest
    and chart_entry_id = (v_record #>> '{mutation_payload,chart_row_id}')::bigint
  for update;
  if not found then raise exception 'reviewed apply audit is missing for %', v_record_key; end if;
  if applied.before_state->>'executor_operation_key' is distinct from v_executor_key
     or applied.before_state->>'executor_bundle_sha256' is distinct from v_input->>'bundle_sha256'
     or applied.before_state->>'executor_payload_sha256' is distinct from v_payload_sha then
    raise exception 'rollback audit does not bind the reviewed executor payload';
  end if;

  for v_lock in
    select value from unnest(array[
      v_executor_key, 'chart:' || applied.chart_entry_id,
      'canonical:' || applied.placeholder_canonical_song_id,
      'recording:' || applied.musicbrainz_recording_id,
      'release:' || applied.musicbrainz_release_id
    ]) value order by value
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock, 0));
  end loop;

  select to_jsonb(q), to_jsonb(c), to_jsonb(s), to_jsonb(a)
    into v_current_chart, v_current_target_canonical, v_current_target_song, v_current_target_album
  from public.quick_rate_collection_tracks q
  join public.canonical_recordings c on c.id = applied.target_canonical_song_id
  join public.songs s on s.id = applied.target_song_id and s.canonical_song_id = c.id
  join public.albums a on a.id = applied.target_album_id and a.id = s.album_id
  where q.id = applied.chart_entry_id
  for update of q, c, s, a;
  if not found or v_current_chart is distinct from applied.after_state->'chart'
     or v_current_target_canonical is distinct from applied.after_state->'target_canonical'
     or v_current_target_song is distinct from applied.after_state->'target_song'
     or v_current_target_album is distinct from applied.after_state->'target_album' then
    raise exception 'rollback after-state guard failed for %', applied.source_entry_key;
  end if;
  select to_jsonb(c) into v_current_placeholder from public.canonical_recordings c
  where c.id = applied.placeholder_canonical_song_id for update;
  if not found then raise exception 'rollback placeholder missing for %', applied.source_entry_key; end if;
  if exists (select 1 from public.song_ratings
             where canonical_song_id = applied.placeholder_canonical_song_id
                or (applied.action = 'import_verified' and
                    (canonical_song_id = applied.target_canonical_song_id or song_id = applied.target_song_id)))
     or exists (select 1 from public.historical_chart_entry_ratings where chart_entry_id = applied.chart_entry_id) then
    raise exception 'rollback refuses a newly rated candidate %', applied.source_entry_key;
  end if;
  if applied.action = 'link_existing'
     and v_current_placeholder is distinct from applied.before_state->'placeholder_canonical' then
    raise exception 'rollback link placeholder drifted for %', applied.source_entry_key;
  end if;
  if applied.action = 'import_verified'
     and ((select count(*) from public.quick_rate_collection_tracks where song_id = applied.target_song_id) <> 1
          or (select count(*) from public.songs where canonical_song_id = applied.target_canonical_song_id) <> 1) then
    raise exception 'rollback import is now shared for %', applied.source_entry_key;
  end if;

  update public.quick_rate_collection_tracks q
  set song_id = nullif(applied.before_state #>> '{chart,song_id}', '')::bigint,
      canonical_song_id = (applied.before_state #>> '{chart,canonical_song_id}')::uuid,
      musicbrainz_recording_id = applied.before_state #>> '{chart,musicbrainz_recording_id}',
      match_status = applied.before_state #>> '{chart,match_status}',
      match_method = applied.before_state #>> '{chart,match_method}',
      match_notes = applied.before_state #>> '{chart,match_notes}',
      updated_at = (applied.before_state #>> '{chart,updated_at}')::timestamptz
  where q.id = applied.chart_entry_id and to_jsonb(q) = applied.after_state->'chart';
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then raise exception 'rollback chart restore failed for %', applied.source_entry_key; end if;

  if applied.action = 'import_verified' then
    delete from public.songs s where s.id = applied.target_song_id and to_jsonb(s) = applied.after_state->'target_song';
    get diagnostics v_changed = row_count;
    if v_changed <> 1 then raise exception 'rollback song delete failed for %', applied.source_entry_key; end if;
    update public.canonical_recordings c
    set musicbrainz_recording_id = applied.before_state #>> '{placeholder_canonical,musicbrainz_recording_id}',
        origin_key = applied.before_state #>> '{placeholder_canonical,origin_key}',
        source_metadata = applied.before_state #> '{placeholder_canonical,source_metadata}',
        updated_at = (applied.before_state #>> '{placeholder_canonical,updated_at}')::timestamptz
    where c.id = applied.target_canonical_song_id and to_jsonb(c) = applied.after_state->'target_canonical';
    get diagnostics v_changed = row_count;
    if v_changed <> 1 then raise exception 'rollback canonical restore failed for %', applied.source_entry_key; end if;
    if not exists (select 1 from public.songs where album_id = applied.target_album_id)
       and exists (select 1 from private.historical_chart_reconciliation_operation_audit owner
                   where owner.event_kind = 'apply' and owner.target_album_id = applied.target_album_id
                     and owner.before_state->>'executor_operation_key' = v_executor_key
                     and owner.before_state->'existing_target_album' is not distinct from 'null'::jsonb) then
      delete from public.albums a where a.id = applied.target_album_id and to_jsonb(a) = applied.after_state->'target_album';
      get diagnostics v_changed = row_count;
      if v_changed <> 1 then raise exception 'rollback album delete failed for %', applied.source_entry_key; end if;
    end if;
  elsif applied.action <> 'link_existing' then
    raise exception 'unsupported rollback action %', applied.action;
  end if;

  select to_jsonb(q), to_jsonb(c) into v_after_chart, v_after_placeholder
  from public.quick_rate_collection_tracks q join public.canonical_recordings c
    on c.id = applied.placeholder_canonical_song_id where q.id = applied.chart_entry_id;
  if v_after_chart is distinct from applied.before_state->'chart'
     or v_after_placeholder is distinct from applied.before_state->'placeholder_canonical' then
    raise exception 'rollback exact restore failed for %', applied.source_entry_key;
  end if;
  if applied.action = 'link_existing' then
    select to_jsonb(s), to_jsonb(a) into v_after_target_song, v_after_target_album
    from public.songs s join public.albums a on a.id = s.album_id
    where s.id = applied.target_song_id and a.id = applied.target_album_id;
  else
    v_after_target_song := null;
    select to_jsonb(a) into v_after_target_album from public.albums a where a.id = applied.target_album_id;
  end if;

  insert into private.historical_chart_reconciliation_operation_audit(
    operation_key, event_kind, manifest_sha256, chart_entry_id, source_entry_key, action,
    placeholder_canonical_song_id, target_canonical_song_id, target_song_id, target_album_id,
    musicbrainz_recording_id, musicbrainz_release_id, musicbrainz_release_group_id, evidence_sha256,
    before_state, after_state)
  values (applied.operation_key, 'rollback', applied.manifest_sha256, applied.chart_entry_id,
    applied.source_entry_key, applied.action, applied.placeholder_canonical_song_id,
    applied.target_canonical_song_id, applied.target_song_id, applied.target_album_id,
    applied.musicbrainz_recording_id, applied.musicbrainz_release_id,
    applied.musicbrainz_release_group_id, applied.evidence_sha256, applied.after_state,
    jsonb_build_object('chart', v_after_chart, 'placeholder_canonical', v_after_placeholder,
      'target_song', v_after_target_song, 'target_album', v_after_target_album,
      'executor_operation_key', v_executor_key, 'executor_bundle_sha256', v_input->>'bundle_sha256',
      'executor_payload_sha256', v_payload_sha));

  if exists ((select * from pg_temp.bom_executor_song_ratings_before except select * from public.song_ratings)
             union all (select * from public.song_ratings except select * from pg_temp.bom_executor_song_ratings_before))
     or exists ((select * from pg_temp.bom_executor_historical_ratings_before except select * from public.historical_chart_entry_ratings)
                union all (select * from public.historical_chart_entry_ratings except select * from pg_temp.bom_executor_historical_ratings_before))
     or exists ((select * from pg_temp.bom_executor_rating_audit_before except select * from private.historical_chart_rating_reconciliation_audit)
                union all (select * from private.historical_chart_rating_reconciliation_audit except select * from pg_temp.bom_executor_rating_audit_before)) then
    raise exception 'rollback rating preservation failed for %', applied.source_entry_key;
  end if;
  if exists (select 1 from public.canonical_recordings where musicbrainz_recording_id is not null
             group by lower(musicbrainz_recording_id) having count(*) > 1) then
    raise exception 'rollback left duplicate canonical recordings';
  end if;
end
$rollback_record$;

commit;
