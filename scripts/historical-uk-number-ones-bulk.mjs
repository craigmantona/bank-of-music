#!/usr/bin/env node
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

const PLACEHOLDER_COUNT_FIELDS = ["canonical_rating_rows", "historical_rating_rows", "song_occurrences"];

function nonNegativeCount(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function placeholderSafety(snapshot, row) {
  const placeholder = snapshot.canonical_placeholders?.[String(row.canonical_song_id)];
  if (!placeholder) return { known: false, placeholder: null };
  const counts = {};
  for (const field of PLACEHOLDER_COUNT_FIELDS) {
    const count = nonNegativeCount(placeholder[field]);
    if (count === null) return { known: false, placeholder };
    counts[field] = count;
  }
  return { known: true, placeholder, ...counts };
}

function reviewResult(row, reason, candidates = [], review = null) {
  return { category: "REVIEW", row, reason, candidate_identifiers: identifiers(row, candidates, review) };
}

export function classifyRows(snapshot, reviewRows, verifiedEntries = [], releaseCache = {}) {
  const reviewById = new Map(reviewRows.map(row => [Number(row.chart_row_id), row]));
  const verifiedById = new Map();
  for (const entry of verifiedEntries) {
    const chartRowId = Number(entry.chart_row_id);
    const matches = verifiedById.get(chartRowId) || [];
    matches.push(entry);
    verifiedById.set(chartRowId, matches);
  }
  const result = [];
  for (const row of snapshot.rows) {
    const candidates = uniqueSongs(snapshot.existing_matches?.[String(row.id)] || []);
    const review = reviewById.get(Number(row.id));
    const verifiedMatches = verifiedById.get(Number(row.id)) || [];
    const verified = verifiedMatches[0];
    if (review) {
      result.push(reviewResult(row, review.ambiguity_reason || "seeded_review_required", candidates, review));
      continue;
    }
    if (verifiedMatches.length > 1) {
      result.push(reviewResult(row, "multiple_verified_manifest_entries", candidates));
      continue;
    }
    if (candidates.length === 1) {
      const candidate = candidates[0];
      const safety = placeholderSafety(snapshot, row);
      if (!safety.known) {
        result.push(reviewResult(row, "placeholder_safety_metadata_unknown", candidates, review));
        continue;
      }
      const sameCanonical = candidate.canonical_song_id === row.canonical_song_id;
      const replaceablePlaceholder = !sameCanonical && !safety.placeholder.musicbrainz_recording_id &&
        safety.canonical_rating_rows === 0 && safety.historical_rating_rows === 0 && safety.song_occurrences === 0;
      const canonicalCompatible = sameCanonical || replaceablePlaceholder;
      const hasAuthoritativeRecordingId = typeof row.musicbrainz_recording_id === "string" &&
        row.musicbrainz_recording_id.trim() !== "";
      const mbidCompatible = hasAuthoritativeRecordingId && candidate.external_source === "musicbrainz" &&
        candidate.external_id?.toLowerCase() === row.musicbrainz_recording_id.toLowerCase();
      if (safety.historical_rating_rows > 0) {
        result.push(reviewResult(row, "historical_ratings_require_reconciliation", candidates, review));
        continue;
      }
      if (!hasAuthoritativeRecordingId) {
        result.push(reviewResult(row, "existing_match_requires_authoritative_recording_evidence", candidates, review));
        continue;
      }
      if (canonicalCompatible && mbidCompatible) {
        result.push({ category: "SAFE", action: "link_existing", row, candidate,
          replace_placeholder: !sameCanonical,
          reason: "unique_existing_bom_recording", candidate_identifiers: identifiers(row, candidates, review) });
        continue;
      }
      result.push(reviewResult(row, "existing_identity_conflict", candidates, review));
      continue;
    }
    if (candidates.length > 1) {
      result.push({ category: "REVIEW", row,
        reason: "multiple_existing_bom_candidates",
        candidate_identifiers: identifiers(row, candidates) });
      continue;
    }
    if (verified) {
      const verifiedChartIdentityMatches = verified.title === row.title && verified.artist === row.artist &&
        (verified.chart_year === undefined || Number(verified.chart_year) === Number(row.chart_year)) &&
        (verified.placeholder_canonical_id === undefined ||
          (typeof verified.placeholder_canonical_id === "string" && typeof row.canonical_song_id === "string" &&
            verified.placeholder_canonical_id.toLowerCase() === row.canonical_song_id.toLowerCase()));
      if (!verifiedChartIdentityMatches) {
        result.push(reviewResult(row, "verified_chart_identity_mismatch"));
        continue;
      }
      const release = releaseCache[verified.source_release_mbid];
      try {
        if (!release) throw new Error("verified release response is not cached");
        validateMusicBrainzRelease(verified, release);
        if (REJECTED_VERSION.test(`${verified.version_note || ""} ${release.disambiguation || ""}`) &&
            !verified.chart_evidence_supports_version) throw new Error("rejected recording version");
        const safety = placeholderSafety(snapshot, row);
        if (!safety.known) {
          result.push(reviewResult(row, "placeholder_safety_metadata_unknown"));
          continue;
        }
        if (safety.placeholder.musicbrainz_recording_id || safety.canonical_rating_rows > 0 ||
            safety.historical_rating_rows > 0 || safety.song_occurrences > 0) {
          result.push(reviewResult(row, "rated_or_nonempty_placeholder"));
          continue;
        }
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required for guarded SQL.`);
  return value;
}

function requiredInteger(value, label, { positive = false } = {}) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || (positive && number < 1)) throw new Error(`${label} must be a safe integer.`);
  return number;
}

function requiredUuid(value, label) {
  const text = requiredText(value, label).toLowerCase();
  if (!UUID.test(text)) throw new Error(`${label} must be a UUID.`);
  return text;
}

function consistentOptionalUuid(label, values) {
  const identities = [...new Set(values.filter(value => value !== null && value !== undefined && value !== "")
    .map(value => requiredUuid(value, label)))];
  if (identities.length > 1) throw new Error(`${label} metadata conflicts.`);
  return identities[0] || null;
}

function chartIdentity(row) {
  if (row.collection_key !== undefined && row.collection_key !== "uk-number-ones") {
    throw new Error("chart collection_key must be uk-number-ones.");
  }
  if (row.match_status !== "unresolved") throw new Error("chart match_status must be unresolved.");
  if (!Object.hasOwn(row, "musicbrainz_recording_id")) throw new Error("chart original recording identity is required.");
  const originalRecordingId = row.musicbrainz_recording_id === null
    ? null
    : requiredUuid(row.musicbrainz_recording_id, "chart original recording identity");
  return {
    id: requiredInteger(row.id, "chart id", { positive: true }),
    sourceEntryKey: requiredText(row.source_entry_key, "chart source_entry_key"),
    chartYear: requiredInteger(row.chart_year, "chart year"),
    title: requiredText(row.title, "chart title"),
    artist: requiredText(row.artist, "chart artist"),
    originalCanonicalId: requiredUuid(row.canonical_song_id, "chart original canonical identity"),
    originalRecordingId
  };
}

function chartPredicate(identity, alias = "q") {
  const recording = identity.originalRecordingId === null
    ? `${alias}.musicbrainz_recording_id is null`
    : `lower(${alias}.musicbrainz_recording_id)=${sql(identity.originalRecordingId)}`;
  return `${alias}.id=${identity.id}
    and ${alias}.collection_key='uk-number-ones'
    and ${alias}.source_entry_key=${sql(identity.sourceEntryKey)}
    and ${alias}.chart_year=${identity.chartYear}
    and ${alias}.title=${sql(identity.title)}
    and ${alias}.artist=${sql(identity.artist)}
    and ${alias}.song_id is null
    and ${alias}.match_status='unresolved'
    and ${alias}.canonical_song_id=${sql(identity.originalCanonicalId)}::uuid
    and ${recording}`;
}

function targetIdentity(candidate, snapshot) {
  if (candidate.external_source !== "musicbrainz") throw new Error("target song must have reviewed MusicBrainz provenance.");
  const albumId = requiredInteger(candidate.album_id, "target album id", { positive: true });
  const album = (snapshot.albums || []).find(value => Number(value.id) === albumId);
  const releaseId = consistentOptionalUuid("target album release identity", [
    candidate.musicbrainz_release_id, candidate.album_musicbrainz_release_id, candidate.release_mbid,
    album?.musicbrainz_release_id,
    album?.external_source === "musicbrainz" ? album.external_id : null
  ]);
  const releaseGroupId = consistentOptionalUuid("target album release-group identity", [
    candidate.musicbrainz_release_group_id, candidate.album_musicbrainz_release_group_id,
    candidate.release_group_mbid, album?.musicbrainz_release_group_id
  ]);
  return {
    songId: requiredInteger(candidate.song_id, "target song id", { positive: true }),
    canonicalId: requiredUuid(candidate.canonical_song_id, "target canonical identity"),
    recordingId: requiredUuid(candidate.external_id, "target recording identity"),
    title: requiredText(candidate.title, "target song title"),
    artist: requiredText(candidate.artist, "target song artist"),
    albumId,
    albumTitle: album?.title || null,
    albumArtist: album?.artist || null,
    releaseId,
    releaseGroupId
  };
}

function targetGuardSql(target, chartId) {
  const albumTitle = target.albumTitle ? `\n    and a.title=${sql(target.albumTitle)}` : "";
  const albumArtist = target.albumArtist ? `\n    and a.artist=${sql(target.albumArtist)}` : "";
  const release = target.releaseId ? `\n    and (lower(a.musicbrainz_release_id)=${sql(target.releaseId)} or
         (a.external_source='musicbrainz' and lower(a.external_id)=${sql(target.releaseId)}))` : "";
  const releaseGroup = target.releaseGroupId
    ? `\n    and lower(a.musicbrainz_release_group_id)=${sql(target.releaseGroupId)}`
    : "";
  return `perform 1
  from public.songs s
  join public.canonical_recordings c on c.id=s.canonical_song_id
  join public.albums a on a.id=s.album_id
  where s.id=${target.songId}
    and s.title=${sql(target.title)}
    and s.artist=${sql(target.artist)}
    and s.canonical_song_id=${sql(target.canonicalId)}::uuid
    and s.album_id=${target.albumId}
    and s.external_source='musicbrainz'
    and lower(s.external_id)=${sql(target.recordingId)}
    and not coalesce(s.is_deleted,false)
    and c.id=${sql(target.canonicalId)}::uuid
    and lower(c.musicbrainz_recording_id)=${sql(target.recordingId)}
    and a.id=${target.albumId}
    and not coalesce(a.is_deleted,false)${albumTitle}${albumArtist}${release}${releaseGroup}
  for update of s,c,a;
  if not found then raise exception 'approved target identity failed for ${chartId}'; end if;`;
}

function albumDuplicatePredicate(alias, releaseId, releaseGroupId) {
  return `(lower(${alias}.musicbrainz_release_id)=${sql(releaseId)} or
      (${alias}.external_source='musicbrainz' and lower(${alias}.external_id)=${sql(releaseId)}) or
      lower(${alias}.musicbrainz_release_group_id)=${sql(releaseGroupId)})`;
}

export function recordTransactionSql(item, snapshot = {}) {
  const row = item.row;
  const chart = chartIdentity(row);
  const exactChart = chartPredicate(chart);
  if (item.action === "link_existing") {
    const target = targetIdentity(item.candidate, snapshot);
    if (chart.originalRecordingId === null || chart.originalRecordingId !== target.recordingId) {
      throw new Error("target recording identity must exactly match the chart recording identity.");
    }
    const replacePlaceholder = chart.originalCanonicalId !== target.canonicalId;
    return `begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtextextended('bom-historical-bulk:${chart.id}', 0));
do $record$
declare n integer;
begin
  perform 1
  from public.quick_rate_collection_tracks q
  where ${exactChart}
  for update;
  if not found then raise exception 'chart identity precondition failed for ${chart.id}'; end if;
  ${targetGuardSql(target, chart.id)}
  if exists(select 1 from public.historical_chart_entry_ratings where chart_entry_id=${chart.id}) then
    raise exception 'historical ratings require reconciliation for ${chart.id}';
  end if;
  ${replacePlaceholder ? `perform 1
  from public.canonical_recordings c
  where c.id=${sql(chart.originalCanonicalId)}::uuid
    and c.title=${sql(chart.title)}
    and c.artist=${sql(chart.artist)}
    and c.musicbrainz_recording_id is null
  for update;
  if not found then raise exception 'placeholder canonical identity failed for ${chart.id}'; end if;
  if exists(select 1 from public.song_ratings where canonical_song_id=${sql(chart.originalCanonicalId)}::uuid) or
     exists(select 1 from public.songs where canonical_song_id=${sql(chart.originalCanonicalId)}::uuid) then
    raise exception 'placeholder canonical is no longer empty for ${chart.id}';
  end if;` : ""}
  update public.quick_rate_collection_tracks q
  set song_id=${target.songId}, canonical_song_id=${sql(target.canonicalId)}::uuid,
    musicbrainz_recording_id=${sql(target.recordingId)}, match_status='direct_mbid', match_method='bulk_unique_existing',
    match_notes='Uniquely matched to existing BOM canonical recording',updated_at=timezone('utc',now())
  where ${chartPredicate(chart)};
  get diagnostics n=row_count; if n<>1 then raise exception 'exact chart update count failed for ${chart.id}'; end if;
end $record$;
commit;
`;
  }

  if (item.action !== "import_verified") throw new Error(`Unsupported bulk action: ${item.action}`);
  const entry = item.verified;
  if (requiredInteger(entry.chart_row_id, "verified chart id", { positive: true }) !== chart.id) {
    throw new Error("verified chart identity does not match the guarded chart row.");
  }
  if (entry.chart_year !== undefined && requiredInteger(entry.chart_year, "verified chart year") !== chart.chartYear) {
    throw new Error("verified chart year does not match the guarded chart row.");
  }
  if (entry.placeholder_canonical_id !== undefined &&
      requiredUuid(entry.placeholder_canonical_id, "verified placeholder canonical identity") !== chart.originalCanonicalId) {
    throw new Error("verified placeholder canonical identity does not match the guarded chart row.");
  }
  const recordingId = requiredUuid(entry.recording_mbid, "verified recording identity");
  const releaseId = requiredUuid(entry.source_release_mbid, "verified source release identity");
  const releaseGroupId = requiredUuid(entry.release_group_mbid, "verified release-group identity");
  const entryTitle = requiredText(entry.title, "verified song title");
  const entryArtist = requiredText(entry.artist, "verified song artist");
  if (entryTitle !== chart.title || entryArtist !== chart.artist) {
    throw new Error("verified title/artist identity does not match the guarded chart row.");
  }
  if (chart.originalRecordingId !== null && chart.originalRecordingId !== recordingId) {
    throw new Error("verified recording identity does not match the chart recording identity.");
  }
  const sourceAlbumTitle = requiredText(entry.source_album_title, "verified source album title");
  const sourceAlbumArtist = requiredText(entry.source_album_artist || entry.artist, "verified source album artist");
  const sourceReleaseCountry = requiredText(entry.source_release_country, "verified source release country");
  const trackPosition = requiredInteger(entry.track_position, "verified track position", { positive: true });
  const durationMs = requiredInteger(entry.duration_ms, "verified duration");
  if (durationMs < 0) throw new Error("verified duration must not be negative.");
  const releaseDate = postgresDateOrNull(item.release?.date);
  const albums = snapshot.albums || [];
  const forcedReuseId = entry.reuse_album_id === null || entry.reuse_album_id === undefined
    ? null
    : requiredInteger(entry.reuse_album_id, "reviewed album reuse id", { positive: true });
  const album = (forcedReuseId ? albums.find(value => Number(value.id) === forcedReuseId) : null) ||
    albums.find(value => !value.is_deleted && (
      value.musicbrainz_release_group_id?.toLowerCase() === releaseGroupId ||
      value.musicbrainz_release_id?.toLowerCase() === releaseId ||
      (value.external_source === "musicbrainz" && value.external_id?.toLowerCase() === releaseId)
    ));
  const reuseId = album?.id === undefined && forcedReuseId === null
    ? null
    : requiredInteger(album?.id ?? forcedReuseId, "reviewed album reuse id", { positive: true });
  const reusedReleaseId = reuseId === null ? null : (consistentOptionalUuid("reviewed reused album release identity", [
    album?.musicbrainz_release_id,
    album?.external_source === "musicbrainz" ? album.external_id : null,
    entry.reuse_album_release_mbid
  ]) || releaseId);
  const reusedReleaseGroupId = reuseId === null ? null : (consistentOptionalUuid("reviewed reused album release-group identity", [
    album?.musicbrainz_release_group_id, entry.release_group_mbid
  ]) || releaseGroupId);
  const duplicateAlbum = albumDuplicatePredicate("a", releaseId, releaseGroupId);
  const albumMutation = reuseId !== null ? `select a.id into v_album_id
  from public.albums a
  where a.id=${reuseId}
    and a.title=${sql(album?.title || sourceAlbumTitle)}
    and a.artist=${sql(album?.artist || sourceAlbumArtist)}
    and not coalesce(a.is_deleted,false)
    and (lower(a.musicbrainz_release_id)=${sql(reusedReleaseId)} or
         (a.external_source='musicbrainz' and lower(a.external_id)=${sql(reusedReleaseId)}))
    and lower(a.musicbrainz_release_group_id)=${sql(reusedReleaseGroupId)}
  for update;
  if v_album_id is null then raise exception 'reviewed album provenance failed for ${chart.id}'; end if;
  if exists(select 1 from public.albums a where a.id<>v_album_id and ${duplicateAlbum}) then
    raise exception 'duplicate release or partial import for ${chart.id}';
  end if;` : `if exists(select 1 from public.albums a where ${duplicateAlbum}) then
    raise exception 'duplicate release or partial import for ${chart.id}';
  end if;
  insert into public.albums(title,artist,external_source,external_id,musicbrainz_release_id,musicbrainz_release_group_id,cover_art_url,release_date,canonical_release_date,canonical_release_country,catalogue_selection_version,is_deleted)
  values(${sql(sourceAlbumTitle)},${sql(sourceAlbumArtist)},'musicbrainz',${sql(releaseId)},${sql(releaseId)},${sql(releaseGroupId)},${sql(`https://coverartarchive.org/release-group/${releaseGroupId}/front-500`)},${releaseDate ? `${sql(releaseDate)}::date` : "null"},${releaseDate ? `${sql(releaseDate)}::date` : "null"},${sql(sourceReleaseCountry)},1,false) returning id into v_album_id;`;

  return `begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtextextended('bom-historical-bulk:${chart.id}', 0));
select pg_advisory_xact_lock(hashtextextended('bom-admin-catalogue:${releaseGroupId}', 0));
select pg_advisory_xact_lock(hashtextextended('bom-recording:${recordingId}', 0));
select pg_advisory_xact_lock(hashtextextended('bom-release:${releaseId}', 0));
select pg_advisory_xact_lock(hashtextextended('bom-release-group:${releaseGroupId}', 0));
lock table public.quick_rate_collection_tracks in exclusive mode;
lock table public.albums in share row exclusive mode;
lock table public.canonical_recordings in share row exclusive mode;
lock table public.songs in share row exclusive mode;
lock table public.song_ratings in share row exclusive mode;
lock table public.historical_chart_entry_ratings in share row exclusive mode;
do $record$
declare v_album_id bigint; v_song_id bigint; v_chart_reference_count integer; n integer;
begin
  perform 1
  from public.quick_rate_collection_tracks q
  where ${exactChart}
  for update;
  if not found then raise exception 'chart identity precondition failed for ${chart.id}'; end if;
  perform 1
  from public.canonical_recordings c
  where c.id=${sql(chart.originalCanonicalId)}::uuid
    and c.title=${sql(chart.title)}
    and c.artist=${sql(chart.artist)}
    and c.musicbrainz_recording_id is null
    and c.origin_key=${sql(`quick-rate:uk-number-ones:${chart.sourceEntryKey}`)}
  for update;
  if not found then raise exception 'canonical identity precondition failed for ${chart.id}'; end if;
  select count(*)::integer into v_chart_reference_count
  from public.quick_rate_collection_tracks q
  where q.canonical_song_id=${sql(chart.originalCanonicalId)}::uuid;
  if v_chart_reference_count<>1 then raise exception 'placeholder chart reference count failed for ${chart.id}'; end if;
  if exists(select 1 from public.song_ratings where canonical_song_id=${sql(chart.originalCanonicalId)}::uuid) or
     exists(select 1 from public.historical_chart_entry_ratings where chart_entry_id=${chart.id}) or
     exists(select 1 from public.songs where canonical_song_id=${sql(chart.originalCanonicalId)}::uuid) then
    raise exception 'rated or non-empty placeholder for ${chart.id}';
  end if;
  if exists(select 1 from public.songs s where s.external_source='musicbrainz' and lower(s.external_id)=${sql(recordingId)}) or
     exists(select 1 from public.canonical_recordings c where lower(c.musicbrainz_recording_id)=${sql(recordingId)}) then
    raise exception 'duplicate recording or partial import for ${chart.id}';
  end if;
  ${albumMutation}
  update public.canonical_recordings c
  set musicbrainz_recording_id=${sql(recordingId)},origin_key=${sql(`musicbrainz:${recordingId}`)},updated_at=timezone('utc',now())
  where c.id=${sql(chart.originalCanonicalId)}::uuid
    and c.title=${sql(chart.title)}
    and c.artist=${sql(chart.artist)}
    and c.musicbrainz_recording_id is null
    and c.origin_key=${sql(`quick-rate:uk-number-ones:${chart.sourceEntryKey}`)};
  get diagnostics n=row_count; if n<>1 then raise exception 'canonical exact count failed for ${chart.id}'; end if;
  insert into public.songs(title,artist,album_id,track_position,external_source,external_id,canonical_song_id,duration_ms,is_deleted)
  values(${sql(entryTitle)},${sql(entryArtist)},v_album_id,${trackPosition},'musicbrainz',${sql(recordingId)},${sql(chart.originalCanonicalId)}::uuid,${durationMs},false) returning id into v_song_id;
  update public.quick_rate_collection_tracks q
  set song_id=v_song_id,canonical_song_id=${sql(chart.originalCanonicalId)}::uuid,musicbrainz_recording_id=${sql(recordingId)},match_status='direct_mbid',match_method='bulk_verified_release',match_notes='Verified official MusicBrainz source release',updated_at=timezone('utc',now())
  where ${chartPredicate(chart)};
  get diagnostics n=row_count; if n<>1 then raise exception 'chart exact count failed for ${chart.id}'; end if;
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
  if (process.argv.includes("--commit")) {
    throw new Error("Direct --commit is disabled. Use an independently reviewed, manifest-bound, approval-gated atomic operation.");
  }
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
    execution_policy: "reviewed_approval_gated_atomic_sql_only",
    safeguards: {
      maximum_batch_size: 25,
      transaction_scope: "review artifact only; this script never writes database rows",
      failure_policy: "production changes require a separately reviewed all-or-nothing operation",
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
    batches: batches.map(batch => ({ batch: batch.batch, records: batch.records.map(item => ({ chart_id: item.row.id, action: item.action })) })) };
  const planPath = resolve(option("plan-output", resolve(outputDir, "historical-uk-number-ones-bulk-plan.json")));
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(JSON.stringify(plan.summary, null, 2));
  console.log("Dry run only. No database rows were written; direct execution is disabled.");
}

if (typeof process !== "undefined" && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
