import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { database } from "./database.mjs";

let db;
before(async () => { db = await database(); });
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("delete from artist_catalogue_overrides where release_group_id like 'test-%'");
});

async function review(id, title = "Archive album") {
  return db.query(`select upsert_artist_catalogue_review(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result`, [id,"artist-id","Artist",title,
    "1994","insufficient_structured_confidence","release-id","1994","GB","gb_original_period"]);
}

test("pending review discovery is idempotent and refreshes descriptive context", async () => {
  await review("test-review");
  await db.query(`select upsert_artist_catalogue_review(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, ["test-review","artist-id","Artist",
    "Corrected archive title","1994","outside_artist_era",null,null,null,null]);
  const rows = (await db.query("select * from artist_catalogue_overrides where release_group_id='test-review'")).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qualification, "review");
  assert.equal(rows[0].decision_source, "automatic");
  assert.equal(rows[0].release_group_title, "Corrected archive title");
  assert.equal(rows[0].proposed_release_id, "release-id");
});

test("automated review refresh cannot overwrite a final human decision", async () => {
  await review("test-final");
  await db.query(`update artist_catalogue_overrides set qualification='include',
    decision_source='human',decision_note='Reviewed against official discography',decided_at='2026-09-12T10:00:00Z'
    where release_group_id='test-final'`);
  await review("test-final", "Automated refresh title");
  const row = (await db.query("select * from artist_catalogue_overrides where release_group_id='test-final'")).rows[0];
  assert.equal(row.qualification, "include");
  assert.equal(row.decision_note, "Reviewed against official discography");
  assert.equal(row.decided_at.toISOString(), "2026-09-12T10:00:00.000Z");
  assert.equal(row.release_group_title, "Archive album");
  assert.equal(row.decision_source, "human");
});

test("automatic review refresh is idempotent and preserves decision fields", async () => {
  await review("test-repeat");
  await db.query(`update artist_catalogue_overrides set decision_note='triage note',
    decided_at='2026-09-12T11:00:00Z' where release_group_id='test-repeat'`);
  await review("test-repeat", "Refreshed title");
  const row=(await db.query("select * from artist_catalogue_overrides where release_group_id='test-repeat'")).rows[0];
  assert.equal(row.release_group_title,"Refreshed title");
  assert.equal(row.decision_note,"triage note");
  assert.equal(row.decided_at.toISOString(),"2026-09-12T11:00:00.000Z");
});

test("A Kind of Magic is seeded for review without changing existing policies", async () => {
  const rows = (await db.query(`select release_group_id,qualification,decision_source from artist_catalogue_overrides
    where release_group_id in ('84f508a9-beae-3e97-b59e-3a8886c6e901',
      '84cf1d46-2e8c-430e-8361-f04ebf87f20d','51c70552-4906-3b27-b3f4-f64e764551d0')`)).rows;
  assert.equal(rows.find(row => row.release_group_id === "84f508a9-beae-3e97-b59e-3a8886c6e901").qualification, "review");
  assert.equal(rows.find(row => row.release_group_id === "51c70552-4906-3b27-b3f4-f64e764551d0").qualification, "exclude");
  assert.ok(rows.every(row=>row.decision_source==="policy"));
});
