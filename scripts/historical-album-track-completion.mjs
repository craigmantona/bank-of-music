#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MANIFEST = resolve(HERE, "historical-album-track-completion.pilot.json");
export const DEFAULT_CACHE = resolve(HERE, "../supabase/operations/historical-album-track-audit-pilot-releases.json");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) || []), row]);
  return groups;
}

function option(name, fallback = "") {
  const inline = process.argv.find(value => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export function normalise(value) {
  return String(value || "").normalize("NFKD").replace(/[’‘]/g, "'")
    .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
}

function artistCredit(credit = []) {
  return credit.map(item => item.name || item.artist?.name || "").join("");
}

export function validateManifest(manifest) {
  if (manifest?.schema_version !== 1 || !Array.isArray(manifest.albums) || manifest.albums.length < 1) {
    throw new Error("Album-completion manifest is invalid.");
  }
  const ids = new Set();
  const releases = new Set();
  for (const album of manifest.albums) {
    if (!Number.isSafeInteger(album.album_id) || album.album_id < 1 || ids.has(album.album_id)) throw new Error("Album IDs must be unique positive integers.");
    ids.add(album.album_id);
    for (const key of ["release_mbid", "release_group_mbid"]) if (!UUID.test(album[key])) throw new Error(`Invalid ${key} for album ${album.album_id}.`);
    if (releases.has(album.release_mbid)) throw new Error("Release MBIDs must be unique.");
    releases.add(album.release_mbid);
    if (!album.title || !album.artist || !Number.isSafeInteger(album.expected_track_count) || album.expected_track_count < 2) {
      throw new Error(`Incomplete identity for album ${album.album_id}.`);
    }
    if (!Array.isArray(album.historical_chart_rows) || !album.historical_chart_rows.length || album.historical_chart_rows.some(id => !Number.isSafeInteger(id))) {
      throw new Error(`Historical link guards are required for album ${album.album_id}.`);
    }
  }
  return manifest;
}

export function validateRelease(album, release) {
  const failures = [];
  if (release?.id?.toLowerCase() !== album.release_mbid) failures.push("release MBID");
  if (release?.status !== "Official") failures.push("official status");
  if (release?.["release-group"]?.id?.toLowerCase() !== album.release_group_mbid) failures.push("release-group MBID");
  if (release?.["release-group"]?.["primary-type"] !== "Album") failures.push("primary type");
  if ((release?.["release-group"]?.["secondary-types"] || []).length) failures.push("secondary type");
  if (normalise(release?.title) !== normalise(album.title)) failures.push("release title");
  if (normalise(artistCredit(release?.["artist-credit"])) !== normalise(album.artist)) failures.push("release artist");
  if (!Array.isArray(release?.media) || release.media.length !== 1 || Number(release.media[0]?.position || 1) !== 1) failures.push("single medium");
  const tracks = release?.media?.[0]?.tracks || [];
  if (tracks.length !== album.expected_track_count) failures.push("track count");
  const mbids = new Set();
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    if (Number(track.position) !== index + 1) failures.push(`track position ${index + 1}`);
    if (!UUID.test(track.recording?.id || "") || mbids.has(track.recording.id.toLowerCase())) failures.push(`recording identity ${index + 1}`);
    else mbids.add(track.recording.id.toLowerCase());
    const credited = artistCredit(track["artist-credit"]?.length ? track["artist-credit"] : track.recording?.["artist-credit"]);
    if (!credited) failures.push(`track artist ${index + 1}`);
    if (!Number.isInteger(track.length || track.recording?.length)) failures.push(`track duration ${index + 1}`);
  }
  if (failures.length) throw new Error(`${album.artist} — ${album.title}: release validation failed (${[...new Set(failures)].join(", ")}).`);
  return tracks.map(track => ({
    position: Number(track.position), title: track.title || track.recording.title,
    artist: artistCredit(track["artist-credit"]?.length ? track["artist-credit"] : track.recording["artist-credit"]),
    recording_mbid: track.recording.id.toLowerCase(), duration_ms: Number(track.length || track.recording.length)
  }));
}

export function indexReleaseCache(cache) {
  const releases = {};
  for (const [key, value] of Object.entries(cache || {})) {
    if (value?.id && Array.isArray(value.media)) releases[value.id.toLowerCase()] = value;
    else if (UUID.test(key) && value?.id) releases[key.toLowerCase()] = value;
  }
  return releases;
}

export function buildPlan(manifest, releases, snapshot) {
  const albumById = new Map(snapshot.albums.map(row => [Number(row.id), row]));
  const albumSongs = groupBy(snapshot.albumSongs || [], row => Number(row.album_id));
  const canonicalsByMbid = groupBy((snapshot.canonicals || []).filter(row => row.musicbrainz_recording_id), row => row.musicbrainz_recording_id.toLowerCase());
  const canonicalsById = new Map((snapshot.canonicals || []).map(row => [row.id, row]));
  const occurrencesByMbid = groupBy((snapshot.occurrences || []).filter(row => row.external_id), row => row.external_id.toLowerCase());
  const ratingsByCanonical = groupBy(snapshot.ratings || [], row => row.canonical_song_id);
  const chartById = new Map((snapshot.chartRows || []).map(row => [Number(row.id), row]));
  const albums = [];

  for (const expected of manifest.albums) {
    const release = releases[expected.release_mbid];
    const tracks = validateRelease(expected, release);
    const album = albumById.get(expected.album_id);
    if (!album || album.is_deleted || album.musicbrainz_release_id?.toLowerCase() !== expected.release_mbid ||
        album.musicbrainz_release_group_id?.toLowerCase() !== expected.release_group_mbid || normalise(album.title) !== normalise(expected.title) ||
        normalise(album.artist) !== normalise(expected.artist)) throw new Error(`Stored album identity guard failed for ${expected.album_id}.`);
    if (!album.cover_art_url) throw new Error(`Stored artwork guard failed for album ${expected.album_id}.`);

    const stored = albumSongs.get(expected.album_id) || [];
    const positionOwners = new Map(stored.map(song => [Number(song.track_position), song]));
    const actions = [];
    for (const track of tracks) {
      const onAlbum = stored.filter(song => !song.is_deleted && song.external_source === "musicbrainz" && song.external_id?.toLowerCase() === track.recording_mbid);
      if (onAlbum.length > 1) throw new Error(`Duplicate album occurrence ${track.recording_mbid}.`);
      const canonicals = canonicalsByMbid.get(track.recording_mbid) || [];
      if (canonicals.length > 1) throw new Error(`Competing canonical identities for ${track.recording_mbid}.`);
      if (onAlbum.length === 1) {
        const song = onAlbum[0];
        const canonical = canonicalsById.get(song.canonical_song_id);
        if (Number(song.track_position) !== track.position || !canonical || canonical.musicbrainz_recording_id?.toLowerCase() !== track.recording_mbid) {
          throw new Error(`Existing occurrence identity guard failed for ${track.recording_mbid}.`);
        }
        actions.push({ ...track, action: "unchanged", song_id: Number(song.id), canonical_id: canonical.id });
        continue;
      }
      const owner = positionOwners.get(track.position);
      if (owner) throw new Error(`Track position ${track.position} is occupied by another recording on album ${expected.album_id}.`);
      const canonical = canonicals[0] || null;
      actions.push({ ...track, action: canonical ? "insert_occurrence_reuse_canonical" : "insert_canonical_and_occurrence", canonical_id: canonical?.id || null,
        existing_occurrence_ids: (occurrencesByMbid.get(track.recording_mbid) || []).map(row => Number(row.id)),
        existing_rating_rows: canonical ? (ratingsByCanonical.get(canonical.id) || []).length : 0 });
    }
    for (const chartId of expected.historical_chart_rows) {
      const chart = chartById.get(chartId);
      if (!chart || !chart.song_id || !stored.some(song => Number(song.id) === Number(chart.song_id))) throw new Error(`Historical link guard failed for chart row ${chartId}.`);
    }
    const counts = {
      album_inserts: 0,
      song_occurrence_inserts: actions.filter(item => item.action !== "unchanged").length,
      canonical_inserts: actions.filter(item => item.action === "insert_canonical_and_occurrence").length,
      canonical_reuses: actions.filter(item => item.action === "insert_occurrence_reuse_canonical").length,
      historical_link_updates: 0,
      rating_updates: 0,
      unchanged_tracks: actions.filter(item => item.action === "unchanged").length
    };
    albums.push({ ...expected, cover_art_url: album.cover_art_url, tracks: actions, counts,
      protected_rating_rows: (snapshot.ratings || []).filter(row => stored.some(song => song.canonical_song_id === row.canonical_song_id)).length,
      historical_baseline: expected.historical_chart_rows.map(id => ({
        id, song_id: chartById.get(id).song_id, canonical_song_id: chartById.get(id).canonical_song_id,
        musicbrainz_recording_id: chartById.get(id).musicbrainz_recording_id
      })) });
  }
  const totals = albums.reduce((sum, album) => Object.fromEntries(Object.keys(sum).map(key => [key, sum[key] + album.counts[key]])), {
    album_inserts: 0, song_occurrence_inserts: 0, canonical_inserts: 0, canonical_reuses: 0,
    historical_link_updates: 0, rating_updates: 0, unchanged_tracks: 0
  });
  return { albums, totals };
}

function literal(value) { return `'${String(value ?? "").replaceAll("'", "''")}'`; }

export function generateAlbumSql(album) {
  const payload = literal(JSON.stringify(album));
  return `\\set ON_ERROR_STOP on
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtextextended('bom-album-track-completion:${album.album_id}', 0));
do $completion$
declare v jsonb := ${payload}::jsonb; t jsonb; v_canonical uuid; n integer; inserted_canonicals integer := 0; inserted_songs integer := 0; ratings_before jsonb; links_before jsonb;
begin
  perform 1 from public.albums a where a.id=${album.album_id} and not coalesce(a.is_deleted,false) and lower(a.musicbrainz_release_id)=${literal(album.release_mbid)} and lower(a.musicbrainz_release_group_id)=${literal(album.release_group_mbid)} and a.cover_art_url=${literal(album.cover_art_url)} for update;
  if not found then raise exception 'Album identity/artwork guard failed'; end if;
  perform 1 from public.songs s where s.album_id=${album.album_id} for update;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) into ratings_before from public.song_ratings r where r.canonical_song_id in (
    select s.canonical_song_id from public.songs s where s.album_id=${album.album_id}
    union select nullif(value->>'canonical_id','')::uuid from jsonb_array_elements(v->'tracks') where value->>'canonical_id' is not null
  );
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'song_id',q.song_id,'canonical_song_id',q.canonical_song_id,'mbid',q.musicbrainz_recording_id) order by q.id),'[]'::jsonb) into links_before from public.quick_rate_collection_tracks q where q.id in (${album.historical_chart_rows.join(",")});
  for t in select value from jsonb_array_elements(v->'tracks') loop
    if t->>'action' = 'insert_canonical_and_occurrence' then
      if exists(select 1 from public.canonical_recordings c where lower(c.musicbrainz_recording_id)=lower(t->>'recording_mbid')) then raise exception 'Canonical appeared for %',t->>'recording_mbid'; end if;
      insert into public.canonical_recordings(title,artist,musicbrainz_recording_id,origin_key,source_metadata)
      values(t->>'title',t->>'artist',lower(t->>'recording_mbid'),'musicbrainz:'||lower(t->>'recording_mbid'),jsonb_build_object('album_track_completion','v1')) returning id into v_canonical;
      inserted_canonicals := inserted_canonicals + 1;
    elsif t->>'action' = 'insert_occurrence_reuse_canonical' then
      select c.id into v_canonical from public.canonical_recordings c where c.id=(t->>'canonical_id')::uuid and lower(c.musicbrainz_recording_id)=lower(t->>'recording_mbid') for update;
      if v_canonical is null then raise exception 'Canonical reuse guard failed for %',t->>'recording_mbid'; end if;
    else
      continue;
    end if;
    if exists(select 1 from public.songs s where s.album_id=${album.album_id} and (lower(s.external_id)=lower(t->>'recording_mbid') or s.track_position=(t->>'position')::integer)) then raise exception 'Occurrence/position collision for %',t->>'recording_mbid'; end if;
    insert into public.songs(title,artist,album_id,track_position,external_source,external_id,canonical_song_id,duration_ms,is_deleted)
    values(t->>'title',t->>'artist',${album.album_id},(t->>'position')::integer,'musicbrainz',lower(t->>'recording_mbid'),v_canonical,(t->>'duration_ms')::integer,false);
    inserted_songs := inserted_songs + 1;
  end loop;
  if inserted_canonicals<>${album.counts.canonical_inserts} or inserted_songs<>${album.counts.song_occurrence_inserts} then raise exception 'Exact insert-count assertion failed'; end if;
  select count(*) into n from public.songs s where s.album_id=${album.album_id} and not coalesce(s.is_deleted,false);
  if n<>${album.expected_track_count} then raise exception 'Final track-count assertion failed: %',n; end if;
  if ratings_before is distinct from (select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.song_ratings r where r.canonical_song_id in (
    select s.canonical_song_id from public.songs s where s.album_id=${album.album_id}
    union select nullif(value->>'canonical_id','')::uuid from jsonb_array_elements(v->'tracks') where value->>'canonical_id' is not null
  )) then raise exception 'Rating integrity changed'; end if;
  if links_before is distinct from (select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'song_id',q.song_id,'canonical_song_id',q.canonical_song_id,'mbid',q.musicbrainz_recording_id) order by q.id),'[]'::jsonb) from public.quick_rate_collection_tracks q where q.id in (${album.historical_chart_rows.join(",")})) then raise exception 'Historical links changed'; end if;
end $completion$;
commit;
`;
}

export async function main() {
  const commit = process.argv.includes("--commit");
  const manifest = validateManifest(JSON.parse(await readFile(resolve(option("manifest", DEFAULT_MANIFEST)), "utf8")));
  const cachePaths = option("cache", DEFAULT_CACHE).split(",").map(value => value.trim()).filter(Boolean);
  const releases = {};
  for (const cachePath of cachePaths) Object.assign(releases, indexReleaseCache(JSON.parse(await readFile(resolve(cachePath), "utf8"))));
  const snapshotPath = option("snapshot");
  if (!snapshotPath) throw new Error("Dry-run requires a fresh read-only --snapshot.");
  const snapshot = JSON.parse(await readFile(resolve(snapshotPath), "utf8"));
  const plan = buildPlan(manifest, releases, snapshot);
  if (option("plan-output")) await writeFile(resolve(option("plan-output")), `${JSON.stringify(plan, null, 2)}\n`);
  if (option("sql-output")) await writeFile(resolve(option("sql-output")), plan.albums.map(generateAlbumSql).join("\n"));
  console.log(JSON.stringify({ mode: commit ? "commit" : "dry-run", albums: plan.albums.map(a => ({ album_id: a.album_id, title: a.title, counts: a.counts })), totals: plan.totals }, null, 2));
  if (!commit) { console.log("Dry run succeeded. No database rows were written."); return; }
  if (process.env.BOM_ALBUM_COMPLETION_WRITE_AUTH !== "explicitly-authorised") throw new Error("Production writes are disabled without separate BOM_ALBUM_COMPLETION_WRITE_AUTH.");
  if (!process.env.BOM_DATABASE_URL) throw new Error("--commit requires BOM_DATABASE_URL.");
  const checkpointPath = option("checkpoint");
  let checkpoint = { schema_version: 1, albums: {} };
  if (checkpointPath) {
    try { checkpoint = JSON.parse(await readFile(resolve(checkpointPath), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const failures = [];
  for (const album of plan.albums) {
    const prior = checkpoint.albums?.[album.album_id];
    if (prior?.status === "committed") {
      if (prior.release_mbid !== album.release_mbid) throw new Error(`Checkpoint identity mismatch for album ${album.album_id}.`);
      continue;
    }
    const result = spawnSync(option("psql", "psql"), ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", process.env.BOM_DATABASE_URL], { input: generateAlbumSql(album), encoding: "utf8" });
    const failure = result.error?.message || (result.status !== 0 ? result.stderr.trim() : "");
    checkpoint.albums ||= {};
    checkpoint.albums[album.album_id] = { status: failure ? "rolled_back" : "committed", release_mbid: album.release_mbid,
      counts: album.counts, error: failure || null, updated_at: new Date().toISOString() };
    if (checkpointPath) await writeFile(resolve(checkpointPath), `${JSON.stringify(checkpoint, null, 2)}\n`);
    if (failure) failures.push(`Album ${album.album_id} rolled back: ${failure}`);
  }
  if (failures.length) throw new Error(failures.join("\n"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
