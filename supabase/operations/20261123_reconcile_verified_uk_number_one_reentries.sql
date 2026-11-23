begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- Approval-gated catalogue operation for repeat chart entries whose identities were already
-- verified and imported by the approved historical catalogue process in an
-- earlier chart year. Reuse those exact identities; do not infer a recording
-- from title/artist text alone and do not replace a rated placeholder.
-- Executed once in production on 2026-11-23; retained as the audit artifact.
-- Its exact unresolved-row preconditions intentionally reject any rerun.
do $repair$
declare
  v record;
  v_chart_id bigint;
  v_placeholder_canonical_id uuid;
  v_target_song_id bigint;
  v_target_canonical_id uuid;
  v_target_recording_id text;
  v_updated integer;
  v_total_updated integer := 0;
begin
  for v in
    select *
    from (values
      (
        '2018:re-2018-7-19:baddiel skinner and the lightning seeds:three lions'::text,
        2018::integer,
        'Three Lions'::text,
        'Baddiel, Skinner and The Lightning Seeds'::text,
        '1996:740:baddiel skinner and the lightning seeds:three lions'::text,
        '9f03bee4-0c72-409b-9575-09a2f9c2fa7e'::text
      ),
      (
        '2025:re-2025-01-09:gracie abrams:that s so true'::text,
        2025::integer,
        'That''s So True'::text,
        'Gracie Abrams'::text,
        '2024:1433:gracie abrams:that s so true'::text,
        'a6ff57e9-5ba8-4a32-8ac3-e5e8c42796dc'::text
      )
    ) as candidate(
      source_entry_key,
      chart_year,
      title,
      artist,
      verified_source_entry_key,
      recording_id
    )
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('bom-historical-repeat:' || v.source_entry_key, 0)
    );

    select q.id, q.canonical_song_id
      into v_chart_id, v_placeholder_canonical_id
    from public.quick_rate_collection_tracks q
    where q.collection_key = 'uk-number-ones'
      and q.source_entry_key = v.source_entry_key
      and q.chart_year = v.chart_year
      and q.title = v.title
      and q.artist = v.artist
      and q.song_id is null
      and q.musicbrainz_recording_id is null
      and q.match_status = 'unresolved'
      and q.canonical_song_id is not null
    for update;

    if not found then
      raise exception 'chart precondition failed for %', v.source_entry_key;
    end if;

    perform 1
    from public.canonical_recordings c
    where c.id = v_placeholder_canonical_id
      and c.title = v.title
      and c.artist = v.artist
      and c.musicbrainz_recording_id is null
    for update;

    if not found then
      raise exception 'placeholder identity failed for %', v.source_entry_key;
    end if;

    if exists (
      select 1 from public.song_ratings r
      where r.canonical_song_id = v_placeholder_canonical_id
    ) or exists (
      select 1 from public.songs s
      where s.canonical_song_id = v_placeholder_canonical_id
    ) or exists (
      select 1 from public.historical_chart_entry_ratings r
      where r.chart_entry_id = v_chart_id
    ) then
      raise exception 'rated or non-empty placeholder for %', v.source_entry_key;
    end if;

    select source_q.song_id, source_q.canonical_song_id,
           lower(source_q.musicbrainz_recording_id)
      into v_target_song_id, v_target_canonical_id, v_target_recording_id
    from public.quick_rate_collection_tracks source_q
    join public.songs s
      on s.id = source_q.song_id
     and s.canonical_song_id = source_q.canonical_song_id
     and s.is_deleted is not true
     and s.external_source = 'musicbrainz'
     and lower(s.external_id) = lower(v.recording_id)
    join public.canonical_recordings c
      on c.id = source_q.canonical_song_id
     and lower(c.musicbrainz_recording_id) = lower(v.recording_id)
    where source_q.collection_key = 'uk-number-ones'
      and source_q.source_entry_key = v.verified_source_entry_key
      and source_q.title = v.title
      and source_q.artist = v.artist
      and source_q.match_status = 'direct_mbid'
      and source_q.match_method = 'bulk_verified_release'
      and lower(source_q.musicbrainz_recording_id) = lower(v.recording_id)
    for update of source_q, s, c;

    if not found
       or v_target_song_id is null
       or v_target_canonical_id is null
       or v_target_recording_id <> lower(v.recording_id) then
      raise exception 'approved recording identity failed for %', v.source_entry_key;
    end if;

    update public.quick_rate_collection_tracks q
    set song_id = v_target_song_id,
        canonical_song_id = v_target_canonical_id,
        musicbrainz_recording_id = v_target_recording_id,
        match_status = 'direct_mbid',
        match_method = 'bulk_verified_repeat',
        match_notes = 'Verified repeat chart entry reusing an approved MusicBrainz recording',
        updated_at = timezone('utc', now())
    where q.id = v_chart_id
      and q.song_id is null
      and q.canonical_song_id = v_placeholder_canonical_id
      and q.match_status = 'unresolved';

    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'exact chart update count failed for %', v.source_entry_key;
    end if;
    v_total_updated := v_total_updated + v_updated;
  end loop;

  if v_total_updated <> 2 then
    raise exception 'expected exactly 2 verified repeat repairs, updated %', v_total_updated;
  end if;
end
$repair$;

commit;
