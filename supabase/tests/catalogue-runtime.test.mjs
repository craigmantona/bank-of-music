import assert from "node:assert/strict";
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { database, adapter } from "./database.mjs";
import { loadEdge, importerSource } from "./helpers.mjs";
let db;
before(async () => { db = await database(); });
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`truncate artist_catalogue_discovery,artist_import_queue,albums,artist_catalog,catalogue_worker_state restart identity cascade;
    delete from artist_catalogue_overrides where release_group_id like 'g%';
    insert into catalogue_worker_state(singleton) values(true);
    insert into artist_import_queue(id,artist_name,musicbrainz_artist_id) values(1,'Artist','artist');`);
});
const group = (n, extra = {}) => ({ id: `g${n}`, title: `Album ${n}`, "primary-type":"Album",
  "secondary-types":[], "first-release-date":`197${n}-01-01`,
  "artist-credit":[{artist:{id:"artist"}}], ...extra });
function importer(get, client = adapter(db), env = {}) {
  let handler;
  const ctx = loadEdge(importerSource, {
    Deno: { env: { get: key => env[key] ?? "test-only" }, serve: fn => { handler = fn; } },
    createClient: () => client, requireServiceOrAdmin: async () => ({ ok:true })
  });
  ctx.CatalogueWorker.prototype.musicBrainzGet = get;
  return { ctx, run: async () => {
    const response = await handler(new Request("https://example.invalid",{method:"POST"}));
    return { status:response.status, body: await response.json() };
  }};
}
function response(path, groups) {
  if(path.startsWith('/artist/')) return { id:'artist',country:'GB',"life-span":{} };
  if(path.startsWith('/release-group?')) return { "release-groups":groups, "release-group-count":groups.length };
  const n=Number(path.match(/release-group=g(\d+)/)?.[1]);
  return { releases:[{id:`release${n}`,title:`Album ${n}`,date:`197${n}-01-01`,country:'GB',
    "artist-credit":[{artist:{id:"artist",name:"Artist"},name:"Artist"}]}] };
}
test("real handler checkpoints three groups then resumes the frozen snapshot", async () => {
  let discoveryCalls=0;
  const app=importer(async path => {
    if(path.startsWith('/release-group?')) discoveryCalls++;
    return response(path,[group(3),group(1),group(2),group(4)]);
  });
  const first=await app.run();
  assert.equal(first.status,200); assert.equal(first.body.batch_size,3);
  assert.equal(first.body.next_album_index,3); assert.equal(first.body.albums_accepted_total,3);
  const second=await app.run();
  assert.equal(second.body.complete,true); assert.equal(second.body.albums_accepted_total,4);
  assert.equal(second.body.batch_size,1); assert.equal(discoveryCalls,1);
  assert.equal((await db.query('select count(*)::int n from albums')).rows[0].n,4);
});

test("attempt and candidate events are durable, compact and tied to the lifetime attempt", async () => {
  const app=importer(async path=>response(path,[group(1)]));
  const result=await app.run(); assert.equal(result.status,200);
  const events=(await db.query(`select * from artist_catalogue_events order by id`)).rows;
  assert.deepEqual(events.map(row=>row.event_type),[
    "attempt_started","discovery_checkpoint","discovery_checkpoint","discovery_checkpoint",
    "candidate_checkpoint","job_completed"
  ]);
  const candidate=events.find(row=>row.event_type==="candidate_checkpoint");
  assert.equal(candidate.attempt_number,1); assert.equal(candidate.release_group_id,"g1");
  assert.equal(candidate.release_group_title,"Album 1");
  assert.equal(candidate.cursor_before,0); assert.equal(candidate.cursor_after,1);
  assert.equal(candidate.outcome,"success"); assert.ok(candidate.worker_token);
  assert.ok(JSON.stringify(candidate.details).length < 4096);
});

test("a diagnostics write failure rolls back the album and cursor checkpoint", async () => {
  await db.exec(`alter table artist_catalogue_events add constraint reject_candidate_event
    check(event_type <> 'candidate_checkpoint')`);
  try {
    const app=importer(async path=>response(path,[group(1)]));
    const result=await app.run(); assert.equal(result.status,500);
    const queue=(await db.query("select * from artist_import_queue where id=1")).rows[0];
    assert.equal(queue.next_album_index,0); assert.equal(queue.studio_albums_imported,0);
    assert.equal((await db.query("select count(*)::int n from albums")).rows[0].n,0);
  } finally {
    await db.exec("alter table artist_catalogue_events drop constraint reject_candidate_event");
  }
});

