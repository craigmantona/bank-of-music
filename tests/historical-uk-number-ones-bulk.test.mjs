import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  classifyRows, createBatches, parseCsv, recordTransactionSql, summarise, toCsv
} from "../scripts/historical-uk-number-ones-bulk.mjs";

const chart = (overrides = {}) => ({
  id: 1, chart_year: 2009, artist: "Lady Gaga", title: "Bad Romance",
  collection_key: "uk-number-ones",
  source_entry_key: "2009:1000:lady gaga:bad romance",
  match_status: "unresolved", song_id: null,
  canonical_song_id: "0a5b0716-545b-4171-8b00-03088aa43aa0",
  musicbrainz_recording_id: null, ...overrides
});

test("legacy historical workflows reject direct commit before any input or output", async () => {
  for (const relative of [
    "../scripts/historical-uk-number-ones-bulk.mjs",
    "../scripts/historical-uk-number-ones-pilot.mjs"
  ]) {
    const url = new URL(relative, import.meta.url);
    const execution = spawnSync(process.execPath, [fileURLToPath(url), "--commit"], { encoding: "utf8" });
    assert.notEqual(execution.status, 0);
    assert.match(execution.stderr, /Direct --commit is disabled/);
    assert.doesNotMatch(execution.stderr, /--snapshot is required|BOM_DATABASE_URL/);

    const source = await readFile(url, "utf8");
    assert.doesNotMatch(source, /BOM_DATABASE_URL|spawnSync\(|PGDATABASE/);
  }

  const pilot = fileURLToPath(new URL("../scripts/historical-uk-number-ones-pilot.mjs", import.meta.url));
  const sqlOutput = spawnSync(process.execPath, [pilot, "--sql-output=/tmp/disabled-historical-operation.sql"], {
    encoding: "utf8"
  });
  assert.notEqual(sqlOutput.status, 0);
  assert.match(sqlOutput.stderr, /Direct SQL output is disabled/);
  assert.doesNotMatch(sqlOutput.stderr, /ENOENT|MusicBrainz/i);
});

const candidate = (overrides = {}) => ({
  title: "Bad Romance", artist: "Lady Gaga",
  song_id: 19451, canonical_song_id: "0a5b0716-545b-4171-8b00-03088aa43aa0",
  album_id: 1520,
  external_source: "musicbrainz", external_id: "6926be9f-2405-4b68-9080-42410be08312",
  musicbrainz_release_id: "b01c4fd4-5984-3e86-a96d-8c72fa9cf62e",
  musicbrainz_release_group_id: "20b4c8b3-e922-44a3-90e8-fa00acad8ed4",
  ...overrides
});

const targetAlbum = {
  id: 1520,
  title: "The Fame Monster",
  artist: "Lady Gaga",
  external_source: "musicbrainz",
  external_id: "b01c4fd4-5984-3e86-a96d-8c72fa9cf62e",
  musicbrainz_release_id: "b01c4fd4-5984-3e86-a96d-8c72fa9cf62e",
  musicbrainz_release_group_id: "20b4c8b3-e922-44a3-90e8-fa00acad8ed4",
  is_deleted: false
};

const placeholder = (overrides = {}) => ({
  musicbrainz_recording_id: null,
  canonical_rating_rows: 0,
  historical_rating_rows: 0,
  song_occurrences: 0,
  ...overrides
});

function snapshotWithPlaceholder(row = chart({ musicbrainz_recording_id: candidate().external_id }), overrides = {}) {
  return {
    rows: [row],
    existing_matches: { [String(row.id)]: [candidate()] },
    canonical_placeholders: { [String(row.canonical_song_id)]: placeholder(overrides) },
    albums: [targetAlbum]
  };
}

const verified = {
  chart_row_id: 1,
  chart_year: 2009,
  placeholder_canonical_id: "0a5b0716-545b-4171-8b00-03088aa43aa0",
  artist: "Lady Gaga",
  title: "Bad Romance",
  source_album_title: "The Fame Monster",
  source_album_artist: "Lady Gaga",
  source_release_country: "XW",
  source_release_mbid: "b01c4fd4-5984-3e86-a96d-8c72fa9cf62e",
  release_group_mbid: "20b4c8b3-e922-44a3-90e8-fa00acad8ed4",
  recording_mbid: "6926be9f-2405-4b68-9080-42410be08312",
  track_position: 1,
  duration_ms: 294504,
  duration_tolerance_ms: 5000,
  accepted_artist_credits: ["Lady Gaga"],
  version_note: "verified studio recording"
};

const verifiedRelease = {
  id: verified.source_release_mbid,
  status: "Official",
  title: verified.source_album_title,
  country: verified.source_release_country,
  "artist-credit": [{ name: "Lady Gaga" }],
  "release-group": { id: verified.release_group_mbid },
  media: [{ tracks: [{
    position: verified.track_position,
    title: verified.title,
    length: verified.duration_ms,
    "artist-credit": [{ name: "Lady Gaga" }],
    recording: {
      id: verified.recording_mbid,
      title: verified.title,
      disambiguation: "",
      "artist-credit": [{ name: "Lady Gaga" }]
    }
  }] }]
};

function releaseWithTrackTitle(title) {
  const medium = verifiedRelease.media[0];
  const track = medium.tracks[0];
  return {
    ...verifiedRelease,
    media: [{
      ...medium,
      tracks: [{ ...track, title, recording: { ...track.recording, title } }]
    }]
  };
}

function assertExactChartMutationGuards(sql, {
  recordingId = null,
  canonicalId = "0a5b0716-545b-4171-8b00-03088aa43aa0"
} = {}) {
  const marker = "update public.quick_rate_collection_tracks q\n";
  const start = sql.lastIndexOf(marker);
  assert.notEqual(start, -1, "guarded chart mutation is present");
  const mutation = sql.slice(start);
  assert.match(mutation, /where q\.id=1/);
  assert.match(mutation, /q\.collection_key='uk-number-ones'/);
  assert.match(mutation, /q\.source_entry_key='2009:1000:lady gaga:bad romance'/);
  assert.match(mutation, /q\.chart_year=2009/);
  assert.match(mutation, /q\.title='Bad Romance'/);
  assert.match(mutation, /q\.artist='Lady Gaga'/);
  assert.match(mutation, /q\.song_id is null/);
  assert.match(mutation, /q\.match_status='unresolved'/);
  assert.match(mutation, new RegExp(`q\\.canonical_song_id='${canonicalId}'::uuid`));
  if (recordingId === null) assert.match(mutation, /q\.musicbrainz_recording_id is null/);
  else assert.match(mutation, new RegExp(`lower\\(q\\.musicbrainz_recording_id\\)='${recordingId}'`));

  const lockAndMutationGuards = [
    ["row id", /where q\.id=1/g],
    ["collection", /q\.collection_key='uk-number-ones'/g],
    ["source entry", /q\.source_entry_key='2009:1000:lady gaga:bad romance'/g],
    ["year", /q\.chart_year=2009/g],
    ["title", /q\.title='Bad Romance'/g],
    ["artist", /q\.artist='Lady Gaga'/g],
    ["unlinked song", /q\.song_id is null/g],
    ["unresolved status", /q\.match_status='unresolved'/g],
    ["original canonical", new RegExp(`q\\.canonical_song_id='${canonicalId}'::uuid`, "g")],
    ["original recording", recordingId === null
      ? /q\.musicbrainz_recording_id is null/g
      : new RegExp(`lower\\(q\\.musicbrainz_recording_id\\)='${recordingId}'`, "g")]
  ];
  for (const [label, pattern] of lockAndMutationGuards) {
    const occurrences = sql.match(pattern)?.length || 0;
    if (label === "original canonical") {
      assert.ok(occurrences >= 2, `${label} is checked by both the lock and mutation`);
    } else {
      assert.equal(occurrences, 2, `${label} is checked by both the lock and mutation`);
    }
  }
}

test("CSV reports preserve commas and quotes", () => {
  const csv = toCsv([{ chart_id: 9, chart_year: 1968, artist: "Otis Redding", title: "(Sittin' On) The Dock, of the Bay", reason: "needs \"review\"", candidate_identifiers: "song:1" }]);
  const [row] = parseCsv(csv);
  assert.equal(row.title, "(Sittin' On) The Dock, of the Bay");
  assert.equal(row.reason, 'needs "review"');
});

test("only a unique identity-compatible existing BOM recording is SAFE", () => {
  const snapshot = snapshotWithPlaceholder();
  snapshot.existing_matches["1"].push(candidate());
  const [safe] = classifyRows(snapshot, []);
  assert.equal(safe.category, "SAFE");
  assert.equal(safe.action, "link_existing");

  const conflicting = {
    ...snapshot,
    existing_matches: { "1": [candidate({ canonical_song_id: "11111111-1111-4111-8111-111111111111" })] },
    canonical_placeholders: {
      [chart().canonical_song_id]: placeholder({ musicbrainz_recording_id: "22222222-2222-4222-8222-222222222222" })
    }
  };
  assert.equal(classifyRows(conflicting, [])[0].category, "REVIEW");

  const ambiguous = { ...snapshot, existing_matches: { "1": [candidate(), candidate({ song_id: 99 })] } };
  assert.equal(classifyRows(ambiguous, [])[0].category, "REVIEW");
});

test("unique title and artist is only SAFE with an exact authoritative chart MBID", () => {
  const withoutRecordingEvidence = snapshotWithPlaceholder(chart({ musicbrainz_recording_id: null }));
  const [review] = classifyRows(withoutRecordingEvidence, []);
  assert.equal(review.category, "REVIEW");
  assert.equal(review.reason, "existing_match_requires_authoritative_recording_evidence");

  const withExactRecordingEvidence = snapshotWithPlaceholder(chart({
    musicbrainz_recording_id: candidate().external_id
  }));
  const [safe] = classifyRows(withExactRecordingEvidence, []);
  assert.equal(safe.category, "SAFE");
  assert.equal(safe.action, "link_existing");

  const withDifferentRecordingEvidence = snapshotWithPlaceholder(chart({
    musicbrainz_recording_id: "11111111-1111-4111-8111-111111111111"
  }));
  const [conflict] = classifyRows(withDifferentRecordingEvidence, []);
  assert.equal(conflict.category, "REVIEW");
  assert.equal(conflict.reason, "existing_identity_conflict");
});

test("an empty unrated placeholder may safely relink to a verified existing canonical", () => {
  const row = chart({
    canonical_song_id: "c9ae11d8-ca81-4a23-ba5c-6ae72d00d5d8",
    musicbrainz_recording_id: candidate().external_id
  });
  const base = { rows: [row], existing_matches: { "1": [candidate()] } };
  const unknown = classifyRows(base, [])[0];
  assert.equal(unknown.category, "REVIEW");
  assert.equal(unknown.reason, "placeholder_safety_metadata_unknown");
  base.canonical_placeholders = {
    "c9ae11d8-ca81-4a23-ba5c-6ae72d00d5d8": placeholder()
  };
  const [safe] = classifyRows(base, []);
  assert.equal(safe.category, "SAFE");
  assert.equal(safe.replace_placeholder, true);
  const sql = recordTransactionSql(safe, { albums: [targetAlbum] });
  assert.match(sql, /placeholder canonical identity failed/);
  assert.match(sql, /song_ratings/);
  assert.match(sql, /historical_chart_entry_ratings/);
  assert.match(sql, /public\.songs where canonical_song_id=/);
  assert.match(sql, /placeholder canonical is no longer empty/);
  assertExactChartMutationGuards(sql, {
    recordingId: candidate().external_id,
    canonicalId: row.canonical_song_id
  });
  assert.match(sql, /s\.id=19451/);
  assert.match(sql, /s\.canonical_song_id='0a5b0716-545b-4171-8b00-03088aa43aa0'::uuid/);
  assert.match(sql, /lower\(s\.external_id\)='6926be9f-2405-4b68-9080-42410be08312'/);
  assert.match(sql, /lower\(c\.musicbrainz_recording_id\)='6926be9f-2405-4b68-9080-42410be08312'/);
  assert.match(sql, /a\.id=1520/);
  assert.match(sql, /lower\(a\.musicbrainz_release_id\)='b01c4fd4-5984-3e86-a96d-8c72fa9cf62e'/);
  assert.match(sql, /lower\(a\.musicbrainz_release_group_id\)='20b4c8b3-e922-44a3-90e8-fa00acad8ed4'/);
});

test("legacy or incomplete placeholder safety metadata is never treated as zero", () => {
  const row = chart({
    canonical_song_id: "c9ae11d8-ca81-4a23-ba5c-6ae72d00d5d8",
    musicbrainz_recording_id: candidate().external_id
  });
  const base = { rows: [row], existing_matches: { "1": [candidate()] } };
  for (const metadata of [
    { rating_rows: 0, song_occurrences: 0 },
    { canonical_rating_rows: 0, historical_rating_rows: 0 },
    { canonical_rating_rows: null, historical_rating_rows: 0, song_occurrences: 0 }
  ]) {
    const [result] = classifyRows({ ...base, canonical_placeholders: { [row.canonical_song_id]: metadata } }, []);
    assert.equal(result.category, "REVIEW");
    assert.equal(result.reason, "placeholder_safety_metadata_unknown");
  }
});

test("canonical, historical and occurrence counts remain distinct safety inputs", () => {
  const row = chart({
    canonical_song_id: "c9ae11d8-ca81-4a23-ba5c-6ae72d00d5d8",
    musicbrainz_recording_id: candidate().external_id
  });
  const base = { rows: [row], existing_matches: { "1": [candidate()] } };
  for (const field of ["canonical_rating_rows", "historical_rating_rows", "song_occurrences"]) {
    const [result] = classifyRows({
      ...base,
      canonical_placeholders: { [row.canonical_song_id]: placeholder({ [field]: 1 }) }
    }, []);
    assert.equal(result.category, "REVIEW");
    assert.equal(result.reason, field === "historical_rating_rows"
      ? "historical_ratings_require_reconciliation"
      : "existing_identity_conflict");
  }
});

test("verified imports require complete zero-valued placeholder safety metadata", () => {
  const base = { rows: [chart()], existing_matches: {} };
  const releases = { [verified.source_release_mbid]: verifiedRelease };
  const unknown = classifyRows(base, [], [verified], releases)[0];
  assert.equal(unknown.category, "REVIEW");
  assert.equal(unknown.reason, "placeholder_safety_metadata_unknown");

  const safeSnapshot = {
    ...base,
    canonical_placeholders: { [chart().canonical_song_id]: placeholder() }
  };
  const safe = classifyRows(safeSnapshot, [], [verified], releases)[0];
  assert.equal(safe.category, "SAFE");
  assert.equal(safe.action, "import_verified");

  for (const field of ["canonical_rating_rows", "historical_rating_rows", "song_occurrences"]) {
    const blocked = classifyRows({
      ...safeSnapshot,
      canonical_placeholders: { [chart().canonical_song_id]: placeholder({ [field]: 1 }) }
    }, [], [verified], releases)[0];
    assert.equal(blocked.category, "REVIEW");
    assert.equal(blocked.reason, "rated_or_nonempty_placeholder");
  }
});

test("cached release evidence cannot rebind a manifest to another chart identity", () => {
  const row = chart();
  const snapshot = {
    rows: [row],
    existing_matches: {},
    canonical_placeholders: { [row.canonical_song_id]: placeholder() }
  };
  const cases = [
    {
      manifest: { ...verified, title: "Poker Face" },
      release: releaseWithTrackTitle("Poker Face")
    },
    {
      manifest: { ...verified, artist: "Stefani Germanotta" },
      release: verifiedRelease
    },
    {
      manifest: { ...verified, chart_year: 2010 },
      release: verifiedRelease
    },
    {
      manifest: { ...verified, placeholder_canonical_id: "11111111-1111-4111-8111-111111111111" },
      release: verifiedRelease
    }
  ];
  for (const { manifest, release } of cases) {
    const [result] = classifyRows(snapshot, [], [manifest], {
      [manifest.source_release_mbid]: release
    });
    assert.equal(result.category, "REVIEW");
    assert.equal(result.reason, "verified_chart_identity_mismatch");
  }
});

test("duplicate verified manifest entries for one chart row fail closed", () => {
  const row = chart();
  const snapshot = {
    rows: [row],
    existing_matches: {},
    canonical_placeholders: { [row.canonical_song_id]: placeholder() }
  };
  const [result] = classifyRows(snapshot, [], [
    verified,
    {
      ...verified,
      recording_mbid: "11111111-1111-4111-8111-111111111111",
      source_release_mbid: "22222222-2222-4222-8222-222222222222"
    }
  ], { [verified.source_release_mbid]: verifiedRelease });
  assert.equal(result.category, "REVIEW");
  assert.equal(result.reason, "multiple_verified_manifest_entries");
});

test("seeded ambiguities stay REVIEW and unsupported rows stay UNAVAILABLE", () => {
  const rows = [chart(), chart({ id: 2, artist: "Unknown", title: "Missing" })];
  const classified = classifyRows({ rows, existing_matches: {} }, [{ chart_row_id: "1", ambiguity_reason: "artist conflict", candidate_summary: "song:44" }]);
  assert.deepEqual(classified.map(item => item.category), ["REVIEW", "UNAVAILABLE"]);
  assert.match(classified[0].candidate_identifiers, /song:44/);
});

test("a seeded review vetoes SAFE even when exactly one existing candidate matches", () => {
  const snapshot = snapshotWithPlaceholder();
  const [result] = classifyRows(snapshot, [{
    chart_row_id: "1",
    ambiguity_reason: "historical version remains ambiguous",
    candidate_summary: "manual-review:version"
  }]);
  assert.equal(result.category, "REVIEW");
  assert.equal(result.reason, "historical version remains ambiguous");
  assert.match(result.candidate_identifiers, /song:19451/);
  assert.match(result.candidate_identifiers, /manual-review:version/);
});

test("verified discovery evidence applies only to its reviewed chart row ID", () => {
  const rows = [chart({ id: 10 }), chart({ id: 11 })];
  const verified = [{ chart_row_id: 10, artist: "Lady Gaga", title: "Bad Romance", source_release_mbid: "release" }];
  const classified = classifyRows({ rows, existing_matches: {} }, [], verified, {});
  assert.equal(classified[0].category, "REVIEW");
  assert.match(classified[0].reason, /release response is not cached/);
  assert.equal(classified[1].category, "UNAVAILABLE");
});

test("batches are bounded at 25 records", () => {
  assert.deepEqual(createBatches(Array.from({ length: 51 }, (_, id) => ({ id }))).map(batch => batch.records.length), [25, 25, 1]);
  assert.throws(() => createBatches([], 26), /between 1 and 25/);
});

test("each SAFE record has an independent locked and exact-count transaction", () => {
  const snapshot = snapshotWithPlaceholder();
  const item = classifyRows(snapshot, [])[0];
  const sql = recordTransactionSql(item, snapshot);
  assert.match(sql, /^begin;/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /for update/);
  assert.match(sql, /row_count/);
  assert.match(sql, /n<>1/);
  assert.match(sql, /historical_chart_entry_ratings/);
  assert.match(sql, /commit;\s*$/);
  assertExactChartMutationGuards(sql, { recordingId: candidate().external_id });
});

test("guard generation fails closed when original identity metadata is absent", () => {
  const snapshot = snapshotWithPlaceholder();
  delete snapshot.rows[0].source_entry_key;
  const item = classifyRows(snapshot, [])[0];
  assert.throws(() => recordTransactionSql(item, snapshot), /source_entry_key is required/);

  const second = snapshotWithPlaceholder();
  delete second.rows[0].musicbrainz_recording_id;
  const secondItem = classifyRows(second, [])[0];
  assert.throws(() => recordTransactionSql(secondItem, second), /original recording identity is required/);

  const mismatchedImport = {
    category: "SAFE",
    action: "import_verified",
    row: chart({ musicbrainz_recording_id: "11111111-1111-4111-8111-111111111111" }),
    release: verifiedRelease,
    verified
  };
  assert.throws(() => recordTransactionSql(mismatchedImport), /does not match the chart recording identity/);
});

test("a non-null original recording identity is revalidated in the chart mutation", () => {
  const recordingId = "6926be9f-2405-4b68-9080-42410be08312";
  const snapshot = snapshotWithPlaceholder(chart({ musicbrainz_recording_id: recordingId }));
  const item = classifyRows(snapshot, [])[0];
  const sql = recordTransactionSql(item, snapshot);
  assertExactChartMutationGuards(sql, { recordingId });
});

test("partial release dates never become invented PostgreSQL dates", () => {
  const item = {
    category: "SAFE", action: "import_verified", row: chart(), release: { date: "2005" },
    verified: {
      chart_row_id: 1,
      chart_year: 2009,
      placeholder_canonical_id: "0a5b0716-545b-4171-8b00-03088aa43aa0",
      artist: "Lady Gaga", title: "Bad Romance", source_album_title: "The Fame Monster",
      source_release_country: "XW", source_release_mbid: "b01c4fd4-5984-3e86-a96d-8c72fa9cf62e",
      release_group_mbid: "20b4c8b3-e922-44a3-90e8-fa00acad8ed4",
      recording_mbid: "6926be9f-2405-4b68-9080-42410be08312", track_position: 1, duration_ms: 294504
    }
  };
  const sql = recordTransactionSql(item);
  assert.doesNotMatch(sql, /2005-01-01/);
  assert.match(sql, /,null,null,'XW'/);
  assert.match(sql, /song_ratings/);
  assert.match(sql, /historical_chart_entry_ratings/);
  assert.match(sql, /public\.songs where canonical_song_id=/);
  assertExactChartMutationGuards(sql);
  assert.match(sql, /duplicate recording or partial import/);
  assert.match(sql, /exists\(select 1 from public\.canonical_recordings c where lower\(c\.musicbrainz_recording_id\)=/);
  assert.match(sql, /duplicate release or partial import/);
  assert.match(sql, /lower\(a\.musicbrainz_release_id\)='b01c4fd4-5984-3e86-a96d-8c72fa9cf62e'/);
  assert.match(sql, /lower\(a\.musicbrainz_release_group_id\)='20b4c8b3-e922-44a3-90e8-fa00acad8ed4'/);
  assert.match(sql, /bom-admin-catalogue:20b4c8b3-e922-44a3-90e8-fa00acad8ed4/);
  assert.match(sql, /lock table public\.quick_rate_collection_tracks in exclusive mode;[\s\S]*lock table public\.albums in share row exclusive mode;[\s\S]*lock table public\.canonical_recordings in share row exclusive mode;[\s\S]*lock table public\.songs in share row exclusive mode;[\s\S]*lock table public\.song_ratings in share row exclusive mode;[\s\S]*lock table public\.historical_chart_entry_ratings in share row exclusive mode;/);
  assert.match(sql, /c\.origin_key='quick-rate:uk-number-ones:2009:1000:lady gaga:bad romance'/);
  assert.match(sql, /where q\.canonical_song_id='0a5b0716-545b-4171-8b00-03088aa43aa0'::uuid/);
  assert.match(sql, /v_chart_reference_count<>1/);
  assert.match(sql, /placeholder chart reference count failed/);
});

test("reviewed album reuse locks exact release and release-group provenance", () => {
  const item = {
    category: "SAFE",
    action: "import_verified",
    row: chart(),
    release: verifiedRelease,
    verified
  };
  const sql = recordTransactionSql(item, { albums: [targetAlbum] });
  assert.match(sql, /where a\.id=1520/);
  assert.match(sql, /a\.title='The Fame Monster'/);
  assert.match(sql, /a\.artist='Lady Gaga'/);
  assert.match(sql, /lower\(a\.musicbrainz_release_id\)='b01c4fd4-5984-3e86-a96d-8c72fa9cf62e'/);
  assert.match(sql, /lower\(a\.musicbrainz_release_group_id\)='20b4c8b3-e922-44a3-90e8-fa00acad8ed4'/);
  assert.match(sql, /for update/);
  assert.match(sql, /a\.id<>v_album_id/);
  assert.doesNotMatch(sql, /insert into public\.albums/);
  assertExactChartMutationGuards(sql);
});

test("summary counts catalogue additions separately from historical links", () => {
  const classified = [
    { category: "SAFE", action: "link_existing" },
    { category: "REVIEW" },
    { category: "UNAVAILABLE" }
  ];
  assert.deepEqual(summarise(classified), {
    total: 3, SAFE: 1, REVIEW: 1, UNAVAILABLE: 1,
    expected: { album_inserts: 0, canonical_attachments: 0, song_occurrences: 0, historical_links: 1 }
  });
});
