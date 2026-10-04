import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getAdminKey,
  requireAuthenticatedUser
} from "../_shared/authorization.ts";

const CANONICAL_SPOTIFY_REDIRECT_URI = "https://thebankofmusic.com/";
const LEGACY_SPOTIFY_REDIRECT_URI = "https://bank-of-music.pages.dev/";
const allowedBrowserOrigins = new Set([
  "https://thebankofmusic.com",
  "https://bank-of-music.pages.dev"
]);

function getCorsHeaders(request: Request) {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedBrowserOrigins.has(origin)
      ? origin
      : "https://thebankofmusic.com",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

function createJsonResponse(
  corsHeaders: Record<string, string>,
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      ...extraHeaders,
      "Content-Type": "application/json"
    }
  });
}

let spotifyAppAccessToken = "";
let spotifyAppAccessTokenExpiresAt = 0;
const MUSICBRAINZ_RECORDING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SPOTIFY_TRACK_ID = /^[A-Za-z0-9]{22}$/;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/;

class SpotifyRateLimitError extends Error {
  retryAfter: number;

  constructor(retryAfter: number) {
    super("Spotify is temporarily rate limited.");
    this.retryAfter = retryAfter;
  }
}

export function normaliseSpotifyMatchText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripSpotifyRemasterSuffix(value: unknown) {
  const descriptor = "(?:remaster(?:ed)?(?:\\s+(?:version|[0-9]{4}))?|[0-9]{4}\\s+remaster(?:ed)?(?:\\s+version)?)";
  return String(value || "").replace(
    new RegExp(`\\s*(?:[-–—:]\\s*${descriptor}|\\(\\s*${descriptor}\\s*\\)|\\[\\s*${descriptor}\\s*\\])\\s*$`, "i"),
    ""
  ).trim();
}

export function scoreSpotifyTrackCandidates(
  song: { title: string; artist: string },
  albumTitle: string,
  candidates: any[],
  allowRemasterSuffix = false
) {
  const wantedTitle = normaliseSpotifyMatchText(song.title);
  const wantedArtist = normaliseSpotifyMatchText(song.artist);
  const wantedAlbum = normaliseSpotifyMatchText(albumTitle);

  const scored = (candidates || [])
    .filter((candidate) => (
      candidate?.id &&
      /^[A-Za-z0-9]+$/.test(candidate.id) &&
      candidate.is_local !== true &&
      candidate.is_playable !== false
    ))
    .map((candidate) => {
      const candidateTitle = normaliseSpotifyMatchText(candidate.name);
      const candidateArtists = (candidate.artists || [])
        .map((artist: { name?: string }) => normaliseSpotifyMatchText(artist?.name))
        .filter(Boolean);
      const candidateAlbum = normaliseSpotifyMatchText(candidate.album?.name);
      const exactTitle = candidateTitle === wantedTitle;
      const remasterTitle = allowRemasterSuffix &&
        stripSpotifyRemasterSuffix(candidate.name) !== String(candidate.name || "").trim() &&
        normaliseSpotifyMatchText(stripSpotifyRemasterSuffix(candidate.name)) === wantedTitle;
      const exactArtist = candidateArtists.includes(wantedArtist);
      const albumExact = Boolean(wantedAlbum) && candidateAlbum === wantedAlbum;
      const albumContains = Boolean(wantedAlbum) && (
        candidateAlbum.includes(wantedAlbum) || wantedAlbum.includes(candidateAlbum)
      );

      if ((!exactTitle && !remasterTitle) || !exactArtist) return null;
      if (wantedAlbum && !albumExact && !albumContains) return null;

      return {
        candidate,
        score: 240 + (albumExact ? 40 : albumContains ? 20 : 0)
      };
    })
    .filter(Boolean)
    .sort((left: any, right: any) => right.score - left.score);

  const best = scored[0];
  const runnerUp = scored[1];
  if (!best) return null;
  if (runnerUp && best.score - runnerUp.score < 20) return null;
  return best.candidate;
}

function getAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const adminKey = getAdminKey();
  if (!supabaseUrl || !adminKey) {
    throw new Error("Missing Supabase server credentials.");
  }
  return createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function readRetryAfter(response: Response) {
  const seconds = Number(response.headers.get("Retry-After") || 1);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 1;
}

async function getSpotifyAppAccessToken(clientId: string, clientSecret: string) {
  if (spotifyAppAccessToken && Date.now() < spotifyAppAccessTokenExpiresAt) {
    return spotifyAppAccessToken;
  }

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "client_credentials" })
  });

  if (response.status === 429) throw new SpotifyRateLimitError(readRetryAfter(response));
  const data = await response.json();
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || "Spotify app authorization failed.");
  }

  spotifyAppAccessToken = data.access_token;
  spotifyAppAccessTokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000 - 60000;
  return spotifyAppAccessToken;
}

