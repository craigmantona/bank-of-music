# Phase 1A release sequence

This runbook is preparatory only. Do not merge, deploy, or apply the production database migration until release is explicitly authorised.

## Recorded rollback target

- Cloudflare Pages deployment: `0af51012-93dd-43da-a62a-e2b0100ff4ca`
- Git commit: `b7a422d6c1ecbb3845c99dc34914d01fa50e7c99`
- Deployment URL: `https://0af51012.bank-of-music.pages.dev`
- Automatic production deployments: disabled (`production_deployments_enabled=false`)
- Preview deployments: disabled

Reconfirm all five values immediately before release. Do not proceed if the PR head, protected-main configuration, rollback deployment, or deployment settings have changed unexpectedly.

## Release gates

1. Confirm PR #55 is open at the reviewed head, has no conflicts or unresolved review threads, and the required strict `Full test suite` check is green for that exact head.
2. Confirm the focused authentication/Quick Rate tests, full frontend suite, full database/Edge Functions suite, TypeScript check, publication parity check, desktop/iPhone visual checks, horizontal-overflow checks, and performance checks all match the evidence recorded on the PR.
3. Reconfirm the production database has not already applied `20261125120000_enable_guest_quick_rate_browsing.sql`. Record the function definition hash, comment, ACLs, RLS flags, policy digest, and rating row count/digest.
4. Reconfirm the Cloudflare rollback target above remains successful and retained, and automatic production deployments remain disabled.

## Authorised release procedure

1. Squash-merge PR #55 through protected `main`, using the reviewed PR head as the expected head SHA. Record the returned merge SHA and verify protected `main` points to it.
2. Read `supabase/migrations/20261125120000_enable_guest_quick_rate_browsing.sql` from that exact merge commit and apply it once to production. Do not run any other migration.
3. Verify the database permission delta before deploying the guest frontend:
   - function remains `STABLE`, `SECURITY INVOKER`, and `search_path=''`;
   - function definition hash is unchanged;
   - `PUBLIC=false`, `anon=true`, `authenticated=true`, and the existing `service_role` privilege is unchanged;
   - all five backing tables still have RLS enabled and the policy digest is unchanged;
   - an anonymous RPC call succeeds with only the allowlisted catalogue/provider/community fields, null `personal_rating`, and zero personal progress;
   - anonymous insert is rejected and anonymous update/delete affect zero rating rows;
   - authenticated RPC output remains unchanged;
   - rating row count/digest is unchanged.
4. Build `public/` from a clean checkout of the exact merge SHA. Verify source/public hashes, then manually deploy that directory to Cloudflare Pages with branch `main`, the exact merge SHA, and a clean-tree marker. Keep automatic production deployments disabled.
5. Record the Cloudflare deployment ID and verify its commit metadata is the exact merge SHA. Confirm the production asset hashes match the built `public/` files.
6. In fresh private browser contexts, smoke test desktop and 390×844 iPhone journeys:
   - signed-out Quick Rate browsing, collections, decades, years, listening choices, and sign-in-on-rating;
   - restored unrated and previously rated pending selections, including confirm/amend/keep and duplicate-click protection;
   - existing signed-in progress and navigation;
   - Spotify, Apple Music, and Amazon Music;
   - Bond, Christmas, UK No.1s, scheduled/upcoming games, and historical chart detail;
   - no horizontal overflow, console errors, failed critical requests, or first-paint/performance regression.

## Rollback

On any critical regression, stop validation and roll Cloudflare back immediately to deployment `0af51012-93dd-43da-a62a-e2b0100ff4ca`. If the database permission change is implicated, or once no guest frontend remains live, run `supabase/operations/20261125_enable_guest_quick_rate_browsing_rollback.sql`.

After the database rollback, verify `PUBLIC=false`, `anon=false`, `authenticated=true`, and the existing `service_role` privilege is unchanged; the authenticated RPC succeeds; the anonymous RPC returns permission denied; function metadata, RLS/policies, and rating row count/digest are unchanged.

## Migration privacy scope

The Phase 1A migration adds anonymous execution only to the read-only projection. That projection does not return user IDs, individual rating rows, or personal progress. Production already has a separate `Public read song ratings` policy used by existing community features; it allows anonymous reads of raw rating rows and is not added or expanded by Phase 1A. Replacing that pre-existing surface requires a separately designed aggregate API and RLS migration and is outside this release.
