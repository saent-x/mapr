import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegionFocusQueries } from '../src/services/gdeltService.js';

test('buildRegionFocusQueries expands a country into alias and locality queries', () => {
  const queries = buildRegionFocusQueries('United Arab Emirates');
  const queryText = queries.map((entry) => entry.query).join(' ');

  assert.equal(queries[0].id, 'region-name');
  assert(queries.some((entry) => entry.id === 'region-aliases'));
  assert(queries.some((entry) => entry.id === 'region-localities'));
  assert(queryText.includes('"uae"'));
  assert(queryText.includes('"Dubai"'));
});

test('buildRegionFocusQueries avoids duplicate queries for countries without aliases', () => {
  const queries = buildRegionFocusQueries('Nigeria');
  const deduped = new Set(queries.map((entry) => entry.query));

  assert.equal(deduped.size, queries.length);
  assert(queries.some((entry) => entry.id === 'region-localities'));
  assert(queries.some((entry) => entry.query.includes('"Lagos"') || entry.query.includes('"Abuja"')));
});
