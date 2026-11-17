import assert from "node:assert/strict";
import test from "node:test";
import { automaticPromotionDesign, csvForCandidates, discoverCandidates,
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
