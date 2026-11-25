import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { stableJson } from "../../scripts/historical-uk-number-ones-reconciliation-workflow.mjs";
import { psqlArguments } from "../../scripts/historical-uk-number-ones-production-executor.mjs";

const require = createRequire(process.env.CATALOGUE_TEST_PACKAGE || import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const load = async url => readFile(new URL(url, import.meta.url), "utf8");
const bundle = JSON.parse(await load("../operations/historical-uk-number-ones-scalable-executor-bundle-20261124.json"));
const applySource = await load("../operations/20261124_apply_scalable_uk_number_ones_record.sql");
const rollbackSource = await load("../operations/20261124_rollback_scalable_uk_number_ones_record.sql");
const runnerSource = await load("../../scripts/historical-uk-number-ones-production-executor.mjs");
const ZERO_SHA = "0".repeat(64);

function operationSql(source, record, mode, baseline = {}, options = {}) {
  const input = { bundle_sha256: bundle.bundle_sha256, executor_operation_key: bundle.operation_key, record };
  const transport = Object.hasOwn(options, "executionTransport")
    ? options.executionTransport : "direct-postgres-psql-v1";
  if (transport !== undefined) input.execution_transport = transport;
  const raw = stableJson(input);
  const base64 = Buffer.from(raw).toString("base64");
  const expectedToken = `${mode}:${bundle.operation_key}:${bundle.bundle_sha256}:${ZERO_SHA}`;
  const approvalToken = Object.hasOwn(options, "approvalToken") ? options.approvalToken : expectedToken;
  const approvalSql = approvalToken == null ? "null" : `'${String(approvalToken).replaceAll("'", "''")}'`;
  return source
    .replace(/^\\set ON_ERROR_STOP on\s*/m, "")
    .replace(":'record_base64'", `'${base64}'`)
    .replace(":'approval_token'", approvalSql)
    .replace("479 + v_applied", "0 + v_applied")
    .replace("819 - v_applied", "1 - v_applied")
    .replace("<> 1298", "<> 1")
    .replace("16219 + v_imported", `${baseline.songs || 0} + v_imported`)
    .replace("1786 + v_created_albums", `${baseline.albums || 0} + v_created_albums`)
    .replace("<> 17095", `<> ${baseline.canonical || 1}`)
    .replace("<> 1747", `<> ${baseline.ratingRows || 1}`)
    .replace("<> 13454", `<> ${baseline.ratingSum || 7}`)
    .replace("<> 5", "<> 1")
    .replace("<> 43", "<> 6");
}

async function fixture(record) {
  const db = new PGlite();
  await db.exec(`
    create schema extensions;
    create function extensions.digest(text, text) returns bytea language sql immutable
      as $$ select pg_catalog.decode(repeat('0', 64), 'hex') $$;
    create schema private;
    create table public.canonical_recordings (
      id uuid primary key, title text not null, artist text not null, musicbrainz_recording_id text,
      origin_key text, source_metadata jsonb, updated_at timestamptz not null
    );
    create table public.albums (
      id bigint generated always as identity primary key, title text not null, artist text not null,
      external_source text, external_id text, musicbrainz_release_id text,
      musicbrainz_release_group_id text, cover_art_url text, release_date date,
      canonical_release_date date, canonical_release_country text,
      catalogue_selection_version integer, is_deleted boolean default false
    );
    create table public.songs (
      id bigint generated always as identity primary key, title text not null, artist text not null,
      album_id bigint references public.albums(id), track_position integer, external_source text,
      external_id text, canonical_song_id uuid references public.canonical_recordings(id),
      duration_ms integer, is_deleted boolean default false, unique(album_id, track_position)
    );
    create table public.quick_rate_collection_tracks (
      id bigint primary key, collection_key text not null, source_entry_key text not null,
      chart_year integer not null, title text not null, artist text not null, song_id bigint,
      canonical_song_id uuid references public.canonical_recordings(id), musicbrainz_recording_id text,
      match_status text not null, match_method text, match_notes text, updated_at timestamptz not null
    );
    create table public.song_ratings (id bigint primary key, canonical_song_id uuid, song_id bigint, rating integer);
    create table public.historical_chart_entry_ratings (id bigint primary key, chart_entry_id bigint, rating integer);
    create table private.historical_chart_rating_reconciliation_audit (id bigint primary key, evidence jsonb);
    create table private.historical_chart_reconciliation_operation_audit (
      id bigint generated always as identity primary key, operation_key text not null, event_kind text not null,
      manifest_sha256 text not null, chart_entry_id bigint not null, source_entry_key text not null,
      action text not null, placeholder_canonical_song_id uuid not null, target_canonical_song_id uuid not null,
      target_song_id bigint, target_album_id bigint, musicbrainz_recording_id text not null,
      musicbrainz_release_id text not null, musicbrainz_release_group_id text not null,
      evidence_sha256 text not null, before_state jsonb not null, after_state jsonb not null,
      unique(operation_key, event_kind, chart_entry_id)
    );
    insert into public.canonical_recordings values (
      '${record.mutation_payload.placeholder_canonical_id}', '${record.chart.title.replaceAll("'", "''")}',
      '${record.chart.artist.replaceAll("'", "''")}', null,
      'quick-rate:uk-number-ones:${record.preconditions.source_entry_key.replaceAll("'", "''")}', '{}',
      '${record.chart.canonical_updated_at}'
    );
    insert into public.quick_rate_collection_tracks values (
      ${record.mutation_payload.chart_row_id}, 'uk-number-ones', '${record.preconditions.source_entry_key.replaceAll("'", "''")}',
      ${record.chart.chart_year}, '${record.chart.title.replaceAll("'", "''")}', '${record.chart.artist.replaceAll("'", "''")}',
      null, '${record.mutation_payload.placeholder_canonical_id}', null, 'unresolved', null, null, '${record.chart.updated_at}'
    );
    insert into public.song_ratings values (1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 7);
    insert into public.historical_chart_entry_ratings values (1, 999999, 6);
    insert into private.historical_chart_rating_reconciliation_audit values (1, '{"status":"preserved"}');
  `);
  return db;
}

test("runner passes the digest-bound token explicitly and SQL scopes it to the record transaction", () => {
  const args = psqlArguments("service=bom_musicdb", "/reviewed/apply.sql", { base64: "payload" }, "apply:operation:bundle:record");
  assert.deepEqual(args, [
    "service=bom_musicdb", "-X", "--set", "ON_ERROR_STOP=1",
    "--set", "record_base64=payload",
    "--set", "approval_token=apply:operation:bundle:record",
    "--file", "/reviewed/apply.sql"
  ]);
  assert.doesNotMatch(runnerSource, /PGOPTIONS/);
  for (const source of [applySource, rollbackSource]) {
    assert.match(source, /begin;[\s\S]*set_config\(\s*'bom\.approved_historical_reconciliation',\s*:'approval_token',\s*true\s*\);/i);
    assert.ok(source.indexOf("set_config(") < source.indexOf("create temporary table bom_executor_input"));
  }
});

test("missing, NULL or incorrect explicit approval tokens fail before database changes", async () => {
  const record = bundle.records.find(item => item.mutation_payload.action === "import_verified" && item.mutation_payload.reuse_album_id === null);
  for (const approvalToken of [undefined, null, "apply:wrong:bundle:record"]) {
    const db = await fixture(record);
    try {
      await assert.rejects(
        db.exec(operationSql(applySource, record, "apply", {}, { approvalToken })),
        /approval token missing or does not bind/
      );
      await db.exec("rollback");
      assert.equal((await db.query("select count(*)::int count from public.songs")).rows[0].count, 0);
      assert.equal((await db.query("select count(*)::int count from private.historical_chart_reconciliation_operation_audit")).rows[0].count, 0);
      assert.equal((await db.query("select match_status from public.quick_rate_collection_tracks")).rows[0].match_status, "unresolved");
    } finally {
      await db.close();
    }
  }
});

test("missing or NULL execution transport fails closed before database changes", async () => {
  const record = bundle.records.find(item => item.mutation_payload.action === "import_verified" && item.mutation_payload.reuse_album_id === null);
  for (const [source, mode] of [[applySource, "apply"], [rollbackSource, "rollback"]]) {
    for (const executionTransport of [undefined, null]) {
      const db = await fixture(record);
      try {
        await assert.rejects(
          db.exec(operationSql(source, record, mode, {}, { executionTransport })),
          /executor envelope shape failed/
        );
        await db.exec("rollback");
        assert.equal((await db.query("select count(*)::int count from public.songs")).rows[0].count, 0);
        assert.equal((await db.query("select count(*)::int count from private.historical_chart_reconciliation_operation_audit")).rows[0].count, 0);
        assert.equal((await db.query("select match_status from public.quick_rate_collection_tracks")).rows[0].match_status, "unresolved");
      } finally {
        await db.close();
      }
    }
  }
});

test("a reviewed import applies once, preserves ratings and rolls back exactly", async () => {
  const record = bundle.records.find(item => item.mutation_payload.action === "import_verified" && item.mutation_payload.reuse_album_id === null);
  const db = await fixture(record);
  try {
    const ratingsBefore = (await db.query("select * from public.song_ratings order by id")).rows;
    const historicalBefore = (await db.query("select * from public.historical_chart_entry_ratings order by id")).rows;
    await db.exec(operationSql(applySource, record, "apply"));
    assert.equal((await db.query("select count(*)::int count from public.songs")).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::int count from public.albums")).rows[0].count, 1);
    assert.equal((await db.query("select match_status from public.quick_rate_collection_tracks")).rows[0].match_status, "direct_mbid");
    assert.equal((await db.query("select count(*)::int count from private.historical_chart_reconciliation_operation_audit where event_kind='apply'")).rows[0].count, 1);
    assert.deepEqual((await db.query("select * from public.song_ratings order by id")).rows, ratingsBefore);
    assert.deepEqual((await db.query("select * from public.historical_chart_entry_ratings order by id")).rows, historicalBefore);
    await db.exec(operationSql(applySource, record, "apply"));
    assert.equal((await db.query("select count(*)::int count from public.songs")).rows[0].count, 1);
    await db.exec(operationSql(rollbackSource, record, "rollback"));
    assert.equal((await db.query("select count(*)::int count from public.songs")).rows[0].count, 0);
    assert.equal((await db.query("select count(*)::int count from public.albums")).rows[0].count, 0);
    assert.equal((await db.query("select match_status from public.quick_rate_collection_tracks")).rows[0].match_status, "unresolved");
    assert.equal((await db.query("select count(*)::int count from private.historical_chart_reconciliation_operation_audit where event_kind='rollback'")).rows[0].count, 1);
    assert.deepEqual((await db.query("select * from public.song_ratings order by id")).rows, ratingsBefore);
  } finally {
    await db.close();
  }
});

test("reviewed partial release dates preserve source precision without inventing a database date", async () => {
  const record = bundle.records.find(item => item.mutation_payload.action === "import_verified" &&
    item.mutation_payload.reuse_album_id === null && item.evidence.release_date.length < 10 &&
    /(?:year|month) precision/i.test(item.evidence.risk_notes));
  assert.ok(record);
  const db = await fixture(record);
  try {
    await db.exec(operationSql(applySource, record, "apply"));
    const album = (await db.query("select release_date, canonical_release_date from public.albums")).rows[0];
    assert.deepEqual(album, { release_date: null, canonical_release_date: null });
    assert.ok(record.evidence.release_date.length === 4 || record.evidence.release_date.length === 7);
    await db.exec(operationSql(rollbackSource, record, "rollback"));
    assert.equal((await db.query("select count(*)::int count from public.albums")).rows[0].count, 0);
  } finally {
    await db.close();
  }
});

test("partial dates without reviewed disclosure and malformed dates fail before database changes", async () => {
  const source = bundle.records.find(item => item.mutation_payload.action === "import_verified" &&
    item.mutation_payload.reuse_album_id === null && item.evidence.release_date.length < 10 &&
    /(?:year|month) precision/i.test(item.evidence.risk_notes));
  assert.ok(source);
  const cases = [
    [structuredClone(source), /partial release date risk is not disclosed/],
    [structuredClone(source), /reviewed release date shape failed/]
  ];
  cases[0][0].evidence.risk_notes = "Selected-track import only.";
  cases[1][0].evidence.release_date = "1975-13";
  for (const [record, expected] of cases) {
    const db = await fixture(record);
    try {
      await assert.rejects(db.exec(operationSql(applySource, record, "apply")), expected);
      await db.exec("rollback");
      assert.equal((await db.query("select count(*)::int count from public.albums")).rows[0].count, 0);
      assert.equal((await db.query("select count(*)::int count from public.songs")).rows[0].count, 0);
      assert.equal((await db.query("select match_status from public.quick_rate_collection_tracks")).rows[0].match_status, "unresolved");
      assert.equal((await db.query("select count(*)::int count from private.historical_chart_reconciliation_operation_audit")).rows[0].count, 0);
    } finally {
      await db.close();
    }
  }
});

test("an occupied reviewed album position fails without overwriting the existing track", async () => {
  const record = bundle.records.find(item => item.mutation_payload.chart_row_id === 1812);
  assert.ok(record?.mutation_payload.reuse_album_id);
  const occupantCanonical = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const db = await fixture(record);
  try {
    await db.exec(`
      insert into public.canonical_recordings values ('${occupantCanonical}', 'Existing track', 'Lady Gaga',
        '00000000-0000-4000-8000-000000000010', 'musicbrainz:00000000-0000-4000-8000-000000000010', '{}', timezone('utc', now()));
      insert into public.albums(id, title, artist, external_source, external_id, musicbrainz_release_id,
        musicbrainz_release_group_id, release_date, canonical_release_date, canonical_release_country,
        catalogue_selection_version, is_deleted) overriding system value
      values (${record.mutation_payload.reuse_album_id}, 'The Fame', 'Lady Gaga', 'musicbrainz',
        '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011',
        '${record.mutation_payload.release_group_mbid}', '2008-10-28', '2008-10-28', 'GB', 1, false);
      insert into public.songs(title, artist, album_id, track_position, external_source, external_id,
        canonical_song_id, duration_ms, is_deleted)
      values ('Beautiful, Dirty, Rich', 'Lady Gaga', ${record.mutation_payload.reuse_album_id},
        ${record.mutation_payload.track_position}, 'musicbrainz', '00000000-0000-4000-8000-000000000010',
        '${occupantCanonical}', 172000, false);
    `);
    await assert.rejects(
      db.exec(operationSql(applySource, record, "apply", { songs: 1, albums: 1, canonical: 2 })),
      /reviewed album track position occupied/
    );
    await db.exec("rollback");
    const occupant = (await db.query("select title, external_id from public.songs")).rows[0];
    assert.deepEqual(occupant, { title: "Beautiful, Dirty, Rich", external_id: "00000000-0000-4000-8000-000000000010" });
    assert.equal((await db.query("select match_status from public.quick_rate_collection_tracks")).rows[0].match_status, "unresolved");
    assert.equal((await db.query("select count(*)::int count from private.historical_chart_reconciliation_operation_audit")).rows[0].count, 0);
  } finally {
    await db.close();
  }
});

test("a newly rated placeholder fails without partial catalogue changes", async () => {
  const record = bundle.records.find(item => item.mutation_payload.action === "import_verified" && item.mutation_payload.reuse_album_id === null);
  const db = await fixture(record);
  try {
    await db.exec(`insert into public.song_ratings values (2, '${record.mutation_payload.placeholder_canonical_id}', null, 9)`);
    await assert.rejects(db.exec(operationSql(applySource, record, "apply")), /production baseline is stale|rated, shared or non-empty/);
    await db.exec("rollback");
    assert.equal((await db.query("select count(*)::int count from public.songs")).rows[0].count, 0);
    assert.equal((await db.query("select match_status from public.quick_rate_collection_tracks")).rows[0].match_status, "unresolved");
  } finally {
    await db.close();
  }
});

test("a reviewed release-group album is reused without creating or deleting an album", async () => {
  const record = bundle.records.find(item => item.mutation_payload.action === "import_verified" && item.mutation_payload.reuse_album_id !== null);
  const db = await fixture(record);
  try {
    await db.exec(`
      insert into public.albums(id, title, artist, external_source, external_id, musicbrainz_release_id,
        musicbrainz_release_group_id, release_date, canonical_release_date, canonical_release_country,
        catalogue_selection_version, is_deleted) overriding system value
      values (${record.mutation_payload.reuse_album_id}, 'Reviewed existing album', 'Reviewed artist', 'musicbrainz',
        '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
        '${record.mutation_payload.release_group_mbid}', '2009-01-01', '2009-01-01', 'GB', 1, false)
    `);
    await db.exec(operationSql(applySource, record, "apply", { albums: 1 }));
    assert.equal((await db.query("select count(*)::int count from public.albums")).rows[0].count, 1);
    assert.equal((await db.query("select album_id from public.songs")).rows[0].album_id, record.mutation_payload.reuse_album_id);
    await db.exec(operationSql(rollbackSource, record, "rollback", { albums: 1 }));
    assert.equal((await db.query("select count(*)::int count from public.albums")).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::int count from public.songs")).rows[0].count, 0);
  } finally {
    await db.close();
  }
});

test("an exact existing recording is linked and rolled back without touching its rating", async () => {
  const record = bundle.records.find(item => item.mutation_payload.action === "link_existing");
  const targetCanonical = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const db = await fixture(record);
  try {
    await db.exec(`
      insert into public.canonical_recordings values ('${targetCanonical}', '${record.chart.title.replaceAll("'", "''")}',
        '${record.chart.artist.replaceAll("'", "''")}', '${record.mutation_payload.recording_mbid}',
        'musicbrainz:${record.mutation_payload.recording_mbid}', '{}', timezone('utc', now()));
      insert into public.albums(id, title, artist, external_source, external_id, musicbrainz_release_id,
        musicbrainz_release_group_id, release_date, canonical_release_date, canonical_release_country,
        catalogue_selection_version, is_deleted) overriding system value
      values (99, 'Existing official album', 'Existing artist', 'musicbrainz',
        '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003', '2010-01-01', '2010-01-01', 'GB', 1, false);
      insert into public.songs(id, title, artist, album_id, track_position, external_source, external_id,
        canonical_song_id, duration_ms, is_deleted) overriding system value
      values (${record.mutation_payload.existing_song_id}, '${record.chart.title.replaceAll("'", "''")}',
        '${record.chart.artist.replaceAll("'", "''")}', 99, 1, 'musicbrainz',
        '${record.mutation_payload.recording_mbid}', '${targetCanonical}', ${record.evidence.duration_ms}, false);
      insert into public.song_ratings values (2, '${targetCanonical}', ${record.mutation_payload.existing_song_id}, 8);
    `);
    await db.exec(operationSql(applySource, record, "apply", { songs: 1, albums: 1, canonical: 2, ratingRows: 2, ratingSum: 15 }));
    const linked = (await db.query("select song_id, canonical_song_id, match_status from public.quick_rate_collection_tracks")).rows[0];
    assert.deepEqual(linked, { song_id: record.mutation_payload.existing_song_id, canonical_song_id: targetCanonical, match_status: "direct_mbid" });
    assert.equal((await db.query("select count(*)::int count from public.song_ratings")).rows[0].count, 2);
    await db.exec(operationSql(rollbackSource, record, "rollback", { songs: 1, albums: 1, canonical: 2, ratingRows: 2, ratingSum: 15 }));
    const restored = (await db.query("select song_id, canonical_song_id, match_status from public.quick_rate_collection_tracks")).rows[0];
    assert.deepEqual(restored, { song_id: null, canonical_song_id: record.mutation_payload.placeholder_canonical_id, match_status: "unresolved" });
    assert.equal((await db.query("select count(*)::int count from public.song_ratings")).rows[0].count, 2);
    assert.equal((await db.query("select count(*)::int count from public.songs")).rows[0].count, 1);
  } finally {
    await db.close();
  }
});
