import { createClient } from "npm:@supabase/supabase-js@2";
import { getAdminKey, requireAdminUser } from "../_shared/authorization.ts";
import { catalogueFetch, musicBrainzIdentity } from "../_shared/catalogue-worker.ts";
import {
  ADMIN_CATALOGUE_MAX_ALBUMS,
  normaliseCatalogueText,
  resolveRequestedAlbum,
  searchArtistCandidates,
  type RequestedAlbum
} from "../_shared/admin-catalogue.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const adminKey = getAdminKey();
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const musicBrainzUserAgent = musicBrainzIdentity(Deno.env.get("MUSICBRAINZ_CONTACT_EMAIL"));

const service = createClient(supabaseUrl, adminKey, {
  global: { fetch: catalogueFetch },
  auth: { persistSession: false, autoRefreshToken: false }
});

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const allowed = origin === "https://thebankofmusic.com" ||
    origin === "https://bank-of-music.pages.dev" ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://bank-of-music.pages.dev",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Content-Type": "application/json",
    "Vary": "Origin"
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

function uuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    .test(String(value || ""));
}

async function reserveMusicBrainzSlot() {
  const { data, error } = await service.rpc("admin_catalogue_musicbrainz_slot");
  if (error) throw new Error(`MusicBrainz coordination failed: ${error.message}`);
  const wait = Math.max(0, Number(data || 0));
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
}

async function musicBrainzGet(path: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await reserveMusicBrainzSlot();
    const response = await catalogueFetch(`https://musicbrainz.org/ws/2${path}`, {
      headers: { Accept: "application/json", "User-Agent": musicBrainzUserAgent }
    });
    if (response.ok) return response.json();
    await response.body?.cancel();
    lastError = new Error(`MusicBrainz ${response.status}`);
    if (![429, 502, 503, 504].includes(response.status)) break;
    await new Promise(resolve => setTimeout(resolve, 1200 * (attempt + 1)));
  }
  throw lastError || new Error("MusicBrainz request failed");
}

