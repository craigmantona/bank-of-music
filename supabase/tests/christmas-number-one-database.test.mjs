import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";

const require = createRequire(process.env.CATALOGUE_TEST_PACKAGE || import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const migration = readFileSync(new URL("../migrations/20261119120000_bom_christmas_number_one.sql", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../../christmas-100.json", import.meta.url), "utf8"));

const ADMIN = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const MEMBER_2 = "33333333-3333-4333-8333-333333333333";
const MEMBER_3 = "44444444-4444-4444-8444-444444444444";
const MEMBER_4 = "55555555-5555-4555-8555-555555555555";
const NO_PROFILE = "66666666-6666-4666-8666-666666666666";
const MEMBER_5 = "77777777-7777-4777-8777-777777777777";
const MEMBER_6 = "88888888-8888-4888-8888-888888888888";
let db;
let candidates;

async function asUser(userId, sql, values = []) {
  await db.exec(`set role authenticated; set "request.jwt.claim.sub"='${userId}'`);
  try { return await db.query(sql, values); }
  finally { await db.exec('reset role; reset "request.jwt.claim.sub"'); }
}

async function clock(value) {
  await db.exec(`create or replace function private.christmas_number_one_now()
    returns timestamptz language sql volatile set search_path=''
    as $$ select '${value}'::timestamptz $$`);
}

async function adminAction(year, action, winner = null, note = null) {
  return asUser(ADMIN, "select public.admin_set_bom_christmas_number_one_year($1,$2,$3::uuid,$4) result", [year, action, winner, note]);
}

async function vote(userId, year, candidateId) {
  return asUser(userId, "select public.cast_bom_christmas_number_one_vote($1,$2::uuid) result", [year, candidateId]);
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    create table public.profiles(id uuid primary key, is_admin boolean not null default false);
    insert into public.profiles(id,is_admin) values
      ('${ADMIN}',true),('${MEMBER}',false),('${MEMBER_2}',false),('${MEMBER_3}',false),('${MEMBER_4}',false),
      ('${MEMBER_5}',false),('${MEMBER_6}',false);
    create table public.canonical_recordings(
      id uuid primary key default gen_random_uuid(), title text not null, artist text not null,
      musicbrainz_recording_id text, preferred_spotify_track_id text, source_metadata jsonb not null default '{}'::jsonb
    );
    grant usage on schema public to anon,authenticated,service_role;
    grant select on public.profiles to authenticated;
  `);
  for (const track of manifest.tracks) {
    await db.query(`insert into public.canonical_recordings(title,artist,musicbrainz_recording_id,preferred_spotify_track_id,source_metadata)
      values($1,$2,$3,$4,$5::jsonb)`, [track.title, track.artist, track.musicbrainzRecordingId, track.spotifyId || null, JSON.stringify({ seed: "christmas_special_verified_import" })]);
  }
  await db.exec(migration);
  candidates = (await db.query("select canonical_recording_id::text id from public.christmas_number_one_candidates order by sort_order")).rows.map(row => row.id);
});

after(async () => db.close());

test("the migration captures exactly the curated 100 and exposes no direct vote data", async () => {
  assert.equal(candidates.length, 100);
  const privileges = (await db.query(`select
    has_table_privilege('anon','christmas_number_one_votes','select') anon_votes,
    has_table_privilege('authenticated','christmas_number_one_votes','select') member_votes,
    has_table_privilege('authenticated','christmas_number_one_preview_votes','select') member_preview,
    has_function_privilege('authenticated','cast_bom_christmas_number_one_vote(smallint,uuid)','execute') official_rpc,
    has_function_privilege('authenticated','cast_bom_admin_christmas_number_one_preview_vote(smallint,uuid)','execute') preview_rpc`)).rows[0];
  assert.deepEqual(privileges, { anon_votes: false, member_votes: false, member_preview: false, official_rpc: false, preview_rpc: true });
});

test("admin preview writes are admin-only, changeable and isolated from official votes", async () => {
  await assert.rejects(asUser(MEMBER, "select public.get_bom_admin_christmas_number_one_preview(2026::smallint)"), /administrator access/i);
  await asUser(ADMIN, "select public.cast_bom_admin_christmas_number_one_preview_vote(2026::smallint,$1::uuid)", [candidates[0]]);
  await asUser(ADMIN, "select public.cast_bom_admin_christmas_number_one_preview_vote(2026::smallint,$1::uuid)", [candidates[1]]);
  assert.equal((await db.query("select count(*)::int count from christmas_number_one_preview_votes where year=2026")).rows[0].count, 1);
  assert.equal((await db.query("select canonical_recording_id::text id from christmas_number_one_preview_votes where year=2026")).rows[0].id, candidates[1]);
  assert.equal((await db.query("select count(*)::int count from christmas_number_one_votes")).rows[0].count, 0);
});

test("server time enforces approval and the 1–20 December UK voting window", async () => {
  await db.exec("grant execute on function public.cast_bom_christmas_number_one_vote(smallint,uuid) to authenticated");
  await clock("2026-11-30T23:59:59Z");
  await adminAction(2026, "approve_voting");
  await assert.rejects(vote(MEMBER, 2026, candidates[0]), /open from 1 December/i);
  await clock("2026-12-01T00:00:00Z");
  await vote(MEMBER, 2026, candidates[0]);
  await clock("2026-12-20T23:59:59.999Z");
  const changed = (await vote(MEMBER, 2026, candidates[1])).rows[0].result;
  assert.equal(changed.changed, true);
  assert.equal((await db.query("select count(*)::int count from christmas_number_one_votes where year=2026 and user_id=$1", [MEMBER])).rows[0].count, 1);
  assert.equal((await db.query("select canonical_recording_id::text id from christmas_number_one_votes where year=2026 and user_id=$1", [MEMBER])).rows[0].id, candidates[1]);
  await clock("2026-12-21T00:00:00Z");
  await assert.rejects(vote(MEMBER, 2026, candidates[0]), /20 December at 23:59 UK time/i);
});

test("eligibility and curated-song constraints reject tampering", async () => {
  await clock("2026-12-10T12:00:00Z");
  await assert.rejects(vote(NO_PROFILE, 2026, candidates[0]), /Bank of Music account/i);
  await assert.rejects(vote(MEMBER_2, 2026, "77777777-7777-4777-8777-777777777777"), /curated Christmas 100/i);
  await assert.rejects(vote(MEMBER_2, 2027, candidates[0]), /not been approved/i);
});

test("standings remain hidden until an approved Christmas Eve reveal", async () => {
  await db.exec("grant execute on function public.get_bom_christmas_number_one_state(smallint) to authenticated");
  const state = (await asUser(MEMBER, "select public.get_bom_christmas_number_one_state(2026::smallint) result")).rows[0].result;
  assert.equal(state.results, null);
  await assert.rejects(asUser(MEMBER, "select * from public.christmas_number_one_votes"), /permission denied/i);
});

test("first-place ties block publication until a documented resolution", async () => {
  await clock("2025-11-20T12:00:00Z");
  await adminAction(2025, "approve_voting");
  await clock("2025-12-10T12:00:00Z");
  await vote(MEMBER, 2025, candidates[0]);
  await vote(MEMBER_2, 2025, candidates[0]);
  await vote(MEMBER_3, 2025, candidates[1]);
  await vote(MEMBER_4, 2025, candidates[1]);
  await vote(MEMBER_5, 2025, candidates[2]);
  await vote(MEMBER_6, 2025, candidates[3]);
  await clock("2025-12-21T00:00:00Z");
  const tied = (await asUser(ADMIN, "select public.get_bom_admin_christmas_number_one_results(2025::smallint,false,'leader') result")).rows[0].result;
  assert.equal(tied.publicationBlocked, true);
  assert.equal(tied.leaderTie.length, 2);
  await assert.rejects(adminAction(2025, "approve_reveal"), /Resolve and document/i);
  await assert.rejects(adminAction(2025, "resolve_tie", candidates[0], "too short"), /at least 20 characters/i);
  await adminAction(2025, "resolve_tie", candidates[0], "Editorial panel decision recorded after reviewing the tied vote.");
  await adminAction(2025, "approve_reveal");
  const audit = (await db.query("select action,details from christmas_number_one_admin_audit where year=2025 order by id")).rows;
  assert.deepEqual(audit.map(row => row.action), ["approve_voting", "resolve_tie", "approve_reveal"]);
  assert.match(audit[1].details.note, /Editorial panel decision/);
});

test("Christmas Eve reveal, deterministic tied ranks, archive and year rollover are safe", async () => {
  await clock("2025-12-23T23:59:59Z");
  let state = (await asUser(MEMBER, "select public.get_bom_christmas_number_one_state(2025::smallint) result")).rows[0].result;
  assert.equal(state.results, null);
  await clock("2025-12-24T00:00:00Z");
  state = (await asUser(MEMBER, "select public.get_bom_christmas_number_one_state(2025::smallint) result")).rows[0].result;
  assert.equal(state.phase, "revealed");
  assert.equal(state.results.winner.id, candidates[0]);
  assert.equal(state.results.winner.tieResolved, true);
  assert.equal(state.results.ranking[0].isTied, true);
  assert.equal(state.results.ranking[1].isTied, true);
  const tiedRows = state.results.ranking.slice(0, 2);
  assert.deepEqual(tiedRows.map(row => row.title), [...tiedRows.map(row => row.title)].sort((a, b) => a.localeCompare(b)));
  const lowerTie = state.results.ranking.filter(row => row.votes === 1);
  assert.equal(lowerTie.length, 2);
  assert(lowerTie.every(row => row.isTied && row.voteRank === lowerTie[0].voteRank));
  assert.deepEqual(lowerTie.map(row => row.title), [...lowerTie.map(row => row.title)].sort((a, b) => a.localeCompare(b)));
  await db.exec("grant execute on function public.get_bom_christmas_number_one_archive() to authenticated");
  const archive = (await asUser(MEMBER, "select public.get_bom_christmas_number_one_archive() result")).rows[0].result;
  assert.equal(archive.length, 1);
  assert.equal(archive[0].year, 2025);
  await assert.rejects(adminAction(2025, "revoke_reveal"), /archive is permanent/i);
  await assert.rejects(adminAction(2025, "resolve_tie", candidates[1], "Attempt to replace a published tie resolution is blocked."), /archive is permanent/i);
  await assert.rejects(adminAction(2025, "approve_reveal"), /archive is permanent/i);
  const immutable = (await db.query("select result_snapshot from christmas_number_one_years where year=2025")).rows[0].result_snapshot;
  assert.equal(immutable.winner.id, candidates[0]);
  await clock("2027-01-01T00:00:00Z");
  const rollover = (await asUser(MEMBER, "select public.get_bom_christmas_number_one_state(2027::smallint) result")).rows[0].result;
  assert.equal(rollover.phase, "disabled");
  assert.equal(rollover.votingApproved, false);
});
