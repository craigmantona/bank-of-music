import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
function extract(start, end) { return app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start))); }

test('Quick Rate excludes own ratings and ineligible albums, shuffles without mutating catalogue', () => {
  const albums = Array.from({length: 6}, (_, i) => ({id: i + 1, eligible: i !== 4}));
  const context = vm.createContext({isLikelyStudioAlbum: a => a.eligible});
  vm.runInContext(extract('function buildQuickRateQueue', 'async function fetchQuickRateRows'), context);
  const queue = context.buildQuickRateQueue(albums, [{user_id:'me', album_id:1}, {user_id:'other', album_id:2}], 'me', () => 0);
  assert.deepEqual(Array.from(queue, a => a.id), [3,4,6,2]);
  assert.deepEqual(albums.map(a => a.id), [1,2,3,4,5,6]);
  assert.equal(context.buildQuickRateQueue([], [], 'me').length, 0);
});

test('Quick Rate paginates own ratings and propagates query failures', async () => {
  const calls = [];
  const query = {select(){return this}, order(){return this}, eq(...args){calls.push(args); return this}, async range(from, to){calls.push([from,to]); return {data:from === 0 ? Array(1000).fill({id:1}) : [{id:2}]}}};
  const context = vm.createContext({supabaseClient:{from:()=>query}});
  vm.runInContext(extract('async function fetchQuickRateRows', 'async function openQuickRate'), context);
  assert.equal((await context.fetchQuickRateRows('ratings','id','me')).length,1001);
  assert.deepEqual(calls, [['user_id','me'],[0,999],['user_id','me'],[1000,1999]]);
  query.range = async () => ({error: new Error('offline')});
  await assert.rejects(context.fetchQuickRateRows('albums','*'), /offline/);
});

test('Quick Rate reuses rating upsert and reports success only after persistence', async () => {
  const writes = [], local = [];
  let error = null;
  const context = vm.createContext({
    currentUser:{id:'me'}, document:{getElementById:()=>null}, globalSearchMessage:{},
    supabaseClient:{from:table=>({upsert:async (rows, options)=>{writes.push({table,rows,options});return {error}}})},
    setMessage(){}, upsertLocalAlbumRating:(...args)=>local.push(args),
    updateStageOneAlbumRatingUi(){throw new Error('Quick Rate should not update album detail')},
    renderLibrary(){}, renderRecommendations(){}
  });
  vm.runInContext(extract('async function saveAlbumRating(', 'async function deleteAlbumRating'),context);
  assert.equal(await context.saveAlbumRating(123, 8), true);
  assert.equal(writes[0].table,'ratings');
  assert.equal(writes[0].rows[0].user_id,'me');
  assert.equal(writes[0].rows[0].rating,8);
  assert.equal(writes[0].options.onConflict,'user_id,album_id');
  error = {message:'offline'};
  assert.equal(await context.saveAlbumRating(124, 9), undefined);
  assert.equal(local.length,1);
  context.currentUser = null;
  assert.equal(await context.saveAlbumRating(125, 9),undefined);
  assert.equal(writes.length,2);
});