test("protected REVIEW pauses at the frozen candidate and cannot be bypassed by an album checkpoint", async () => {
  await db.exec(`insert into artist_catalogue_overrides(release_group_id,qualification,reason,
    decision_source,artist_name,release_group_title) values
    ('g1','review','Editorial review','policy','Artist','Album 1')`);
  const app=importer(async path=>response(path,[group(1)]),adapter(db),
    {CATALOGUE_SELECTION_SHADOW_MODE:"true"});
  const result=await app.run(); assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.review_pending.release_group_id,"g1");
  const queue=(await db.query("select * from artist_import_queue where id=1")).rows[0];
  assert.equal(queue.status,"review"); assert.equal(queue.next_album_index,0);
  assert.equal(queue.studio_albums_imported,0);
  assert.equal((await db.query("select count(*)::int n from albums")).rows[0].n,0);
  const event=(await db.query("select * from artist_catalogue_events where event_type='candidate_review'")).rows[0];
  assert.equal(event.outcome,"review"); assert.equal(event.cursor_before,event.cursor_after);

  const token=crypto.randomUUID();
  await db.exec("update artist_import_queue set status='processing' where id=1");
  await db.query("update catalogue_worker_state set owner_token=$1::uuid,job_id=1,expires_at=now()+interval '10 minutes'",[token]);
  await assert.rejects(db.query(`select catalogue_worker('album',$1::uuid,1,
    '{"index":0,"group_id":"g1","album":null}'::jsonb)`,[token]),/Protected review/);
});

test("protected EXCLUDE advances without an album while protected INCLUDE proceeds", async () => {
  await db.exec(`insert into artist_catalogue_overrides(release_group_id,qualification,reason,decision_source)
    values('g1','exclude','Policy exclusion','policy'),('g2','include','Policy inclusion','human')`);
  const app=importer(async path=>response(path,[group(1),group(2)]));
  const result=await app.run(); assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.complete,true); assert.equal(result.body.albums_accepted_total,1);
  assert.equal((await db.query("select count(*)::int n from albums")).rows[0].n,1);
  const events=(await db.query("select release_group_id,details from artist_catalogue_events where event_type='candidate_checkpoint' order by id")).rows;
  assert.equal(events[0].release_group_id,"g1"); assert.equal(events[0].details.album_action,"excluded");
  assert.equal(events[1].release_group_id,"g2"); assert.equal(events[1].details.album_action,"inserted");
});

test("Fleetwood-style frozen recovery resumes at Then Play On without rediscovery or rewind", async () => {
  const groups=Array.from({length:24},(_,i)=>group(i));
  groups[3]={...groups[3],id:"then-play-on",title:"Then Play On","first-release-date":"1969-09"};
  await db.exec(`update artist_import_queue set status='pending',attempts=9,consecutive_failures=0,
    next_album_index=3,total_studio_albums=24,studio_albums_imported=3 where id=1`);
  await db.query(`insert into artist_catalogue_discovery(job_id,revision,state) values
    (1,4,$1::jsonb)`,[JSON.stringify({ready:true,artist_id:"artist",artist_details:{country:"GB"},offset:186,groups})]);
  let discoveryCalls=0, releaseGroups=[];
  const app=importer(async path=>{ if(path.startsWith('/release-group?')) discoveryCalls++;
    const id=new URL('https://example.invalid'+path).searchParams.get('release-group');
    if(id) releaseGroups.push(id);
    return id==="then-play-on" ? {releases:[{id:"then-release",title:"Then Play On",date:"1969-09-19",country:"GB",
      "artist-credit":[{artist:{id:"artist",name:"Artist"},name:"Artist"}]}]} : response(path,groups);
  });
  const result=await app.run(); assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(discoveryCalls,0); assert.equal(releaseGroups[0],"then-play-on");
  const queue=(await db.query("select * from artist_import_queue where id=1")).rows[0];
  assert.equal(queue.next_album_index,6); assert.equal(queue.studio_albums_imported,6);
  assert.equal(queue.attempts,10); assert.equal((await db.query("select revision from artist_catalogue_discovery where job_id=1")).rows[0].revision,4);
});

