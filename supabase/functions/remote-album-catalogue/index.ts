import { createClient } from "npm:@supabase/supabase-js@2";
import { getAdminKey, requireAuthenticatedUser } from "../_shared/authorization.ts";
import { catalogueFetch, musicBrainzIdentity } from "../_shared/catalogue-worker.ts";
import {
  normaliseCatalogueText,
  resolveRequestedAlbum
} from "../_shared/admin-catalogue.ts";
import {
  runDurationBackfillBatch,
  storedMusicBrainzReleaseId
} from "../_shared/musicbrainz-duration-backfill.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = getAdminKey();
const musicBrainzUserAgent = musicBrainzIdentity(Deno.env.get("MUSICBRAINZ_CONTACT_EMAIL"));
const service = createClient(supabaseUrl, serviceKey, {
  global: { fetch: catalogueFetch },
  auth: { persistSession: false, autoRefreshToken: false }
});

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const allowed = origin === "https://thebankofmusic.com" ||
    origin === "https://bank-of-music.pages.dev" ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": origin } : {}),
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
  if (error) throw new Error("MusicBrainz coordination failed");
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

async function isReleaseGroupExcluded(releaseGroupId: string) {
  if (!uuid(releaseGroupId)) return false;
  const { data, error } = await service.from("catalogue_release_group_exclusions")
    .select("musicbrainz_release_group_id")
    .eq("musicbrainz_release_group_id", releaseGroupId)
    .maybeSingle();
  if (error) throw new Error("Catalogue exclusion lookup failed");
  return Boolean(data);
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
    if (error) throw new Error("Duplicate lookup failed");
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

function artistFromRelease(detail: any) {
  const credits = Array.isArray(detail?.["artist-credit"]) ? detail["artist-credit"] : [];
  const ids = [...new Set(credits.map((credit: any) => String(credit?.artist?.id || "").toLowerCase()).filter(Boolean))];
  const name = credits.map((credit: any) => credit?.name || credit?.artist?.name || "").join("").trim();
  if (ids.length !== 1 || !uuid(ids[0]) || !name) return null;
  return { id: ids[0], name, country: "" };
}

async function enrichAlbumDurations(albumId: number) {
  const albumResult = await service.from("albums")
    .select("id,is_deleted,musicbrainz_release_id,external_source,external_id")
    .eq("id", albumId).eq("is_deleted", false).maybeSingle();
  if (albumResult.error) throw new Error("Album duration lookup failed");
  const album = albumResult.data;
  if (!album || !storedMusicBrainzReleaseId(album)) {
    return { status: "skipped", reason: "valid_stored_release_id_required" };
  }
  const fetchSongs = async () => {
    const result = await service.from("songs")
      .select("id,album_id,track_position,external_source,external_id,duration_ms,is_deleted")
      .eq("album_id", albumId).eq("is_deleted", false).order("id");
    if (result.error) throw new Error("Song duration lookup failed");
    return result.data || [];
  };
  const songs = await fetchSongs();
  if (songs.length && songs.every(song => Number.isSafeInteger(Number(song.duration_ms)) && Number(song.duration_ms) > 0)) {
    return { status: "already_complete", songs_populated: 0, durations: songs.map(song => ({ id: song.id, duration_ms: song.duration_ms })) };
  }
  const report = await runDurationBackfillBatch({
    albums: [album],
    dryRun: false,
    fetchSongs: async () => songs,
    fetchRelease: releaseId => musicBrainzGet(
      `/release/${encodeURIComponent(releaseId)}?inc=recordings&fmt=json`
    ),
    updateDuration: async update => {
      const result = await service.from("songs")
        .update({ duration_ms: update.duration_ms })
        .eq("id", update.song_id).eq("album_id", update.album_id)
        .eq("is_deleted", false).is("duration_ms", null)
        .select("id").maybeSingle();
      if (result.error) throw new Error("Song duration update failed");
      return Boolean(result.data?.id);
    }
  });
  const refreshed = await fetchSongs();
  return {
    status: report.failures.length ? "failed" : report.albums_skipped ? "skipped" : "processed",
    ...report,
    durations: refreshed.map(song => ({ id: song.id, duration_ms: song.duration_ms }))
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { ok: false, error: "Method not allowed." }, 405);
  if (!supabaseUrl || !serviceKey) return json(request, { ok: false, error: "Catalogue service is unavailable." }, 503);

  const authorization = await requireAuthenticatedUser(request);
  if (!authorization.ok) {
    const denied = authorization.response;
    return json(request, await denied.clone().json(), denied.status);
  }

  try {
    const body = await request.json();
    if (body?.action === "enrich_album_durations") {
      const albumId = Number(body.album_id);
      if (!Number.isSafeInteger(albumId) || albumId <= 0) {
        return json(request, { ok: false, error: "Choose a valid BOM album." }, 400);
      }
      return json(request, { ok: true, enrichment: await enrichAlbumDurations(albumId) });
    }
    const releaseId = String(body?.release_id || "").trim().toLowerCase();
    const expectedGroupId = String(body?.release_group_id || "").trim().toLowerCase();
    if (!uuid(releaseId) || (expectedGroupId && !uuid(expectedGroupId))) {
      return json(request, { ok: false, status: "needs_correction", reason: "exact_release_identity_required" }, 400);
    }
    if (expectedGroupId && await isReleaseGroupExcluded(expectedGroupId)) {
      return json(request, { ok: true, status: "needs_correction", reason: "release_group_excluded_by_administrator" });
    }

    const exactRelease = await musicBrainzGet(
      `/release/${encodeURIComponent(releaseId)}?inc=recordings+artist-credits+release-groups&fmt=json`
    );
    const groupId = String(exactRelease?.["release-group"]?.id || "").toLowerCase();
    const artist = artistFromRelease(exactRelease);
    const title = String(exactRelease?.title || "").trim();
    if (exactRelease?.id !== releaseId || !uuid(groupId) || !artist || !title ||
        (expectedGroupId && expectedGroupId !== groupId)) {
      return json(request, { ok: true, status: "needs_correction", reason: "release_identity_validation_failed" });
    }
    if (await isReleaseGroupExcluded(groupId)) {
      return json(request, { ok: true, status: "needs_correction", reason: "release_group_excluded_by_administrator" });
    }

    const preview = await resolveRequestedAlbum({
      artist,
      request: { title, release_group_id: groupId, release_id: releaseId },
      musicBrainzGet,
      findExisting,
      artworkAvailable
    });
    if (preview.status === "already_exists") {
      return json(request, { ok: true, status: "already_exists", album_id: preview.existing_album_id });
    }
    if (preview.status !== "ready") {
      return json(request, {
        ok: true,
        status: preview.status === "failed" ? "failed" : "needs_correction",
        reason: preview.reason || "catalogue_confirmation_required"
      });
    }

    const { data, error } = await service.rpc("admin_add_catalogue_album", {
      p_album: preview.album,
      p_tracks: preview.tracks
    });
    if (error) throw new Error("Atomic catalogue creation failed");
    return json(request, { ok: true, ...data });
  } catch (error) {
    console.warn("Remote album catalogue request failed", String((error as Error)?.message || error));
    return json(request, { ok: true, status: "failed", reason: "catalogue_creation_failed" });
  }
});
