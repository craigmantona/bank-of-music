import assert from "node:assert/strict";
import test from "node:test";
import {
  flattenTracks,
  resolveExistingAlbumRelease,
  resolveRequestedAlbum,
  searchArtistCandidates
} from "../functions/_shared/admin-catalogue.ts";

test("multi-medium flattening assigns album-wide positions and retains disc metadata", () => {
  const detail = {
    media: [
      { position: 1, "track-count": 17, tracks: Array.from({ length: 17 }, (_, index) => ({ position: index + 1, title: `A${index + 1}`, recording: { id: `00000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}` } })) },
      { position: 2, "track-count": 13, tracks: Array.from({ length: 13 }, (_, index) => ({ position: index + 1, title: `B${index + 1}`, recording: { id: `00000000-0000-4000-8002-${String(index + 1).padStart(12, "0")}` } })) }
    ]
  };
  const tracks = flattenTracks(detail, "The Example");
  assert.deepEqual(tracks.map(track => track.position), Array.from({ length: 30 }, (_, index) => index + 1));
  assert.equal(tracks[17].medium_position, 2);
  assert.equal(tracks[17].medium_track_position, 1);
});

test("existing album repair resolves only its stored exact release identity", async () => {
  const fixture = musicBrainzFixture();
  const result = await resolveExistingAlbumRelease({
    album: {
      id: 283, title: "First Album", artist: "The Example",
      external_source: "musicbrainz", external_id: UK_RELEASE_ID,
      musicbrainz_release_id: null, musicbrainz_release_group_id: null
    },
    musicBrainzGet: fixture.get
  });
  assert.equal(result.status, "ready");
  assert.equal(result.album.musicbrainz_release_id, UK_RELEASE_ID);
  assert.equal(result.album.musicbrainz_release_group_id, GROUP_ID);
  assert.deepEqual(fixture.calls, [`/release/${UK_RELEASE_ID}?inc=recordings+artist-credits+release-groups&fmt=json`]);
});

test("existing album repair rejects release identity mismatches", async () => {
  const result = await resolveExistingAlbumRelease({
    album: {
      id: 283, title: "Different Album", artist: "The Example",
      external_source: "musicbrainz", external_id: UK_RELEASE_ID
    },
    musicBrainzGet: musicBrainzFixture().get
  });
  assert.equal(result.status, "needs_correction");
  assert.equal(result.reason, "stored_release_identity_mismatch");
});

const ARTIST_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_GROUP_ID = "33333333-3333-4333-8333-333333333333";
const UK_RELEASE_ID = "44444444-4444-4444-8444-444444444444";
const US_RELEASE_ID = "55555555-5555-4555-8555-555555555555";
const RECORDING_ID = "66666666-6666-4666-8666-666666666666";

const artist = { id: ARTIST_ID, name: "The Example", country: "GB" };
const credit = [{ name: artist.name, artist: { id: ARTIST_ID, name: artist.name } }];
const group = {
  id: GROUP_ID, title: "First Album", "primary-type": "Album",
  "secondary-types": [], "first-release-date": "1984-02-20", "artist-credit": credit
};
const ukRelease = {
  id: UK_RELEASE_ID, title: "First Album", date: "1984-02-20", country: "GB",
  status: "Official", "artist-credit": credit
};
const usRelease = {
  id: US_RELEASE_ID, title: "First Album", date: "1984-03-01", country: "US",
  status: "Official", "artist-credit": credit
};

function releaseDetail(release = ukRelease) {
  return {
    ...release,
    "release-group": { id: GROUP_ID },
    media: [{ position: 1, "track-count": 1, tracks: [{
      position: 1, title: "Opening Track", recording: { id: RECORDING_ID, title: "Opening Track" }
    }] }]
  };
}

