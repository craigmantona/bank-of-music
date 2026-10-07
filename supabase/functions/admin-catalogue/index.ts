import { createClient } from "npm:@supabase/supabase-js@2";
import { getAdminKey, requireAdminUser } from "../_shared/authorization.ts";
import { catalogueFetch, musicBrainzIdentity } from "../_shared/catalogue-worker.ts";
import {
  ADMIN_CATALOGUE_MAX_ALBUMS,
  normaliseCatalogueText,
  resolveExistingAlbumRelease,
  resolveRequestedAlbum,
  resolveSelectedRelease,
  searchArtistCandidates,
  searchReleaseCandidates,
  type RequestedAlbum
} from "../_shared/admin-catalogue.ts";
import {
  DURATION_BACKFILL_MAX_ALBUMS,
  runDurationBackfillBatch,
  storedMusicBrainzReleaseId
} from "../_shared/musicbrainz-duration-backfill.ts";

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

function validFullIsoDate(value: unknown) {
  const date = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
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

async function durationBackfillBatch(body: any) {
  const dryRun = body?.action === "duration_backfill_preview";
  const afterAlbumId = Math.max(0, Number(body?.after_album_id || 0));
  const requestedLimit = Number(body?.limit || DURATION_BACKFILL_MAX_ALBUMS);
  if (!Number.isSafeInteger(afterAlbumId) || !Number.isSafeInteger(requestedLimit) ||
      requestedLimit < 1 || requestedLimit > DURATION_BACKFILL_MAX_ALBUMS) {
    throw new Error(`Duration backfill requires a valid cursor and a limit from 1 to ${DURATION_BACKFILL_MAX_ALBUMS}.`);
  }
  const { data, error } = await service.from("albums")
    .select("id,musicbrainz_release_id,external_source,external_id")
    .eq("is_deleted", false)
    .gt("id", afterAlbumId)
    .or("musicbrainz_release_id.not.is.null,and(external_source.eq.musicbrainz,external_id.not.is.null)")
    .order("id")
    .limit(requestedLimit);
  if (error) throw new Error(`Duration album lookup failed: ${error.message}`);
  const scanned = data || [];
  const albums = scanned.filter(storedMusicBrainzReleaseId);
  const report = await runDurationBackfillBatch({
    albums,
    dryRun,
    fetchSongs: async albumId => {
      const result = await service.from("songs")
        .select("id,album_id,track_position,external_source,external_id,duration_ms,is_deleted")
        .eq("album_id", albumId).eq("is_deleted", false).order("id");
      if (result.error) throw new Error(`Song lookup failed: ${result.error.message}`);
      return result.data || [];
    },
    fetchRelease: releaseId => musicBrainzGet(
      `/release/${encodeURIComponent(releaseId)}?inc=recordings&fmt=json`
    ),
    updateDuration: async update => {
      const result = await service.from("songs")
        .update({ duration_ms: update.duration_ms })
        .eq("id", update.song_id)
        .eq("album_id", update.album_id)
        .eq("is_deleted", false)
        .is("duration_ms", null)
        .select("id").maybeSingle();
      if (result.error) throw new Error(`Duration update failed: ${result.error.message}`);
      return Boolean(result.data?.id);
    }
  });
  return {
    ...report,
    after_album_id: afterAlbumId,
    next_after_album_id: scanned.length ? Number(scanned[scanned.length - 1].id) : afterAlbumId,
    scanned_albums: scanned.length,
    candidate_albums: albums.length,
    has_more: scanned.length === requestedLimit
  };
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

    if (body?.action === "duration_backfill_preview" || body?.action === "duration_backfill") {
      return json(request, { ok: true, backfill: await durationBackfillBatch(body) });
    }

    if (body?.action === "search_releases") {
      const artistName = String(body.artist_name || "").trim();
      const releaseTitle = String(body.release_title || "").trim();
      if (!artistName || !releaseTitle || artistName.length > 300 || releaseTitle.length > 300) {
        return json(request, { ok: false, error: "Enter an artist and release title." }, 400);
      }
      const releases = await searchReleaseCandidates(artistName, releaseTitle, musicBrainzGet);
      return json(request, { ok: true, releases });
    }

    if (body?.action === "preview_release" || body?.action === "add_release") {
      const releaseId = String(body.release_id || "").trim().toLowerCase();
      if (!uuid(releaseId)) {
        return json(request, { ok: false, error: "Choose a valid MusicBrainz release." }, 400);
      }
      const preview = await resolveSelectedRelease({
        releaseId, musicBrainzGet, findExisting, artworkAvailable
      });
      if (body.action === "preview_release") {
        return json(request, { ok: true, preview });
      }
      if (preview.status === "already_exists") {
        return json(request, {
          ok: true,
          result: { status: "already_exists", album_id: preview.existing_album_id }
        });
      }
      if (preview.status !== "ready") {
        return json(request, {
          ok: false,
          error: preview.reason || "The selected release is not ready to add."
        }, 400);
      }
      const { data, error } = await userClient.rpc("admin_add_catalogue_album", {
        p_album: preview.album,
        p_tracks: preview.tracks
      });
      if (error) return json(request, { ok: false, error: error.message }, 400);
      return json(request, { ok: true, result: data });
    }

    if (body?.action === "convert_definitely_maybe_preview" ||
        body?.action === "convert_definitely_maybe") {
      const { data, error } = await userClient.rpc("admin_convert_definitely_maybe", {
        p_execute: body.action === "convert_definitely_maybe"
      });
      if (error) return json(request, { ok: false, error: error.message }, 400);
      return json(request, { ok: true, conversion: data });
    }

    if (body?.action === "list_exclusions") {
      const { data, error } = await userClient.from("catalogue_release_group_exclusions")
        .select("musicbrainz_release_group_id,artist,title,excluded_at")
        .order("artist").order("title");
      if (error) return json(request, { ok: false, error: error.message }, 400);
      return json(request, { ok: true, exclusions: data || [] });
    }

    if (body?.action === "exclude_release_group") {
      const releaseGroupId = String(body.musicbrainz_release_group_id || "").trim().toLowerCase();
      const artist = String(body.artist || "").trim();
      const title = String(body.title || "").trim();
      if (!uuid(releaseGroupId) || !artist || !title || artist.length > 300 || title.length > 300) {
        return json(request, { ok: false, error: "Choose a valid remote MusicBrainz album." }, 400);
      }
      const { data, error } = await userClient.from("catalogue_release_group_exclusions")
        .insert({ musicbrainz_release_group_id: releaseGroupId, artist, title })
        .select("musicbrainz_release_group_id,artist,title,excluded_at").single();
      if (error) return json(request, { ok: false, error: error.message }, 400);
      return json(request, { ok: true, exclusion: data });
    }

    if (body?.action === "restore_exclusion") {
      const releaseGroupId = String(body.musicbrainz_release_group_id || "").trim().toLowerCase();
      if (!uuid(releaseGroupId)) return json(request, { ok: false, error: "Choose a valid release-group exclusion." }, 400);
      const { data, error } = await userClient.from("catalogue_release_group_exclusions")
        .delete().eq("musicbrainz_release_group_id", releaseGroupId)
        .select("musicbrainz_release_group_id,artist,title").maybeSingle();
      if (error) return json(request, { ok: false, error: error.message }, 400);
      if (!data) return json(request, { ok: false, error: "Catalogue exclusion not found." }, 404);
      return json(request, { ok: true, restored: data });
    }

    if (body?.action === "edit_album_date") {
      const albumId = Number(body.album_id);
      const originalReleaseDate = String(body.original_release_date || "").trim();
      if (!Number.isSafeInteger(albumId) || albumId <= 0) {
        return json(request, { ok: false, error: "Choose a valid BOM album." }, 400);
      }
      if (!validFullIsoDate(originalReleaseDate)) {
        return json(request, { ok: false, error: "Enter a valid full release date in YYYY-MM-DD format." }, 400);
      }
      const { data, error } = await userClient.from("albums")
        .update({ original_release_date: originalReleaseDate })
        .eq("id", albumId)
        .select("id, artist, title, original_release_date")
        .single();
      if (error) return json(request, { ok: false, error: error.message }, 400);
      return json(request, { ok: true, album: data });
    }

    if (body?.action === "edit_album_title") {
      const albumId = Number(body.album_id);
      const title = String(body.title || "").trim();
      if (!Number.isSafeInteger(albumId) || albumId <= 0) {
        return json(request, { ok: false, error: "Choose a valid BOM album." }, 400);
      }
      if (!title || title.length > 300) {
        return json(request, { ok: false, error: "Enter an album title between 1 and 300 characters." }, 400);
      }
      const { data, error } = await userClient.from("albums")
        .update({ title })
        .eq("id", albumId)
        .select("id, artist, title")
        .single();
      if (error) return json(request, { ok: false, error: error.message }, 400);
      return json(request, { ok: true, album: data });
    }

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

    if (body?.action === "reconcile_album") {
      const albumId = Number(body.album_id);
      if (!Number.isSafeInteger(albumId) || albumId <= 0) {
        return json(request, { ok: false, error: "Choose a valid BOM album." }, 400);
      }
      const { data: album, error: albumError } = await service.from("albums")
        .select("id,title,artist,is_deleted,external_source,external_id,musicbrainz_release_id,musicbrainz_release_group_id")
        .eq("id", albumId).maybeSingle();
      if (albumError) return json(request, { ok: false, error: albumError.message }, 400);
      if (!album || album.is_deleted) return json(request, { ok: false, error: "Active BOM album not found." }, 404);

      const resolved = await resolveExistingAlbumRelease({ album, musicBrainzGet });
      if (resolved.status !== "ready") {
        return json(request, { ok: true, reconciliation: resolved });
      }
      const { data, error } = await userClient.rpc("admin_reconcile_catalogue_album", {
        p_album_id: albumId,
        p_album: resolved.album,
        p_tracks: resolved.tracks
      });
      if (error) return json(request, { ok: false, error: error.message }, 400);
      return json(request, { ok: true, reconciliation: data });
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
