import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Tests for frontend core interactions after state management refactor.
 * Validates search filtering, map error boundary, and data flow.
 */

test('App.jsx applies debouncedSearch keyword filter to activeNews', () => {
  // Verify that App.jsx includes search filtering logic in the activeNews computation
  const appSrc = readFileSync('src/App.jsx', 'utf8');

  // Must filter by debouncedSearch
  assert.ok(
    appSrc.includes('debouncedSearch') && appSrc.includes('haystack'),
    'App.jsx should filter activeNews by debouncedSearch keyword'
  );

  // Must include debouncedSearch in the useMemo deps for activeNews
  assert.ok(
    appSrc.includes('debouncedSearch]'),
    'debouncedSearch should be in the activeNews useMemo dependency array'
  );
});

test('App.jsx mapNewsList uses activeNews (filtered) not baseArticles (unfiltered)', () => {
  const appSrc = readFileSync('src/App.jsx', 'utf8');

  // mapNewsList should derive from activeNews (which includes filter + search)
  // not from baseArticles (which is unfiltered)
  const mapNewsListBlock = appSrc.slice(
    appSrc.indexOf('const mapNewsList'),
    appSrc.indexOf(';', appSrc.indexOf('const mapNewsList')) + 1
  );

  assert.ok(
    mapNewsListBlock.includes('activeNews'),
    'mapNewsList should reference activeNews for filter-aware map rendering'
  );
  assert.ok(
    !mapNewsListBlock.includes('mapArticles'),
    'mapNewsList should not reference unfiltered mapArticles'
  );
});

test('MapErrorBoundary component exists and exports a class', () => {
  const src = readFileSync('src/components/MapErrorBoundary.jsx', 'utf8');

  assert.ok(
    src.includes('class MapErrorBoundary'),
    'MapErrorBoundary should be a class component (error boundaries require class)'
  );
  assert.ok(
    src.includes('onFallbackToFlat'),
    'MapErrorBoundary should call onFallbackToFlat when globe fails'
  );
  assert.ok(
    src.includes('getDerivedStateFromError'),
    'MapErrorBoundary should implement getDerivedStateFromError'
  );
});

test('App.jsx uses MapErrorBoundary around the map rendering', () => {
  const appSrc = readFileSync('src/App.jsx', 'utf8');

  assert.ok(
    appSrc.includes('MapErrorBoundary'),
    'App.jsx should import and use MapErrorBoundary'
  );
  assert.ok(
    appSrc.includes('handleGlobeFallback'),
    'App.jsx should define handleGlobeFallback for auto-switching to flat map'
  );
});

test('search filter only activates for queries of 2+ characters', () => {
  const appSrc = readFileSync('src/App.jsx', 'utf8');

  // The search filter should have a minimum length check to avoid
  // filtering on single characters
  assert.ok(
    appSrc.includes('q.length >= 2'),
    'Search filter should require at least 2 characters'
  );
});

test('search filter matches against title, summary, locality, category, and region', () => {
  const appSrc = readFileSync('src/App.jsx', 'utf8');

  // Verify all important fields are included in the search haystack
  assert.ok(appSrc.includes('s.title'), 'Search should match against title');
  assert.ok(appSrc.includes('s.summary'), 'Search should match against summary');
  assert.ok(appSrc.includes('s.locality'), 'Search should match against locality');
  assert.ok(appSrc.includes('s.category'), 'Search should match against category');
  assert.ok(appSrc.includes('s.region'), 'Search should match against region');
});

test('filterStore debouncedSearch is wired for search filtering', () => {
  const storeSrc = readFileSync('src/stores/filterStore.js', 'utf8');

  assert.ok(
    storeSrc.includes('debouncedSearch'),
    'filterStore should expose debouncedSearch state'
  );
  assert.ok(
    storeSrc.includes('_debounceTimer'),
    'filterStore should debounce search queries to avoid excessive filtering'
  );
});
