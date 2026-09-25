import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getAdminKey,
  requireAuthenticatedUser
} from "../_shared/authorization.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://bank-of-music.pages.dev",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(
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
    .replace(/\([^)]*(remaster|remastered|live|edit|version)[^)]*\)/gi, "")
    .replace(/\[[^\]]*(remaster|remastered|live|edit|version)[^\]]*\]/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function scoreSpotifyTrackCandidates(
  song: { title: string; artist: string },
  albumTitle: string,
  candidates: any[]
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
      const exactArtist = candidateArtists.includes(wantedArtist);
      const albumExact = Boolean(wantedAlbum) && candidateAlbum === wantedAlbum;
      const albumContains = Boolean(wantedAlbum) && (
        candidateAlbum.includes(wantedAlbum) || wantedAlbum.includes(candidateAlbum)
      );

      if (!exactTitle || !exactArtist) return null;
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

async function resolveSpotifyTrack(songId: number, clientId: string, clientSecret: string) {
  const admin = getAdminClient();
  const { data: song, error: songError } = await admin
    .from("songs")
    .select("id,title,artist,album_id,is_deleted,spotify_track_id,spotify_matched_at")
    .eq("id", songId)
    .maybeSingle();

  if (songError) throw songError;
  if (!song || song.is_deleted === true) return { status: "not_found" };
  if (song.spotify_track_id) {
    return { status: "matched", spotify_track_id: song.spotify_track_id, cached: true };
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
  const searchResponse = await fetch(
    `https://api.spotify.com/v1/search?${new URLSearchParams({
      q: query,
      type: "track",
      limit: "10"
    }).toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (searchResponse.status === 429) {
    throw new SpotifyRateLimitError(readRetryAfter(searchResponse));
  }

  const searchData = await searchResponse.json();
  if (!searchResponse.ok) {
    throw new Error(searchData?.error?.message || `Spotify search failed with HTTP ${searchResponse.status}.`);
  }

  const match = scoreSpotifyTrackCandidates(
    song,
    albumTitle,
    searchData?.tracks?.items || []
  );
  if (!match) return { status: "no_match" };

  const matchedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from("songs")
    .update({ spotify_track_id: match.id, spotify_matched_at: matchedAt })
    .eq("id", song.id)
    .is("spotify_track_id", null)
    .select("spotify_track_id,spotify_matched_at")
    .maybeSingle();
  if (updateError) throw updateError;

  if (updated?.spotify_track_id) {
    return { status: "matched", spotify_track_id: updated.spotify_track_id, cached: false };
  }

  const { data: raced, error: racedError } = await admin
    .from("songs")
    .select("spotify_track_id")
    .eq("id", song.id)
    .maybeSingle();
  if (racedError) throw racedError;
  return raced?.spotify_track_id
    ? { status: "matched", spotify_track_id: raced.spotify_track_id, cached: true }
    : { status: "no_match" };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed." },
      405
    );
  }

  const authorization = await requireAuthenticatedUser(request);

  if (!authorization.ok) {
    return new Response(authorization.response.body, {
      status: authorization.response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const { action, code, refresh_token, song_id } =
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

    const redirectUri = Deno.env.get("SPOTIFY_REDIRECT_URI");
    if (!redirectUri) {
      return jsonResponse({ error: "Spotify redirect URI is missing." }, 500);
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
