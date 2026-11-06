#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { postgresDateOrNull, validateMusicBrainzRelease } from "./historical-uk-number-ones-pilot.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REJECTED_VERSION = /\b(live|demo|remix|karaoke|cover|instrumental|re[ -]?record(?:ed|ing)?)\b/i;

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  const inline = process.argv.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") { row.push(field); field = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
export function toCsv(rows) {
  const headers = ["chart_id", "chart_year", "artist", "title", "reason", "candidate_identifiers"];
  return `${headers.join(",")}\n${rows.map(row => headers.map(key => csvCell(row[key])).join(",")).join("\n")}${rows.length ? "\n" : ""}`;
}

function uniqueSongs(candidates = []) {
  return [...new Map(candidates.map(candidate => [String(candidate.song_id), candidate])).values()];
}

function identifiers(row, candidates = [], review = null) {
  const values = new Set();
  if (row.musicbrainz_recording_id) values.add(`recording:${row.musicbrainz_recording_id}`);
  for (const candidate of candidates) {
    if (candidate.external_source === "musicbrainz" && candidate.external_id) values.add(`recording:${candidate.external_id}`);
    if (candidate.canonical_song_id) values.add(`canonical:${candidate.canonical_song_id}`);
    if (candidate.song_id) values.add(`song:${candidate.song_id}`);
  }
  if (review?.candidate_summary) values.add(review.candidate_summary);
  return [...values].join(" | ");
}

export function classifyRows(snapshot, reviewRows, verifiedEntries = [], releaseCache = {}) {
  const reviewById = new Map(reviewRows.map(row => [Number(row.chart_row_id), row]));
  const verifiedById = new Map(verifiedEntries.map(entry => [Number(entry.chart_row_id), entry]));
  const result = [];
  for (const row of snapshot.rows) {
    const candidates = uniqueSongs(snapshot.existing_matches?.[String(row.id)] || []);
    const review = reviewById.get(Number(row.id));
    const verified = verifiedById.get(Number(row.id));
    if (candidates.length === 1) {
      const candidate = candidates[0];
      const placeholder = snapshot.canonical_placeholders?.[String(row.canonical_song_id)];
      const replaceablePlaceholder = Boolean(placeholder && !placeholder.musicbrainz_recording_id &&
        Number(placeholder.rating_rows) === 0 && Number(placeholder.song_occurrences) === 0);
      const canonicalCompatible = !row.canonical_song_id || candidate.canonical_song_id === row.canonical_song_id || replaceablePlaceholder;
      const mbidCompatible = !row.musicbrainz_recording_id ||
        (candidate.external_source === "musicbrainz" && candidate.external_id?.toLowerCase() === row.musicbrainz_recording_id.toLowerCase());
      if (canonicalCompatible && mbidCompatible) {
        result.push({ category: "SAFE", action: "link_existing", row, candidate,
          replace_placeholder: Boolean(row.canonical_song_id && candidate.canonical_song_id !== row.canonical_song_id),
          reason: "unique_existing_bom_recording", candidate_identifiers: identifiers(row, candidates, review) });
        continue;
      }
      result.push({ category: "REVIEW", row, reason: "existing_identity_conflict",
        candidate_identifiers: identifiers(row, candidates, review) });
      continue;
    }
    if (candidates.length > 1 || review) {
      result.push({ category: "REVIEW", row,
        reason: review?.ambiguity_reason || "multiple_existing_bom_candidates",
        candidate_identifiers: identifiers(row, candidates, review) });
      continue;
    }
    if (verified) {
      const release = releaseCache[verified.source_release_mbid];
      try {
        if (!release) throw new Error("verified release response is not cached");
        validateMusicBrainzRelease(verified, release);
        if (REJECTED_VERSION.test(`${verified.version_note || ""} ${release.disambiguation || ""}`) &&
            !verified.chart_evidence_supports_version) throw new Error("rejected recording version");
        result.push({ category: "SAFE", action: "import_verified", row, verified, release,
          reason: "cached_official_release_verified", candidate_identifiers: identifiers(row) });
        continue;
      } catch (error) {
        result.push({ category: "REVIEW", row, reason: `verified_evidence_failed: ${error.message}`,
          candidate_identifiers: identifiers(row) });
        continue;
      }
    }
    result.push({ category: "UNAVAILABLE", row, reason: "no_verified_recording_and_release",
      candidate_identifiers: identifiers(row) });
  }
  return result;
}

