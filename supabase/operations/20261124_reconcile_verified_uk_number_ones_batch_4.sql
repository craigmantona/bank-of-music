begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Execution-role contract: run this reviewed operation only as the migration
-- owner/postgres role. The service role intentionally has no UPDATE, DELETE or
-- TRUNCATE privilege needed for the explicit high-strength table locks below.
-- Reviewed batch 4 is inert unless an operator supplies the exact independent
-- approval token at session scope. The operation never sets its own approval.
do $approval$
declare
  v_expected constant text :=
    '20261124_uk_number_ones_verified_batch_4:4d007752747f406a72b2090b4a9362218e7bef3457a30a981247445ea655da83';
begin
  if nullif(current_setting('bom.approved_historical_reconciliation', true), '')
       is distinct from v_expected then
    raise exception 'batch-4 approval token missing or does not match the reviewed manifest';
  end if;
end
$approval$;

create temporary table uk_number_ones_batch_4_manifest
on commit drop
as
select
  candidate.batch_order::integer as batch_order,
  candidate.item->>'action' as action,
  (candidate.item #>> '{chart_entry,id}')::bigint as chart_id,
  (candidate.item #>> '{chart_entry,chart_year}')::integer as chart_year,
  candidate.item #>> '{chart_entry,title}' as title,
  candidate.item #>> '{chart_entry,artist}' as artist,
  candidate.item #>> '{chart_entry,source_entry_key}' as source_entry_key,
  candidate.item #>> '{chart_entry,source_revision}' as source_revision,
  (candidate.item #>> '{chart_entry,placeholder_canonical_id}')::uuid
    as placeholder_canonical_id,
  (candidate.item #>> '{stale_state_fingerprint,chart_updated_at}')::timestamptz
    as chart_updated_at,
  (candidate.item #>> '{stale_state_fingerprint,canonical_updated_at}')::timestamptz
    as canonical_updated_at,
  candidate.item #>> '{stale_state_fingerprint,source_metadata_sha256}'
    as source_metadata_sha256,
  candidate.item #>> '{stale_state_fingerprint,canonical_metadata_sha256}'
    as canonical_metadata_sha256,
  nullif(candidate.item #>> '{target,song_id}', '')::bigint as target_song_id,
  (candidate.item #>> '{target,canonical_id}')::uuid as target_canonical_id,
  nullif(candidate.item #>> '{target,album_id}', '')::bigint as target_album_id,
  candidate.item #>> '{target,stored_title}' as target_title,
  candidate.item #>> '{target,stored_artist}' as target_artist,
  (candidate.item #>> '{target,track_position}')::integer as track_position,
  nullif(candidate.item #>> '{target,duration_ms}', '')::integer as duration_ms,
  candidate.item->>'isrc' as isrc,
  lower(candidate.item->>'recording_id') as recording_id,
  lower(candidate.item->>'release_id') as release_id,
  lower(candidate.item->>'release_group_id') as release_group_id,
  candidate.item->>'album_title' as album_title,
  candidate.item->>'album_artist' as album_artist,
  nullif(candidate.item->>'release_date', '')::date as release_date,
  nullif(candidate.item->>'country', '') as country,
  (candidate.item->>'release_track_count')::integer as release_track_count,
  candidate.item->'risk_notes' as risk_notes,
  candidate.item->>'evidence_sha256' as evidence_sha256,
  verified_manifest.payload::jsonb
    #> '{selection_policy,selected_track_import_chart_entry_ids}'
    as selected_track_import_chart_entry_ids,
  verified_manifest.payload::jsonb
    #>> '{selection_policy,source_release_note}'
    as source_release_note
from (
  select payload
  from (
    select $batch_manifest${"operation_key":"20261124_uk_number_ones_verified_batch_4","snapshot":{"captured_at":"2026-11-24T12:14:07.912562+00:00","candidate_state_artifact":"historical-uk-number-ones-verified-batch-4-live-state-20261124.json","candidate_state_sha256":"9d88f14ba691d5af8b77f5b9c28cadb12fa8b0c6f5b6008a6497cd7a3c3faceb","production_integrity":{"songs":16201,"albums":1769,"song_rating_sum":13454,"song_rating_rows":1747,"total_chart_entries":1298,"canonical_recordings":17095,"historical_rating_sum":43,"historical_rating_rows":5,"resolved_chart_entries":459,"invalid_song_rating_rows":0,"unresolved_chart_entries":839,"duplicate_recording_mbids":0,"prior_operation_audit_rows":40,"first_batch_rating_reconciliation_audit_rows":1}},"audit_coverage":{"inventory_rows_classified":839,"verified_existing_link":2,"verified_catalogue_import":18,"explicit_ambiguous_or_version_conflict":14,"insufficient_authoritative_evidence":805,"reviewed_but_not_selected":32,"remaining_inventory_without_a_complete_evidence_chain":787,"method":"The prior 839-row unresolved inventory and latest verified research report were reused. Only the 20 previously verified exact Official Charts ISRC, MusicBrainz recording and official release-track chains were promoted; no title or artist force matching was used."},"selection_policy":{"batch_size":20,"min_batch_size":20,"max_batch_size":25,"ordering":"previously verified batch order","force_matching_prohibited":true,"all_candidates_unrated":true,"source_release_note":"I'm Good (Blue), I Don't Care, Funky Friday, Don't Be So Hard on Yourself, Not Letting Go, I Don't Care and What About Us use exact tracks on reviewed official multi-track releases; only those selected tracks are imported.","selected_track_import_chart_entry_ids":[2471,2027,2020,1976,1971,1958,1904]},"candidates":[{"action":"import_verified","chart_entry":{"id":2471,"title":"I'm Good (Blue)","artist":"David Guetta and Bebe Rexha","chart_year":2022,"source_revision":"1380580667","source_entry_key":"2022:1402:david guetta and bebe rexha:i m good blue","placeholder_canonical_id":"ff9d71bd-8e31-497f-a6b8-e18b1915c60b"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303+00:00","canonical_updated_at":"2026-10-23T14:53:07.351303+00:00","source_metadata_sha256":"b01c9966588baefacfe810827fabb126946defa2de9a688560ec3a1f2611899d","canonical_metadata_sha256":"bd1ef851098084ee7bfd9a4386f94a96e73bd0c6aa146fd577d3ea710e70aea9"},"target":{"song_id":null,"canonical_id":"ff9d71bd-8e31-497f-a6b8-e18b1915c60b","album_id":null,"stored_title":"I'm Good (Blue)","stored_artist":"David Guetta and Bebe Rexha","track_position":1,"duration_ms":175000},"isrc":"UKWLG2200055","recording_id":"1b884d1d-7a61-4ce8-a5f9-188c671b0a8c","release_id":"7bd6c1eb-0f60-4176-bd4b-afe82b0ca2f2","release_group_id":"a6d4ae2c-99d1-4ff4-872e-adf2cd3fb20a","album_title":"I’m Good (Blue)","album_artist":"David Guetta & Bebe Rexha","release_date":"2022-08-26","country":"XW","release_track_count":2,"evidence_sha256":"465d78ad675cce1358e5cd9750c445712fe58f10a374b734606ca2d361ad3881","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted.","Only the exact original 2022 recording identified by ISRC UKWLG2200055 is approved; remixes, edits and covers must not be substituted."]},{"action":"import_verified","chart_entry":{"id":2457,"title":"Wellerman","artist":"Nathan Evans, 220 Kid and Billen Ted","chart_year":2021,"source_revision":"1380580667","source_entry_key":"2021:1384:nathan evans 220 kid and billen ted:wellerman","placeholder_canonical_id":"18befaf2-5da5-453a-877f-e0c1b1344eb7"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303+00:00","canonical_updated_at":"2026-10-23T14:53:07.351303+00:00","source_metadata_sha256":"071f3a764d17e7030653ae2351eb5c1ebd7befadd980a78f4bdac02ad943a0a6","canonical_metadata_sha256":"92dabc2fcfe5737a5978af0020832854617f7261f878711dd99f481da79e86c7"},"target":{"song_id":null,"canonical_id":"18befaf2-5da5-453a-877f-e0c1b1344eb7","album_id":null,"stored_title":"Wellerman","stored_artist":"Nathan Evans, 220 Kid and Billen Ted","track_position":1,"duration_ms":155333},"isrc":"GBUM72100297","recording_id":"222a7f31-8528-4a25-8b81-9eda131dfce3","release_id":"49d15a4d-6416-44dc-b067-afbb1d6c3eeb","release_group_id":"d0c97374-83de-466d-b4dc-5a70bc5aa545","album_title":"Wellerman (Sea Shanty)","album_artist":"Nathan Evans","release_date":"2021-01-21","country":"XW","release_track_count":1,"evidence_sha256":"c704f8f814a0bb3dd11546cfc4b0b7f1a25827773e98b5c22775a39e51959fe9","risk_notes":["The Official Charts remix credit is broader than MusicBrainz's recording artist credit; exact ISRC GBUM72100297 anchors the approved 220 Kid and Billen Ted chart version."]},{"action":"link_existing","chart_entry":{"id":2440,"title":"Own It","artist":"Stormzy featuring Ed Sheeran and Burna Boy","chart_year":2020,"source_revision":"1380580667","source_entry_key":"2020:1362:stormzy ed sheeran and burna boy:own it","placeholder_canonical_id":"9cd5d426-9235-4ddf-8ac3-1097500fcc3d"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303+00:00","canonical_updated_at":"2026-10-23T14:53:07.351303+00:00","source_metadata_sha256":"ef2e705ac93d8cc1d149423292136a4fd3e7bcddd3e5ca35f04e850ddc6f249e","canonical_metadata_sha256":"23b38a11831d31369069705cf5c9b2d22588a1ee43e9d32f513522d0ff0b104b"},"target":{"song_id":10659,"canonical_id":"9a20a82e-dc30-48ed-8bee-254056b26be4","album_id":785,"stored_title":"Own It","stored_artist":"Stormzy","track_position":11,"duration_ms":null},"isrc":"GBAHS1901369","recording_id":"a4b1cc66-8e3d-47a2-8200-8a9193c033ca","release_id":"c3d1350b-8662-42d6-acce-057ba0e516d0","release_group_id":"691220b3-ae1a-4666-a5b2-e020e3dbf6f8","album_title":"Heavy Is the Head","album_artist":"Stormzy","release_date":"2019-12-13","country":"GB","release_track_count":16,"evidence_sha256":"f58f535eb926a2bcee6fd02bcdfac38c4b94b761746dcd74a23b30a2d8f7f5d4","risk_notes":["The exact existing BOM recording and Heavy Is the Head track are reused; no duplicate recording, canonical identity, song or album may be created."]},{"action":"import_verified","chart_entry":{"id":2027,"title":"I Don't Care","artist":"Ed Sheeran and Justin Bieber","chart_year":2019,"source_revision":"1356457366","source_entry_key":"2019:1355:ed sheeran and justin bieber:i don t care","placeholder_canonical_id":"8bba7253-2132-49e7-8623-01a6e6d2e8a8"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"86fcb9a48e7881e83ca5a88c59f0b0546497b0c41e6225fe4588c2e7b06b2cd4","canonical_metadata_sha256":"a81c0d3f79a54db475868d3ce612b06f67e683e264bb695af1d1ffa2be6acefd"},"target":{"song_id":null,"canonical_id":"8bba7253-2132-49e7-8623-01a6e6d2e8a8","album_id":1937,"stored_title":"I Don't Care","stored_artist":"Ed Sheeran and Justin Bieber","track_position":6,"duration_ms":219947},"isrc":"GBAHS1900673","recording_id":"09fe14ca-7734-4fa0-9365-8159d236d7af","release_id":"466d1739-d323-4128-8e80-a8b147b4e2e5","release_group_id":"852e109b-d04d-4bc2-a4b0-f0d1817480ec","album_title":"No.6 Collaborations Project","album_artist":"Ed Sheeran","release_date":"2019-07-12","country":"GB","release_track_count":15,"evidence_sha256":"bf35b7708aec634d1862a2733a442d054474596674ccbb6129fad659c0816912","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted.","The reviewed No.6 Collaborations Project album already exists in BOM and must be reused exactly; only the verified track is inserted."]},{"action":"import_verified","chart_entry":{"id":2012,"title":"One Kiss","artist":"Calvin Harris and Dua Lipa","chart_year":2018,"source_revision":"1356457366","source_entry_key":"2018:1338:calvin harris and dua lipa:one kiss","placeholder_canonical_id":"17eb7192-e52d-4837-96ff-5fdd8fba877c"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"1932695d10f917d0544e1663405f4d1dd54e836da10518f54deb4b4ef164791e","canonical_metadata_sha256":"0c89db1970c2cdc4c99f2c3d1a6be7a33cf5739854f7549cd399a3445903011d"},"target":{"song_id":null,"canonical_id":"17eb7192-e52d-4837-96ff-5fdd8fba877c","album_id":null,"stored_title":"One Kiss","stored_artist":"Calvin Harris and Dua Lipa","track_position":1,"duration_ms":214847},"isrc":"GBARL1800368","recording_id":"1f215b13-829c-4077-9098-e287d1d87f50","release_id":"c80adc92-c63c-4f3e-8bb8-f9a3992631dc","release_group_id":"83a4bd1f-b5c3-4604-9132-38c1d1d75583","album_title":"One Kiss","album_artist":"Calvin Harris & Dua Lipa","release_date":"2018-04-06","country":"XW","release_track_count":1,"evidence_sha256":"2d543d452d8e574ecc6733179c9899587501ba9910a699542ff8ce2af270ded2","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":2010,"title":"Freaky Friday","artist":"Lil Dicky featuring Chris Brown","chart_year":2018,"source_revision":"1356457366","source_entry_key":"2018:1336:lil dicky chris brown:freaky friday","placeholder_canonical_id":"8a5babf9-0b9e-42da-940e-fceb5bf01fae"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"ff61360f49a5f83641755d448b20b8792ad3b589ee477b7823388602b88da05c","canonical_metadata_sha256":"55cd2fe4d0fe71bbb13555fcc62bf14ae23694f349b054db09763a989e23f623"},"target":{"song_id":null,"canonical_id":"8a5babf9-0b9e-42da-940e-fceb5bf01fae","album_id":null,"stored_title":"Freaky Friday","stored_artist":"Lil Dicky featuring Chris Brown","track_position":1,"duration_ms":217000},"isrc":"QMRSZ1800283","recording_id":"b6292db6-80ae-45ca-a6fd-d16274f1924d","release_id":"4520b84c-e481-4e4d-be23-66d70f3b9e58","release_group_id":"df299403-8408-4a4d-a480-84632e83996f","album_title":"Freaky Friday","album_artist":"Lil Dicky ft. Chris Brown","release_date":"2018-03-15","country":"DZ","release_track_count":1,"evidence_sha256":"e625c8a27c5f58f699e778f1860248ca809751b43e8ef1c0395388fc102af1ae","risk_notes":["MusicBrainz release country DZ is anomalous; identity is anchored by exact Official Charts ISRC QMRSZ1800283 and the unique reviewed recording."]},{"action":"import_verified","chart_entry":{"id":2005,"title":"Havana","artist":"Camila Cabello featuring Young Thug","chart_year":2017,"source_revision":"1356457366","source_entry_key":"2017:1331:camila cabello young thug:havana","placeholder_canonical_id":"174e3794-dec7-4b31-9cf0-d172ec00b2c3"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"dff03231b81c40ea62e42daee4d7ee28313f9d2d1f074440dc24fcdd02175797","canonical_metadata_sha256":"9e7e5ab0e73762a75c78a1610e01104517f235378a69dd3b2833ee637e86bd9e"},"target":{"song_id":null,"canonical_id":"174e3794-dec7-4b31-9cf0-d172ec00b2c3","album_id":null,"stored_title":"Havana","stored_artist":"Camila Cabello featuring Young Thug","track_position":1,"duration_ms":216000},"isrc":"USSM11706905","recording_id":"d782a964-71fe-4adb-af01-cd7769c32ae8","release_id":"24e2beed-3137-4cbd-a755-a39277544b6f","release_group_id":"f6024c95-e01b-41be-abfb-3401a8ae5317","album_title":"Havana","album_artist":"Camila Cabello feat. Young Thug","release_date":"2017-08-05","country":"XE","release_track_count":1,"evidence_sha256":"2e96e379b0ec27ee1da29e78a0ce5b795160e80c78d82176aaa2ae48bb583c31","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":2000,"title":"Wild Thoughts","artist":"DJ Khaled featuring Rihanna and Bryson Tiller","chart_year":2017,"source_revision":"1356457366","source_entry_key":"2017:1325:dj khaled rihanna and bryson tiller:wild thoughts","placeholder_canonical_id":"a3233390-e221-478a-ad48-d54532e56030"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"5c9b23d7c658a60b5c494694c8ea5e2eaa2078c7845e1ab35061e19645297bbd","canonical_metadata_sha256":"13710b6a55582850b3f5e79e5705b9c20f141b5334cc4105077d960816863abf"},"target":{"song_id":null,"canonical_id":"a3233390-e221-478a-ad48-d54532e56030","album_id":null,"stored_title":"Wild Thoughts","stored_artist":"DJ Khaled featuring Rihanna and Bryson Tiller","track_position":1,"duration_ms":205000},"isrc":"USSM11705088","recording_id":"a494c1f9-42e7-4806-a755-d75c8e68b46a","release_id":"f6a9f98a-0ee8-407e-bf0c-2b0f04bb1747","release_group_id":"e1564afe-9605-4951-b2b6-3b6944f4d150","album_title":"Wild Thoughts","album_artist":"DJ Khaled feat. Rihanna & Bryson Tiller","release_date":"2017-06-16","country":"XW","release_track_count":1,"evidence_sha256":"54b69b0bbdc6d68215699afd4fafbbcd423dc54c32ca58c41ff1adb208aa868c","risk_notes":["The exact explicit recording is approved; clean or alternate edits must not be substituted."]},{"action":"import_verified","chart_entry":{"id":2020,"title":"Funky Friday","artist":"Dave featuring Fredo","chart_year":2018,"source_revision":"1356457366","source_entry_key":"2018:1345:dave fredo:funky friday","placeholder_canonical_id":"36bf0807-cef8-4805-bfca-ea7d8e5e3a71"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"b31335a49f40299f2192f8350e0e8e4a3474ba1be9b6ee0e08f22d45256f55e9","canonical_metadata_sha256":"22549d68ac979f75e697149c5e157576b9f161fbb35e2a65d64ceb47787f0823"},"target":{"song_id":null,"canonical_id":"36bf0807-cef8-4805-bfca-ea7d8e5e3a71","album_id":null,"stored_title":"Funky Friday","stored_artist":"Dave featuring Fredo","track_position":18,"duration_ms":182741},"isrc":"GBUM71806264","recording_id":"cca59973-96a0-4615-949f-9539fe816ff2","release_id":"13af491b-bbcb-48fa-ab50-24df2227fe81","release_group_id":"6315c22e-5e26-4476-8324-f497a58376ef","album_title":"Rap Kings, Vol. 7","album_artist":"Various Artists","release_date":"2023-04-15","country":null,"release_track_count":26,"evidence_sha256":"e471cc9a6d825db9ec074baa84dbe50aac29b5314eba668dfc9f1917e6d282f4","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted.","The reviewed official release is a later 26-track compilation because the contemporary single release lacks track-level evidence; exact ISRC GBUM71806264 anchors the approved recording."]},{"action":"import_verified","chart_entry":{"id":2001,"title":"Feels","artist":"Calvin Harris featuring Pharrell Williams, Katy Perry and Big Sean","chart_year":2017,"source_revision":"1356457366","source_entry_key":"2017:1326:calvin harris pharrell williams katy perry and big sean:feels","placeholder_canonical_id":"9d76abc4-8c21-4c05-9ffe-767ed152e530"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"9f6f1c4b0cdaf8239883f9091fa001343a891b8af0a70ab1c7b0d07b4bc7e74d","canonical_metadata_sha256":"b98d8a02b67caa8a3746516809efdb67d107d7c120e911e7d5f6744c89631316"},"target":{"song_id":null,"canonical_id":"9d76abc4-8c21-4c05-9ffe-767ed152e530","album_id":null,"stored_title":"Feels","stored_artist":"Calvin Harris featuring Pharrell Williams, Katy Perry and Big Sean","track_position":1,"duration_ms":223000},"isrc":"GBARL1700772","recording_id":"df933ba2-3377-4ab4-a648-36c7d3fc1679","release_id":"e6688ae8-55b7-424b-b570-4e26ade1d60e","release_group_id":"41902d54-1f05-43f0-8cc7-47c1b0b0e323","album_title":"Feels","album_artist":"Calvin Harris feat. Pharrell Williams, Katy Perry & Big Sean","release_date":"2017-06-16","country":"XW","release_track_count":1,"evidence_sha256":"947d046623d0fde3b40bff1264ab6d0e4e1ea75883b7890da569b2707061e9d2","risk_notes":["The exact explicit recording is approved; clean or alternate edits must not be substituted."]},{"action":"import_verified","chart_entry":{"id":2018,"title":"Eastside","artist":"Benny Blanco, Halsey and Khalid","chart_year":2018,"source_revision":"1356457366","source_entry_key":"2018:1343:benny blanco halsey and khalid:eastside","placeholder_canonical_id":"93431b31-3aef-4728-8fdc-792dc2b85f68"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"e650587fbca919252e47664c99c941cadf4a1bf93ae4ad811152c69c2ad8f7ee","canonical_metadata_sha256":"58e0b047e8ebe4945f6b002d04764d09860630bd654bc6aeb06a194f55472b7b"},"target":{"song_id":null,"canonical_id":"93431b31-3aef-4728-8fdc-792dc2b85f68","album_id":null,"stored_title":"Eastside","stored_artist":"Benny Blanco, Halsey and Khalid","track_position":1,"duration_ms":173799},"isrc":"USUM71809132","recording_id":"787087cb-cb94-442d-98dd-2eddc59f1f84","release_id":"dd66d80f-7f9b-4bec-b850-dded86131861","release_group_id":"7551c31e-8324-473a-9402-6b05e5f88e66","album_title":"Eastside","album_artist":"benny blanco with Halsey & Khalid","release_date":"2018-07-12","country":"XW","release_track_count":1,"evidence_sha256":"a8c693b34c4a84211b5bceea393fb9c924b7240844c16a17d90a37c475642911","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":1998,"title":"Despacito","artist":"Luis Fonsi and Daddy Yankee featuring Justin Bieber","chart_year":2017,"source_revision":"1356457366","source_entry_key":"2017:1323:luis fonsi and daddy yankee justin bieber:despacito","placeholder_canonical_id":"15f1e58b-da5c-4493-8d63-3dedff6bc292"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"94de081a554009364cb33b2c49cc4c4fe9c9fc491c1252511ff32e2e96f0b7db","canonical_metadata_sha256":"22f091319b7039c6178267c8643d0a1f53940a75bfc2742e7dde53e592e083ed"},"target":{"song_id":null,"canonical_id":"15f1e58b-da5c-4493-8d63-3dedff6bc292","album_id":null,"stored_title":"Despacito","stored_artist":"Luis Fonsi and Daddy Yankee featuring Justin Bieber","track_position":1,"duration_ms":228827},"isrc":"USUM71703825","recording_id":"9ba26ca8-9dbc-4136-8541-2b25bcc6df1e","release_id":"8810fe3d-a154-45f4-b692-75a3c4904371","release_group_id":"acfcac55-0848-407f-957b-aafd91fb56db","album_title":"Despacito (remix)","album_artist":"Luis Fonsi & Daddy Yankee feat. Justin Bieber","release_date":"2017-04-17","country":"ES","release_track_count":1,"evidence_sha256":"3cf15312fb88e86dfe77e8619e55cc15a48b1ba467dfae08c6115b54927ace73","risk_notes":["Only the Justin Bieber remix identified by ISRC USUM71703825 is approved; the original Spanish recording and other versions must not be substituted."]},{"action":"import_verified","chart_entry":{"id":1994,"title":"Rockabye","artist":"Clean Bandit featuring Sean Paul and Anne-Marie","chart_year":2016,"source_revision":"1356457366","source_entry_key":"2016:1318:clean bandit sean paul and anne marie:rockabye","placeholder_canonical_id":"3be0ba0f-8131-4012-adf2-c5f08a558413"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"01e6ee60b59cd553b673412d5081fdb4e6bbfcd4c978bf239e1a9f12d3428066","canonical_metadata_sha256":"86b22acadefc43bc818e38c77f160bc8a9af3b607446396c902723128b0d356e"},"target":{"song_id":null,"canonical_id":"3be0ba0f-8131-4012-adf2-c5f08a558413","album_id":null,"stored_title":"Rockabye","stored_artist":"Clean Bandit featuring Sean Paul and Anne-Marie","track_position":1,"duration_ms":251088},"isrc":"GBAHS1600363","recording_id":"13f7ba19-553d-444a-81c1-e7fea9739bc9","release_id":"8b13961c-89ba-4eb6-a5cc-f36d4a17f7a3","release_group_id":"4d437564-f5e0-41d0-9dea-375aef8f1fca","album_title":"Rockabye","album_artist":"Clean Bandit feat. Sean Paul & Anne‐Marie","release_date":"2016-10-21","country":"XW","release_track_count":1,"evidence_sha256":"03f06b898593811cdd517c49ba492ed7cc8a755a2b094591caa22d1ba370226e","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":1976,"title":"Don't Be So Hard on Yourself","artist":"Jess Glynne","chart_year":2015,"source_revision":"1356457366","source_entry_key":"2015:1299:jess glynne:don t be so hard on yourself","placeholder_canonical_id":"1224dbe4-f11f-4e87-a211-5115b0615087"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"ce50898183b200f9dc6547578abb75c5146d2d848a0b8871df403ea97af54417","canonical_metadata_sha256":"2aa4bd1c12df0a3a62df074f439725dd4f645ea7a088785da91df99a60e719f0"},"target":{"song_id":null,"canonical_id":"1224dbe4-f11f-4e87-a211-5115b0615087","album_id":null,"stored_title":"Don't Be So Hard on Yourself","stored_artist":"Jess Glynne","track_position":7,"duration_ms":212000},"isrc":"GBAHS1500227","recording_id":"7841b7b2-a643-4793-8fc5-ba8d9af9ed39","release_id":"854c2a63-6253-435a-b1f4-e85574512627","release_group_id":"824500c5-eccf-4163-b159-e1413d7544e5","album_title":"I Cry When I Laugh","album_artist":"Jess Glynne","release_date":"2015-07-31","country":"GB","release_track_count":14,"evidence_sha256":"f4e84e3c04be41d20dc3ade1bebdca189041397fde49bc7702cfb6e5db96c629","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted."]},{"action":"import_verified","chart_entry":{"id":1971,"title":"Not Letting Go","artist":"Tinie Tempah featuring Jess Glynne","chart_year":2015,"source_revision":"1356457366","source_entry_key":"2015:1293:tinie tempah jess glynne:not letting go","placeholder_canonical_id":"9e2a0b6b-221b-4c37-93cd-156f9bf2848c"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"9bbd89f03f5905e5d55ef8476093d73bf6ec04f22a28b0640d2c004733052175","canonical_metadata_sha256":"16e3fbd6b76a8c3b21210f04c74ec14d6738875bf63b6b653bc6d60678a8e092"},"target":{"song_id":null,"canonical_id":"9e2a0b6b-221b-4c37-93cd-156f9bf2848c","album_id":null,"stored_title":"Not Letting Go","stored_artist":"Tinie Tempah featuring Jess Glynne","track_position":6,"duration_ms":229960},"isrc":"GB7TP1500001","recording_id":"81b909de-adab-4e15-ad0f-1707ac70973e","release_id":"4b4d909f-c226-4e6c-aa96-0250fdeb2898","release_group_id":"86a53816-ddd7-43f3-9a78-fccd891cdcae","album_title":"Now That’s What I Call Music! 91","album_artist":"Various Artists","release_date":"2015-07-24","country":"GB","release_track_count":44,"evidence_sha256":"3fe6df36a1c5e21ea986a506a33f99f14038785dc8f5dcf91942e2fdcc077485","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted.","The reviewed source is the exact ISRC track on an official 44-track compilation; only that verified track is imported."]},{"action":"import_verified","chart_entry":{"id":1966,"title":"Lay Me Down","artist":"Sam Smith featuring John Legend","chart_year":2015,"source_revision":"1356457366","source_entry_key":"2015:1288:sam smith john legend:lay me down","placeholder_canonical_id":"92f39cc9-c8fe-49a2-b9d7-bb1c5f195c3a"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"092bd93203260f9c0c4e1a9bc58144acd069a063a6f91b20626edd73d12b03a6","canonical_metadata_sha256":"998d20b70ac27a35d7b892efd0dff7cd40734a34d564f9730eba7c0ae96ca8a4"},"target":{"song_id":null,"canonical_id":"92f39cc9-c8fe-49a2-b9d7-bb1c5f195c3a","album_id":null,"stored_title":"Lay Me Down","stored_artist":"Sam Smith featuring John Legend","track_position":1,"duration_ms":219663},"isrc":"GBUM71500850","recording_id":"f10de69c-04f2-47f1-9277-fb387a70e2fe","release_id":"239fc754-7608-4a04-bbd2-6f139c5ae80a","release_group_id":"02435390-0779-41dc-b564-0cc479dad8b1","album_title":"Lay Me Down","album_artist":"Sam Smith feat. John Legend","release_date":"2015-03-09","country":"GB","release_track_count":1,"evidence_sha256":"2f5df9dada45e707e1bfa04ca4790f211d64e40200b21ad688617a51fbfd42a4","risk_notes":["The approved recording is the Red Nose Day duet with John Legend; Sam Smith's solo recording must not be substituted."]},{"action":"import_verified","chart_entry":{"id":1958,"title":"I Don't Care","artist":"Cheryl","chart_year":2014,"source_revision":"1356457366","source_entry_key":"2014:1280:cheryl:i don t care","placeholder_canonical_id":"b7176179-db56-4918-868e-f11b7dd4f7af"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"e0a310d89f352e762cbedf3a97c576558abe3b33ea799e0d6fb43d4fcee64378","canonical_metadata_sha256":"d38d552b33ba073cbe22b20436b368bf26bef95d804409ef90e56971a77d5bfb"},"target":{"song_id":null,"canonical_id":"b7176179-db56-4918-868e-f11b7dd4f7af","album_id":null,"stored_title":"I Don't Care","stored_artist":"Cheryl","track_position":6,"duration_ms":240000},"isrc":"GBUM71404141","recording_id":"dd373cce-00b6-4a89-a5af-5bd893f3bf61","release_id":"945e9f23-2eb8-4379-bdbc-75f7d0ecb321","release_group_id":"f79ab584-81c9-4537-a13b-5b1db6bb7960","album_title":"Only Human","album_artist":"Cheryl","release_date":"2014-11-07","country":"IE","release_track_count":15,"evidence_sha256":"fe20335f39aebfdfd6d5808d6e0aa72b366f304e4f19f46a3cbc992773ece89c","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted."]},{"action":"link_existing","chart_entry":{"id":1920,"title":"The Monster","artist":"Eminem featuring Rihanna","chart_year":2013,"source_revision":"1356457366","source_entry_key":"2013:1242:eminem rihanna:the monster","placeholder_canonical_id":"8873a13f-6e48-4583-9edb-93679893e8c1"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"0816ffa4119c7b3d9209e61fc9a405fabbfb4cd7a3ae4e64625988ba49ab8de5","canonical_metadata_sha256":"45163bb2790588ac0c5495a8d8c62c2e5a54f5247aae8925b59be153d0bedab9"},"target":{"song_id":8738,"canonical_id":"06c26627-a1d1-4cdc-8b8f-dd736be80179","album_id":631,"stored_title":"The Monster","stored_artist":"Eminem","track_position":12,"duration_ms":null},"isrc":"USUM71314064","recording_id":"c975930e-c69c-4685-a214-b544b8f1fd5d","release_id":"b1deba13-ada0-4901-af50-1d721085a2b6","release_group_id":"b1fdc9cc-8680-44da-abab-59edca6b2ad3","album_title":"The Marshall Mathers LP 2","album_artist":"Eminem","release_date":"2013-11-05","country":"US","release_track_count":21,"evidence_sha256":"d302fde807ec3a3766e68e05ad0b9bb065c1c4f948c17e80aeff7df493df7216","risk_notes":["The exact existing BOM clean recording on The Marshall Mathers LP 2 is reused; explicit or alternate versions and duplicate identities must not be substituted."]},{"action":"import_verified","chart_entry":{"id":1898,"title":"Impossible","artist":"James Arthur","chart_year":2013,"source_revision":"1356457366","source_entry_key":"2013:re-2013-01-05:james arthur:impossible","placeholder_canonical_id":"a2153a06-761e-4d10-adf7-343e3861eadf"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"4638fe7708d616645eae8bf7abc2cb0bbb3e468b5b65e744c801703fe8062491","canonical_metadata_sha256":"d5d6e19933abb6bdc701777a0b1cddf4de9d0aec265e7b0fb330211dc4325509"},"target":{"song_id":null,"canonical_id":"a2153a06-761e-4d10-adf7-343e3861eadf","album_id":null,"stored_title":"Impossible","stored_artist":"James Arthur","track_position":1,"duration_ms":209000},"isrc":"GBHMU1200535","recording_id":"2a330498-8fe8-45e1-8536-dc0679fd7a37","release_id":"310faf82-005c-4497-b000-c3abc647713c","release_group_id":"7a82779e-f14c-4eab-a3d9-07801e95e9c0","album_title":"Impossible","album_artist":"James Arthur","release_date":"2012-12-10","country":"GB","release_track_count":1,"evidence_sha256":"d7ea025688310d1f9b8a4784ab7799bef38a665de444ca3efeca8adf4544a48c","risk_notes":["Only the James Arthur recording identified by ISRC GBHMU1200535 is approved; the Shontelle original and other versions must not be substituted."]},{"action":"import_verified","chart_entry":{"id":1904,"title":"What About Us","artist":"The Saturdays featuring Sean Paul","chart_year":2013,"source_revision":"1356457366","source_entry_key":"2013:1225:the saturdays sean paul:what about us","placeholder_canonical_id":"3bf4ff67-478b-41af-ae3d-b172c5286ef3"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"3a20e600d921482449ca7098c5c7ac1bde86df8047d16a7a9bdd0ce30c0887cd","canonical_metadata_sha256":"0297e554f8b9679eb97197883a2e8699eaa6ab8f9cb86b737bcbd78c8dc4d807"},"target":{"song_id":null,"canonical_id":"3bf4ff67-478b-41af-ae3d-b172c5286ef3","album_id":null,"stored_title":"What About Us","stored_artist":"The Saturdays featuring Sean Paul","track_position":1,"duration_ms":220000},"isrc":"GBUM71206116","recording_id":"c838dd68-684d-4423-aa17-d859c036c7f5","release_id":"3d33b628-b295-41d8-b5b1-308f44ae027a","release_group_id":"89468c3e-b7d6-40e3-b06b-425e739be9be","album_title":"What About Us","album_artist":"The Saturdays","release_date":"2013-03-15","country":"GB","release_track_count":4,"evidence_sha256":"2cb8a4db32b944952939cb21232104fb85ddf81f9e43bdabdcb687a9d72bc1b4","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted.","The approved recording is the Sean Paul version identified by ISRC GBUM71206116; solo or alternate versions must not be substituted."]}],"rejected_version_leads":[{"chart_entry_id":1996,"title":"Symphony","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":1979,"title":"Easy Love","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":1968,"title":"See You Again","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":1959,"title":"Wake Me Up (Gareth Malone's All Star Choir)","reason_code":"stored_isrc_belongs_to_different_artist_version"},{"chart_entry_id":1913,"title":"Wake Me Up (Avicii)","reason_code":"isrc_maps_multiple_recording_versions"},{"chart_entry_id":1522,"title":"Beautiful Girls","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":1467,"title":"Call on Me","reason_code":"official_isrc_maps_filterheadz_remix_not_chart_version"},{"chart_entry_id":1418,"title":"Dilemma","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":107,"title":"Breathe","reason_code":"album_version_postdates_number_one_without_contemporaneous_bridge"},{"chart_entry_id":45,"title":"No Limit","reason_code":"contemporary_uk_single_uses_different_radio_edit_recording"},{"chart_entry_id":2491,"title":"Houdini","reason_code":"isrc_maps_music_video_not_audio_single"},{"chart_entry_id":2013,"title":"I'll Be There","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":2006,"title":"Perfect","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":2014,"title":"Solo","reason_code":"isrc_maps_multiple_recordings"}],"reviewed_incomplete_leads":[{"chart_entry_id":2485,"title":"Now and Then","reason_code":"official_charts_page_has_no_catalogue_identifier"},{"chart_entry_id":1545,"title":"Right Round","reason_code":"official_charts_catalogue_value_is_not_the_stored_isrc"},{"chart_entry_id":1437,"title":"Breathe (Blu Cantrell)","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":191,"title":"Lift Me Up","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":180,"title":"9 PM (Till I Come)","reason_code":"official_charts_song_page_not_found"},{"chart_entry_id":167,"title":"Fly Away","reason_code":"official_charts_catalogue_value_does_not_bridge_to_stored_isrc"},{"chart_entry_id":41,"title":"Sleeping Satellite","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":541,"title":"All Around the World","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":531,"title":"Like a Prayer","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":425,"title":"Ebony and Ivory","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":845,"title":"Message in a Bottle","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":2505,"title":"The Subway","reason_code":"official_charts_catalogue_value_is_not_an_isrc"},{"chart_entry_id":2501,"title":"Survive","reason_code":"release_level_verification_not_completed"},{"chart_entry_id":2500,"title":"Ordinary","reason_code":"musicbrainz_isrc_lookup_unavailable"},{"chart_entry_id":2486,"title":"Lovin on Me","reason_code":"musicbrainz_isrc_lookup_unavailable"},{"chart_entry_id":2476,"title":"Flowers","reason_code":"official_charts_page_has_no_catalogue_identifier"},{"chart_entry_id":2473,"title":"Anti-Hero","reason_code":"release_level_verification_not_completed"},{"chart_entry_id":2459,"title":"Body","reason_code":"official_isrc_absent_from_musicbrainz"}],"expected_deltas":{"albums":17,"songs":18,"canonical_recordings":0,"historical_chart_links":20,"ratings":0},"proposed_result":{"resolved_delta":20,"resolved_chart_entries":479,"remaining_unresolved_chart_entries":819},"safety_contract":{"atomic_transaction":true,"global_stale_baseline_abort":true,"per_candidate_stale_fingerprint_abort":true,"deterministic_advisory_lock_order":true,"immutable_private_operation_evidence":true,"preserve_all_song_ratings_byte_for_byte":true,"preserve_all_historical_chart_ratings_byte_for_byte":true,"preserve_first_batch_papa_dont_preach_reconciliation":true,"duplicate_and_partial_identity_abort":true,"shared_reviewed_release_insert_once":true,"reviewed_existing_album_reuse":true,"rollback_operation_required":true,"production_execution_authorized":false}}$batch_manifest$::text as payload
  ) signed_manifest
  where pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(signed_manifest.payload, 'UTF8'),
      'sha256'
    ),
    'hex'
  ) =
    split_part(
      nullif(
        current_setting('bom.approved_historical_reconciliation', true),
        ''
      ),
      ':',
      2
    )
) verified_manifest
cross join lateral jsonb_array_elements(
  (verified_manifest.payload::jsonb)->'candidates'
) with ordinality as candidate(item, batch_order);

