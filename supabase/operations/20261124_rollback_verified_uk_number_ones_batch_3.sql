begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Execution-role contract: run this reviewed rollback only as the migration
-- owner/postgres role. The service role intentionally has no UPDATE, DELETE or
-- TRUNCATE privilege needed for the explicit high-strength table locks below.
-- Compensating rollback for the reviewed batch-3 manifest. This is also inert
-- unless an operator supplies an independent rollback approval at session scope.
do $approval$
declare
  v_expected constant text :=
    '20261124_uk_number_ones_verified_batch_3:49b05d4ed317b0a22ae3aff5365f3c9835d40f3ba771d3ac19308c3d90db54b9';
begin
  if nullif(
       current_setting(
         'bom.approved_historical_reconciliation_rollback',
         true
       ),
       ''
     ) is distinct from v_expected then
    raise exception 'batch-3 rollback approval token missing or does not match the reviewed manifest';
  end if;
end
$approval$;

create temporary table uk_number_ones_batch_3_rollback_manifest
on commit drop
as
select *
from private.historical_chart_reconciliation_operation_audit
where operation_key = '20261124_uk_number_ones_verified_batch_3'
  and event_kind = 'apply'
  and manifest_sha256 = split_part(
    nullif(
      current_setting(
        'bom.approved_historical_reconciliation_rollback',
        true
      ),
      ''
    ),
    ':',
    2
  );

do $manifest_guard$
begin
  if (select count(*)
      from pg_temp.uk_number_ones_batch_3_rollback_manifest) <> 20
     or (select count(distinct chart_entry_id)
         from pg_temp.uk_number_ones_batch_3_rollback_manifest) <> 20
     or (select count(*)
         from pg_temp.uk_number_ones_batch_3_rollback_manifest
         where action = 'import_verified') <> 20
     or (select count(*)
         from pg_temp.uk_number_ones_batch_3_rollback_manifest
         where action = 'link_existing') <> 0
     or exists (
       select 1
       from private.historical_chart_reconciliation_operation_audit
       where operation_key =
         '20261124_uk_number_ones_verified_batch_3'
         and event_kind = 'rollback'
     ) then
    raise exception 'batch-3 apply audit is missing, inconsistent or already rolled back';
  end if;
end
$manifest_guard$;

-- Use the same deterministic lock namespace and order as the apply operation.
do $advisory_locks$
declare
  v_lock record;
begin
  for v_lock in
    select distinct lock_key
    from (
      select 'bom-historical-reconciliation:20261124_uk_number_ones_verified_batch_3'::text
        as lock_key
      union all
      select 'bom-historical-chart:' || source_entry_key
      from pg_temp.uk_number_ones_batch_3_rollback_manifest
      union all
      select 'musicbrainz-recording:' || musicbrainz_recording_id
      from pg_temp.uk_number_ones_batch_3_rollback_manifest
      union all
      select 'musicbrainz-release:' || musicbrainz_release_id
      from pg_temp.uk_number_ones_batch_3_rollback_manifest
      where action = 'import_verified'
      union all
      select 'bom-admin-catalogue:' || musicbrainz_release_group_id
      from pg_temp.uk_number_ones_batch_3_rollback_manifest
      where action = 'import_verified'
    ) lock_keys
    order by lock_key
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_lock.lock_key, 0));
  end loop;
end
$advisory_locks$;

lock table public.quick_rate_collection_tracks in exclusive mode;
lock table public.albums in share row exclusive mode;
lock table public.canonical_recordings in share row exclusive mode;
lock table public.songs in share row exclusive mode;
lock table public.song_ratings in share row exclusive mode;
lock table public.historical_chart_entry_ratings in share row exclusive mode;
lock table private.historical_chart_rating_reconciliation_audit
  in share row exclusive mode;
lock table private.historical_chart_reconciliation_operation_audit
  in share row exclusive mode;

create temporary table uk_number_ones_batch_3_rollback_song_ratings_before
on commit drop
as select * from public.song_ratings;

create temporary table uk_number_ones_batch_3_rollback_historical_ratings_before
on commit drop
as select * from public.historical_chart_entry_ratings;

create temporary table uk_number_ones_batch_3_rollback_first_batch_audit_before
on commit drop
as select * from private.historical_chart_rating_reconciliation_audit;

do $after_baseline$
declare
  v_total bigint;
  v_resolved bigint;
  v_unresolved bigint;
