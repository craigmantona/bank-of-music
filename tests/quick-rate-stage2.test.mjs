import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261108184721_quick_rate_year_projection.sql', import.meta.url), 'utf8');

test('selected UK No.1 year uses one narrow authenticated projection', () => {
  assert.match(app, /rpc\("get_quick_rate_year"/);
  assert.match(app, /p_collection_key: collection/);
  assert.match(app, /p_chart_year: requestedYear \|\| null/);
  assert.doesNotMatch(app.slice(app.indexOf('async function loadQuickRateYearData'), app.indexOf('async function loadQuickRateCore')), /fetchQuickRateRows\("songs"|fetchQuickRateRows\("canonical_recordings"/);
  assert.match(migration, /and q\.collection_key = p_collection_key/);
  assert.match(migration, /join selected_year y on y\.chart_year = q\.chart_year/);
});

test('projection exposes only the caller rating under invoker permissions', () => {
  assert.match(migration, /security invoker/i);
  assert.match(migration, /r\.user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /revoke all on function public\.get_quick_rate_year\(text, integer\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.get_quick_rate_year\(text, integer\) to authenticated/i);
  assert.doesNotMatch(migration, /security definer/i);
});

test('year loads are cached, deduplicated, retryable and rating-cache safe', () => {
  const loader = app.slice(app.indexOf('async function loadQuickRateYearData'), app.indexOf('async function loadQuickRateCore'));
  assert.match(loader, /quickRateYearCache\.has\(key\)/);
  assert.match(loader, /quickRateYearPromises\.has\(key\)/);
  assert.match(loader, /allSongRatings\.filter\(row => row\.user_id === userId\)/);
  assert.match(loader, /finally[\s\S]*?quickRateYearPromises\.delete\(key\)/);
  assert.doesNotMatch(loader, /catch[\s\S]*?quickRateYearCache\.set/);
  const open = app.slice(app.indexOf('async function openQuickRate'), app.indexOf('window.handleQuickRateClick'));
  assert.match(open, /previousRating === null && overallProgressOverride/);
  assert.match(open, /removed && hadRating && overallProgressOverride/);
});

test('UK Singles years use targeted title, album and canonical lookups', () => {
  const loader = app.slice(app.indexOf('async function loadQuickRateYearData'), app.indexOf('async function loadQuickRateCore'));
  assert.match(loader, /fetchRowsInChunks\("songs", "title", entries\.map/);
  assert.match(loader, /fetchRowsInChunks\("albums", "id", visibleSongs\.map/);
  assert.match(loader, /fetchRowsInChunks\("canonical_recordings", "id", visibleSongs\.map/);
});

test('immediate shell and stale-request protection remain in place', () => {
  const open = app.slice(app.indexOf('async function openQuickRate'), app.indexOf('window.handleQuickRateClick'));
  assert.ok(open.indexOf('dialog.showModal();') < open.indexOf('await loadSelectedQuickRateYear(selectedYear)'));
  assert.match(open, /const sequence = \+\+loadSequence/);
  assert.match(open, /sequence !== loadSequence/);
  assert.match(open, /loading="lazy" decoding="async"/);
});
