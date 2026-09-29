import { isOriginalPeriod, musicBrainzDateRange, selectCanonicalEdition } from "./catalogue-selection.ts";

export const ADMIN_CATALOGUE_MAX_ALBUMS = 10;

export function normaliseCatalogueText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normaliseDateForDatabase(value: unknown) {
  const date = String(value || "").trim();
  if (/^\d{4}$/.test(date)) return `${date}-01-01`;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(date)) return `${date}-01`;
  if (/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date) && musicBrainzDateRange(date)) return date;
  return null;
}

export function requestedDateMatches(candidate: unknown, requested: unknown) {
  const wanted = String(requested || "").trim();
  if (!wanted) return true;
  const actual = String(candidate || "").trim();
  if (/^\d{4}$/.test(wanted)) return actual.startsWith(wanted);
  if (/^\d{4}-\d{2}$/.test(wanted)) return actual.startsWith(wanted);
  return actual === wanted;
}

function artistCreditIds(value: any) {
  return new Set((value?.["artist-credit"] || [])
    .map((credit: any) => String(credit?.artist?.id || "").toLowerCase())
    .filter(Boolean));
}

function artistName(value: any) {
  return String((value?.["artist-credit"] || [])
    .map((credit: any) => credit?.name || credit?.artist?.name || "")
    .join("") || "").trim();
}

function candidateSummary(group: any) {
  return {
    release_group_id: group.id,
    title: group.title || "",
    first_release_date: group["first-release-date"] || "",
    primary_type: group["primary-type"] || "",
    secondary_types: group["secondary-types"] || []
  };
}

function releaseSummary(release: any) {
  return {
    release_id: release.id,
    title: release.title || "",
    date: release.date || "",
    country: release.country || "",
    status: release.status || ""
  };
}

export async function searchArtistCandidates(
  name: string,
  musicBrainzGet: (path: string) => Promise<any>
) {
  const clean = String(name || "").trim();
  if (!clean) return [];
  const query = `artist:"${clean.replaceAll('"', "")}"`;
  const data = await musicBrainzGet(`/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=10`);
  return (data.artists || []).map((artist: any) => ({
    id: artist.id,
    name: artist.name || "",
    sort_name: artist["sort-name"] || "",
    disambiguation: artist.disambiguation || "",
    country: artist.country || "",
    type: artist.type || "",
    score: Number(artist.score || 0),
    exact_name: normaliseCatalogueText(artist.name) === normaliseCatalogueText(clean)
  }));
}

async function releaseGroupById(
  id: string,
  musicBrainzGet: (path: string) => Promise<any>
) {
  return musicBrainzGet(`/release-group/${encodeURIComponent(id)}?inc=artist-credits&fmt=json`);
}

async function releasesForGroup(
  id: string,
  musicBrainzGet: (path: string) => Promise<any>
) {
  const data = await musicBrainzGet(
    `/release?release-group=${encodeURIComponent(id)}&status=official&type=album&limit=100&inc=artist-credits&fmt=json`
  );
  return (data.releases || []).filter((release: any) => release?.id);
}

async function completeRelease(
  id: string,
  musicBrainzGet: (path: string) => Promise<any>
) {
  return musicBrainzGet(
    `/release/${encodeURIComponent(id)}?inc=recordings+artist-credits+release-groups&fmt=json`
  );
}

export function flattenTracks(release: any, fallbackArtist: string) {
  const tracks: any[] = [];
  for (const medium of release?.media || []) {
    if (!Array.isArray(medium?.tracks) || !medium.tracks.length) return [];
    if (medium["track-count"] != null && Number(medium["track-count"]) !== medium.tracks.length) return [];
    for (const track of medium.tracks) {
      const title = String(track?.title || track?.recording?.title || "").trim();
      const recordingId = String(track?.recording?.id || "").trim().toLowerCase();
      const trackArtist = artistName(track) || fallbackArtist;
      if (!title || !recordingId || !trackArtist) return [];
      tracks.push({
        position: tracks.length + 1,
        medium_position: Number(medium.position || 1),
        medium_track_position: Number(track.position || tracks.length + 1),
        title,
        artist: trackArtist,
        musicbrainz_recording_id: recordingId
      });
    }
  }
  return tracks;
}

