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

## Activation and operation

The workflow definition contains a 03:17 UTC schedule, but the entire job is
disabled unless the repository variable `AUTOMATED_ALBUM_IMPORT_ENABLED` is
explicitly set to `true`. This gate is independent of
`ALBUM_DISCOVERY_KILL_SWITCH`, and the importer entry point repeats the check
before reading credentials or making a network request. Merely merging the
workflow therefore cannot import albums or write to Supabase.

Once explicitly activated, the workflow repeatedly
invokes the existing short-lived importer until 50 MusicBrainz albums have been
created during the UTC day. `workflow_dispatch` supports a target override and a
dry run. A manual non-dry-run import also requires
`confirm_production_import=true`. Concurrency prevents overlapping
scheduled/manual controllers; the database lease also prevents overlapping
import workers.

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

`scripts/discover-musicbrainz-candidates.mjs` uses a bounded round-robin over a
30-day recent window and every decade from 1950 through the current decade.
Each run visits at most four windows by default and reads one bounded page per
window. The emitted state artifact records the next window, per-window offsets,
and a capped set of seen artist/release-group IDs. Supplying that artifact as
`MUSICBRAINZ_DISCOVERY_STATE` resumes the scan with fair decade rotation.

The generator emits JSON, CSV and resumable-state review artifacts, paces
MusicBrainz requests at 1.1 seconds, requires one safe artist identity and an
official original-period release, rejects unwanted secondary types, and can
consume a reviewed exclusion snapshot. Duplicate artist and release-group IDs
are suppressed within and across resumed runs. It does not connect to Supabase
or write queue rows. The start year, windows per run and page size are bounded
and configurable for reviewed runs.

The artifact includes a proposed idempotent queue row keyed by MusicBrainz
artist ID. Automatic promotion is intentionally disabled: `--promote` and
`AUTOMATED_QUEUE_PROMOTION_ENABLED=true` fail closed. A future promotion path
must require an approved artifact, enforce artist-MBID uniqueness and all
quality/exclusion checks again inside one transaction, use the existing shared
MusicBrainz coordinator, record its source batch, and honor
`ALBUM_DISCOVERY_KILL_SWITCH`. The workflow's discovery phase also exits without
network access when that kill switch is active.

Activation requires applying the reviewed migrations, deploying the reviewed
Edge Functions, configuring `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`BOM_CRON_SECRET`, and only then setting
`AUTOMATED_ALBUM_IMPORT_ENABLED=true`. Discovery additionally remains governed
by its separate kill switch. Automatic promotion must remain disabled. This
branch does not deploy, migrate or merge anything.
