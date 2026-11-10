#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const manifest = JSON.parse(await readFile(path.join(root, "christmas-100.json"), "utf8"));
const audit = JSON.parse(await readFile(path.join(root, "supabase/operations/christmas-musicbrainz-review-20261110.json"), "utf8"));
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const spotifyId = url => String(url || "").match(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})/)?.[1] || "";

// These overrides are tied to the named original official release, not search rank.
const verifiedOverrides = new Map([
  [0, { id: "91efd2a7-af4f-4553-866f-805582a59611", releaseId: "", reason: "Earliest identified Bing Crosby master; MusicBrainz matrix VP 1253." }],
  [1, { id: "8c008731-9e4b-4d6b-8de3-991c88aaebca", releaseId: "4fc4b465-1594-4d81-878a-42b057159523", reason: "Historically recognised stereo recording on the official Capitol album The Christmas Song." }],
  [3, { id: "c2df9e6f-93e3-4756-a4c0-de7493ca5cea", releaseId: "", reason: "Original Bing Crosby master; MusicBrainz matrix VP 1253." }],
  [4, { id: "f70d1f66-4693-4cca-9f44-62c7253ae6ab", releaseId: "90673f6b-8306-4663-93d9-eb2c40c4356e", reason: "Track 5 of the official 1957 US Elvis’ Christmas Album." }],
  [8, { id: "46799bbc-0cdb-4a47-b359-533003eb05c3", releaseId: "b6e616fd-b0c9-329d-8a7b-10a07f92b2a6", reason: "Track 2 of the official 1970 US Jackson 5 Christmas Album." }],
  [11, { id: "1490f55b-878f-4564-9f60-e709f414755d", releaseId: "", reason: "1977 Bing Crosby/David Bowie television duet recording." }],
  [13, { id: "dc517f67-3e5c-4ca8-98f5-befe8deb1199", releaseId: "e7c259c9-b0b6-4c04-92ba-65a021bd48ad", reason: "Track 1 of the official 1971 US single." }],
  [19, { id: "f4434431-0a16-472b-b3b1-b7a5fd601658", releaseId: "9c63e88f-f44b-4d76-93e3-23eb550b72ca", reason: "Track 4 of the official 1970 US Temptations Christmas Card album." }],
  [22, { id: "51d64124-b42f-46eb-9885-fcd856fdbadd", releaseId: "86dcb7e0-824f-4635-94bf-4994d1f7bd40", reason: "Track 1 of the official 1973 GB single." }],
  [53, { id: "c3ddc5ba-02e1-4783-8f69-09530f7af89a", releaseId: "", reason: "Original Matthew Hall and Meagan Moore soundtrack recording, first released 2004-11-02." }],
  [65, { id: "90b8459b-d74f-484c-865e-c7f116d42f6a", releaseId: "", reason: "Original Gwen Stefani and Blake Shelton recording, first released 2017-09-22." }],
  [69, { id: "3b24367a-33b3-412a-83a2-0935b2923fc0", releaseId: "e56b042f-2d88-45c8-a58b-40215349430c", reason: "Track 7 of the official 2015 GB Kylie Christmas album." }],
  [70, { id: "d49e32d1-d224-4efe-b2b9-a94c7cfdcbc6", releaseId: "", reason: "Original Ed Sheeran and Elton John recording first released in 2021." }],
  [73, { id: "be4bea7c-e9d2-4154-b3dc-e7a4d1daef3c", releaseId: "", reason: "Original Jimmy Fallon and Meghan Trainor recording first released 2023-11-17; excludes Dolby Atmos mix." }],
  [92, { id: "342aaba5-07ec-4871-aa5e-d2601a2df0cf", releaseId: "2784551c-0086-4979-9403-c6677ec64425", reason: "Track 1 of the original official 1960 single; excludes the 2021 stereo mix." }],
]);

async function detail(id) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(`https://musicbrainz.org/ws/2/recording/${id}?inc=artist-credits+isrcs+releases+url-rels&fmt=json`, {
        headers: { "User-Agent": "BankOfMusicChristmasAudit/1.0 (https://thebankofmusic.com)" }
      });
      if (response.ok) return response.json();
      if (![429, 502, 503, 504].includes(response.status)) throw new Error(`MusicBrainz ${response.status} for ${id}`);
    } catch (error) {
      if (attempt === 3) throw error;
    }
    await sleep(1600 * (attempt + 1));
  }
  throw new Error(`MusicBrainz unavailable for ${id}`);
}

