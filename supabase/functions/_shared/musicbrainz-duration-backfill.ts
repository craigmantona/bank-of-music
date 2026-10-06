const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DURATION_BACKFILL_MAX_ALBUMS = 10;

export function storedMusicBrainzReleaseId(album: any) {
  const dedicated = String(album?.musicbrainz_release_id || "").trim().toLowerCase();
  if (MBID.test(dedicated)) return dedicated;
  const legacy = String(album?.external_id || "").trim().toLowerCase();
  return album?.external_source === "musicbrainz" && MBID.test(legacy) ? legacy : null;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function uniqueMap<T>(items: T[], key: (item: T) => string | number | null) {
  const map = new Map<string | number, T>();
  for (const item of items) {
    const value = key(item);
    if (value === null || map.has(value)) return null;
    map.set(value, item);
  }
  return map;
}

export function assessStoredSongProvenance(songs: any[]) {
  const active = songs.filter(song => !song?.is_deleted);
  const byPosition = uniqueMap(active, song => positiveInteger(song?.track_position));
  const byRecording = uniqueMap(active, song => {
    const id = String(song?.external_id || "").trim().toLowerCase();
    return song?.external_source === "musicbrainz" && MBID.test(id) ? id : null;
  });
  return {
    songs: active,
    positionSafe: Boolean(active.length && byPosition),
    recordingSafe: Boolean(active.length && byRecording)
  };
}

export function releaseOccurrenceTracks(release: any, expectedReleaseId: string) {
  if (String(release?.id || "").trim().toLowerCase() !== expectedReleaseId) {
    return { ok: false, reason: "release_identity_mismatch", tracks: [] };
  }
  if (!Array.isArray(release?.media) || !release.media.length) {
    return { ok: false, reason: "release_media_missing", tracks: [] };
  }
  const tracks: any[] = [];
  for (const medium of release.media) {
    if (!Array.isArray(medium?.tracks) || !medium.tracks.length ||
        (medium["track-count"] != null && Number(medium["track-count"]) !== medium.tracks.length)) {
      return { ok: false, reason: "release_track_structure_unexpected", tracks: [] };
    }
    for (const track of medium.tracks) {
      const recordingId = String(track?.recording?.id || "").trim().toLowerCase();
      tracks.push({
        position: tracks.length + 1,
        medium_position: positiveInteger(medium?.position),
        medium_track_position: positiveInteger(track?.position),
        recording_id: MBID.test(recordingId) ? recordingId : null,
        duration_ms: positiveInteger(track?.length)
      });
    }
  }
  return { ok: true, reason: null, tracks };
}

export function planAlbumDurationUpdates(album: any, songs: any[], release: any) {
  const releaseId = storedMusicBrainzReleaseId(album);
  if (!releaseId) return { ok: false, reason: "valid_stored_release_id_required", updates: [], already: 0, skipped: songs.length };
  const provenance = assessStoredSongProvenance(songs);
  if (!provenance.positionSafe && !provenance.recordingSafe) {
    return { ok: false, reason: "safe_song_provenance_unavailable", updates: [], already: 0, skipped: provenance.songs.length };
  }
  const occurrence = releaseOccurrenceTracks(release, releaseId);
  if (!occurrence.ok) return { ok: false, reason: occurrence.reason, updates: [], already: 0, skipped: provenance.songs.length };
  if (occurrence.tracks.length !== provenance.songs.length) {
    return { ok: false, reason: "track_count_mismatch", updates: [], already: 0, skipped: provenance.songs.length };
  }

  const releaseByPosition = uniqueMap(occurrence.tracks, track => track.position);
  const releaseByRecording = uniqueMap(occurrence.tracks, track => track.recording_id);
  if (provenance.positionSafe && !releaseByPosition) {
    return { ok: false, reason: "release_positions_ambiguous", updates: [], already: 0, skipped: provenance.songs.length };
  }
  if (provenance.recordingSafe && !releaseByRecording) {
    return { ok: false, reason: "release_recordings_ambiguous", updates: [], already: 0, skipped: provenance.songs.length };
  }

  const updates: Array<{ song_id: number; album_id: number; duration_ms: number }> = [];
  let already = 0;
  let skipped = 0;
  for (const song of provenance.songs) {
    const byPosition = provenance.positionSafe ? releaseByPosition?.get(Number(song.track_position)) : null;
    const byRecording = provenance.recordingSafe
      ? releaseByRecording?.get(String(song.external_id).trim().toLowerCase()) : null;
    if ((provenance.positionSafe && !byPosition) || (provenance.recordingSafe && !byRecording)) {
      return { ok: false, reason: "release_mapping_incomplete", updates: [], already: 0, skipped: provenance.songs.length };
    }
    if (byPosition && byRecording && byPosition !== byRecording) {
      return { ok: false, reason: "position_recording_disagreement", updates: [], already: 0, skipped: provenance.songs.length };
    }
    const matched = byPosition || byRecording;
    if (!matched?.duration_ms) {
      skipped += 1;
      continue;
    }
    if (positiveInteger(song.duration_ms)) {
      already += 1;
      continue;
    }
    updates.push({ song_id: Number(song.id), album_id: Number(album.id), duration_ms: matched.duration_ms });
  }
  return { ok: true, reason: null, updates, already, skipped };
}

export async function runDurationBackfillBatch({
  albums,
  dryRun,
  fetchSongs,
  fetchRelease,
  updateDuration
}: {
  albums: any[];
  dryRun: boolean;
  fetchSongs: (albumId: number) => Promise<any[]>;
  fetchRelease: (releaseId: string) => Promise<any>;
  updateDuration: (update: { song_id: number; album_id: number; duration_ms: number }) => Promise<boolean>;
}) {
  const releases = new Map<string, Promise<any>>();
  const report: any = {
    dry_run: dryRun, albums_processed: 0, songs_populated: 0,
    songs_would_populate: 0, songs_already_populated: 0,
    albums_skipped: 0, songs_skipped: 0, failures: [], albums: []
  };
  for (const album of albums) {
    const releaseId = storedMusicBrainzReleaseId(album);
    if (!releaseId) continue;
    try {
      const songs = await fetchSongs(Number(album.id));
      const provenance = assessStoredSongProvenance(songs);
      if (!provenance.positionSafe && !provenance.recordingSafe) {
        report.albums_skipped += 1;
        report.songs_skipped += provenance.songs.length;
        report.albums.push({ album_id: album.id, release_id: releaseId, status: "skipped", reason: "safe_song_provenance_unavailable" });
        continue;
      }
      const alreadyComplete = provenance.songs.filter(song => positiveInteger(song.duration_ms)).length;
      if (alreadyComplete === provenance.songs.length) {
        report.albums_processed += 1;
        report.songs_already_populated += alreadyComplete;
        report.albums.push({
          album_id: album.id, release_id: releaseId, status: "already_complete",
          songs_populated: 0, songs_would_populate: 0,
          songs_already_populated: alreadyComplete, songs_skipped: 0
        });
        continue;
      }
      if (!releases.has(releaseId)) releases.set(releaseId, fetchRelease(releaseId));
      const plan = planAlbumDurationUpdates(album, songs, await releases.get(releaseId));
      if (!plan.ok) {
        report.albums_skipped += 1;
        report.songs_skipped += plan.skipped;
        report.albums.push({ album_id: album.id, release_id: releaseId, status: "skipped", reason: plan.reason });
        continue;
      }
      let populated = 0;
      if (!dryRun) {
        for (const update of plan.updates) {
          if (await updateDuration(update)) populated += 1;
          else report.songs_already_populated += 1;
        }
      }
      report.albums_processed += 1;
      report.songs_populated += populated;
      report.songs_would_populate += plan.updates.length;
      report.songs_already_populated += plan.already;
      report.songs_skipped += plan.skipped;
      report.albums.push({
        album_id: album.id, release_id: releaseId, status: dryRun ? "previewed" : "processed",
        songs_populated: populated, songs_would_populate: plan.updates.length,
        songs_already_populated: plan.already, songs_skipped: plan.skipped
      });
    } catch (error) {
      const reason = String((error as Error)?.message || error);
      report.failures.push({ album_id: album.id, release_id: releaseId, reason });
      report.albums.push({ album_id: album.id, release_id: releaseId, status: "failed", reason });
    }
  }
  return report;
}
