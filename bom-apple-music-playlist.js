(function initialiseBOMAppleMusicPlaylist(root) {
  const DEFAULT_STOREFRONT = "gb";

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

  root.BOMAppleMusicPlaylist = Object.freeze({
    DEFAULT_STOREFRONT,
    buildAppleMusicSearchUrl,
    preparePlaylist,
    buildShareText,
    sharePlaylist
  });
})(typeof window !== "undefined" ? window : globalThis);