test("Queen-style frozen recovery pauses on A Kind of Magic until a human decision", async () => {
  const groups=Array.from({length:20},(_,i)=>group(i));
  groups[11]={...groups[11],id:"gqueen-magic",title:"A Kind of Magic","first-release-date":"1986-06-02"};
  await db.exec(`update artist_import_queue set status='pending',attempts=22,consecutive_failures=0,
    next_album_index=11,total_studio_albums=20,studio_albums_imported=11 where id=1`);
  await db.query(`insert into artist_catalogue_discovery(job_id,revision,state) values
    (1,5,$1::jsonb)`,[JSON.stringify({ready:true,artist_id:"artist",artist_details:{country:"GB"},offset:267,groups})]);
  await db.exec(`insert into artist_catalogue_overrides(release_group_id,qualification,reason,decision_source,
    artist_name,release_group_title) values('gqueen-magic','review','Soundtrack relationship is ambiguous',
    'policy','Queen','A Kind of Magic')`);
  let discoveryCalls=0;
  const app=importer(async path=>{ if(path.startsWith('/release-group?')) discoveryCalls++;
    return path.includes('release-group=gqueen-magic') ? {releases:[{id:'magic-release',title:'A Kind of Magic',date:'1986',country:'GB',
      "artist-credit":[{artist:{id:'artist',name:'Artist'},name:'Artist'}]}]} : response(path,groups);
  },adapter(db),{CATALOGUE_SELECTION_SHADOW_MODE:'true'});
  const paused=await app.run(); assert.equal(paused.status,200,JSON.stringify(paused.body));
  let queue=(await db.query("select * from artist_import_queue where id=1")).rows[0];
  assert.equal(discoveryCalls,0); assert.equal(queue.status,'review');
  assert.equal(queue.next_album_index,11); assert.equal(queue.studio_albums_imported,11); assert.equal(queue.attempts,23);
  assert.equal((await db.query("select count(*)::int n from albums")).rows[0].n,0);

  await db.exec(`update artist_catalogue_overrides set qualification='include',decision_source='human',
    decided_at=now(),decision_note='Test-only approval' where release_group_id='gqueen-magic';
    update artist_import_queue set status='pending',consecutive_failures=0 where id=1`);
  const resumed=await app.run(); assert.equal(resumed.status,200,JSON.stringify(resumed.body));
  queue=(await db.query("select * from artist_import_queue where id=1")).rows[0];
  assert.equal(queue.next_album_index,14); assert.equal(queue.studio_albums_imported,14); assert.equal(queue.attempts,24);
  assert.equal((await db.query("select revision from artist_catalogue_discovery where job_id=1")).rows[0].revision,5);
});
test("shadow mode augments an existing frozen discovery snapshot without rediscovery", async () => {
  await db.exec(`insert into artist_catalogue_discovery(job_id, revision, state)
    values (1, 1, '{"ready":true,"artist_id":"artist","artist_details":{"country":"GB"},"offset":1,"groups":[{"id":"g1","title":"Album 1","first-release-date":"1971-01-01"}],"processed_release_group_ids":[]}'::jsonb)`);
  let discoveryCalls = 0;
  const app = importer(async path => {
    if (path.startsWith("/release-group?")) discoveryCalls++;
    return response(path, [group(1)]);
  }, adapter(db), { CATALOGUE_SELECTION_SHADOW_MODE: "true" });
  const result = await app.run();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(discoveryCalls, 0);
  const snapshot = (await db.query("select * from artist_catalogue_shadow_snapshots where job_id=1")).rows[0];
  assert.deepEqual(snapshot.qualified_release_group_ids, ["g1"]);
  assert.deepEqual(snapshot.review_release_group_ids, []);
  const decision=(await db.query("select * from artist_catalogue_shadow_decisions where job_id=1 and release_group_id='g1'")).rows[0];
  assert.equal(decision.qualification,"include");
  assert.equal(decision.qualification_reason,"high_confidence_primary_album");
  assert.equal(decision.artist_credit[0].artist.id,"artist");
  assert.equal((await db.query("select revision from artist_catalogue_discovery where job_id=1")).rows[0].revision, 1);
  assert.equal((await db.query("select next_album_index from artist_import_queue where id=1")).rows[0].next_album_index,1);
});
test("shadow review persists context without controlling legacy writes", async () => {
  const uncertain = group(1, { "artist-credit": [] });
  const app = importer(async path => path.includes("release-group=g1&")
    ? {releases:[{id:"release1",title:"Album 1",date:"1971-01-01",country:"GB"}]}
    : response(path, [uncertain]), adapter(db),
    { CATALOGUE_SELECTION_SHADOW_MODE: "true" });
  const result = await app.run();
  assert.equal(result.status, 200);
  assert.equal((await db.query("select count(*)::int n from albums")).rows[0].n, 1);
  const review = (await db.query("select * from artist_catalogue_overrides where release_group_id='g1'")).rows[0];
  assert.equal(review.qualification, "review");
  assert.equal(review.review_reason, "missing_artist_credit");
  assert.equal(review.artist_name, "Artist");
  assert.equal(review.proposed_release_id, "release1");
  assert.equal(review.decision_source, "automatic");
});

