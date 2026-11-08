import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [app, albumUi, styles] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../bom-album.js', import.meta.url), 'utf8'),
  readFile(new URL('../bom-foundation.css', import.meta.url), 'utf8')
]);
const extract = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));

function artistContext(identities) {
  const context = vm.createContext({
    allAlbums: [], selectedItem: null, loadedArtistIdentities: identities,
    normaliseText: value => String(value || '').trim().replace(/\s+/g, ' '),
    normaliseCompare: value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ''),
    escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[character])
  });
  vm.runInContext(extract('function getLoadedArtistIdentities', 'window.openArtistPage'), context);
  return context;
}

test('collaborating and featured artists keep their credit order and resolve independently', () => {
  const identities = [
    {artist_name:'Sam Fender',musicbrainz_artist_id:'sam-id'},
    {artist_name:'Olivia Dean',musicbrainz_artist_id:'olivia-id'},
    {artist_name:'Guest Singer',musicbrainz_artist_id:'guest-id'}
  ];
  const context = artistContext(identities);
  const collaboration = context.renderArtistCreditLinks('Sam Fender and Olivia Dean');
  assert.match(collaboration, /data-artist-id="sam-id"[^>]*>Sam Fender<\/button><span class="bom-artist-credit-separator"> and <\/span><button[^>]*data-artist-id="olivia-id"[^>]*>Olivia Dean<\/button>/);
  const featured = context.renderArtistCreditLinks('Sam Fender feat. Guest Singer');
  assert.match(featured, />Sam Fender<\/button><span class="bom-artist-credit-separator"> feat\. <\/span><button[^>]*>Guest Singer<\/button>/);
  const three = context.renderArtistCreditLinks('Sam Fender, Olivia Dean & Guest Singer');
  assert.equal((three.match(/bom-artist-credit-link/g) || []).length, 3);
});

test('exact group identities are never split and missing collaborators remain plain text', () => {
  const groupContext = artistContext([{artist_name:'Simon & Garfunkel',musicbrainz_artist_id:'group-id'}]);
  const group = groupContext.renderArtistCreditLinks('Simon & Garfunkel');
  assert.equal((group.match(/bom-artist-credit-link/g) || []).length, 1);
  assert.match(group, /data-artist-id="group-id"[^>]*>Simon &amp; Garfunkel<\/button>/);

  const partialContext = artistContext([{artist_name:'Sam Fender',musicbrainz_artist_id:'sam-id'}]);
  const partial = partialContext.renderArtistCreditLinks('Sam Fender and Missing Artist');
  assert.equal((partial.match(/bom-artist-credit-link/g) || []).length, 1);
  assert.match(partial, /bom-artist-credit-unavailable[^>]*>Missing Artist<\/span>/);
});

test('Quick Rate, album tracks and track details reuse accessible artist-credit navigation', () => {
  assert.match(app, /renderArtistCreditLinks\(artist,artistIdentities,\{quickRate:true\}\)/);
  assert.match(app, /renderArtistCreditLinks\(trackArtist\)/);
  assert.match(app, /artistControlHtml:renderArtistCreditLinks\(trackArtist\)/);
  assert.match(app, /bom-artist-credit-link:not\(\[data-quick-artist\]\)/);
  assert.match(albumUi, /bom-v1-track-artists/);
  assert.match(albumUi, /track\.ratingControlHtml/);
  assert.doesNotMatch(albumUi, /bom-v1-track-open[^`]*bom-artist-credit-link/);
  assert.match(styles, /bom-artist-credit-link:focus-visible/);
  assert.match(styles, /@media\(max-width:700px\)\{\.bom-shell-v1 \.bom-artist-credit-link \{ min-height:44px/);
});