function musicBrainzFixture({ groups = [group], releases = [ukRelease], detail = releaseDetail() } = {}) {
  const calls = [];
  const get = async path => {
    calls.push(path);
    if (path.startsWith("/artist/?")) return { artists: [{ id: ARTIST_ID, name: artist.name, country: "GB", score: 100 }] };
    if (path.startsWith("/release-group/?")) return { "release-groups": groups };
    if (path.startsWith(`/release-group/${GROUP_ID}`)) return group;
    if (path.startsWith(`/release-group/${OTHER_GROUP_ID}`)) return groups.find(item => item.id === OTHER_GROUP_ID);
    if (path.startsWith("/release?")) return { releases };
    if (path.startsWith("/release/")) return detail;
    throw new Error(`Unexpected MusicBrainz path ${path}`);
  };
  return { get, calls };
}

async function resolve(fixture, request = {}, findExisting = async () => null) {
  return resolveRequestedAlbum({
    artist,
    request: { client_id: "row-1", title: "First Album", ...request },
    musicBrainzGet: fixture.get,
    findExisting,
    artworkAvailable: async () => true
  });
}

test("artist search returns choices and never auto-confirms one", async () => {
  const fixture = musicBrainzFixture();
  const candidates = await searchArtistCandidates("The Example", fixture.get);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, ARTIST_ID);
  assert.equal(candidates[0].exact_name, true);
});

test("an exact single UK edition resolves artwork and a complete track preview", async () => {
  const result = await resolve(musicBrainzFixture());
  assert.equal(result.status, "ready");
  assert.equal(result.album.uk_release_date, "1984-02-20");
  assert.equal(result.album.canonical_release_country, "GB");
  assert.equal(result.album.musicbrainz_release_group_id, GROUP_ID);
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].musicbrainz_recording_id, RECORDING_ID);
  assert.match(result.album.cover_art_url, new RegExp(GROUP_ID));
});

test("multiple exact release groups require an administrator choice", async () => {
  const second = { ...group, id: OTHER_GROUP_ID, "first-release-date": "1984-03-01" };
  const result = await resolve(musicBrainzFixture({ groups: [group, second] }));
  assert.equal(result.status, "needs_correction");
  assert.equal(result.reason, "ambiguous_release_group");
  assert.equal(result.release_group_candidates.length, 2);
});

test("a requested year narrows release groups without fuzzy guessing", async () => {
  const second = { ...group, id: OTHER_GROUP_ID, "first-release-date": "1985-01-01" };
  const result = await resolve(musicBrainzFixture({ groups: [group, second] }), { uk_release_date: "1984" });
  assert.equal(result.status, "ready");
  assert.equal(result.release_group.release_group_id, GROUP_ID);
});

test("missing UK evidence requires correction and exposes official editions", async () => {
  const result = await resolve(musicBrainzFixture({ releases: [usRelease], detail: releaseDetail(usRelease) }));
  assert.equal(result.status, "needs_correction");
  assert.equal(result.reason, "uk_release_not_established");
  assert.deepEqual(result.release_candidates.map(item => item.release_id), [US_RELEASE_ID]);
});

test("an explicit administrator edition is accepted with visible non-UK warnings", async () => {
  const result = await resolve(
    musicBrainzFixture({ releases: [usRelease], detail: releaseDetail(usRelease) }),
    { release_group_id: GROUP_ID, release_id: US_RELEASE_ID, uk_release_date: "1984-02-20" }
  );
  assert.equal(result.status, "ready");
  assert.ok(result.warnings.includes("selected_release_is_not_uk"));
  assert.equal(result.album.uk_release_date, "1984-02-20");
  assert.equal(result.selection_strategy, "administrator_selected");
});

test("an existing release group previews as Already exists without a write", async () => {
  let duplicateReads = 0;
  let writes = 0;
  const result = await resolve(musicBrainzFixture(), {}, async identity => {
    duplicateReads += 1;
    assert.equal(identity.musicbrainz_release_group_id, GROUP_ID);
    return { id: 91, title: "First Album", artist: artist.name };
  });
  assert.equal(result.status, "already_exists");
  assert.equal(result.existing_album_id, 91);
  assert.equal(duplicateReads, 1);
  assert.equal(writes, 0);
});

test("incomplete track metadata fails instead of importing a partial album", async () => {
  const detail = { ...releaseDetail(), media: [{ position: 1, "track-count": 2, tracks: [releaseDetail().media[0].tracks[0]] }] };
  const result = await resolve(musicBrainzFixture({ detail }));
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "complete_track_listing_unavailable");
});
