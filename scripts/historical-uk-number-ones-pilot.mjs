#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MANIFEST = resolve(HERE, "historical-uk-number-ones-pilot.manifest.json");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  const inline = process.argv.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export function normalise(value) {
  return String(value || "").normalize("NFKD").replace(/[’‘]/g, "'")
    .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
}

export function postgresDateOrNull(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1] ? raw : null;
}

export function validateManifest(manifest) {
  if (manifest?.schema_version !== 1 || manifest?.expected_chart_rows !== 20 || manifest?.entries?.length !== 20) {
    throw new Error("Pilot manifest must contain exactly 20 reviewed chart rows.");
  }
  const unique = key => new Set(manifest.entries.map(entry => entry[key])).size === 20;
  for (const key of ["chart_row_id", "placeholder_canonical_id", "recording_mbid"]) {
    if (!unique(key)) throw new Error(`Manifest ${key} values must be unique.`);
  }
  for (const entry of manifest.entries) {
    for (const key of ["placeholder_canonical_id", "recording_mbid", "release_group_mbid", "source_release_mbid"]) {
      if (!UUID.test(entry[key])) throw new Error(`Invalid ${key} for chart row ${entry.chart_row_id}.`);
    }
    if (entry.reuse_album_release_mbid && !UUID.test(entry.reuse_album_release_mbid)) {
      throw new Error(`Invalid reuse_album_release_mbid for chart row ${entry.chart_row_id}.`);
    }
    if (!entry.title || !entry.artist || !entry.source_album_title || !Number.isInteger(entry.track_position) || entry.track_position < 1) {
      throw new Error(`Incomplete reviewed identity for chart row ${entry.chart_row_id}.`);
    }
    if (!Number.isInteger(entry.duration_ms) || !Number.isInteger(entry.duration_tolerance_ms)) {
      throw new Error(`Invalid duration review for chart row ${entry.chart_row_id}.`);
    }
  }
  const reuseIds = manifest.entries.filter(entry => entry.reuse_album_id).map(entry => entry.reuse_album_id).sort((a, b) => a - b);
  if (JSON.stringify(reuseIds) !== JSON.stringify([100, 380])) throw new Error("Only reviewed BOM albums 100 and 380 may be forced for reuse.");
  const sourceAlbums = new Set(manifest.entries.map(entry => entry.source_release_mbid));
  if (sourceAlbums.size !== 19 || sourceAlbums.size - reuseIds.length > manifest.max_album_inserts) {
    throw new Error("Manifest album-insert ceiling is inconsistent with reviewed source releases.");
  }
  return manifest;
}

function artistCredit(credit = []) {
  return credit.map(item => item.name || item.artist?.name || "").join("");
}

export function validateMusicBrainzRelease(entry, release) {
  const failures = [];
  if (release.id?.toLowerCase() !== entry.source_release_mbid) failures.push("source release MBID");
  if (release.status !== "Official") failures.push("official release status");
  if (release["release-group"]?.id?.toLowerCase() !== entry.release_group_mbid) failures.push("release-group identity");
  if (normalise(release.title) !== normalise(entry.source_album_title)) failures.push("source release title");
  if (normalise(artistCredit(release["artist-credit"])) !== normalise(entry.source_album_artist || entry.artist)) failures.push("source release artist");
  if (entry.source_release_country && release.country !== entry.source_release_country) failures.push("release country");
  const tracks = (release.media || []).flatMap(medium => medium.tracks || []);
  const matches = tracks.filter(track => track.recording?.id?.toLowerCase() === entry.recording_mbid);
  if (matches.length !== 1) failures.push("unique recording occurrence");
  const track = matches[0];
  if (track) {
    if (Number(track.position) !== entry.track_position) failures.push("track position");
    if (normalise(track.title) !== normalise(entry.title) && normalise(track.recording?.title) !== normalise(entry.title)) failures.push("track title");
    const credited = artistCredit(track["artist-credit"]?.length ? track["artist-credit"] : track.recording?.["artist-credit"]);
    const acceptedArtists = [entry.artist, ...(entry.accepted_artist_credits || [])].map(normalise);
    if (!acceptedArtists.includes(normalise(credited))) failures.push("track artist");
    if (!Number.isInteger(track.length) || Math.abs(track.length - entry.duration_ms) > entry.duration_tolerance_ms) failures.push("track duration");
    const disambiguation = normalise(track.recording?.disambiguation);
    if (/\b(live|remix|karaoke|cover|instrumental|demo|re recorded)\b/.test(disambiguation) && !normalise(entry.version_note).includes(disambiguation)) {
      failures.push("unexpected recording version");
    }
  }
  if (failures.length) throw new Error(`${entry.artist} — ${entry.title}: MusicBrainz validation failed (${failures.join(", ")}).`);
  return { position: track.position, duration_ms: track.length, release_date: release.date || null };
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "BankOfMusic-HistoricalPilot/1.0 (https://thebankofmusic.com/)", ...headers } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