export function createBatches(safeRows, size = 25) {
  if (!Number.isInteger(size) || size < 1 || size > 25) throw new Error("Batch size must be between 1 and 25.");
  const batches = [];
  for (let index = 0; index < safeRows.length; index += size) {
    batches.push({ batch: batches.length + 1, records: safeRows.slice(index, index + size) });
  }
  return batches;
}

function sql(value) { return `'${String(value ?? "").replaceAll("'", "''")}'`; }

export function recordTransactionSql(item, snapshot = {}) {
  const row = item.row;
  if (item.action === "link_existing") {
    const candidate = item.candidate;
    return `begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtextextended('bom-historical-bulk:${row.id}', 0));
do $record$
declare n integer;
begin
  perform 1 from public.quick_rate_collection_tracks where id=${Number(row.id)} and song_id is null and match_status='unresolved' for update;
  if not found then raise exception 'chart precondition failed for ${Number(row.id)}'; end if;
  perform 1 from public.songs where id=${Number(candidate.song_id)} and not coalesce(is_deleted,false) and canonical_song_id=${sql(candidate.canonical_song_id)}::uuid for update;
  if not found then raise exception 'song identity failed for ${Number(row.id)}'; end if;
  ${item.replace_placeholder ? `perform 1 from public.canonical_recordings where id=${sql(row.canonical_song_id)}::uuid and musicbrainz_recording_id is null for update;
  if not found then raise exception 'placeholder canonical precondition failed for ${Number(row.id)}'; end if;
  if exists(select 1 from public.song_ratings where canonical_song_id=${sql(row.canonical_song_id)}::uuid) or
     exists(select 1 from public.songs where canonical_song_id=${sql(row.canonical_song_id)}::uuid and not coalesce(is_deleted,false)) then
    raise exception 'placeholder canonical is no longer empty for ${Number(row.id)}';
  end if;` : ""}
  update public.quick_rate_collection_tracks set song_id=${Number(candidate.song_id)}, canonical_song_id=${sql(candidate.canonical_song_id)}::uuid,
    musicbrainz_recording_id=${candidate.external_source === "musicbrainz" && candidate.external_id ? sql(candidate.external_id.toLowerCase()) : "musicbrainz_recording_id"},
    match_status=${candidate.external_source === "musicbrainz" ? "'direct_mbid'" : "'title_artist'"}, match_method='bulk_unique_existing',
    match_notes='Uniquely matched to existing BOM canonical recording',updated_at=timezone('utc',now()) where id=${Number(row.id)} and song_id is null;
  get diagnostics n=row_count; if n<>1 then raise exception 'exact chart update count failed for ${Number(row.id)}'; end if;
end $record$;
commit;
`;
  }
  const entry = item.verified;
  const releaseDate = postgresDateOrNull(item.release?.date);
  const albums = snapshot.albums || [];
  const album = albums.find(value => !value.is_deleted && (
    value.musicbrainz_release_group_id?.toLowerCase() === entry.release_group_mbid ||
    value.musicbrainz_release_id?.toLowerCase() === entry.source_release_mbid ||
    (value.external_source === "musicbrainz" && value.external_id?.toLowerCase() === entry.source_release_mbid)
  ));
  const reuseId = album?.id || entry.reuse_album_id || null;
  return `begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtextextended('bom-historical-bulk:${row.id}', 0));
do $record$
declare v_album_id bigint; v_song_id bigint; n integer;
begin
  perform 1 from public.quick_rate_collection_tracks where id=${Number(row.id)} and song_id is null and match_status='unresolved' for update;
  if not found then raise exception 'chart precondition failed for ${Number(row.id)}'; end if;
  perform 1 from public.canonical_recordings where id=${sql(row.canonical_song_id)}::uuid and musicbrainz_recording_id is null for update;
  if not found then raise exception 'canonical precondition failed for ${Number(row.id)}'; end if;
  if exists(select 1 from public.song_ratings where canonical_song_id=${sql(row.canonical_song_id)}::uuid) then raise exception 'rated placeholder for ${Number(row.id)}'; end if;
  if exists(select 1 from public.songs where external_source='musicbrainz' and lower(external_id)=${sql(entry.recording_mbid)}) then raise exception 'recording occurrence already exists for ${Number(row.id)}'; end if;
  ${reuseId ? `select id into v_album_id from public.albums where id=${Number(reuseId)} and not coalesce(is_deleted,false) for update;
  if v_album_id is null then raise exception 'reviewed album reuse failed for ${Number(row.id)}'; end if;` : `insert into public.albums(title,artist,external_source,external_id,musicbrainz_release_id,musicbrainz_release_group_id,cover_art_url,release_date,canonical_release_date,canonical_release_country,catalogue_selection_version,is_deleted)
  values(${sql(entry.source_album_title)},${sql(entry.source_album_artist || entry.artist)},'musicbrainz',${sql(entry.source_release_mbid)},${sql(entry.source_release_mbid)},${sql(entry.release_group_mbid)},${sql(`https://coverartarchive.org/release-group/${entry.release_group_mbid}/front-500`)},${releaseDate ? `${sql(releaseDate)}::date` : "null"},${releaseDate ? `${sql(releaseDate)}::date` : "null"},${sql(entry.source_release_country)},1,false) returning id into v_album_id;`}
  update public.canonical_recordings set musicbrainz_recording_id=${sql(entry.recording_mbid)},origin_key=${sql(`musicbrainz:${entry.recording_mbid}`)},updated_at=timezone('utc',now()) where id=${sql(row.canonical_song_id)}::uuid and musicbrainz_recording_id is null;
  get diagnostics n=row_count; if n<>1 then raise exception 'canonical exact count failed for ${Number(row.id)}'; end if;
  insert into public.songs(title,artist,album_id,track_position,external_source,external_id,canonical_song_id,duration_ms,is_deleted)
  values(${sql(entry.title)},${sql(entry.artist)},v_album_id,${Number(entry.track_position)},'musicbrainz',${sql(entry.recording_mbid)},${sql(row.canonical_song_id)}::uuid,${Number(entry.duration_ms)},false) returning id into v_song_id;
  update public.quick_rate_collection_tracks set song_id=v_song_id,canonical_song_id=${sql(row.canonical_song_id)}::uuid,musicbrainz_recording_id=${sql(entry.recording_mbid)},match_status='direct_mbid',match_method='bulk_verified_release',match_notes='Verified official MusicBrainz source release',updated_at=timezone('utc',now()) where id=${Number(row.id)} and song_id is null;
  get diagnostics n=row_count; if n<>1 then raise exception 'chart exact count failed for ${Number(row.id)}'; end if;
end $record$;
commit;
`;
}

