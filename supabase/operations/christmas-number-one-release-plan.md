# BOM Christmas Number 1 release plan

This feature is implemented for review but is not approved for production use. The client flag is `false`, official browser RPCs are revoked, no annual row is approved, and no deployment or database migration has been performed.

## Fixed annual timetable

- Voting opens: 1 December at 00:00 Europe/London.
- Voting closes: the instant 21 December begins in Europe/London, so the final displayed voting minute is 20 December at 23:59 UK time.
- Reveal eligibility begins: 24 December at 00:00 Europe/London.
- A reveal is never public merely because that time has arrived. An administrator must separately approve the year's reveal.

## Staged migration plan

1. Keep `window.BOM_CHRISTMAS_NUMBER_ONE_FEATURE.enabled` set to `false`.
2. Back up `profiles` and `canonical_recordings`, then apply `20261119120000_bom_christmas_number_one.sql` to a non-production Supabase project.
3. Confirm the migration imports exactly 100 candidates and that all five new tables have RLS enabled with no browser table grants.
4. Test the admin preview RPCs with an admin and an ordinary member. Confirm preview votes appear only in `christmas_number_one_preview_votes` and never in `christmas_number_one_votes`.
5. Run the boundary, eligibility, tie, ranking, reveal, archive and year-rollover tests against staging.
6. Apply the schema migration to production only after explicit approval. This still does not expose official voting: the public RPC grants remain revoked and the client flag remains off.
7. Use the admin RPC to approve the intended year. Record who approved it and when in `christmas_number_one_admin_audit`.
8. Apply `future-public-launch/20261119123000_bom_christmas_number_one_public_permissions.sql` only after a second explicit launch approval.
9. Set the client feature flag to `true` in a separate reviewed release, run protected CI, and deploy only after explicit deployment approval.
10. After voting closes, inspect official results in the admin dashboard. If first place is tied, record a qualifying winning candidate and a tie-resolution note of at least 20 characters. Approve the reveal separately; it will remain hidden until 24 December.

## Rollback plan

The first rollback step is always to set the client flag back to `false` and revoke the three official RPC grants. This removes the public entry point and server execution permission without deleting evidence.

Before any destructive rollback, export:

- `christmas_number_one_years`
- `christmas_number_one_votes`
- `christmas_number_one_preview_votes`
- `christmas_number_one_admin_audit`
- `christmas_number_one_candidates`

After confirming the export and that no published annual archive must be retained, the reviewed script `20261119_bom_christmas_number_one_rollback.sql` removes only this feature's functions and tables. It does not update or delete `ratings`, `song_ratings`, catalogue entries, profiles, or the existing Christmas Special.

## Required approvals

- [ ] Apply the schema migration to production.
- [ ] Approve a specific annual voting row.
- [ ] Apply the future public RPC grants.
- [ ] Change the default-off client flag.
- [ ] Deploy the reviewed client build.
- [ ] If necessary, approve a documented first-place tie resolution.
- [ ] Approve the Christmas Eve reveal.

Each box is independent. None is implied by merging the implementation PR.