test("automatic missing-credit review is re-evaluated when a later natural release supplies credit", async () => {
  await db.exec(`insert into artist_catalogue_overrides(release_group_id,qualification,reason,decision_source,
    musicbrainz_artist_id,artist_name,release_group_title,review_reason)
    values('g1','review','missing_artist_credit','automatic','artist','Artist','Album 1','missing_artist_credit')`);
  const app=importer(async path=>response(path,[group(1)]),adapter(db),
    {CATALOGUE_SELECTION_SHADOW_MODE:"true"});
  const result=await app.run();
  assert.equal(result.status,200);
  const decision=(await db.query("select * from artist_catalogue_shadow_decisions where release_group_id='g1'")).rows[0];
  assert.equal(decision.qualification,"include");
  const review=(await db.query("select * from artist_catalogue_overrides where release_group_id='g1'")).rows[0];
  assert.equal(review.qualification,"review");
  assert.equal(review.decision_source,"automatic");
  assert.equal((await db.query("select count(*)::int n from albums")).rows[0].n,1);
});
test("discovery deferral persists its page and resumes at the next offset", async () => {
  let defer=true, offsets=[];
  const app=importer(async function(path) {
    if(path.startsWith('/release-group?')) {
      const offset=Number(new URL('https://example.invalid'+path).searchParams.get('offset')); offsets.push(offset);
      if(offset===1 && defer) { defer=false; throw new app.ctx.CatalogueDeferral('deadline'); }
      return { 'release-groups':[group(offset+1)], 'release-group-count':2 };
    }
    return response(path,[]);
  });
  const first=await app.run(); assert.equal(first.status,200); assert.equal(first.body.deferred,'deadline');
  assert.equal(first.body.next_album_index,0);
  const second=await app.run(); assert.equal(second.body.complete,true);
  assert.deepEqual(offsets,[0,1,1]);
  assert.equal((await db.query('select consecutive_failures from artist_import_queue')).rows[0].consecutive_failures,0);
});
test("deadline after one committed album resumes without duplicate counting", async () => {
  let defer=true;
  const app=importer(async function(path) {
    if(path.includes('release-group=g2&') && defer) { defer=false; this.deadline=Date.now()+1000; }
    return response(path,[group(1),group(2)]);
  });
  const first=await app.run(); assert.equal(first.body.next_album_index,1); assert.equal(first.body.deferred,'deadline');
  const second=await app.run(); assert.equal(second.body.albums_accepted_total,2); assert.equal(second.body.complete,true);
  assert.equal((await db.query('select count(*)::int n from albums')).rows[0].n,2);
});
test("existing normalized album is preserved and skipped diagnostics survive", async () => {
  await db.exec("insert into albums(title,artist,external_source,external_id,release_date) values('Álbum 1!','Artist','other','existing','1969-01-01')");
  const app=importer(async path => path.includes('release-group=g2&') ? {releases:[]} : response(path,[group(1),group(2)]));
  const result=await app.run(); assert.equal(result.body.complete,true);
  assert.deepEqual(result.body.skipped,['Album 2']); assert.equal(result.body.skipped_details[0].reason,'no_official_releases');
  const rows=(await db.query('select * from albums')).rows;
  assert.equal(rows.length,1); assert.equal(rows[0].external_id,'existing'); assert.equal(rows[0].title,'Álbum 1!');
});
test("MusicBrainz partial release dates are normalized before the fenced database write", async () => {
  const partial = group(1, { "first-release-date": "1983-03" });
  const app = importer(async path => path.includes("release-group=g1&")
    ? { releases: [{ id: "release1", title: "Partial Date", date: "1983-03", country: "GB" }] }
    : response(path, [partial]));
  const result = await app.run();
  assert.equal(result.status, 200);
  assert.equal((await db.query("select release_date::text release_date from albums")).rows[0].release_date, "1983-03-01");
});
test("secondary-type and artist-era exclusions still apply before snapshot freeze", async () => {
  const app=importer(async path => path.startsWith('/artist/')
    ? {id:'artist',country:'GB','life-span':{ended:true,end:'1970'}}
    : response(path,[group(1),group(2,{'secondary-types':['Live']}),group(4)]));
  const result=await app.run(); assert.equal(result.body.candidate_groups,1); assert.equal(result.body.complete,true);
});
test("shadow discovery sends a structured outside-era anomaly to review without legacy import", async () => {
  const app=importer(async path => path.startsWith('/artist/')
    ? {id:'artist',country:'GB','life-span':{ended:true,end:'1970'}}
    : response(path,[group(4,{title:'Zoom 1979'})]), adapter(db),
    { CATALOGUE_SELECTION_SHADOW_MODE: "true" });
  const result=await app.run(); assert.equal(result.status,200);
  assert.equal((await db.query('select count(*)::int n from albums')).rows[0].n,0);
  const review=(await db.query("select * from artist_catalogue_overrides where release_group_id='g4'")).rows[0];
  assert.equal(review.qualification,'review');
  assert.equal(review.review_reason,'outside_artist_era');
});
test("queue commit error returns failure, never a successful response", async () => {
  const client=adapter(db), call=client.rpc;
  client.rpc=async(name,args)=>args.p_action==='album' ? {error:{message:'injected checkpoint failure'}} : call(name,args);
  const app=importer(async path => response(path,[group(1)]),client);
  const result=await app.run(); assert.equal(result.status,500); assert.match(result.body.error,/checkpoint failure/);
  const row=(await db.query('select * from artist_import_queue')).rows[0];
  assert.equal(row.next_album_index,0); assert.equal(row.consecutive_failures,1);
  const event=(await db.query("select * from artist_catalogue_events where event_type='attempt_failed'")).rows[0];
  assert.equal(event.outcome,'failure'); assert.equal(event.error_category,'checkpoint');
  assert.match(event.error_detail,/checkpoint failure/);
});