async function artworkAvailable(url: string) {
  try {
    const response = await catalogueFetch(url, { method: "HEAD" });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

async function findExisting(identity: any) {
  const select = "id,title,artist,is_deleted,external_source,external_id,musicbrainz_release_id,musicbrainz_release_group_id";
  for (const [exact, query] of [
    [true, () => service.from("albums").select(select)
      .eq("musicbrainz_release_group_id", identity.musicbrainz_release_group_id).limit(10)],
    [true, () => service.from("albums").select(select)
      .eq("musicbrainz_release_id", identity.musicbrainz_release_id).limit(10)],
    [false, () => service.from("albums").select(select).ilike("artist", identity.artist).limit(100)]
  ] as const) {
    const { data, error } = await query();
    if (error) throw new Error(`Duplicate lookup failed: ${error.message}`);
    if (Array.isArray(data) && data.length) {
      const matches = exact ? data : data.filter(album =>
        normaliseCatalogueText(album.title) === normaliseCatalogueText(identity.title) &&
        normaliseCatalogueText(album.artist) === normaliseCatalogueText(identity.artist)
      );
      const match = matches.find(album => !album.is_deleted) || matches[0];
      if (match) return match;
    }
  }
  return null;
}

function validateArtist(value: any) {
  const artist = {
    id: String(value?.id || "").trim().toLowerCase(),
    name: String(value?.name || "").trim(),
    country: String(value?.country || "").trim().toUpperCase()
  };
  if (!uuid(artist.id) || !artist.name) throw new Error("A confirmed MusicBrainz artist is required.");
  return artist;
}

function validateRequests(value: any): RequestedAlbum[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > ADMIN_CATALOGUE_MAX_ALBUMS) {
    throw new Error(`Enter between 1 and ${ADMIN_CATALOGUE_MAX_ALBUMS} albums.`);
  }
  return value.map((album, index) => {
    const request = {
      client_id: String(album?.client_id || `album-${index + 1}`),
      title: String(album?.title || "").trim(),
      uk_release_date: String(album?.uk_release_date || "").trim(),
      release_group_id: String(album?.release_group_id || "").trim().toLowerCase(),
      release_id: String(album?.release_id || "").trim().toLowerCase()
    };
    if (!request.title) throw new Error(`Album ${index + 1} needs a title.`);
    if (request.release_group_id && !uuid(request.release_group_id)) {
      throw new Error(`Album ${index + 1} has an invalid MusicBrainz release-group ID.`);
    }
    if (request.release_id && !uuid(request.release_id)) {
      throw new Error(`Album ${index + 1} has an invalid MusicBrainz release ID.`);
    }
    if (request.uk_release_date && !/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(request.uk_release_date)) {
      throw new Error(`Album ${index + 1} has an invalid UK release date.`);
    }
    return request;
  });
}

async function resolveAll(artist: any, albums: RequestedAlbum[]): Promise<any[]> {
  const results: any[] = [];
  for (const album of albums) {
    try {
      results.push(await resolveRequestedAlbum({
        artist, request: album, musicBrainzGet, findExisting, artworkAvailable
      }));
    } catch (error) {
      results.push({
        client_id: album.client_id || "",
        requested_title: album.title || "",
        status: "failed",
        reason: String((error as Error)?.message || error)
      });
    }
  }
  return results;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "POST") return json(request, { ok: false, error: "Method not allowed." }, 405);
  if (!supabaseUrl || !adminKey || !publishableKey) {
    return json(request, { ok: false, error: "Admin Catalogue is not configured." }, 503);
  }

  const authorization = await requireAdminUser(request);
  if (!authorization.ok) {
    const denied = authorization.response;
    return json(request, await denied.clone().json(), denied.status);
  }

  try {
    const body = await request.json();
    const authorizationHeader = request.headers.get("authorization") || "";
    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorizationHeader }, fetch: catalogueFetch },
      auth: { persistSession: false, autoRefreshToken: false }
    });

    if (body?.action === "delete_album_preview" || body?.action === "delete_album") {
      const albumId = Number(body.album_id);
      if (!Number.isSafeInteger(albumId) || albumId <= 0) {
        return json(request, { ok: false, error: "Choose a valid BOM album." }, 400);
      }
      const { data, error } = await userClient.rpc("admin_catalogue_delete_album", {
        p_album_id: albumId,
        p_execute: body.action === "delete_album"
      });
      if (error) return json(request, { ok: false, error: error.message }, 400);
      return json(request, { ok: true, deletion: data });
    }

    if (body?.action === "search_artist") {
      const name = String(body.artist_name || "").trim();
      if (!name) return json(request, { ok: false, error: "Enter an artist name." }, 400);
      const candidates = await searchArtistCandidates(name, musicBrainzGet);
      return json(request, { ok: true, candidates });
    }

    const artist = validateArtist(body?.artist);
    const albums = validateRequests(body?.albums);
    const previews = await resolveAll(artist, albums);

    if (body?.action === "preview") {
      return json(request, { ok: true, artist, previews });
    }
    if (body?.action !== "commit") {
      return json(request, { ok: false, error: "Unknown Admin Catalogue action." }, 400);
    }

    const results = [];
    for (const preview of previews as any[]) {
      if (preview.status === "already_exists") {
        results.push({
          client_id: preview.client_id,
          requested_title: preview.requested_title,
          status: "already_exists",
          album_id: preview.existing_album_id
        });
        continue;
      }
      if (preview.status !== "ready") {
        results.push({
          client_id: preview.client_id,
          requested_title: preview.requested_title,
          status: preview.status === "failed" ? "failed" : "needs_correction",
          reason: preview.reason || "preview_not_ready"
        });
        continue;
      }
      const { data, error } = await userClient.rpc("admin_add_catalogue_album", {
        p_album: preview.album,
        p_tracks: preview.tracks
      });
      results.push(error ? {
        client_id: preview.client_id,
        requested_title: preview.requested_title,
        status: "failed",
        reason: error.message
      } : {
        client_id: preview.client_id,
        requested_title: preview.requested_title,
        ...data
      });
    }
    return json(request, { ok: true, artist, results });
  } catch (error) {
    return json(request, { ok: false, error: String((error as Error)?.message || error) }, 400);
  }
});
