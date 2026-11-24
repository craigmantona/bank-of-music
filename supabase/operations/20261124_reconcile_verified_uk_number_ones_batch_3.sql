begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Execution-role contract: run this reviewed operation only as the migration
-- owner/postgres role. The service role intentionally has no UPDATE, DELETE or
-- TRUNCATE privilege needed for the explicit high-strength table locks below.
-- Reviewed batch 3 is inert unless an operator supplies the exact independent
-- approval token at session scope. The operation never sets its own approval.
do $approval$
declare
  v_expected constant text :=
    '20261124_uk_number_ones_verified_batch_3:49b05d4ed317b0a22ae3aff5365f3c9835d40f3ba771d3ac19308c3d90db54b9';
begin
  if nullif(current_setting('bom.approved_historical_reconciliation', true), '')
       is distinct from v_expected then
    raise exception 'batch-3 approval token missing or does not match the reviewed manifest';
  end if;
end
$approval$;

create temporary table uk_number_ones_batch_3_manifest
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
    select $batch_manifest${"operation_key":"20261124_uk_number_ones_verified_batch_3","snapshot":{"captured_at":"2026-11-24T09:33:25.050876+00:00","candidate_state_artifact":"historical-uk-number-ones-verified-batch-3-live-state-20261124.json","candidate_state_sha256":"2ceb34ca312097c476bf4f0c41f25f3a32bf320aba3e30218195ed363d9c1c6f","production_integrity":{"songs":16181,"albums":1750,"song_rating_sum":13454,"song_rating_rows":1747,"total_chart_entries":1298,"canonical_recordings":17095,"historical_rating_sum":43,"historical_rating_rows":5,"resolved_chart_entries":439,"invalid_song_rating_rows":0,"unresolved_chart_entries":859,"duplicate_recording_mbids":0,"prior_operation_audit_rows":20,"first_batch_rating_reconciliation_audit_rows":1}},"audit_coverage":{"inventory_rows_classified":859,"verified_existing_link":0,"verified_catalogue_import":20,"explicit_ambiguous_or_version_conflict":14,"insufficient_authoritative_evidence":825,"reviewed_but_not_selected":32,"remaining_inventory_without_a_complete_evidence_chain":807,"method":"The prior 859-row unresolved inventory was reused. Only the 20 previously verified exact Official Charts ISRC, unique MusicBrainz recording and official release-track chains were promoted; no title or artist force matching was used."},"selection_policy":{"batch_size":20,"min_batch_size":20,"max_batch_size":25,"ordering":"previously verified batch order","force_matching_prohibited":true,"all_candidates_unrated":true,"source_release_note":"Miracle, Escapism, Cold Heart (Pnau remix), Take Me Back to London, Beautiful People and River use exact tracks on reviewed official multi-track releases; only those selected tracks are imported.","selected_track_import_chart_entry_ids":[2478,2475,2462,2030,2029,2007]},"candidates":[{"action":"import_verified","chart_entry":{"id":2494,"title":"Backbone","artist":"Chase & Status and Stormzy","chart_year":2024,"source_revision":"1380580667","source_entry_key":"2024:1430:chase status and stormzy:backbone","placeholder_canonical_id":"f4278fde-aefe-437b-9db8-81893a51f4e0"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303+00:00","canonical_updated_at":"2026-10-23T14:53:07.351303+00:00","source_metadata_sha256":"56410459a04f7ba8ea4440507ae0681cdae2156344a13eadf0e0df20d86dd61d","canonical_metadata_sha256":"a526073cc657293b8ab92a53d10b84dafd95a48e931934ccde2ed7be0c6cd95c"},"target":{"song_id":null,"canonical_id":"f4278fde-aefe-437b-9db8-81893a51f4e0","album_id":null,"stored_title":"Backbone","stored_artist":"Chase & Status and Stormzy","track_position":1,"duration_ms":166000},"isrc":"GBUM72404368","recording_id":"50bc5312-36ea-42b2-8bbc-e7831021ab5d","release_id":"34d89bc2-c489-4285-afe5-acf631259268","release_group_id":"63fa6531-7057-4ab7-93a6-a179f0712256","album_title":"BACKBONE","album_artist":"Chase & Status & Stormzy","release_date":"2024-08-08","country":"XW","release_track_count":1,"evidence_sha256":"cabea4ff26fff540ac8c0014e2745e1d1e8d277501bded494f9c22ac42eec61e","risk_notes":["The reviewed MusicBrainz recording is explicitly marked explicit; clean or alternate edits must not be substituted."]},{"action":"import_verified","chart_entry":{"id":2493,"title":"Guess","artist":"Charli XCX featuring Billie Eilish","chart_year":2024,"source_revision":"1380580667","source_entry_key":"2024:1429:charli xcx billie eilish:guess","placeholder_canonical_id":"a2f04003-b5b4-4fc3-b9c7-9328e541b210"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303+00:00","canonical_updated_at":"2026-10-23T14:53:07.351303+00:00","source_metadata_sha256":"b72e873ec7a7552ce71d78c497235dd79339935821583927640d06e9b81fef67","canonical_metadata_sha256":"720dcf8b642f8a39a9fa5c9a52449d500731e0830a6d9d5ab2b0b63775708407"},"target":{"song_id":null,"canonical_id":"a2f04003-b5b4-4fc3-b9c7-9328e541b210","album_id":null,"stored_title":"Guess","stored_artist":"Charli XCX featuring Billie Eilish","track_position":1,"duration_ms":143331},"isrc":"USAT22406808","recording_id":"8a1aba5a-c84b-4499-8d8b-5a8dd19fe863","release_id":"36b7fb54-a842-4418-aeea-e4a0649e139c","release_group_id":"57bf15e0-a785-4e92-b931-967a5a2d871b","album_title":"Guess","album_artist":"Charli xcx featuring billie eilish","release_date":"2024-08-01","country":"BN","release_track_count":1,"evidence_sha256":"e6e23eb658f44dbd3e924913389fc3f88c166f64f5541d0ba5499f45b11cf415","risk_notes":["MusicBrainz country is anomalously BN; identity is supported by the exact Official Charts ISRC, unique MusicBrainz recording and reviewed official single."]},{"action":"import_verified","chart_entry":{"id":2490,"title":"Fortnight","artist":"Taylor Swift featuring Post Malone","chart_year":2024,"source_revision":"1380580667","source_entry_key":"2024:1425:taylor swift post malone:fortnight","placeholder_canonical_id":"f04c6928-856f-45c0-a40a-1c158093ca7a"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303+00:00","canonical_updated_at":"2026-10-23T14:53:07.351303+00:00","source_metadata_sha256":"f5950b0fc27ad83b7612f3c40f4aa3315a60def7634b78ab3a8d0af42d2fac03","canonical_metadata_sha256":"f74a492acc50b6a0e73315151efb6f536355508c11b362167d5c1aae4d52fc12"},"target":{"song_id":null,"canonical_id":"f04c6928-856f-45c0-a40a-1c158093ca7a","album_id":null,"stored_title":"Fortnight","stored_artist":"Taylor Swift featuring Post Malone","track_position":1,"duration_ms":228986},"isrc":"USUG12401028","recording_id":"a06d6b37-9cae-40a5-806d-1a3c4f8098c0","release_id":"303d4166-95e1-47ce-a298-91d26ae3ea46","release_group_id":"1a304bed-1abe-4a26-b3c6-e582d91739a4","album_title":"Fortnight","album_artist":"Taylor Swift featuring Post Malone","release_date":"2024-04-26","country":"DE","release_track_count":1,"evidence_sha256":"27fe757daa9c485af9c0bb1a37e2b33cce03984c2e256b4bfe4ea9286d04957f","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":2480,"title":"What Was I Made For?","artist":"Billie Eilish","chart_year":2023,"source_revision":"1380580667","source_entry_key":"2023:1413:billie eilish:what was i made for","placeholder_canonical_id":"83a25e68-0d85-4e48-b15a-98c1de208f9e"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303+00:00","canonical_updated_at":"2026-10-23T14:53:07.351303+00:00","source_metadata_sha256":"1951af7b66c3705d5da987be3a15b2b94d96584494ec786ac0517e33b1fc4c2a","canonical_metadata_sha256":"afba28823353017c673303d9453f1b2456e374ba6931efa88e2821c8bdaf1ef2"},"target":{"song_id":null,"canonical_id":"83a25e68-0d85-4e48-b15a-98c1de208f9e","album_id":null,"stored_title":"What Was I Made For?","stored_artist":"Billie Eilish","track_position":1,"duration_ms":222370},"isrc":"USUM72307484","recording_id":"74c2e388-4e59-4ed1-8c97-f3fd3317323d","release_id":"4d1222ac-fbfa-469a-a62f-6f4a47802ace","release_group_id":"60d1c6ed-e236-4c5a-94bc-403ba7c4fefb","album_title":"What Was I Made For?","album_artist":"Billie Eilish","release_date":"2023-07-13","country":"XW","release_track_count":1,"evidence_sha256":"87681186c9f30bcf0cce4ca2bd109fddc04222fcb76705a4285f441908d67e6d","risk_notes":["The reviewed one-track official worldwide single avoids the later UK cassette that repeats the same recording on both sides."]},{"action":"import_verified","chart_entry":{"id":2479,"title":"Sprinter","artist":"Dave and Central Cee","chart_year":2023,"source_revision":"1380580667","source_entry_key":"2023:1412:dave and central cee:sprinter","placeholder_canonical_id":"9ec3833f-60b5-4517-b0ef-2a258e024716"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303+00:00","canonical_updated_at":"2026-10-23T14:53:07.351303+00:00","source_metadata_sha256":"4f138986856b2edb288a55a305282aad3e1f7b78e5baf96dbd4c9c459ecfefc7","canonical_metadata_sha256":"c08868d48be237685358b5db9dbc058b4f2a2a70f14027f9b70e6d8e0e109676"},"target":{"song_id":null,"canonical_id":"9ec3833f-60b5-4517-b0ef-2a258e024716","album_id":null,"stored_title":"Sprinter","stored_artist":"Dave and Central Cee","track_position":1,"duration_ms":229133},"isrc":"GBUM72305159","recording_id":"1ec1bfc4-2407-4369-b070-177fea0b38ba","release_id":"813c4748-d6a5-4e9d-aedb-054b4a0cc776","release_group_id":"cd3bde26-2929-4404-86ef-4623e57b66cd","album_title":"Sprinter","album_artist":"Dave & Central Cee","release_date":"2023-06-01","country":"XW","release_track_count":1,"evidence_sha256":"908ef900c2f8b4ba042555d4da04174ddb84bda6660528f7647ac61e001fc425","risk_notes":["The reviewed release uses ampersand credit punctuation; the BOM chart credit is preserved unchanged."]},{"action":"import_verified","chart_entry":{"id":2478,"title":"Miracle","artist":"Calvin Harris and Ellie Goulding","chart_year":2023,"source_revision":"1380580667","source_entry_key":"2023:1410:calvin harris and ellie goulding:miracle","placeholder_canonical_id":"cc5bf8fb-1329-46e1-a635-00430a041c90"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303+00:00","canonical_updated_at":"2026-10-23T14:53:07.351303+00:00","source_metadata_sha256":"99da38d79851a468c57dce30e8343ec50a105737551ff1b839ddb770ceeb9543","canonical_metadata_sha256":"971cd50d158155651e724400d5ae7d5434fdeb303837f91d5a56b412c7f4dffe"},"target":{"song_id":null,"canonical_id":"cc5bf8fb-1329-46e1-a635-00430a041c90","album_id":null,"stored_title":"Miracle","stored_artist":"Calvin Harris and Ellie Goulding","track_position":2,"duration_ms":186496},"isrc":"GBARL2300300","recording_id":"c658c2e5-0712-468b-ac40-fc0e764f80b7","release_id":"e965f766-a9e3-478f-8638-bb525c682276","release_group_id":"8984b2ef-eb00-4211-a671-594ffa51ca8f","album_title":"Miracle (Hardwell remix)","album_artist":"Calvin Harris & Ellie Goulding","release_date":"2023-04-14","country":"XW","release_track_count":2,"evidence_sha256":"1c0a7d028d8a1013ead6f42a439661771692db369520af255b1f59496cf85663","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted.","The reviewed track is the exact original Miracle recording on a two-track Hardwell remix release; the Hardwell remix must not be substituted."]},{"action":"import_verified","chart_entry":{"id":2475,"title":"Escapism","artist":"Raye featuring 070 Shake","chart_year":2023,"source_revision":"1380580667","source_entry_key":"2023:1406:raye 070 shake:escapism","placeholder_canonical_id":"162b3fb9-0179-44e7-a34d-84f704c4222e"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303+00:00","canonical_updated_at":"2026-10-23T14:53:07.351303+00:00","source_metadata_sha256":"8e9bb44b8eccda4c84c74ee636f68f0a0b7a4920bcf1a80aec320e51a95eeadd","canonical_metadata_sha256":"3faceaaba190c8189c4cb23579240c760e2fbe8789c55e1bb22538416796d2f6"},"target":{"song_id":null,"canonical_id":"162b3fb9-0179-44e7-a34d-84f704c4222e","album_id":null,"stored_title":"Escapism","stored_artist":"Raye featuring 070 Shake","track_position":5,"duration_ms":272373},"isrc":"QMDA62217995","recording_id":"16994009-4a36-4b4c-865a-f4e7bc2ef6e1","release_id":"b4c35a7a-a36b-4c90-b866-38800a56eb5f","release_group_id":"35266d41-c2d4-4ad4-b624-02d4a0b2c489","album_title":"Ice Cream Man.","album_artist":"RAYE","release_date":"2023-01-31","country":"XW","release_track_count":5,"evidence_sha256":"41dda65ece3ae95d9e1d68fbe831fcbb3a175628a309bf5ca6519867247ffe36","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted."]},{"action":"import_verified","chart_entry":{"id":2469,"title":"Afraid to Feel","artist":"LF System","chart_year":2022,"source_revision":"1380580667","source_entry_key":"2022:1399:lf system:afraid to feel","placeholder_canonical_id":"9d0052a7-5abb-437b-9cf6-1b8843113c8d"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303+00:00","canonical_updated_at":"2026-10-23T14:53:07.351303+00:00","source_metadata_sha256":"82caf85277cd4a04007f0578e08b614e435b5477bb7c1262c860783268ce3f9c","canonical_metadata_sha256":"f9eff6b19b7a62039d92f385b58e5ee87af2818934a279418c8115fce631605b"},"target":{"song_id":null,"canonical_id":"9d0052a7-5abb-437b-9cf6-1b8843113c8d","album_id":null,"stored_title":"Afraid to Feel","stored_artist":"LF System","track_position":1,"duration_ms":177000},"isrc":"GBAHT2200492","recording_id":"d71f7d62-f7fc-4907-ba37-3f97a12448f7","release_id":"633c9295-51dc-4454-9b38-2bd0437fd20c","release_group_id":"32c77089-45f7-4bb8-9960-9b11899d4743","album_title":"Afraid to Feel","album_artist":"LF SYSTEM","release_date":"2022-05-02","country":null,"release_track_count":1,"evidence_sha256":"e066ad05b299d397f43f2048fd6ca7692c1099f8e501155a956ece1e4c89e07d","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":2462,"title":"Cold Heart (Pnau remix)","artist":"Elton John and Dua Lipa","chart_year":2021,"source_revision":"1380580667","source_entry_key":"2021:1390:elton john and dua lipa:cold heart pnau remix","placeholder_canonical_id":"2dfed403-ee71-42aa-9e45-cf1f9c07bda0"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303+00:00","canonical_updated_at":"2026-10-23T14:53:07.351303+00:00","source_metadata_sha256":"d89cfc9962fd8a42bc17ec1f38767281a74f888efc85bc45d9dbdfbfca2b735b","canonical_metadata_sha256":"ee0bbeccaa429fdc8294a7d9699c32a87d31515044d8df148da645cdd3b4cc2e"},"target":{"song_id":null,"canonical_id":"2dfed403-ee71-42aa-9e45-cf1f9c07bda0","album_id":null,"stored_title":"Cold Heart (Pnau remix)","stored_artist":"Elton John and Dua Lipa","track_position":2,"duration_ms":202735},"isrc":"GBUM72104705","recording_id":"a3906438-a1b2-403d-a7c2-7f48fca0a586","release_id":"b1a5d4cb-579a-4139-8ae6-13af0d5269f0","release_group_id":"78b65cee-4a6d-49c8-a98e-9159bf147cd1","album_title":"The Lockdown Sessions","album_artist":"Elton John","release_date":"2021-12-03","country":"CA","release_track_count":17,"evidence_sha256":"86d39434ea17dfe359c0a97245bcdd9b80bade9e2ae22f220625ec94ee7c097f","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted.","The charted Pnau remix identity is exact; original, acoustic and alternate remixes must not be substituted."]},{"action":"import_verified","chart_entry":{"id":2450,"title":"Head & Heart","artist":"Joel Corry and MNEK","chart_year":2020,"source_revision":"1380580667","source_entry_key":"2020:1374:joel corry and mnek:head heart","placeholder_canonical_id":"6df38772-ea83-46d8-b2d6-fd36791abda6"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303+00:00","canonical_updated_at":"2026-10-23T14:53:07.351303+00:00","source_metadata_sha256":"b6bbd6dac500036ea2f21d011bc1102db237fea202bc892bd6c5a77696e5d0a2","canonical_metadata_sha256":"4350864a34a3dc1db454bd69205c90440facaa9dbc66d68421a01f860f0cbd56"},"target":{"song_id":null,"canonical_id":"6df38772-ea83-46d8-b2d6-fd36791abda6","album_id":null,"stored_title":"Head & Heart","stored_artist":"Joel Corry and MNEK","track_position":1,"duration_ms":166028},"isrc":"UK4ZF2000305","recording_id":"168c30ff-7597-471b-a4c8-31c719f4f8af","release_id":"19e240f2-bae8-49a6-9c5c-3c3e040e49cd","release_group_id":"5369b02b-78d2-4361-83dd-d26dfd96eda7","album_title":"Head & Heart","album_artist":"Joel Corry feat. MNEK","release_date":"2020-07-03","country":"AF","release_track_count":1,"evidence_sha256":"a28630b2028376bb5113fa4421ebf861f95713c144fbace1c5e2b32070fae10a","risk_notes":["MusicBrainz country is anomalously AF; identity is supported by the exact Official Charts ISRC, unique MusicBrainz recording and reviewed official single."]},{"action":"import_verified","chart_entry":{"id":2448,"title":"Rain on Me","artist":"Lady Gaga and Ariana Grande","chart_year":2020,"source_revision":"1380580667","source_entry_key":"2020:1372:lady gaga and ariana grande:rain on me","placeholder_canonical_id":"e74a7629-6482-4cb1-8177-7077d163c0a1"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303+00:00","canonical_updated_at":"2026-10-23T14:53:07.351303+00:00","source_metadata_sha256":"a20ccfbc19cacfba4f491a77d16def37b37efa7eda6bbdc4c084088b8bdabd42","canonical_metadata_sha256":"c0eb484ac769c484274c4ce972e0408e0cbd9d4b59cdd3d9bad117c7e5073c3e"},"target":{"song_id":null,"canonical_id":"e74a7629-6482-4cb1-8177-7077d163c0a1","album_id":null,"stored_title":"Rain on Me","stored_artist":"Lady Gaga and Ariana Grande","track_position":1,"duration_ms":182000},"isrc":"USUM72004304","recording_id":"a0eb8c91-e3ce-4fef-a9d7-3d03753c6ece","release_id":"6a82f0ec-148f-4942-bb51-5423695f6da8","release_group_id":"06c74f2f-e1ee-4c32-aee0-3bbbbb02bd11","album_title":"Rain on Me","album_artist":"Lady Gaga & Ariana Grande","release_date":"2020-05-22","country":"XW","release_track_count":1,"evidence_sha256":"52ac04632ff5bccb9247ffb396b77e8acde9dedf659933d59fe70222c65fc4eb","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":2447,"title":"Rockstar","artist":"DaBaby featuring Roddy Ricch","chart_year":2020,"source_revision":"1380580667","source_entry_key":"2020:1371:dababy roddy ricch:rockstar","placeholder_canonical_id":"f03df823-d739-4002-a1f6-5b7ec7efddf8"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303+00:00","canonical_updated_at":"2026-10-23T14:53:07.351303+00:00","source_metadata_sha256":"bb354460da92840d44e31fa9273104e5ca8c92dbddbd6912106045831f091876","canonical_metadata_sha256":"2614c5414fdcf6813977c9478dfa3db934df0580e534b797da06ca6d1a95892d"},"target":{"song_id":null,"canonical_id":"f03df823-d739-4002-a1f6-5b7ec7efddf8","album_id":null,"stored_title":"Rockstar","stored_artist":"DaBaby featuring Roddy Ricch","track_position":1,"duration_ms":181000},"isrc":"USUM72007941","recording_id":"50a4f12b-8b19-4387-85e6-4ec98e1f2f69","release_id":"72c84d21-eb61-4b38-b65f-f82843c2f95b","release_group_id":"cb8e4abb-774d-4df3-aa40-d1d9770188b4","album_title":"ROCKSTAR","album_artist":"DaBaby feat. Roddy Ricch","release_date":"2020-04-17","country":"XW","release_track_count":1,"evidence_sha256":"23e0a76d696c42777db03dce5f1b1856384119d1987d4a406d2f434d901876ab","risk_notes":["The reviewed MusicBrainz recording is explicitly marked explicit; clean or alternate edits must not be substituted."]},{"action":"import_verified","chart_entry":{"id":2030,"title":"Take Me Back to London","artist":"Ed Sheeran featuring Stormzy","chart_year":2019,"source_revision":"1356457366","source_entry_key":"2019:1358:ed sheeran stormzy:take me back to london","placeholder_canonical_id":"332b8c84-c749-40d5-be40-f06f7050b091"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"1de1ed1cc97a66fd397819fbdc2b6a7217d9267f9c2181bfb3e1c0dbb8dd0553","canonical_metadata_sha256":"16be13269bff110dec101e242fd280f5d4e4c898c044f75a00e0bfa567814b60"},"target":{"song_id":null,"canonical_id":"332b8c84-c749-40d5-be40-f06f7050b091","album_id":null,"stored_title":"Take Me Back to London","stored_artist":"Ed Sheeran featuring Stormzy","track_position":4,"duration_ms":189733},"isrc":"GBAHS1900716","recording_id":"34a37727-9553-48f6-8ddf-a573f046b29d","release_id":"466d1739-d323-4128-8e80-a8b147b4e2e5","release_group_id":"852e109b-d04d-4bc2-a4b0-f0d1817480ec","album_title":"No.6 Collaborations Project","album_artist":"Ed Sheeran","release_date":"2019-07-12","country":"GB","release_track_count":15,"evidence_sha256":"d4a1a2ca653e067306ff2cf89b1eefc8b720b24b9b91b0651a3e129ee86e5087","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted.","This and Beautiful People intentionally share one reviewed official release; the operation must create that album once and attach both exact tracks."]},{"action":"import_verified","chart_entry":{"id":2029,"title":"Beautiful People","artist":"Ed Sheeran featuring Khalid","chart_year":2019,"source_revision":"1356457366","source_entry_key":"2019:1357:ed sheeran khalid:beautiful people","placeholder_canonical_id":"9179a83f-6a6e-4f1d-a383-7732e3211164"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"f65415e612adf0a109babd432860a0fa68cd7e8ace56744c97151e3c762c68d1","canonical_metadata_sha256":"b72c551790d1871f749c674bd8560ce8bea97e4c5088176af06b39bc0a91283d"},"target":{"song_id":null,"canonical_id":"9179a83f-6a6e-4f1d-a383-7732e3211164","album_id":null,"stored_title":"Beautiful People","stored_artist":"Ed Sheeran featuring Khalid","track_position":1,"duration_ms":197867},"isrc":"GBAHS1900713","recording_id":"611ffa00-29c1-46bc-843e-2f2168101ec8","release_id":"466d1739-d323-4128-8e80-a8b147b4e2e5","release_group_id":"852e109b-d04d-4bc2-a4b0-f0d1817480ec","album_title":"No.6 Collaborations Project","album_artist":"Ed Sheeran","release_date":"2019-07-12","country":"GB","release_track_count":15,"evidence_sha256":"c45a5c2798854e2516937711447dfd07745e97870eebdb3569ce987f2660f2e2","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted.","This and Take Me Back to London intentionally share one reviewed official release; the operation must create that album once and attach both exact tracks."]},{"action":"import_verified","chart_entry":{"id":2021,"title":"Shallow","artist":"Lady Gaga and Bradley Cooper","chart_year":2018,"source_revision":"1356457366","source_entry_key":"2018:1346:lady gaga and bradley cooper:shallow","placeholder_canonical_id":"316fe98f-2c2f-4103-bff7-29491d86c2ce"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"972ff78617c69399c75ce8e672e5e9ace582182cb51287fa11413017412411cb","canonical_metadata_sha256":"8d9cf87b39055734b81dc6ff905632f27fa920862f5876d158c8334583f79312"},"target":{"song_id":null,"canonical_id":"316fe98f-2c2f-4103-bff7-29491d86c2ce","album_id":null,"stored_title":"Shallow","stored_artist":"Lady Gaga and Bradley Cooper","track_position":1,"duration_ms":215000},"isrc":"USUM71813192","recording_id":"e8191687-56bf-4e69-860f-a898735ec268","release_id":"fe5944f9-293a-46b1-b7e2-73df7df989d1","release_group_id":"a8dbba8b-0c37-4352-8e88-0c5a01e1fe0c","album_title":"Shallow","album_artist":"Lady Gaga & Bradley Cooper","release_date":"2018-09-27","country":"XW","release_track_count":1,"evidence_sha256":"af80abe99c3fbfeddc29b7eef6963fc01a5057075ee81883f894451ddaf443e6","risk_notes":["MusicBrainz disambiguates the exact ISRC recording as with audience noises; studio or alternate versions must not be substituted."]},{"action":"import_verified","chart_entry":{"id":2019,"title":"Promises","artist":"Calvin Harris and Sam Smith","chart_year":2018,"source_revision":"1356457366","source_entry_key":"2018:1344:calvin harris and sam smith:promises","placeholder_canonical_id":"da9922da-fda4-4dc5-856a-ef17c77c485b"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"e31788dcfe707c2e946e484944ff09334d11ebf2c33ee200ac92ad83214cbbbe","canonical_metadata_sha256":"733cfda15cba18a6864e48081d36e63cb8a1fedd6de7908bc2ce790422cad401"},"target":{"song_id":null,"canonical_id":"da9922da-fda4-4dc5-856a-ef17c77c485b","album_id":null,"stored_title":"Promises","stored_artist":"Calvin Harris and Sam Smith","track_position":1,"duration_ms":213309},"isrc":"GBARL1801049","recording_id":"416612cb-759e-4b40-9e1c-ce560cf7ddaf","release_id":"6cc278f9-637f-4014-a296-a6022033658b","release_group_id":"b631b1ef-6b33-4876-8374-9108ed5b12bd","album_title":"Promises","album_artist":"Calvin Harris & Sam Smith","release_date":"2018-08-17","country":"XW","release_track_count":1,"evidence_sha256":"2c01d14f0c0608bbfa9fcad1e18710c1782b52dbb816d84aeb01455a158daf56","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":2007,"title":"River","artist":"Eminem featuring Ed Sheeran","chart_year":2018,"source_revision":"1356457366","source_entry_key":"2018:1333:eminem ed sheeran:river","placeholder_canonical_id":"3853a2c0-ea63-476f-8b4c-7aeacb4416c8"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"1d645c2c42a9c451f197631d432b43ffbf528d2eefb391b3f55f33b64e85a7e2","canonical_metadata_sha256":"e0d26a368031c25682e9c33fd432e2f10377733569725f24e2901a826b0465df"},"target":{"song_id":null,"canonical_id":"3853a2c0-ea63-476f-8b4c-7aeacb4416c8","album_id":null,"stored_title":"River","stored_artist":"Eminem featuring Ed Sheeran","track_position":5,"duration_ms":221013},"isrc":"USUM71712944","recording_id":"32d6bfe9-b231-4d5f-9034-61226f7d7d96","release_id":"72fb262d-c517-4e94-9f08-eefa95df8b34","release_group_id":"cfc62e61-686c-46cd-a453-608979646f71","album_title":"Revival","album_artist":"Eminem","release_date":"2017-12-15","country":"XE","release_track_count":19,"evidence_sha256":"d4c287b2313886fd92f533c9cd17bf8da07beef960600527f982aa3736146d58","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted.","The reviewed MusicBrainz recording is explicitly marked explicit; clean or alternate edits must not be substituted."]},{"action":"import_verified","chart_entry":{"id":2004,"title":"Rockstar","artist":"Post Malone featuring 21 Savage","chart_year":2017,"source_revision":"1356457366","source_entry_key":"2017:1330:post malone 21 savage:rockstar","placeholder_canonical_id":"dd7d96a6-b84d-411a-97ec-5eb42d22c2ba"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"939ed7dd14edb0eb020d6882bfca335022cccc5268a63955037b3b4241b3b380","canonical_metadata_sha256":"f7625c2662d5da42c5471df3aa5db6eb286037efc6f9855663a9375cdde70772"},"target":{"song_id":null,"canonical_id":"dd7d96a6-b84d-411a-97ec-5eb42d22c2ba","album_id":null,"stored_title":"Rockstar","stored_artist":"Post Malone featuring 21 Savage","track_position":1,"duration_ms":218000},"isrc":"USUM71710097","recording_id":"08cbf725-d3d1-48e7-8629-c9117e85d8f6","release_id":"067a0f7a-f63b-41ec-947d-7f07721119cb","release_group_id":"9af98551-17ee-4882-90da-981bb9bede7c","album_title":"rockstar","album_artist":"Post Malone feat. 21 Savage","release_date":"2017-09-15","country":"US","release_track_count":1,"evidence_sha256":"e646d9b4f5ac0f717fd446926792cf758a51acc188b4626cd2b21adac97fc7c4","risk_notes":["The exact Official Charts ISRC resolves to the clean version; the explicit recording must not be substituted."]},{"action":"import_verified","chart_entry":{"id":2002,"title":"Look What You Made Me Do","artist":"Taylor Swift","chart_year":2017,"source_revision":"1356457366","source_entry_key":"2017:1328:taylor swift:look what you made me do","placeholder_canonical_id":"062e4f47-6c80-4816-8b38-6e40554a993f"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"9942600a6e4cb5ebd55a4f096c66290892d4f86bcbbcecb4f65ee455866be4a6","canonical_metadata_sha256":"0317997484873163c1a18b8c6d46dfc714444e40c48cdabe7ff4db324255c24f"},"target":{"song_id":null,"canonical_id":"062e4f47-6c80-4816-8b38-6e40554a993f","album_id":null,"stored_title":"Look What You Made Me Do","stored_artist":"Taylor Swift","track_position":1,"duration_ms":211000},"isrc":"USCJY1750000","recording_id":"d06c9d0f-2dbf-4272-9c0d-6d182ca41c67","release_id":"ece1a954-47f1-4fd2-b041-ec57d43a28cc","release_group_id":"c2f50e2e-9280-4d24-9d90-e367a7d740b6","album_title":"Look What You Made Me Do","album_artist":"Taylor Swift","release_date":"2017-10-27","country":"AT","release_track_count":1,"evidence_sha256":"6a33dd193d595bd9686fc56e3ac2207f124a33d3e03b253ed33f966fd52f1c5d","risk_notes":["The exact Official Charts ISRC resolves the prior same-title ambiguity; alternate recordings must not be title-matched."]},{"action":"import_verified","chart_entry":{"id":1991,"title":"Closer","artist":"The Chainsmokers featuring Halsey","chart_year":2016,"source_revision":"1356457366","source_entry_key":"2016:1315:the chainsmokers halsey:closer","placeholder_canonical_id":"8f52cf33-df3d-453d-9038-89a437604b9c"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997+00:00","canonical_updated_at":"2026-10-23T13:28:00.017997+00:00","source_metadata_sha256":"a1f85bdb269d710c19cfaaf5da5afc76de4f71e11f8a7ac72b7eea5f535aa336","canonical_metadata_sha256":"a83b4ee903a6a5a99c56889328cd7dec55fc597933a397c4231c8fd193d31282"},"target":{"song_id":null,"canonical_id":"8f52cf33-df3d-453d-9038-89a437604b9c","album_id":null,"stored_title":"Closer","stored_artist":"The Chainsmokers featuring Halsey","track_position":1,"duration_ms":244000},"isrc":"USQX91601347","recording_id":"fb7963d0-d06f-45ca-a647-2b00a963179f","release_id":"1eb06cd0-1c8f-4535-b7d7-115c8d44eb01","release_group_id":"2c0acac5-36fe-4731-877c-c4812ad751d9","album_title":"Closer","album_artist":"The Chainsmokers ft. Halsey","release_date":"2016-07-29","country":"XW","release_track_count":1,"evidence_sha256":"9331d87097c38561c80613d6373bf0b849143e6ae67d316177545f118bf7c8bb","risk_notes":[]}],"rejected_version_leads":[{"chart_entry_id":1996,"title":"Symphony","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":1979,"title":"Easy Love","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":1968,"title":"See You Again","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":1959,"title":"Wake Me Up (Gareth Malone's All Star Choir)","reason_code":"stored_isrc_belongs_to_different_artist_version"},{"chart_entry_id":1913,"title":"Wake Me Up (Avicii)","reason_code":"isrc_maps_multiple_recording_versions"},{"chart_entry_id":1522,"title":"Beautiful Girls","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":1467,"title":"Call on Me","reason_code":"official_isrc_maps_filterheadz_remix_not_chart_version"},{"chart_entry_id":1418,"title":"Dilemma","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":107,"title":"Breathe","reason_code":"album_version_postdates_number_one_without_contemporaneous_bridge"},{"chart_entry_id":45,"title":"No Limit","reason_code":"contemporary_uk_single_uses_different_radio_edit_recording"},{"chart_entry_id":2491,"title":"Houdini","reason_code":"isrc_maps_music_video_not_audio_single"},{"chart_entry_id":2013,"title":"I'll Be There","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":2006,"title":"Perfect","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":2014,"title":"Solo","reason_code":"isrc_maps_multiple_recordings"}],"reviewed_incomplete_leads":[{"chart_entry_id":2485,"title":"Now and Then","reason_code":"official_charts_page_has_no_catalogue_identifier"},{"chart_entry_id":1545,"title":"Right Round","reason_code":"official_charts_catalogue_value_is_not_the_stored_isrc"},{"chart_entry_id":1437,"title":"Breathe (Blu Cantrell)","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":191,"title":"Lift Me Up","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":180,"title":"9 PM (Till I Come)","reason_code":"official_charts_song_page_not_found"},{"chart_entry_id":167,"title":"Fly Away","reason_code":"official_charts_catalogue_value_does_not_bridge_to_stored_isrc"},{"chart_entry_id":41,"title":"Sleeping Satellite","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":541,"title":"All Around the World","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":531,"title":"Like a Prayer","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":425,"title":"Ebony and Ivory","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":845,"title":"Message in a Bottle","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":2505,"title":"The Subway","reason_code":"official_charts_catalogue_value_is_not_an_isrc"},{"chart_entry_id":2501,"title":"Survive","reason_code":"release_level_verification_not_completed"},{"chart_entry_id":2500,"title":"Ordinary","reason_code":"musicbrainz_isrc_lookup_unavailable"},{"chart_entry_id":2486,"title":"Lovin on Me","reason_code":"musicbrainz_isrc_lookup_unavailable"},{"chart_entry_id":2476,"title":"Flowers","reason_code":"official_charts_page_has_no_catalogue_identifier"},{"chart_entry_id":2473,"title":"Anti-Hero","reason_code":"release_level_verification_not_completed"},{"chart_entry_id":2459,"title":"Body","reason_code":"official_isrc_absent_from_musicbrainz"}],"expected_deltas":{"albums":19,"songs":20,"canonical_recordings":0,"historical_chart_links":20,"ratings":0},"proposed_result":{"resolved_delta":20,"resolved_chart_entries":459,"remaining_unresolved_chart_entries":839},"safety_contract":{"atomic_transaction":true,"global_stale_baseline_abort":true,"per_candidate_stale_fingerprint_abort":true,"deterministic_advisory_lock_order":true,"immutable_private_operation_evidence":true,"preserve_all_song_ratings_byte_for_byte":true,"preserve_all_historical_chart_ratings_byte_for_byte":true,"preserve_first_batch_papa_dont_preach_reconciliation":true,"duplicate_and_partial_identity_abort":true,"shared_reviewed_release_insert_once":true,"rollback_operation_required":true,"production_execution_authorized":false}}$batch_manifest$::text as payload
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
  if (select count(*) from pg_temp.uk_number_ones_batch_3_manifest) <> 20
     or (select count(distinct chart_id) from pg_temp.uk_number_ones_batch_3_manifest) <> 20
     or (select count(distinct source_entry_key) from pg_temp.uk_number_ones_batch_3_manifest) <> 20
     or (select count(distinct placeholder_canonical_id) from pg_temp.uk_number_ones_batch_3_manifest) <> 20
     or (select count(distinct recording_id) from pg_temp.uk_number_ones_batch_3_manifest) <> 20
     or (select count(distinct release_id) from pg_temp.uk_number_ones_batch_3_manifest) <> 19
     or (select count(distinct release_group_id) from pg_temp.uk_number_ones_batch_3_manifest) <> 19
     or (select count(*) from pg_temp.uk_number_ones_batch_3_manifest
         where action = 'import_verified') <> 20
     or (select count(*) from pg_temp.uk_number_ones_batch_3_manifest
         where action = 'link_existing') <> 0 then
    raise exception 'embedded batch-3 manifest digest or shape failed';
  end if;
  if exists (
    select 1
    from pg_temp.uk_number_ones_batch_3_manifest
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
           or target_album_id is not null
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
    raise exception 'embedded batch-3 manifest action shape failed';
  end if;

  if exists (
    select 1
    from pg_temp.uk_number_ones_batch_3_manifest
    where action = 'import_verified'
    group by release_id
    having count(distinct release_group_id) <> 1
       or count(distinct album_title) <> 1
       or count(distinct album_artist) <> 1
       or count(distinct release_date) <> 1
       or count(distinct country) filter (where country is not null) > 1
  ) then
    raise exception 'embedded batch-3 shared release metadata failed';
  end if;

  if exists (
    select 1
    from pg_temp.uk_number_ones_batch_3_manifest
    where (
      action = 'import_verified'
      and release_track_count > 1
    ) is distinct from (
      risk_notes @> jsonb_build_array(
        'Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted.'::text
      )
    )
  ) then
    raise exception 'embedded batch-3 selected-track risk disclosure failed';
  end if;

  if (
    select coalesce(jsonb_agg(chart_id order by batch_order), '[]'::jsonb)
    from pg_temp.uk_number_ones_batch_3_manifest
    where action = 'import_verified'
      and release_track_count > 1
  ) is distinct from (
    select selected_track_import_chart_entry_ids
    from pg_temp.uk_number_ones_batch_3_manifest
    order by batch_order
    limit 1
  ) then
    raise exception 'embedded batch-3 selected-track disclosure set failed';
  end if;

  if exists (
    select 1
    from pg_temp.uk_number_ones_batch_3_manifest
    where source_release_note is distinct from
      'Miracle, Escapism, Cold Heart (Pnau remix), Take Me Back to London, Beautiful People and River use exact tracks on reviewed official multi-track releases; only those selected tracks are imported.'
  ) then
    raise exception 'embedded batch-3 selected-track release note failed';
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
      select 'bom-historical-reconciliation:20261124_uk_number_ones_verified_batch_3'::text
        as lock_key
      union all
      select 'bom-historical-chart:' || source_entry_key
      from pg_temp.uk_number_ones_batch_3_manifest
      union all
      select 'musicbrainz-recording:' || recording_id
      from pg_temp.uk_number_ones_batch_3_manifest
      union all
      select 'musicbrainz-release:' || release_id
      from pg_temp.uk_number_ones_batch_3_manifest
      where action = 'import_verified'
      union all
      select 'bom-admin-catalogue:' || release_group_id
      from pg_temp.uk_number_ones_batch_3_manifest
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

create temporary table uk_number_ones_batch_3_song_ratings_before
on commit drop
as select * from public.song_ratings;

create temporary table uk_number_ones_batch_3_historical_ratings_before
on commit drop
as select * from public.historical_chart_entry_ratings;

create temporary table uk_number_ones_batch_3_first_batch_audit_before
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

  if v_total <> 1298 or v_resolved <> 439 or v_unresolved <> 859
     or v_total <> v_resolved + v_unresolved then
    raise exception 'global chart baseline is stale';
  end if;
  if (select count(*) from public.albums) <> 1750
     or (select count(*) from public.songs) <> 16181
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
      '20261124_uk_number_ones_verified_batch_3'
  ) then
    raise exception 'batch-3 operation audit rows already exist';
  end if;
  if (select count(*)
      from private.historical_chart_reconciliation_operation_audit) <> 20 then
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
  v constant text := '20261124_uk_number_ones_verified_batch_3';
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
    from pg_temp.uk_number_ones_batch_3_manifest
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
        and a.is_deleted is not true;

      if found then
        if (select count(*) from public.albums
            where lower(coalesce(musicbrainz_release_id, '')) =
                    candidate.release_id
               or lower(coalesce(external_id, '')) = candidate.release_id
               or lower(coalesce(musicbrainz_release_group_id, '')) =
                    candidate.release_group_id) <> 1
           or not exists (
             select 1
             from private.historical_chart_reconciliation_operation_audit a
             join pg_temp.uk_number_ones_batch_3_manifest prior
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
           ) then
          raise exception 'unapproved existing shared release for %',
            candidate.source_entry_key;
        end if;
      else
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
      raise exception 'unsupported batch-3 action %', candidate.action;
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
          'Guarded UK No. 1 batch 3; evidence manifest '
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
  if (select count(*) from public.albums) <> 1769
     or (select count(*) from public.songs) <> 16201
     or (select count(*) from public.canonical_recordings) <> 17095 then
    raise exception 'batch-3 catalogue delta failed';
  end if;

  select
    count(*),
    count(*) filter (where song_id is not null),
    count(*) filter (where song_id is null and match_status = 'unresolved')
  into v_total, v_resolved, v_unresolved
  from public.quick_rate_collection_tracks
  where collection_key = 'uk-number-ones';

  if v_total <> 1298 or v_resolved <> 459 or v_unresolved <> 839
     or v_total <> v_resolved + v_unresolved then
    raise exception 'batch-3 chart delta failed';
  end if;

  if exists (
    (
      select * from pg_temp.uk_number_ones_batch_3_song_ratings_before
      except
      select * from public.song_ratings
    )
    union all
    (
      select * from public.song_ratings
      except
      select * from pg_temp.uk_number_ones_batch_3_song_ratings_before
    )
  ) then
    raise exception 'song ratings changed during batch 3';
  end if;

  if exists (
    (
      select *
      from pg_temp.uk_number_ones_batch_3_historical_ratings_before
      except
      select * from public.historical_chart_entry_ratings
    )
    union all
    (
      select * from public.historical_chart_entry_ratings
      except
      select *
      from pg_temp.uk_number_ones_batch_3_historical_ratings_before
    )
  ) then
    raise exception 'historical chart ratings changed during batch 3';
  end if;

  if exists (
    (
      select *
      from pg_temp.uk_number_ones_batch_3_first_batch_audit_before
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
      from pg_temp.uk_number_ones_batch_3_first_batch_audit_before
    )
  ) then
    raise exception 'first-batch rating audit changed during batch 3';
  end if;

  if (select count(*)
      from private.historical_chart_reconciliation_operation_audit
      where operation_key =
          '20261124_uk_number_ones_verified_batch_3'
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
       from pg_temp.uk_number_ones_batch_3_manifest m
       left join private.historical_chart_reconciliation_operation_audit a
         on a.operation_key =
              '20261124_uk_number_ones_verified_batch_3'
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
    raise exception 'batch-3 immutable operation audit failed';
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
    raise exception 'batch-3 created duplicate canonical recording MBIDs';
  end if;
end
$postconditions$;

commit;
