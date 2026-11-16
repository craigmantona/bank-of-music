import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { authUserCanReceive, confirmationToken, parseUnsubscribeToken, unsubscribeToken, verifyConfirmation } from "../functions/_shared/email-announcement.ts";

const require = createRequire(process.env.CATALOGUE_TEST_PACKAGE || import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const migration = readFileSync(new URL("../migrations/20261116155937_email_announcements.sql", import.meta.url), "utf8");
const functionSource = readFileSync(new URL("../functions/email-announcements/index.ts", import.meta.url), "utf8");
let db;
const userId = "11111111-1111-4111-8111-111111111111";
const adminId = "22222222-2222-4222-8222-222222222222";

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, raw_user_meta_data jsonb not null default '{}'::jsonb);
    insert into auth.users(id) values ('${userId}'),('${adminId}');`);
  await db.exec(migration);
});
after(async () => db.close());

test("existing registered users are not silently treated as marketing subscribers", async () => {
  assert.equal((await db.query("select count(*)::int count from marketing_email_preferences")).rows[0].count, 0);
  assert.equal(authUserCanReceive({ email: "member@example.com", email_confirmed_at: new Date().toISOString() }), true);
  assert.equal(authUserCanReceive({ email: "member@example.com", email_confirmed_at: null }), false);
  assert.equal(authUserCanReceive({ email: "member@example.com", email_confirmed_at: new Date().toISOString(), is_anonymous: true }), false);
});

test("signup consent is opt-in only and records server evidence", async () => {
  const optedIn = "33333333-3333-4333-8333-333333333333";
  const unticked = "44444444-4444-4444-8444-444444444444";
  const malformed = "55555555-5555-4555-8555-555555555555";
  await db.query("insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb),($3,$4::jsonb),($5,$6::jsonb)", [
    optedIn, JSON.stringify({ marketing_email_consent: true }),
    unticked, JSON.stringify({ marketing_email_consent: false }),
    malformed, JSON.stringify({ marketing_email_consent: "not-a-boolean" })
  ]);
  const preferences = (await db.query("select user_id::text,status,consented_at is not null has_timestamp,consent_source,consent_wording from marketing_email_preferences where user_id in ($1,$2,$3) order by user_id", [optedIn, unticked, malformed])).rows;
  assert.equal(preferences.length, 1);
  assert.equal(preferences[0].user_id, optedIn);
  assert.equal(preferences[0].status, "OPTED_IN");
  assert.equal(preferences[0].has_timestamp, true);
  assert.equal(preferences[0].consent_source, "SIGNUP_CHECKBOX");
  assert.match(preferences[0].consent_wording, /occasional Bank of Music news/);
});

test("announcement records and recipient data are inaccessible to browser roles", async () => {
  const privileges = await db.query(`select
    has_table_privilege('anon','marketing_email_preferences','select') anon_preferences,
    has_table_privilege('authenticated','email_announcements','select') member_history,
    has_table_privilege('authenticated','email_announcement_deliveries','select') member_deliveries,
    has_table_privilege('service_role','email_announcements','insert') service_insert`);
  assert.deepEqual(privileges.rows[0], { anon_preferences: false, member_history: false, member_deliveries: false, service_insert: true });
  assert.match(functionSource, /requireAdminUser\(request\)/);
});

test("unsubscribe tokens are signed and suppression is retained", async () => {
  const secret = "test-secret-that-is-not-used-in-production";
  const token = await unsubscribeToken(userId, secret);
  assert.equal(await parseUnsubscribeToken(token, secret), userId);
  assert.equal(await parseUnsubscribeToken(`${token.slice(0, -1)}0`, secret), null);
  await db.query("insert into marketing_email_preferences(user_id,status,consented_at,consent_source,consent_wording) values($1,'OPTED_IN',now(),'ACCOUNT_PREFERENCES','Test consent wording')", [userId]);
  await db.query("update marketing_email_preferences set status='UNSUBSCRIBED',unsubscribed_at=now(),updated_at=now() where user_id=$1", [userId]);
  assert.equal((await db.query("select status from marketing_email_preferences where user_id=$1", [userId])).rows[0].status, "UNSUBSCRIBED");
});

test("recipient-count confirmations expire on draft or count changes", async () => {
  const secret = "confirmation-secret";
  const token = await confirmationToken("fingerprint", 3, secret);
  assert.equal(await verifyConfirmation(token, "fingerprint", 3, secret), true);
  assert.equal(await verifyConfirmation(token, "changed", 3, secret), false);
  assert.equal(await verifyConfirmation(token, "fingerprint", 4, secret), false);
});

test("campaign fingerprint prevents duplicate bulk sends", async () => {
  const values = ["same-fingerprint", "MARKETING_OPT_IN", "Subject", "Message", 1, adminId];
  await db.query("insert into email_announcements(fingerprint,audience,subject,message,eligible_count,created_by) values($1,$2,$3,$4,$5,$6)", values);
  await assert.rejects(db.query("insert into email_announcements(fingerprint,audience,subject,message,eligible_count,created_by) values($1,$2,$3,$4,$5,$6)", values), /unique|duplicate/i);
});
