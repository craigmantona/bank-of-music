import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
const window = {};
vm.runInNewContext(await readFile(new URL('../bom-autocomplete.js', import.meta.url), 'utf8'), { window });
const { buildCatalogue, rank } = window.BOMAutocomplete;
const albums = [
  { id: 1, title: 'Radiohead', artist: 'Other' },
  { id: 2, title: 'Radiohead Sessions', artist: 'Other' },
  { id: 3, title: 'The Radiohead Story', artist: 'Other' },
  { id: 4, title: 'OK Computer', artist: 'Radiohead' },
  { id: 5, title: 'Hidden', artist: 'Hidden Artist', is_deleted: true }
];
const catalogue = buildCatalogue(albums, [{ id: 1, title: 'Paranoid Android', artist: 'Radiohead', album_id: 4 }, { id: 2, title: 'Hidden Track', artist: 'Hidden Artist', album_id: 5 }], () => 'cover.jpg');
test('exact titles and artists precede prefixes, partials and related artist matches', () => {
  const found = rank(catalogue, 'Radiohead').items;
  assert.equal(found[0].title, 'Radiohead');
  assert.equal(found[1].title, 'Radiohead');
  assert.equal(found[2].title, 'Radiohead Sessions');
  assert.equal(found[3].title, 'The Radiohead Story');
  assert.ok(found.some((item) => item.kind === 'Track'));
});
test('short queries, typo/transposition tolerance, accents and punctuation', () => {
  assert.equal(rank(catalogue, 'r').items.length, 0);
  for (const query of ['Radiohed', 'Radoihead', 'Rádiohead']) assert.equal(rank(catalogue, query).items[0].title, 'Radiohead');
  assert.equal(rank(catalogue, 'paranoid-and').items[0].title, 'Paranoid Android');
});
test('hidden catalogue rows and tracks on hidden albums are excluded', () => {
  assert.equal(rank(catalogue, 'hidden').items.length, 0);
  assert.equal(catalogue.filter((item) => item.kind === 'Artist' && item.title === 'Radiohead').length, 1);
  assert.equal(catalogue.find((item) => item.kind === 'Track').artworkUrl, 'cover.jpg');
});
test('seven suggestions and more flag only when extra matches exist', () => {
  const items = buildCatalogue(Array.from({ length: 12 }, (_, id) => ({ id, title: `Test ${id}`, artist: 'Someone' })), [], () => '');
  assert.equal(rank(items, 'test').items.length, 7);
  assert.equal(rank(items, 'test').more, true);
  assert.equal(rank(items, 'test 11').more, false);
});

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const adapterSource = app.slice(app.indexOf('let predictiveCataloguePromise = null;'), app.indexOf('let searchDebounceTimer = null;'));
function loadAdapter(albums = [], songs = []) {
  const context = { window: { BOMAutocomplete: { buildCatalogue: (albums, songs) => ({ albums, songs }) } },
    allAlbums: albums, allSongs: songs,
    getAlbumArtworkUrl: () => '', readArtistImageCache: () => null };
  vm.createContext(context);
  vm.runInContext(adapterSource, context);
  return context;
}
test('catalogue uses the already-loaded library without independent pagination', async () => {
  const albums = [{ id: 1, title: 'Local album' }];
  const songs = [{ id: 2, title: 'Local track' }];
  const context = loadAdapter(albums, songs);
  const first = context.getPredictiveCatalogue();
  assert.equal(first, context.getPredictiveCatalogue());
  const data = await first;
  assert.equal(data.albums, albums);
  assert.equal(data.songs, songs);
  assert.doesNotMatch(adapterSource, /supabaseClient|\.range\(|300000/);
});
test('autocomplete index survives the former five-minute expiry and rebuilds only for new library arrays', async () => {
  const context = loadAdapter([{ id: 1 }], [{ id: 2 }]);
  const first = context.getPredictiveCatalogue();
  await first;
  assert.equal(context.getPredictiveCatalogue(), first);
  context.allAlbums = [{ id: 3 }];
  const rebuilt = context.getPredictiveCatalogue();
  assert.notEqual(rebuilt, first);
  assert.equal((await rebuilt).albums[0].id, 3);
});