begin
  select
    count(*),
    count(*) filter (where song_id is not null),
    count(*) filter (where song_id is null and match_status = 'unresolved')
  into v_total, v_resolved, v_unresolved
  from public.quick_rate_collection_tracks
  where collection_key = 'uk-number-ones';

  if v_total <> 1298 or v_resolved <> 459 or v_unresolved <> 839
     or v_total <> v_resolved + v_unresolved then
    raise exception 'batch-3 rollback chart baseline is stale';
  end if;
  if (select count(*) from public.albums) <> 1769
     or (select count(*) from public.songs) <> 16201
     or (select count(*) from public.canonical_recordings) <> 17095 then
    raise exception 'batch-3 rollback catalogue baseline is stale';
  end if;
  if (select count(*) from public.song_ratings) <> 1747
     or (select coalesce(sum(rating), 0) from public.song_ratings) <> 13454
     or (select count(*) from public.song_ratings
         where rating is null or rating < 0 or rating > 10) <> 0
     or (select count(*) from public.historical_chart_entry_ratings) <> 5
     or (select coalesce(sum(rating), 0)
         from public.historical_chart_entry_ratings) <> 43
     or (select count(*)
         from private.historical_chart_rating_reconciliation_audit) <> 1 then
    raise exception 'batch-3 rollback rating baseline is stale';
  end if;
  if not exists (
    select 1
    from private.historical_chart_rating_reconciliation_audit a
    join public.song_ratings source_rating
      on source_rating.user_id = a.user_id
     and source_rating.canonical_song_id = a.source_canonical_song_id
     and source_rating.rating = a.source_rating
    join public.song_ratings target_rating
      on target_rating.id = a.target_song_rating_id
     and target_rating.user_id = a.user_id
     and target_rating.canonical_song_id = a.target_canonical_song_id
     and target_rating.rating = a.source_rating
    where a.operation_key = '20261123_uk_number_ones_first_batch'
      and a.chart_entry_id = 486
      and a.source_entry_key =
        '1986:573:madonna:papa don t preach'
      and a.source_canonical_song_id =
        'a4a08d9e-2a24-4afb-adee-a2d196141b5b'::uuid
      and a.target_canonical_song_id =
        '2a602676-3db2-44c2-9446-d2068410953c'::uuid
      and a.source_rating = 8
      and a.source_song_rating_rows = 1
      and a.source_historical_rating_rows = 0
      and a.source_kinds = array['placeholder_canonical']::text[]
      and a.reconciliation_status = 'copied'
  ) then
    raise exception 'Papa Don''t Preach reconciliation rollback baseline is stale';
  end if;
  if (select count(*)
      from private.historical_chart_reconciliation_operation_audit) <> 40 then
    raise exception 'batch-3 rollback immutable audit baseline is stale';
  end if;
end
$after_baseline$;

do $rollback_batch$
declare
  applied record;
  v_before_chart jsonb;
  v_before_placeholder jsonb;
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
  v_rolled_back integer := 0;
