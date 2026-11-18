# On-demand album-import resource policy

## Decision

Existing catalogue albums and all rating operations remain outside the import
limiter. A request only enters import accounting after authentication, exact
release validation and an exact existing-album lookup.

New releases use outcome-aware accounting and short-lived leases:

| Protection | Limit | What it protects |
| --- | ---: | --- |
| One active import per user | 1 | Accidental multi-clicks and browser fan-out |
| Active imports globally | 4 | Edge execution and MusicBrainz queue depth |
| Same exact release | 1 active lease | Cross-user/process request coalescing |
| Successful imports per user | 50 / rolling 24 hours | Deliberate catalogue growth |
| Successful imports globally | 100 / rolling 24 hours | Free Plan database growth |
| Distinct starts per user | 20 / rolling 10 minutes | Automated request abuse |
| Transient failures per user | 8 / rolling 15 minutes | Retry storms during an outage |
| Invalid/non-retryable results per user | 10 / rolling hour | Repeated bad release data |

An already-existing release, a coalesced follower and a transient or invalid
failure do not consume the successful-import allowance. Expired leases become
transient failures rather than remaining stuck or being counted as successes.
The scheduled five-album importer has separate coordination and accounting and
is not changed by this policy.

## Evidence

Production aggregate observations on 18 November 2026 (no user identifiers or
rating contents were exported):

- 13 reserved attempts across two users; the busiest user had 11 attempts.
- 9 new albums produced 86 tracks: mean 9.56, median 9, range 8–12 tracks.
- Recent Edge logs contained 21 import POSTs: 12 successful responses, 5 rate
  limits and 4 transient upstream/server failures. The old accounting charged
  those four failures like successful imports.
- No adjacent attempts were within 10 seconds. Six were within a minute and the
  median gap was about 60 seconds. Twenty starts per ten minutes is therefore
  an abuse ceiling more than three times the observed normal cadence, not a
  capacity mechanism.
- Successful imports typically occupied the Edge Function for 6–8 seconds;
  the observed maximum was about 11 seconds.
- The production database was approximately 48 MB. Albums used about 1.6 MB,
  songs about 11 MB and the original attempt table about 40 kB for 13 rows.

Current provider constraints:

- Supabase Free includes 500,000 Edge Function invocations per month. Free
  Edge Functions have 256 MB memory, 150 seconds wall-clock duration and two
  seconds CPU time. See [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase)
  and [Edge Function limits](https://supabase.com/docs/guides/functions/limits).
- Free database quota is 500 MB; disk enters read-only mode at its platform
  threshold. See [database size](https://supabase.com/docs/guides/platform/database-size).
- MusicBrainz requires a meaningful User-Agent and an average of no more than
  one request per second from an IP. Excess traffic can receive 503 responses.
  See the [MusicBrainz web service](https://musicbrainz.org/doc/Web_Service) and
  [rate-limiting policy](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).

The importer makes four MusicBrainz reads for a new album in its current safe
resolution path, plus a Cover Art Archive HEAD and database reads/the atomic
write. All MusicBrainz reads already pass through the shared database-backed
1.1-second slot, so the external one-request-per-second constraint is the
binding peak protection. Four simultaneous leases bound queueing while leaving
ample room under the 150-second Edge wall time.

At the global 100-success daily ceiling and the observed 9.56 tracks per album,
the worst allowed on-demand growth is about 956 songs/day. It is intentionally
far below multiplying the 50/user allowance by every account. This ceiling is
adjustable after enough production history exists; it should be reviewed using
successful imports, database growth, lease contention and failure outcomes,
not raw button taps.

## Trade-offs

- Fifty successful imports/day is roughly five times the observed busiest-user
  activity. It permits long discovery sessions but still makes a compromised
  account finite.
- The 100/day global ceiling may briefly defer a legitimate user during an
  exceptional site-wide import day. That is preferable to uncontrolled shared
  catalogue growth on the Free Plan; existing albums and ratings continue.
- Followers receive a short retryable “already being added” response rather
  than holding another Edge invocation open. The first request performs the
  work; a later retry reuses the stored album through the existing-album path.
- MusicBrainz/network failures get their own retry allowance. Eight in fifteen
  minutes tolerates the observed four-failure incident twice over while
  stopping a manual or scripted retry storm.

## Deployment and non-destructive rollback

1. Apply `20261118210000_outcome_aware_remote_album_import_limits.sql`.
2. Deploy `remote-album-catalogue` with JWT verification preserved.
3. Publish the site so the new busy/coalesced states are displayed.

The migration only adds private accounting columns/table/functions and does not
update catalogue, song, rating, profile or Auth records. The previous
one-argument reservation RPC remains available during deployment and rollback,
so migration-first rollout does not break the previous Edge version. If the
Edge deployment must be rolled back, redeploy that previous version; the new
accounting table and history can remain in place. No catalogue rollback or data
deletion is required.
