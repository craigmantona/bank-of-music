import { createClient } from "npm:@supabase/supabase-js@2";
import { getAdminKey } from "../_shared/authorization.ts";
import { resolveArtistEnrichment, type ArtistEnrichment } from "../_shared/artist-enrichment-cache.ts";
import { catalogueFetch, musicBrainzIdentity } from "../_shared/catalogue-worker.ts";

declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void };

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
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin"
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

function validUuid(value: unknown) {
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
  await reserveMusicBrainzSlot();
  const response = await catalogueFetch(`https://musicbrainz.org/ws/2${path}`, {
    headers: { Accept: "application/json", "User-Agent": musicBrainzUserAgent }
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`MusicBrainz ${response.status}`);
  }
  return response.json();
}

async function readCache(artistId: string): Promise<ArtistEnrichment | null> {
  const { data, error } = await service.from("musicbrainz_artist_cache")
    .select("artist_id,artist_detail,release_groups,fetched_at")
    .eq("artist_id", artistId)
    .maybeSingle();
  if (error) throw new Error("Artist cache read failed");
  return data as ArtistEnrichment | null;
}

async function refreshCache(artistId: string): Promise<ArtistEnrichment> {
  const detail = await musicBrainzGet(
    `/artist/${encodeURIComponent(artistId)}?inc=tags+genres+aliases+url-rels&fmt=json`
  );
  if (detail?.id !== artistId) throw new Error("MusicBrainz artist identity mismatch");

  const discography = await musicBrainzGet(
    `/release-group?artist=${encodeURIComponent(artistId)}&type=album&fmt=json&limit=100`
  );
  if (!Array.isArray(discography?.["release-groups"])) {
    throw new Error("MusicBrainz discography response is invalid");
  }

  const fetchedAt = new Date().toISOString();
  const enrichment: ArtistEnrichment = {
    artist_id: artistId,
    artist_detail: detail,
    release_groups: discography["release-groups"],
    fetched_at: fetchedAt
  };
  const { error } = await service.from("musicbrainz_artist_cache").upsert({
    ...enrichment,
    updated_at: fetchedAt
  }, { onConflict: "artist_id" });
  if (error) throw new Error("Artist cache write failed");
  return enrichment;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "POST") return json(request, { ok: false, error: "Method not allowed." }, 405);
  if (!supabaseUrl || !serviceKey) return json(request, { ok: false, error: "Artist cache is unavailable." }, 503);

  let artistId = "";
  try {
    artistId = String((await request.json())?.artist_id || "").trim().toLowerCase();
  } catch {
    return json(request, { ok: false, error: "Invalid request." }, 400);
  }
  if (!validUuid(artistId)) return json(request, { ok: false, error: "A MusicBrainz artist ID is required." }, 400);

  try {
    const result = await resolveArtistEnrichment(artistId, {
      read: readCache,
      refresh: refreshCache,
      schedule: task => EdgeRuntime.waitUntil(task)
    });
    return json(request, result);
  } catch {
    return json(request, { ok: false, cache_status: "unavailable", enrichment: null });
  }
});
