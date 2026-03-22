import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createView, encodeViewToURL, decodeURLToFilters, serializeViews, deserializeViews
} from '../src/utils/viewManager.js';

test('createView generates view with id and timestamps', () => {
  const view = createView('Sahel Watch', { searchQuery: 'sahel', minSeverity: 50 }, { mapMode: 'flat' });
  assert.ok(view.id.startsWith('view-'));
  assert.equal(view.name, 'Sahel Watch');
  assert.equal(view.filters.searchQuery, 'sahel');
  assert.equal(view.filters.minSeverity, 50);
  assert.equal(view.mapState.mapMode, 'flat');
  assert.ok(view.createdAt);
});

test('encodeViewToURL produces query string', () => {
  const url = encodeViewToURL({
    filters: { searchQuery: 'wagner', minSeverity: 60, selectedRegion: 'ML' },
    mapState: { mapMode: 'flat', mapOverlay: 'severity' }
  });
  assert.ok(url.includes('q=wagner'));
  assert.ok(url.includes('severity=60'));
  assert.ok(url.includes('region=ML'));
  assert.ok(url.includes('mode=flat'));
});

test('decodeURLToFilters parses query params', () => {
  const params = new URLSearchParams('q=wagner&severity=60&region=ML&mode=flat');
  const { filters, mapState } = decodeURLToFilters(params);
  assert.equal(filters.searchQuery, 'wagner');
  assert.equal(filters.minSeverity, 60);
  assert.equal(filters.selectedRegion, 'ML');
  assert.equal(mapState.mapMode, 'flat');
});

test('serializeViews and deserializeViews are symmetric', () => {
  const views = [createView('Test', { searchQuery: 'test' }, {})];
  const json = serializeViews(views);
  const parsed = deserializeViews(json);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'Test');
});

test('deserializeViews handles null/invalid input', () => {
  assert.deepEqual(deserializeViews(null), []);
  assert.deepEqual(deserializeViews('invalid'), []);
  assert.deepEqual(deserializeViews(''), []);
});

test('encodeViewToURL omits empty/default values', () => {
  const url = encodeViewToURL({ filters: { searchQuery: '', minSeverity: 0 }, mapState: {} });
  assert.equal(url, '');
});
