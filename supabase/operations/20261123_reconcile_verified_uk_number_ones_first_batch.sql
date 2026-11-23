begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- Approval-gated first batch of manually verified UK No. 1 identities.
-- This operation is deliberately one-shot. Exact unresolved-state, catalogue,
-- release, recording, rating and row-count guards make a rerun fail closed.
-- Source rating rows are retained unchanged as rollback evidence.
select pg_advisory_xact_lock(
  hashtextextended(
    'bom-admin-catalogue:1f428f20-2d3b-4535-a11d-85d28aa37203',
    0
  )
);

-- Match the catalogue importer's advisory-lock order, then prevent catalogue
-- identities or chart rows from racing the negative duplicate checks below.
lock table public.quick_rate_collection_tracks in exclusive mode;
lock table public.albums in share row exclusive mode;
lock table public.canonical_recordings in share row exclusive mode;
lock table public.songs in share row exclusive mode;
lock table public.song_ratings in share row exclusive mode;
lock table public.historical_chart_entry_ratings in share row exclusive mode;
lock table private.historical_chart_rating_reconciliation_audit in share row exclusive mode;

create temporary table uk_number_ones_first_batch_song_ratings_before
on commit drop
as select * from public.song_ratings;

create temporary table uk_number_ones_first_batch_historical_ratings_before
on commit drop
as select * from public.historical_chart_entry_ratings;

do $batch$
declare
  v_operation_key constant text := '20261123_uk_number_ones_first_batch';
  v record;
  v_source record;
  v_placeholder_canonical_id uuid;
  v_target_song_id bigint;
  v_new_album_id bigint;
  v_new_song_id bigint;
  v_target_rating_count integer;
  v_target_distinct_ratings integer;
  v_target_rating numeric;
  v_target_rating_id bigint;
  v_target_song_count integer;
  v_target_canonical_count integer;
  v_target_album_count integer;
  v_placeholder_chart_reference_count integer;
  v_updated integer;
  v_total_links integer := 0;
  v_albums_before bigint;
  v_songs_before bigint;
  v_canonicals_before bigint;
  v_ratings_before bigint;
  v_rating_sum_before numeric;
  v_copied_count bigint;
  v_copied_sum numeric;
  v_new_rating_count bigint;
  v_new_rating_sum numeric;
