import assert from "node:assert/strict";
import { test, before, after, beforeEach } from "node:test";
import { database, rpc } from "./database.mjs";
let db;
const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const groups = [{ id: "g1", title: "Album", "first-release-date": "1970-11-04" }, { id: "g2", title: "Later", "first-release-date": "1971-12-17" }];
const state = { artist_id: "artist", artist_details: { country: "GB" }, offset: 2, ready: true, groups };
before(async () => { db = await database(); });
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`truncate artist_catalogue_discovery,artist_import_queue,albums,artist_catalog,artist_release_group_debug,catalogue_worker_state restart identity cascade;
    insert into catalogue_worker_state(singleton) values(true);
    insert into artist_import_queue(id,artist_name,priority) values(1,'Artist',10),(2,'Second',20);`);
});
const claim = (token = a) => rpc(db, token, "acquire");
const freeze = () => rpc(db, a, "discovery", 1, { revision: 0, state });
const album = (token = a, index = 0, groupId = "g1") => rpc(db, token, "album", 1, {
  index, group_id: groupId,
  album: { existing_id: null, payload: { title: "Album", external_source: "musicbrainz", external_id: "release", release_date: "1970-11-04" } }
});

test("migration adds no data resets; role grants close old and new bypasses", async () => {
  const grants = await db.query(`select
    has_function_privilege('anon','catalogue_worker(text,uuid,bigint,jsonb)','execute') anon,
    has_function_privilege('authenticated','catalogue_worker(text,uuid,bigint,jsonb)','execute') authenticated,
    has_function_privilege('service_role','catalogue_worker(text,uuid,bigint,jsonb)','execute') service,
    has_function_privilege('service_role','claim_next_artist_import()','execute') old_claim`);
  assert.deepEqual(grants.rows[0], { anon: false, authenticated: false, service: true, old_claim: false });
  const receiptColumns=await db.query(`select column_name from information_schema.columns
    where table_name='catalogue_worker_state' and column_name like 'coordination_%'`);
  assert.equal(receiptColumns.rows.length,4);
  await db.exec("set role service_role");
  assert.equal((await claim()).job.id, 1);
  await db.exec("reset role");
});
test("shadow schema is additive, private, versioned and preserves album rows", async () => {
  await db.exec("insert into albums(title,artist) values('Existing','Artist')");
  const columns = await db.query(`select column_name from information_schema.columns
    where table_name='albums' and column_name in ('musicbrainz_release_group_id','musicbrainz_release_id',
      'original_release_date','canonical_release_date','canonical_release_country','catalogue_selection_version')`);
  assert.equal(columns.rows.length, 6);
  assert.equal((await db.query("select count(*)::int n from albums where title='Existing'")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from artist_catalogue_overrides where qualification='review'")).rows[0].n, 6);
  const grants = await db.query(`select
    has_table_privilege('anon','artist_catalogue_shadow_decisions','select') anon,
    has_table_privilege('authenticated','artist_catalogue_overrides','select') authenticated,
    has_table_privilege('service_role','artist_catalogue_shadow_snapshots','select') service`);
  assert.deepEqual(grants.rows[0], { anon:false, authenticated:false, service:true });
});
test("attempt history is private and append-only for the service role", async () => {
  const grants=await db.query(`select
    has_table_privilege('anon','artist_catalogue_events','select') anon_select,
    has_table_privilege('authenticated','artist_catalogue_events','select') authenticated_select,
    has_table_privilege('service_role','artist_catalogue_events','select') service_select,
    has_table_privilege('service_role','artist_catalogue_events','insert') service_insert,
    has_table_privilege('service_role','artist_catalogue_events','update') service_update,
    has_table_privilege('service_role','artist_catalogue_events','delete') service_delete`);
  assert.deepEqual(grants.rows[0],{anon_select:false,authenticated_select:false,
    service_select:true,service_insert:true,service_update:false,service_delete:false});
});
test("simultaneous claims serialize globally, including inspector", async () => {
  const results = await Promise.all([claim(a), claim(b)]);
  assert.equal(results.filter(r => r.busy).length, 1);
  assert.equal((await rpc(db,b,"acquire",null,{kind:"inspector"})).busy, true);
  assert.equal((await db.query("select attempts from artist_import_queue where id=2")).rows[0].attempts, 0);
});
test("same-token acquisition recovers one existing job without mutating progress", async () => {
  await db.exec("update artist_import_queue set next_album_index=7,studio_albums_imported=5 where id=1");
  const first = await claim(a);
  const recovered = await claim(a);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.job.id, first.job.id);
  assert.equal(recovered.discovery.job_id, first.discovery.job_id);
  const q = (await db.query("select * from artist_import_queue where id=1")).rows[0];
  assert.equal(q.attempts, 1);
  assert.equal(q.next_album_index, 7);
  assert.equal(q.studio_albums_imported, 5);
  assert.equal((await db.query("select count(*)::int n from artist_catalogue_discovery where job_id=1")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from artist_catalogue_events where job_id=1 and event_type='attempt_started'")).rows[0].n, 1);
  assert.equal((await claim(b)).busy, true);
  assert.equal((await db.query("select attempts from artist_import_queue where id=2")).rows[0].attempts, 0);
});
test("same token cannot recover an inconsistent or differently typed lease", async () => {
  await claim(a);
  await assert.rejects(rpc(db,a,"acquire",null,{kind:"inspector"}), /inconsistent/);
  await db.exec("delete from artist_catalogue_discovery where job_id=1");
  await assert.rejects(claim(a), /inconsistent/);
  assert.equal((await db.query("select attempts from artist_import_queue where id=2")).rows[0].attempts, 0);
});
test("expired or superseded owner cannot renew or commit album/progress", async () => {
  await claim(); await freeze();
  await db.exec("update catalogue_worker_state set expires_at=now()-interval '1 second'");
  await assert.rejects(album(), /expired or superseded/);
  await assert.rejects(rpc(db,a,"heartbeat",1), /expired or superseded/);
  await claim(b); // Reclaims old job with delay and selects the next artist.
  await assert.rejects(album(), /expired or superseded/);
  assert.equal((await db.query("select count(*)::int n from albums")).rows[0].n, 0);
  const q = (await db.query("select * from artist_import_queue where id=1")).rows[0];
  assert.equal(q.next_album_index, 0); assert.equal(q.consecutive_failures, 1); assert.equal(q.status, "pending");
});
test("heartbeat renews valid lease, fresh legacy processing blocks acquisition", async () => {
  await claim();
  await db.exec("update catalogue_worker_state set expires_at=now()+interval '1 second'");
  await rpc(db,a,"heartbeat",1);
  assert.equal((await db.query("select expires_at > now()+interval '9 minutes' renewed from catalogue_worker_state")).rows[0].renewed, true);
  await rpc(db,a,"finish",1);
  await db.exec("update artist_import_queue set status='processing',started_at=now(),updated_at=now() where id=1");
  assert.equal((await claim()).busy, true);
});
test("stale Queen-style processing lease is reclaimed after ten minutes without rewinding", async () => {
  await db.exec("update artist_import_queue set status='processing',started_at=now()-interval '11 minutes',updated_at=now()-interval '11 minutes',next_album_index=3,studio_albums_imported=2 where id=1");
  await claim();
  const q = (await db.query("select * from artist_import_queue where id=1")).rows[0];
  assert.equal(q.status, "pending"); assert.equal(q.next_album_index,3); assert.equal(q.studio_albums_imported,2);
});
test("discovery checkpoints resume and frozen ordering cannot be replaced", async () => {
  await claim();
  const partial = { ...state, ready: false, offset: 100, groups: [groups[1]] };
  await rpc(db,a,"discovery",1,{revision:0,state:partial});
  await rpc(db,a,"finish",1,{defer_ms:0});
  const resumed = await claim(b);
  assert.deepEqual(resumed.discovery.state,partial); assert.equal(resumed.discovery.revision,1);
  await rpc(db,b,"discovery",1,{revision:1,state:{...state,offset:101}});
  await assert.rejects(rpc(db,b,"discovery",1,{revision:2,state:{...state,groups:[...groups].reverse()}}),/already frozen/);
});
test("existing cursor and accepted count survive first discovery snapshot", async () => {
  await db.exec("update artist_import_queue set next_album_index=1,studio_albums_imported=1 where id=1");
  await claim(); await freeze();
  const q = (await db.query("select * from artist_import_queue where id=1")).rows[0];
  assert.equal(q.next_album_index,1); assert.equal(q.studio_albums_imported,1);
});
test("album write and counter checkpoint are atomic and replay is rejected", async () => {
  await claim(); await freeze();
  const q=await album(); assert.equal(q.next_album_index,1); assert.equal(q.studio_albums_imported,1);
  await assert.rejects(album(), /stale/);
  assert.equal((await db.query("select count(*)::int n from albums")).rows[0].n,1);
  await rpc(db,a,"album",1,{index:1,group_id:"g2",album:null});
  const finished=await rpc(db,a,"finish",1);
  assert.equal(finished.status,"complete");
  assert.equal((await db.query("select studio_album_count from artist_catalog")).rows[0].studio_album_count,1);
});
test("database error rolls back both album and checkpoint", async () => {
  await claim(); await freeze();
  await db.exec("alter table artist_import_queue add constraint injected_failure check(next_album_index=0)");
  try { await assert.rejects(album(),/injected_failure/); }
  finally { await db.exec("alter table artist_import_queue drop constraint injected_failure"); }
  assert.equal((await db.query("select count(*)::int n from albums")).rows[0].n,0);
});
test("shared rate cooldown survives release and transfer to inspector", async () => {
  await claim();
  assert.equal((await rpc(db,a,"rate",1)).wait_ms,0);
  assert.ok((await rpc(db,a,"rate",1)).wait_ms > 0);
  await rpc(db,a,"cooldown",1,{milliseconds:60000});
  await rpc(db,a,"finish",1);
  await rpc(db,b,"acquire",null,{kind:"inspector"});
  assert.ok((await rpc(db,b,"rate")).wait_ms > 50000);
});
test("same rate request token returns one reservation and advances the gate once", async () => {
  const requestToken="33333333-3333-4333-8333-333333333333";
  await claim();
  const first=await rpc(db,a,"rate",1,{request_token:requestToken});
  const gate=(await db.query("select next_musicbrainz_at from catalogue_worker_state")).rows[0].next_musicbrainz_at;
  const recovered=await rpc(db,a,"rate",1,{request_token:requestToken});
  assert.equal(recovered.recovered,true);
  assert.equal(new Date(recovered.reserved_at).getTime(),new Date(first.reserved_at).getTime());
  assert.equal((await db.query("select next_musicbrainz_at from catalogue_worker_state")).rows[0].next_musicbrainz_at.toISOString(),gate.toISOString());
});
test("normal rate reservation returns an immediate confirmed slot", async () => {
  await claim();
  const result=await rpc(db,a,"rate",1,{request_token:"66666666-6666-4666-8666-666666666666"});
  assert.equal(result.recovered,undefined); assert.equal(result.wait_ms,0);
  assert.ok(result.reserved_at);
});
test("different rate request tokens reserve non-overlapping 1.1-second slots", async () => {
  await claim();
  const first=await rpc(db,a,"rate",1,{request_token:"33333333-3333-4333-8333-333333333333"});
  const second=await rpc(db,a,"rate",1,{request_token:"44444444-4444-4444-8444-444444444444"});
  assert.ok(new Date(second.reserved_at)-new Date(first.reserved_at)>=1100);
  assert.ok(second.wait_ms>0);
  assert.equal((await rpc(db,b,"acquire")).busy,true);
});
test("same cooldown request token preserves the exact shared boundary", async () => {
  const requestToken="55555555-5555-4555-8555-555555555555";
  await claim();
  const first=await rpc(db,a,"cooldown",1,{request_token:requestToken,milliseconds:60000});
  const recovered=await rpc(db,a,"cooldown",1,{request_token:requestToken,milliseconds:120000});
  assert.equal(recovered.recovered,true);
  assert.equal(new Date(recovered.not_before).getTime(),new Date(first.not_before).getTime());
});
test("consecutive failures cap at five; cumulative successful attempts do not gate work", async () => {
  await db.exec("update artist_import_queue set attempts=100 where id=1");
  for(let i=1;i<=5;i++) {
    await claim(); await rpc(db,a,"failure",1,{error:"Provider down"});
    const q=(await db.query("select * from artist_import_queue where id=1")).rows[0];
    assert.equal(q.consecutive_failures,i); assert.equal(q.status,i===5?'failed':'pending');
    await db.exec("update artist_import_queue set next_attempt_at=null where id=1");
  }
  assert.equal((await claim()).job.id,2);
});
test("successful checkpoint resets failures; planned deferral preserves counters", async () => {
  await db.exec("update artist_import_queue set consecutive_failures=4,attempts=50 where id=1");
  await claim(); await freeze();
  const finished=await rpc(db,a,"finish",1,{defer_ms:120000});
  assert.equal(finished.consecutive_failures,0); assert.equal(finished.attempts,51);
  assert.equal(finished.next_album_index,0); assert.equal(finished.status,'pending');
  assert.equal((await claim(b)).job.id,2);
});
test("deferral without a checkpoint does not erase real failure history", async () => {
  await db.exec("update artist_import_queue set consecutive_failures=4 where id=1");
  await claim();
  const q=await rpc(db,a,"finish",1,{defer_ms:60000});
  assert.equal(q.consecutive_failures,4); assert.equal(q.status,'pending');
});
test("expired owner cannot replace inspection data or checkpoint discovery", async () => {
  await rpc(db,a,"acquire",null,{kind:'inspector'});
  await db.exec("update catalogue_worker_state set expires_at=now()-interval '1 second'");
  await assert.rejects(rpc(db,a,"inspection",null,{artist:'Artist',artist_id:'id',groups:[]}),/expired or superseded/);
  await claim(b);
  await assert.rejects(rpc(db,a,"discovery",1,{revision:0,state}),/expired or superseded/);
});
