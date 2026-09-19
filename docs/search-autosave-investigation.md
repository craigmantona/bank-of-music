# Search album auto-save investigation

Baseline: `177ad325447f1b3c4e3ca5b90f53d1abfd7abef7`. Changes are local only.

## Previous behaviour and cause

- The original `fa92037` implementation already used `autoSaveSelectedAlbum()` from search selection. It resolved MusicBrainz detail, upserted `albums` using `external_source,external_id`, saved track records, refreshed the library, and attached the saved album ID for ratings. There was no separate search importer.
- That original helper recovered `23505` uniqueness conflicts by looking up title/artist locally and in Supabase. The `e0ca27a` rewrite removed that recovery and later retained a track-existence calculation behind an unconditional `if (true)` insertion.
- `38f02c1` deliberately added `if (!currentUser) return null` and revoked anonymous album/song inserts. This is a separate reason that a signed-out resolved album remains unsaved. The repair preserves this security boundary; signed-out automatic writes cannot be restored within the requested no-policy/no-migration scope.
- The predictive implementation in `177ad32` did not remove the legacy save call. Its dropdown contains BOM catalogue entries; external discovery is reached through its existing “See all results” or submitted-search route. Testing invents no new external-suggestion source.
- Reproduced the production helper locally with an existing database album absent from the local cache under another release ID: its title/artist uniqueness conflict returned no saved album, and the page displayed **Save album**. This directly reproduces a signed-in failure. The original user's session state has not been confirmed.

## Local repair

The existing helper remains the only search persistence implementation. Search clicks now let album resolution complete before this helper is invoked by the existing renderer. The helper validates release identity, release-group identity, artist/title and the complete returned track list before any write. Resolution exceptions or incomplete payloads cannot generate synthetic/manual album rows.

Existing rows are reused by local identity or database release ID, release-group ID, and title/artist lookups. Upserts retain the external-ID conflict key, ignore already-existing external identities instead of overwriting metadata, and recover release-group/title collisions. Existing canonical editions keep their metadata and tracks. New rows preserve MusicBrainz release/release-group references, artwork URL and release date; tracks retain recording IDs, album linkage and sequential positions. No qualification or importer-version metadata is fabricated.

Repeated concurrent selections share the existing helper's in-flight operation. Track existence checks are honoured, fallback track keys are stable, saved IDs reach the rating model, and the predictive catalogue cache is invalidated after a new save. Asynchronous completion cannot bind an old album to a newer selection. The existing recording/title uniqueness constraints remain authoritative.

No search ranking, dropdown markup, album presentation, importer, queue, qualification logic, schema or Cloudflare configuration is changed. The application script URL receives a cache revision only.

## Verification

- `node --test tests/*.test.mjs`: existing suite plus 11 targeted auto-save regressions.
- `node tests/search-autosave-browser.mjs`: desktop and mobile touch, using the actual app and unchanged autocomplete with offline Supabase/auth and MusicBrainz fixtures. Covers external discovery through “See all results,” automatic album and track persistence, rating controls without Save album, subsequent predictive selection, repeated selection, and failed resolution with zero writes.
- The offline browser harness accepts `BOM_PLAYWRIGHT` when Playwright is installed outside the repository; `PLAYWRIGHT_BROWSERS_PATH` can point to a test-browser installation.
- Supabase documentation and existing migrations/schema exports were inspected. An initial read-only database query confirmed the existing metadata columns. A subsequent policy/index read was rejected by automatic approval review because of a usage limit; it was not bypassed. No production data was written by tests.

## Scope limits

The verified automatic-save behaviour is for signed-in users. Anonymous catalogue writes remain prohibited. Multi-request client-side persistence has no transaction spanning an album and all track inserts: the existing database constraints remain intact, but a transport/write failure after an album insert can still require retry/recovery. Achieving an atomic album-and-tracks transaction would need an approved backend change, outside this task. Tests specifically prove that failed or incomplete **external resolution** creates no partial record.
