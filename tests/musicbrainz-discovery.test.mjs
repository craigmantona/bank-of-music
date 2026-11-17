import assert from "node:assert/strict";
import test from "node:test";
import { automaticPromotionDesign, buildDiscoveryWindows, csvForCandidates, discoverCandidates,
  createMusicBrainzGet, discoverHistoricalCandidates, MusicBrainzRetryExhausted,
  qualifyDiscoveryCandidate } from "../scripts/lib/musicbrainz-discovery.mjs";

const group={id:"g1",title:"Album","primary-type":"Album","secondary-types":[],
  "first-release-date":"2026-10-01",score:100,"artist-credit":[{artist:{id:"a1",name:"Artist"}}]};
const releases=[{id:"r1",status:"Official",date:"2026-10-01",country:"GB"}];

test("strict discovery accepts evidenced albums and rejects exclusions and secondary types",()=>{
  assert.equal(qualifyDiscoveryCandidate(group,releases).accepted,true);
  assert.equal(qualifyDiscoveryCandidate({...group,"secondary-types":["Compilation"]},releases).accepted,false);
  assert.equal(qualifyDiscoveryCandidate(group,releases,{artist_ids:["a1"]}).reason,"excluded_artist");
});

test("bounded discovery deduplicates artists and produces review-only rows",async()=>{
  let calls=0;
  const get=async path=>{calls+=1;return path.startsWith("/release-group")
    ? {"release-groups":[group,{...group,id:"g2",title:"Second"}]} : {releases};};
  const result=await discoverCandidates({get,query:"test",maxPages:1,pageSize:25,maxCandidates:10});
  assert.equal(result.accepted.length,1); assert.equal(result.accepted[0].proposed_action,"review_for_queue");
  assert.equal(calls,3);
  assert.match(csvForCandidates(result.accepted),/musicbrainz_artist_id/);
});

test("automatic promotion design remains disabled and idempotent by artist ID",()=>{
  const design=automaticPromotionDesign([{musicbrainz_artist_id:"a1",artist_name:"Artist",proposed_priority:100}]);
  assert.equal(design.enabled,false);
  assert.deepEqual(design.proposed_rows,[{musicbrainz_artist_id:"a1",artist_name:"Artist",priority:100}]);
});

test("historical windows cover every decade plus recent releases",()=>{
  const windows=buildDiscoveryWindows({startYear:1950,endYear:2026,
    now:new Date("2026-11-17T00:00:00Z")});
  assert.deepEqual(windows.map(window=>window.id),["recent","decade-1950","decade-1960",
    "decade-1970","decade-1980","decade-1990","decade-2000","decade-2010","decade-2020"]);
  assert.match(windows[0].query,/2026-10-18 TO 2026-11-17/);
});

test("historical discovery is bounded, resumable and rotates decades fairly",async()=>{
  const windows=buildDiscoveryWindows({startYear:1950,endYear:1979,
    now:new Date("2026-11-17T00:00:00Z")});
  const releaseGroupCalls=[];
  const get=async path=>{
    if(path.startsWith("/release-group")){
      releaseGroupCalls.push(path);
      const id=`g${releaseGroupCalls.length}`;
      const artistId=`a${releaseGroupCalls.length}`;
      return {"release-groups":[{...group,id,"artist-credit":[{artist:{id:artistId,name:`Artist ${artistId}`}}]}]};
    }
    return {releases};
  };
  const first=await discoverHistoricalCandidates({get,windows,maxWindows:2,pageSize:10,maxCandidates:10});
  assert.deepEqual(first.scanned_windows.map(window=>window.id),["recent","decade-1950"]);
  assert.equal(first.resume_state.next_window_id,"decade-1960");
  assert.match(releaseGroupCalls[0],/offset=0/);
  const second=await discoverHistoricalCandidates({get,windows,state:first.resume_state,
    maxWindows:2,pageSize:10,maxCandidates:10});
  assert.deepEqual(second.scanned_windows.map(window=>window.id),["decade-1960","decade-1970"]);
  assert.equal(second.resume_state.next_window_id,"recent");
});

test("historical resume state prevents duplicate release groups and artists",async()=>{
  const windows=buildDiscoveryWindows({startYear:1950,endYear:1959,
    now:new Date("2026-11-17T00:00:00Z")});
  const get=async path=>path.startsWith("/release-group")
    ? {"release-groups":[group]} : {releases};
  const state={next_window_id:"recent",offsets:{},seen_release_group_ids:["g1"],seen_artist_ids:["a1"]};
  const result=await discoverHistoricalCandidates({get,windows,state,maxWindows:2});
  assert.equal(result.accepted.length,0);
  assert.ok(result.rejected.every(row=>row.reason==="excluded_release_group"));
});

test("MusicBrainz discovery retries transient responses with bounded exponential backoff",async()=>{
  let clock=0;
  const waits=[];
  const statuses=[503,500,200];
  const get=createMusicBrainzGet({identity:"BOM test",now:()=>clock,
    sleep:async ms=>{waits.push(ms);clock+=ms;},maxAttempts:4,baseBackoffMs:1100,maxBackoffMs:4400,
    fetchImpl:async()=>{const status=statuses.shift();return {ok:status===200,status,
      headers:{get:()=>null},json:async()=>({ok:true})};}});
  assert.deepEqual(await get("/release-group?test"),{ok:true});
  assert.deepEqual(waits,[1100,2200]);
});

test("retry exhaustion returns resumable partial historical discovery",async()=>{
  const windows=buildDiscoveryWindows({startYear:1950,endYear:1959,
    now:new Date("2026-11-17T00:00:00Z")});
  let releases=0;
  const second={...group,id:"g2","artist-credit":[{artist:{id:"a2",name:"Artist 2"}}]};
  const get=async path=>{
    if(path.startsWith("/release-group")) return {"release-groups":[group,second]};
    releases+=1;
    if(releases===1) return {releases:[...globalThis.Array.from([{id:"r1",status:"Official",date:"2026-10-01",country:"GB"}])]};
    throw new MusicBrainzRetryExhausted("budget exhausted",{status:503,path,attempts:4});
  };
  const result=await discoverHistoricalCandidates({get,windows,maxWindows:1,pageSize:25});
  assert.equal(result.accepted.length,1);
  assert.equal(result.interrupted.status,503);
  assert.equal(result.resume_state.next_window_id,"recent");
  assert.equal(result.resume_state.offsets.recent,0);
  assert.ok(result.resume_state.seen_release_group_ids.includes("g1"));
});
