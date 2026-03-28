import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Regression test: watchStore.checkNewArticles must receive the FULL
 * unfiltered dataset (canonicalNews) instead of the filtered activeNews.
 *
 * Without this fix, watched items for regions/topics outside the current
 * filter view are silently missed because activeNews is narrowed by
 * region, search, severity, entity, and other filters.
 */

test('App.jsx watchlist useEffect passes canonicalNews (unfiltered) to checkNewArticles, not activeNews', () => {
  const src = readFileSync('src/App.jsx', 'utf8');

  // Find the checkNewArticles call
  const checkCall = src.match(/checkNewArticles\((\w+)\)/);
  assert.ok(checkCall, 'App.jsx should call checkNewArticles');
  assert.equal(
    checkCall[1],
    'canonicalNews',
    'checkNewArticles must receive canonicalNews (full unfiltered dataset), not activeNews (filtered)'
  );
});

test('App.jsx watchlist useEffect depends on canonicalNews, not activeNews', () => {
  const src = readFileSync('src/App.jsx', 'utf8');

  // Extract the watchlist useEffect block — it contains checkNewArticles
  const effectStart = src.indexOf('checkNewArticles');
  assert.ok(effectStart > -1, 'checkNewArticles call should exist in App.jsx');

  // Find the dependency array for the useEffect containing checkNewArticles
  // Search forward from checkNewArticles for the closing ], [deps] pattern
  const afterCheck = src.slice(effectStart);
  const depsMatch = afterCheck.match(/\}, \[([^\]]+)\]/);
  assert.ok(depsMatch, 'Should find dependency array for watchlist useEffect');

  const deps = depsMatch[1];
  assert.ok(
    deps.includes('canonicalNews'),
    'Watchlist useEffect deps should include canonicalNews (unfiltered data source)'
  );
  assert.ok(
    !deps.includes('activeNews'),
    'Watchlist useEffect deps should NOT include activeNews (filtered data would miss watched items outside filters)'
  );
});

test('App.jsx watchlist ref tracks canonicalNews for new-data detection', () => {
  const src = readFileSync('src/App.jsx', 'utf8');

  // The prevWatchNewsRef should be compared against canonicalNews, not activeNews
  // Look for the isNewData assignment near checkNewArticles
  const effectStart = src.indexOf('checkNewArticles');
  const blockStart = src.lastIndexOf('useEffect', effectStart);
  // Find the closing of this useEffect (next ], [ pattern after checkNewArticles)
  const afterCheck = src.slice(effectStart);
  const depsEnd = afterCheck.indexOf(']);');
  const block = src.slice(blockStart, effectStart + depsEnd + 3);

  assert.ok(
    block.includes('canonicalNews !== prevWatchNewsRef.current'),
    'New-data detection should compare canonicalNews to ref (not activeNews)'
  );
  assert.ok(
    block.includes('prevWatchNewsRef.current = canonicalNews'),
    'Ref should be updated with canonicalNews (not activeNews)'
  );
});

test('watchStore.checkNewArticles still works with full unfiltered data', async () => {
  // Verify the underlying matching logic handles a mixed dataset correctly —
  // articles from many regions, some matching watch items, some not.
  const { countMatchesForWatchItems } = await import('../src/utils/watchUtils.js');

  // Simulate a full unfiltered dataset with articles from many regions
  const allArticles = [
    { isoA2: 'UA', title: 'Ukraine conflict escalates', category: 'Conflict' },
    { isoA2: 'UA', title: 'Humanitarian aid to Ukraine', category: 'Humanitarian' },
    { isoA2: 'US', title: 'US election results', category: 'Political' },
    { isoA2: 'JP', title: 'Earthquake in Japan', category: 'Disaster' },
    { isoA2: 'BR', title: 'Brazil floods worsen', category: 'Disaster' },
    { isoA2: 'DE', title: 'Germany trade deal', category: 'Economic' },
    { isoA2: 'NG', title: 'Nigeria oil crisis', category: 'Economic' },
    { isoA2: 'IN', title: 'India election coverage', category: 'Political' },
  ];

  // Simulate filtered dataset (only severity >= high, say only 3 articles)
  const filteredArticles = [
    { isoA2: 'UA', title: 'Ukraine conflict escalates', category: 'Conflict' },
    { isoA2: 'JP', title: 'Earthquake in Japan', category: 'Disaster' },
    { isoA2: 'BR', title: 'Brazil floods worsen', category: 'Disaster' },
  ];

  // Watch items: user is watching Nigeria and India (which are NOT in filtered view)
  const watchItems = [
    { id: 'w-ng', type: 'region', value: 'NG', label: 'Nigeria' },
    { id: 'w-in', type: 'region', value: 'IN', label: 'India' },
    { id: 'w-ua', type: 'region', value: 'UA', label: 'Ukraine' },
  ];

  // Using full unfiltered data → should find matches for NG, IN, and UA
  const fullCounts = countMatchesForWatchItems(allArticles, watchItems);
  assert.equal(fullCounts['w-ng'], 1, 'Nigeria should match 1 article in unfiltered data');
  assert.equal(fullCounts['w-in'], 1, 'India should match 1 article in unfiltered data');
  assert.equal(fullCounts['w-ua'], 2, 'Ukraine should match 2 articles in unfiltered data');

  // Using filtered data → Nigeria and India matches are LOST (the bug)
  const filteredCounts = countMatchesForWatchItems(filteredArticles, watchItems);
  assert.equal(filteredCounts['w-ng'], 0, 'Nigeria match is lost when using filtered data');
  assert.equal(filteredCounts['w-in'], 0, 'India match is lost when using filtered data');
  assert.equal(filteredCounts['w-ua'], 1, 'Ukraine match count reduced when using filtered data');
});
