import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, css, sql] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../bom-foundation.css', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20261110103206_bom_tracks_by_year_quick_rate.sql', import.meta.url), 'utf8')
]);

test('replaces the UK singles sample with BOM Tracks by Year without changing UK No.1s', () => {
  assert.match(app, />BOM Tracks by Year<\/button>/);
  assert.match(app, />UK No\.1s<\/button>/);
  assert.doesNotMatch(app, />UK Singles by Year<\/button>/);
  assert.match(app, /buildImportedQuickRateYearModel\(importedEntries, songs, canonicalRecordings, selectedYear\)/);
});

test('catalogue projection is scoped by release year and returns rating evidence', () => {
  assert.match(sql, /extract\(year from s\.effective_release_date\)/i);
  assert.match(sql, /min\(q\.first_number_one_date\) as reliable_track_date/i);
  assert.match(sql, /least\([\s\S]*a\.original_release_date[\s\S]*reliable_track_date/i);
  assert.match(sql, /join selected_year y on y\.chart_year = s\.release_year/i);
  assert.match(sql, /community_average/);
  assert.match(sql, /community_rating_count/);
  assert.match(sql, /weighted_score/);
  assert.match(sql, /generate_series\(first_year, last_year\)/);
  assert.match(sql, /community\.rating_count \* community\.average_rating/i);
  assert.match(sql, /\+ \(5 \* prior\.mean_rating\)/i);
  assert.match(sql, /security invoker/i);
});

test('rated and unrated catalogue tracks remain selectable and rateable', () => {
  assert.match(app, /Community \$\{communityAverage\.toFixed\(1\)\}/);
  assert.match(app, /Not Yet Rated/);
  assert.match(app, /buildCompactTrackRatingControl\(song\.id, rating\)/);
  assert.match(app, /data-quick-expand/);
  assert.match(css, /\.bom-v1-quick-section-title/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(app, /No BOM catalogue tracks have an original release year of \$\{selectedYear\}/);
});

test('year query does not download the full catalogue', () => {
  const loader = app.slice(app.indexOf('async function loadQuickRateYearData'), app.indexOf('async function loadQuickRateCore'));
  assert.match(loader, /rpc\("get_quick_rate_year"/);
  assert.doesNotMatch(loader, /fetchQuickRateRows\("songs"/);
  assert.doesNotMatch(loader, /fetchQuickRateRows\("albums"/);
});
