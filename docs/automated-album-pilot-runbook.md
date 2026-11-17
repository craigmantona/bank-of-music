# Automated album import: five-album pilot

This is a manual, reviewed procedure. Merging the implementation does not activate it. The GitHub Actions job remains gated by `AUTOMATED_ALBUM_IMPORT_ENABLED`, automatic queue promotion remains disabled, and the discovery kill switch remains independent.

## Approval prerequisites

1. Confirm a restorable Supabase backup exists and record its timestamp, project ref and restore method. A Free-plan project without a downloadable backup or point-in-time recovery must not run the pilot; first obtain and verify an approved logical backup in a non-production restore exercise.
2. Review exactly five MusicBrainz release-group UUIDs from the discovery JSON/CSV. Confirm each is a primary studio album, has an official original-period edition, is not already represented by another edition, and belongs to the intended artist.
3. Confirm database size is below 350 MB, the catalogue queue contains the required artists, no catalogue worker is active, and the existing album and rating counts have been recorded.
4. Obtain explicit approvals for the migrations, Edge Function deployments, temporary activation variables/secrets and the five IDs. Do not combine those approvals with merge approval.

## Deployment order (not performed by this PR)

1. Keep `AUTOMATED_ALBUM_IMPORT_ENABLED` unset/false and `ALBUM_DISCOVERY_KILL_SWITCH=true`.
2. Apply migrations in timestamp order through `20261117150000_automated_album_pilot_safety.sql`. Verify `automated_album_import_runs`, the pilot guard RPC and the insert trigger exist; do not start a run yet.
3. Deploy `artist-catalog-importer` first, then `daily-artist-import`. Perform their authenticated health/auth checks while automation is disabled.
4. Configure `ALBUM_IMPORT_APPROVED_RELEASE_GROUP_IDS` as the comma-separated, reviewed five UUIDs. Configure required server credentials. Leave automatic queue promotion disabled.
5. Run the workflow manually with target `5`, first with `dry_run=true`. Review storage, queue and duplicate diagnostics. Only after approval, run once with `dry_run=false` and `confirm_production_import=true`. Do not enable the schedule for the pilot.

## Before and after checks

Before the write run, capture database size; total active albums; ratings count and rating checksum grouped by album; rows for all five release-group IDs; queue state; worker lease; and the latest import-run rows. Afterward, repeat the same queries and verify:

- no more than five new albums exist for the run ID;
- every new album's release-group ID is in the approved set;
- alternate editions did not create extra rows;
- existing album IDs and all rating rows/checksums are unchanged;
- the run's atomic `albums_imported` value equals the number of newly inserted rows;
- database size remains below 350 MB (warning) and 400 MB (hard pause);
- no unrelated artist queue rows or catalogue albums changed.

Save the workflow log and discovery JSON/CSV/state artifacts with the approval record.

## Rollback

1. Immediately set `AUTOMATED_ALBUM_IMPORT_ENABLED=false` (or remove it) and keep the schedule disabled. Set the discovery kill switch true.
2. Do not delete albums that have acquired ratings or other references. Identify pilot rows only by the recorded run ID and compare them with the pre-run snapshot.
3. If the five rows have no downstream references, remove only those explicitly identified rows in a reviewed transaction, then reconcile the affected queue cursors from the pre-run snapshot. If any row has references, stop and use a corrective migration or restore plan approved by the database owner.
4. Roll back Edge Functions to their recorded previous versions. Prefer a forward corrective migration for schema defects; restore the verified backup only for material corruption and only through the approved incident process.
5. Repeat album/rating checks, document the outcome, and leave all activation settings disabled until a new review.
