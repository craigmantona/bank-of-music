import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const identitySource = app.slice(app.indexOf('function normaliseAlbumTitleKey'), app.indexOf('function normaliseReleaseDate'));
const saveSource = app.slice(app.indexOf('const albumAutoSaveInFlight = new Map();'), app.indexOf('async function importSelectedAlbum()'));
const renderSource = app.slice(app.indexOf('async function renderSelectedItem()'), app.indexOf('function getSavedAlbumByTitleArtist'));
const modelSource = app.slice(app.indexOf('function buildStageOneAlbumModel('), app.indexOf('async function renderStageOneAlbum('));
const release = () => ({ id: 'release-1', title: 'Resolved Album', date: '2001-03-04', 'release-group': { id: 'group-1' }, 'artist-credit': [{ name: 'An Artist' }], media: [{ 'track-count': 2, tracks: [
  { title: 'First Song', recording: { id: 'recording-1' } }, { title: 'Second Song', recording: { id: 'recording-2' } }
] }] });
const selection = () => ({ type: 'album', title: 'Resolved Album', artist: 'An Artist', externalId: 'release-1', releaseGroupId: 'group-1', coverUrl: 'https://example.test/cover.jpg' });
const saved = () => ({ id: 10, title: 'Resolved Album', artist: 'An Artist', external_source: 'musicbrainz', external_id: 'release-1', musicbrainz_release_group_id: 'group-1', cover_art_url: 'saved-cover.jpg' });
function harness({ albums = [], songs = [], cached = true, detail = release(), failResolution = false, beforeAlbumWrite,
  autoAddResult = { status: 'needs_correction', reason: 'catalogue_confirmation_required' }, autoAddedAlbum = null, autoAddedSongs = [],
  deferRemoteCommit = false } = {}) {
  const db = { albums: structuredClone(albums), songs: structuredClone(songs) }, writes = [], fetches = [], invocations = [], renderedModels = [], reviewAlbumIds = [];
  let releaseRemoteCommit;
  const remoteCommit = deferRemoteCommit ? new Promise(resolve => { releaseRemoteCommit = resolve; }) : null;
  let nextId = 100;
  const context = {
    currentUser: { id: 'user-1' }, isAdmin: false, selectedItem: selection(), allAlbums: cached ? structuredClone(albums) : [], allSongs: cached ? structuredClone(songs) : [],
    console: { warn() {}, error() {} }, albumTrackCache: {}, releaseGroupCoverCache: {}, selectedItemDetail: { innerHTML: '' }, window: { setTimeout },
    predictiveCataloguePromise: Promise.resolve([]), predictiveCatalogueLoadedAt: 1,
    normaliseText: value => String(value || '').trim().replace(/\s+/g, ' '),
    normaliseCompare: value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
    normaliseReleaseDate: value => value || null,
    getAlbumArtworkUrl: album => album?.cover_art_url || '',
    getSavedAlbumByExternalId: id => context.allAlbums.find(a => a.external_id === id),
    fetchAlbumDetail: async id => { fetches.push(id); if (failResolution) throw Error('MusicBrainz unavailable'); context.albumTrackCache[id] = detail; return detail; },
    getStoredAlbumDetail: () => null,
    fetchReleaseGroupCover: async () => '',
    updateStickyPlayer() {}, renderLoadingSkeleton() {}, escapeHtml: value => String(value),
    isStageOnePresentation: () => true,
    getAlbumAverage: id => ({ avg: 8, count: 1, id }), getYourAlbumRating: () => null,
    buildStageOneAlbumTrackModels: (detail, albumId) => (detail.media || []).flatMap(m => (m.tracks || []).map(t => ({title:t.title,albumId}))),
    renderRemoteAlbumCatalogueStatus: () => '<span>Preparing ratings…</span>',
    buildSelectedBackButton: () => '', renderClickableArtistName: name => name,
    buildCompactAlbumRatingControl: id => `<button data-rate-album="${id}">Rate</button>`,
    buildMusicProviderPanel: () => '', buildSelectedSharePanel: () => '',
    renderStageOneAlbum: async (model, { isCurrent = () => true } = {}) => {
      renderedModels.push(model);
      if (!model.albumId && remoteCommit) {
        context.model = model;
        await remoteCommit;
      }
      if (!isCurrent()) return false;
      context.model = model;
      context.ratingAlbumId = model.albumId;
      reviewAlbumIds.push(model.albumId);
      return true;
    },
    loadLibrary: async () => { context.allAlbums = structuredClone(db.albums); context.allSongs = structuredClone(db.songs); },
    renderLibrary() {}, renderRecommendations() {}, invalidatePredictiveCatalogue() {},
    supabaseClient: { functions: { async invoke(name, options) {
      invocations.push({ name, body: structuredClone(options?.body || {}) });
      if (autoAddedAlbum && !db.albums.some(album => Number(album.id) === Number(autoAddedAlbum.id))) {
        db.albums.push(structuredClone(autoAddedAlbum));
        db.songs.push(...structuredClone(autoAddedSongs));
      }
      return { data: structuredClone(autoAddResult), error: null };
    } }, from(table) {
      let operation = 'select', payload, filters = [], options;
      const query = {
        select() { return query; }, eq(field, value) { filters.push([field, value]); return query; },
        upsert(rows, opts) { operation = 'upsert'; payload = rows; options = opts; return query; },
        insert(rows) { operation = 'insert'; payload = rows; return query; },
        async execute(single) {
          if (operation === 'select') { const rows = db[table].filter(row => filters.every(([key, value]) => row[key] === value)); return { data: single ? rows[0] || null : structuredClone(rows), error: null }; }
          if (table === 'albums' && beforeAlbumWrite) await beforeAlbumWrite(db);
          writes.push({ table, operation, payload: structuredClone(payload), options });
          const row = payload[0];
          const external = db[table].find(item => item.external_source === row.external_source && item.external_id === row.external_id);
          if (external && options?.ignoreDuplicates) return { data: null, error: null };
          const duplicate = external || db[table].find(item => (row.musicbrainz_release_group_id && item.musicbrainz_release_group_id === row.musicbrainz_release_group_id) || (item.title === row.title && item.artist === row.artist && (table === 'albums' || item.album_id === row.album_id)));
          if (duplicate) return { data: null, error: { code: '23505', message: 'duplicate key value' } };
          const inserted = { id: nextId++, ...structuredClone(row) }; db[table].push(inserted); return { data: single ? inserted : [inserted], error: null };
        },
        maybeSingle() { return query.execute(true); }, single() { return query.execute(true); },
        then(resolve, reject) { return query.execute(false).then(resolve, reject); }
      }; return query;
    } }
  };
  vm.createContext(context);
  vm.runInContext(identitySource + '\n' + saveSource + '\n' + modelSource + '\n' + renderSource, context);
  return { context, db, writes, fetches, invocations, renderedModels, reviewAlbumIds, releaseRemoteCommit };
}
test('resolved external search selection renders immediately while safe creation runs in the background', async () => {
  const h = harness(); await h.context.renderSelectedItem();
  assert.equal(h.db.albums.length, 0); assert.equal(h.db.songs.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.context.selectedItem.savedAlbumId, undefined);
  assert.equal(h.context.model.albumId, null);
  assert.match(h.context.model.albumRatingControlHtml, /Preparing ratings/);
});
test('existing catalogue selection never duplicates album or tracks', async () => {
  const h = harness({ albums: [saved()], songs: [{ id: 20, album_id: 10, title: 'First Song' }] });
  await h.context.renderSelectedItem(); assert.equal(h.writes.length, 0); assert.equal(h.context.model.albumId, 10);
});
test('conflicting MusicBrainz identities are never written by album viewing', async () => {
  const conflicting = {...saved(), external_id:'other-release', musicbrainz_release_id:'other-release', musicbrainz_release_group_id:'other-group'};
  const h = harness({ albums: [conflicting] });
  await h.context.autoSaveSelectedAlbum();
  assert.equal(h.context.selectedItem.savedAlbumId, undefined);
  assert.equal(h.db.albums.length, 1);
  assert.equal(h.db.albums[0].id, 10);
  assert.equal(h.db.songs.length, 0);
});
test('repeated and concurrent remote selections coalesce one safe server request', async () => {
  const h = harness();
  await Promise.all([h.context.autoSaveSelectedAlbum(), h.context.autoSaveSelectedAlbum(), h.context.autoSaveSelectedAlbum()]);
  h.context.selectedItem = selection(); await h.context.autoSaveSelectedAlbum();
  assert.equal(h.db.albums.length, 0); assert.equal(h.db.songs.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.invocations.length, 2);
});
test('failed or incomplete external resolution performs no catalogue writes', async () => {
  const failed = harness({ failResolution: true }); await failed.context.renderSelectedItem(); assert.equal(failed.writes.length, 0);
  for (const detail of [null,{...release(),media:[]},{...release(),id:'wrong-release'},{...release(),'release-group':{id:'wrong-group'}},{...release(),'artist-credit':[]},{...release(),media:[{'track-count':3,tracks:release().media[0].tracks}]},{...release(),media:[{tracks:[{title:''}]}]}]) {
    const h = harness({ detail }); await h.context.autoSaveSelectedAlbum(); assert.equal(h.writes.length, 0); assert.equal(h.db.albums.length, 0);
  }
});
test('signed-out browsing retains the current no-write security boundary', async () => {
  const h = harness(); h.context.currentUser = null; assert.equal(await h.context.autoSaveSelectedAlbum(), null); assert.equal(h.writes.length, 0); assert.equal(h.invocations.length, 0);
});
test('search selection no longer saves an unresolved result before rendering', () => {
  const handler = app.slice(app.indexOf('globalSearchResults.addEventListener("click"'), app.indexOf('let spotifyAlbumWarmupKey'));
  assert.match(handler, /selectedItem = groupedResults\[group\]\[index\]/);
  assert.doesNotMatch(handler, /autoSaveSelectedAlbum\(/);
  assert.match(handler, /await renderSelectedItem\(\)/);
});
test('changing selection during external resolution prevents saving or rendering the old result', async () => {
  const h = harness(); let resolve;
  h.context.fetchAlbumDetail = () => new Promise(r => {resolve = r;});
  const pending = h.context.renderSelectedItem();
  h.context.selectedItem = { type: 'artist', title: 'New selection' };
  h.context.selectedItemDetail.innerHTML = 'New selection';
  resolve(release()); await pending;
  assert.equal(h.writes.length, 0); assert.equal(h.context.selectedItemDetail.innerHTML, 'New selection');
});
test('remote viewing never performs a database duplicate query or write', async () => {
  const h = harness();
  let calls = 0;
  h.context.supabaseClient.from = () => { calls += 1; throw new Error('must not query'); };
  assert.equal(await h.context.autoSaveSelectedAlbum(), null);
  assert.equal(calls, 0);
  assert.equal(h.writes.length, 0);
});

test('authenticated unambiguous remote album binds the complete server-created catalogue row', async () => {
  const album = saved();
  const songs = [
    { id: 20, album_id: 10, title: 'First Song', track_position: 1, external_source: 'musicbrainz', external_id: 'recording-1' },
    { id: 21, album_id: 10, title: 'Second Song', track_position: 2, external_source: 'musicbrainz', external_id: 'recording-2' }
  ];
  const h = harness({ autoAddResult: { status: 'added', album_id: 10, track_count: 2 }, autoAddedAlbum: album, autoAddedSongs: songs });
  const created = await h.context.autoSaveSelectedAlbum();
  assert.equal(h.invocations.length, 1);
  assert.deepEqual(h.invocations[0], { name: 'remote-album-catalogue', body: { release_id: 'release-1', release_group_id: 'group-1' } });
  assert.equal(created.id, 10);
  assert.equal(h.context.selectedItem.savedAlbumId, 10);
  assert.equal(h.context.selectedItem.catalogueAutoAddStatus, 'ready');
  assert.equal(h.context.allSongs.filter(song => song.album_id === 10).length, 2);
  assert.equal(h.writes.length, 0);
});

test('authoritative catalogue rebind cannot be overwritten by a stale 27-track remote render', async () => {
  const remoteTracks = Array.from({ length: 27 }, (_, index) => ({
    position: index + 1,
    title: `Remote track ${index + 1}`,
    recording: { id: `recording-${index + 1}` }
  }));
  const detail = { ...release(), media: [{ 'track-count': 27, tracks: remoteTracks }] };
  const album = saved();
  const songs = remoteTracks.slice(0, 13).map((track, index) => ({
    id: 200 + index,
    album_id: album.id,
    title: track.title,
    track_position: index + 1,
    external_source: 'musicbrainz',
    external_id: track.recording.id
  }));
  const h = harness({
    detail,
    autoAddResult: { status: 'added', album_id: album.id, track_count: 13 },
    autoAddedAlbum: album,
    autoAddedSongs: songs,
    deferRemoteCommit: true
  });

  const pendingRemoteRender = h.context.renderSelectedItem();
  for (let attempt = 0; attempt < 20 && h.context.model?.albumId !== album.id; attempt += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.equal(h.renderedModels[0].albumId, null);
  assert.equal(h.renderedModels[0].tracks.length, 27);
  assert.equal(h.context.model.tracks.length, 13);
  assert.equal(h.context.model.albumId, album.id);
  assert.match(h.context.model.albumRatingControlHtml, /data-rate-album="10"/);
  assert.equal(h.context.ratingAlbumId, album.id);
  assert.deepEqual(h.reviewAlbumIds, [album.id]);

  h.releaseRemoteCommit();
  await pendingRemoteRender;

  assert.equal(h.context.model.albumId, album.id);
  assert.equal(h.context.model.tracks.length, 13);
  assert.equal(h.invocations.length, 1);
});

test('ambiguous safe resolution leaves the remote album usable and unbound', async () => {
  const h = harness({ autoAddResult: { status: 'needs_correction', reason: 'ambiguous_release_group' } });
  assert.equal(await h.context.autoSaveSelectedAlbum(), null);
  assert.equal(h.context.selectedItem.savedAlbumId, undefined);
  assert.equal(h.context.selectedItem.catalogueAutoAddStatus, 'needs_correction');
  assert.equal(h.db.albums.length, 0);
  assert.equal(h.db.songs.length, 0);
});
