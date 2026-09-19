import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const saveSource = app.slice(app.indexOf('const albumAutoSaveInFlight = new Map();'), app.indexOf('async function importSelectedAlbum()'));
const renderSource = app.slice(app.indexOf('async function renderSelectedItem()'), app.indexOf('function getSavedAlbumByTitleArtist'));
const modelSource = app.slice(app.indexOf('function buildStageOneAlbumModel('), app.indexOf('async function renderStageOneAlbum('));
const release = () => ({ id: 'release-1', title: 'Resolved Album', date: '2001-03-04', 'release-group': { id: 'group-1' }, 'artist-credit': [{ name: 'An Artist' }], media: [{ 'track-count': 2, tracks: [
  { title: 'First Song', recording: { id: 'recording-1' } }, { title: 'Second Song', recording: { id: 'recording-2' } }
] }] });
const selection = () => ({ type: 'album', title: 'Resolved Album', artist: 'An Artist', externalId: 'release-1', releaseGroupId: 'group-1', coverUrl: 'https://example.test/cover.jpg' });
const saved = () => ({ id: 10, title: 'Resolved Album', artist: 'An Artist', external_source: 'musicbrainz', external_id: 'release-1', musicbrainz_release_group_id: 'group-1', cover_art_url: 'saved-cover.jpg' });
function harness({ albums = [], songs = [], cached = true, detail = release(), failResolution = false, beforeAlbumWrite } = {}) {
  const db = { albums: structuredClone(albums), songs: structuredClone(songs) }, writes = [], fetches = [];
  let nextId = 100;
  const context = {
    currentUser: { id: 'user-1' }, selectedItem: selection(), allAlbums: cached ? structuredClone(albums) : [], allSongs: cached ? structuredClone(songs) : [],
    console: { warn() {}, error() {} }, albumTrackCache: {}, releaseGroupCoverCache: {}, selectedItemDetail: { innerHTML: '' }, window: {},
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
    buildSelectedBackButton: () => '', renderClickableArtistName: name => name,
    buildCompactAlbumRatingControl: id => `<button data-rate-album="${id}">Rate</button>`,
    buildMusicProviderPanel: () => '', buildSelectedSharePanel: () => '',
    renderStageOneAlbum: async model => { context.model = model; },
    loadLibrary: async () => { context.allAlbums = structuredClone(db.albums); context.allSongs = structuredClone(db.songs); },
    renderLibrary() {}, renderRecommendations() {},
    supabaseClient: { from(table) {
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
  vm.runInContext(saveSource + '\n' + modelSource + '\n' + renderSource, context);
  return { context, db, writes, fetches };
}
test('resolved external search selection uses the former auto-save path before showing catalogue rating controls', async () => {
  const h = harness(); await h.context.renderSelectedItem();
  assert.equal(h.db.albums.length, 1); assert.equal(h.db.songs.length, 2);
  const album = h.db.albums[0];
  assert.equal(album.external_id, 'release-1'); assert.equal(album.musicbrainz_release_group_id, 'group-1');
  assert.equal(album.musicbrainz_release_id, 'release-1'); assert.equal(album.cover_art_url, selection().coverUrl);
  assert.equal(album.release_date, '2001-03-04');
  assert.equal(h.context.selectedItem.savedAlbumId, album.id); assert.equal(h.context.selectedItem.albumId, album.id);
  assert.equal(h.context.model.albumId, album.id); assert.doesNotMatch(h.context.model.albumRatingControlHtml, /Save album/);
  assert.equal(h.context.model.community.average, 8);
  assert.deepEqual(h.db.songs.map(s => [s.external_id, s.track_position, s.album_id]), [['recording-1',1,album.id],['recording-2',2,album.id]]);
  assert.equal(h.context.predictiveCataloguePromise, null);
});
test('existing catalogue selection never duplicates album or tracks', async () => {
  const h = harness({ albums: [saved()], songs: [{ id: 20, album_id: 10, title: 'First Song' }] });
  await h.context.renderSelectedItem(); assert.equal(h.writes.length, 0); assert.equal(h.context.model.albumId, 10);
});
test('release-group and title/artist matches outside the local cache reuse the existing BOM record', async () => {
  for (const record of [{...saved(),external_id:'another-edition'}, {...saved(),external_id:'another-edition',musicbrainz_release_group_id:null}]) {
    const h = harness({ albums: [record], cached: false }); await h.context.renderSelectedItem();
    assert.equal(h.db.albums.length, 1); assert.equal(h.writes.length, 0); assert.equal(h.context.model.albumId, 10);
    assert.equal(h.context.selectedItem.externalId, 'another-edition');
  }
});
test('repeated and concurrent selections are idempotent', async () => {
  const h = harness();
  await Promise.all([h.context.autoSaveSelectedAlbum(), h.context.autoSaveSelectedAlbum(), h.context.autoSaveSelectedAlbum()]);
  h.context.selectedItem = selection(); await h.context.autoSaveSelectedAlbum();
  assert.equal(h.db.albums.length, 1); assert.equal(h.db.songs.length, 2);
  assert.equal(h.writes.filter(w => w.table === 'albums').length, 1);
  assert.equal(h.writes.filter(w => w.table === 'songs').length, 2);
});
test('a concurrent database insert resolves to the existing record without overwriting canonical metadata', async () => {
  const h = harness({ beforeAlbumWrite(db) { db.albums.push({...saved(),external_id:'another-edition'}); } });
  await h.context.renderSelectedItem(); assert.equal(h.db.albums.length, 1);
  assert.equal(h.db.albums[0].cover_art_url, 'saved-cover.jpg'); assert.equal(h.context.model.albumId, 10);
  assert.equal(h.writes.filter(w => w.table === 'songs').length, 0);
});
test('failed or incomplete external resolution performs no catalogue writes', async () => {
  const failed = harness({ failResolution: true }); await failed.context.renderSelectedItem(); assert.equal(failed.writes.length, 0);
  for (const detail of [null,{...release(),media:[]},{...release(),id:'wrong-release'},{...release(),'release-group':{id:'wrong-group'}},{...release(),'artist-credit':[]},{...release(),media:[{'track-count':3,tracks:release().media[0].tracks}]},{...release(),media:[{tracks:[{title:''}]}]}]) {
    const h = harness({ detail }); await h.context.autoSaveSelectedAlbum(); assert.equal(h.writes.length, 0); assert.equal(h.db.albums.length, 0);
  }
});
test('signed-out browsing retains the current no-write security boundary', async () => {
  const h = harness(); h.context.currentUser = null; assert.equal(await h.context.autoSaveSelectedAlbum(), null); assert.equal(h.writes.length, 0);
});
test('a completed save cannot attach its record to a newer selection', async () => {
  const h = harness(); let resolve;
  h.context.fetchAlbumDetail = () => new Promise(r => {resolve = r;});
  const pending = h.context.autoSaveSelectedAlbum(); const newer = {type:'artist',title:'Another Artist'}; h.context.selectedItem = newer;
  resolve(release()); await pending; assert.equal(h.context.selectedItem, newer); assert.equal(newer.savedAlbumId, undefined);
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
test('database read failure stops saving rather than treating an unknown catalogue state as absent', async () => {
  const h = harness();
  h.context.supabaseClient.from = () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ error: new Error('offline') }) }; return q;
  };
  await assert.rejects(h.context.autoSaveSelectedAlbum(), /offline/);
  assert.equal(h.writes.length, 0);
});
