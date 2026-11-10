\set ON_ERROR_STOP on
\if :{?BOND_IMPORT_APPROVED}
\else
  \echo 'Refusing to run: pass -v BOND_IMPORT_APPROVED=true after final approval.'
  \quit
\endif
\if :BOND_IMPORT_APPROVED
\else
  \echo 'Refusing to run: BOND_IMPORT_APPROVED must be true.'
  \quit
\endif
\if :{?BOND_IMPORT_COMMIT}
\else
  \echo 'Refusing to run: pass -v BOND_IMPORT_COMMIT=false for dry-run or true for an approved commit.'
  \quit
\endif

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtextextended('bond-theme-enrichment-20261110-v1', 0));

create temp table bond_expected as
select * from jsonb_to_recordset($bond_tracks$[{"position":1,"title":"The James Bond Theme","artist":"The John Barry Orchestra","musicbrainz_recording_id":"9afed0a7-66be-43a4-bbe3-862e71b9fa21","duration_ms":107160},{"position":2,"title":"From Russia With Love","artist":"Matt Monro","musicbrainz_recording_id":"8f0332a0-1513-4261-8974-1c7733bc5b5f","duration_ms":152400},{"position":3,"title":"Goldfinger","artist":"Shirley Bassey","musicbrainz_recording_id":"9cff2598-a24f-444a-bf28-9d4c9ac21481","duration_ms":167773},{"position":4,"title":"Thunderball","artist":"Tom Jones","musicbrainz_recording_id":"00b1b8cd-5977-4f3f-92e8-9a817b77aed7","duration_ms":181800},{"position":5,"title":"You Only Live Twice","artist":"Nancy Sinatra","musicbrainz_recording_id":"79f67c46-6aa0-4a9b-ae81-676884400c59","duration_ms":164786},{"position":6,"title":"On Her Majesty’s Secret Service","artist":"The John Barry Orchestra","musicbrainz_recording_id":"c1a6563e-2a02-4573-a2cf-d8dd1da99b9d","duration_ms":154480},{"position":7,"title":"We Have All the Time in the World","artist":"Louis Armstrong","musicbrainz_recording_id":"56442481-6d86-40fb-aad8-a4e56ce73730","duration_ms":192866},{"position":8,"title":"Diamonds Are Forever","artist":"Shirley Bassey","musicbrainz_recording_id":"5b85db52-5955-4f46-9114-b34caac195f9","duration_ms":160493},{"position":9,"title":"Live and Let Die","artist":"Paul McCartney & Wings","musicbrainz_recording_id":"ad23e670-2655-4ac6-8e56-8f09a3e0e80c","duration_ms":192146},{"position":10,"title":"The Man With the Golden Gun","artist":"Lulu","musicbrainz_recording_id":"e49ae934-67b3-4a66-b88e-8d715191d567","duration_ms":153666},{"position":11,"title":"Nobody Does It Better","artist":"Carly Simon","musicbrainz_recording_id":"b076d9a2-976d-476e-8f0c-c77137d7d732","duration_ms":208440},{"position":12,"title":"Moonraker","artist":"Shirley Bassey","musicbrainz_recording_id":"82fd14b3-c549-4ff2-aaa5-14116e748efc","duration_ms":187746},{"position":13,"title":"For Your Eyes Only","artist":"Sheena Easton","musicbrainz_recording_id":"4f183f4a-10c4-458d-80b3-fd1fe84554c4","duration_ms":183626},{"position":14,"title":"All Time High","artist":"Rita Coolidge","musicbrainz_recording_id":"42711b74-918c-4cc4-962c-34ac956d3c92","duration_ms":182080},{"position":15,"title":"A View to a Kill","artist":"Duran Duran","musicbrainz_recording_id":"00ab36eb-5a93-41c4-a8b2-914809ac5c56","duration_ms":214840},{"position":16,"title":"The Living Daylights","artist":"a‐ha","musicbrainz_recording_id":"ff77d291-677a-4b78-a2ed-0af78d3cf6a9","duration_ms":253573},{"position":17,"title":"Licence to Kill","artist":"Gladys Knight","musicbrainz_recording_id":"a5771849-e5a6-4760-89ec-499de5079d2f","duration_ms":250146},{"position":18,"title":"GoldenEye","artist":"Tina Turner","musicbrainz_recording_id":"d2f5e50f-3f78-4850-a86d-7f4c42860f1e","duration_ms":208426},{"position":19,"title":"Tomorrow Never Dies","artist":"Sheryl Crow","musicbrainz_recording_id":"73cfbc93-8ab1-4f1b-9257-deb59477dfa8","duration_ms":291920},{"position":20,"title":"The World Is Not Enough","artist":"Garbage","musicbrainz_recording_id":"2e6ec1ef-bd10-4c3f-a9c3-4380492353ba","duration_ms":236960},{"position":21,"title":"Die Another Day","artist":"Madonna","musicbrainz_recording_id":"d230da6f-104d-4299-94b2-ced5b38dbad6","duration_ms":276573},{"position":22,"title":"You Know My Name","artist":"Chris Cornell","musicbrainz_recording_id":"609737d4-a062-4752-a38d-20576924fa56","duration_ms":240706},{"position":23,"title":"Another Way to Die","artist":"Jack White & Alicia Keys","musicbrainz_recording_id":"80366c3d-8edd-4a97-95cf-6bc591d1465f","duration_ms":263693},{"position":24,"title":"Skyfall","artist":"Adele","musicbrainz_recording_id":"d74ce039-fb99-44fb-aa54-43bf707acf46","duration_ms":286253},{"position":25,"title":"Writing’s on the Wall","artist":"Sam Smith","musicbrainz_recording_id":"73d74b29-3b96-438a-a5b4-22e7c3c2f60f","duration_ms":279360},{"position":26,"title":"No Time to Die","artist":"Billie Eilish","musicbrainz_recording_id":"14848e6d-61fa-49f2-9e22-883e285a3a76","duration_ms":242546}]$bond_tracks$::jsonb)
  as t(position integer, title text, artist text, musicbrainz_recording_id text, duration_ms integer);

