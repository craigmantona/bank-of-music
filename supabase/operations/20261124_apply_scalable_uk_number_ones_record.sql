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

do $apply_record$
declare
  v_input jsonb;
  v_raw text;
  v_record jsonb;
  v_executor_key text;
  v_record_key text;
  v_manifest text;
  v_payload_sha text;
  v_expected_token text;
  v_action text;
  v_chart_id bigint;
  v_source_key text;
  v_placeholder uuid;
  v_recording text;
  v_release text;
  v_release_group text;
  v_existing_song_id bigint;
  v_reuse_album_id bigint;
  v_target_song_id bigint;
  v_target_album_id bigint;
  v_target_canonical_id uuid;
  v_new_song_id bigint;
  v_chart_before jsonb;
  v_placeholder_before jsonb;
  v_existing_song_before jsonb;
  v_existing_canonical_before jsonb;
  v_existing_album_before jsonb;
  v_chart_after jsonb;
  v_target_canonical_after jsonb;
  v_target_song_after jsonb;
  v_target_album_after jsonb;
  v_changed integer;
  v_applied bigint;
  v_imported bigint;
  v_created_albums bigint;
  v_resolved bigint;
  v_unresolved bigint;
  v_lock text;
begin
  select raw_payload, item into v_raw, v_input from pg_temp.bom_executor_input;
  v_record := v_input->'record';
  v_executor_key := v_input->>'executor_operation_key';
  v_record_key := v_record->>'operation_key';
  v_manifest := v_record->>'manifest_sha256';
  v_payload_sha := pg_catalog.encode(extensions.digest(v_raw, 'sha256'), 'hex');
  v_expected_token := 'apply:' || v_executor_key || ':' || (v_input->>'bundle_sha256') || ':' || v_payload_sha;
  if nullif(current_setting('bom.approved_historical_reconciliation', true), '') is distinct from v_expected_token then
    raise exception 'executor approval token missing or does not bind the reviewed bundle and record';
  end if;
  if v_executor_key <> '20261124_uk_number_ones_scalable_executor_v1'
     or v_input->>'execution_transport' <> 'direct-postgres-psql-v1'
     or v_record_key is null or v_manifest !~ '^[0-9a-f]{64}$'
     or v_input->>'bundle_sha256' !~ '^[0-9a-f]{64}$' then
    raise exception 'executor envelope shape failed';
  end if;

  v_action := v_record #>> '{mutation_payload,action}';
  v_chart_id := (v_record #>> '{mutation_payload,chart_row_id}')::bigint;
  v_source_key := v_record #>> '{preconditions,source_entry_key}';
  v_placeholder := (v_record #>> '{mutation_payload,placeholder_canonical_id}')::uuid;
  v_recording := lower(v_record #>> '{mutation_payload,recording_mbid}');
  v_release := lower(v_record #>> '{mutation_payload,release_mbid}');
  v_release_group := lower(v_record #>> '{mutation_payload,release_group_mbid}');
  v_existing_song_id := nullif(v_record #>> '{mutation_payload,existing_song_id}', '')::bigint;
  v_reuse_album_id := nullif(v_record #>> '{mutation_payload,reuse_album_id}', '')::bigint;
  if v_action not in ('link_existing', 'import_verified') or v_chart_id is null or v_source_key is null
     or v_placeholder is null or v_recording is null or v_release is null or v_release_group is null then
    raise exception 'executor mutation payload shape failed';
  end if;

  if exists (
    select 1 from private.historical_chart_reconciliation_operation_audit
    where operation_key = v_record_key and event_kind = 'apply' and chart_entry_id = v_chart_id
      and manifest_sha256 = v_manifest
  ) then
    return;
  end if;
  if exists (
    select 1 from private.historical_chart_reconciliation_operation_audit
    where operation_key = v_record_key or chart_entry_id = v_chart_id
  ) then
    raise exception 'executor immutable audit conflict for %', v_record_key;
  end if;

  for v_lock in
    select value from unnest(array[
      v_executor_key, 'chart:' || v_chart_id, 'canonical:' || v_placeholder,
      'recording:' || v_recording, 'release:' || v_release
    ]) value order by value
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock, 0));
  end loop;

  select count(*) into v_applied
  from private.historical_chart_reconciliation_operation_audit
  where event_kind = 'apply' and before_state->>'executor_operation_key' = v_executor_key;
  select count(*) into v_imported
  from private.historical_chart_reconciliation_operation_audit
  where event_kind = 'apply' and action = 'import_verified'
    and before_state->>'executor_operation_key' = v_executor_key;
  select count(distinct target_album_id) into v_created_albums
  from private.historical_chart_reconciliation_operation_audit
  where event_kind = 'apply' and action = 'import_verified'
    and before_state->>'executor_operation_key' = v_executor_key
    and before_state->'existing_target_album' is not distinct from 'null'::jsonb;
  select count(*) filter (where song_id is not null),
         count(*) filter (where song_id is null and match_status = 'unresolved')
    into v_resolved, v_unresolved
  from public.quick_rate_collection_tracks where collection_key = 'uk-number-ones';
  if v_resolved <> 479 + v_applied or v_unresolved <> 819 - v_applied
     or (select count(*) from public.quick_rate_collection_tracks where collection_key = 'uk-number-ones') <> 1298
     or (select count(*) from public.songs) <> 16219 + v_imported
     or (select count(*) from public.albums) <> 1786 + v_created_albums
     or (select count(*) from public.canonical_recordings) <> 17095
     or (select count(*) from public.song_ratings) <> 1747
     or (select coalesce(sum(rating), 0) from public.song_ratings) <> 13454
     or (select count(*) from public.historical_chart_entry_ratings) <> 5
     or (select coalesce(sum(rating), 0) from public.historical_chart_entry_ratings) <> 43 then
    raise exception 'executor production baseline is stale';
  end if;

  select to_jsonb(q), to_jsonb(c) into v_chart_before, v_placeholder_before
  from public.quick_rate_collection_tracks q
  join public.canonical_recordings c on c.id = q.canonical_song_id
  where q.id = v_chart_id and q.collection_key = 'uk-number-ones' and q.source_entry_key = v_source_key
    and q.chart_year = (v_record #>> '{chart,chart_year}')::integer
    and q.title = v_record #>> '{chart,title}' and q.artist = v_record #>> '{chart,artist}'
    and q.match_status = 'unresolved' and q.song_id is null and q.musicbrainz_recording_id is null
    and q.canonical_song_id = v_placeholder and q.updated_at = (v_record #>> '{chart,updated_at}')::timestamptz
    and c.id = v_placeholder and c.title = v_record #>> '{chart,title}' and c.artist = v_record #>> '{chart,artist}'
    and c.musicbrainz_recording_id is null and c.origin_key = 'quick-rate:uk-number-ones:' || v_source_key
    and c.updated_at = (v_record #>> '{chart,canonical_updated_at}')::timestamptz
  for update of q, c;
  if not found then raise exception 'executor stale-state guard failed for %', v_source_key; end if;
  if exists (select 1 from public.song_ratings where canonical_song_id = v_placeholder)
     or exists (select 1 from public.historical_chart_entry_ratings where chart_entry_id = v_chart_id)
     or exists (select 1 from public.songs where canonical_song_id = v_placeholder)
     or (select count(*) from public.quick_rate_collection_tracks where canonical_song_id = v_placeholder) <> 1 then
    raise exception 'executor candidate is rated, shared or non-empty for %', v_source_key;
  end if;

  v_existing_song_before := null; v_existing_canonical_before := null; v_existing_album_before := null;
  if v_action = 'link_existing' then
    select s.id, s.canonical_song_id, s.album_id, to_jsonb(s), to_jsonb(c), to_jsonb(a)
      into v_target_song_id, v_target_canonical_id, v_target_album_id,
           v_existing_song_before, v_existing_canonical_before, v_existing_album_before
    from public.songs s
    join public.canonical_recordings c on c.id = s.canonical_song_id
    join public.albums a on a.id = s.album_id
    where s.id = v_existing_song_id and s.external_source = 'musicbrainz'
      and lower(s.external_id) = v_recording and s.is_deleted is not true
      and lower(c.musicbrainz_recording_id) = v_recording
      and a.is_deleted is not true
    for update of s, c, a;
    if not found
       or (select count(*) from public.songs where external_source = 'musicbrainz'
           and lower(external_id) = v_recording and is_deleted is not true) <> 1
       or (select count(*) from public.canonical_recordings
           where lower(coalesce(musicbrainz_recording_id, '')) = v_recording) <> 1 then
      raise exception 'executor exact existing target failed for %', v_source_key;
    end if;
  else
    if exists (select 1 from public.songs where external_source = 'musicbrainz' and lower(external_id) = v_recording)
       or exists (select 1 from public.canonical_recordings where lower(coalesce(musicbrainz_recording_id, '')) = v_recording
                   or lower(coalesce(origin_key, '')) = 'musicbrainz:' || v_recording) then
      raise exception 'executor duplicate recording identity for %', v_source_key;
    end if;
    select a.id, to_jsonb(a) into v_target_album_id, v_existing_album_before
    from public.albums a
    where a.external_source = 'musicbrainz' and a.is_deleted is not true
      and ((v_reuse_album_id is not null and a.id = v_reuse_album_id
            and lower(a.musicbrainz_release_group_id) = v_release_group)
        or (v_reuse_album_id is null and lower(coalesce(a.musicbrainz_release_id, a.external_id)) = v_release
            and lower(a.musicbrainz_release_group_id) = v_release_group));
    if found then
      if not (v_reuse_album_id = v_target_album_id or exists (
        select 1 from private.historical_chart_reconciliation_operation_audit
        where event_kind = 'apply' and before_state->>'executor_operation_key' = v_executor_key
          and musicbrainz_release_id = v_release and target_album_id = v_target_album_id
      )) then raise exception 'executor unreviewed existing release for %', v_source_key; end if;
    else
      if v_reuse_album_id is not null then raise exception 'executor reviewed reuse album is missing for %', v_source_key; end if;
      if exists (select 1 from public.albums where lower(coalesce(musicbrainz_release_id, external_id, '')) = v_release
                 or lower(coalesce(musicbrainz_release_group_id, '')) = v_release_group) then
        raise exception 'executor partial release identity for %', v_source_key;
      end if;
      insert into public.albums(title, artist, external_source, external_id, musicbrainz_release_id,
        musicbrainz_release_group_id, cover_art_url, release_date, canonical_release_date,
        canonical_release_country, catalogue_selection_version, is_deleted)
      values (v_record #>> '{evidence,release_title}', v_record #>> '{evidence,release_artist}', 'musicbrainz', v_release,
        v_release, v_release_group, 'https://coverartarchive.org/release-group/' || v_release_group || '/front-500',
        nullif(v_record #>> '{evidence,release_date}', '')::date, nullif(v_record #>> '{evidence,release_date}', '')::date,
        nullif(v_record #>> '{evidence,release_country}', ''), 1, false)
      returning id into v_target_album_id;
    end if;
    update public.canonical_recordings
    set musicbrainz_recording_id = v_recording, origin_key = 'musicbrainz:' || v_recording,
        source_metadata = coalesce(source_metadata, '{}'::jsonb) || jsonb_build_object('historical_reconciliation',
          jsonb_build_object('operation_key', v_record_key, 'manifest_sha256', v_manifest,
            'evidence_sha256', v_record->>'evidence_sha256', 'isrc', v_record #>> '{evidence,official_charts_isrc}')),
        updated_at = timezone('utc', now())
    where id = v_placeholder and musicbrainz_recording_id is null and origin_key = 'quick-rate:uk-number-ones:' || v_source_key;
    get diagnostics v_changed = row_count;
    if v_changed <> 1 then raise exception 'executor canonical attachment failed for %', v_source_key; end if;
    v_target_canonical_id := v_placeholder;
    insert into public.songs(title, artist, album_id, track_position, external_source, external_id,
      canonical_song_id, duration_ms, is_deleted)
    values (v_record #>> '{chart,title}', v_record #>> '{chart,artist}', v_target_album_id,
      (v_record #>> '{mutation_payload,track_position}')::integer, 'musicbrainz', v_recording,
      v_target_canonical_id, (v_record #>> '{evidence,duration_ms}')::integer, false)
    returning id into v_new_song_id;
    v_target_song_id := v_new_song_id;
  end if;

  update public.quick_rate_collection_tracks
  set song_id = v_target_song_id, canonical_song_id = v_target_canonical_id,
      musicbrainz_recording_id = v_recording, match_status = 'direct_mbid',
      match_method = case when v_action = 'link_existing' then 'verified_evidence_existing' else 'verified_evidence_import' end,
      match_notes = 'Guarded scalable UK No. 1 reconciliation; record manifest ' || v_manifest,
      updated_at = timezone('utc', now())
  where id = v_chart_id and collection_key = 'uk-number-ones' and source_entry_key = v_source_key
    and match_status = 'unresolved' and song_id is null and canonical_song_id = v_placeholder
  returning to_jsonb(quick_rate_collection_tracks) into v_chart_after;
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then raise exception 'executor chart update failed for %', v_source_key; end if;

  select to_jsonb(c), to_jsonb(s), to_jsonb(a)
    into v_target_canonical_after, v_target_song_after, v_target_album_after
  from public.canonical_recordings c join public.songs s on s.canonical_song_id = c.id and s.id = v_target_song_id
  join public.albums a on a.id = s.album_id and a.id = v_target_album_id where c.id = v_target_canonical_id;
  if not found then raise exception 'executor post-state missing for %', v_source_key; end if;

  insert into private.historical_chart_reconciliation_operation_audit(
    operation_key, event_kind, manifest_sha256, chart_entry_id, source_entry_key, action,
    placeholder_canonical_song_id, target_canonical_song_id, target_song_id, target_album_id,
    musicbrainz_recording_id, musicbrainz_release_id, musicbrainz_release_group_id, evidence_sha256,
    before_state, after_state)
  values (v_record_key, 'apply', v_manifest, v_chart_id, v_source_key, v_action, v_placeholder,
    v_target_canonical_id, v_target_song_id, v_target_album_id, v_recording, v_release, v_release_group,
    v_record->>'evidence_sha256',
    jsonb_build_object('executor_operation_key', v_executor_key, 'executor_bundle_sha256', v_input->>'bundle_sha256',
      'executor_payload_sha256', v_payload_sha, 'chart', v_chart_before, 'placeholder_canonical', v_placeholder_before,
      'existing_target_song', v_existing_song_before, 'existing_target_canonical', v_existing_canonical_before,
      'existing_target_album', v_existing_album_before),
    jsonb_build_object('chart', v_chart_after, 'target_canonical', v_target_canonical_after,
      'target_song', v_target_song_after, 'target_album', v_target_album_after));

  if exists ((select * from pg_temp.bom_executor_song_ratings_before except select * from public.song_ratings)
             union all (select * from public.song_ratings except select * from pg_temp.bom_executor_song_ratings_before))
     or exists ((select * from pg_temp.bom_executor_historical_ratings_before except select * from public.historical_chart_entry_ratings)
                union all (select * from public.historical_chart_entry_ratings except select * from pg_temp.bom_executor_historical_ratings_before))
     or exists ((select * from pg_temp.bom_executor_rating_audit_before except select * from private.historical_chart_rating_reconciliation_audit)
                union all (select * from private.historical_chart_rating_reconciliation_audit except select * from pg_temp.bom_executor_rating_audit_before)) then
    raise exception 'executor rating preservation failed for %', v_source_key;
  end if;
  if exists (select 1 from public.canonical_recordings where musicbrainz_recording_id is not null
             group by lower(musicbrainz_recording_id) having count(*) > 1) then
    raise exception 'executor created a duplicate canonical recording';
  end if;
end
$apply_record$;

commit;
