(function initialiseBOMSpotifyPlaylistSync(root) {
  "use strict";

  const TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/;
  const MAX_RATE_LIMIT_RETRIES = 2;
  const MAX_RETRY_AFTER_SECONDS = 60;

  function isValidSpotifyTrackId(value) {
    return TRACK_ID_PATTERN.test(String(value || ""));
  }

  function spotifyTrackUri(id) {
    return `spotify:track:${id}`;
  }

  function readRetryAfterSeconds(error) {
    const seconds = Number(error?.retryAfter);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : 1;
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function resolveDesiredTracks({
    tracks,
    getRecordingMatch,
    getCachedMatch,
    resolveMissing,
    onProgress = () => {},
    sleep = wait,
    maxRateLimitRetries = MAX_RATE_LIMIT_RETRIES,
    maxRetryAfterSeconds = MAX_RETRY_AFTER_SECONDS
  }) {
    const resolved = [];
    const unresolved = [];
    let reused = 0;
    const storedTotal = tracks.filter((track) => isValidSpotifyTrackId(track.spotify_track_id)).length;
    let recordingReused = 0;
    let cached = 0;
    let newlyMatched = 0;

    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index];
      let spotifyTrackId = isValidSpotifyTrackId(track.spotify_track_id)
        ? track.spotify_track_id
        : "";

      if (spotifyTrackId) {
        reused += 1;
      } else {
        const recordingMatch = await getRecordingMatch?.(track);
        if (isValidSpotifyTrackId(recordingMatch?.id)) {
          spotifyTrackId = recordingMatch.id;
          recordingReused += 1;
        }
      }

      if (!spotifyTrackId) {
        const cachedMatch = getCachedMatch?.(track);
        if (isValidSpotifyTrackId(cachedMatch?.id)) {
          spotifyTrackId = cachedMatch.id;
          cached += 1;
        }
      }

      if (!spotifyTrackId) {
        let rateLimitAttempts = 0;
        while (!spotifyTrackId) {
          try {
            const match = await resolveMissing(track);
            if (!isValidSpotifyTrackId(match?.id)) {
              unresolved.push({
                ...track,
                songId: track.song?.id ?? track.song_id ?? track.id ?? null
              });
              break;
            }
            spotifyTrackId = match.id;
            if (match.identitySource === "recording") recordingReused += 1;
            else newlyMatched += 1;
          } catch (error) {
            if (error?.status !== 429 && !error?.retryAfter) throw error;
            const retryAfter = readRetryAfterSeconds(error);
            if (rateLimitAttempts >= maxRateLimitRetries || retryAfter > maxRetryAfterSeconds) {
              const exhausted = new Error(
                `Spotify rate limit recovery failed. Try again after ${retryAfter} second${retryAfter === 1 ? "" : "s"}.`
              );
              exhausted.status = 429;
              exhausted.retryAfter = retryAfter;
              throw exhausted;
            }
            rateLimitAttempts += 1;
            onProgress({ phase: "rate-limit", index, total: tracks.length, retryAfter });
            await sleep(retryAfter * 1000);
          }
        }
      }

      if (spotifyTrackId) {
        resolved.push({ ...track, spotify_track_id: spotifyTrackId, uri: spotifyTrackUri(spotifyTrackId) });
      }
      onProgress({
        phase: "resolution",
        completed: index + 1,
        total: tracks.length,
        reused,
        storedTotal,
        recordingReused,
        cached,
        newlyMatched,
        unresolved: unresolved.length
      });
    }

    return { tracks: resolved, unresolved, reused, storedTotal, recordingReused, cached, newlyMatched };
  }

  async function fetchSpotifyPlaylistTrackIds(request, playlistId) {
    let path = `/playlists/${encodeURIComponent(playlistId)}/items?limit=100`;
    const trackIds = [];

    while (path) {
      const data = await request(path);
      for (const item of data?.items || []) {
        if (isValidSpotifyTrackId(item?.track?.id)) trackIds.push(item.track.id);
      }
      if (!data?.next) break;
      const nextUrl = new URL(data.next);
      path = nextUrl.pathname.replace(/^\/v1/, "") + nextUrl.search;
    }

    return trackIds;
  }

  function calculateSpotifyPlaylistDelta(desiredTrackIds, existingTrackIds, { preserveExisting = false } = {}) {
    const desired = [...new Set(desiredTrackIds.filter(isValidSpotifyTrackId))];
    const existingCounts = new Map();
    existingTrackIds.filter(isValidSpotifyTrackId).forEach((id) => {
      existingCounts.set(id, (existingCounts.get(id) || 0) + 1);
    });
    const desiredSet = new Set(desired);
    if (preserveExisting) {
      return {
        desired,
        alreadyPresent: desired.filter((id) => existingCounts.has(id)),
        additions: desired.filter((id) => !existingCounts.has(id)),
        removals: []
      };
    }
    const duplicateDesired = new Set(
      [...existingCounts].filter(([id, count]) => desiredSet.has(id) && count > 1).map(([id]) => id)
    );
    const removals = [...existingCounts.keys()].filter(
      (id) => !desiredSet.has(id) || duplicateDesired.has(id)
    );
    const additions = desired.filter(
      (id) => !existingCounts.has(id) || duplicateDesired.has(id)
    );
    const alreadyPresent = desired.filter(
      (id) => existingCounts.get(id) === 1
    );
    return { desired, alreadyPresent, additions, removals };
  }

  function batches(values, size = 100) {
    const result = [];
    for (let index = 0; index < values.length; index += size) {
      result.push(values.slice(index, index + size));
    }
    return result;
  }

  async function applySpotifyPlaylistDelta(request, playlistId, delta) {
    let writes = 0;
    for (const ids of batches(delta.removals)) {
      await request(`/playlists/${encodeURIComponent(playlistId)}/items`, {
        method: "DELETE",
        body: JSON.stringify({ tracks: ids.map((id) => ({ uri: spotifyTrackUri(id) })) })
      });
      writes += 1;
    }
    for (const ids of batches(delta.additions)) {
      await request(`/playlists/${encodeURIComponent(playlistId)}/items`, {
        method: "POST",
        body: JSON.stringify({ uris: ids.map(spotifyTrackUri) })
      });
      writes += 1;
    }
    return writes;
  }

  root.BOMSpotifyPlaylistSync = Object.freeze({
    MAX_RATE_LIMIT_RETRIES,
    MAX_RETRY_AFTER_SECONDS,
    isValidSpotifyTrackId,
    readRetryAfterSeconds,
    resolveDesiredTracks,
    fetchSpotifyPlaylistTrackIds,
    calculateSpotifyPlaylistDelta,
    applySpotifyPlaylistDelta
  });
})(typeof window !== "undefined" ? window : globalThis);