test("MusicBrainz deadline gate starts no network request", async () => {
  let calls=0;
  const ctx=loadEdge('',{fetch:async()=>{calls++;return new Response('{}');}});
  const worker=new ctx.CatalogueWorker(adapter(db),11999);
  await assert.rejects(worker.musicBrainzGet('/artist/test'),e=>e instanceof ctx.CatalogueDeferral);
  assert.equal(calls,0);
});
function abortingRpcClient(actions) {
  return { rpc(_name,args) {
    if (!actions.has(args.p_action)) return Promise.resolve({data:{wait_ms:0},error:null});
    return { abortSignal(signal) { return new Promise((_resolve,reject) => {
      signal.addEventListener('abort',()=>{
        const error=new Error('Signal timed out.'); error.name='TimeoutError'; reject(error);
      });
    }); } };
  } };
}
test("rate RPC timeout shortened by the deadline is resumable", async () => {
  const ctx=loadEdge(''); const worker=new ctx.CatalogueWorker(abortingRpcClient(new Set(['rate'])),6200);
  await assert.rejects(worker.rpc('rate'),e=>e instanceof ctx.CatalogueDeferral && e.reason==='deadline');
});
test("cooldown RPC timeout shortened by the deadline is resumable", async () => {
  const ctx=loadEdge(''); const worker=new ctx.CatalogueWorker(abortingRpcClient(new Set(['cooldown'])),6200);
  await assert.rejects(worker.rpc('cooldown',{milliseconds:1100}),e=>e instanceof ctx.CatalogueDeferral);
});
test("a successful MusicBrainz response with too little cooldown reserve defers", async () => {
  let worker;
  const ctx=loadEdge('',{fetch:async()=>{
    worker.deadline=Date.now()+6200;
    return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
  }});
  worker=new ctx.CatalogueWorker(abortingRpcClient(new Set(['cooldown'])),23000);
  await assert.rejects(worker.musicBrainzGet('/artist/test'),e=>e instanceof ctx.CatalogueDeferral);
});
test("lost rate response recovers the same request token without a second reservation", async () => {
  const base=adapter(db); let rateCalls=0; const tokens=[];
  const client={...base,rpc(name,args) {
    if(args.p_action!=='rate') return base.rpc(name,args);
    rateCalls++; tokens.push(args.p_data.request_token);
    if(rateCalls>1) return base.rpc(name,args);
    return {abortSignal(){return (async()=>{await base.rpc(name,args); const e=new Error('Signal timed out.');e.name='TimeoutError';throw e;})();}};
  }};
  const ctx=loadEdge(''); const worker=new ctx.CatalogueWorker(client);
  await worker.acquire(); const result=await worker.coordinate('rate');
  assert.equal(result.recovered,true); assert.equal(rateCalls,2); assert.equal(tokens[0],tokens[1]);
  const state=(await db.query('select * from catalogue_worker_state')).rows[0];
  assert.equal(state.coordination_request_token,tokens[0]);
});
test("rate retry reserves once when the first request never commits", async () => {
  const base=adapter(db); let rateCalls=0; const tokens=[];
  const client={...base,rpc(name,args) {
    if(args.p_action!=='rate') return base.rpc(name,args);
    rateCalls++; tokens.push(args.p_data.request_token);
    if(rateCalls>1) return base.rpc(name,args);
    return {abortSignal(){return Promise.reject(Object.assign(new Error('Signal timed out.'),{name:'TimeoutError'}));}};
  }};
  const ctx=loadEdge(''); const worker=new ctx.CatalogueWorker(client);
  await worker.acquire(); const result=await worker.coordinate('rate');
  assert.equal(result.recovered,undefined); assert.equal(rateCalls,2); assert.equal(tokens[0],tokens[1]);
});
test("rate recovery that exhausts work reserve defers before MusicBrainz", async () => {
  const base=adapter(db); let worker; let rateCalls=0; let networkCalls=0;
  const client={...base,rpc(name,args) {
    if(args.p_action!=='rate') return base.rpc(name,args);
    rateCalls++;
    if(rateCalls>1) return base.rpc(name,args);
    return {abortSignal(){return (async()=>{await base.rpc(name,args);worker.deadline=Date.now()+10000;const e=new Error('Signal timed out.');e.name='TimeoutError';throw e;})();}};
  }};
  const ctx=loadEdge('',{fetch:async()=>{networkCalls++;return new Response('{}')}});
  worker=new ctx.CatalogueWorker(client); await worker.acquire();
  await assert.rejects(worker.musicBrainzGet('/artist/test'),e=>e instanceof ctx.CatalogueDeferral && e.reason==='deadline');
  assert.equal(rateCalls,2); assert.equal(networkCalls,0);
});
test("lost cooldown response recovers once without moving its boundary twice", async () => {
  const base=adapter(db); let cooldownCalls=0; const tokens=[];
  const client={...base,rpc(name,args) {
    if(args.p_action!=='cooldown') return base.rpc(name,args);
    cooldownCalls++; tokens.push(args.p_data.request_token);
    if(cooldownCalls>1) return base.rpc(name,args);
    return {abortSignal(){return (async()=>{await base.rpc(name,args);const e=new Error('Signal timed out.');e.name='TimeoutError';throw e;})();}};
  }};
  const ctx=loadEdge('',{fetch:async()=>new Response('{}',{status:200,headers:{'content-type':'application/json'}})});
  const worker=new ctx.CatalogueWorker(client); await worker.acquire(); await worker.musicBrainzGet('/artist/test');
  assert.equal(cooldownCalls,2); assert.equal(tokens[0],tokens[1]);
  assert.equal((await db.query('select coordination_action from catalogue_worker_state')).rows[0].coordination_action,'cooldown');
});
test("acquisition whose response is lost recovers with the same token exactly once", async () => {
  const base=adapter(db); let acquireCalls=0;
  const client={...base,rpc(name,args) {
    if(args.p_action!=='acquire') return base.rpc(name,args);
    acquireCalls++;
    if(acquireCalls>1) return base.rpc(name,args);
    return {abortSignal() { return (async()=>{
      await base.rpc(name,args);
      const error=new Error('Signal timed out.'); error.name='TimeoutError'; throw error;
    })(); }};
  }};
  const ctx=loadEdge(''); const worker=new ctx.CatalogueWorker(client,23000);
  const acquired=await worker.acquire();
  assert.equal(acquired.recovered,true); assert.equal(acquired.job.id,1);
  assert.equal(acquireCalls,2);
  const row=(await db.query('select * from artist_import_queue where id=1')).rows[0];
  assert.equal(row.attempts,1); assert.equal(row.next_album_index,0); assert.equal(row.studio_albums_imported,0);
  assert.equal((await db.query('select count(*)::int n from artist_catalogue_discovery where job_id=1')).rows[0].n,1);
});
function acquisitionFailureClient(errorFactory) {
  let calls=0; const tokens=[];
  return {
    get calls(){return calls;}, get tokens(){return tokens;},
    client:{rpc(_name,args) {
      calls++; tokens.push(args.p_token);
      return Promise.resolve({data:null,error:errorFactory(calls)});
    }}
  };
}
for (const [label,errorFactory] of [
  ['TimeoutError',()=>Object.assign(new Error('request aborted'),{name:'TimeoutError'})],
  ['Signal timed out',()=>new Error('Signal timed out.')],
  ['Gateway Timeout',()=>new Error('Gateway Timeout')],
  ['status 504',()=>({message:'upstream unavailable',status:504})],
  ['status 503',()=>({message:'upstream unavailable',statusCode:503})],
  ['status 502',()=>({message:'upstream unavailable',code:'502'})]
]) test(`acquisition ${label} is retried once with the same worker token`, async () => {
  const attempt=acquisitionFailureClient(call=>call===1 ? errorFactory() : null);
  attempt.client.rpc=(_name,args)=>{
    attempt.tokens.push(args.p_token);
    const call=attempt.tokens.length;
    return Promise.resolve(call===1
      ? {data:null,error:errorFactory()}
      : {data:{idle:true},error:null});
  };
  const ctx=loadEdge(''); const worker=new ctx.CatalogueWorker(attempt.client);
  const result=await worker.acquire();
  assert.equal(result.idle,true); assert.equal(attempt.tokens.length,2);
  assert.equal(attempt.tokens[0],attempt.tokens[1]);
});
test("a second transient acquisition failure fails safely without a third attempt", async () => {
  let calls=0;
  const client={rpc(){calls++;return Promise.resolve({data:null,error:new Error('Gateway Timeout')});}};
  const ctx=loadEdge(''); const worker=new ctx.CatalogueWorker(client);
  await assert.rejects(worker.acquire(),/Gateway Timeout/); assert.equal(calls,2);
});
for (const [label,error] of [
  ['PostgreSQL semantic error',{message:'duplicate key value violates unique constraint',code:'23505'}],
  ['authorization error',{message:'permission denied',status:403,code:'42501'}],
  ['fencing state error',{message:'Catalogue lease expired or superseded',code:'55000'}],
  ['validation error',{message:'invalid input syntax for type uuid',code:'22P02'}],
  ['statement timeout',{message:'canceling statement due to statement timeout',code:'57014'}],
  ['lock timeout',{message:'canceling statement due to lock timeout',code:'55P03'}]
]) test(`acquisition ${label} is not retried`, async () => {
  let calls=0;
  const client={rpc(){calls++;return Promise.resolve({data:null,error});}};
  const ctx=loadEdge(''); const worker=new ctx.CatalogueWorker(client);
  await assert.rejects(worker.acquire(),e=>e instanceof ctx.CatalogueDatabaseError);
  assert.equal(calls,1);
});
test("same-token retry performs normal acquisition when the first request never commits", async () => {
  const base=adapter(db); let acquireCalls=0;
  const client={...base,rpc(name,args) {
    if(args.p_action!=='acquire' || ++acquireCalls>1) return base.rpc(name,args);
    return {abortSignal(signal) { return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{
      const error=new Error('Signal timed out.'); error.name='TimeoutError'; reject(error);
    })); }};
  }};
  const ctx=loadEdge('',{AbortSignal:{...AbortSignal,timeout:()=>AbortSignal.timeout(5),any:AbortSignal.any.bind(AbortSignal)}});
  const worker=new ctx.CatalogueWorker(client,23000);
  const acquired=await worker.acquire();
  assert.equal(acquired.recovered,undefined); assert.equal(acquired.job.id,1);
  assert.equal(acquireCalls,2);
  assert.equal((await db.query('select attempts from artist_import_queue where id=1')).rows[0].attempts,1);
});
test("recovered acquisition with inadequate work budget defers without network or failure", async () => {
  const base=adapter(db); let worker; let networkCalls=0; let acquireCalls=0;
  const client={...base,rpc(name,args) {
    if(args.p_action!=='acquire') return base.rpc(name,args);
    acquireCalls++;
    if(acquireCalls>1) return base.rpc(name,args);
    return {abortSignal() { return (async()=>{
      await base.rpc(name,args); worker.deadline=Date.now()+5500;
      const error=new Error('Signal timed out.'); error.name='TimeoutError'; throw error;
    })(); }};
  }};
  const ctx=loadEdge('',{fetch:async()=>{networkCalls++;return new Response('{}')}});
  worker=new ctx.CatalogueWorker(client,23000);
  const acquired=await worker.acquire(); assert.equal(acquired.recovered,true);
  const deferral=await assert.rejects(worker.musicBrainzGet('/artist/test'),e=>e instanceof ctx.CatalogueDeferral);
  await worker.finish(new ctx.CatalogueDeferral('deadline'));
  assert.equal(networkCalls,0);
  const row=(await db.query('select * from artist_import_queue where id=1')).rows[0];
  assert.equal(row.status,'pending'); assert.equal(row.attempts,1); assert.equal(row.consecutive_failures,0);
  assert.equal(row.next_album_index,0); assert.equal(row.studio_albums_imported,0);
});
test("unrecoverable acquisition timeout remains fenced", async () => {
  const ctx=loadEdge(''); const worker=new ctx.CatalogueWorker(abortingRpcClient(new Set(['acquire'])),6200);
  await assert.rejects(worker.acquire(),e=>e instanceof ctx.CatalogueDatabaseError);
});
test("album checkpoint timeout remains a fenced database failure", async () => {
  const ctx=loadEdge(''); const worker=new ctx.CatalogueWorker(abortingRpcClient(new Set(['album'])),6200);
  worker.jobId=1;
  await assert.rejects(worker.rpc('album',{}),e=>e instanceof ctx.CatalogueDatabaseError);
});
test("configured contact is validated with safe public-URL fallback", () => {
  const ctx=loadEdge('');
  assert.equal(ctx.musicBrainzIdentity('person@valid-domain.test'),'BankOfMusic/1.0 (person@valid-domain.test)');
  for(const contact of [undefined,'','x@example.invalid','x@example.com','bad\r\nvalue']) {
    assert.equal(ctx.musicBrainzIdentity(contact),'BankOfMusic/1.0 (https://bank-of-music.pages.dev/)');
  }
});
test("429 and Retry-After become shared resumable deferrals", async () => {
  let calls=0;
  const ctx=loadEdge('',{fetch:async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'120'}});}});
  const worker=new ctx.CatalogueWorker(adapter(db)); await worker.acquire();
  await assert.rejects(worker.musicBrainzGet('/artist/test'),e=>e instanceof ctx.CatalogueDeferral && e.retryMs===120000);
  await worker.finish(new ctx.CatalogueDeferral('rate_limit',120000));
  const row=(await db.query('select * from artist_import_queue')).rows[0];
  assert.equal(row.consecutive_failures,0); assert.equal(row.status,'pending'); assert.equal(calls,1);
});
test("lease failure in rate gate stops before network access", async () => {
  const ctx=loadEdge(''); const worker=new ctx.CatalogueWorker(adapter(db)); await worker.acquire();
  await db.exec("update catalogue_worker_state set expires_at=now()-interval '1 second'");
  await assert.rejects(worker.musicBrainzGet('/artist/test'),/expired or superseded/);
});
test("response-body reading is covered by request abort", async () => {
  // Accelerate only the HTTP abort timer; DB/rate coordination is real.
  const ctx=loadEdge('',{
    setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,10)),
    fetch:async(_url,options)=>({ok:true,json:()=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('body aborted'))))})
  });
  const worker=new ctx.CatalogueWorker(adapter(db),5500); await worker.acquire();
  await assert.rejects(worker.musicBrainzGet('/artist/test'),e=>e instanceof ctx.CatalogueDeferral && e.reason==='deadline');
});
test("network failures remain failures rather than being disguised as budget deferrals", async () => {
  const ctx=loadEdge('',{fetch:async()=>{throw Error('connection failed');}});
  const worker=new ctx.CatalogueWorker(adapter(db),23000); await worker.acquire();
  await assert.rejects(worker.musicBrainzGet('/artist/test'),/connection failed/);
});
test("inspector commits debug rows under the shared lease without claiming artist jobs", async () => {
  let handler;
  const ctx=loadEdge(readFileSync(new URL('../functions/artist-catalog-inspector/index.ts',import.meta.url),'utf8'),{
    Deno:{env:{get:()=> 'test-only'},serve:fn=>{handler=fn;}},
    createClient:()=>adapter(db),requireServiceOrAdmin:async()=>({ok:true})
  });
  ctx.CatalogueWorker.prototype.musicBrainzGet=async path=>path.startsWith('/artist/?')
    ? {artists:[{id:'artist',name:'Artist'}]}
    : {'release-groups':[group(1),group(2,{'secondary-types':['Live']})],'release-group-count':2};
  const result=await handler(new Request('https://example.invalid',{method:'POST',body:JSON.stringify({artist:'Artist'})}));
  assert.equal(result.status,200); assert.equal((await result.json()).total_album_release_groups,2);
  assert.equal((await db.query('select count(*)::int n from artist_release_group_debug')).rows[0].n,2);
  assert.equal((await db.query('select attempts from artist_import_queue')).rows[0].attempts,0);
});
