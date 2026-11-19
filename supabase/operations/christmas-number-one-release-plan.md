# BOM Christmas Number 1 controlled release plan

This feature is implemented for review but is not approved for production use. The client flag is `false`, official browser RPCs are revoked, no production annual row is approved, and no production migration or deployment has been performed.

## 2026 timetable

- Voting opens: 1 December 2026 at 00:00 Europe/London (`2026-12-01T00:00:00Z`).
- Voting closes: the instant 21 December begins in Europe/London (`2026-12-21T00:00:00Z`), so the final displayed voting minute is 20 December at 23:59 UK time.
- Reveal eligibility begins: 24 December 2026 at 00:00 Europe/London (`2026-12-24T00:00:00Z`).
- A reveal is never published merely because the date has arrived. An administrator must separately approve the year's immutable result snapshot.

The database computes these boundaries with `Europe/London`; neither a browser clock nor a deployment time can extend the voting window.

## Safety gates

The launch requires four independent controls to agree:

1. the schema exists;
2. the 2026 annual row has `voting_approved_at` set by a verified administrator;
3. the official RPC grants have been applied; and
4. `window.BOM_CHRISTMAS_NUMBER_ONE_FEATURE.enabled` is `true` in a reviewed production build.

Missing any one control keeps official voting unavailable. The admin preview continues to use only the preview vote and preview tie-resolution tables.

## Pre-launch verification

Complete these steps before requesting any production approval:

1. Keep the feature flag `false` and PR #31 in draft while review continues.
2. Run the complete browser regression suite, the Supabase/Edge test suite, the focused Christmas database tests and Supabase database lint against an isolated environment.
3. Confirm there are exactly 100 active candidates and that every candidate maps to the curated Christmas collection.
4. Confirm RLS is enabled on all six feature tables and direct table privileges are revoked from `public`, `anon` and `authenticated`.
5. Confirm an ordinary authenticated user cannot call any admin RPC, read standings, create preview votes or approve a year.
6. Confirm official vote RPCs remain unavailable before the future launch-permissions file is applied.
7. Exercise create/change vote, one effective vote per user/year, invalid candidate, year rollover, UK time boundaries, tied first place, deterministic lower-rank ties, reveal gating and immutable published archive tests.
8. Export the current production schema and back up `profiles` and `canonical_recordings`. Record the backup identifier and restore instructions in the launch record.

## Controlled production activation for 1 December 2026

Each numbered phase requires the corresponding explicit approval below. Do not combine approvals.

### Phase A — schema only

1. Merge through protected `main` only after PR #31 is ready, approved and all required checks pass.
2. Apply `supabase/migrations/20261119120000_bom_christmas_number_one.sql` through the normal production migration workflow.
3. Verify the migration imports exactly 100 candidates, enables RLS and leaves the official state, vote and archive RPCs revoked.
4. Verify existing `ratings`, `song_ratings`, catalogue rows and the existing Christmas Special are unchanged.

At the end of Phase A there is still no public UI and no callable official browser voting endpoint.

### Phase B — configure 2026 while still private

1. From a verified production admin account, call the admin year action for `approve_voting` with year `2026`.
2. Verify `christmas_number_one_years.voting_approved_at` and the matching `christmas_number_one_admin_audit` entry.
3. Reconfirm the client flag is still `false` and official RPC grants are still absent.

### Phase C — grant only the reviewed public RPC surface

1. Apply `supabase/operations/future-public-launch/20261119123000_bom_christmas_number_one_public_permissions.sql` through a separately reviewed production change.
2. Confirm it grants only:
   - official vote submission to `authenticated`;
   - state and archive reads to `anon` and `authenticated`.
3. Confirm no feature table receives a direct browser grant and all admin RPCs still perform the server-side admin check.

### Phase D — client activation and production deployment

1. In a separate release commit, set the default-off client flag to `true`.
2. Run protected CI again and obtain explicit production deployment approval.
3. Deploy from protected `main` through the normal Cloudflare production pipeline.
4. Verify the production commit SHA, sign-in requirement for voting, 100 candidates, listening links, countdown and saved-selection change flow.
5. Confirm ordinary users cannot see standings or vote totals and confirm preview votes are absent from official turnout.
6. Record the activation time, operator and verification results.

Prefer completing Phases A–C before 1 December with the client flag off. Schedule Phase D so the UI is ready for the database-enforced opening at 00:00 Europe/London; do not weaken or bypass the server window if deployment is late.

## Voting-period monitoring

- Check error logs, official vote count and distinct voter count without exposing standings.
- Confirm repeated submissions by the same user update the existing `(year, user_id)` row rather than increasing turnout.
- Treat any unexpected table grant, admin-RPC access, candidate outside the curated 100 or vote accepted outside the window as a launch-stopping incident.
- Do not copy preview votes into official votes.

## Close and Christmas Eve reveal

1. At `2026-12-21T00:00:00Z`, verify a new official vote is rejected and an existing vote can no longer be changed.
2. Review the admin-only results and turnout. Do not expose them publicly before reveal approval and time eligibility.
3. If first place is tied, select a qualifying tied candidate and record a tie-resolution note of at least 20 characters. Obtain the separate tie-resolution approval before continuing.
4. Approve the reveal from a verified admin account. This stores the immutable annual result snapshot but does not make it public before 24 December.
5. After `2026-12-24T00:00:00Z`, verify the winning feature, transparent top 10 and annual archive. Confirm lower-rank ties are labelled and ordered title A–Z.
6. Never attempt to replace a published snapshot. A correction requires a new, explicitly reviewed data-recovery procedure rather than the normal admin workflow.

## Non-destructive rollback

Use this order for an activation or voting incident:

1. Set the client feature flag back to `false` in a reviewed emergency release and deploy from protected `main`.
2. Revoke execute on the three official RPCs from `anon` and `authenticated` using the inverse of the future launch-permissions file.
3. If needed, use the admin `revoke_voting` action for 2026 and retain its audit entry.
4. Verify the public entry point is gone, vote submission is denied and existing vote/audit evidence remains intact.

Do not delete votes as an incident response. Export all six feature tables before considering a schema rollback:

- `christmas_number_one_candidates`
- `christmas_number_one_years`
- `christmas_number_one_votes`
- `christmas_number_one_preview_votes`
- `christmas_number_one_preview_tie_resolutions`
- `christmas_number_one_admin_audit`

Only after a separate destructive-rollback approval, a verified export and confirmation that no published annual archive must be retained may `supabase/operations/20261119_bom_christmas_number_one_rollback.sql` be applied. It removes only this feature's functions and tables; it does not update or delete `ratings`, `song_ratings`, catalogue entries, profiles or the existing Christmas Special.

## Exact approvals still required

- [ ] Mark PR #31 ready for review.
- [ ] Merge PR #31 through protected `main` after required review and CI.
- [ ] Apply the schema migration to production (Phase A).
- [ ] Approve the 2026 annual voting row (Phase B).
- [ ] Apply the future official RPC grants (Phase C).
- [ ] Enable the default-off client flag in a separate reviewed release.
- [ ] Deploy the activation release to production (Phase D).
- [ ] If first place is tied, approve the documented 2026 tie resolution.
- [ ] Approve the 2026 Christmas Eve reveal snapshot.
- [ ] If ever needed, approve a destructive schema rollback after export.

None of these approvals is implied by approving another item, merging an implementation PR or reaching a calendar date.