export type RequestedAlbum = {
  client_id?: string;
  title?: string;
  uk_release_date?: string;
  release_group_id?: string;
  release_id?: string;
};

export async function resolveExistingAlbumRelease({
  album,
  musicBrainzGet
}: {
  album: any;
  musicBrainzGet: (path: string) => Promise<any>;
}) {
  const releaseId = String(album?.musicbrainz_release_id ||
    (album?.external_source === "musicbrainz" ? album?.external_id : "") || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(releaseId)) {
    return { status: "needs_correction", reason: "stored_release_identity_required" };
  }

  const detail = await completeRelease(releaseId, musicBrainzGet);
  const groupId = String(detail?.["release-group"]?.id || "").trim().toLowerCase();
  const resolvedTitle = String(detail?.title || "").trim();
  const resolvedArtist = artistName(detail);
  if (detail?.id !== releaseId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupId) ||
      !resolvedTitle || !resolvedArtist ||
      normaliseCatalogueText(resolvedTitle) !== normaliseCatalogueText(album?.title) ||
      normaliseCatalogueText(resolvedArtist) !== normaliseCatalogueText(album?.artist) ||
      (album?.musicbrainz_release_group_id &&
        String(album.musicbrainz_release_group_id).toLowerCase() !== groupId)) {
    return { status: "needs_correction", reason: "stored_release_identity_mismatch" };
  }

  const tracks = flattenTracks(detail, resolvedArtist);
  if (!tracks.length) return { status: "failed", reason: "complete_track_listing_unavailable" };
  return {
    status: "ready",
    album: {
      id: Number(album.id),
      title: resolvedTitle,
      artist: resolvedArtist,
      musicbrainz_release_id: releaseId,
      musicbrainz_release_group_id: groupId
    },
    tracks
  };
}