const selected = [];
for (const [index, entry] of manifest.tracks.entries()) {
  const review = audit.entries.find(row => row.index === index);
  const override = verifiedOverrides.get(index);
  const id = entry.musicbrainzRecordingId || override?.id || review?.recommendedMusicBrainzRecordingId || review?.candidates?.[0]?.musicbrainzRecordingId;
  if (!id) throw new Error(`No verified recording selected for ${entry.artist} — ${entry.title}`);
  const payload = await detail(id);
  const spotifyIds = [...new Set((payload.relations || []).map(relation => spotifyId(relation.url?.resource)).filter(Boolean))];
  const candidate = review?.candidates?.find(row => row.musicbrainzRecordingId === id) || null;
  selected.push({
    index,
    group: entry.group,
    title: entry.title,
    artist: entry.artist,
    year: entry.year,
    musicbrainzRecordingId: id,
    catalogue: entry.catalogueTrackId ? {
      status: "existing",
      catalogueTrackId: entry.catalogueTrackId,
      canonicalRecordingId: entry.canonicalRecordingId
    } : { status: "planned-canonical", catalogueTrackId: null, canonicalRecordingId: null },
    evidence: {
      musicbrainzTitle: payload.title,
      musicbrainzArtistCredit: (payload["artist-credit"] || []).map(part => part.name || part.artist?.name || "").join(""),
      firstReleaseDate: payload["first-release-date"] || candidate?.firstReleaseDate || null,
      disambiguation: payload.disambiguation || candidate?.disambiguation || "",
      isrcs: payload.isrcs || [],
      officialReleases: (payload.releases || []).filter(release => release.status === "Official").slice(0, 12).map(release => ({ id: release.id, title: release.title, date: release.date || null, country: release.country || null })),
      selectedReleaseId: override?.releaseId || candidate?.releaseEvidence?.find(release => release.status === "Official")?.id || null,
      reason: entry.catalogueTrackId ? "Existing production canonical identity reverified directly with MusicBrainz." : override?.reason || "Exact title and artist credit on an original-period official release; selected ahead of later, live, remix and alternate-version candidates.",
      alternatives: (review?.candidates || []).filter(row => row.musicbrainzRecordingId !== id).slice(0, 4).map(row => ({
        musicbrainzRecordingId: row.musicbrainzRecordingId,
        firstReleaseDate: row.firstReleaseDate,
        disambiguation: row.disambiguation,
        reasonNotSelected: "Later, alternate, or less authoritative recording identity."
      }))
    },
    spotify: spotifyIds.length === 1
      ? { status: "verified-single-relation", trackId: spotifyIds[0], candidates: spotifyIds }
      : { status: spotifyIds.length ? "ambiguous-multiple-relations" : "unavailable", trackId: "", candidates: spotifyIds }
  });
  console.log(`${index + 1}/100 ${entry.artist} — ${entry.title}: ${spotifyIds.length === 1 ? spotifyIds[0] : spotifyIds.length ? `${spotifyIds.length} Spotify candidates` : "no Spotify relation"}`);
  if (index < manifest.tracks.length - 1) await sleep(1100);
}

if (new Set(selected.map(row => row.musicbrainzRecordingId)).size !== 100) throw new Error("Selected MusicBrainz identities are not unique");
const mapping = {
  schemaVersion: 1,
  generatedOn: "2026-11-10",
  mode: "review-only-no-production-writes",
  summary: {
    tracks: selected.length,
    existingCanonicalRecords: selected.filter(row => row.catalogue.status === "existing").length,
    plannedCanonicalRecords: selected.filter(row => row.catalogue.status === "planned-canonical").length,
    unmatched: 0,
    verifiedSpotifyTrackIds: selected.filter(row => row.spotify.status === "verified-single-relation").length,
    ambiguousSpotifyRelations: selected.filter(row => row.spotify.status === "ambiguous-multiple-relations").length
  },
  entries: selected
};
await writeFile(path.join(root, "supabase/operations/christmas-final-mapping-20261110.json"), `${JSON.stringify(mapping, null, 2)}\n`);

