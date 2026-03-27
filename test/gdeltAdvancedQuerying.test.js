import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GDELT_QUERY_PROFILES,
  GDELT_REGION_QUERIES,
  GDELT_LANGUAGE_QUERIES,
  buildRegionFocusQueries,
  getDefaultQueryProfiles,
} from '../src/services/gdeltService.js';

// --- VAL-DATA-005: GDELT queries use advanced targeting ---

test('GDELT_QUERY_PROFILES has 6+ profiles (was 3)', () => {
  assert.ok(GDELT_QUERY_PROFILES.length >= 6,
    `Expected 6+ profiles, got ${GDELT_QUERY_PROFILES.length}`);
});

test('GDELT_QUERY_PROFILES contains original crisis, humanitarian, governance profiles', () => {
  const ids = GDELT_QUERY_PROFILES.map(p => p.id);
  assert.ok(ids.includes('crisis'), 'Missing crisis profile');
  assert.ok(ids.includes('humanitarian'), 'Missing humanitarian profile');
  assert.ok(ids.includes('governance'), 'Missing governance profile');
});

test('GDELT_QUERY_PROFILES includes economic, health, environmental, technology profiles', () => {
  const ids = GDELT_QUERY_PROFILES.map(p => p.id);
  assert.ok(ids.includes('economic'), 'Missing economic profile');
  assert.ok(ids.includes('health'), 'Missing health profile');
  assert.ok(ids.includes('environmental'), 'Missing environmental profile');
  assert.ok(ids.includes('technology'), 'Missing technology profile');
});

test('GDELT_REGION_QUERIES uses sourcecountry: operator for targeting underrepresented countries', () => {
  assert.ok(Array.isArray(GDELT_REGION_QUERIES), 'GDELT_REGION_QUERIES should be an array');
  assert.ok(GDELT_REGION_QUERIES.length >= 3, `Expected 3+ region queries, got ${GDELT_REGION_QUERIES.length}`);

  const allQueries = GDELT_REGION_QUERIES.map(q => q.query).join(' ');
  assert.ok(allQueries.includes('sourcecountry:'),
    'Region queries should use sourcecountry: operator');
});

test('GDELT_REGION_QUERIES targets African, Asian, and other underrepresented regions', () => {
  const ids = GDELT_REGION_QUERIES.map(q => q.id);
  assert.ok(ids.some(id => id.includes('africa')),
    'Should have Africa-focused region queries');
  assert.ok(ids.some(id => id.includes('asia')),
    'Should have Asia-focused region queries');
});

test('GDELT_LANGUAGE_QUERIES uses sourcelang: operator for non-English regions', () => {
  assert.ok(Array.isArray(GDELT_LANGUAGE_QUERIES), 'GDELT_LANGUAGE_QUERIES should be an array');
  assert.ok(GDELT_LANGUAGE_QUERIES.length >= 3, `Expected 3+ language queries, got ${GDELT_LANGUAGE_QUERIES.length}`);

  const allQueries = GDELT_LANGUAGE_QUERIES.map(q => q.query).join(' ');
  assert.ok(allQueries.includes('sourcelang:'),
    'Language queries should use sourcelang: operator');
});

test('GDELT_LANGUAGE_QUERIES covers Spanish, French, Arabic, and other languages', () => {
  const allQueries = GDELT_LANGUAGE_QUERIES.map(q => q.query).join(' ');
  assert.ok(allQueries.includes('sourcelang:spanish') || allQueries.includes('sourcelang:Spanish'),
    'Should include Spanish language filter');
  assert.ok(allQueries.includes('sourcelang:french') || allQueries.includes('sourcelang:French'),
    'Should include French language filter');
  assert.ok(allQueries.includes('sourcelang:arabic') || allQueries.includes('sourcelang:Arabic'),
    'Should include Arabic language filter');
});

test('buildRegionFocusQueries uses sourcecountry: for region-specific queries', () => {
  const queries = buildRegionFocusQueries('Nigeria');
  const allQueryText = queries.map(q => q.query).join(' ');
  assert.ok(allQueryText.includes('sourcecountry:'),
    'buildRegionFocusQueries should use sourcecountry: operator');
});

test('buildRegionFocusQueries includes sourcecountry: with correct ISO code', () => {
  const queries = buildRegionFocusQueries('Kenya');
  const scQuery = queries.find(q => q.query.includes('sourcecountry:'));
  assert.ok(scQuery, 'Should have a query with sourcecountry:');
  assert.ok(scQuery.query.includes('sourcecountry:KE'),
    `Kenya should map to sourcecountry:KE, got: ${scQuery.query}`);
});

test('buildRegionFocusQueries still works for countries without ISO mapping', () => {
  // Even if a country doesn't have an ISO code, it should still produce queries
  const queries = buildRegionFocusQueries('Unknown Region');
  assert.ok(queries.length >= 1, 'Should still produce at least the base query');
  assert.ok(queries.some(q => q.id === 'region-name'), 'Should have region-name query');
});

test('getDefaultQueryProfiles returns all profiles combined', () => {
  const all = getDefaultQueryProfiles();
  assert.ok(Array.isArray(all), 'Should return an array');
  assert.ok(all.length >= 6, `Expected 6+ total profiles, got ${all.length}`);
  // Should contain at least the base profiles
  const ids = all.map(p => p.id);
  assert.ok(ids.includes('crisis'), 'Should include crisis');
  assert.ok(ids.includes('economic'), 'Should include economic');
});

test('THROTTLE_MS is at least 5000ms (rate limiting preserved)', async () => {
  // We can't import THROTTLE_MS directly since it's a const, so check via code
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/services/gdeltService.js', import.meta.url), 'utf8');
  const match = source.match(/THROTTLE_MS\s*=\s*(\d+)/);
  assert.ok(match, 'THROTTLE_MS should be defined');
  const throttleMs = parseInt(match[1], 10);
  assert.ok(throttleMs >= 5000,
    `THROTTLE_MS should be >= 5000, got ${throttleMs}`);
});

test('each query profile has id and query fields', () => {
  const allProfiles = [...GDELT_QUERY_PROFILES, ...GDELT_REGION_QUERIES, ...GDELT_LANGUAGE_QUERIES];
  for (const profile of allProfiles) {
    assert.ok(profile.id, `Profile missing id: ${JSON.stringify(profile)}`);
    assert.ok(profile.query, `Profile missing query: ${JSON.stringify(profile)}`);
    assert.ok(typeof profile.id === 'string', `Profile id should be string: ${profile.id}`);
    assert.ok(typeof profile.query === 'string', `Profile query should be string: ${profile.id}`);
  }
});
