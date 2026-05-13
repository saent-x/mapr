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

test('createView stores all filter fields including advanced filters', () => {
  const filters = {
    searchQuery: 'sahel',
    minSeverity: 50,
    minConfidence: 30,
    dateWindow: '24h',
    sortMode: 'recent',
    selectedRegion: 'ML',
    verificationFilter: 'verified',
    sourceTypeFilter: 'official',
    languageFilter: 'en',
    accuracyMode: 'strict',
    precisionFilter: 'locality',
    hideAmplified: true,
  };
  const view = createView('Full Filter View', filters, { mapMode: 'flat', mapOverlay: 'coverage' });
  assert.equal(view.filters.verificationFilter, 'verified');
  assert.equal(view.filters.sourceTypeFilter, 'official');
  assert.equal(view.filters.languageFilter, 'en');
  assert.equal(view.filters.accuracyMode, 'strict');
  assert.equal(view.filters.precisionFilter, 'locality');
  assert.equal(view.filters.hideAmplified, true);
  assert.equal(view.mapState.mapOverlay, 'coverage');
});

test('saved view round-trips through serialize/deserialize with all fields', () => {
  const view = createView('Test All', {
    searchQuery: 'test',
    verificationFilter: 'official',
    hideAmplified: true,
  }, { mapMode: 'flat' });
  const json = serializeViews([view]);
  const parsed = deserializeViews(json);
  assert.equal(parsed[0].filters.verificationFilter, 'official');
  assert.equal(parsed[0].filters.hideAmplified, true);
  assert.equal(parsed[0].mapState.mapMode, 'flat');
});

// ── URL round-trip tests (VAL-M5-025) ──

test('encode then decode round-trips all filter params', () => {
  const input = {
    filters: {
      searchQuery: 'wagner',
      minSeverity: 60,
      minConfidence: 30,
      dateWindow: '24h',
      sortMode: 'recent',
      selectedRegion: 'UA',
    },
    mapState: { mapMode: 'flat', mapOverlay: 'severity' },
  };
  const qs = encodeViewToURL(input);
  const params = new URLSearchParams(qs);
  const result = decodeURLToFilters(params);
  assert.equal(result.filters.searchQuery, 'wagner');
  assert.equal(result.filters.minSeverity, 60);
  assert.equal(result.filters.minConfidence, 30);
  assert.equal(result.filters.dateWindow, '24h');
  assert.equal(result.filters.sortMode, 'recent');
  assert.equal(result.filters.selectedRegion, 'UA');
  assert.equal(result.mapState.mapMode, 'flat');
  assert.equal(result.mapState.mapOverlay, 'severity');
});

test('encode then decode round-trips numeric zero as omitted', () => {
  const input = {
    filters: { minSeverity: 0, minConfidence: 0 },
    mapState: {},
  };
  const qs = encodeViewToURL(input);
  // Zero values should be omitted (treated as default)
  assert.equal(qs, '');
  const params = new URLSearchParams(qs);
  const result = decodeURLToFilters(params);
  assert.deepEqual(result.filters, {});
});

test('encode then decode round-trips empty string as omitted', () => {
  const input = {
    filters: { searchQuery: '' },
    mapState: {},
  };
  const qs = encodeViewToURL(input);
  assert.equal(qs, '');
});

test('encode then decode round-trips entity filter object', () => {
  const input = {
    filters: {
      entityFilter: { id: 'e1', name: 'United Nations', type: 'organization' },
    },
    mapState: {},
  };
  const qs = encodeViewToURL(input);
  assert.ok(qs.includes('entity='));
  // Decode back
  const params = new URLSearchParams(qs);
  const result = decodeURLToFilters(params);
  assert.ok(result.filters.entityFilter);
  assert.equal(result.filters.entityFilter.name, 'United Nations');
  assert.equal(result.filters.entityFilter.type, 'organization');
});

test('encode then decode round-trips entity filter with legacy format', () => {
  // Legacy: just entity name without type prefix
  const params = new URLSearchParams('entity=Russia');
  const result = decodeURLToFilters(params);
  assert.ok(result.filters.entityFilter);
  assert.equal(result.filters.entityFilter.name, 'Russia');
  assert.equal(result.filters.entityFilter.type, 'entity');
});

test('encode skips null/undefined entity filter', () => {
  const input = {
    filters: { entityFilter: null },
    mapState: {},
  };
  const qs = encodeViewToURL(input);
  assert.equal(qs, '');
});

test('encode entity filter with special characters in name', () => {
  const input = {
    filters: {
      entityFilter: { id: 'e2', name: 'Côte d\'Ivoire', type: 'location' },
    },
    mapState: {},
  };
  const qs = encodeViewToURL(input);
  const params = new URLSearchParams(qs);
  const result = decodeURLToFilters(params);
  assert.equal(result.filters.entityFilter.name, "Côte d'Ivoire");
  assert.equal(result.filters.entityFilter.type, 'location');
});

test('round-trip combined filters + entity + mapState', () => {
  const input = {
    filters: {
      searchQuery: 'sahel',
      minSeverity: 40,
      dateWindow: '72h',
      sortMode: 'severity',
      selectedRegion: 'ML',
      entityFilter: { id: 'e3', name: 'Wagner Group', type: 'organization' },
    },
    mapState: { mapMode: 'globe', mapOverlay: 'geopolitical' },
  };
  const qs = encodeViewToURL(input);
  const params = new URLSearchParams(qs);
  const result = decodeURLToFilters(params);

  assert.equal(result.filters.searchQuery, 'sahel');
  assert.equal(result.filters.minSeverity, 40);
  assert.equal(result.filters.dateWindow, '72h');
  assert.equal(result.filters.sortMode, 'severity');
  assert.equal(result.filters.selectedRegion, 'ML');
  assert.equal(result.filters.entityFilter.name, 'Wagner Group');
  assert.equal(result.filters.entityFilter.type, 'organization');
  assert.equal(result.mapState.mapMode, 'globe');
  assert.equal(result.mapState.mapOverlay, 'geopolitical');
});

test('decode handles empty search params gracefully', () => {
  const params = new URLSearchParams('');
  const result = decodeURLToFilters(params);
  assert.deepEqual(result.filters, {});
  assert.deepEqual(result.mapState, {});
});
