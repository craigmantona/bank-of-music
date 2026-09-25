import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const [app, styles, discover] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../bom-foundation.css', import.meta.url), 'utf8'),
  readFile(new URL('../bom-discover.js', import.meta.url), 'utf8')
]);
function extract(start, end) { return app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start))); }

test('Quick Rate excludes own track ratings, deleted and duplicate tracks without mutating catalogue', () => {
  const songs = [
    {id:1,title:'Rated',artist:'A'}, {id:2,title:'Keep',artist:'B'},
    {id:3,title:'Keep',artist:'B'}, {id:4,title:'Deleted',artist:'C',is_deleted:true},
    {id:5,title:'Other user rated',artist:'D'}
  ];
  const context = vm.createContext({normaliseCompare: value => String(value || '').toLowerCase()});
  vm.runInContext(extract('function buildQuickRateQueue', 'async function fetchQuickRateRows'), context);
  const queue = context.buildQuickRateQueue(songs, [{user_id:'me', song_id:1}, {user_id:'other', song_id:5}], 'me', () => 0);
  assert.deepEqual(Array.from(queue, a => a.id), [5,2]);
  assert.deepEqual(songs.map(a => a.id), [1,2,3,4,5]);
  assert.equal(context.buildQuickRateQueue([], [], 'me').length, 0);
});

test('Quick Rate avoids consecutive artists where another queued track is available', () => {
  const songs = [{id:1,title:'A1',artist:'A'}, {id:2,title:'A2',artist:'A'}, {id:3,title:'B1',artist:'B'}];
  const context = vm.createContext({normaliseCompare: value => String(value || '').toLowerCase()});
  vm.runInContext(extract('function buildQuickRateQueue', 'async function fetchQuickRateRows'), context);
  const queue = context.buildQuickRateQueue(songs, [], 'me', () => 0.99);
  assert.deepEqual(Array.from(queue, a => a.artist), ['A','B','A']);
});

test('Quick Rate paginates own ratings and propagates query failures', async () => {
  const calls = [];
  const query = {select(){return this}, order(){return this}, eq(...args){calls.push(args); return this}, async range(from, to){calls.push([from,to]); return {data:from === 0 ? Array(1000).fill({id:1}) : [{id:2}]}}};
  const context = vm.createContext({supabaseClient:{from:()=>query}});
  vm.runInContext(extract('async function fetchQuickRateRows', 'async function openQuickRate'), context);
  assert.equal((await context.fetchQuickRateRows('song_ratings','id','me')).length,1001);
  assert.deepEqual(calls, [['user_id','me'],[0,999],['user_id','me'],[1000,1999]]);
  query.range = async () => ({error: new Error('offline')});
  await assert.rejects(context.fetchQuickRateRows('albums','*'), /offline/);
});

test('Quick Rate reuses track rating upsert and reports success only after persistence', async () => {
  const writes = [], local = [];
  let error = null;
  const tableClient = {
    upsert:async (rows, options)=>{writes.push({table:'song_ratings',rows,options});return {error}},
    select(){return this}, eq(){return Promise.resolve({data:[],error:null})}
  };
  const context = vm.createContext({
    currentUser:{id:'me'}, document:{getElementById:()=>null}, globalSearchMessage:{}, selectedItem:null, selectedItemDetail:null,
    allSongs:[{id:123,title:'Track',artist:'Artist'}], allSongRatings:[],
    supabaseClient:{from:()=>tableClient},
    setMessage(){}, normaliseCompare:value=>String(value).toLowerCase(), upsertLocalSongRating:(...args)=>local.push(args),
    updateTrackRowUi(){}, updateStarSelector(){}, renderLibrary(){}
  });
  vm.runInContext(extract('async function saveTrackRating(', 'async function deleteTrackRating'),context);
  assert.equal(await context.saveTrackRating(123, 8), true);
  assert.equal(writes[0].table,'song_ratings');
  assert.equal(writes[0].rows[0].user_id,'me');
  assert.equal(writes[0].rows[0].rating,8);
  assert.equal(writes[0].options.onConflict,'user_id,song_id');
  error = {message:'offline'};
  assert.equal(await context.saveTrackRating(123, 9), undefined);
  assert.equal(local.length,1);
  context.currentUser = null;
  assert.equal(await context.saveTrackRating(123, 9),undefined);
  assert.equal(writes.length,2);
});

test('Quick Rate does not overwrite a different selected track detail rating', async () => {
  const writes = [], local = [];
  const detailRating = {textContent:'4/10'};
  const tableClient = {
    upsert:async (rows, options)=>{writes.push({rows,options});return {error:null}},
    select(){return this}, eq(){return Promise.resolve({data:[],error:null})}
  };
  const context = vm.createContext({
    currentUser:{id:'me'}, document:{getElementById:()=>null}, globalSearchMessage:{},
    selectedItem:{type:'song',savedSongId:1,title:'Track A',artist:'Artist A'},
    selectedItemDetail:{querySelector:()=>detailRating},
    allSongs:[{id:1,title:'Track A',artist:'Artist A'}, {id:2,title:'Track B',artist:'Artist B'}],
    allSongRatings:[], supabaseClient:{from:()=>tableClient},
    setMessage(){}, normaliseCompare:value=>String(value).toLowerCase(),
    upsertLocalSongRating:(...args)=>local.push(args), updateTrackRowUi(){}, updateStarSelector(){}, renderLibrary(){}
  });
  vm.runInContext(extract('async function saveTrackRating(', 'async function deleteTrackRating'),context);

  assert.equal(await context.saveTrackRating(2, 9), true);
  assert.equal(detailRating.textContent, '4/10');
  assert.equal(writes[0].rows[0].song_id, 2);
  assert.deepEqual(local[0], [2, 9]);
});

