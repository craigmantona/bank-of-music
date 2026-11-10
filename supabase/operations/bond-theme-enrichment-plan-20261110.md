# Bond theme catalogue enrichment — review plan

Status: **proposal only; not approved for production execution**. The feature remains disabled.

## Resolution

The official MusicBrainz release `fd1723bc-2a32-442e-b56d-c30fe7411ce7`, *The Best of Bond… James Bond* (2021-10-08, official, barcode 602508731099), supplies one coherent recording identity for every official Eon theme and the OHMSS bonus recording. It is a soundtrack/compilation release group and its 26-track order matches the requested collection.

The final mapping is in `bond-theme-final-mapping-20261110.json`. It contains 25 film themes and one separately labelled bonus. Three recording identities already exist in BoM and must be reused:

| Track | Song ID | Canonical ID |
|---|---:|---|
| GoldenEye | 15562 | `cb675a5b-924e-4edb-840f-a7983ed3af3f` |
| Writing’s on the Wall | 19649 | `b90ddab4-9971-4bc4-8547-74c9a54bcae9` |
| No Time to Die | 19784 | `d1740f5c-0472-4c0a-a228-ce1f1cebc4c6` |

The remaining 23 recording IDs have no current canonical or song row. No Spotify ID is proposed or invented.

## Version-sensitive decisions

Thirteen broad-search results had competing MusicBrainz recording identities. The recommended identity in each case is the exact track used by the verified official Bond compilation. The mapping retains up to three competing IDs and their disambiguations. Particular sign-off attention is warranted for:

- **You Only Live Twice:** select `79f67c46-6aa0-4a9b-ae81-676884400c59`, explicitly identified as the soundtrack version; reject the single version `8bfadc15-42a5-4a93-9abf-b4c09d9ecccf` for this film-theme slot.
- **You Know My Name:** select album/official-Bond-compilation identity `609737d4-a062-4752-a38d-20576924fa56`; competing single mix `bd6a8603-f2dc-4f4f-aa06-1170f1cdea08` remains a manual-review alternative if the intended target is specifically the theatrical title-sequence edit.
- **Goldfinger:** select `9cff2598-a24f-444a-bf28-9d4c9ac21481`, supported by the official compilation and original-master ISRCs. MusicBrainz has historically mixed some release evidence, so retain medium-high rather than absolute confidence.

All other version-sensitive selections are medium-high confidence; all unambiguous selections are high confidence.

## Proposed database change

Use the existing `public.admin_add_catalogue_album(jsonb, jsonb)` workflow to add the complete authoritative 26-track album occurrence. Its canonical-assignment trigger reuses any canonical row with the same MusicBrainz recording ID and creates only missing canonical rows.

Expected committed delta:

- albums: +1 (or +0 on an idempotent rerun)
- song occurrences: +26 (or +0 on rerun)
- canonical recordings: +23 (or +0 on rerun)
- song ratings: 0
- existing canonical links: 0 changes
- Spotify fields: 0 changes

The three existing themes will gain an occurrence on the authoritative compilation, but retain their existing canonical identities and ratings. This is release provenance, not a duplicate rating identity.

## Controlled procedure

1. Obtain final approval for the 13 recommended resolutions and the import itself.
2. Take a database backup or point-in-time recovery checkpoint and record its timestamp.
3. Run the focused tests in this branch.
4. Execute a dry run from a protected operator environment using a direct service-role/Postgres connection:

   ```sh
   psql "$DATABASE_URL" -v BOND_IMPORT_APPROVED=true -v BOND_IMPORT_COMMIT=false -f supabase/operations/bond-theme-enrichment-proposal.sql
   ```

   The script acquires an advisory transaction lock, checks the 26 unique recording IDs, verifies the three protected existing identities, snapshots ratings/canonical/Spotify data, calls the established catalogue RPC, resolves the actual generated rows, prints the resulting ID map, and rolls the transaction back.

5. Review the dry-run output. It must show 26 resolved canonical identities, unchanged rating count, unchanged protected rows, and no partial/mismatched existing authoritative album.
6. Only after a second explicit approval, run the identical script with `BOND_IMPORT_COMMIT=true`:

   ```sh
   psql "$DATABASE_URL" -v BOND_IMPORT_APPROVED=true -v BOND_IMPORT_COMMIT=true -f supabase/operations/bond-theme-enrichment-proposal.sql
   ```

7. Export the final query result and update `bond-007.json` from the **actual** `resolved_catalogue_track_id` and `resolved_canonical_recording_id` values. Do not infer sequence-generated IDs.
8. Verify authenticated 0–10 create/edit/autosave for each canonical ID, community aggregates, 26-entry progress, and canonical deduplication. Keep the feature flag disabled until separate launch approval.

## Idempotency and rollback

The existing album workflow returns `already_exists` for the same release/release-group. Preflight rejects a partial or mismatched album instead of silently completing or overwriting it. Canonical uniqueness is enforced by normalized MusicBrainz recording ID and the assignment trigger.

Before commit, any error rolls back the entire transaction. After commit, prefer point-in-time recovery if a systemic problem is found. A targeted compensating rollback may remove only the new album and its 26 occurrences, and only the 23 canonical rows created by this batch that have no ratings and no remaining song references. It must never delete or alter the three pre-existing canonical rows, any rating, Spotify metadata, or unrelated catalogue data. Generate and review that compensating SQL against the captured pre-import snapshot before execution.
