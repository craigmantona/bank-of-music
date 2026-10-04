begin;

create or replace function public.admin_convert_definitely_maybe(
  p_execute boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_album public.albums%rowtype;
  v_deleted integer;
begin
  if current_user <> 'service_role' and (
    auth.uid() is null or not exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid() and profile.is_admin is true
    )
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(9140, 6);
  select * into v_album from public.albums where id = 6 for update;
  perform 1 from public.songs where album_id = 6 for update;
  perform 1 from public.song_ratings
    where id in (2,3,4,5,22,139,140,141,143,144,146,147) for update;
  perform 1 from public.ratings where id in (14,60) for update;

  if v_album.id is null
     or v_album.title is distinct from 'Definitely Maybe'
     or v_album.artist is distinct from 'Oasis'
     or coalesce(v_album.is_deleted, false)
     or v_album.external_source is distinct from 'musicbrainz'
     or lower(coalesce(v_album.external_id, '')) is distinct from
       '727e4a55-c407-458e-9dbc-ee6dbe204617'
     or v_album.musicbrainz_release_id is not null
     or v_album.musicbrainz_release_group_id is not null
  then
    raise exception 'Definitely Maybe source album state has changed; conversion aborted'
      using errcode = '23514';
  end if;

  if (select count(*) from public.songs where album_id = 6) <> 24
     or exists (
       with expected(id,title,recording_id,spotify_track_id) as (values
         (3::bigint,'Rock ’n’ Roll Star','66371e8a-2ccb-47bd-bb83-a50f787e2614','17z8eLCkciVamEqXJS6Ri8'),
         (4::bigint,'Shakermaker','9c28c538-3d59-4d0d-89ca-2dfa7812a61c',null),
         (5::bigint,'Live Forever','e69f62d5-98e3-4e3f-afd8-e26039e01ad4','5IfBLN9VPPJOwcKmAZhdXe'),
         (6::bigint,'Up in the Sky','0062a947-8795-4f91-9b9d-4d03a5039713',null),
         (7::bigint,'Columbia','056d8bf5-c566-4407-bb18-9b3cafd8f2f5',null),
         (8::bigint,'Supersonic','fc07707b-327e-45d7-b904-9cb961f949e5',null),
         (9::bigint,'Bring It On Down','a2ec86d1-165c-4af3-9d7f-12154bc0940b',null),
         (10::bigint,'Cigarettes & Alcohol','443854e1-da2e-4393-8ce4-6b8954c85084','3nK2qGHdVAEOuVAmMSWQPW'),
         (11::bigint,'Digsy’s Dinner','7ba38242-6c70-4a9d-81c5-f910a0143d45',null),
         (12::bigint,'Slide Away','22e1a8e4-ee17-4bd3-83b8-100d4d59ce63',null),
         (13::bigint,'Married With Children','500e081a-39a5-4b23-887f-6f184c3ac90a','0oemhAQXaaIHCEARF9JFGg'),
         (14::bigint,'Sad Song','3e793c92-d56a-40d6-affe-9966e905b296',null),
         (15::bigint,'Rock ’n’ Roll Star (Top of the Pops, September 1994)','f13559d5-85f6-4e30-943c-9a89cbfd2bce',null),
         (16::bigint,'Shakermaker (Naked City, June 1994)','9c226e2b-bbb5-4d65-8706-e85dffe1e0f5',null),
         (17::bigint,'Live Forever (Glastonbury, June 1994)','26650b5a-0a22-4f47-861c-d8424538913d',null),
         (18::bigint,'Up in the Sky (Chicago Metro, October 1994)','486262d0-fb44-4c55-9ac1-e0e6a9423781',null),
         (19::bigint,'Columbia (Hammersmith Palais, December 1994)','00f8a47b-7866-4336-b353-52215251343a',null),
         (20::bigint,'Supersonic (The Word, March 1994)','fb030469-3c2f-4204-a1c5-8c97abbf7118',null),
         (21::bigint,'Bring It On Down (Gleneagles, February 1994)','6dac9017-17ad-45c9-97de-efe31951a8c7',null),
         (22::bigint,'Cigarettes & Alcohol (Southampton Guildhall, November 1994)','eaceb5f1-eb1a-47ac-b1c0-37e3244e1db8',null),
         (23::bigint,'Digsy’s Dinner (Buckley Tivoli, August 1994)','c163aa96-1e39-48f6-a65d-84c1e80500c4',null),
         (24::bigint,'Slide Away (New York Wetlands, July 1994)','c57c9ee0-7d92-4813-901c-72df2de31b9b',null),
         (25::bigint,'Married With Children (Los Angeles Whiskey a Go Go, September 1994)','5e8e6ba9-6dc5-4e33-bb09-3452a7b77106',null),
         (26::bigint,'Sad Song (Later with Jools Holland, December 1994)','77491194-9aa2-44c1-a531-30ec86ac2ba0',null)
       )
       select 1 from expected e left join public.songs s on s.id = e.id
       where s.id is null or s.album_id is distinct from 6::bigint
          or s.title is distinct from e.title or s.artist is distinct from 'Oasis'
          or coalesce(s.is_deleted, false) or s.track_position is not null
          or s.external_source is distinct from 'musicbrainz'
          or lower(coalesce(s.external_id, '')) is distinct from e.recording_id
          or s.spotify_track_id is distinct from e.spotify_track_id
     )
  then
    raise exception 'Definitely Maybe source tracks have changed; conversion aborted'
      using errcode = '23514';
  end if;

  if (select count(*) from public.song_ratings sr join public.songs s on s.id=sr.song_id where s.album_id=6) <> 12
     or exists (
       with expected(id,song_id,rating) as (values
         (5::bigint,3::bigint,9::numeric),(22,4,8),(2,5,10),(139,6,8),
         (140,7,8),(3,8,9),(141,9,7),(4,10,9),(143,11,8),
         (144,12,8),(146,13,9),(147,14,9)
       )
       select 1 from expected e left join public.song_ratings r on r.id=e.id
       where r.id is null or r.song_id is distinct from e.song_id
          or r.user_id is distinct from '076d961e-c330-4cf7-a820-e0b45a8b8cd0'::uuid
          or r.rating is distinct from e.rating
     )
     or (select count(*) from public.ratings where album_id=6) <> 2
     or not exists (select 1 from public.ratings where id=14 and album_id=6
       and user_id='076d961e-c330-4cf7-a820-e0b45a8b8cd0'::uuid and rating=10)
     or not exists (select 1 from public.ratings where id=60 and album_id=6
       and user_id='a9824c00-1aa0-4bd1-96d4-0c71f84ec5ca'::uuid and rating=5)
     or exists (select 1 from public.album_reviews where album_id=6)
     or exists (select 1 from public.album_review_comments c join public.album_reviews r on r.id=c.review_id where r.album_id=6)
     or exists (select 1 from public.album_review_likes l join public.album_reviews r on r.id=l.review_id where r.album_id=6)
  then
    raise exception 'Definitely Maybe user data has changed; conversion aborted'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.albums a where a.id <> 6 and not coalesce(a.is_deleted,false)
      and (lower(coalesce(a.musicbrainz_release_group_id,''))='451dca98-c118-32e1-9244-c47ca9c3c0f9'
        or lower(coalesce(a.musicbrainz_release_id,''))='feeedf8d-7bff-43eb-b8d5-c3ac75612f53'
        or (a.external_source='musicbrainz' and lower(coalesce(a.external_id,''))='feeedf8d-7bff-43eb-b8d5-c3ac75612f53'))
  ) or exists (
    select 1 from public.catalogue_release_group_exclusions
    where lower(musicbrainz_release_group_id)='451dca98-c118-32e1-9244-c47ca9c3c0f9'
  ) then
    raise exception 'Definitely Maybe canonical destination conflicts; conversion aborted'
      using errcode = '23514';
  end if;

  if not p_execute then
    return jsonb_build_object('status','preview','album_id',6,'source_track_count',24,
      'target_track_count',12,'album_rating_deletions',2,'song_rating_deletions',12);
  end if;

  delete from public.song_ratings where id in (2,3,4,5,22,139,140,141,143,144,146,147);
  get diagnostics v_deleted = row_count;
  if v_deleted <> 12 then raise exception 'Expected song ratings were not deleted'; end if;

  delete from public.ratings where id in (14,60) and album_id=6;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 2 then raise exception 'Expected album ratings were not deleted'; end if;

  delete from public.songs where album_id=6 and id between 3 and 26;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 24 then raise exception 'Expected DVD tracks were not deleted'; end if;

  update public.albums set
    external_source='musicbrainz', external_id='feeedf8d-7bff-43eb-b8d5-c3ac75612f53',
    musicbrainz_release_id='feeedf8d-7bff-43eb-b8d5-c3ac75612f53',
    musicbrainz_release_group_id='451dca98-c118-32e1-9244-c47ca9c3c0f9',
    release_date='1994-08-30', original_release_date='1994-08-30',
    canonical_release_date='1994-08-30', canonical_release_country='GB',
    catalogue_selection_version=1
  where id=6;

  insert into public.songs(title,artist,album_id,track_position,external_source,external_id,is_deleted)
  values
    ('Rock ’n’ Roll Star','Oasis',6,1,'musicbrainz','25952523-6d7d-4c26-bf1f-52111006a6a5',false),
    ('Shakermaker','Oasis',6,2,'musicbrainz','bcb2841c-a2ef-43d6-89ef-d636ea0eee48',false),
    ('Live Forever','Oasis',6,3,'musicbrainz','43cf19be-cdcf-48a9-beea-4d0b56887317',false),
    ('Up in the Sky','Oasis',6,4,'musicbrainz','87e571cc-29d3-48b5-9746-3b74ae082680',false),
    ('Columbia','Oasis',6,5,'musicbrainz','691e5a27-878d-4bc1-941a-111142c48094',false),
    ('Sad Song','Oasis',6,6,'musicbrainz','7bdf247f-2582-4339-8c97-55bd18fea1b9',false),
    ('Supersonic','Oasis',6,7,'musicbrainz','901e8dd7-3859-4243-a999-c7bc359c9984',false),
    ('Bring It On Down','Oasis',6,8,'musicbrainz','96986d93-6822-4e30-b743-2d693f9f8297',false),
    ('Cigarettes & Alcohol','Oasis',6,9,'musicbrainz','068b3632-4b4c-4e0a-a18c-a2a3cb8c940e',false),
    ('Digsy’s Dinner','Oasis',6,10,'musicbrainz','d4925377-59e3-45d0-ba95-73378bde72eb',false),
    ('Slide Away','Oasis',6,11,'musicbrainz','24564eb6-fc94-491b-87a2-a2349dfa05db',false),
    ('Married With Children','Oasis',6,12,'musicbrainz','840ee517-3bf8-4816-b825-40b17a88b382',false);

  if (select count(*) from public.songs where album_id=6) <> 12
     or exists (select 1 from public.songs where album_id=6 and spotify_track_id is not null)
     or exists (select 1 from public.songs where album_id=6 and external_id in (
       '66371e8a-2ccb-47bd-bb83-a50f787e2614','9c28c538-3d59-4d0d-89ca-2dfa7812a61c',
       'e69f62d5-98e3-4e3f-afd8-e26039e01ad4','3e793c92-d56a-40d6-affe-9966e905b296'))
     or exists (select 1 from public.ratings where album_id=6)
     or exists (select 1 from public.song_ratings sr join public.songs s on s.id=sr.song_id where s.album_id=6)
     or exists (select 1 from public.catalogue_release_group_exclusions where musicbrainz_release_group_id='451dca98-c118-32e1-9244-c47ca9c3c0f9')
  then
    raise exception 'Definitely Maybe conversion verification failed';
  end if;

  return jsonb_build_object('status','converted','album_id',6,'source_track_count',24,
    'target_track_count',12,'album_rating_deletions',2,'song_rating_deletions',12,
    'sad_song_recording_id','7bdf247f-2582-4339-8c97-55bd18fea1b9');
end;
$$;

revoke all on function public.admin_convert_definitely_maybe(boolean) from public, anon;
grant execute on function public.admin_convert_definitely_maybe(boolean) to authenticated, service_role;

commit;
