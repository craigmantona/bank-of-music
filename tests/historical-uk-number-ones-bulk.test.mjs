import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRows, createBatches, parseCsv, recordTransactionSql, summarise, toCsv
} from "../scripts/historical-uk-number-ones-bulk.mjs";

const chart = (overrides = {}) => ({
  id: 1, chart_year: 2009, artist: "Lady Gaga", title: "Bad Romance",
  match_status: "unresolved", song_id: null,
  canonical_song_id: "0a5b0716-545b-4171-8b00-03088aa43aa0",
  musicbrainz_recording_id: null, ...overrides
});

const candidate = (overrides = {}) => ({
  song_id: 19451, canonical_song_id: "0a5b0716-545b-4171-8b00-03088aa43aa0",
  external_source: "musicbrainz", external_id: "6926be9f-2405-4b68-9080-42410be08312",
  ...overrides
});

test("CSV reports preserve commas and quotes", () => {
  const csv = toCsv([{ chart_id: 9, chart_year: 1968, artist: "Otis Redding", title: "(Sittin' On) The Dock, of the Bay", reason: "needs \"review\"", candidate_identifiers: "song:1" }]);
  const [row] = parseCsv(csv);
  assert.equal(row.title, "(Sittin' On) The Dock, of the Bay");
  assert.equal(row.reason, 'needs "review"');
});

test("only a unique identity-compatible existing BOM recording is SAFE", () => {
  const snapshot = { rows: [chart()], existing_matches: { "1": [candidate(), candidate()] } };
  const [safe] = classifyRows(snapshot, []);
  assert.equal(safe.category, "SAFE");
  assert.equal(safe.action, "link_existing");

  const conflicting = { ...snapshot, existing_matches: { "1": [candidate({ canonical_song_id: "11111111-1111-4111-8111-111111111111" })] } };
  assert.equal(classifyRows(conflicting, [])[0].category, "REVIEW");

  const ambiguous = { ...snapshot, existing_matches: { "1": [candidate(), candidate({ song_id: 99 })] } };
  assert.equal(classifyRows(ambiguous, [])[0].category, "REVIEW");
});

test("an empty unrated placeholder may safely relink to a verified existing canonical", () => {
  const row = chart({ canonical_song_id: "c9ae11d8-ca81-4a23-ba5c-6ae72d00d5d8" });
  const base = { rows: [row], existing_matches: { "1": [candidate()] } };
  assert.equal(classifyRows(base, [])[0].category, "REVIEW");
  base.canonical_placeholders = {
    "c9ae11d8-ca81-4a23-ba5c-6ae72d00d5d8": { musicbrainz_recording_id: null, rating_rows: 0, song_occurrences: 0 }
  };
  const [safe] = classifyRows(base, []);
  assert.equal(safe.category, "SAFE");
  assert.equal(safe.replace_placeholder, true);
  const sql = recordTransactionSql(safe);
  assert.match(sql, /placeholder canonical precondition failed/);
  assert.match(sql, /song_ratings/);
  assert.match(sql, /placeholder canonical is no longer empty/);
});

test("seeded ambiguities stay REVIEW and unsupported rows stay UNAVAILABLE", () => {
  const rows = [chart(), chart({ id: 2, artist: "Unknown", title: "Missing" })];
  const classified = classifyRows({ rows, existing_matches: {} }, [{ chart_row_id: "1", ambiguity_reason: "artist conflict", candidate_summary: "song:44" }]);
  assert.deepEqual(classified.map(item => item.category), ["REVIEW", "UNAVAILABLE"]);
  assert.match(classified[0].candidate_identifiers, /song:44/);
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
  const item = classifyRows({ rows: [chart()], existing_matches: { "1": [candidate()] } }, [])[0];
  const sql = recordTransactionSql(item);
  assert.match(sql, /^begin;/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /for update/);
  assert.match(sql, /row_count/);
  assert.match(sql, /n<>1/);
  assert.match(sql, /commit;\s*$/);
});

test("partial release dates never become invented PostgreSQL dates", () => {
  const item = {
    category: "SAFE", action: "import_verified", row: chart(), release: { date: "2005" },
    verified: {
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