do $preflight$
declare
  v_existing integer;
  v_album_id bigint;
begin
  if (select count(*) from bond_expected) <> 26
     or (select count(distinct lower(musicbrainz_recording_id)) from bond_expected) <> 26 then
    raise exception 'Bond payload must contain 26 unique recording identities';
  end if;

  if exists (
    select 1 from public.canonical_recordings c
    join bond_expected e on lower(e.musicbrainz_recording_id) = lower(c.musicbrainz_recording_id)
    group by lower(c.musicbrainz_recording_id) having count(*) > 1
  ) then
    raise exception 'Duplicate canonical MusicBrainz identities already exist';
  end if;

  select count(*) into v_existing
  from public.canonical_recordings c
  join bond_expected e on lower(e.musicbrainz_recording_id) = lower(c.musicbrainz_recording_id);
  if v_existing not in (3, 26) then
    raise exception 'Expected either 3 pre-import or 26 post-import canonical identities, found %', v_existing;
  end if;

  if not exists (
    select 1 from public.songs s where s.id = 15562 and s.canonical_song_id = 'cb675a5b-924e-4edb-840f-a7983ed3af3f'::uuid
  ) or not exists (
    select 1 from public.songs s where s.id = 19649 and s.canonical_song_id = 'b90ddab4-9971-4bc4-8547-74c9a54bcae9'::uuid
  ) or not exists (
    select 1 from public.songs s where s.id = 19784 and s.canonical_song_id = 'd1740f5c-0472-4c0a-a228-ce1f1cebc4c6'::uuid
  ) then
    raise exception 'One or more protected existing Bond identities changed; aborting';
  end if;

  select a.id into v_album_id from public.albums a
  where lower(coalesce(a.musicbrainz_release_id, '')) = 'fd1723bc-2a32-442e-b56d-c30fe7411ce7'
     or lower(coalesce(a.musicbrainz_release_group_id, '')) = 'd06b41a6-9d62-4ede-9f22-4bf1398ca13d'
  order by a.id limit 1;
  if v_album_id is not null and exists (
    (select s.track_position, lower(s.external_id) from public.songs s where s.album_id = v_album_id and not coalesce(s.is_deleted, false)
     except select e.position, lower(e.musicbrainz_recording_id) from bond_expected e)
    union all
    (select e.position, lower(e.musicbrainz_recording_id) from bond_expected e
     except select s.track_position, lower(s.external_id) from public.songs s where s.album_id = v_album_id and not coalesce(s.is_deleted, false))
  ) then
    raise exception 'A partial or mismatched authoritative Bond album already exists; manual reconciliation required';
  end if;