do $manifest_guard$
begin
  if (select count(*) from pg_temp.uk_number_ones_batch_4_manifest) <> 20
     or (select count(distinct chart_id) from pg_temp.uk_number_ones_batch_4_manifest) <> 20
     or (select count(distinct source_entry_key) from pg_temp.uk_number_ones_batch_4_manifest) <> 20
     or (select count(distinct placeholder_canonical_id) from pg_temp.uk_number_ones_batch_4_manifest) <> 20
     or (select count(distinct recording_id) from pg_temp.uk_number_ones_batch_4_manifest) <> 20
     or (select count(distinct release_id) from pg_temp.uk_number_ones_batch_4_manifest) <> 20
     or (select count(distinct release_group_id) from pg_temp.uk_number_ones_batch_4_manifest) <> 20
     or (select count(*) from pg_temp.uk_number_ones_batch_4_manifest
         where action = 'import_verified') <> 18
     or (select count(*) from pg_temp.uk_number_ones_batch_4_manifest
         where action = 'link_existing') <> 2 then
    raise exception 'embedded batch-4 manifest digest or shape failed';
  end if;
  if exists (
    select 1
    from pg_temp.uk_number_ones_batch_4_manifest
    where action not in ('import_verified', 'link_existing')
       or target_canonical_id is null
       or evidence_sha256 !~ '^[0-9a-f]{64}$'
       or recording_id !~ '^[0-9a-f-]{36}$'
       or release_id !~ '^[0-9a-f-]{36}$'
       or release_group_id !~ '^[0-9a-f-]{36}$'
       or release_track_count is null
       or release_track_count < 1
       or track_position > release_track_count
       or jsonb_typeof(risk_notes) is distinct from 'array'
       or jsonb_typeof(selected_track_import_chart_entry_ids)
            is distinct from 'array'
       or (
         action = 'import_verified'
         and (
           target_song_id is not null
           or target_canonical_id <> placeholder_canonical_id
         )
       )
       or (
         action = 'link_existing'
         and (
           target_song_id is null
           or target_album_id is null
           or target_canonical_id = placeholder_canonical_id
         )
       )
  ) then
    raise exception 'embedded batch-4 manifest action shape failed';
  end if;

  if (select count(*)
      from pg_temp.uk_number_ones_batch_4_manifest
      where action = 'import_verified'
        and target_album_id is not null) <> 1 then
    raise exception 'embedded batch-4 reviewed existing album shape failed';
  end if;

  if exists (
    select 1
    from pg_temp.uk_number_ones_batch_4_manifest
    where action = 'import_verified'
    group by release_id
    having count(distinct release_group_id) <> 1
       or count(distinct album_title) <> 1
       or count(distinct album_artist) <> 1
       or count(distinct release_date) <> 1
       or count(distinct country) filter (where country is not null) > 1
  ) then
    raise exception 'embedded batch-4 shared release metadata failed';
  end if;

  if exists (
    select 1
    from pg_temp.uk_number_ones_batch_4_manifest
    where (
      action = 'import_verified'
      and release_track_count > 1
    ) is distinct from (
      risk_notes @> jsonb_build_array(
        'Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted.'::text
      )
    )
  ) then
    raise exception 'embedded batch-4 selected-track risk disclosure failed';
  end if;

  if (
    select coalesce(jsonb_agg(chart_id order by batch_order), '[]'::jsonb)
    from pg_temp.uk_number_ones_batch_4_manifest
    where action = 'import_verified'
      and release_track_count > 1
  ) is distinct from (
    select selected_track_import_chart_entry_ids
    from pg_temp.uk_number_ones_batch_4_manifest
    order by batch_order
    limit 1
  ) then
    raise exception 'embedded batch-4 selected-track disclosure set failed';
  end if;

  if exists (
    select 1
    from pg_temp.uk_number_ones_batch_4_manifest
    where source_release_note is distinct from
      'I''m Good (Blue), I Don''t Care, Funky Friday, Don''t Be So Hard on Yourself, Not Letting Go, I Don''t Care and What About Us use exact tracks on reviewed official multi-track releases; only those selected tracks are imported.'
  ) then
    raise exception 'embedded batch-4 selected-track release note failed';
  end if;
