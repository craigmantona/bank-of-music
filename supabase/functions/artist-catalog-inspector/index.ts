import { createClient } from "npm:@supabase/supabase-js@2";
import { getAdminKey, requireServiceOrAdmin } from "../_shared/authorization.ts";

const MUSICBRAINZ_BASE = "https://musicbrainz.org/ws/2";
const REQUEST_DELAY_MS = 1100;

const sleep = (ms:number) => new Promise(r => setTimeout(r, ms));

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
  { auth: { persistSession:false, autoRefreshToken:false } }
);

const contactEmail =
  Deno.env.get("MUSICBRAINZ_CONTACT_EMAIL") ||
  "bom-catalogue-inspector@example.invalid";

let lastRequestAt = 0;

async function mb(path:string) {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS - elapsed);
  lastRequestAt = Date.now();

  const r = await fetch(`${MUSICBRAINZ_BASE}${path}`, {
    headers: {
      Accept:"application/json",
      "User-Agent":`BankOfMusic/1.0 (${contactEmail})`
    }
  });

  if (!r.ok) {
    throw new Error(`MusicBrainz ${r.status}: ${(await r.text()).slice(0,300)}`);
  }

  return r.json();
}

async function resolveArtist(name:string) {
  const q = `artist:"${name.replaceAll('"',"")}"`;
  const data = await mb(`/artist/?query=${encodeURIComponent(q)}&fmt=json&limit=25`);

  const exact = (data.artists || [])
    .filter((a:any) => normalise(a.name) === normalise(name))
    .filter((a:any) => !/tribute|cover|karaoke|impersonator/i.test(`${a.disambiguation || ""}`))
    .sort((a:any,b:any) => Number(b.score||0)-Number(a.score||0));

  return exact[0] || data.artists?.[0] || null;
}

async function fetchGroups(artistId:string) {
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

  try {
    let artistName = "The Beatles";

    try {
      const body = await request.json();
      if (typeof body?.artist === "string" && body.artist.trim()) {
        artistName = body.artist.trim();
      }
    } catch {}

    const artist = await resolveArtist(artistName);
    if (!artist?.id) throw new Error(`No artist found for ${artistName}`);

    const groups = await fetchGroups(artist.id);

    await supabase
      .from("artist_release_group_debug")
      .delete()
      .eq("artist_name", artistName);

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

    if (rows.length) {
      const { error } = await supabase
        .from("artist_release_group_debug")
        .upsert(rows, { onConflict:"artist_name,release_group_id" });

      if (error) throw error;
    }

    return Response.json({
      ok:true,
      artist:artistName,
      total_album_release_groups:rows.length,
      without_secondary_types:rows.filter((r:any)=>!r.secondary_types.length).length,
      with_secondary_types:rows.filter((r:any)=>r.secondary_types.length).length
    });
  } catch (error) {
    return Response.json(
      { ok:false, error:String((error as any)?.message || error) },
      { status:500 }
    );
  }
});