async function persistSpotifyTrackId(admin: any, songId: number, spotifyTrackId: string) {
  const matchedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from("songs")
    .update({ spotify_track_id: spotifyTrackId, spotify_matched_at: matchedAt })
    .eq("id", songId)
    .is("spotify_track_id", null)
    .select("spotify_track_id,spotify_matched_at")
    .maybeSingle();
  if (updateError) throw updateError;
  if (updated?.spotify_track_id) return updated.spotify_track_id;

  const { data: raced, error: racedError } = await admin
    .from("songs")
    .select("spotify_track_id")
    .eq("id", songId)
    .maybeSingle();
  if (racedError) throw racedError;
  return raced?.spotify_track_id || "";
}

async function searchSpotifyTracks(accessToken: string, query: string) {
  const response = await fetch(
    `https://api.spotify.com/v1/search?${new URLSearchParams({
      q: query,
      type: "track",
      limit: "10"
    }).toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (response.status === 429) throw new SpotifyRateLimitError(readRetryAfter(response));
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Spotify search failed with HTTP ${response.status}.`);
  }
  return data?.tracks?.items || [];
}

async function fetchMusicBrainzIsrcs(recordingId: string) {
  const response = await fetch(
    `https://musicbrainz.org/ws/2/recording/${encodeURIComponent(recordingId)}?inc=isrcs&fmt=json`,
    { headers: { "User-Agent": "BankOfMusic/1.0 (https://thebankofmusic.com)" } }
  );
  if (!response.ok) throw new Error(`MusicBrainz recording lookup failed with HTTP ${response.status}.`);
  const data = await response.json();
  if (String(data?.id || "").toLowerCase() !== recordingId.toLowerCase()) return [];
  return [...new Set((data?.isrcs || [])
    .map((value: unknown) => String(value || "").toUpperCase())
    .filter((value: string) => ISRC.test(value)))];
}

async function resolveSpotifyTrack(songId: number, clientId: string, clientSecret: string) {
  const admin = getAdminClient();
  const { data: song, error: songError } = await admin
    .from("songs")
    .select("id,title,artist,album_id,is_deleted,external_source,external_id,spotify_track_id,spotify_matched_at")
    .eq("id", songId)
    .maybeSingle();

  if (songError) throw songError;
  if (!song || song.is_deleted === true) return { status: "not_found" };
  if (SPOTIFY_TRACK_ID.test(song.spotify_track_id || "")) {
    return { status: "matched", spotify_track_id: song.spotify_track_id, cached: true, identity_source: "stored" };
  }

  const recordingId = song.external_source === "musicbrainz" &&
    MUSICBRAINZ_RECORDING_ID.test(song.external_id || "")
    ? String(song.external_id).toLowerCase()
    : "";
  if (recordingId) {
    const { data: occurrences, error: occurrenceError } = await admin
      .from("songs")
      .select("id,spotify_track_id")
      .eq("external_source", "musicbrainz")
      .ilike("external_id", recordingId)
      .not("spotify_track_id", "is", null);
    if (occurrenceError) throw occurrenceError;
    const sharedId = (occurrences || [])
      .filter((occurrence: any) => Number(occurrence.id) !== Number(song.id))
      .map((occurrence: any) => occurrence.spotify_track_id)
      .find((value: unknown) => SPOTIFY_TRACK_ID.test(String(value || "")));
    if (sharedId) {
      const persistedId = await persistSpotifyTrackId(admin, song.id, sharedId);
      if (SPOTIFY_TRACK_ID.test(persistedId)) {
        return { status: "matched", spotify_track_id: persistedId, cached: true, identity_source: "recording" };
      }
    }
  }

  let albumTitle = "";
  if (song.album_id) {
    const { data: album, error: albumError } = await admin
      .from("albums")
      .select("title")
      .eq("id", song.album_id)
      .maybeSingle();
    if (albumError) throw albumError;
    albumTitle = album?.title || "";
  }

  const accessToken = await getSpotifyAppAccessToken(clientId, clientSecret);
  const query = [`track:${song.title}`, `artist:${song.artist}`].join(" ");
  const candidates = await searchSpotifyTracks(accessToken, query);
  let match = scoreSpotifyTrackCandidates(
    song,
    albumTitle,
    candidates
  );
  let identitySource = "strict";

  if (!match && recordingId) {
    const authoritativeIsrcs = await fetchMusicBrainzIsrcs(recordingId);
    for (const isrc of authoritativeIsrcs) {
      const isrcCandidates = await searchSpotifyTracks(accessToken, `isrc:${isrc}`);
      match = isrcCandidates.find((candidate: any) => (
        SPOTIFY_TRACK_ID.test(candidate?.id || "") &&
        candidate?.is_local !== true &&
        candidate?.is_playable !== false &&
        String(candidate?.external_ids?.isrc || "").toUpperCase() === isrc
      ));
      if (match) {
        identitySource = "isrc";
        break;
      }
    }
  }
  if (!match) {
    match = scoreSpotifyTrackCandidates(song, albumTitle, candidates, true);
    if (match) identitySource = "remaster";
  }
  if (!match) return { status: "no_match" };

  const persistedId = await persistSpotifyTrackId(admin, song.id, match.id);
  return SPOTIFY_TRACK_ID.test(persistedId)
    ? { status: "matched", spotify_track_id: persistedId, cached: false, identity_source: identitySource }
    : { status: "no_match" };
}