begin
  for applied in
    select *
    from pg_temp.uk_number_ones_batch_3_rollback_manifest
    order by chart_entry_id
  loop
    v_before_chart := applied.before_state->'chart';
    v_before_placeholder :=
      applied.before_state->'placeholder_canonical';

    select to_jsonb(q), to_jsonb(c), to_jsonb(s), to_jsonb(a)
    into
      v_current_chart,
      v_current_target_canonical,
      v_current_target_song,
      v_current_target_album
    from public.quick_rate_collection_tracks q
    join public.canonical_recordings c
      on c.id = applied.target_canonical_song_id
    join public.songs s
      on s.id = applied.target_song_id
     and s.canonical_song_id = c.id
    join public.albums a
      on a.id = applied.target_album_id
     and a.id = s.album_id
    where q.id = applied.chart_entry_id
    for update of q, c, s, a;

    if not found
       or v_current_chart is distinct from applied.after_state->'chart'
       or v_current_target_canonical is distinct from
            applied.after_state->'target_canonical'
       or v_current_target_song is distinct from
            applied.after_state->'target_song'
       or v_current_target_album is distinct from
            applied.after_state->'target_album' then
      raise exception 'batch-3 rollback after-state guard failed for %',
        applied.source_entry_key;
    end if;

    select to_jsonb(c)
    into v_current_placeholder
    from public.canonical_recordings c
    where c.id = applied.placeholder_canonical_song_id
    for update;

    if not found then
      raise exception 'batch-3 rollback placeholder missing for %',
        applied.source_entry_key;
    end if;

    if exists (
      select 1
      from public.song_ratings r
      where r.canonical_song_id = applied.placeholder_canonical_song_id
         or (
           applied.action = 'import_verified'
           and (
             r.canonical_song_id = applied.target_canonical_song_id
             or r.song_id = applied.target_song_id
           )
         )
    ) or exists (
      select 1
      from public.historical_chart_entry_ratings r
      where r.chart_entry_id = applied.chart_entry_id
    ) then
      raise exception 'batch-3 rollback refuses a newly rated candidate %',
        applied.source_entry_key;
    end if;

    if applied.action = 'import_verified' then
      if (select count(*)
          from public.quick_rate_collection_tracks
          where canonical_song_id = applied.target_canonical_song_id) <> 1
         or (select count(*)
             from public.quick_rate_collection_tracks
             where song_id = applied.target_song_id) <> 1
         or (select count(*)
             from public.songs
             where canonical_song_id =
               applied.target_canonical_song_id) <> 1
         or (select count(*)
             from public.songs
             where album_id = applied.target_album_id) <>
              (
                (select count(*)
                 from pg_temp.uk_number_ones_batch_3_rollback_manifest remaining
                 where remaining.target_album_id = applied.target_album_id)
                -
                (select count(*)
                 from private.historical_chart_reconciliation_operation_audit rolled_back
                 where rolled_back.operation_key = applied.operation_key
                   and rolled_back.event_kind = 'rollback'
                   and rolled_back.target_album_id = applied.target_album_id)
              ) then
        raise exception 'batch-3 rollback import is now shared for %',
          applied.source_entry_key;
      end if;
    elsif applied.action = 'link_existing' then
      if v_current_placeholder is distinct from v_before_placeholder then
        raise exception 'batch-3 rollback placeholder drifted for %',
          applied.source_entry_key;
      end if;
    else
      raise exception 'unsupported batch-3 rollback action %',
        applied.action;
    end if;

    update public.quick_rate_collection_tracks q
    set song_id = nullif(v_before_chart->>'song_id', '')::bigint,
        canonical_song_id =
          (v_before_chart->>'canonical_song_id')::uuid,
        musicbrainz_recording_id =
          v_before_chart->>'musicbrainz_recording_id',
        match_status = v_before_chart->>'match_status',
        match_method = v_before_chart->>'match_method',
        match_notes = v_before_chart->>'match_notes',
        updated_at = (v_before_chart->>'updated_at')::timestamptz
    where q.id = applied.chart_entry_id
      and to_jsonb(q) = applied.after_state->'chart';

    get diagnostics v_changed = row_count;
    if v_changed <> 1 then
      raise exception 'batch-3 rollback chart restore failed for %',
        applied.source_entry_key;
    end if;

    if applied.action = 'import_verified' then
      delete from public.songs s
      where s.id = applied.target_song_id
        and to_jsonb(s) = applied.after_state->'target_song';

      get diagnostics v_changed = row_count;
      if v_changed <> 1 then
        raise exception 'batch-3 rollback song delete failed for %',
          applied.source_entry_key;
      end if;

      delete from public.albums a
      where a.id = applied.target_album_id
        and to_jsonb(a) = applied.after_state->'target_album'
        and not exists (
          select 1 from public.songs s where s.album_id = a.id
        );

      get diagnostics v_changed = row_count;
      if exists (
           select 1 from public.songs
           where album_id = applied.target_album_id
         ) then
        if v_changed <> 0 then
          raise exception 'batch-3 rollback shared album changed early for %',
            applied.source_entry_key;
        end if;
      elsif v_changed <> 1 then
          raise exception 'batch-3 rollback album delete failed for %',
            applied.source_entry_key;
      end if;

      update public.canonical_recordings c
      set musicbrainz_recording_id =
            v_before_placeholder->>'musicbrainz_recording_id',
          origin_key = v_before_placeholder->>'origin_key',
          source_metadata =
            v_before_placeholder->'source_metadata',
          updated_at =
            (v_before_placeholder->>'updated_at')::timestamptz
      where c.id = applied.target_canonical_song_id
        and to_jsonb(c) =
          applied.after_state->'target_canonical';

      get diagnostics v_changed = row_count;
      if v_changed <> 1 then
        raise exception 'batch-3 rollback canonical restore failed for %',
          applied.source_entry_key;
      end if;
    end if;

    select to_jsonb(q), to_jsonb(c)
    into v_after_chart, v_after_placeholder
    from public.quick_rate_collection_tracks q
    join public.canonical_recordings c
      on c.id = applied.placeholder_canonical_song_id
    where q.id = applied.chart_entry_id;

    if v_after_chart is distinct from v_before_chart
       or v_after_placeholder is distinct from v_before_placeholder then
      raise exception 'batch-3 rollback exact restore failed for %',
        applied.source_entry_key;
    end if;

    if applied.action = 'link_existing' then
      select to_jsonb(s), to_jsonb(a)
      into v_after_target_song, v_after_target_album
      from public.songs s
      join public.albums a on a.id = s.album_id
      where s.id = applied.target_song_id
        and a.id = applied.target_album_id;
    else
      v_after_target_song := null;
      v_after_target_album := null;
    end if;

    insert into private.historical_chart_reconciliation_operation_audit (
      operation_key,
      event_kind,
      manifest_sha256,
      chart_entry_id,
      source_entry_key,
      action,
      placeholder_canonical_song_id,
      target_canonical_song_id,
      target_song_id,
      target_album_id,
      musicbrainz_recording_id,
      musicbrainz_release_id,
      musicbrainz_release_group_id,
      evidence_sha256,
      before_state,
      after_state
    ) values (
      applied.operation_key,
      'rollback',
      applied.manifest_sha256,
      applied.chart_entry_id,
      applied.source_entry_key,
      applied.action,
      applied.placeholder_canonical_song_id,
      applied.target_canonical_song_id,
      applied.target_song_id,
      applied.target_album_id,
      applied.musicbrainz_recording_id,
      applied.musicbrainz_release_id,
      applied.musicbrainz_release_group_id,
      applied.evidence_sha256,
      applied.after_state,
      jsonb_build_object(
        'chart', v_after_chart,
        'placeholder_canonical', v_after_placeholder,
        'target_song', v_after_target_song,
        'target_album', v_after_target_album
      )
    );

    v_rolled_back := v_rolled_back + 1;
  end loop;

  if v_rolled_back <> 20 then
    raise exception 'expected exactly 20 batch-3 rollback rows, restored %',
      v_rolled_back;
  end if;
