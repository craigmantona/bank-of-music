import { requireAuthenticatedUser } from "../_shared/authorization.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://bank-of-music.pages.dev",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
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
    const { action, code, refresh_token } =
      await request.json();

    const clientId =
      Deno.env.get("SPOTIFY_CLIENT_ID");

    const clientSecret =
      Deno.env.get("SPOTIFY_CLIENT_SECRET");

    const redirectUri =
      Deno.env.get("SPOTIFY_REDIRECT_URI");

    if (!clientId || !clientSecret || !redirectUri) {
      return jsonResponse(
        {
          error:
            "Spotify environment variables are missing."
        },
        500
      );
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