export function summarise(classified, snapshot = {}) {
  const count = category => classified.filter(item => item.category === category).length;
  const safe = classified.filter(item => item.category === "SAFE");
  const imports = safe.filter(item => item.action === "import_verified");
  const albums = snapshot.albums || [];
  const albumInserts = new Set(imports.filter(item => !albums.some(album => !album.is_deleted && (
    album.musicbrainz_release_group_id?.toLowerCase() === item.verified.release_group_mbid ||
    album.musicbrainz_release_id?.toLowerCase() === item.verified.source_release_mbid
  ))).map(item => item.verified.source_release_mbid)).size;
  return { total: classified.length, SAFE: count("SAFE"), REVIEW: count("REVIEW"), UNAVAILABLE: count("UNAVAILABLE"),
    expected: { album_inserts: albumInserts, canonical_attachments: imports.length,
      song_occurrences: imports.length, historical_links: safe.length } };
}

async function main() {
  const snapshotPath = option("snapshot");
  if (!snapshotPath) throw new Error("--snapshot is required for a reproducible dry-run.");
  const snapshot = JSON.parse(await readFile(resolve(snapshotPath), "utf8"));
  const reviewPath = option("review-seed", resolve(HERE, "../supabase/exports/historical-catalogue-ambiguous-review-2026-11-05.csv"));
  const reviewRows = parseCsv(await readFile(resolve(reviewPath), "utf8"));
  const verifiedPath = option("verified-manifest", resolve(HERE, "historical-uk-number-ones-pilot.manifest.json"));
  const verified = JSON.parse(await readFile(resolve(verifiedPath), "utf8")).entries || [];
  let releaseCache = {};
  const cachePath = option("musicbrainz-cache");
  if (cachePath) releaseCache = JSON.parse(await readFile(resolve(cachePath), "utf8"));
  const classified = classifyRows(snapshot, reviewRows, verified, releaseCache);
  const safe = classified.filter(item => item.category === "SAFE");
  const review = classified.filter(item => item.category === "REVIEW").map(item => ({ chart_id: item.row.id, chart_year: item.row.chart_year, artist: item.row.artist, title: item.row.title, reason: item.reason, candidate_identifiers: item.candidate_identifiers }));
  const unavailable = classified.filter(item => item.category === "UNAVAILABLE").map(item => ({ chart_id: item.row.id, chart_year: item.row.chart_year, artist: item.row.artist, title: item.row.title, reason: item.reason, candidate_identifiers: item.candidate_identifiers }));
  const outputDir = resolve(option("output-dir", resolve(HERE, "../supabase/exports")));
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "historical-uk-number-ones-review.csv"), toCsv(review));
  await writeFile(resolve(outputDir, "historical-uk-number-ones-unavailable.csv"), toCsv(unavailable));
  const batches = createBatches(safe, Number(option("batch-size", "25")));
  const plan = { generated_at: new Date().toISOString(), source_snapshot: snapshotPath, dry_run: true,
    safeguards: {
      maximum_batch_size: 25,
      transaction_scope: "one record per transaction within independently resumable batches",
      failure_policy: "rollback the affected record, record the reason, and continue",
      dates: "only valid YYYY-MM-DD values are written; partial dates remain NULL",
      ratings: "rated canonical placeholders are rejected and existing rating rows are never updated"
    },
    post_import_verification: [
      "Compare global album, song, canonical attachment and historical-link counts with this plan.",
      "Verify each linked chart row resolves through its intended canonical recording and source album.",
      "Confirm cover-art resolution and existing track navigation for every completed record.",
      "Compare rating rows and aggregate rating counts with the pre-import snapshot.",
      "Check for duplicate recording MBIDs, release MBIDs and canonical identities.",
      "Rerun the dry-run from a fresh snapshot and require zero proposed changes for completed records."
    ],
    risks: [
      "REVIEW records require human identity/version decisions before any import.",
      "UNAVAILABLE records have no sufficiently verified cached recording/release evidence and must not be auto-imported.",
      "A future production run must use a fresh read-only snapshot so stale preconditions fail closed."
    ],
    summary: summarise(classified, snapshot),
    batches: batches.map(batch => ({ batch: batch.batch, records: batch.records.map(item => ({ chart_id: item.row.id, action: item.action, sql: recordTransactionSql(item, snapshot) })) })) };
  const planPath = resolve(option("plan-output", resolve(outputDir, "historical-uk-number-ones-bulk-plan.json")));
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(JSON.stringify(plan.summary, null, 2));
  if (!process.argv.includes("--commit")) { console.log("Dry run only. No database rows were written."); return; }
  const databaseUrl = process.env.BOM_DATABASE_URL;
  if (!databaseUrl) throw new Error("--commit requires BOM_DATABASE_URL.");
  const checkpointPath = resolve(option("checkpoint", resolve(HERE, ".cache/historical-uk-number-ones-bulk-state.json")));
  let checkpoint = { completed: [], failures: [] };
  try { checkpoint = JSON.parse(await readFile(checkpointPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const batch of plan.batches) {
    for (const record of batch.records) {
      if (checkpoint.completed.includes(record.chart_id)) continue;
      const execution = spawnSync(option("psql", "psql"), ["--no-psqlrc", "--set", "ON_ERROR_STOP=1"], { input: record.sql, encoding: "utf8", env: { ...process.env, PGDATABASE: databaseUrl } });
      if (execution.status === 0) checkpoint.completed.push(record.chart_id);
      else checkpoint.failures.push({ chart_id: record.chart_id, batch: batch.batch, error: execution.stderr?.trim() || execution.error?.message || "psql failed" });
      await mkdir(dirname(checkpointPath), { recursive: true });
      await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
    }
  }
  if (checkpoint.failures.length) process.exitCode = 1;
}

if (typeof process !== "undefined" && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