export async function validateMusicBrainz(manifest, { cacheFile, intervalMs = 1100 } = {}) {
  let cache = {};
  if (cacheFile) try { cache = JSON.parse(await readFile(cacheFile, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  let requests = 0;
  let lastRequestAt = 0;
  const validations = [];
  for (const releaseId of new Set(manifest.entries.map(entry => entry.source_release_mbid))) {
    let release = cache[releaseId];
    if (!release) {
      const wait = Math.max(0, intervalMs - (Date.now() - lastRequestAt));
      if (wait) await new Promise(resolvePromise => setTimeout(resolvePromise, wait));
      release = await fetchJson(`https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artist-credits+release-groups&fmt=json`);
      lastRequestAt = Date.now();
      cache[releaseId] = release;
      requests += 1;
      if (cacheFile) { await mkdir(dirname(cacheFile), { recursive: true }); await writeFile(cacheFile, `${JSON.stringify(cache)}\n`); }
    }
    for (const entry of manifest.entries.filter(item => item.source_release_mbid === releaseId)) {
      validations.push({ chart_row_id: entry.chart_row_id, ...validateMusicBrainzRelease(entry, release) });
    }
  }
  return { requests, cache_hits: new Set(manifest.entries.map(entry => entry.source_release_mbid)).size - requests, validations, releases: cache };
}

async function restSnapshot(manifest) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) throw new Error("Live dry-run requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --snapshot.");
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const ids = values => `(${values.join(",")})`;
  const quoted = values => `(${values.map(value => `\"${value}\"`).join(",")})`;
  const entries = manifest.entries;
  const [chartRows, canonicals, albums, songs, ratings] = await Promise.all([
    fetchJson(`${supabaseUrl}/rest/v1/quick_rate_collection_tracks?select=id,title,artist,match_status,song_id,canonical_song_id,musicbrainz_recording_id&id=in.${ids(entries.map(e => e.chart_row_id))}`, headers),
    fetchJson(`${supabaseUrl}/rest/v1/canonical_recordings?select=id,title,artist,musicbrainz_recording_id,origin_key&id=in.${quoted(entries.map(e => e.placeholder_canonical_id))}`, headers),
    fetchJson(`${supabaseUrl}/rest/v1/albums?select=id,title,artist,external_source,external_id,musicbrainz_release_id,musicbrainz_release_group_id,is_deleted&or=(id.in.${ids([100, 380])},musicbrainz_release_id.in.${quoted(entries.map(e => e.source_release_mbid))},musicbrainz_release_group_id.in.${quoted(entries.map(e => e.release_group_mbid))})`, headers),
    fetchJson(`${supabaseUrl}/rest/v1/songs?select=id,title,artist,album_id,external_source,external_id,canonical_song_id,is_deleted&external_source=eq.musicbrainz&external_id=in.${quoted(entries.map(e => e.recording_mbid))}`, headers),
    fetchJson(`${supabaseUrl}/rest/v1/song_ratings?select=id,canonical_song_id,song_id&canonical_song_id=in.${quoted(entries.map(e => e.placeholder_canonical_id))}`, headers)
  ]);
  return { chartRows, canonicals, albums, songs, ratings };
}

export function buildPlan(manifest, snapshot, releases = {}) {
  const chartById = new Map(snapshot.chartRows.map(row => [Number(row.id), row]));
  const canonicalById = new Map(snapshot.canonicals.map(row => [row.id, row]));
  const songsByMbid = new Map(snapshot.songs.map(row => [row.external_id?.toLowerCase(), row]));
  const ratingsByCanonical = Map.groupBy(snapshot.ratings || [], row => row.canonical_song_id);
  const albumsById = new Map(snapshot.albums.map(row => [Number(row.id), row]));
  const albumsByRelease = new Map(snapshot.albums.flatMap(row => [row.musicbrainz_release_id, row.external_source === "musicbrainz" ? row.external_id : null].filter(Boolean).map(id => [id.toLowerCase(), row])));
  const albumsByGroup = new Map(snapshot.albums.filter(row => row.musicbrainz_release_group_id).map(row => [row.musicbrainz_release_group_id.toLowerCase(), row]));
  const albumActions = new Map();
  const entries = [];
  for (const entry of manifest.entries) {
    const chart = chartById.get(entry.chart_row_id);
    const canonical = canonicalById.get(entry.placeholder_canonical_id);
    if (!chart || normalise(chart.title) !== normalise(entry.title) || normalise(chart.artist) !== normalise(entry.artist)) throw new Error(`Chart row ${entry.chart_row_id} identity guard failed.`);
    if (!canonical || normalise(canonical.title) !== normalise(entry.title) || normalise(canonical.artist) !== normalise(entry.artist)) throw new Error(`Canonical ${entry.placeholder_canonical_id} identity guard failed.`);
    const existingSong = songsByMbid.get(entry.recording_mbid);
    const alreadyLinked = existingSong && Number(chart.song_id) === Number(existingSong.id) && chart.canonical_song_id === entry.placeholder_canonical_id && canonical.musicbrainz_recording_id?.toLowerCase() === entry.recording_mbid;
    if (!alreadyLinked) {
      if (chart.song_id || chart.match_status !== "unresolved") throw new Error(`Chart row ${entry.chart_row_id} is no longer unresolved.`);
      if (canonical.musicbrainz_recording_id && canonical.musicbrainz_recording_id.toLowerCase() !== entry.recording_mbid) throw new Error(`Canonical ${canonical.id} already has another recording MBID.`);
      if ((ratingsByCanonical.get(canonical.id) || []).length) throw new Error(`Canonical ${canonical.id} is rated; pilot requires an unrated placeholder.`);
      if (existingSong) throw new Error(`Recording ${entry.recording_mbid} already belongs to song ${existingSong.id} without the complete idempotent link.`);
    }
    let album = entry.reuse_album_id ? albumsById.get(entry.reuse_album_id) : albumsByGroup.get(entry.release_group_mbid) || albumsByRelease.get(entry.source_release_mbid);
    if (album) {
      if (album.is_deleted || normalise(album.title) !== normalise(entry.source_album_title) || normalise(album.artist) !== normalise(entry.source_album_artist || entry.artist) ||
          (entry.reuse_album_id && (Number(album.id) !== entry.reuse_album_id || ![album.musicbrainz_release_id, album.external_id].filter(Boolean).map(x => x.toLowerCase()).includes(entry.reuse_album_release_mbid || entry.source_release_mbid)))) {
        throw new Error(`Existing album identity guard failed for ${entry.source_album_title}.`);
      }
      albumActions.set(entry.source_release_mbid, { action: "reuse", album_id: Number(album.id), release_mbid: entry.source_release_mbid, title: entry.source_album_title });
    } else if (!albumActions.has(entry.source_release_mbid)) {
      const release = releases[entry.source_release_mbid];
      albumActions.set(entry.source_release_mbid, {
        action: "insert", release_mbid: entry.source_release_mbid,
        release_group_mbid: entry.release_group_mbid, title: entry.source_album_title,
        artist: entry.source_album_artist || entry.artist,
        release_date: postgresDateOrNull(release?.date),
        release_date_raw: release?.date || null,
        country: entry.source_release_country,
        cover_art_url: `https://coverartarchive.org/release-group/${entry.release_group_mbid}/front-500`
      });
    }
    entries.push({ ...entry, action: alreadyLinked ? "unchanged" : "insert_and_link" });
  }
  const albumInserts = [...albumActions.values()].filter(action => action.action === "insert");
  const changes = entries.filter(entry => entry.action !== "unchanged");
  if (albumInserts.length > manifest.max_album_inserts || changes.length > manifest.max_song_inserts) throw new Error("Planned inserts exceed reviewed ceilings.");
  return { album_actions: [...albumActions.values()], entries, counts: { albums_insert: albumInserts.length, albums_reuse: albumActions.size - albumInserts.length, canonicals_update: changes.length, songs_insert: changes.length, chart_rows_update: changes.length, unchanged: entries.length - changes.length } };
}

function sqlLiteral(value) { return `'${String(value ?? "").replaceAll("'", "''")}'`; }

export function generateTransactionSql(manifest, plan) {
  const payload = JSON.stringify({ entries: plan.entries, album_actions: plan.album_actions, expected: plan.counts }).replaceAll("'", "''");
  return `\\set ON_ERROR_STOP on
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtextextended('bom-historical-uk-no1-pilot-v1', 0));

do $pilot$
declare
  v jsonb := '${payload}'::jsonb;
  e jsonb;
  a jsonb;
  v_album_id bigint;
  v_song_id bigint;
  v_row_count integer := 0;
  n_albums integer := 0;
  n_canonicals integer := 0;
  n_songs integer := 0;
  n_chart integer := 0;
begin
  if jsonb_array_length(v->'entries') <> ${manifest.expected_chart_rows} then raise exception 'Manifest row-count guard failed'; end if;

  for a in select value from jsonb_array_elements(v->'album_actions') loop
    if a->>'action' = 'reuse' then
      perform 1 from public.albums x where x.id = (a->>'album_id')::bigint and not coalesce(x.is_deleted, false)
        and lower(coalesce(x.musicbrainz_release_id, x.external_id, '')) = lower(coalesce((select value->>'reuse_album_release_mbid' from jsonb_array_elements(v->'entries') where value->>'source_release_mbid' = a->>'release_mbid' limit 1), a->>'release_mbid'))
        and lower(regexp_replace(x.title, '[^[:alnum:]]+', '', 'g')) = lower(regexp_replace(a->>'title', '[^[:alnum:]]+', '', 'g')) for update;
      if not found then raise exception 'Reviewed album reuse guard failed for %', a->>'release_mbid'; end if;
    elsif not exists (select 1 from public.albums x where not coalesce(x.is_deleted, false) and (lower(x.musicbrainz_release_id) = lower(a->>'release_mbid') or lower(x.musicbrainz_release_group_id) = lower(a->>'release_group_mbid'))) then
      insert into public.albums (title, artist, external_source, external_id, musicbrainz_release_id, musicbrainz_release_group_id, cover_art_url, release_date, canonical_release_date, canonical_release_country, catalogue_selection_version, is_deleted)
      values (a->>'title', a->>'artist', 'musicbrainz', lower(a->>'release_mbid'), lower(a->>'release_mbid'), lower(a->>'release_group_mbid'), a->>'cover_art_url', nullif(a->>'release_date','')::date, nullif(a->>'release_date','')::date, a->>'country', 1, false);
      n_albums := n_albums + 1;
    end if;
  end loop;

  for e in select value from jsonb_array_elements(v->'entries') loop
    select x.id into v_album_id from public.albums x where not coalesce(x.is_deleted, false) and (
      (e->>'reuse_album_id' is not null and x.id = (e->>'reuse_album_id')::bigint) or
      lower(x.musicbrainz_release_id) = lower(e->>'source_release_mbid') or lower(x.musicbrainz_release_group_id) = lower(e->>'release_group_mbid'))
      order by (x.id = nullif(e->>'reuse_album_id','')::bigint) desc, x.id limit 1 for update;
    if v_album_id is null then raise exception 'No guarded album for chart row %', e->>'chart_row_id'; end if;

    perform 1 from public.quick_rate_collection_tracks q where q.id = (e->>'chart_row_id')::bigint and lower(regexp_replace(q.title, '[^[:alnum:]]+', '', 'g')) = lower(regexp_replace(e->>'title', '[^[:alnum:]]+', '', 'g')) and lower(regexp_replace(q.artist, '[^[:alnum:]]+', '', 'g')) = lower(regexp_replace(e->>'artist', '[^[:alnum:]]+', '', 'g')) for update;
    if not found then raise exception 'Chart identity guard failed for %', e->>'chart_row_id'; end if;
    perform 1 from public.canonical_recordings c where c.id = (e->>'placeholder_canonical_id')::uuid and lower(regexp_replace(c.title, '[^[:alnum:]]+', '', 'g')) = lower(regexp_replace(e->>'title', '[^[:alnum:]]+', '', 'g')) and lower(regexp_replace(c.artist, '[^[:alnum:]]+', '', 'g')) = lower(regexp_replace(e->>'artist', '[^[:alnum:]]+', '', 'g')) for update;
    if not found then raise exception 'Canonical identity guard failed for %', e->>'chart_row_id'; end if;

    select s.id into v_song_id from public.songs s where s.external_source = 'musicbrainz' and lower(s.external_id) = lower(e->>'recording_mbid') and not coalesce(s.is_deleted, false) for update;
    if v_song_id is null then
      if exists (select 1 from public.song_ratings r where r.canonical_song_id = (e->>'placeholder_canonical_id')::uuid) then raise exception 'Rated placeholder guard failed for %', e->>'chart_row_id'; end if;
      update public.canonical_recordings set musicbrainz_recording_id = lower(e->>'recording_mbid'), origin_key = 'musicbrainz:' || lower(e->>'recording_mbid'), source_metadata = source_metadata || jsonb_build_object('historical_pilot','historical-uk-number-ones-2000s-v1'), updated_at = timezone('utc', now()) where id = (e->>'placeholder_canonical_id')::uuid and musicbrainz_recording_id is null;
      get diagnostics v_row_count = row_count;
      if v_row_count <> 1 then raise exception 'Canonical attachment guard failed for %', e->>'chart_row_id'; end if;
      n_canonicals := n_canonicals + v_row_count;
      insert into public.songs (title, artist, album_id, track_position, external_source, external_id, canonical_song_id, duration_ms, is_deleted)
      values (e->>'title', e->>'artist', v_album_id, (e->>'track_position')::integer, 'musicbrainz', lower(e->>'recording_mbid'), (e->>'placeholder_canonical_id')::uuid, (e->>'duration_ms')::integer, false) returning id into v_song_id;
      n_songs := n_songs + 1;
      update public.quick_rate_collection_tracks set song_id = v_song_id, canonical_song_id = (e->>'placeholder_canonical_id')::uuid, musicbrainz_recording_id = lower(e->>'recording_mbid'), match_status = 'direct_mbid', match_method = 'reviewed_historical_pilot', match_notes = 'Verified official MusicBrainz source release', updated_at = timezone('utc', now()) where id = (e->>'chart_row_id')::bigint and song_id is null and match_status = 'unresolved';
      if not found then raise exception 'Chart link guard failed for %', e->>'chart_row_id'; end if;
      n_chart := n_chart + 1;
    else
      perform 1 from public.quick_rate_collection_tracks q join public.canonical_recordings c on c.id = q.canonical_song_id where q.id = (e->>'chart_row_id')::bigint and q.song_id = v_song_id and q.canonical_song_id = (e->>'placeholder_canonical_id')::uuid and lower(c.musicbrainz_recording_id) = lower(e->>'recording_mbid');
      if not found then raise exception 'Partial or conflicting prior import for %', e->>'chart_row_id'; end if;
    end if;
  end loop;

  if n_albums <> (v->'expected'->>'albums_insert')::integer or n_canonicals <> (v->'expected'->>'canonicals_update')::integer or n_songs <> (v->'expected'->>'songs_insert')::integer or n_chart <> (v->'expected'->>'chart_rows_update')::integer then
    raise exception 'Exact row-count assertion failed: albums %, canonicals %, songs %, chart %', n_albums, n_canonicals, n_songs, n_chart;
  end if;
end
$pilot$;
commit;
`;
}

export async function main() {
  const commit = process.argv.includes("--commit");
  const manifest = validateManifest(JSON.parse(await readFile(resolve(option("manifest", DEFAULT_MANIFEST)), "utf8")));
  const cacheFile = resolve(option("musicbrainz-cache", resolve(HERE, ".cache/historical-uk-number-ones-pilot.json")));
  const musicbrainz = await validateMusicBrainz(manifest, { cacheFile });
  const snapshotPath = option("snapshot");
  const snapshot = snapshotPath ? JSON.parse(await readFile(resolve(snapshotPath), "utf8")) : await restSnapshot(manifest);
  const plan = buildPlan(manifest, snapshot, musicbrainz.releases);
  const sql = generateTransactionSql(manifest, plan);
  if (option("sql-output")) await writeFile(resolve(option("sql-output")), sql);
  console.log(JSON.stringify({ mode: commit ? "commit" : "dry-run", musicbrainz: { requests: musicbrainz.requests, cache_hits: musicbrainz.cache_hits, validated: musicbrainz.validations.length }, planned: plan.counts, albums: plan.album_actions, blockers: [] }, null, 2));
  if (!commit) { console.log("Dry run succeeded. No database rows were written; --commit is required for changes."); return; }
  if (snapshotPath) throw new Error("--commit refuses --snapshot; live guards must be re-read immediately before execution.");
  const databaseUrl = process.env.BOM_DATABASE_URL;
  if (!databaseUrl) throw new Error("--commit requires BOM_DATABASE_URL for one atomic PostgreSQL transaction.");
  const psql = option("psql", "psql");
  const result = spawnSync(psql, ["--no-psqlrc", "--set", "ON_ERROR_STOP=1"], {
    input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PGDATABASE: databaseUrl }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Transaction failed and rolled back: ${result.stderr.trim()}`);
  console.log(result.stdout.trim());
}

if (typeof process !== "undefined" && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
