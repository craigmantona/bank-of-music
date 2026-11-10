#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'bond-007.json'), 'utf8'));
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'supabase/operations/bond-theme-authoritative-release-evidence-20261110.json'), 'utf8'));
const broadAudit = JSON.parse(fs.readFileSync(path.join(root, 'supabase/operations/bond-theme-musicbrainz-review-20261110.json'), 'utf8'));

const existing = new Map([
  ['d2f5e50f-3f78-4850-a86d-7f4c42860f1e', { catalogueTrackId: 15562, canonicalRecordingId: 'cb675a5b-924e-4edb-840f-a7983ed3af3f' }],
  ['73d74b29-3b96-438a-a5b4-22e7c3c2f60f', { catalogueTrackId: 19649, canonicalRecordingId: 'b90ddab4-9971-4bc4-8547-74c9a54bcae9' }],
  ['14848e6d-61fa-49f2-9e22-883e285a3a76', { catalogueTrackId: 19784, canonicalRecordingId: 'd1740f5c-0472-4c0a-a228-ce1f1cebc4c6' }],
]);

const auditByTitle = new Map(broadAudit.entries.map((entry) => [entry.themeTitle, entry]));
const entries = [...manifest.films, ...manifest.bonusTracks];
if (entries.length !== evidence.tracks.length) throw new Error('Manifest/evidence length mismatch');

const mapping = entries.map((entry, index) => {
  // The official compilation sequence puts the OHMSS bonus after its film theme.
  const track = evidence.tracks[index < 6 ? index : index === 25 ? 6 : index + 1];
  const selectedExisting = existing.get(track.musicbrainz_recording_id) ?? null;
  const audit = auditByTitle.get(entry.themeTitle);
  const isSensitive = audit?.reviewStatus === 'manual-review';
  const competing = isSensitive
    ? audit.candidates
      .filter((candidate) => candidate.musicbrainzRecordingId !== track.musicbrainz_recording_id)
      .slice(0, 3)
      .map((candidate) => ({
        id: candidate.musicbrainzRecordingId,
        creditedTitle: candidate.title,
        creditedArtist: candidate.artistCredit,
        firstReleaseDate: candidate.firstReleaseDate,
        disambiguation: candidate.disambiguation || null,
        reasonNotSelected: 'Not the recording identity used on the verified official 2021 Bond soundtrack compilation.',
      }))
    : [];
  return {
    film: entry.filmTitle,
    year: entry.year,
    bondActor: entry.bondActor,
    track: entry.themeTitle,
    originalPerformer: entry.originalPerformer,
    bonus: Boolean(entry.bonus),
    musicbrainzRecordingId: track.musicbrainz_recording_id,
    confidence: isSensitive ? 'medium-high' : 'high',
    catalogue: selectedExisting ? { status: 'existing', ...selectedExisting } : { status: 'planned-import', catalogueTrackId: null, canonicalRecordingId: null },
    evidence: [
      {
        type: 'official-compilation-track',
        releaseId: evidence.source.release_id,
        releaseGroupId: evidence.source.release_group_id,
        releaseStatus: evidence.source.status,
        disc: track.disc,
        position: track.position,
        creditedTitle: track.title,
        creditedArtist: track.artist_credit,
        durationMs: track.duration_ms,
        isrcs: track.isrcs,
      },
    ],
    reason: selectedExisting
      ? 'Exact MusicBrainz recording identity already resolves to the existing canonical BoM recording; reuse it and preserve all ratings and metadata.'
      : isSensitive
        ? 'Recommended because the official MusicBrainz-listed Bond soundtrack compilation uses this exact recording identity and artist credit; competing identities remain recorded for final sign-off.'
        : 'Exact title and original artist credit on the official MusicBrainz-listed Bond soundtrack compilation; no existing canonical BoM identity was found for this recording ID.',
    alternatives: competing,
  };
});

