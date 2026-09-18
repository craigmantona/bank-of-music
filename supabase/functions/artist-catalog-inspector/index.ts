import { createClient } from "npm:@supabase/supabase-js@2";
import { getAdminKey, requireServiceOrAdmin } from "../_shared/authorization.ts";
import { CatalogueWorker, CatalogueDeferral, catalogueFetch, musicBrainzIdentity } from "../_shared/catalogue-worker.ts";

function normalise(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  getAdminKey(),
  { global: { fetch: catalogueFetch }, auth: { persistSession:false, autoRefreshToken:false } }
);

async function resolveArtist(name:string, mb: (path: string) => Promise<any>) {
  const q = `artist:"${name.replaceAll('"',"")}"`;
  const data = await mb(`/artist/?query=${encodeURIComponent(q)}&fmt=json&limit=25`);

  const exact = (data.artists || [])
    .filter((a:any) => normalise(a.name) === normalise(name))
    .filter((a:any) => !/tribute|cover|karaoke|impersonator/i.test(`${a.disambiguation || ""}`))
    .sort((a:any,b:any) => Number(b.score||0)-Number(a.score||0));

  return exact[0] || data.artists?.[0] || null;
}

async function fetchGroups(artistId:string, mb: (path: string) => Promise<any>) {
  const all:any[] = [];
  let offset = 0;

  while (true) {
    const data = await mb(
      `/release-group?artist=${encodeURIComponent(artistId)}&type=album&limit=100&offset=${offset}&fmt=json`
    );

    const groups = data["release-groups"] || [];
    all.push(...groups);
    offset += groups.length;

    if (!groups.length || offset >= Number(data["release-group-count"] || all.length)) break;
  }

  return all;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ ok:false, error:"Method not allowed." }, { status:405 });
  }

  const authorization = await requireServiceOrAdmin(request);
  if (!authorization.ok) return authorization.response;

  const worker = new CatalogueWorker(supabase, 120000, musicBrainzIdentity(Deno.env.get("MUSICBRAINZ_CONTACT_EMAIL")));
  const mb = (path: string) => worker.musicBrainzGet(path);
  try {
    const lease = await worker.acquire("inspector");
    if (lease.busy) return Response.json({ ok: true, deferred: "worker_busy" });
    let artistName = "The Beatles";

    try {
      const body = await request.json();
      if (typeof body?.artist === "string" && body.artist.trim()) {
        artistName = body.artist.trim();
      }
    } catch {}

    const artist = await resolveArtist(artistName, mb);
    if (!artist?.id) throw new Error(`No artist found for ${artistName}`);

    const groups = await fetchGroups(artist.id, mb);

    const rows = groups.map((g:any) => ({
      artist_name: artistName,
      musicbrainz_artist_id: artist.id,
      release_group_id: g.id,
      title: g.title || "",
      first_release_date: g["first-release-date"] || null,
      primary_type: g["primary-type"] || null,
      secondary_types: g["secondary-types"] || [],
      inspected_at: new Date().toISOString()
    }));

    await worker.rpc("inspection", { artist: artistName, artist_id: artist.id, groups });
    await worker.finish();

    return Response.json({
      ok:true,
      artist:artistName,
      total_album_release_groups:rows.length,
      without_secondary_types:rows.filter((r:any)=>!r.secondary_types.length).length,
      with_secondary_types:rows.filter((r:any)=>r.secondary_types.length).length
    });
  } catch (error) {
    try { await worker.finish(error); }
    catch (checkpointError) { return Response.json({ ok: false, error: String((checkpointError as Error).message) }, { status: 500 }); }
    if (error instanceof CatalogueDeferral) return Response.json({ ok: true, deferred: error.reason });
    return Response.json(
      { ok:false, error:String((error as any)?.message || error) },
      { status:500 }
    );
  }
});