end
$rollback_batch$;

do $postconditions$
declare
  v_total bigint;
  v_resolved bigint;
  v_unresolved bigint;
begin
  if (select count(*) from public.albums) <> 1750
     or (select count(*) from public.songs) <> 16181
     or (select count(*) from public.canonical_recordings) <> 17095 then
    raise exception 'batch-3 rollback catalogue delta failed';
  end if;

  select
    count(*),
    count(*) filter (where song_id is not null),
    count(*) filter (where song_id is null and match_status = 'unresolved')
  into v_total, v_resolved, v_unresolved
  from public.quick_rate_collection_tracks
  where collection_key = 'uk-number-ones';

  if v_total <> 1298 or v_resolved <> 439 or v_unresolved <> 859
     or v_total <> v_resolved + v_unresolved then
    raise exception 'batch-3 rollback chart delta failed';
  end if;

  if exists (
    (
      select *
      from pg_temp.uk_number_ones_batch_3_rollback_song_ratings_before
      except
      select * from public.song_ratings
    )
    union all
    (
      select * from public.song_ratings
      except
      select *
      from pg_temp.uk_number_ones_batch_3_rollback_song_ratings_before
    )
  ) then
    raise exception 'song ratings changed during batch-3 rollback';
  end if;

  if exists (
    (
      select *
      from pg_temp.uk_number_ones_batch_3_rollback_historical_ratings_before
      except
      select * from public.historical_chart_entry_ratings
    )
    union all
    (
      select * from public.historical_chart_entry_ratings
      except
      select *
      from pg_temp.uk_number_ones_batch_3_rollback_historical_ratings_before
    )
  ) then
    raise exception 'historical ratings changed during batch-3 rollback';
  end if;

  if exists (
    (
      select *
      from pg_temp.uk_number_ones_batch_3_rollback_first_batch_audit_before
      except
      select *
      from private.historical_chart_rating_reconciliation_audit
    )
    union all
    (
      select *
      from private.historical_chart_rating_reconciliation_audit
      except
      select *
      from pg_temp.uk_number_ones_batch_3_rollback_first_batch_audit_before
    )
  ) then
    raise exception 'first-batch rating audit changed during rollback';
  end if;

  if (select count(*)
      from private.historical_chart_reconciliation_operation_audit
      where operation_key =
        '20261124_uk_number_ones_verified_batch_3'
        and event_kind = 'apply') <> 20
     or (select count(*)
         from private.historical_chart_reconciliation_operation_audit
         where operation_key =
           '20261124_uk_number_ones_verified_batch_3'
           and event_kind = 'rollback') <> 20 then
    raise exception 'batch-3 rollback evidence is incomplete';
  end if;

  if exists (
    select 1
    from (
      select lower(musicbrainz_recording_id)
      from public.canonical_recordings
      where musicbrainz_recording_id is not null
      group by lower(musicbrainz_recording_id)
      having count(*) > 1
    ) duplicate_recording
  ) then
    raise exception 'batch-3 rollback left duplicate canonical MBIDs';
  end if;
end
$postconditions$;

commit;
