begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Execution-role contract: run this reviewed operation only as the migration
-- owner/postgres role. The service role intentionally has no UPDATE, DELETE or
-- TRUNCATE privilege needed for the explicit high-strength table locks below.
-- Reviewed batch 2 is inert unless an operator supplies the exact independent
-- approval token at session scope. The operation never sets its own approval.
do $approval$
declare
  v_expected constant text :=
    '20261123_uk_number_ones_verified_batch_2:474f1b4dba9620b9195f143a1b14cc10dfccffc67b1cadf9558570acafba18fc';
begin
  if nullif(current_setting('bom.approved_historical_reconciliation', true), '')
       is distinct from v_expected then
    raise exception 'batch-2 approval token missing or does not match the reviewed manifest';
  end if;
end
$approval$;

create temporary table uk_number_ones_batch_2_manifest
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
  candidate.item->>'evidence_sha256' as evidence_sha256
from (
  select payload
  from (
    select $batch_manifest${"operation_key":"20261123_uk_number_ones_verified_batch_2","snapshot":{"captured_at":"2026-11-23T13:59:56.371326Z","raw_snapshot_sha256":"a271c5e335af07943652d45a5f71a34c402cf75a541ec4d04b6da66225eeade0","row_identity_sha256":"2db427f65412250956c39f7d9d39ee3b9498ff78af3b52e047ed16f21f1f9126","candidate_state_artifact":"historical-uk-number-ones-verified-batch-2-live-state-20261123.json","candidate_state_sha256":"90492794feff32e2fb3ff334e96f89a133c741f83c20bfa848183a85ed9de70c","production_integrity":{"total_chart_entries":1298,"resolved_chart_entries":419,"unresolved_chart_entries":879,"albums":1731,"songs":16162,"canonical_recordings":17095,"duplicate_recording_mbids":0,"song_rating_rows":1747,"song_rating_sum":13454,"invalid_song_rating_rows":0,"historical_rating_rows":5,"historical_rating_sum":43,"first_batch_rating_reconciliation_audit_rows":1}},"audit_coverage":{"inventory_rows_classified":879,"verified_existing_link":1,"verified_catalogue_import":19,"explicit_ambiguous_or_version_conflict":11,"insufficient_authoritative_evidence":848,"reviewed_but_not_selected":28,"remaining_inventory_without_a_complete_evidence_chain":831,"method":"Every unresolved row was inventoried. Only rows with an exact Official Charts identifier, a unique MusicBrainz ISRC recording, a reviewed official release track, and a clean live-catalogue collision check were promoted."},"selection_policy":{"batch_size":20,"min_batch_size":20,"max_batch_size":25,"ordering":"recent-first, then chart entry id descending","force_matching_prohibited":true,"all_candidates_unrated":true,"source_release_note":"Shotgun, Stay with Me, Daisies and Godzilla use exact tracks on reviewed official multi-track releases; this matches the selected-track import semantics established by PR #46."},"candidates":[{"action":"import_verified","chart_entry":{"id":2503,"source_entry_key":"2025:1441:justin bieber:daisies","chart_year":2025,"title":"Daisies","artist":"Justin Bieber","placeholder_canonical_id":"205ae581-5bfe-42bc-9a59-85b68ef69bfd","source_revision":"1380580667"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303Z","canonical_updated_at":"2026-10-23T14:53:07.351303Z","source_metadata_sha256":"11941adafc2a4c2eea0c546c732859e59438782d21f28444418993a37e7b9d92","canonical_metadata_sha256":"2d61723477187afde3d1d43a5029dde27e5d09980ef7f4a70d60cabb34c1bdbe"},"target":{"song_id":null,"canonical_id":"205ae581-5bfe-42bc-9a59-85b68ef69bfd","album_id":null,"stored_title":"Daisies","stored_artist":"Justin Bieber","track_position":2,"duration_ms":176000},"isrc":"USUG12504304","recording_id":"6be45a90-ae92-42ac-bc56-925e4454ba60","release_id":"561c8bbe-26f6-4232-93a7-735186b34456","release_group_id":"fe9cce8b-2f9e-4016-b6cb-859d4d3d0d5d","album_title":"SWAG","album_artist":"Justin Bieber","release_date":"2025-07-11","country":"XW","evidence_sha256":"14ddb2beb2b1283b7a23737a90d3c4e58dd711beac64742b0c73e488cee282ed","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted."]},{"action":"import_verified","chart_entry":{"id":2489,"source_entry_key":"2024:1424:hozier:too sweet","chart_year":2024,"title":"Too Sweet","artist":"Hozier","placeholder_canonical_id":"6db536b6-3676-4b8c-8316-19e203f82865","source_revision":"1380580667"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303Z","canonical_updated_at":"2026-10-23T14:53:07.351303Z","source_metadata_sha256":"04df401ccb03b133d0a3691dc1257fd89d18038aece3adefbf5a0b3e6f940446","canonical_metadata_sha256":"3a1abd81eb07398906e10be5949425cc05d8d83ea681154547921849b4226ef2"},"target":{"song_id":null,"canonical_id":"6db536b6-3676-4b8c-8316-19e203f82865","album_id":null,"stored_title":"Too Sweet","stored_artist":"Hozier","track_position":1,"duration_ms":251424},"isrc":"IEACJ2300335","recording_id":"272be1e2-9599-4b8d-b872-5e879881d103","release_id":"9e773c80-86fe-47ae-b96f-ca9b7e1876c8","release_group_id":"bba57a38-1823-4b37-a999-ddc7654757e8","album_title":"Unheard","album_artist":"Hozier","release_date":"2024-03-22","country":"XW","evidence_sha256":"c969335378e351134b38ab17cec65fe7a52d2924bd0c184aaadda49e9554b1fc","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":2488,"source_entry_key":"2024:1422:beyonce:texas hold em","chart_year":2024,"title":"Texas Hold 'Em","artist":"Beyoncé","placeholder_canonical_id":"8fadf844-3c4a-4d54-96c9-7a43e41a9071","source_revision":"1380580667"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303Z","canonical_updated_at":"2026-10-23T14:53:07.351303Z","source_metadata_sha256":"75c57115f6e19547bb63cd5ffda8cff3e72cf1f8612bd51a42fc8527e6fbae3b","canonical_metadata_sha256":"e5ff3ec1262c0db733d100342462821388f5eebfb99d2cdec4e541117e45f1a1"},"target":{"song_id":null,"canonical_id":"8fadf844-3c4a-4d54-96c9-7a43e41a9071","album_id":null,"stored_title":"Texas Hold 'Em","stored_artist":"Beyoncé","track_position":1,"duration_ms":236000},"isrc":"USSM12401302","recording_id":"2d947ada-862c-452e-95a6-091edd4330ee","release_id":"579fd7f8-0791-424a-a1e2-2e60518d9709","release_group_id":"9f9306ab-fe7a-44d3-9ddb-6a36bcceda73","album_title":"TEXAS HOLD ’EM","album_artist":"Beyoncé","release_date":"2024-02-11","country":null,"evidence_sha256":"bc4a7efe48b66add54203b3807c07df0b531c5110197c52cb4d879e1f15f4cc8","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":2483,"source_entry_key":"2023:1417:kenya grace:strangers","chart_year":2023,"title":"Strangers","artist":"Kenya Grace","placeholder_canonical_id":"e071f663-46f3-443f-85be-641aecf5071f","source_revision":"1380580667"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303Z","canonical_updated_at":"2026-10-23T14:53:07.351303Z","source_metadata_sha256":"40ee7e70e7cf715eafaa9d9e000a6b21959f4f6f209d06e8fc7d60485ac5578c","canonical_metadata_sha256":"a74c5e75aea3d3c44ff22fe8fcd5249cc9396871a2701ae4f0bfce312da0d816"},"target":{"song_id":null,"canonical_id":"e071f663-46f3-443f-85be-641aecf5071f","album_id":null,"stored_title":"Strangers","stored_artist":"Kenya Grace","track_position":1,"duration_ms":172964},"isrc":"USWB12305048","recording_id":"d41e7f0b-ab24-4212-9b81-02f6e876d6d2","release_id":"806c5890-198b-4ffc-8ce1-cc0b5dc60c5d","release_group_id":"725ed5e5-cdad-49a3-af8b-6c7c59ad1c61","album_title":"Strangers","album_artist":"Kenya Grace","release_date":"2023-09-01","country":null,"evidence_sha256":"a9ef4d00460df4fa711d5385677296eef8bf52c59f9be6d1f29adac37548c164","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":2468,"source_entry_key":"2022:1396:dave:starlight","chart_year":2022,"title":"Starlight","artist":"Dave","placeholder_canonical_id":"93449649-93bf-431a-891e-8d961aac2cad","source_revision":"1380580667"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303Z","canonical_updated_at":"2026-10-23T14:53:07.351303Z","source_metadata_sha256":"f08a6d79d5c4ad4f30079f77ba63b6cfaf88ff332070fbcc06277725627f7ec6","canonical_metadata_sha256":"3abd4d1ac4d84ff9a4def61ae0daba2701fdd304474230be0e0ab22d0f64305e"},"target":{"song_id":null,"canonical_id":"93449649-93bf-431a-891e-8d961aac2cad","album_id":null,"stored_title":"Starlight","stored_artist":"Dave","track_position":1,"duration_ms":211935},"isrc":"GBUM72201160","recording_id":"fe987f4d-c05b-4afd-b79b-5e35aee763e9","release_id":"c3f1fb0c-f009-4381-bbae-08cb94bd410b","release_group_id":"a65bd8d9-9d77-4779-9650-c2f9a1514637","album_title":"Starlight","album_artist":"Dave","release_date":"2022-03-03","country":"XW","evidence_sha256":"712a2f49a0e73e59b89dc2dea41ac40df53e36fd929984b39ca7a0e6d483c2e5","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":2460,"source_entry_key":"2021:1388:ed sheeran:bad habits","chart_year":2021,"title":"Bad Habits","artist":"Ed Sheeran","placeholder_canonical_id":"c5c0a5e6-ef1a-4692-9e73-c2e7f660ee3b","source_revision":"1380580667"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303Z","canonical_updated_at":"2026-10-23T14:53:07.351303Z","source_metadata_sha256":"8d6a7b3ac99a82cdc1fcc0c9d4432e6a23d160159b8115fb7e214fd319a24615","canonical_metadata_sha256":"2219f12a2258c2750e94e723217aff2f771d8e6e526d5966b1b515e0f3b3054b"},"target":{"song_id":null,"canonical_id":"c5c0a5e6-ef1a-4692-9e73-c2e7f660ee3b","album_id":null,"stored_title":"Bad Habits","stored_artist":"Ed Sheeran","track_position":1,"duration_ms":231041},"isrc":"GBAHS2100318","recording_id":"2d24a8d7-66ad-40b2-8ae7-5f6fc9981646","release_id":"1d13b9ff-f267-4c53-b8b1-0c8d7328dcee","release_group_id":"08a4883b-4a5e-4974-b2bd-f200d9702f89","album_title":"Bad Habits","album_artist":"Ed Sheeran","release_date":"2021-06-25","country":"XW","evidence_sha256":"f4223b304f6ac7d51cad180d90e727baf0679ae7dd72f182c8191fe6db006af0","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":2454,"source_entry_key":"2020:1378:ariana grande:positions","chart_year":2020,"title":"Positions","artist":"Ariana Grande","placeholder_canonical_id":"b86cb30b-3d50-48eb-a53c-aaf9454e469c","source_revision":"1380580667"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303Z","canonical_updated_at":"2026-10-23T14:53:07.351303Z","source_metadata_sha256":"97f2b8de7f930ef1703ea3b02daf8f008c7268bef275a20b8c0d5c1057c5d2e0","canonical_metadata_sha256":"de9efed47063bf3f31eb52442d9331046cdace26f29e6882855cab0e58e1f8fd"},"target":{"song_id":null,"canonical_id":"b86cb30b-3d50-48eb-a53c-aaf9454e469c","album_id":null,"stored_title":"Positions","stored_artist":"Ariana Grande","track_position":1,"duration_ms":172324},"isrc":"USUM72019412","recording_id":"9ccbc110-3d50-498f-9edc-6bcdef21ab0c","release_id":"ec1c27e7-768d-4458-a73f-03503fe2bfd5","release_group_id":"438d86bf-b03b-4d9a-8022-3d4807926926","album_title":"positions","album_artist":"Ariana Grande","release_date":"2020-10-23","country":"XW","evidence_sha256":"07425bdf76d38a94ce03467c465227a7acaa62710ca419e52473f0d8fa9a54ff","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":2452,"source_entry_key":"2020:1376:24kgoldn iann dior:mood","chart_year":2020,"title":"Mood","artist":"24kGoldn featuring Iann Dior","placeholder_canonical_id":"1f4cb0c8-8263-4a2a-beb6-66c5e518db1b","source_revision":"1380580667"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303Z","canonical_updated_at":"2026-10-23T14:53:07.351303Z","source_metadata_sha256":"54c0b198ae6545507ac4380168dcd128b9c2aa8c109940ee2a5c1d27ef81bb78","canonical_metadata_sha256":"6e536b2dfd2d8897e9c7b9f935341b5cd3146d5dcd65909f60a5ad613c860640"},"target":{"song_id":null,"canonical_id":"1f4cb0c8-8263-4a2a-beb6-66c5e518db1b","album_id":null,"stored_title":"Mood","stored_artist":"24kGoldn featuring Iann Dior","track_position":1,"duration_ms":140525},"isrc":"USQX92003025","recording_id":"b2688f22-2e08-43bc-b206-17ca9599e83b","release_id":"8eac58d2-c46f-40a6-a9cf-a3f9691e65f0","release_group_id":"70363b9a-3756-4412-808f-80a389053eb1","album_title":"Mood","album_artist":"24kGoldn ft. iann dior","release_date":"2020-07-24","country":"AF","evidence_sha256":"1339eb84366697fc687239eccff19aba5454ff6fbabf8afeba730c09fdb07a34","risk_notes":["MusicBrainz country is anomalously AF; identity is supported by the exact Official Charts ISRC, unique MusicBrainz recording, and official Columbia/RECORDS single."]},{"action":"import_verified","chart_entry":{"id":2451,"source_entry_key":"2020:1375:cardi b megan thee stallion:wap","chart_year":2020,"title":"WAP","artist":"Cardi B featuring Megan Thee Stallion","placeholder_canonical_id":"64ac44f9-c3af-411b-bbdb-dc042a3f9c38","source_revision":"1380580667"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303Z","canonical_updated_at":"2026-10-23T14:53:07.351303Z","source_metadata_sha256":"99c2196d45aec4ae1e99fb25b62e4cae0f995a97dbea53570e3f175cf7a5104d","canonical_metadata_sha256":"36ec2e8e1717f456307307500c7f12f539dd9fb60e9716ce9f103ac3d670831c"},"target":{"song_id":null,"canonical_id":"64ac44f9-c3af-411b-bbdb-dc042a3f9c38","album_id":null,"stored_title":"WAP","stored_artist":"Cardi B featuring Megan Thee Stallion","track_position":1,"duration_ms":187541},"isrc":"USAT22005111","recording_id":"3af602f0-e273-4d66-83c2-8d55243cc56b","release_id":"8bb5807f-d41a-4484-a8bb-024b8fdc9c6e","release_group_id":"49deb866-e5b1-400d-8464-45ab63191ed6","album_title":"WAP","album_artist":"Cardi B feat. Megan Thee Stallion","release_date":"2020-08-07","country":"XW","evidence_sha256":"b599ef0b8b7869ea9e1a84b9b9593ed4601f50ac69fe52828cfd44d3e1ad0353","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":2441,"source_entry_key":"2020:1363:eminem juice wrld:godzilla","chart_year":2020,"title":"Godzilla","artist":"Eminem featuring Juice Wrld","placeholder_canonical_id":"2b6d4e8b-cb94-4bf3-adf9-347e81dfb470","source_revision":"1380580667"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T14:53:07.351303Z","canonical_updated_at":"2026-10-23T14:53:07.351303Z","source_metadata_sha256":"7aafb5ef913eebf6715c25b6770e638d84ae5ab54f659b98954373eeb6230416","canonical_metadata_sha256":"b8922b74fe3c5e9faf88b10b937c7ebf47c6a8a0fa27633e72668e0da7884550"},"target":{"song_id":null,"canonical_id":"2b6d4e8b-cb94-4bf3-adf9-347e81dfb470","album_id":null,"stored_title":"Godzilla","stored_artist":"Eminem featuring Juice Wrld","track_position":7,"duration_ms":210800},"isrc":"USUM72000788","recording_id":"3b1808a9-a935-46ae-add1-7485af7e67e1","release_id":"1fb7517b-2fb9-40ec-910f-0a3a514fb70c","release_group_id":"bc217c64-db43-4311-9b73-fca6d25c4ac5","album_title":"Music to Be Murdered By","album_artist":"Eminem","release_date":"2020-01-17","country":"XW","evidence_sha256":"41e30b0aa5affd14d3f721e716f9c33788ccf2d697e421b04463e7a8b5bf1f6e","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted."]},{"action":"import_verified","chart_entry":{"id":2022,"source_entry_key":"2018:1347:ariana grande:thank u next","chart_year":2018,"title":"Thank U, Next","artist":"Ariana Grande","placeholder_canonical_id":"ea463c6e-f79c-4236-b0ac-aad36ffb850c","source_revision":"1356457366"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997Z","canonical_updated_at":"2026-10-23T13:28:00.017997Z","source_metadata_sha256":"c9f03f6ff0fdc6fbc9c741ba59d1f9bacc5866d6cd2631f2306a05734c7c2fd7","canonical_metadata_sha256":"6f166f31edefd38eff231f343fb3940c2d12a07c4ae560cb7782c4cb94748171"},"target":{"song_id":null,"canonical_id":"ea463c6e-f79c-4236-b0ac-aad36ffb850c","album_id":null,"stored_title":"Thank U, Next","stored_artist":"Ariana Grande","track_position":1,"duration_ms":207000},"isrc":"USUM71819361","recording_id":"274b3a7b-64bd-4af3-9af9-dd41277ddc17","release_id":"52cbc5d7-7194-428e-8c69-b62414c1d25e","release_group_id":"b6728a22-1934-4840-92ec-096944f20e12","album_title":"thank u, next","album_artist":"Ariana Grande","release_date":"2018-11-03","country":"XW","evidence_sha256":"7a158cfbe796a1ced7cc9f69bbb09e576835a7b421d15a0c24bbd8f8af11e311","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":2015,"source_entry_key":"2018:1341:george ezra:shotgun","chart_year":2018,"title":"Shotgun","artist":"George Ezra","placeholder_canonical_id":"358ded20-02ed-44e5-937e-fde356950e67","source_revision":"1356457366"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997Z","canonical_updated_at":"2026-10-23T13:28:00.017997Z","source_metadata_sha256":"d5832aed077daab437c1f51746ab3132cb57b1eb3013be668f3bf6601c36c32e","canonical_metadata_sha256":"4c2268c117bee594ca87d287b37bec7b293a9b459c0b9dd99980c8bceecee833"},"target":{"song_id":null,"canonical_id":"358ded20-02ed-44e5-937e-fde356950e67","album_id":null,"stored_title":"Shotgun","stored_artist":"George Ezra","track_position":4,"duration_ms":201293},"isrc":"GBARL1701372","recording_id":"81614e2f-298e-4644-aaed-36fe57fb1eb3","release_id":"210dc0d8-d828-446e-b6cd-f27c8d7508f2","release_group_id":"26a02214-cdc6-4297-b434-a225af91c658","album_title":"Staying at Tamara’s","album_artist":"George Ezra","release_date":"2018-03-23","country":"XE","evidence_sha256":"d95d5f7a58088494d8298a0fc3fcacd7ad307b97ef4236d76ee088bc9f55b060","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted."]},{"action":"import_verified","chart_entry":{"id":1989,"source_entry_key":"2016:1313:drake wizkid and kyla:one dance","chart_year":2016,"title":"One Dance","artist":"Drake featuring Wizkid and Kyla","placeholder_canonical_id":"21a718c5-d7ca-40f5-b553-a42365a48212","source_revision":"1356457366"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997Z","canonical_updated_at":"2026-10-23T13:28:00.017997Z","source_metadata_sha256":"cb5b644db81211313c3db0e99c4de9e1972fc13331f215f02ef4ae555906c2ee","canonical_metadata_sha256":"f76fd500f423963df0c3703f76b9bb78cc95776509fb992bf51d03296348b11a"},"target":{"song_id":null,"canonical_id":"21a718c5-d7ca-40f5-b553-a42365a48212","album_id":null,"stored_title":"One Dance","stored_artist":"Drake featuring Wizkid and Kyla","track_position":1,"duration_ms":173000},"isrc":"USCM51600028","recording_id":"be9e4a6b-3f56-468a-aa61-b1bcb6fc277f","release_id":"e2f55bbb-a03a-4f83-8122-a536406a1e69","release_group_id":"626d569f-adaf-4fff-a326-9adc0158a01f","album_title":"One Dance","album_artist":"Drake feat. WizKid & Kyla","release_date":"2016-04-05","country":"XW","evidence_sha256":"8d8a029170d9c4fd632fdc2a7b428a14cc5a0fd43692a14a4bd385a30a233e25","risk_notes":["A same-title Drake catalogue song is a different MusicBrainz recording and ISRC; the operation must not title-link it."]},{"action":"import_verified","chart_entry":{"id":1969,"source_entry_key":"2015:1291:omi:cheerleader","chart_year":2015,"title":"Cheerleader","artist":"Omi","placeholder_canonical_id":"e85e0ffd-3bf5-48e7-af33-370f91946238","source_revision":"1356457366"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997Z","canonical_updated_at":"2026-10-23T13:28:00.017997Z","source_metadata_sha256":"48135363a68c9c7337d7affda6709e67c6d173cbef9ab6ad7529ac6d98f43118","canonical_metadata_sha256":"095543032123a8e08d30962b40fea5ea73adcd256b86a7c675806d40916f11e3"},"target":{"song_id":null,"canonical_id":"e85e0ffd-3bf5-48e7-af33-370f91946238","album_id":null,"stored_title":"Cheerleader","stored_artist":"Omi","track_position":1,"duration_ms":180021},"isrc":"USUS11202574","recording_id":"3d05947b-f269-43da-8e4a-c7596533ea67","release_id":"43d34384-0b41-4353-bbe5-60045fc6efb5","release_group_id":"86991689-9595-4de3-b14d-c7f1ea4caac5","album_title":"Cheerleader (Felix Jaehn Remix Radio Edit)","album_artist":"Omi","release_date":"2014-05-19","country":"XW","evidence_sha256":"219d0dc3048b80fa0c5e6a4ef96040e8ce3ef11b10c07920866c0e03903ca4d5","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":1940,"source_entry_key":"2014:1262:sam smith:stay with me","chart_year":2014,"title":"Stay with Me","artist":"Sam Smith","placeholder_canonical_id":"919c18cb-b30a-44dc-89c0-42374704ccf8","source_revision":"1356457366"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997Z","canonical_updated_at":"2026-10-23T13:28:00.017997Z","source_metadata_sha256":"099569d87aa52bda0c8d8264e4cfae73bb3d1936ba67124123835f066b7ef11c","canonical_metadata_sha256":"cf7cb8805e9bfc16bc4593db412f0c35279a79ac6a3e484d1cbfb07abf2bba65"},"target":{"song_id":null,"canonical_id":"919c18cb-b30a-44dc-89c0-42374704ccf8","album_id":null,"stored_title":"Stay with Me","stored_artist":"Sam Smith","track_position":3,"duration_ms":172680},"isrc":"GBUM71308833","recording_id":"e4c0494d-5ab6-479a-a527-cfdc41f7c595","release_id":"003b2d0a-2c85-43f2-bc69-c5587daef8d3","release_group_id":"c8d660d1-4181-4a5b-9507-346970dffe96","album_title":"In the Lonely Hour","album_artist":"Sam Smith","release_date":"2014-05-26","country":"GB","evidence_sha256":"868b91359ff90f0a73e9d85be2ba6332f07a8cba51345a278d93b92b76180f5c","risk_notes":["Selected-track import from a reviewed multi-track official release; only the verified chart track is inserted."]},{"action":"import_verified","chart_entry":{"id":1926,"source_entry_key":"2014:1248:pharrell williams:happy","chart_year":2014,"title":"Happy","artist":"Pharrell Williams","placeholder_canonical_id":"ea11b619-fe8c-4e8e-9ec1-731213aa4c3e","source_revision":"1356457366"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997Z","canonical_updated_at":"2026-10-23T13:28:00.017997Z","source_metadata_sha256":"31bafe31f424364d3d2dadc23c31afff5fe608442a17081aa3c56282096521ec","canonical_metadata_sha256":"bc82fa45d3212bef0d8373cfe13e25294e2495b4b37f239dbfb89473dfe7e34d"},"target":{"song_id":null,"canonical_id":"ea11b619-fe8c-4e8e-9ec1-731213aa4c3e","album_id":null,"stored_title":"Happy","stored_artist":"Pharrell Williams","track_position":1,"duration_ms":233000},"isrc":"USQ4E1300686","recording_id":"f367ad6e-efd5-4496-aba5-21a4edcd82c6","release_id":"75f43353-fbe4-41b5-9ee8-c8c562e00480","release_group_id":"79796d6a-eed3-42d3-85fb-1b9a015bc1a8","album_title":"Happy","album_artist":"Pharrell Williams","release_date":"2013-12-16","country":"US","evidence_sha256":"9cc70580b7574a6736ad450cb9bdc6c373deccfa63751eab3c75d7271fa84416","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":1919,"source_entry_key":"2013:1240:miley cyrus:wrecking ball","chart_year":2013,"title":"Wrecking Ball","artist":"Miley Cyrus","placeholder_canonical_id":"147d5dcb-d930-40da-a670-bff994740a9e","source_revision":"1356457366"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T13:28:00.017997Z","canonical_updated_at":"2026-10-23T13:28:00.017997Z","source_metadata_sha256":"009db909394714ed21b9ec1127702de4f462d7b20df0161b2ba0adbc1295cfef","canonical_metadata_sha256":"9398b6aef6c5f1dad661bda628d3e6e2d8cd9c80c28e09fd85d9ffbba7d67b71"},"target":{"song_id":null,"canonical_id":"147d5dcb-d930-40da-a670-bff994740a9e","album_id":null,"stored_title":"Wrecking Ball","stored_artist":"Miley Cyrus","track_position":1,"duration_ms":223240},"isrc":"USRC11301214","recording_id":"8c8b2d45-6043-47c5-8c12-16fb8050817b","release_id":"ac162d2d-7a61-4a7b-b83f-1189eacf9454","release_group_id":"28bcd5ce-4245-45fc-8e61-303fd9b3ea87","album_title":"Wrecking Ball","album_artist":"Miley Cyrus","release_date":"2013-08-25","country":"US","evidence_sha256":"1ffe18f1a5534141b3c2df33562b040f64f9f3df64c85e0ae3c86511deedc6b9","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":1552,"source_entry_key":"2009:1098:david guetta kelly rowland:when love takes over","chart_year":2009,"title":"When Love Takes Over","artist":"David Guetta featuring Kelly Rowland","placeholder_canonical_id":"abff20d9-abaf-46a7-ae47-c17773d78362","source_revision":"1380229024"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T12:46:12.603787Z","canonical_updated_at":"2026-10-23T12:46:12.603787Z","source_metadata_sha256":"379b039ce85bcf69baa85dba56d2d810ede9ccbe8ed223dd5a6322757eeab756","canonical_metadata_sha256":"379b039ce85bcf69baa85dba56d2d810ede9ccbe8ed223dd5a6322757eeab756"},"target":{"song_id":null,"canonical_id":"abff20d9-abaf-46a7-ae47-c17773d78362","album_id":null,"stored_title":"When Love Takes Over","stored_artist":"David Guetta featuring Kelly Rowland","track_position":1,"duration_ms":203000},"isrc":"FRZID0900210","recording_id":"e17a4f6d-42c7-428e-b8ea-4dd5bee4d34a","release_id":"2f0c2a89-c3a2-4763-9a0f-3b4b5a351c9b","release_group_id":"3ac3e564-9dcf-4afc-8e52-8822f45e10cf","album_title":"When Love Takes Over","album_artist":"David Guetta feat. Kelly Rowland","release_date":"2009-06-15","country":"GB","evidence_sha256":"b692117cc72d16114f199d60aa000a688b1ba4d25e68ba74e7ff5ef33e2865a0","risk_notes":[]},{"action":"link_existing","chart_entry":{"id":1519,"source_entry_key":"2007:1058:rihanna jay z:umbrella","chart_year":2007,"title":"Umbrella","artist":"Rihanna featuring Jay-Z","placeholder_canonical_id":"b07348a4-406c-4f8c-9d81-fdb0147d6659","source_revision":"1380229024"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T12:46:12.603787Z","canonical_updated_at":"2026-10-23T12:46:12.603787Z","source_metadata_sha256":"e3160910a375abd751c52d36e65d6edb97a8e387d48a50f2e4852971bebd0a77","canonical_metadata_sha256":"e3160910a375abd751c52d36e65d6edb97a8e387d48a50f2e4852971bebd0a77"},"target":{"song_id":11020,"canonical_id":"c7f9abc5-7fd7-483b-b557-6c32ed716db5","album_id":816,"stored_title":"Umbrella","stored_artist":"Rihanna","track_position":1,"duration_ms":null},"isrc":"USUM70736771","recording_id":"0b4b1b0c-e057-4d8d-9a47-12a97ff6fb3d","release_id":"768695cf-35fa-4919-9090-25c5200e6836","release_group_id":"7e48f018-b774-32e6-a68b-b42db04535c0","album_title":"Good Girl Gone Bad","album_artist":"Rihanna","release_date":"2007-06-04","country":"GB","evidence_sha256":"4f5f8e386c5b1d08fcd6a9ead9efcbed48b820c27d6a3d4dc9af40f2c36056b5","risk_notes":[]},{"action":"import_verified","chart_entry":{"id":1353,"source_entry_key":"2000:865:the corrs:breathless","chart_year":2000,"title":"Breathless","artist":"The Corrs","placeholder_canonical_id":"ec59bc93-7176-454a-b982-7fb715d89bfb","source_revision":"1380229024"},"stale_state_fingerprint":{"chart_updated_at":"2026-10-23T12:46:12.603787Z","canonical_updated_at":"2026-10-23T12:46:12.603787Z","source_metadata_sha256":"2543db61f414cf7e4c8cd60f834429fe124f37e7ba220caa51329a5ff6c26b53","canonical_metadata_sha256":"2543db61f414cf7e4c8cd60f834429fe124f37e7ba220caa51329a5ff6c26b53"},"target":{"song_id":null,"canonical_id":"ec59bc93-7176-454a-b982-7fb715d89bfb","album_id":null,"stored_title":"Breathless","stored_artist":"The Corrs","track_position":1,"duration_ms":209133},"isrc":"USAT20001907","recording_id":"fe0b0eb0-fb63-4603-8df2-a82b5207f2bb","release_id":"f1b5c2ff-6715-3bbb-8ac6-789fd5c0b540","release_group_id":"74ef08a1-0817-3e22-9cef-c52e3057b3a7","album_title":"Breathless","album_artist":"The Corrs","release_date":"2000-07-03","country":"GB","evidence_sha256":"c7e02d3f006b863fa07efaeeaa007f01da5b87048fe9fd8e2b77e1eb4daa7143","risk_notes":[]}],"rejected_version_leads":[{"chart_entry_id":1996,"title":"Symphony","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":1979,"title":"Easy Love","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":1968,"title":"See You Again","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":1959,"title":"Wake Me Up (Gareth Malone's All Star Choir)","reason_code":"stored_isrc_belongs_to_different_artist_version"},{"chart_entry_id":1913,"title":"Wake Me Up (Avicii)","reason_code":"isrc_maps_multiple_recording_versions"},{"chart_entry_id":1522,"title":"Beautiful Girls","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":1467,"title":"Call on Me","reason_code":"official_isrc_maps_filterheadz_remix_not_chart_version"},{"chart_entry_id":1418,"title":"Dilemma","reason_code":"isrc_maps_multiple_recordings"},{"chart_entry_id":107,"title":"Breathe","reason_code":"album_version_postdates_number_one_without_contemporaneous_bridge"},{"chart_entry_id":45,"title":"No Limit","reason_code":"contemporary_uk_single_uses_different_radio_edit_recording"},{"chart_entry_id":2491,"title":"Houdini","reason_code":"isrc_maps_music_video_not_audio_single"}],"reviewed_incomplete_leads":[{"chart_entry_id":2485,"title":"Now and Then","reason_code":"official_charts_page_has_no_catalogue_identifier"},{"chart_entry_id":1545,"title":"Right Round","reason_code":"official_charts_catalogue_value_is_not_the_stored_isrc"},{"chart_entry_id":1437,"title":"Breathe (Blu Cantrell)","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":191,"title":"Lift Me Up","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":180,"title":"9 PM (Till I Come)","reason_code":"official_charts_song_page_not_found"},{"chart_entry_id":167,"title":"Fly Away","reason_code":"official_charts_catalogue_value_does_not_bridge_to_stored_isrc"},{"chart_entry_id":41,"title":"Sleeping Satellite","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":541,"title":"All Around the World","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":531,"title":"Like a Prayer","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":425,"title":"Ebony and Ivory","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":845,"title":"Message in a Bottle","reason_code":"physical_catalogue_number_without_isrc_bridge"},{"chart_entry_id":2505,"title":"The Subway","reason_code":"official_charts_catalogue_value_is_not_an_isrc"},{"chart_entry_id":2501,"title":"Survive","reason_code":"release_level_verification_not_completed"},{"chart_entry_id":2500,"title":"Ordinary","reason_code":"musicbrainz_isrc_lookup_unavailable"},{"chart_entry_id":2486,"title":"Lovin on Me","reason_code":"musicbrainz_isrc_lookup_unavailable"},{"chart_entry_id":2476,"title":"Flowers","reason_code":"official_charts_page_has_no_catalogue_identifier"},{"chart_entry_id":2473,"title":"Anti-Hero","reason_code":"release_level_verification_not_completed"}],"expected_deltas":{"albums":19,"songs":19,"canonical_recordings":0,"historical_chart_links":20,"ratings":0},"proposed_result":{"resolved_delta":20,"resolved_chart_entries":439,"remaining_unresolved_chart_entries":859},"safety_contract":{"atomic_transaction":true,"global_stale_baseline_abort":true,"per_candidate_stale_fingerprint_abort":true,"deterministic_advisory_lock_order":true,"immutable_private_operation_evidence":true,"preserve_all_song_ratings_byte_for_byte":true,"preserve_all_historical_chart_ratings_byte_for_byte":true,"preserve_first_batch_papa_dont_preach_reconciliation":true,"duplicate_and_partial_identity_abort":true,"rollback_operation_required":true,"production_execution_authorized":false}}$batch_manifest$::text as payload
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
  if (select count(*) from pg_temp.uk_number_ones_batch_2_manifest) <> 20
     or (select count(distinct chart_id) from pg_temp.uk_number_ones_batch_2_manifest) <> 20
     or (select count(distinct source_entry_key) from pg_temp.uk_number_ones_batch_2_manifest) <> 20
     or (select count(distinct placeholder_canonical_id) from pg_temp.uk_number_ones_batch_2_manifest) <> 20
     or (select count(distinct recording_id) from pg_temp.uk_number_ones_batch_2_manifest) <> 20
     or (select count(distinct release_id) from pg_temp.uk_number_ones_batch_2_manifest) <> 20
     or (select count(distinct release_group_id) from pg_temp.uk_number_ones_batch_2_manifest) <> 20
     or (select count(*) from pg_temp.uk_number_ones_batch_2_manifest
         where action = 'import_verified') <> 19
     or (select count(*) from pg_temp.uk_number_ones_batch_2_manifest
         where action = 'link_existing') <> 1 then
    raise exception 'embedded batch-2 manifest digest or shape failed';
  end if;
  if exists (
    select 1
    from pg_temp.uk_number_ones_batch_2_manifest
    where action not in ('import_verified', 'link_existing')
       or target_canonical_id is null
       or evidence_sha256 !~ '^[0-9a-f]{64}$'
       or recording_id !~ '^[0-9a-f-]{36}$'
       or release_id !~ '^[0-9a-f-]{36}$'
       or release_group_id !~ '^[0-9a-f-]{36}$'
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
    raise exception 'embedded batch-2 manifest action shape failed';
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
      select 'bom-historical-reconciliation:20261123_uk_number_ones_verified_batch_2'::text
        as lock_key
      union all
      select 'bom-historical-chart:' || source_entry_key
      from pg_temp.uk_number_ones_batch_2_manifest
      union all
      select 'musicbrainz-recording:' || recording_id
      from pg_temp.uk_number_ones_batch_2_manifest
      union all
      select 'musicbrainz-release:' || release_id
      from pg_temp.uk_number_ones_batch_2_manifest
      where action = 'import_verified'
      union all
      select 'bom-admin-catalogue:' || release_group_id
      from pg_temp.uk_number_ones_batch_2_manifest
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

create temporary table uk_number_ones_batch_2_song_ratings_before
on commit drop
as select * from public.song_ratings;

create temporary table uk_number_ones_batch_2_historical_ratings_before
on commit drop
as select * from public.historical_chart_entry_ratings;

create temporary table uk_number_ones_batch_2_first_batch_audit_before
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

  if v_total <> 1298 or v_resolved <> 419 or v_unresolved <> 879
     or v_total <> v_resolved + v_unresolved then
    raise exception 'global chart baseline is stale';
  end if;
  if (select count(*) from public.albums) <> 1731
     or (select count(*) from public.songs) <> 16162
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
      '20261123_uk_number_ones_verified_batch_2'
  ) then
    raise exception 'batch-2 operation audit rows already exist';
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
  v constant text := '20261123_uk_number_ones_verified_batch_2';
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
    from pg_temp.uk_number_ones_batch_2_manifest
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
      raise exception 'unsupported batch-2 action %', candidate.action;
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
          'Guarded UK No. 1 batch 2; evidence manifest '
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
  if (select count(*) from public.albums) <> 1750
     or (select count(*) from public.songs) <> 16181
     or (select count(*) from public.canonical_recordings) <> 17095 then
    raise exception 'batch-2 catalogue delta failed';
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
    raise exception 'batch-2 chart delta failed';
  end if;

  if exists (
    (
      select * from pg_temp.uk_number_ones_batch_2_song_ratings_before
      except
      select * from public.song_ratings
    )
    union all
    (
      select * from public.song_ratings
      except
      select * from pg_temp.uk_number_ones_batch_2_song_ratings_before
    )
  ) then
    raise exception 'song ratings changed during batch 2';
  end if;

  if exists (
    (
      select *
      from pg_temp.uk_number_ones_batch_2_historical_ratings_before
      except
      select * from public.historical_chart_entry_ratings
    )
    union all
    (
      select * from public.historical_chart_entry_ratings
      except
      select *
      from pg_temp.uk_number_ones_batch_2_historical_ratings_before
    )
  ) then
    raise exception 'historical chart ratings changed during batch 2';
  end if;

  if exists (
    (
      select *
      from pg_temp.uk_number_ones_batch_2_first_batch_audit_before
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
      from pg_temp.uk_number_ones_batch_2_first_batch_audit_before
    )
  ) then
    raise exception 'first-batch rating audit changed during batch 2';
  end if;

  if (select count(*)
      from private.historical_chart_reconciliation_operation_audit
      where operation_key =
          '20261123_uk_number_ones_verified_batch_2'
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
       from pg_temp.uk_number_ones_batch_2_manifest m
       left join private.historical_chart_reconciliation_operation_audit a
         on a.operation_key =
              '20261123_uk_number_ones_verified_batch_2'
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
    raise exception 'batch-2 immutable operation audit failed';
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
    raise exception 'batch-2 created duplicate canonical recording MBIDs';
  end if;
end
$postconditions$;

commit;