const importRows = selected.map(row => ({
  title: row.title,
  artist: row.artist,
  musicbrainz_recording_id: row.musicbrainzRecordingId,
  preferred_spotify_track_id: row.spotify.trackId || null,
  source_metadata: {
    seed: "christmas_special_verified_import",
    verified_on: "2026-11-10",
    selected_release_id: row.evidence.selectedReleaseId,
    isrcs: row.evidence.isrcs,
    spotify_status: row.spotify.status
  }
}));
const sql = `\\set ON_ERROR_STOP on
\\if :{?CHRISTMAS_IMPORT_APPROVED}
\\else
  \\echo 'Refusing to run: pass -v CHRISTMAS_IMPORT_APPROVED=true after final approval.'
  \\quit
\\endif
\\if :CHRISTMAS_IMPORT_APPROVED
\\else
  \\echo 'Refusing to run: CHRISTMAS_IMPORT_APPROVED must be true.'
  \\quit
\\endif
\\if :{?CHRISTMAS_IMPORT_COMMIT}
\\else
  \\echo 'Refusing to run: pass -v CHRISTMAS_IMPORT_COMMIT=false for dry-run or true for an approved commit.'
  \\quit
\\endif

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtextextended('christmas-canonical-enrichment-20261110-v1', 0));

create temp table christmas_expected as
select * from jsonb_to_recordset($christmas_tracks$${JSON.stringify(importRows)}$christmas_tracks$::jsonb)
  as t(title text, artist text, musicbrainz_recording_id text, preferred_spotify_track_id text, source_metadata jsonb);

do $preflight$
declare v_existing integer;
begin
  if (select count(*) from christmas_expected) <> 100
     or (select count(distinct lower(musicbrainz_recording_id)) from christmas_expected) <> 100 then
    raise exception 'Christmas payload must contain 100 unique recording identities';
  end if;
  if exists (select 1 from christmas_expected where musicbrainz_recording_id !~* '^[0-9a-f-]{36}$') then
    raise exception 'Christmas payload contains an invalid MusicBrainz recording ID';
  end if;
  if exists (
    select 1 from public.canonical_recordings c join christmas_expected e
      on lower(c.musicbrainz_recording_id) = lower(e.musicbrainz_recording_id)
    group by lower(c.musicbrainz_recording_id) having count(*) > 1
  ) then raise exception 'Duplicate canonical MusicBrainz identities already exist'; end if;
  select count(*) into v_existing from public.canonical_recordings c join christmas_expected e
    on lower(c.musicbrainz_recording_id) = lower(e.musicbrainz_recording_id);
  if v_existing not in (10, 100) then
    raise exception 'Expected either 10 pre-import or 100 post-import canonical identities, found %', v_existing;
  end if;
end $preflight$;

create temp table christmas_before as
select (select count(*) from public.song_ratings) as rating_count,
       (select count(*) from public.canonical_recordings) as canonical_count;

insert into public.canonical_recordings
  (title, artist, musicbrainz_recording_id, preferred_spotify_track_id, origin_key, source_metadata)
select e.title, e.artist, lower(e.musicbrainz_recording_id), e.preferred_spotify_track_id,
       'musicbrainz:' || lower(e.musicbrainz_recording_id), e.source_metadata
from christmas_expected e
on conflict (origin_key) do update set
  preferred_spotify_track_id = coalesce(public.canonical_recordings.preferred_spotify_track_id, excluded.preferred_spotify_track_id),
  source_metadata = public.canonical_recordings.source_metadata || excluded.source_metadata,
  updated_at = timezone('utc', now());

do $postcheck$
declare v_before christmas_before%rowtype;
begin
  select * into v_before from christmas_before;
  if (select count(*) from public.song_ratings) <> v_before.rating_count then
    raise exception 'Rating count changed unexpectedly';
  end if;
  if (select count(*) from public.canonical_recordings c join christmas_expected e
      on lower(c.musicbrainz_recording_id) = lower(e.musicbrainz_recording_id)) <> 100 then
    raise exception 'Post-import canonical identity count is not 100';
  end if;
  if (select count(*) from public.canonical_recordings) not in (v_before.canonical_count, v_before.canonical_count + 90) then
    raise exception 'Unexpected canonical-recording delta';
  end if;
end $postcheck$;

select jsonb_build_object(
  'existing_canonical_reused', 10,
  'new_canonical_required', (select count(*) from public.canonical_recordings) - b.canonical_count,
  'ratings_changed', (select count(*) from public.song_ratings) - b.rating_count,
  'verified_spotify_ids', (select count(*) from christmas_expected where preferred_spotify_track_id is not null)
) as dry_run_summary from christmas_before b;

select e.title, e.artist, e.musicbrainz_recording_id, c.id as resolved_canonical_recording_id,
       c.preferred_spotify_track_id
from christmas_expected e join public.canonical_recordings c
  on lower(c.musicbrainz_recording_id) = lower(e.musicbrainz_recording_id)
order by e.artist, e.title;

\\if :CHRISTMAS_IMPORT_COMMIT
  commit;
  \\echo 'Christmas canonical enrichment committed.'
\\else
  rollback;
  \\echo 'Christmas enrichment dry-run rolled back; production data is unchanged.'
\\endif
`;
await writeFile(path.join(root, "supabase/operations/christmas-canonical-enrichment-proposal.sql"), sql);
console.log(JSON.stringify(mapping.summary, null, 2));