begin
  if exists (
    select 1
    from private.historical_chart_rating_reconciliation_audit a
    where a.operation_key = v_operation_key
  ) then
    raise exception 'first-batch audit rows already exist';
  end if;

  select count(*) into v_albums_before from public.albums;
  select count(*) into v_songs_before from public.songs;
  select count(*) into v_canonicals_before from public.canonical_recordings;
  select count(*), coalesce(sum(rating), 0)
    into v_ratings_before, v_rating_sum_before
  from public.song_ratings;

  for v in
    select *
    from (values
      (
        'import_verified'::text,
        2498::bigint,
        2025::integer,
        'Messy'::text,
        'Lola Young'::text,
        'Messy'::text,
        'Lola Young'::text,
        5::integer,
        284066::integer,
        '2025:1434:lola young:messy'::text,
        '5aff2430-94b5-41be-9775-c228e67b2afb'::uuid,
        null::bigint,
        '5aff2430-94b5-41be-9775-c228e67b2afb'::uuid,
        '0ae5ee0e-084e-458b-87ba-76cef24cfff3'::text,
        null::bigint,
        '48351084-aeb6-4a12-a8e7-eb166df6f47f'::text,
        '1f428f20-2d3b-4535-a11d-85d28aa37203'::text
      ),
      (
        'link_existing'::text,
        2456::bigint,
        2021::integer,
        'Sweet Melody'::text,
        'Little Mix'::text,
        'Sweet Melody'::text,
        'Little Mix'::text,
        3::integer,
        213693::integer,
        '2021:1382:little mix:sweet melody'::text,
        '832ec4da-357a-4d99-94c0-a28b904a3b86'::uuid,
        20308::bigint,
        'a98ca8b6-da4d-462d-ac3f-2e08da73f93b'::uuid,
        'ece5f285-c5c4-4080-a28d-70409fb802fe'::text,
        1875::bigint,
        '3907c437-a144-433b-aff7-b172d45a2f3c'::text,
        '1a06adad-a1f9-4c1f-8a99-8ad2ea5be289'::text
      ),
      (
        'link_existing'::text,
        1975::bigint,
        2015::integer,
        'Marvin Gaye'::text,
        'Charlie Puth featuring Meghan Trainor'::text,
        'Marvin Gaye'::text,
        'Charlie PuthMeghan Trainor'::text,
        3::integer,
        190453::integer,
        '2015:1298:charlie puth meghan trainor:marvin gaye'::text,
        '8387dca0-8cb2-40d2-a72b-ddf0c3da66d5'::uuid,
        19302::bigint,
        '694b6994-1780-4f45-bca5-e29e5b62c289'::uuid,
        'b6ce4adc-5aa2-41d1-8e60-5e4c5bdff371'::text,
        1486::bigint,
        '6091a9cd-a772-47b9-8082-727facacc97b'::text,
        '3c82ff29-b9f1-4348-b20e-11d24d295845'::text
      ),
      (
        'link_existing'::text,
        486::bigint,
        1986::integer,
        'Papa Don''t Preach'::text,
        'Madonna'::text,
        'Papa Don’t Preach'::text,
        'Madonna'::text,
        1::integer,
        269000::integer,
        '1986:573:madonna:papa don t preach'::text,
        'a4a08d9e-2a24-4afb-adee-a2d196141b5b'::uuid,
        20169::bigint,
        '2a602676-3db2-44c2-9446-d2068410953c'::uuid,
        'cc63a878-8663-41ea-884e-873625b6af68'::text,
        1570::bigint,
        '63180ccf-ac86-40ab-bcef-40b3df8dc385'::text,
        'eb9c3e50-cfa9-3502-af63-41d39c4c3fa6'::text
      )
    ) as candidate(
      action,
      chart_id,
      chart_year,
      title,
      artist,
      target_title,
      target_artist,
      target_track_position,
      target_duration_ms,
      source_entry_key,
      placeholder_canonical_id,
      target_song_id,
      target_canonical_id,
      recording_id,
      target_album_id,
      release_id,
      release_group_id
    )
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('bom-historical-first-batch:' || v.source_entry_key, 0)
    );
    perform pg_advisory_xact_lock(
      hashtextextended('musicbrainz-recording:' || lower(v.recording_id), 0)
    );

    select q.canonical_song_id
      into v_placeholder_canonical_id
    from public.quick_rate_collection_tracks q
    where q.id = v.chart_id
      and q.collection_key = 'uk-number-ones'
      and q.source_entry_key = v.source_entry_key
      and q.chart_year = v.chart_year
      and q.title = v.title
      and q.artist = v.artist
      and q.match_status = 'unresolved'
      and q.song_id is null
      and q.musicbrainz_recording_id is null
      and q.canonical_song_id = v.placeholder_canonical_id
    for update;

    if not found then
      raise exception 'chart precondition failed for %', v.source_entry_key;
    end if;

    perform 1
    from public.canonical_recordings c
    where c.id = v.placeholder_canonical_id
      and c.title = v.title
      and c.artist = v.artist
      and c.musicbrainz_recording_id is null
      and c.origin_key = 'quick-rate:uk-number-ones:' || v.source_entry_key
    for update;

    if not found then
      raise exception 'placeholder identity failed for %', v.source_entry_key;
    end if;

    select count(*)::integer
      into v_placeholder_chart_reference_count
    from public.quick_rate_collection_tracks q
    where q.canonical_song_id = v.placeholder_canonical_id;

    if v_placeholder_chart_reference_count <> 1 then
      raise exception 'placeholder chart reference count failed for %',
        v.source_entry_key;
    end if;

    if exists (
      select 1 from public.songs s
      where s.canonical_song_id = v.placeholder_canonical_id
    ) then
      raise exception 'placeholder is not empty for %', v.source_entry_key;
    end if;

    if v.action = 'link_existing' then
      select s.id
        into v_target_song_id
      from public.songs s
      join public.canonical_recordings c
        on c.id = s.canonical_song_id
      join public.albums a
        on a.id = s.album_id
      where s.id = v.target_song_id
        and s.title = v.target_title
        and s.artist = v.target_artist
        and s.track_position = v.target_track_position
        and s.duration_ms = v.target_duration_ms
        and s.canonical_song_id = v.target_canonical_id
        and s.is_deleted is not true
        and s.external_source = 'musicbrainz'
        and lower(s.external_id) = lower(v.recording_id)
        and c.id = v.target_canonical_id
        and c.title = v.target_title
        and c.artist = v.target_artist
        and lower(c.musicbrainz_recording_id) = lower(v.recording_id)
        and c.origin_key = 'musicbrainz:' || lower(v.recording_id)
        and a.id = v.target_album_id
        and a.is_deleted is not true
        and a.external_source = 'musicbrainz'
        and lower(a.external_id) = lower(v.release_id)
        and lower(a.musicbrainz_release_id) = lower(v.release_id)
        and lower(a.musicbrainz_release_group_id) = lower(v.release_group_id)
      for update of s, c, a;

      if not found or v_target_song_id <> v.target_song_id then
        raise exception 'target catalogue identity failed for %', v.source_entry_key;
      end if;

      select count(*) into v_target_song_count
      from public.songs s
      where s.external_source = 'musicbrainz'
        and lower(s.external_id) = lower(v.recording_id);

      select count(*) into v_target_canonical_count
      from public.canonical_recordings c
      where lower(c.musicbrainz_recording_id) = lower(v.recording_id);

      select count(*) into v_target_album_count
      from public.albums a
      where lower(coalesce(a.musicbrainz_release_id, '')) = lower(v.release_id)
         or lower(coalesce(a.musicbrainz_release_group_id, '')) = lower(v.release_group_id)
         or (
           a.external_source = 'musicbrainz'
           and lower(coalesce(a.external_id, '')) = lower(v.release_id)
         );

      if v_target_song_count <> 1
         or v_target_canonical_count <> 1
         or v_target_album_count <> 1 then
        raise exception 'duplicate target identity for %', v.source_entry_key;
      end if;
    elsif v.action = 'import_verified' then
      perform pg_advisory_xact_lock(
        hashtextextended('musicbrainz-release:' || lower(v.release_id), 0)
      );
      perform pg_advisory_xact_lock(
        hashtextextended(
          'bom-admin-catalogue:' || lower(v.release_group_id),
          0
        )
      );

      if exists (
        select 1 from public.songs s
        where s.external_source = 'musicbrainz'
          and lower(s.external_id) = lower(v.recording_id)
      ) or exists (
        select 1 from public.canonical_recordings c
        where lower(coalesce(c.musicbrainz_recording_id, '')) = lower(v.recording_id)
           or lower(coalesce(c.origin_key, '')) = 'musicbrainz:' || lower(v.recording_id)
      ) or exists (
        select 1 from public.albums a
        where lower(coalesce(a.musicbrainz_release_id, '')) = lower(v.release_id)
           or lower(coalesce(a.musicbrainz_release_group_id, '')) = lower(v.release_group_id)
           or (
             a.external_source = 'musicbrainz'
             and lower(coalesce(a.external_id, '')) = lower(v.release_id)
           )
      ) then
        raise exception 'partial or duplicate import identity for %', v.source_entry_key;
      end if;

      if exists (
        select 1 from public.canonical_recordings c
        where c.id = v.target_canonical_id
          and lower(coalesce(c.origin_key, '')) = 'musicbrainz:' || lower(v.recording_id)
      ) then
        raise exception 'partial canonical import for %', v.source_entry_key;
      end if;

      v_target_song_id := null;
    else
      raise exception 'unsupported first-batch action %', v.action;
    end if;

    -- Lock and reconcile every source rating before changing the chart identity.
    -- The source union includes ratings attached to the provisional canonical
    -- and ratings attached directly to the immutable chart entry.
    perform 1
    from public.song_ratings r
    where r.canonical_song_id = v.placeholder_canonical_id
    for update;

    perform 1
    from public.historical_chart_entry_ratings r
    where r.chart_entry_id = v.chart_id
    for update;

    for v_source in
      with source_rows as (
        select
          r.user_id,
          r.rating,
          'placeholder_canonical'::text as source_kind
        from public.song_ratings r
        where r.canonical_song_id = v.placeholder_canonical_id
        union all
        select
          r.user_id,
          r.rating,
          'historical_chart_entry'::text as source_kind
        from public.historical_chart_entry_ratings r
        where r.chart_entry_id = v.chart_id
      )
      select
        user_id,
        min(rating) as rating,
        count(distinct rating)::integer as distinct_ratings,
        count(*) filter (where source_kind = 'placeholder_canonical')::integer
          as source_song_rating_rows,
        count(*) filter (where source_kind = 'historical_chart_entry')::integer
          as source_historical_rating_rows,
        array_agg(distinct source_kind order by source_kind) as source_kinds
      from source_rows
      group by user_id
      order by user_id
    loop
      if v_source.distinct_ratings <> 1 then
        raise exception 'differing source ratings for chart % user %',
          v.chart_id, v_source.user_id;
      end if;

      perform 1
      from public.song_ratings r
      where r.user_id = v_source.user_id
        and (
          r.canonical_song_id = v.target_canonical_id
          or (
            r.canonical_song_id is null
            and r.song_id in (
              select s.id
              from public.songs s
              where s.canonical_song_id = v.target_canonical_id
            )
          )
        )
      for update;

      select
        count(*)::integer,
        count(distinct r.rating)::integer,
        min(r.rating),
        min(r.id)
        into
          v_target_rating_count,
          v_target_distinct_ratings,
          v_target_rating,
          v_target_rating_id
      from public.song_ratings r
      where r.user_id = v_source.user_id
        and (
          r.canonical_song_id = v.target_canonical_id
          or (
            r.canonical_song_id is null
            and r.song_id in (
              select s.id
              from public.songs s
              where s.canonical_song_id = v.target_canonical_id
            )
          )
        );

      if v_target_rating_count > 1 or v_target_distinct_ratings > 1 then
        raise exception 'multiple target ratings for chart % user %',
          v.chart_id, v_source.user_id;
      elsif v_target_rating_count = 1 then
        if v_target_rating is distinct from v_source.rating then
          raise exception 'target rating conflict for chart % user %',
            v.chart_id, v_source.user_id;
        end if;

        insert into private.historical_chart_rating_reconciliation_audit (
          operation_key,
          chart_entry_id,
          source_entry_key,
          user_id,
          source_canonical_song_id,
          target_canonical_song_id,
          source_rating,
          source_song_rating_rows,
          source_historical_rating_rows,
          source_kinds,
          reconciliation_status,
          target_song_rating_id
        ) values (
          v_operation_key,
          v.chart_id,
          v.source_entry_key,
          v_source.user_id,
          v.placeholder_canonical_id,
          v.target_canonical_id,
          v_source.rating,
          v_source.source_song_rating_rows,
          v_source.source_historical_rating_rows,
          v_source.source_kinds,
          'already_equal',
          v_target_rating_id
        );
      else
        insert into public.song_ratings (
          user_id,
          song_id,
          canonical_song_id,
          rating,
          created_at
        ) values (
          v_source.user_id,
          null,
          v.target_canonical_id,
          v_source.rating,
          timezone('utc', now())
        )
        returning id into v_target_rating_id;

        insert into private.historical_chart_rating_reconciliation_audit (
          operation_key,
          chart_entry_id,
          source_entry_key,
          user_id,
          source_canonical_song_id,
          target_canonical_song_id,
          source_rating,
          source_song_rating_rows,
          source_historical_rating_rows,
          source_kinds,
          reconciliation_status,
          target_song_rating_id
        ) values (
          v_operation_key,
          v.chart_id,
          v.source_entry_key,
          v_source.user_id,
          v.placeholder_canonical_id,
          v.target_canonical_id,
          v_source.rating,
          v_source.source_song_rating_rows,
          v_source.source_historical_rating_rows,
          v_source.source_kinds,
          'copied',
          v_target_rating_id
        );
      end if;
    end loop;

    if v.action = 'import_verified' then
      insert into public.albums (
        title,
        artist,
        external_source,
        external_id,
        musicbrainz_release_id,
        musicbrainz_release_group_id,
        cover_art_url,
        release_date,
        canonical_release_date,
        canonical_release_country,
        catalogue_selection_version,
        is_deleted
      ) values (
        'This Wasn’t Meant for You Anyway',
        'Lola Young',
        'musicbrainz',
        lower(v.release_id),
        lower(v.release_id),
        lower(v.release_group_id),
        'https://coverartarchive.org/release-group/1f428f20-2d3b-4535-a11d-85d28aa37203/front-500',
        '2024-06-21'::date,
        '2024-06-21'::date,
        'XW',
        1,
        false
      )
      returning id into v_new_album_id;

      update public.canonical_recordings c
      set musicbrainz_recording_id = lower(v.recording_id),
          origin_key = 'musicbrainz:' || lower(v.recording_id),
          source_metadata = coalesce(c.source_metadata, '{}'::jsonb) ||
            jsonb_build_object(
              'historical_reconciliation',
              '20261123_uk_number_ones_first_batch'
            ),
          updated_at = timezone('utc', now())
      where c.id = v.target_canonical_id
        and c.title = v.title
        and c.artist = v.artist
        and c.musicbrainz_recording_id is null
        and c.origin_key = 'quick-rate:uk-number-ones:' || v.source_entry_key;

      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'Messy canonical attachment count failed';
      end if;

      insert into public.songs (
        title,
        artist,
        album_id,
        track_position,
        external_source,
        external_id,
        canonical_song_id,
        duration_ms,
        is_deleted
      ) values (
        v.title,
        v.artist,
        v_new_album_id,
        v.target_track_position,
        'musicbrainz',
        lower(v.recording_id),
        v.target_canonical_id,
        v.target_duration_ms,
        false
      )
      returning id into v_new_song_id;

      v_target_song_id := v_new_song_id;
    end if;

    update public.quick_rate_collection_tracks q
    set song_id = v_target_song_id,
        canonical_song_id = v.target_canonical_id,
        musicbrainz_recording_id = lower(v.recording_id),
        match_status = 'direct_mbid',
        match_method = case
          when v.action = 'link_existing' then 'bulk_unique_existing'
          else 'bulk_verified_release'
        end,
        match_notes = case
          when v.action = 'link_existing'
            then 'First guarded batch: verified exact existing BOM recording'
          else 'First guarded batch: verified official MusicBrainz source release'
        end,
        updated_at = timezone('utc', now())
    where q.id = v.chart_id
      and q.collection_key = 'uk-number-ones'
      and q.source_entry_key = v.source_entry_key
      and q.chart_year = v.chart_year
      and q.title = v.title
      and q.artist = v.artist
      and q.match_status = 'unresolved'
      and q.song_id is null
      and q.musicbrainz_recording_id is null
      and q.canonical_song_id = v.placeholder_canonical_id;

    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'chart exact update count failed for %', v.source_entry_key;
    end if;

    v_total_links := v_total_links + v_updated;
  end loop;

  if v_total_links <> 4 then
    raise exception 'expected exactly 4 chart links, updated %', v_total_links;
  end if;

  if (select count(*) from public.albums) <> v_albums_before + 1 then
    raise exception 'expected exactly 1 album insert';
  end if;
  if (select count(*) from public.songs) <> v_songs_before + 1 then
    raise exception 'expected exactly 1 song insert';
  end if;
  if (select count(*) from public.canonical_recordings) <> v_canonicals_before then
    raise exception 'canonical recording count changed';
  end if;

  -- Every original rating row must still exist byte-for-byte. The operation may
  -- only add authoritative canonical rows represented by copied audit records.
  if exists (
    select 1
    from (
      (select * from pg_temp.uk_number_ones_first_batch_song_ratings_before)
      except
      (select * from public.song_ratings)
    ) missing_original
  ) then
    raise exception 'an original song rating changed or was removed';
  end if;

  if exists (
    select 1
    from (
      (
        (select * from pg_temp.uk_number_ones_first_batch_historical_ratings_before)
        except
        (select * from public.historical_chart_entry_ratings)
      )
      union all
      (
        (select * from public.historical_chart_entry_ratings)
        except
        (select * from pg_temp.uk_number_ones_first_batch_historical_ratings_before)
      )
    ) changed_historical
  ) then
    raise exception 'historical chart rating rows changed';
  end if;

  select count(*), coalesce(sum(a.source_rating), 0)
    into v_copied_count, v_copied_sum
  from private.historical_chart_rating_reconciliation_audit a
  where a.operation_key = v_operation_key
    and a.reconciliation_status = 'copied';

  select count(*), coalesce(sum(r.rating), 0)
    into v_new_rating_count, v_new_rating_sum
  from public.song_ratings r
  left join pg_temp.uk_number_ones_first_batch_song_ratings_before before_row
    on before_row.id = r.id
  where before_row.id is null;

  if v_new_rating_count <> v_copied_count
     or v_new_rating_sum is distinct from v_copied_sum
     or (select count(*) from public.song_ratings) <> v_ratings_before + v_copied_count
     or (select coalesce(sum(rating), 0) from public.song_ratings)
          is distinct from v_rating_sum_before + v_copied_sum then
    raise exception 'copied rating count or sum assertion failed';
  end if;

  if exists (
    select 1
    from public.song_ratings r
    left join pg_temp.uk_number_ones_first_batch_song_ratings_before before_row
      on before_row.id = r.id
    left join private.historical_chart_rating_reconciliation_audit a
      on a.operation_key = v_operation_key
     and a.reconciliation_status = 'copied'
     and a.target_song_rating_id = r.id
     and a.user_id = r.user_id
     and a.target_canonical_song_id = r.canonical_song_id
     and a.source_rating = r.rating
    where before_row.id is null
      and a.id is null
  ) or exists (
    select 1
    from private.historical_chart_rating_reconciliation_audit a
    left join public.song_ratings r
      on r.id = a.target_song_rating_id
    left join pg_temp.uk_number_ones_first_batch_song_ratings_before before_row
      on before_row.id = r.id
    where a.operation_key = v_operation_key
      and a.reconciliation_status = 'copied'
      and (
        r.id is null
        or before_row.id is not null
        or r.user_id is distinct from a.user_id
        or r.canonical_song_id is distinct from a.target_canonical_song_id
        or r.rating is distinct from a.source_rating
      )
  ) then
    raise exception 'copied rating audit mismatch';
  end if;

  if exists (
    select 1
    from private.historical_chart_rating_reconciliation_audit a
    left join pg_temp.uk_number_ones_first_batch_song_ratings_before before_row
      on before_row.id = a.target_song_rating_id
    where a.operation_key = v_operation_key
      and a.reconciliation_status = 'already_equal'
      and (
        before_row.id is null
        or before_row.user_id is distinct from a.user_id
        or before_row.rating is distinct from a.source_rating
        or (
          before_row.canonical_song_id
            is distinct from a.target_canonical_song_id
          and not (
            before_row.canonical_song_id is null
            and exists (
              select 1
              from public.songs s
              where s.id = before_row.song_id
                and s.canonical_song_id = a.target_canonical_song_id
            )
          )
        )
      )
  ) then
    raise exception 'already-equal rating audit mismatch';
  end if;
end
$batch$;

commit;
