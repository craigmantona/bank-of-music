import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const originalMigration = await readFile(
  new URL("../migrations/20261117160000_remote_album_import_rate_limit.sql", import.meta.url),
  "utf8"
);
const outcomeMigration = await readFile(
  new URL("../migrations/20261118210000_outcome_aware_remote_album_import_limits.sql", import.meta.url),
  "utf8"
);

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const USER_C = "33333333-3333-4333-8333-333333333333";
const USER_D = "44444444-4444-4444-8444-444444444444";
const USER_E = "55555555-5555-4555-8555-555555555555";
const RELEASE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RELEASE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GROUP_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

async function fixture({ legacyAttempts = 0 } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users(id) values
      ('${USER_A}'),('${USER_B}'),('${USER_C}'),('${USER_D}'),('${USER_E}');
    grant usage on schema public,auth to service_role,authenticated;
  `);
  await db.exec(originalMigration);
  if (legacyAttempts) {
    await db.exec(`insert into public.remote_album_import_attempts(user_id,attempted_at)
      select '${USER_A}', clock_timestamp() - interval '1 minute'
      from generate_series(1,${legacyAttempts})`);
  }
  await db.exec(outcomeMigration);
  return db;
}

async function reserve(db, userId, releaseId, groupId = GROUP_A) {
  await db.exec("set role service_role");
  try {
    const result = await db.query(
      "select public.reserve_remote_album_import_slot($1::uuid,$2::uuid,$3::uuid) result",
      [userId, releaseId, groupId]
    );
    return result.rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}

async function complete(db, userId, leaseToken, outcome) {
  await db.exec("set role service_role");
  try {
    const result = await db.query(
      "select public.complete_remote_album_import_slot($1::uuid,$2::uuid,$3) result",
      [userId, leaseToken, outcome]
    );
    return result.rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}

test("legacy attempts are preserved for audit but do not inherit the old restrictive quota", async () => {
  const db = await fixture({ legacyAttempts: 20 });
  try {
    const slot = await reserve(db, USER_A, RELEASE_A);
    assert.equal(slot.allowed, true);
    assert.match(slot.lease_token, /^[0-9a-f-]{36}$/);
    const rows = (await db.query(
      "select outcome,count(*)::int n from remote_album_import_attempts group by outcome order by outcome"
    )).rows;
    assert.deepEqual(rows, [
      { outcome: "legacy", n: 20 },
      { outcome: "started", n: 1 }
    ]);
  } finally {
    await db.close();
  }
});

test("the same release is coalesced and a user cannot occupy two importer leases", async () => {
  const db = await fixture();
  try {
    const owner = await reserve(db, USER_A, RELEASE_A);
    assert.equal(owner.allowed, true);

    const follower = await reserve(db, USER_B, RELEASE_A);
    assert.deepEqual(
      { allowed: follower.allowed, reason: follower.reason, coalesced: follower.coalesced },
      { allowed: false, reason: "release_in_progress", coalesced: true }
    );

    const secondRelease = await reserve(db, USER_A, RELEASE_B);
    assert.equal(secondRelease.allowed, false);
    assert.equal(secondRelease.reason, "user_import_in_progress");
    assert.equal((await db.query(
      "select count(*)::int n from remote_album_import_attempts"
    )).rows[0].n, 1);

    const completion = await complete(db, USER_A, owner.lease_token, "succeeded");
    assert.equal(completion.completed, true);
    assert.equal((await db.query(
      "select count(*)::int n from remote_album_import_leases"
    )).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("successful imports have a generous 50/day user budget and a 100/day global ceiling", async () => {
  const db = await fixture();
  try {
    await db.exec(`
      insert into remote_album_import_attempts(user_id,release_id,outcome,attempted_at,completed_at)
      select '${USER_A}', gen_random_uuid(), 'succeeded', clock_timestamp() - interval '1 hour', clock_timestamp()
      from generate_series(1,50);
    `);
    const userLimited = await reserve(db, USER_A, RELEASE_A);
    assert.equal(userLimited.allowed, false);
    assert.equal(userLimited.reason, "success_budget");

    await db.exec(`
      insert into remote_album_import_attempts(user_id,release_id,outcome,attempted_at,completed_at)
      select '${USER_B}', gen_random_uuid(), 'succeeded', clock_timestamp() - interval '1 hour', clock_timestamp()
      from generate_series(1,50);
    `);
    const globallyLimited = await reserve(db, USER_C, RELEASE_B);
    assert.equal(globallyLimited.allowed, false);
    assert.equal(globallyLimited.reason, "global_success_budget");
  } finally {
    await db.close();
  }
});

test("global leases bound MusicBrainz queue depth and expired work releases capacity", async () => {
  const db = await fixture();
  try {
    const owners = [];
    for (const [user, release] of [
      [USER_A, "10000000-0000-4000-8000-000000000001"],
      [USER_B, "10000000-0000-4000-8000-000000000002"],
      [USER_C, "10000000-0000-4000-8000-000000000003"],
      [USER_D, "10000000-0000-4000-8000-000000000004"]
    ]) owners.push(await reserve(db, user, release));
    assert.ok(owners.every(slot => slot.allowed));

    const full = await reserve(db, USER_E, "10000000-0000-4000-8000-000000000005");
    assert.equal(full.allowed, false);
    assert.equal(full.reason, "global_capacity");

    await db.exec(`update remote_album_import_leases
      set acquired_at=clock_timestamp()-interval '3 minutes',
          expires_at=clock_timestamp()-interval '1 minute'
      where lease_token='${owners[0].lease_token}'`);
    const afterExpiry = await reserve(db, USER_E, "10000000-0000-4000-8000-000000000005");
    assert.equal(afterExpiry.allowed, true);
    assert.equal((await db.query(
      "select outcome from remote_album_import_attempts where lease_token=$1",
      [owners[0].lease_token]
    )).rows[0].outcome, "transient_failure");
  } finally {
    await db.close();
  }
});

test("the distinct-start ceiling targets automation without spending success quota", async () => {
  const db = await fixture();
  try {
    await db.exec(`
      insert into remote_album_import_attempts(user_id,release_id,outcome,attempted_at,completed_at)
      select '${USER_A}', gen_random_uuid(), 'already_exists', clock_timestamp() - interval '1 minute', clock_timestamp()
      from generate_series(1,20);
    `);
    const limited = await reserve(db, USER_A, RELEASE_A);
    assert.equal(limited.allowed, false);
    assert.equal(limited.reason, "start_budget");
    assert.equal((await db.query(
      "select count(*)::int n from remote_album_import_attempts where outcome='succeeded'"
    )).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("transient and invalid failures use separate budgets and never consume success allowance", async () => {
  const db = await fixture();
  try {
    await db.exec(`
      insert into remote_album_import_attempts(user_id,release_id,outcome,attempted_at,completed_at)
      select '${USER_A}', gen_random_uuid(), 'succeeded', clock_timestamp() - interval '1 hour', clock_timestamp()
      from generate_series(1,49);
      insert into remote_album_import_attempts(user_id,release_id,outcome,attempted_at,completed_at)
      select '${USER_A}', gen_random_uuid(), 'transient_failure', clock_timestamp() - interval '1 minute', clock_timestamp()
      from generate_series(1,7);
    `);
    const finalFailureAllowance = await reserve(db, USER_A, RELEASE_A);
    assert.equal(finalFailureAllowance.allowed, true);
    await complete(db, USER_A, finalFailureAllowance.lease_token, "transient_failure");

    const failureLimited = await reserve(db, USER_A, RELEASE_B);
    assert.equal(failureLimited.allowed, false);
    assert.equal(failureLimited.reason, "failure_budget");
    assert.equal((await db.query(
      "select count(*)::int n from remote_album_import_attempts where outcome='succeeded' and user_id=$1",
      [USER_A]
    )).rows[0].n, 49);

    await db.exec(`
      insert into remote_album_import_attempts(user_id,release_id,outcome,attempted_at,completed_at)
      select '${USER_B}', gen_random_uuid(), 'invalid_failure', clock_timestamp() - interval '30 minutes', clock_timestamp()
      from generate_series(1,10);
    `);
    const invalidLimited = await reserve(db, USER_B, RELEASE_B);
    assert.equal(invalidLimited.allowed, false);
    assert.equal(invalidLimited.reason, "invalid_budget");
  } finally {
    await db.close();
  }
});

test("browser roles cannot inspect or manipulate private importer accounting", async () => {
  const db = await fixture();
  try {
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from remote_album_import_attempts"), /permission denied/i);
    await assert.rejects(db.query(
      `select reserve_remote_album_import_slot('${USER_A}'::uuid,'${RELEASE_A}'::uuid,'${GROUP_A}'::uuid)`
    ), /permission denied/i);
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
