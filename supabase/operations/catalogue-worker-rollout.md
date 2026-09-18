# Catalogue importer production and recovery runbook

## Production baseline

As of 2026-09-18 production runs `artist-catalog-importer` v34 and
`daily-artist-import` v14. Cron job 1 invokes the wrapper every 15 minutes.
`CATALOGUE_SELECTION_SHADOW_MODE=true`; the general qualification-v2 selector
is observational, while final policy/human overrides are authority boundaries.

The worker safeguards, persistent discovery, same-token acquisition recovery,
idempotent MusicBrainz coordination, shadow-selection schema, review queue and
qualification-v2 provenance migrations are deployed. Migration
`20260918175815_catalogue_recovery_observability.sql` is local-only until a
separate production approval.

## Queue lifecycle

The scheduler creates no queue rows. It invokes the importer, which atomically
claims the first eligible `pending` row by priority. Each claim increments the
lifetime `attempts` counter. Discovery pages are checkpointed, then frozen; an
existing job always resumes by release-group ID and its stored numeric cursor.

Normal states are:

- `pending`: eligible after any `next_attempt_at` delay;
- `processing`: owned by the live global worker lease;
- `review`: paused at its current candidate for a protected editorial decision;
- `complete`: frozen catalogue exhausted;
- `failed`: five consecutive real failures require operator attention.

Planned deadline and rate deferrals return work to `pending` without increasing
`consecutive_failures`. A successful discovery or candidate checkpoint resets
that counter. Lifetime `attempts` is never reset and never gates eligibility.

## Durable attempt diagnostics

`artist_catalogue_events` is an append-only, service-only event ledger. Events
record the job and artist, lifetime attempt, worker token when meaningful,
candidate identity, cursor movement, outcome, bounded structured details and a
short error category/detail. Payload size is limited to 4 KiB and error detail
to 1,500 characters.

Attempt start, discovery checkpoint, candidate checkpoint, review pause,
completion, deferral, failure and stale-lease reclamation events are written by
the fenced database transaction. Event keys make retryable transitions
idempotent. A diagnostic insert failure aborts the containing state transition,
so it cannot leave an album committed without its cursor or create a duplicate.

The table has RLS enabled. Public, anonymous and authenticated access is revoked;
the service role has only `SELECT` and `INSERT`.

## Protected REVIEW and EXCLUDE authority

Final overrides with `decision_source` equal to `policy` or `human` cannot be
bypassed by the legacy album path:

- `include`: processing continues normally;
- `exclude`: the candidate is checkpointed without an album and processing
  continues;
- `review`: the cursor and accepted count remain unchanged, the queue becomes
  `review`, an event is appended, and the lease is released.

The album RPC independently rejects a protected REVIEW even if a caller tries
to submit an album directly. Automatic pending-review evidence remains
re-evaluable and does not become an authority boundary.

To resolve a review, an authorized human must update the existing override to a
final `include` or `exclude`, set `decision_source='human'`, record the note and
decision time, and explicitly approve making that one queue row `pending`.
Never advance its cursor manually. The next normal scheduler run reprocesses the
same frozen release-group ID under the final decision.

## Failed-job recovery preflight

Before changing a failed row:

1. Record function versions, cron state, queue rows, album and duplicate counts.
2. Confirm the global lease is unowned and no job is `processing`.
3. Confirm the discovery snapshot is ready, its revision and group count, and
   that the group at `next_album_index` is the expected release-group ID.
4. Confirm accepted count and lifetime attempts. Neither may be reset.
5. Inspect the latest queue error and durable events. Resolve code, transport or
   editorial causes before recovery.
6. For a protected REVIEW candidate, obtain the editorial decision first or
   allow the job to enter `review`; do not bypass it.

The recovery mutation is limited to the chosen row: set `status='pending'`,
reset `consecutive_failures=0`, clear `next_attempt_at` and stale `last_error`,
and leave cursor, accepted count, attempts, priority, discovery and albums
unchanged. Recover one artist at a time and let the scheduler claim it normally.

After the first run verify the event ledger, cursor, accepted count, attempt
increment, discovery revision, duplicate checks and final lease state. Stop on
any unexpected movement or error; do not reset again automatically.

## Current failed jobs

- Fleetwood Mac: frozen at 3/24, accepted 3, next group `Then Play On`. The
  local recovery test resumes from that exact group without rediscovery.
- Queen: frozen at 11/20, accepted 11, next group `A Kind of Magic`. Its policy
  decision is REVIEW, so recovery pauses it at 11/20 with no album insertion
  until a human finalizes the decision.

## Deployment sequence for the recovery safeguards

Explicit approval is required before every production stage:

1. Pause cron and confirm no live lease or processing row.
2. Apply only `20260918175815_catalogue_recovery_observability.sql`.
3. Verify the new queue status constraint, event table/indexes/RLS/grants and
   replaced `catalogue_worker` RPC. Confirm all queue, discovery, album,
   override and shadow rows are unchanged.
4. Deploy only `artist-catalog-importer` with the reviewed shared worker module.
   Preserve `verify_jwt=false`, shadow mode, the 23-second budget, three-candidate
   ceiling, acquisition/rate/cooldown safeguards and duplicate protection.
5. Do not deploy the wrapper or inspector unless their reviewed source differs
   from the active production bundle.
6. Run a transactional or diagnostic protected-review check without claiming a
   real artist, then remove all diagnostic state and restore cron unchanged.
7. With separate approval, recover Fleetwood Mac alone. Observe its normal
   scheduled run before considering Queen.
8. Obtain or retain Queen's editorial REVIEW decision. With separate approval,
   recover Queen; it must enter `review` at 11/20 without inserting the album.

Creating queue rows, changing editorial decisions, resetting a failed artist,
deploying functions, applying migrations and switching qualification authority
all require explicit human approval. None is implied by this runbook.

## Local verification

From `supabase/tests`, run `pnpm test` and `pnpm typecheck`, followed by
`git diff --check`. Tests use isolated PGlite state and mocked MusicBrainz/auth
boundaries; they cannot contact or mutate production.