end
$manifest_guard$;

-- Acquire every operation, chart, recording, release and release-group lock in
-- one deterministic lexical order before taking any table lock.
do $advisory_locks$
declare
  v_lock record;
begin
  for v_lock in
    select distinct lock_key
    from (
      select 'bom-historical-reconciliation:20261124_uk_number_ones_verified_batch_4'::text
        as lock_key
      union all
      select 'bom-historical-chart:' || source_entry_key
      from pg_temp.uk_number_ones_batch_4_manifest
      union all
      select 'musicbrainz-recording:' || recording_id
      from pg_temp.uk_number_ones_batch_4_manifest
      union all
      select 'musicbrainz-release:' || release_id
      from pg_temp.uk_number_ones_batch_4_manifest
      where action = 'import_verified'
      union all
      select 'bom-admin-catalogue:' || release_group_id
      from pg_temp.uk_number_ones_batch_4_manifest
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

create temporary table uk_number_ones_batch_4_song_ratings_before
on commit drop
as select * from public.song_ratings;

create temporary table uk_number_ones_batch_4_historical_ratings_before
on commit drop
as select * from public.historical_chart_entry_ratings;

create temporary table uk_number_ones_batch_4_first_batch_audit_before
on commit drop
as select * from private.historical_chart_rating_reconciliation_audit;

do $baseline$
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
    raise exception 'global chart baseline is stale';
  end if;
  if (select count(*) from public.albums) <> 1769
     or (select count(*) from public.songs) <> 16201
     or (select count(*) from public.canonical_recordings) <> 17095 then
    raise exception 'global catalogue baseline is stale';
  end if;
  if (select count(*) from public.song_ratings) <> 1747
     or (select coalesce(sum(rating), 0) from public.song_ratings) <> 13454
     or (select count(*) from public.song_ratings
         where rating is null or rating < 0 or rating > 10) <> 0 then
    raise exception 'global song-rating baseline is stale';
  end if;
  if (select count(*) from public.historical_chart_entry_ratings) <> 5
     or (select coalesce(sum(rating), 0)
         from public.historical_chart_entry_ratings) <> 43 then
    raise exception 'global historical-rating baseline is stale';
  end if;
  if (select count(*)
      from private.historical_chart_rating_reconciliation_audit) <> 1
     or not exists (
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
    raise exception 'Papa Don''t Preach reconciliation baseline is stale';
  end if;
  if exists (
    select 1
    from private.historical_chart_reconciliation_operation_audit
    where operation_key =
      '20261124_uk_number_ones_verified_batch_4'
  ) then
    raise exception 'batch-4 operation audit rows already exist';
  end if;
  if (select count(*)
      from private.historical_chart_reconciliation_operation_audit) <> 40 then
    raise exception 'prior immutable operation audit baseline is stale';
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
    raise exception 'duplicate canonical recording MBIDs exist';
  end if;
end
$baseline$;

do $apply_batch$
declare
  v constant text := '20261124_uk_number_ones_verified_batch_4';
  v_manifest text := split_part(
    nullif(
      current_setting('bom.approved_historical_reconciliation', true),
      ''
    ),
    ':',
    2
  );
  candidate record;
  v_chart_before jsonb;
  v_placeholder_before jsonb;
  v_existing_song_before jsonb;
  v_existing_canonical_before jsonb;
  v_existing_album_before jsonb;
  v_chart_after jsonb;
  v_target_canonical_after jsonb;
  v_target_song_after jsonb;
  v_target_album_after jsonb;
  v_new_album_id bigint;
  v_new_song_id bigint;
  v_target_song_id bigint;
  v_target_album_id bigint;
  v_updated integer;
  v_links integer := 0;
begin
  for candidate in
    select *
    from pg_temp.uk_number_ones_batch_4_manifest
    order by batch_order
  loop
    select to_jsonb(q), to_jsonb(c)
    into v_chart_before, v_placeholder_before
    from public.quick_rate_collection_tracks q
    join public.canonical_recordings c
      on c.id = q.canonical_song_id
    where q.id = candidate.chart_id
      and q.collection_key = 'uk-number-ones'
      and q.source_entry_key = candidate.source_entry_key
      and q.chart_year = candidate.chart_year
      and q.title = candidate.title
      and q.artist = candidate.artist
      and q.source_revision is not distinct from candidate.source_revision
      and q.match_status = 'unresolved'
      and q.song_id is null
      and q.musicbrainz_recording_id is null
      and q.canonical_song_id = candidate.placeholder_canonical_id
      and q.updated_at = candidate.chart_updated_at
      and pg_catalog.encode(
        extensions.digest(q.source_metadata::text, 'sha256'), 'hex'
      ) = candidate.source_metadata_sha256
      and c.id = candidate.placeholder_canonical_id
      and c.title = candidate.title
      and c.artist = candidate.artist
      and c.musicbrainz_recording_id is null
      and c.origin_key =
        'quick-rate:uk-number-ones:' || candidate.source_entry_key
      and c.updated_at = candidate.canonical_updated_at
      and pg_catalog.encode(
        extensions.digest(c.source_metadata::text, 'sha256'), 'hex'
      ) = candidate.canonical_metadata_sha256
    for update of q, c;

    if not found then
      raise exception 'candidate stale-state guard failed for %',
        candidate.source_entry_key;
    end if;

    if (select count(*)
        from public.quick_rate_collection_tracks
        where canonical_song_id = candidate.placeholder_canonical_id) <> 1
       or exists (
         select 1
         from public.songs
         where canonical_song_id = candidate.placeholder_canonical_id
       )
       or exists (
         select 1
         from public.song_ratings
         where canonical_song_id = candidate.placeholder_canonical_id
       )
       or exists (
         select 1
         from public.historical_chart_entry_ratings
         where chart_entry_id = candidate.chart_id
       ) then
      raise exception 'candidate placeholder is rated, shared or non-empty for %',
        candidate.source_entry_key;
    end if;

    v_existing_song_before := null;
    v_existing_canonical_before := null;
    v_existing_album_before := null;
    v_new_album_id := null;

    if candidate.action = 'link_existing' then
      select to_jsonb(s), to_jsonb(c), to_jsonb(a)
      into
        v_existing_song_before,
        v_existing_canonical_before,
        v_existing_album_before
      from public.songs s
      join public.canonical_recordings c
        on c.id = s.canonical_song_id
      join public.albums a
        on a.id = s.album_id
      where s.id = candidate.target_song_id
        and s.title = candidate.target_title
        and s.artist = candidate.target_artist
        and s.track_position = candidate.track_position
        and s.duration_ms is not distinct from candidate.duration_ms
        and s.external_source = 'musicbrainz'
        and lower(s.external_id) = candidate.recording_id
        and s.canonical_song_id = candidate.target_canonical_id
        and s.is_deleted is not true
        and c.id = candidate.target_canonical_id
        and c.title = candidate.target_title
        and c.artist = candidate.target_artist
        and lower(c.musicbrainz_recording_id) = candidate.recording_id
        and c.origin_key = 'musicbrainz:' || candidate.recording_id
        and a.id = candidate.target_album_id
        and a.title = candidate.album_title
        and a.artist = candidate.album_artist
        and a.external_source = 'musicbrainz'
        and lower(a.external_id) = candidate.release_id
        and lower(a.musicbrainz_release_id) = candidate.release_id
        and lower(a.musicbrainz_release_group_id) =
          candidate.release_group_id
        and a.release_date is not distinct from candidate.release_date
        and a.is_deleted is not true
      for update of s, c, a;

      if not found
         or (select count(*) from public.songs
             where external_source = 'musicbrainz'
               and lower(external_id) = candidate.recording_id) <> 1
         or (select count(*) from public.canonical_recordings
             where lower(coalesce(musicbrainz_recording_id, '')) =
                   candidate.recording_id
                or lower(coalesce(origin_key, '')) =
                   'musicbrainz:' || candidate.recording_id) <> 1
         or (select count(*) from public.albums
             where lower(coalesce(musicbrainz_release_id, '')) =
                   candidate.release_id
                or lower(coalesce(external_id, '')) =
                   candidate.release_id) <> 1
         or (select count(*) from public.albums
             where lower(coalesce(musicbrainz_release_group_id, '')) =
                   candidate.release_group_id) <> 1 then
        raise exception 'exact existing catalogue target failed for %',
          candidate.source_entry_key;
      end if;

      v_target_song_id := candidate.target_song_id;
      v_target_album_id := candidate.target_album_id;
    elsif candidate.action = 'import_verified' then
      if exists (
        select 1
        from public.songs
        where external_source = 'musicbrainz'
          and lower(external_id) = candidate.recording_id
      ) or exists (
        select 1
        from public.canonical_recordings
        where lower(coalesce(musicbrainz_recording_id, '')) =
              candidate.recording_id
           or lower(coalesce(origin_key, '')) =
              'musicbrainz:' || candidate.recording_id
      ) then
        raise exception 'partial or duplicate recording identity for %',
          candidate.source_entry_key;
      end if;

      select a.id, to_jsonb(a)
      into v_new_album_id, v_existing_album_before
      from public.albums a
      where a.title = candidate.album_title
        and a.artist = candidate.album_artist
        and a.external_source = 'musicbrainz'
        and lower(a.external_id) = candidate.release_id
        and lower(a.musicbrainz_release_id) = candidate.release_id
        and lower(a.musicbrainz_release_group_id) =
              candidate.release_group_id
        and a.release_date is not distinct from candidate.release_date
        and a.canonical_release_date is not distinct from
              candidate.release_date
        and a.canonical_release_country is not distinct from
              candidate.country
        and (
          candidate.target_album_id is null
          or a.id = candidate.target_album_id
        )
        and a.is_deleted is not true;

      if found then
        if (select count(*) from public.albums
            where lower(coalesce(musicbrainz_release_id, '')) =
                    candidate.release_id
               or lower(coalesce(external_id, '')) = candidate.release_id
               or lower(coalesce(musicbrainz_release_group_id, '')) =
                    candidate.release_group_id) <> 1
           or not (
             (
               candidate.target_album_id is not null
               and candidate.target_album_id = v_new_album_id
             )
             or (
               candidate.target_album_id is null
               and exists (
                 select 1
                 from private.historical_chart_reconciliation_operation_audit a
                 join pg_temp.uk_number_ones_batch_4_manifest prior
                   on prior.chart_id = a.chart_entry_id
                  and prior.batch_order < candidate.batch_order
                  and prior.release_id = candidate.release_id
                 where a.operation_key = v
                   and a.event_kind = 'apply'
                   and a.manifest_sha256 = v_manifest
                   and a.target_album_id = v_new_album_id
                   and a.musicbrainz_release_id = candidate.release_id
                   and a.musicbrainz_release_group_id =
                         candidate.release_group_id
               )
             )
           ) then
          raise exception 'unapproved existing shared release for %',
            candidate.source_entry_key;
        end if;
      else
        if candidate.target_album_id is not null then
          raise exception 'reviewed existing album target failed for %',
            candidate.source_entry_key;
        end if;
        if exists (
          select 1
          from public.albums
          where lower(coalesce(musicbrainz_release_id, '')) =
                candidate.release_id
             or lower(coalesce(external_id, '')) = candidate.release_id
             or lower(coalesce(musicbrainz_release_group_id, '')) =
                candidate.release_group_id
        ) then
          raise exception 'partial or duplicate release identity for %',
            candidate.source_entry_key;
        end if;

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
          candidate.album_title,
          candidate.album_artist,
          'musicbrainz',
          candidate.release_id,
          candidate.release_id,
          candidate.release_group_id,
          'https://coverartarchive.org/release-group/'
            || candidate.release_group_id || '/front-500',
          candidate.release_date,
          candidate.release_date,
          candidate.country,
          1,
          false
        )
        returning id into v_new_album_id;
      end if;

      update public.canonical_recordings c
      set musicbrainz_recording_id = candidate.recording_id,
          origin_key = 'musicbrainz:' || candidate.recording_id,
          source_metadata = coalesce(c.source_metadata, '{}'::jsonb)
            || jsonb_build_object(
              'historical_reconciliation',
              jsonb_build_object(
                'operation_key', v,
                'manifest_sha256', v_manifest,
                'evidence_sha256', candidate.evidence_sha256,
                'isrc', candidate.isrc
              )
            ),
          updated_at = timezone('utc', now())
      where c.id = candidate.placeholder_canonical_id
        and c.title = candidate.title
        and c.artist = candidate.artist
        and c.musicbrainz_recording_id is null
        and c.origin_key =
          'quick-rate:uk-number-ones:' || candidate.source_entry_key;

      get diagnostics v_updated = row_count;
      if v_updated <> 1 then
        raise exception 'canonical attachment count failed for %',
          candidate.source_entry_key;
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
        candidate.target_title,
        candidate.target_artist,
        v_new_album_id,
        candidate.track_position,
        'musicbrainz',
        candidate.recording_id,
        candidate.target_canonical_id,
        candidate.duration_ms,
        false
      )
      returning id into v_new_song_id;

      v_target_song_id := v_new_song_id;
      v_target_album_id := v_new_album_id;
    else
      raise exception 'unsupported batch-4 action %', candidate.action;
    end if;

    update public.quick_rate_collection_tracks q
    set song_id = v_target_song_id,
        canonical_song_id = candidate.target_canonical_id,
        musicbrainz_recording_id = candidate.recording_id,
        match_status = 'direct_mbid',
        match_method = case
          when candidate.action = 'link_existing'
            then 'verified_evidence_existing'
          else 'verified_evidence_import'
        end,
        match_notes =
          'Guarded UK No. 1 batch 4; evidence manifest '
          || v_manifest,
        updated_at = timezone('utc', now())
    where q.id = candidate.chart_id
      and q.collection_key = 'uk-number-ones'
      and q.source_entry_key = candidate.source_entry_key
      and q.chart_year = candidate.chart_year
      and q.title = candidate.title
      and q.artist = candidate.artist
      and q.source_revision is not distinct from candidate.source_revision
      and q.match_status = 'unresolved'
      and q.song_id is null
      and q.musicbrainz_recording_id is null
      and q.canonical_song_id = candidate.placeholder_canonical_id
    returning to_jsonb(q) into v_chart_after;

    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'chart update count failed for %',
        candidate.source_entry_key;
    end if;

    select to_jsonb(c), to_jsonb(s), to_jsonb(a)
    into
      v_target_canonical_after,
      v_target_song_after,
      v_target_album_after
    from public.canonical_recordings c
    join public.songs s
      on s.canonical_song_id = c.id
     and s.id = v_target_song_id
    join public.albums a
      on a.id = s.album_id
     and a.id = v_target_album_id
    where c.id = candidate.target_canonical_id;

    if not found then
      raise exception 'post-update target state missing for %',
        candidate.source_entry_key;
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
      v,
      'apply',
      v_manifest,
      candidate.chart_id,
      candidate.source_entry_key,
      candidate.action,
      candidate.placeholder_canonical_id,
      candidate.target_canonical_id,
      v_target_song_id,
      v_target_album_id,
      candidate.recording_id,
      candidate.release_id,
      candidate.release_group_id,
      candidate.evidence_sha256,
      jsonb_build_object(
        'chart', v_chart_before,
        'placeholder_canonical', v_placeholder_before,
        'existing_target_song', v_existing_song_before,
        'existing_target_canonical', v_existing_canonical_before,
        'existing_target_album', v_existing_album_before
      ),
      jsonb_build_object(
        'chart', v_chart_after,
        'target_canonical', v_target_canonical_after,
        'target_song', v_target_song_after,
        'target_album', v_target_album_after
      )
    );

    v_links := v_links + 1;
  end loop;

  if v_links <> 20 then
    raise exception 'expected exactly 20 chart links, updated %', v_links;
  end if;