export async function resolveRequestedAlbum({
  artist,
  request,
  musicBrainzGet,
  findExisting,
  artworkAvailable = async () => true
}: {
  artist: { id: string; name: string; country?: string };
  request: RequestedAlbum;
  musicBrainzGet: (path: string) => Promise<any>;
  findExisting: (identity: any) => Promise<any | null>;
  artworkAvailable?: (url: string) => Promise<boolean>;
}) {
  const base = {
    client_id: request.client_id || "",
    requested_title: String(request.title || "").trim(),
    requested_uk_release_date: String(request.uk_release_date || "").trim()
  };
  if (!artist?.id || !artist?.name || !base.requested_title) {
    return { ...base, status: "needs_correction", reason: "artist_and_album_title_required" };
  }

  let groups: any[] = [];
  if (request.release_group_id) {
    try {
      groups = [await releaseGroupById(request.release_group_id, musicBrainzGet)];
    } catch {
      return { ...base, status: "needs_correction", reason: "release_group_not_found" };
    }
  } else {
    const query = `arid:${artist.id} AND releasegroup:"${base.requested_title.replaceAll('"', "")}"`;
    const data = await musicBrainzGet(
      `/release-group/?query=${encodeURIComponent(query)}&type=album&fmt=json&limit=20`
    );
    groups = data["release-groups"] || [];
  }

  const exactGroups = groups.filter((group: any) =>
    group?.id && group["primary-type"] === "Album" &&
    artistCreditIds(group).has(artist.id.toLowerCase()) &&
    normaliseCatalogueText(group.title) === normaliseCatalogueText(base.requested_title) &&
    requestedDateMatches(group["first-release-date"], base.requested_uk_release_date)
  );

  if (!exactGroups.length) {
    const plausible = groups.filter((group: any) => group?.id &&
      artistCreditIds(group).has(artist.id.toLowerCase())).slice(0, 8);
    return {
      ...base,
      status: "needs_correction",
      reason: "no_exact_release_group_match",
      release_group_candidates: plausible.map(candidateSummary)
    };
  }
  if (exactGroups.length > 1 && !request.release_group_id) {
    return {
      ...base,
      status: "needs_correction",
      reason: "ambiguous_release_group",
      release_group_candidates: exactGroups.map(candidateSummary)
    };
  }

  const group = exactGroups[0];
  const releases = await releasesForGroup(group.id, musicBrainzGet);
  const official = releases.filter((release: any) =>
    (!release.status || release.status === "Official") &&
    artistCreditIds(release).has(artist.id.toLowerCase())
  );
  const ukReleases = official.filter((release: any) =>
    String(release.country || "").toUpperCase() === "GB" &&
    isOriginalPeriod(release.date, group["first-release-date"] || "") &&
    requestedDateMatches(release.date, base.requested_uk_release_date)
  );

  let selected: any = null;
  let selectionStrategy = "";
  if (request.release_id) {
    selected = official.find((release: any) => release.id === request.release_id) || null;
    selectionStrategy = "administrator_selected";
    if (!selected) {
      return {
        ...base,
        status: "needs_correction",
        reason: "selected_release_is_not_an_official_artist_release",
        release_group: candidateSummary(group),
        release_candidates: official.slice(0, 20).map(releaseSummary)
      };
    }
  } else {
    const canonical = selectCanonicalEdition(
      official,
      artist.country || "",
      group["first-release-date"] || ""
    );
    selected = canonical.release;
    selectionStrategy = canonical.strategy || "";
    if (!selected || ukReleases.length !== 1 || selected.id !== ukReleases[0].id) {
      return {
        ...base,
        status: "needs_correction",
        reason: ukReleases.length > 1 ? "ambiguous_uk_release" :
          ukReleases.length === 0 ? "uk_release_not_established" : "canonical_release_requires_confirmation",
        release_group: candidateSummary(group),
        release_candidates: official.slice(0, 20).map(releaseSummary),
        uk_release_candidates: ukReleases.map(releaseSummary)
      };
    }
  }

  const detail = await completeRelease(selected.id, musicBrainzGet);
  if (detail?.id !== selected.id || detail?.["release-group"]?.id !== group.id ||
      !artistCreditIds(detail).has(artist.id.toLowerCase())) {
    return { ...base, status: "failed", reason: "release_identity_validation_failed" };
  }
  const tracks = flattenTracks(detail, artist.name);
  if (!tracks.length) {
    return { ...base, status: "failed", reason: "complete_track_listing_unavailable" };
  }

  const resolvedTitle = String(detail.title || group.title || "").trim();
  const resolvedArtist = artistName(detail) || artist.name;
  const ukReleaseDate = String(base.requested_uk_release_date ||
    (String(selected.country || "").toUpperCase() === "GB" ? selected.date : "")).trim();
  const coverUrl = `https://coverartarchive.org/release-group/${encodeURIComponent(group.id)}/front-250`;
  const hasArtwork = await artworkAvailable(coverUrl);
  const identity = {
    title: resolvedTitle,
    artist: resolvedArtist,
    musicbrainz_release_id: selected.id,
    musicbrainz_release_group_id: group.id
  };
  const existing = await findExisting(identity);

  return {
    ...base,
    status: existing?.is_deleted ? "needs_correction" : existing ? "already_exists" : "ready",
    reason: existing?.is_deleted ? "matching_album_is_deleted" : undefined,
    existing_album_id: existing?.id || null,
    warnings: [
      ...(String(selected.country || "").toUpperCase() !== "GB" ? ["selected_release_is_not_uk"] : []),
      ...(!ukReleaseDate ? ["uk_release_date_unavailable"] : []),
      ...(!hasArtwork ? ["artwork_unavailable"] : [])
    ],
    release_group: candidateSummary(group),
    selected_release: releaseSummary(selected),
    selection_strategy: selectionStrategy,
    album: {
      ...identity,
      musicbrainz_artist_id: artist.id,
      cover_art_url: hasArtwork ? coverUrl : "",
      uk_release_date: normaliseDateForDatabase(ukReleaseDate),
      original_release_date: normaliseDateForDatabase(group["first-release-date"]),
      canonical_release_date: normaliseDateForDatabase(selected.date),
      canonical_release_country: String(selected.country || "").toUpperCase()
    },
    tracks
  };
}
