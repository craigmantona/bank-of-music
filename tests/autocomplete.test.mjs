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
function loadAdapter(read) {
  const context = { window: { BOMAutocomplete: { buildCatalogue: (albums, songs) => ({ albums, songs }) } },
    supabaseClient: { from: (table) => ({ select: () => ({ order: () => ({ range: (start, end) => read(table, start, end) }) }) }) },
    getAlbumArtworkUrl: () => '', readArtistImageCache: () => null, Date };
  vm.createContext(context);
  vm.runInContext(adapterSource, context);
  return context;
}
test('catalogue uses one shared paginated request and caches subsequent searches', async () => {
  const calls = [];
  const context = loadAdapter(async (table, start, end) => {
    calls.push([table, start, end]);
    return { data: Array.from({length: start === 0 ? 1000 : 1}, (_, n) => ({ id: start + n })) };
  });
  const first = context.getPredictiveCatalogue();
  assert.equal(first, context.getPredictiveCatalogue());
  const data = await first;
  assert.equal(data.albums.length, 1001);
  assert.equal(data.songs.length, 1001);
  assert.equal(calls.length, 4);
  await context.getPredictiveCatalogue();
  assert.equal(calls.length, 4);
});
test('failed catalogue requests can retry rather than caching an error or partial data', async () => {
  let fail = true;
  const context = loadAdapter(async () => fail ? { error: new Error('offline') } : { data: [] });
  await assert.rejects(context.getPredictiveCatalogue(), /offline/);
  fail = false;
  assert.equal((await context.getPredictiveCatalogue()).albums.length, 0);
});