end $preflight$;

create temp table bond_before as
select
  (select count(*) from public.song_ratings) as rating_count,
  (select count(*) from public.canonical_recordings) as canonical_count,
  (select count(*) from public.songs) as song_count,
  (select jsonb_agg(jsonb_build_object('song_id', s.id, 'canonical_song_id', s.canonical_song_id, 'spotify_track_id', s.spotify_track_id) order by s.id)
   from public.songs s where s.id in (15562, 19649, 19784)) as protected_rows;

select public.admin_add_catalogue_album(
  $bond_album${"title":"The Best of Bond… James Bond","artist":"Various Artists","musicbrainz_release_id":"fd1723bc-2a32-442e-b56d-c30fe7411ce7","musicbrainz_release_group_id":"d06b41a6-9d62-4ede-9f22-4bf1398ca13d","uk_release_date":"2021-10-08","original_release_date":"1992-09-08","canonical_release_date":"2021-10-08","canonical_release_country":"US"}$bond_album$::jsonb,
  $bond_tracks$[{"position":1,"title":"The James Bond Theme","artist":"The John Barry Orchestra","musicbrainz_recording_id":"9afed0a7-66be-43a4-bbe3-862e71b9fa21","duration_ms":107160},{"position":2,"title":"From Russia With Love","artist":"Matt Monro","musicbrainz_recording_id":"8f0332a0-1513-4261-8974-1c7733bc5b5f","duration_ms":152400},{"position":3,"title":"Goldfinger","artist":"Shirley Bassey","musicbrainz_recording_id":"9cff2598-a24f-444a-bf28-9d4c9ac21481","duration_ms":167773},{"position":4,"title":"Thunderball","artist":"Tom Jones","musicbrainz_recording_id":"00b1b8cd-5977-4f3f-92e8-9a817b77aed7","duration_ms":181800},{"position":5,"title":"You Only Live Twice","artist":"Nancy Sinatra","musicbrainz_recording_id":"79f67c46-6aa0-4a9b-ae81-676884400c59","duration_ms":164786},{"position":6,"title":"On Her Majesty’s Secret Service","artist":"The John Barry Orchestra","musicbrainz_recording_id":"c1a6563e-2a02-4573-a2cf-d8dd1da99b9d","duration_ms":154480},{"position":7,"title":"We Have All the Time in the World","artist":"Louis Armstrong","musicbrainz_recording_id":"56442481-6d86-40fb-aad8-a4e56ce73730","duration_ms":192866},{"position":8,"title":"Diamonds Are Forever","artist":"Shirley Bassey","musicbrainz_recording_id":"5b85db52-5955-4f46-9114-b34caac195f9","duration_ms":160493},{"position":9,"title":"Live and Let Die","artist":"Paul McCartney & Wings","musicbrainz_recording_id":"ad23e670-2655-4ac6-8e56-8f09a3e0e80c","duration_ms":192146},{"position":10,"title":"The Man With the Golden Gun","artist":"Lulu","musicbrainz_recording_id":"e49ae934-67b3-4a66-b88e-8d715191d567","duration_ms":153666},{"position":11,"title":"Nobody Does It Better","artist":"Carly Simon","musicbrainz_recording_id":"b076d9a2-976d-476e-8f0c-c77137d7d732","duration_ms":208440},{"position":12,"title":"Moonraker","artist":"Shirley Bassey","musicbrainz_recording_id":"82fd14b3-c549-4ff2-aaa5-14116e748efc","duration_ms":187746},{"position":13,"title":"For Your Eyes Only","artist":"Sheena Easton","musicbrainz_recording_id":"4f183f4a-10c4-458d-80b3-fd1fe84554c4","duration_ms":183626},{"position":14,"title":"All Time High","artist":"Rita Coolidge","musicbrainz_recording_id":"42711b74-918c-4cc4-962c-34ac956d3c92","duration_ms":182080},{"position":15,"title":"A View to a Kill","artist":"Duran Duran","musicbrainz_recording_id":"00ab36eb-5a93-41c4-a8b2-914809ac5c56","duration_ms":214840},{"position":16,"title":"The Living Daylights","artist":"a‐ha","musicbrainz_recording_id":"ff77d291-677a-4b78-a2ed-0af78d3cf6a9","duration_ms":253573},{"position":17,"title":"Licence to Kill","artist":"Gladys Knight","musicbrainz_recording_id":"a5771849-e5a6-4760-89ec-499de5079d2f","duration_ms":250146},{"position":18,"title":"GoldenEye","artist":"Tina Turner","musicbrainz_recording_id":"d2f5e50f-3f78-4850-a86d-7f4c42860f1e","duration_ms":208426},{"position":19,"title":"Tomorrow Never Dies","artist":"Sheryl Crow","musicbrainz_recording_id":"73cfbc93-8ab1-4f1b-9257-deb59477dfa8","duration_ms":291920},{"position":20,"title":"The World Is Not Enough","artist":"Garbage","musicbrainz_recording_id":"2e6ec1ef-bd10-4c3f-a9c3-4380492353ba","duration_ms":236960},{"position":21,"title":"Die Another Day","artist":"Madonna","musicbrainz_recording_id":"d230da6f-104d-4299-94b2-ced5b38dbad6","duration_ms":276573},{"position":22,"title":"You Know My Name","artist":"Chris Cornell","musicbrainz_recording_id":"609737d4-a062-4752-a38d-20576924fa56","duration_ms":240706},{"position":23,"title":"Another Way to Die","artist":"Jack White & Alicia Keys","musicbrainz_recording_id":"80366c3d-8edd-4a97-95cf-6bc591d1465f","duration_ms":263693},{"position":24,"title":"Skyfall","artist":"Adele","musicbrainz_recording_id":"d74ce039-fb99-44fb-aa54-43bf707acf46","duration_ms":286253},{"position":25,"title":"Writing’s on the Wall","artist":"Sam Smith","musicbrainz_recording_id":"73d74b29-3b96-438a-a5b4-22e7c3c2f60f","duration_ms":279360},{"position":26,"title":"No Time to Die","artist":"Billie Eilish","musicbrainz_recording_id":"14848e6d-61fa-49f2-9e22-883e285a3a76","duration_ms":242546}]$bond_tracks$::jsonb
) as import_result;