Deno.serve(async (request) => {
  const corsHeaders = getCorsHeaders(request);
  const jsonResponse = (
    body: Record<string, unknown>,
    status = 200,
    extraHeaders: Record<string, string> = {}
  ) => createJsonResponse(corsHeaders, body, status, extraHeaders);

  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authorization = await requireAuthenticatedUser(request);

  if (!authorization.ok) {
    return new Response(authorization.response.body, {
      status: authorization.response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const { action, code, refresh_token, song_id, redirect_uri } =
      await request.json();

    const clientId =
      Deno.env.get("SPOTIFY_CLIENT_ID");

    const clientSecret =
      Deno.env.get("SPOTIFY_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return jsonResponse(
        {
          error:
            "Spotify environment variables are missing."
        },
        500
      );
    }

    if (action === "resolve_track") {
      const songId = Number(song_id);
      if (!Number.isSafeInteger(songId) || songId <= 0) {
        return jsonResponse({ error: "Valid song_id is required." }, 400);
      }

      const result = await resolveSpotifyTrack(songId, clientId, clientSecret);
      return jsonResponse(result, result.status === "not_found" ? 404 : 200);
    }

    const configuredRedirectUri = Deno.env.get("SPOTIFY_REDIRECT_URI");
    if (!configuredRedirectUri) {
      return jsonResponse({ error: "Spotify redirect URI is missing." }, 500);
    }

    const allowedRedirectUris = new Set([
      CANONICAL_SPOTIFY_REDIRECT_URI,
      LEGACY_SPOTIFY_REDIRECT_URI
    ]);

    // Older cached clients omit redirect_uri and must retain their original
    // Pages value while the canonical frontend rolls out.
    const redirectUri = redirect_uri || LEGACY_SPOTIFY_REDIRECT_URI;
    if (typeof redirectUri !== "string" || !allowedRedirectUris.has(redirectUri)) {
      return jsonResponse({ error: "Spotify redirect URI is invalid." }, 400);
    }

    let tokenBody;

    if (action === "exchange") {
      if (!code) {
        return jsonResponse(
          { error: "Spotify code is missing." },
          400
        );
      }

      tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      });
    } else if (action === "refresh") {
      if (!refresh_token) {
        return jsonResponse(
          { error: "Refresh token is missing." },
          400
        );
      }

      tokenBody = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token
      });
    } else {
      return jsonResponse(
        { error: "Unknown Spotify token action." },
        400
      );
    }

    const basicAuthorization = btoa(
      `${clientId}:${clientSecret}`
    );

    const spotifyResponse = await fetch(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: {
          Authorization:
            `Basic ${basicAuthorization}`,
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body: tokenBody
      }
    );

    const spotifyData =
      await spotifyResponse.json();

    if (!spotifyResponse.ok) {
      console.error(
        "Spotify token error:",
        spotifyData
      );

      return jsonResponse(
        {
          error:
            spotifyData?.error_description ||
            spotifyData?.error ||
            "Spotify rejected the token request.",
          spotify_status: spotifyResponse.status
        },
        spotifyResponse.status
      );
    }

    return jsonResponse(spotifyData);
  } catch (error) {
    console.error("spotify-token failed:", error);

    if (error instanceof SpotifyRateLimitError) {
      return jsonResponse(
        { error: error.message, retry_after: error.retryAfter },
        429,
        { "Retry-After": String(error.retryAfter) }
      );
    }

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error."
      },
      500
    );
  }
});
