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
  const recordingId = 'cae8bbec-c2ff-4972-9218-8f90acb07b1b';
  const songs = [
    {id:1,title:'Rated',artist:'A',external_source:'musicbrainz',external_id:recordingId},
    {id:2,title:'Keep',artist:'B',external_source:'musicbrainz',external_id:recordingId},
    {id:3,title:'Keep',artist:'B'}, {id:4,title:'Deleted',artist:'C',is_deleted:true},
    {id:5,title:'Other user rated',artist:'D'}
  ];
  const context = vm.createContext({normaliseCompare: value => String(value || '').toLowerCase()});
  vm.runInContext(extract('function getConfirmedMusicBrainzRecordingId', 'function getSongRatingOccurrenceIds'), context);
  vm.runInContext(extract('function buildQuickRateQueue', 'async function fetchQuickRateRows'), context);
  const queue = context.buildQuickRateQueue(songs, [{user_id:'me', song_id:1}, {user_id:'other', song_id:5}], 'me', () => 0);
  assert.deepEqual(Array.from(queue, a => a.id), [5,3]);
  assert.deepEqual(songs.map(a => a.id), [1,2,3,4,5]);
  assert.equal(context.buildQuickRateQueue([], [], 'me').length, 0);
});

test('Quick Rate avoids consecutive artists where another queued track is available', () => {
  const songs = [{id:1,title:'A1',artist:'A'}, {id:2,title:'A2',artist:'A'}, {id:3,title:'B1',artist:'B'}];
  const context = vm.createContext({normaliseCompare: value => String(value || '').toLowerCase()});
  vm.runInContext(extract('function getConfirmedMusicBrainzRecordingId', 'function getSongRatingOccurrenceIds'), context);
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
    getSongRatingOccurrenceIds:id=>[Number(id)], updateTrackRowUi(){}, updateStarSelector(){}, renderLibrary(){}
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

test('track rating follows an exact confirmed MusicBrainz recording across album occurrences', async () => {
  const writes = [], local = [], refreshed = [];
  const recordingId = 'cae8bbec-c2ff-4972-9218-8f90acb07b1b';
  let context;
  const tableClient = {
    upsert: async (rows, options) => { writes.push({rows,options}); return {error:null}; },
    select(){ return this; },
    eq(){ return Promise.resolve({data:context.allSongRatings,error:null}); }
  };
  context = vm.createContext({
    currentUser:{id:'me'}, document:{getElementById:()=>null}, globalSearchMessage:{},
    selectedItem:{type:'song',savedSongId:202}, selectedItemDetail:null,
    allSongs:[
      {id:6665,album_id:1,title:'How Soon Is Now?',artist:'The Smiths',external_source:'musicbrainz',external_id:recordingId},
      {id:16592,album_id:2,title:'How Soon Is Now?',artist:'The Smiths',external_source:'musicbrainz',external_id:recordingId},
      {id:202,album_id:3,title:'How Soon Is Now?',artist:'The Smiths',external_source:'musicbrainz',external_id:'11111111-1111-4111-8111-111111111111'}
    ],
    allSongRatings:[{user_id:'me',song_id:6665,rating:7}], supabaseClient:{from:()=>tableClient}, setMessage(){},
    upsertLocalSongRating(){}, updateTrackRowUi:id=>refreshed.push(id),
    updateStarSelector(){}, renderLibrary(){}
  });
  context.upsertLocalSongRating = (songId, rating) => {
    local.push([songId, rating]);
    const existing = context.allSongRatings.find(row => row.user_id === 'me' && Number(row.song_id) === Number(songId));
    if (existing) existing.rating = rating;
    else context.allSongRatings.push({user_id:'me',song_id:songId,rating});
  };
  vm.runInContext(extract('function getYourSongRating', 'function renderStarSelector'),context);
  vm.runInContext(extract('async function saveTrackRating(', 'async function deleteTrackRating'),context);

  assert.equal(context.getYourSongRating(16592), 7);
  assert.equal(context.getYourSongRating(202), null);
  assert.equal(await context.saveTrackRating(16592, 8), true);
  assert.deepEqual(Array.from(writes[0].rows, row => ({...row})), [
    {user_id:'me',song_id:6665,rating:8},
    {user_id:'me',song_id:16592,rating:8}
  ]);
  assert.deepEqual(local, [[6665,8],[16592,8]]);
  assert.deepEqual(refreshed, [6665,16592]);
  assert.equal(context.getYourSongRating(6665), 8);
  assert.equal(context.getYourSongRating(16592), 8);
  assert.equal(context.getYourSongRating(202), null);
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
    upsertLocalSongRating:(...args)=>local.push(args), getSongRatingOccurrenceIds:id=>[Number(id)],
    updateTrackRowUi(){}, updateStarSelector(){}, renderLibrary(){}
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
  const storage = new Map();
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
  context.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };
  vm.runInContext(extract('function getQuickRateSpotifyItem', 'async function fetchQuickRateRows'), context);
  return { context, rendered, requests, classList, storage };
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

test('Quick Rate shares a resolver cooldown while stored IDs still bypass matching', async () => {
  const expiry = new Date(Date.now() + 3600000).toISOString();
  const response = new Response(JSON.stringify({
    error: 'Spotify is temporarily rate limited.',
    retry_after: 3600,
    cooldown_expires_at: expiry,
    reason: 'QUOTA_EXCEEDED'
  }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' }
  });
  const { context, requests, classList } = quickRateSpotifyContext({ response });
  const target = { classList, innerHTML: '' };
  const button = { disabled: false, textContent: 'Listen on Spotify' };

  assert.equal(await context.listenToQuickRateTrack({
    song: { id: 35, title: 'Needs matching', artist: 'Artist' }, album: null, target, button
  }), false);
  assert.equal(requests.length, 1);
  assert.match(target.innerHTML, /New track matching is temporarily unavailable/);

  assert.equal(await context.listenToQuickRateTrack({
    song: { id: 36, title: 'Also unmatched', artist: 'Artist' }, album: null, target, button
  }), false);
  assert.equal(requests.length, 1, 'browser cooldown must prevent another resolver request');

  assert.equal(await context.listenToQuickRateTrack({
    song: { id: 37, title: 'Stored', artist: 'Artist', spotify_track_id: 'stored789' },
    album: null,
    target,
    button
  }), true);
  assert.equal(requests.length, 1, 'persisted Spotify IDs must bypass the resolver cooldown');
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
