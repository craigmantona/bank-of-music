(function initialiseBOMAppleMusicPlaylist(root) {
  const DEFAULT_STOREFRONT = "gb";
  const SOUNDIIZ_IMPORT_ENDPOINT = "/api/soundiiz-import";
  const SOUNDIIZ_APPLE_MUSIC_DESTINATION = "applemusicapp";
  const SOUNDIIZ_MAX_TRACKS = 200;

  function normaliseText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function getTrackKey(track) {
    return [normaliseText(track?.artist), normaliseText(track?.title)].join("|");
  }

  function buildAppleMusicSearchUrl(track, storefront = DEFAULT_STOREFRONT) {
    const safeStorefront = /^[a-z]{2}$/i.test(String(storefront || ""))
      ? String(storefront).toLowerCase()
      : DEFAULT_STOREFRONT;
    const terms = [track?.title, track?.artist, track?.album]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");

    return `https://music.apple.com/${safeStorefront}/search?term=${encodeURIComponent(terms)}`;
  }

  function preparePlaylist({ playlistName, tracks, storefront = DEFAULT_STOREFRONT }) {
    const seen = new Set();
    const preparedTracks = [];

    for (const track of tracks || []) {
      const title = String(track?.title || "").trim();
      const artist = String(track?.artist || "").trim();
      const key = getTrackKey({ title, artist });
      if (!title || !artist || !key || seen.has(key)) continue;
      seen.add(key);
      preparedTracks.push({
        ...track,
        title,
        artist,
        appleMusicUrl: buildAppleMusicSearchUrl(track, storefront)
      });
    }

    return {
      playlistName: String(playlistName || "BoM Playlist").trim() || "BoM Playlist",
      tracks: preparedTracks
    };
  }

  function buildShareText({ playlistName, tracks }) {
    const heading = String(playlistName || "BoM Playlist").trim() || "BoM Playlist";
    const lines = (tracks || []).map((track, index) => (
      `${index + 1}. ${track.title} — ${track.artist}\n${track.appleMusicUrl}`
    ));

    return [
      heading,
      "Apple Music links prepared by Bank of Music",
      "",
      ...lines
    ].join("\n");
  }

  async function sharePlaylist({ playlistName, tracks, share, copy }) {
    const text = buildShareText({ playlistName, tracks });
    if (typeof share === "function") {
      try {
        await share({ title: playlistName, text });
        return "shared";
      } catch (error) {
        if (error?.name === "AbortError") return "aborted";
      }
    }
    if (typeof copy !== "function") {
      throw new Error("Apple Music playlist sharing is unavailable.");
    }
    await copy(text);
    return "copied";
  }

  function chunkTracks(tracks, maximum = SOUNDIIZ_MAX_TRACKS) {
    const size = Number(maximum);
    if (!Number.isSafeInteger(size) || size < 1 || size > SOUNDIIZ_MAX_TRACKS) {
      throw new Error(`Soundiiz imports must contain at most ${SOUNDIIZ_MAX_TRACKS} tracks.`);
    }
    const chunks = [];
    for (let index = 0; index < (tracks || []).length; index += size) {
      chunks.push(tracks.slice(index, index + size));
    }
    return chunks;
  }

  function buildSoundiizImportRequests({ playlistName, tracks, sourceLabel = "Bank of Music" }) {
    const safeName = String(playlistName || "BoM Playlist").trim() || "BoM Playlist";
    const trackChunks = chunkTracks(tracks);
    if (!trackChunks.length) {
      throw new Error("At least one track is required to create a Soundiiz transfer link.");
    }

    return trackChunks.map((chunk, index) => {
      const partNumber = index + 1;
      const partCount = trackChunks.length;
      const partSuffix = partCount > 1 ? ` • Part ${partNumber} of ${partCount}` : "";
      const splitExplanation = partCount > 1
        ? ` Part ${partNumber} of ${partCount}; Soundiiz accepts up to ${SOUNDIIZ_MAX_TRACKS} tracks per transfer.`
        : "";
      return {
        partNumber,
        partCount,
        trackCount: chunk.length,
        payload: {
          title: `${safeName}${partSuffix}`,
          sourceName: "Bank of Music",
          sourceLogo: "https://thebankofmusic.com/logo.jpeg",
          description: `Prepared from ${String(sourceLabel || "Bank of Music").trim() || "Bank of Music"}.${splitExplanation}`,
          destination: SOUNDIIZ_APPLE_MUSIC_DESTINATION,
          tracklist: chunk.map((track) => {
            const soundiizTrack = {
              title: String(track?.title || "").trim(),
              artists: [String(track?.artist || "").trim()].filter(Boolean)
            };
            const album = String(track?.album || "").trim();
            if (album) soundiizTrack.album = album;
            return soundiizTrack;
          })
        }
      };
    });
  }

  function isSafeSoundiizShareUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" &&
        url.hostname === "soundiiz.com" &&
        /^\/go\/import-playlist\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
    } catch {
      return false;
    }
  }

  async function readResponseData(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function createSoundiizImportLinks({
    playlistName,
    tracks,
    sourceLabel,
    request = root.fetch?.bind(root),
    onProgress = () => {}
  }) {
    if (typeof request !== "function") {
      throw new Error("Soundiiz transfer links are unavailable in this browser.");
    }
    const imports = buildSoundiizImportRequests({ playlistName, tracks, sourceLabel });
    const links = [];

    for (let index = 0; index < imports.length; index += 1) {
      const item = imports[index];
      try {
        const response = await request(SOUNDIIZ_IMPORT_ENDPOINT, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(item.payload)
        });
        const data = await readResponseData(response);
        if (!response?.ok) {
          const fallback = response?.status === 429
            ? "Soundiiz is receiving too many requests. Please wait a minute and try again."
            : "Soundiiz could not prepare this transfer link.";
          throw new Error(String(data?.message || fallback));
        }
        if (!isSafeSoundiizShareUrl(data?.shareUrl)) {
          throw new Error("Soundiiz returned an invalid transfer link.");
        }
        links.push({
          partNumber: item.partNumber,
          partCount: item.partCount,
          trackCount: Number(data?.nbTracks) || item.trackCount,
          shareUrl: data.shareUrl,
          expiresAt: Number(data?.expiresAt) || null
        });
        onProgress({ completed: index + 1, total: imports.length, link: links.at(-1) });
      } catch (error) {
        error.soundiizLinks = links;
        error.soundiizTotalParts = imports.length;
        throw error;
      }
    }

    return links;
  }

  root.BOMAppleMusicPlaylist = Object.freeze({
    DEFAULT_STOREFRONT,
    SOUNDIIZ_IMPORT_ENDPOINT,
    SOUNDIIZ_APPLE_MUSIC_DESTINATION,
    SOUNDIIZ_MAX_TRACKS,
    buildAppleMusicSearchUrl,
    preparePlaylist,
    buildShareText,
    sharePlaylist,
    chunkTracks,
    buildSoundiizImportRequests,
    isSafeSoundiizShareUrl,
    createSoundiizImportLinks
  });
})(typeof window !== "undefined" ? window : globalThis);