end
$apply_batch$;

do $postconditions$
declare
  v_total bigint;
  v_resolved bigint;
  v_unresolved bigint;
begin
  if (select count(*) from public.albums) <> 1786
     or (select count(*) from public.songs) <> 16219
     or (select count(*) from public.canonical_recordings) <> 17095 then
    raise exception 'batch-4 catalogue delta failed';
  end if;

  select
    count(*),
    count(*) filter (where song_id is not null),
    count(*) filter (where song_id is null and match_status = 'unresolved')
  into v_total, v_resolved, v_unresolved
  from public.quick_rate_collection_tracks
  where collection_key = 'uk-number-ones';

  if v_total <> 1298 or v_resolved <> 479 or v_unresolved <> 819
     or v_total <> v_resolved + v_unresolved then
    raise exception 'batch-4 chart delta failed';
  end if;

  if exists (
    (
      select * from pg_temp.uk_number_ones_batch_4_song_ratings_before
      except
      select * from public.song_ratings
    )
    union all
    (
      select * from public.song_ratings
      except
      select * from pg_temp.uk_number_ones_batch_4_song_ratings_before
    )
  ) then
    raise exception 'song ratings changed during batch 4';
  end if;

  if exists (
    (
      select *
      from pg_temp.uk_number_ones_batch_4_historical_ratings_before
      except
      select * from public.historical_chart_entry_ratings
    )
    union all
    (
      select * from public.historical_chart_entry_ratings
      except
      select *
      from pg_temp.uk_number_ones_batch_4_historical_ratings_before
    )
  ) then
    raise exception 'historical chart ratings changed during batch 4';
  end if;

  if exists (
    (
      select *
      from pg_temp.uk_number_ones_batch_4_first_batch_audit_before
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
      from pg_temp.uk_number_ones_batch_4_first_batch_audit_before
    )
  ) then
    raise exception 'first-batch rating audit changed during batch 4';
  end if;

  if (select count(*)
      from private.historical_chart_reconciliation_operation_audit
      where operation_key =
          '20261124_uk_number_ones_verified_batch_4'
        and event_kind = 'apply'
        and manifest_sha256 =
          split_part(
            nullif(
              current_setting(
                'bom.approved_historical_reconciliation',
                true
              ),
              ''
            ),
            ':',
            2
          )) <> 20
     or exists (
       select 1
       from pg_temp.uk_number_ones_batch_4_manifest m
       left join private.historical_chart_reconciliation_operation_audit a
         on a.operation_key =
              '20261124_uk_number_ones_verified_batch_4'
        and a.event_kind = 'apply'
        and a.chart_entry_id = m.chart_id
        and a.source_entry_key = m.source_entry_key
        and a.action = m.action
        and a.placeholder_canonical_song_id =
              m.placeholder_canonical_id
        and a.target_canonical_song_id = m.target_canonical_id
        and a.musicbrainz_recording_id = m.recording_id
        and a.musicbrainz_release_id = m.release_id
        and a.musicbrainz_release_group_id = m.release_group_id
        and a.evidence_sha256 = m.evidence_sha256
       where a.id is null
     ) then
    raise exception 'batch-4 immutable operation audit failed';
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
    raise exception 'batch-4 created duplicate canonical recording MBIDs';
  end if;
end
$postconditions$;

commit;
