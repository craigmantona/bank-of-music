const SOUNDIIZ_ENDPOINT = "https://soundiiz.com/go/import-playlist";
const APPLE_MUSIC_DESTINATION = "applemusicapp";
const MAX_TRACKS = 200;
const MAX_BODY_BYTES = 128 * 1024;

function jsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function text(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

function normaliseTrack(track) {
  const title = text(track?.title, 500);
  if (!title) return null;
  const artists = (Array.isArray(track?.artists) ? track.artists : [track?.artists])
    .map((artist) => text(artist, 300))
    .filter(Boolean)
    .slice(0, 10);
  const album = text(track?.album, 500);
  return {
    title,
    ...(artists.length ? { artists } : {}),
    ...(album ? { album } : {})
  };
}

function isSafeShareUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" &&
      url.hostname === "soundiiz.com" &&
      /^\/go\/import-playlist\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function handleSoundiizImport(request, requestSoundiiz = fetch) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (!origin || origin !== requestUrl.origin) {
    return jsonResponse({ status: "error", message: "This request must come from Bank of Music." }, 403);
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return jsonResponse({ status: "error", message: "A JSON request body is required." }, 415);
  }
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ status: "error", message: "The playlist request is too large." }, 413);
  }

  let rawBody;
  let body;
  try {
    rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return jsonResponse({ status: "error", message: "The playlist request is too large." }, 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ status: "error", message: "The playlist request is not valid JSON." }, 400);
  }

  const title = text(body?.title, 300);
  if (!title) {
    return jsonResponse({ status: "error", message: "A playlist title is required." }, 400);
  }
  if (!Array.isArray(body?.tracklist) || body.tracklist.length < 1 || body.tracklist.length > MAX_TRACKS) {
    return jsonResponse({
      status: "error",
      message: `Each Soundiiz transfer must contain between 1 and ${MAX_TRACKS} tracks.`
    }, 400);
  }
  const tracklist = body.tracklist.map(normaliseTrack);
  if (tracklist.some((track) => !track)) {
    return jsonResponse({ status: "error", message: "Every track must have a title." }, 400);
  }

  const payload = {
    title,
    sourceName: "Bank of Music",
    sourceLogo: "https://thebankofmusic.com/logo.jpeg",
    description: text(body?.description, 1000),
    destination: APPLE_MUSIC_DESTINATION,
    tracklist
  };

  let upstream;
  try {
    upstream = await requestSoundiiz(SOUNDIIZ_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch {
    return jsonResponse({
      status: "error",
      message: "Soundiiz could not be reached. Your Apple Music search links are still available."
    }, 502);
  }

  const data = await readJson(upstream);
  if (!upstream.ok) {
    const status = upstream.status === 429 ? 429 : upstream.status >= 400 && upstream.status < 500 ? 400 : 502;
    const message = text(data?.message, 500) || (status === 429
      ? "Soundiiz is receiving too many requests. Please wait a minute and try again."
      : "Soundiiz could not prepare this transfer link.");
    const retryAfter = upstream.headers.get("Retry-After");
    return jsonResponse(
      { status: "error", message },
      status,
      retryAfter ? { "Retry-After": retryAfter } : {}
    );
  }
  if (!isSafeShareUrl(data?.shareUrl)) {
    return jsonResponse({ status: "error", message: "Soundiiz returned an invalid transfer link." }, 502);
  }

  return jsonResponse({
    status: "success",
    nbTracks: Number(data?.nbTracks) || tracklist.length,
    shareUrl: data.shareUrl,
    expiresAt: Number(data?.expiresAt) || null
  });
}

export async function onRequestPost(context) {
  return handleSoundiizImport(context.request);
}