function quickRateSpotifyContext({ cached = null, response = null } = {}) {
  const rendered = [];
  const requests = [];
  const classList = { add() {}, remove() {} };
  const context = vm.createContext({
    console: { error() {} },
    Date,
    SPOTIFY_TOKEN_FUNCTION_URL: 'https://project.invalid/functions/v1/rapid-processor',
    window: { SUPABASE_ANON_KEY: 'anon-key' },
    supabaseClient: { auth: { getSession: async () => ({ data: { session: { access_token: 'user-token' } } }) } },
    fetch: async (...args) => {
      requests.push(args);
      return response || new Response(JSON.stringify({ status: 'no_match' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    },
    getCachedSpotifyMatch: () => cached,
    cacheSpotifyMatch() {},
    recordMusicProviderClick: async () => {},
    buildSpotifyEmbedUrl: ({ spotifyItem }) => `https://open.spotify.com/embed/track/${spotifyItem.id}`,
    getSpotifyEntityId: item => item.id,
    renderSpotifyEmbed: options => { rendered.push(options); return true; },
    getSpotifySearchFallbackUrl: song => `https://open.spotify.com/search/${song.title}`,
    escapeHtml: value => String(value),
    URLSearchParams,
    Response
  });
  vm.runInContext(extract('function getQuickRateSpotifyItem', 'async function fetchQuickRateRows'), context);
  return { context, rendered, requests, classList };
}

test('Quick Rate renders a centrally stored Spotify ID without resolver search', async () => {
  const { context, rendered, requests, classList } = quickRateSpotifyContext();
  const song = { id: 12, title: 'Stored track', artist: 'Artist', spotify_track_id: 'stored123' };
  const target = { classList, innerHTML: '' };
  const button = { disabled: false, textContent: 'Listen on Spotify' };

  assert.equal(await context.listenToQuickRateTrack({ song, album: { title: 'Album' }, target, button }), true);
  assert.equal(requests.length, 0);
  assert.equal(rendered[0].embedUrl, 'https://open.spotify.com/embed/track/stored123');
});

test('Quick Rate resolves one unmatched song lazily and reuses the returned ID', async () => {
  const response = new Response(JSON.stringify({ status: 'matched', spotify_track_id: 'resolved456' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
  const { context, rendered, requests, classList } = quickRateSpotifyContext({ response });
  const song = { id: 34, title: 'Unmatched track', artist: 'Artist' };
  const target = { classList, innerHTML: '' };
  const button = { disabled: false, textContent: 'Listen on Spotify' };

  assert.equal(await context.listenToQuickRateTrack({ song, album: { title: 'Album' }, target, button }), true);
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0][1].body), { action: 'resolve_track', song_id: 34 });
  assert.equal(song.spotify_track_id, 'resolved456');
  assert.equal(rendered[0].embedUrl, 'https://open.spotify.com/embed/track/resolved456');

  assert.equal(await context.listenToQuickRateTrack({ song, album: { title: 'Album' }, target, button }), true);
  assert.equal(requests.length, 1);
  assert.equal(rendered[1].embedUrl, 'https://open.spotify.com/embed/track/resolved456');
});

test('failed Spotify resolution leaves Quick Rate usable with its search fallback', async () => {
  const { context, rendered, classList } = quickRateSpotifyContext();
  const target = { classList, innerHTML: '' };
  const button = { disabled: false, textContent: 'Listen on Spotify' };

  assert.equal(await context.listenToQuickRateTrack({
    song: { id: 56, title: 'Missing track', artist: 'Artist' },
    album: null,
    target,
    button
  }), false);
  assert.equal(rendered.length, 0);
  assert.match(target.innerHTML, /could not find an exact Spotify match/);
  assert.match(target.innerHTML, /Search in Spotify/);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Listen on Spotify');
});

test('rating and Skip do not trigger Spotify resolution', () => {
  const quickRate = extract('async function openQuickRate', 'window.handleQuickRateClick');
  const listenStart = quickRate.indexOf('card.querySelector("[data-quick-listen]").onclick');
  const skipStart = quickRate.indexOf('card.querySelector("[data-quick-skip]").onclick');
  const listenHandler = quickRate.slice(listenStart, skipStart);
  const skipHandler = quickRate.slice(skipStart, quickRate.indexOf('dialog.saveRating'));
  const ratingHandler = quickRate.slice(quickRate.indexOf('dialog.saveRating'));
  assert.ok(listenStart >= 0 && skipStart > listenStart);
  assert.match(listenHandler, /listenToQuickRateTrack/);
  assert.doesNotMatch(skipHandler, /listenToQuickRateTrack|resolveQuickRateSpotifyTrack/);
  assert.doesNotMatch(ratingHandler, /listenToQuickRateTrack|resolveQuickRateSpotifyTrack/);
});

test('Quick Rate track card keeps the requested metadata, Skip, and responsive rating layout', () => {
  const quickRate = extract('async function openQuickRate', 'window.handleQuickRateClick');
  assert.match(quickRate, /song\.title/);
  assert.match(quickRate, /song\.artist/);
  assert.match(quickRate, /album\.title/);
  assert.match(quickRate, /getStageOneDiscoverYear\(album\)/);
  assert.match(quickRate, /data-quick-skip/);
  assert.match(quickRate, /Skipped\. No rating saved\./);
  assert.match(styles, /@media \(max-width: 480px\)[\s\S]*?bom-v1-track-rating-popover \{ grid-template-columns: repeat\(5, 1fr\)/);
  assert.match(discover, /One track at a time/);
});
