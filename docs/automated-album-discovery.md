# Automated album discovery and import

## Audit summary

The production path is `daily-artist-import` → `artist-catalog-importer` → the
`catalogue_worker` RPC. The importer uses a lease and durable cursor, validates
studio release groups and official editions, and coordinates all MusicBrainz
traffic through a shared 1.1-second database gate. It retries transient provider
errors and persists ambiguous candidates for review.

Duplicate protection is layered and transactional: the active-album
release-group unique index, MusicBrainz release identity, and the importer's
normalized artist/title match are resolved while the worker lease, queue row,
and frozen discovery cursor are locked. Both MusicBrainz IDs are persisted.
Alternate editions reuse the existing album row, so `ratings.album_id` and all
existing ratings are preserved. The automation never deletes or replaces an
album or rating.

## Operation

The GitHub workflow runs at 03:17 UTC and can also be run manually. It repeatedly
invokes the existing short-lived importer until 50 MusicBrainz albums have been
created during the UTC day. `workflow_dispatch` supports a target override and a
dry run. Concurrency prevents overlapping scheduled/manual controllers; the
database lease also prevents overlapping import workers.

Every run reads `pg_database_size`, even when the daily target is already met.
At 350 MiB it emits a GitHub Actions warning and records it. At 400 MiB it emits
a GitHub Actions error, records a paused run, exits non-zero, and makes no
further importer calls. Each controller run is recorded in
`automated_album_import_runs`; detailed candidate/worker events continue to use
the existing catalogue observability tables and function logs.

Daily accounting uses `albums.automated_import_run_id` and
`albums.automated_imported_at`; unrelated MusicBrainz inserts do not advance the
automation's UTC-day target. Existing albums encountered by the worker are not
miscounted as new imports.

## Queue replenishment discovery

`scripts/discover-musicbrainz-candidates.mjs` searches a bounded recent-date
window and emits JSON and CSV review artifacts. It caps pages and candidates,
paces MusicBrainz requests at 1.1 seconds, requires one safe artist identity and
an official original-period release, rejects unwanted secondary types, and can
consume a checked-in exclusion snapshot. It does not connect to Supabase or
write queue rows.

The artifact includes a proposed idempotent queue row keyed by MusicBrainz
artist ID. Automatic promotion is intentionally disabled: `--promote` and
`AUTOMATED_QUEUE_PROMOTION_ENABLED=true` fail closed. A future promotion path
must require an approved artifact, enforce artist-MBID uniqueness and all
quality/exclusion checks again inside one transaction, use the existing shared
MusicBrainz coordinator, record its source batch, and honor
`ALBUM_DISCOVERY_KILL_SWITCH`. The workflow's discovery phase also exits without
network access when that kill switch is active.

Required GitHub secrets are `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
`BOM_CRON_SECRET`. Apply the migration and deploy the already-existing Edge
Functions before enabling the schedule. This branch does not deploy or merge
anything.
