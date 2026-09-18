# Superseded migrations

Files in this directory are retained only as historical records. They are not
part of the active Supabase migration chain and must not be included in a
migration push.

## `20260825211500_phase1_security_hardening.sql`

- This migration was never applied to production.
- It must never be marked as applied in production migration history.
- It is superseded by
  `20260918124349_corrected_security_hardening.sql`.
- It must not be copied back into `supabase/migrations` or included in any
  future migration push.

The archived SQL is preserved byte-for-byte for audit history. It is unsafe to
apply after the catalogue-worker migrations because it would regrant the legacy
`claim_next_artist_import()` function to `service_role`.