do $postcheck$
declare
  v_before bond_before%rowtype;
  v_after_protected jsonb;
begin
  select * into v_before from bond_before;
  if (select count(*) from public.song_ratings) <> v_before.rating_count then
    raise exception 'Rating count changed unexpectedly';
  end if;
  select jsonb_agg(jsonb_build_object('song_id', s.id, 'canonical_song_id', s.canonical_song_id, 'spotify_track_id', s.spotify_track_id) order by s.id)
    into v_after_protected from public.songs s where s.id in (15562, 19649, 19784);
  if v_after_protected is distinct from v_before.protected_rows then
    raise exception 'Protected canonical or Spotify data changed unexpectedly';
  end if;
  if (select count(*) from public.canonical_recordings c join bond_expected e on lower(e.musicbrainz_recording_id) = lower(c.musicbrainz_recording_id)) <> 26 then
    raise exception 'Post-import canonical identity count is not 26';
  end if;
end $postcheck$;

select e.position, e.title, e.artist, e.musicbrainz_recording_id,
       c.id as resolved_canonical_recording_id,
       min(s.id) filter (where not coalesce(s.is_deleted, false)) as resolved_catalogue_track_id,
       count(s.id) filter (where not coalesce(s.is_deleted, false)) as active_occurrences
from bond_expected e
join public.canonical_recordings c on lower(c.musicbrainz_recording_id) = lower(e.musicbrainz_recording_id)
left join public.songs s on s.canonical_song_id = c.id
group by e.position, e.title, e.artist, e.musicbrainz_recording_id, c.id
order by e.position;

\if :BOND_IMPORT_COMMIT
  commit;
  \echo 'Bond enrichment committed.'
\else
  rollback;
  \echo 'Bond enrichment dry-run rolled back; production data is unchanged.'
\endif
