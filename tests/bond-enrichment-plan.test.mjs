import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mapping = JSON.parse(fs.readFileSync(new URL('../supabase/operations/bond-theme-final-mapping-20261110.json', import.meta.url)));
const evidence = JSON.parse(fs.readFileSync(new URL('../supabase/operations/bond-theme-authoritative-release-evidence-20261110.json', import.meta.url)));
const sql = fs.readFileSync(new URL('../supabase/operations/bond-theme-enrichment-proposal.sql', import.meta.url), 'utf8');

test('final mapping covers 25 films and one separate bonus with unique MBIDs', () => {
  assert.equal(mapping.entries.length, 26);
  assert.equal(mapping.entries.filter((x) => !x.bonus).length, 25);
  assert.equal(mapping.entries.filter((x) => x.bonus).length, 1);
  assert.equal(new Set(mapping.entries.map((x) => x.musicbrainzRecordingId)).size, 26);
});

test('mapping is anchored to every track on the verified official release', () => {
  assert.equal(evidence.source.status, 'Official');
  assert.equal(evidence.source.release_id, 'fd1723bc-2a32-442e-b56d-c30fe7411ce7');
  assert.deepEqual(
    new Set(mapping.entries.map((x) => x.musicbrainzRecordingId)),
    new Set(evidence.tracks.map((x) => x.musicbrainz_recording_id)),
  );
});

test('only the three verified catalogue identities are treated as existing', () => {
  const existing = mapping.entries.filter((x) => x.catalogue.status === 'existing');
  assert.deepEqual(existing.map((x) => x.catalogue.catalogueTrackId).sort((a, b) => a - b), [15562, 19649, 19784]);
  assert.equal(mapping.entries.filter((x) => x.catalogue.status === 'planned-import').length, 23);
});

test('all 13 version-sensitive audit entries retain alternatives', () => {
  const sensitive = mapping.entries.filter((x) => x.alternatives.length > 0);
  assert.equal(sensitive.length, 13);
  assert.ok(sensitive.every((x) => x.confidence === 'medium-high'));
  assert.ok(sensitive.every((x) => x.alternatives.every((a) => a.id !== x.musicbrainzRecordingId)));
});

test('proposal is guarded, transactional, dry-run capable and preserves protected data', () => {
  assert.match(sql, /BOND_IMPORT_APPROVED/);
  assert.match(sql, /BOND_IMPORT_COMMIT/);
  assert.match(sql, /begin;/i);
  assert.match(sql, /rollback;/i);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /set local role service_role/i);
  assert.match(sql, /reset role/i);
  assert.match(sql, /Rating count changed unexpectedly/);
  assert.match(sql, /Protected canonical or Spotify data changed unexpectedly/);
  assert.doesNotMatch(sql, /update\s+public\.song_ratings/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.song_ratings/i);
  assert.match(sql, /expected albums \+1, songs \+26, canonicals \+23/i);
});

test('proposal resolves generated identities from rows instead of predicting IDs', () => {
  assert.match(sql, /resolved_canonical_recording_id/);
  assert.match(sql, /resolved_catalogue_track_id/);
  assert.doesNotMatch(sql, /nextval\s*\(/i);
  assert.doesNotMatch(sql, /setval\s*\(/i);
});
