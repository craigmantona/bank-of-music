import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [html, app, artist, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-artist.js", import.meta.url), "utf8"),
  readFile(new URL("../bom-foundation.css", import.meta.url), "utf8")
]);

test("Stage 2B loads only with the opt-in Stage 1 presentation", () => {
  assert.match(html, /get\("ui"\) !== "legacy"/);
  assert.match(html, /bom-album\.js\?v=3/);
  assert.match(html, /bom-artist\.js\?v=9/);
  assert.match(app, /if \(isStageOnePresentation\(\)\)[\s\S]*renderStageOneArtist/);
});

test("Artist presentation is namespaced and contains no data access", () => {
  assert.match(artist, /bom-v1-artist/);
  assert.doesNotMatch(artist, /supabaseClient|musicbrainz|\.from\(|\.rpc\(|\bfetch\(/i);
  assert.doesNotMatch(artist, /fixture|prototype|mock/i);
  assert.match(artist, /renderLoading/);
  assert.match(artist, /Loading discography/);
});

test("Artist adapter reuses catalogue, ratings, artwork and follow functions", () => {
  for (const functionName of ["fetchMostCompleteArtistDiscography", "fetchArtistDetail", "fetchArtistImagePremium", "getAlbumAverage", "getYourAlbumRating", "getSongAverage", "getYourSongRating", "getAlbumArtworkUrl", "followArtistByName", "unfollowArtistByName"]) {
    assert.match(app, new RegExp(`${functionName}\\(`));
  }
  assert.match(app, /buildStageOneArtistModel/);
  assert.match(app, /window\.BOMArtistBridge/);
  assert.match(app, /2a96cbd8b46e442fc41c2b86b821562f/);
  assert.match(app, /imageUrl:[\s\S]*\? ""[\s\S]*: premiumArtistImage/);
  assert.doesNotMatch(app.match(/if \(isStageOnePresentation\(\)\)[\s\S]*?return;/)?.[0] || "", /displayAlbums\.find\(\(album\) => album\.coverUrl\)/);
});

test("Discography supports release, community and personal ordering", () => {
  assert.match(artist, />The records</);
  assert.match(artist, /A selection from the discography\./);
  assert.match(artist, /value="release">Release date/);
  assert.match(artist, /value="community">Highest community rated/);
  assert.match(artist, /value="personal">Highest personally rated/);
  assert.match(artist, /data-library-type="album"/);
  assert.match(artist, /data-artist-album-index/);
});

test("only admins can exclude uncatalogued MusicBrainz albums from artist cards", () => {
  const buildSource = app.slice(app.indexOf("function buildArtistRankedTracks"), app.indexOf("async function renderStageOneArtist"));
  function modelFor(admin, album) {
    const context = {
      isAdmin: admin,
      getAlbumAverage: () => null,
      getYourAlbumRating: () => null,
      getSongAverage: () => null,
      getYourSongRating: () => null,
      allAlbums: [],
      getAlbumNameById: () => "",
      getAlbumArtworkUrl: () => "",
      isArtistFollowed: () => false,
      buildSelectedBackButton: () => ""
    };
    vm.runInNewContext(buildSource, context);
    return context.buildStageOneArtistModel({
      artistName: "The Beatles", artistDetail: null, artistItem: {}, imageUrl: "",
      albums: [album], savedSongs: []
    }).albums[0];
  }
  const remote = { title: "Meet The Beatles!", artist: "The Beatles", releaseGroupId: "924a902a-d17e-3f81-84e8-cdb8e2790090" };
  assert.equal(modelFor(true, remote).canExclude, true);
  assert.equal(modelFor(true, { ...remote, title: "Twist and Shout", releaseGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }).canExclude, true);
  assert.equal(modelFor(false, remote).canExclude, false);
  assert.equal(modelFor(true, { ...remote, savedAlbumId: 42 }).canExclude, false);
  assert.match(artist, /data-bom-exclude-remote-album/);
  assert.match(artist, />Exclude from BOM</);
  assert.match(artist, /confirm\(`Exclude \$\{album\.artist\} — \$\{album\.title\} from BOM\?`\)/);
  assert.ok(app.indexOf('event.target.closest("[data-bom-exclude-remote-album]")') < app.indexOf('const artistAlbumCard = event.target.closest("[data-artist-album-index]")'));
});

test("Top tracks use community track ratings with competition ranks and Top 10 or 50", () => {
  assert.match(app, /displayedScore = track\.community\.average\.toFixed\(1\)/);
  assert.match(app, /priorRank = index \+ 1/);
  assert.match(artist, /trackLimit = 10/);
  assert.match(artist, /trackLimit === 10 \? 50 : 10/);
  assert.match(artist, /View Top 50/);
  assert.match(artist, /community track rating/i);
});

test("top tracks deduplicate shared ratings by recording identity and prefer the original studio album", () => {
  const identityStart = app.indexOf("function getConfirmedMusicBrainzRecordingId");
  const identityEnd = app.indexOf("function getSongRatingOccurrenceIds", identityStart);
  const rankingStart = app.indexOf("function buildArtistRankedTracks");
  const rankingEnd = app.indexOf("function buildStageOneArtistModel", rankingStart);
  const sharedRecordingId = "11111111-1111-4111-8111-111111111111";
  const distinctRecordingId = "22222222-2222-4222-8222-222222222222";
  const context = {
    allAlbums: [
      { id: 10, title: "Weezer (Green Album)", original_release_date: "2001-05-07", cover_art_url: "green.jpg" },
      { id: 99, title: "The Singles", original_release_date: "2005-01-01", cover_art_url: "singles.jpg" },
      { id: 20, title: "A Different Album", original_release_date: "2002-01-01", cover_art_url: "different.jpg" }
    ],
    getSongAverage: () => ({ avg: 8.5, count: 2 }),
    getYourSongRating: () => 8,
    getAlbumNameById: () => "",
    getAlbumArtworkUrl: album => album?.cover_art_url || "",
    isLikelyStudioAlbum: album => album?.title !== "The Singles"
  };
  vm.runInNewContext(app.slice(identityStart, identityEnd), context);
  const preferenceStart = app.indexOf("function getPreferredSongOccurrence");
  const preferenceEnd = app.indexOf("function renderStarSelector", preferenceStart);
  vm.runInNewContext(app.slice(preferenceStart, preferenceEnd), context);
  vm.runInNewContext(app.slice(rankingStart, rankingEnd), context);

  const ranked = context.buildArtistRankedTracks([
    { id: 1, album_id: 99, title: "Island in the Sun", external_source: "musicbrainz", external_id: sharedRecordingId },
    { id: 2, album_id: 10, title: "Island in the Sun", external_source: "musicbrainz", external_id: sharedRecordingId },
    { id: 3, album_id: 20, title: "Island in the Sun", external_source: "musicbrainz", external_id: distinctRecordingId }
  ]);

  assert.equal(ranked.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(ranked[0])), {
    songId: 2, title: "Island in the Sun", albumId: 10, albumTitle: "Weezer (Green Album)",
    albumYear: "2001", artworkUrl: "green.jpg", community: { average: 8.5, count: 2 }, personal: 8, rank: 1
  });
  assert.deepEqual(JSON.parse(JSON.stringify(ranked[1])), {
    songId: 3, title: "Island in the Sun", albumId: 20, albumTitle: "A Different Album",
    albumYear: "2002", artworkUrl: "different.jpg", community: { average: 8.5, count: 2 }, personal: 8, rank: 1
  });
});

test("responsive Artist layouts and missing artwork states are present", () => {
  assert.match(styles, /\.bom-v1-artist-discography/);
  assert.match(styles, /repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.match(styles, /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(artist, /Artist image unavailable/);
  assert.match(artist, /bom-v1-artist-eyebrow">The artist/);
  assert.match(artist, /Artwork unavailable/);
});

test("Artist hero rejects album, release, composite and unapproved image URLs", () => {
  const window = { location: { href: "http://localhost/" }, BOMUI: {} };
  const document = { addEventListener() {} };
  vm.runInNewContext(artist, { window, document, URL });
  const accepts = window.BOMArtistUI.isApprovedArtistImageUrl;

  assert.equal(accepts("https://coverartarchive.org/release-group/example/front-500"), false);
  assert.equal(accepts("https://thumb.wikimedia.org/wikipedia/commons/example/Radiohead_composite.jpg"), false);
  assert.equal(accepts("https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9c/ISS-64_Jubba_with_Nefud_Desert.jpg"), false);
  assert.equal(accepts("https://example.com/artist.jpg"), false);
  assert.equal(accepts("https://thumb.wikimedia.org/wikipedia/commons/example/artist-performing.jpg"), true);
  assert.equal(accepts("https://e-cdns-images.dzcdn.net/images/artist/example/1000x1000.jpg"), true);
});

test("MusicBrainz identity links are preferred over validated free-text search", () => {
  assert.match(app, /inc=tags\+genres\+aliases\+url-rels/);
  assert.match(app, /getMusicBrainzRelation\(artistDetail, "image"\)/);
  assert.match(app, /getMusicBrainzRelation\(artistDetail, "wikidata"\)/);
  const resolver = app.match(/async function fetchArtistImagePremium[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(resolver.indexOf('getMusicBrainzRelation(artistDetail, "image")') < resolver.indexOf("fetchValidatedWikipediaSearchImage(artistName)"));
  assert.match(app, /gsrsearch: `intitle:\\"\$\{artistName\}\\" \(band OR musician OR singer\)`/);
});

test("non-musical entities are rejected and the placeholder remains final", () => {
  assert.match(app, /function isMusicalArtistContext/);
  assert.match(app, /if \(!isMusicalArtistContext\(description\)\) return null/);
  assert.match(app, /filter\(\(page\) => isMusicalArtistContext\(page\.description\)\)/);
  assert.match(app, /provider: "BOM placeholder"/);
  assert.match(app, /no validated photograph/);
  assert.doesNotMatch(app, /api\/rest_v1\/page\/summary\/\$\{encodeURIComponent\(artistName\)\}/);
});

test("ambiguous names require exact musical identity rather than the first text result", () => {
  assert.match(app, /normaliseCompare\(artist\.name\) === normaliseCompare\(artistName\)/);
  assert.match(app, /artist\.type && artist\.id/);
  assert.match(app, /claims\?\.P434/);
  assert.match(app, /datavalue\?\.value \|\| ""\) === String\(artistId\)/);
  assert.match(app, /normaliseCompare\(page\.title\)\.includes\(normaliseCompare\(artistName\)\)/);
  assert.doesNotMatch(app, /deezerData\.data\[0\]/);
});

test("release art, composites, objects and unknown hosts remain ineligible", () => {
  assert.match(app, /function isSuitableArtistImageFilename/);
  for (const term of ["album", "single", "logo", "composite", "collage", "montage", "desert", "satellite", "microphones", "magazine"]) {
    assert.match(app, new RegExp(term, "i"));
  }
  assert.match(artist, /coverartarchive/);
  assert.match(artist, /const approvedArtistImageHosts/);
});

test("a recovered discography identity is retried before the safe fallback", () => {
  assert.match(app, /if \(!manualArtistHero && !imageIdentity\.detail && artistMusicBrainzId\)/);
  assert.match(app, /resolveArtistIdentityForImage\(artistName, artistMusicBrainzId\)/);
});

test("Wikimedia hero sizing preserves a validated file identity", () => {
  assert.match(app, /iiurlwidth: "1200"/);
  assert.match(app, /titles: `File:\$\{filename\}`/);
  assert.match(app, /imageIdentity: filename/);
  assert.match(app, /originalWidth/);
  assert.match(app, /selectBestArtistHero\(\[primaryImage, \.\.\.categoryImages\]/);
  assert.match(app, /\(\?:upload\|thumb\)\\\.wikimedia\\\.org/);
  assert.doesNotMatch(styles, /\.bom-v1-artist-photo\.is-wide \{ object-fit: cover/);
});

test("Artist hero selection compares a bounded suitability-ranked shortlist", () => {
  assert.match(app, /function scoreArtistHeroCandidate/);
  assert.match(app, /function selectBestArtistHero/);
  assert.match(app, /function isStrongPrimaryArtistHero/);
  assert.match(app, /\.slice\(0, 8\)/);
  assert.match(app, /gsrlimit: "20"/);
  assert.match(app, /`\\"\$\{artistName\}\\" \\"left to right\\"`/);
  assert.match(app, /group photo\|group portrait\|group shot\|band photo/);
  assert.match(app, /crowd\|audience\|stadium\|festival grounds/);
  assert.match(app, /selectionScore/);
  assert.match(app, /pageprops\?\.wikibase_item/);
  assert.match(artist, /data-bom-artist-image-fit/);
  assert.match(styles, /\.bom-v1-artist-photo\.is-cover \{ object-fit: cover; object-position: center 32%; \}/);
});

test("artist image resolution uses a session cache without schema changes", () => {
  assert.match(app, /ARTIST_IMAGE_CACHE_PREFIX/);
  assert.match(app, /artistImageMemoryCache/);
  assert.match(app, /sessionStorage\.getItem/);
  assert.match(app, /sessionStorage\.setItem/);
});

test("artist deep links preserve Stage 1 rollback and Album navigation", () => {
  assert.match(app, /shareType === "artist"/);
  assert.match(app, /\["album", "song", "artist"\]\.includes/);
  assert.match(app, /data-library-type="album"/);
  assert.match(app, /data-artist-album-index/);
  assert.match(artist, /history\.pushState/);
});

test("catalogue and qualification infrastructure is absent from Stage 2B assets", () => {
  assert.doesNotMatch(artist + styles, /artist-catalog|qualification-v2|shadow snapshot|artist_import_queue|catalogue worker/i);
});

function albumIdentityContext() {
  const start = app.indexOf("function normaliseAlbumTitleKey");
  const end = app.indexOf("function normaliseReleaseDate", start);
  const context = { normaliseCompare: value => String(value || "").toLowerCase().replace(/^the\s+/, "").replace(/[’'`]/g, "").replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, "").trim() };
  vm.runInNewContext(app.slice(start, end), context);
  return context;
}

test("symbolic and Unicode album title keys remain safe and distinct", () => {
  const { normaliseAlbumTitleKey } = albumIdentityContext();
  const titles = ["+", "×", "÷", "=", "−", "★", "Ö", "惠特妮·休斯顿纪念特辑"];
  const keys = titles.map(normaliseAlbumTitleKey);
  assert.equal(keys.every(Boolean), true);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(normaliseAlbumTitleKey("Sgt. Pepper’s Lonely Hearts Club Band"), normaliseAlbumTitleKey("Sgt Peppers Lonely Hearts Club Band"));
});

test("only Ed Sheeran plus inherits the saved BOM identity and metadata", () => {
  const { albumIdentityMatches } = albumIdentityContext();
  const savedPlus = { id: 575, title: "+", artist: "Ed Sheeran", external_source: "musicbrainz",
    external_id: "plus-release", musicbrainz_release_id: "plus-release",
    musicbrainz_release_group_id: "plus-group", cover_art_url: "orange.jpg", release_date: "2012-06-12" };
  const remote = [
    ["+", "plus-group"], ["×", "multiply-group"], ["÷", "divide-group"],
    ["=", "equals-group"], ["−", "minus-group"]
  ].map(([title, releaseGroupId]) => ({ title, artist: "Ed Sheeran", releaseGroupId,
    coverUrl: `${title}.jpg`, releaseDate: `remote-${title}` }));
  const merged = remote.map(album => {
    const saved = albumIdentityMatches(savedPlus, album) ? savedPlus : null;
    return { title: album.title, savedAlbumId: saved?.id || "", coverUrl: saved?.cover_art_url || album.coverUrl,
      releaseDate: saved?.release_date || album.releaseDate, ratingAlbumId: saved?.id || null };
  });
  assert.deepEqual(merged[0], { title: "+", savedAlbumId: 575, coverUrl: "orange.jpg", releaseDate: "2012-06-12", ratingAlbumId: 575 });
  assert.equal(albumIdentityMatches(savedPlus, { title: "×", artist: "Ed Sheeran",
    releaseGroupId: "multiply-group", savedAlbumId: 575 }), false);
  for (const album of merged.slice(1)) {
    assert.equal(album.savedAlbumId, "");
    assert.notEqual(album.coverUrl, "orange.jpg");
    assert.notEqual(album.releaseDate, "2012-06-12");
    assert.equal(album.ratingAlbumId, null);
  }
});

test("a renamed self-titled album replaces its upstream title without a duplicate card", () => {
  const identityStart = app.indexOf("function normaliseAlbumTitleKey");
  const identityEnd = app.indexOf("function normaliseReleaseDate", identityStart);
  const mergeStart = app.indexOf("function mergeArtistDiscographyAlbums");
  const mergeEnd = app.indexOf("async function renderArtistDetail", mergeStart);
  const context = {
    normaliseCompare: value => String(value || "").toLowerCase().replace(/^the\s+/, "").replace(/[’'`]/g, "").replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, "").trim(),
    getAlbumArtworkUrl: album => album?.cover_art_url || ""
  };
  vm.runInNewContext(app.slice(identityStart, identityEnd), context);
  vm.runInNewContext(app.slice(mergeStart, mergeEnd), context);

  const merged = context.mergeArtistDiscographyAlbums({
    artistName: "Weezer",
    artistMusicBrainzId: "weezer-artist",
    remoteAlbums: [{
      title: "Weezer", artist: "Weezer", releaseGroupId: "blue-group",
      releaseDate: "1994-05-10", coverUrl: "remote-blue.jpg"
    }],
    savedAlbums: [{
      id: 1460, title: "Weezer (Blue Album)", artist: "Weezer",
      musicbrainz_release_group_id: "blue-group", musicbrainz_release_id: "blue-release",
      external_source: "musicbrainz", external_id: "blue-release",
      original_release_date: "1994-05-10", cover_art_url: "saved-blue.jpg"
    }]
  });

  assert.equal(merged.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(merged[0])), {
    title: "Weezer (Blue Album)", artist: "Weezer", releaseGroupId: "blue-group",
    releaseDate: "1994-05-10", coverUrl: "saved-blue.jpg", savedAlbumId: 1460, localAlbumId: 1460
  });
});

test("known vulnerable titles do not cross-match through an empty key", () => {
  const { albumIdentityMatches } = albumIdentityContext();
  const records = [
    { id: 366, title: "★", artist: "David Bowie" },
    { id: 244, title: "Ö", artist: "Fcukers" },
    { id: 666, title: "惠特妮·休斯顿纪念特辑", artist: "Whitney Houston" }
  ];
  assert.equal(albumIdentityMatches(records[0], { title: "+", artist: "David Bowie" }), false);
  assert.equal(albumIdentityMatches(records[1], { title: "×", artist: "Fcukers" }), false);
  assert.equal(albumIdentityMatches(records[2], { title: "÷", artist: "Whitney Houston" }), false);
  assert.equal(albumIdentityMatches(records[2], { title: "惠特妮·休斯顿纪念特辑", artist: "Whitney Houston" }), true);
});

test("frontend album qualification excludes MusicBrainz Demo secondary types", () => {
  const start = app.indexOf("function isStudioReleaseGroup");
  const end = app.indexOf("function sortReleaseGroupsByDate", start);
  const context = { normaliseCompare: value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "") };
  vm.runInNewContext(app.slice(start, end), context);
  assert.equal(context.isStudioReleaseGroup({ title: "Spinning Man", "primary-type": "Album", "secondary-types": ["Demo"] }), false);
  assert.equal(context.isStudioReleaseGroup({ title: "Ordinary Album", "primary-type": "Album", "secondary-types": [] }), true);
});