// Move the bonus back to the requested presentation order: 25 films, then bonus.
const output = {
  schemaVersion: 1,
  generatedOn: '2026-11-10',
  mode: 'review-only-no-production-writes',
  authoritativeSource: evidence.source,
  summary: {
    entries: mapping.length,
    officialFilmThemes: mapping.filter((x) => !x.bonus).length,
    bonusRecordings: mapping.filter((x) => x.bonus).length,
    existingCatalogueIdentities: mapping.filter((x) => x.catalogue.status === 'existing').length,
    plannedImports: mapping.filter((x) => x.catalogue.status === 'planned-import').length,
    manualSignoffRecommended: mapping.filter((x) => x.alternatives.length > 0).length,
  },
  entries: mapping,
};

const target = path.join(root, 'supabase/operations/bond-theme-final-mapping-20261110.json');
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);

const albumPayload = {
  title: evidence.source.title,
  artist: 'Various Artists',
  musicbrainz_release_id: evidence.source.release_id,
  musicbrainz_release_group_id: evidence.source.release_group_id,
  uk_release_date: evidence.source.date,
  original_release_date: '1992-09-08',
  canonical_release_date: evidence.source.date,
  canonical_release_country: evidence.source.country,
};
const trackPayload = evidence.tracks.map((track, index) => ({
  position: index + 1,
  title: track.title,
  artist: track.artist_credit,
  musicbrainz_recording_id: track.musicbrainz_recording_id,
  duration_ms: track.duration_ms,
}));
const sql = `\\set ON_ERROR_STOP on
\\if :{?BOND_IMPORT_APPROVED}
\\else
  \\echo 'Refusing to run: pass -v BOND_IMPORT_APPROVED=true after final approval.'
  \\quit
\\endif
\\if :BOND_IMPORT_APPROVED
\\else
  \\echo 'Refusing to run: BOND_IMPORT_APPROVED must be true.'
  \\quit
\\endif
\\if :{?BOND_IMPORT_COMMIT}
\\else
  \\echo 'Refusing to run: pass -v BOND_IMPORT_COMMIT=false for dry-run or true for an approved commit.'
  \\quit
\\endif

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtextextended('bond-theme-enrichment-20261110-v1', 0));

create temp table bond_expected as
select * from jsonb_to_recordset($bond_tracks$${JSON.stringify(trackPayload)}$bond_tracks$::jsonb)
  as t(position integer, title text, artist text, musicbrainz_recording_id text, duration_ms integer);

do $preflight$
declare
  v_existing integer;
  v_album_id bigint;
begin
  if (select count(*) from bond_expected) <> 26
     or (select count(distinct lower(musicbrainz_recording_id)) from bond_expected) <> 26 then
    raise exception 'Bond payload must contain 26 unique recording identities';
  end if;

  if exists (
    select 1 from public.canonical_recordings c
    join bond_expected e on lower(e.musicbrainz_recording_id) = lower(c.musicbrainz_recording_id)
    group by lower(c.musicbrainz_recording_id) having count(*) > 1
  ) then
    raise exception 'Duplicate canonical MusicBrainz identities already exist';
  end if;

  select count(*) into v_existing
  from public.canonical_recordings c
  join bond_expected e on lower(e.musicbrainz_recording_id) = lower(c.musicbrainz_recording_id);
  if v_existing not in (3, 26) then
    raise exception 'Expected either 3 pre-import or 26 post-import canonical identities, found %', v_existing;
  end if;

  if not exists (
    select 1 from public.songs s where s.id = 15562 and s.canonical_song_id = 'cb675a5b-924e-4edb-840f-a7983ed3af3f'::uuid
  ) or not exists (
    select 1 from public.songs s where s.id = 19649 and s.canonical_song_id = 'b90ddab4-9971-4bc4-8547-74c9a54bcae9'::uuid
  ) or not exists (
    select 1 from public.songs s where s.id = 19784 and s.canonical_song_id = 'd1740f5c-0472-4c0a-a228-ce1f1cebc4c6'::uuid
  ) then
    raise exception 'One or more protected existing Bond identities changed; aborting';
  end if;

  select a.id into v_album_id from public.albums a
  where lower(coalesce(a.musicbrainz_release_id, '')) = '${evidence.source.release_id}'
     or lower(coalesce(a.musicbrainz_release_group_id, '')) = '${evidence.source.release_group_id}'
  order by a.id limit 1;
  if v_album_id is not null and exists (
    (select s.track_position, lower(s.external_id) from public.songs s where s.album_id = v_album_id and not coalesce(s.is_deleted, false)
     except select e.position, lower(e.musicbrainz_recording_id) from bond_expected e)
    union all
    (select e.position, lower(e.musicbrainz_recording_id) from bond_expected e
     except select s.track_position, lower(s.external_id) from public.songs s where s.album_id = v_album_id and not coalesce(s.is_deleted, false))
  ) then
    raise exception 'A partial or mismatched authoritative Bond album already exists; manual reconciliation required';
  end if;
end $preflight$;

create temp table bond_before as
select
  (select count(*) from public.song_ratings) as rating_count,
  (select count(*) from public.canonical_recordings) as canonical_count,
  (select count(*) from public.songs) as song_count,
  (select jsonb_agg(jsonb_build_object('song_id', s.id, 'canonical_song_id', s.canonical_song_id, 'spotify_track_id', s.spotify_track_id) order by s.id)
   from public.songs s where s.id in (15562, 19649, 19784)) as protected_rows;

select public.admin_add_catalogue_album(
  $bond_album$${JSON.stringify(albumPayload)}$bond_album$::jsonb,
  $bond_tracks$${JSON.stringify(trackPayload)}$bond_tracks$::jsonb
) as import_result;

do $postcheck$
declare
  v_before bond_before%rowtype;
  v_after_protected jsonb;
begin
  select * into v_before from bond_before;
  if (select count(*) from public.song_ratings) <> v_before.rating_count then
    raise exception 'Rating count changed unexpectedly';
  end if;
  select jsonb_agg(jsonb_build_object('song_id', s.id, 'canonical_song_id', s.canonical_song_id, 'spotify_track_id', s.spotify_track_id) order by s.id)
    into v_after_protected from public.songs s where s.id in (15562, 19649, 19784);
  if v_after_protected is distinct from v_before.protected_rows then
    raise exception 'Protected canonical or Spotify data changed unexpectedly';
  end if;
  if (select count(*) from public.canonical_recordings c join bond_expected e on lower(e.musicbrainz_recording_id) = lower(c.musicbrainz_recording_id)) <> 26 then
    raise exception 'Post-import canonical identity count is not 26';
  end if;
end $postcheck$;

select e.position, e.title, e.artist, e.musicbrainz_recording_id,
       c.id as resolved_canonical_recording_id,
       min(s.id) filter (where not coalesce(s.is_deleted, false)) as resolved_catalogue_track_id,
       count(s.id) filter (where not coalesce(s.is_deleted, false)) as active_occurrences
from bond_expected e
join public.canonical_recordings c on lower(c.musicbrainz_recording_id) = lower(e.musicbrainz_recording_id)
left join public.songs s on s.canonical_song_id = c.id
group by e.position, e.title, e.artist, e.musicbrainz_recording_id, c.id
order by e.position;

\\if :BOND_IMPORT_COMMIT
  commit;
  \\echo 'Bond enrichment committed.'
\\else
  rollback;
  \\echo 'Bond enrichment dry-run rolled back; production data is unchanged.'
\\endif
`;
const sqlTarget = path.join(root, 'supabase/operations/bond-theme-enrichment-proposal.sql');
fs.writeFileSync(sqlTarget, sql);

console.log(`Wrote ${path.relative(root, target)} (${mapping.length} entries)`);
console.log(`Wrote ${path.relative(root, sqlTarget)} (guarded proposal; not executed)`);
