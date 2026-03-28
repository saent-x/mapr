import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchArticleToWatch,
  countMatchesForWatchItems,
  computeNewMatches,
} from '../src/utils/watchUtils.js';

describe('matchArticleToWatch', () => {
  it('matches article by region (ISO code)', () => {
    const article = { isoA2: 'UA', title: 'Conflict in Ukraine' };
    const watch = { type: 'region', value: 'UA' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('region matching is case-insensitive', () => {
    const article = { isoA2: 'ua', title: 'Conflict in Ukraine' };
    const watch = { type: 'region', value: 'UA' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('does not match article to wrong region', () => {
    const article = { isoA2: 'US', title: 'US news' };
    const watch = { type: 'region', value: 'UA' };
    assert.ok(!matchArticleToWatch(article, watch));
  });

  it('matches article by topic keyword in title', () => {
    const article = { title: 'Earthquake hits Japan', summary: '' };
    const watch = { type: 'topic', value: 'earthquake' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('matches article by topic keyword in summary', () => {
    const article = { title: 'Breaking', summary: 'A major flooding event occurred' };
    const watch = { type: 'topic', value: 'flooding' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('matches article by topic keyword in category', () => {
    const article = { title: 'News', category: 'Conflict' };
    const watch = { type: 'topic', value: 'conflict' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('topic matching is case-insensitive', () => {
    const article = { title: 'NATO Summit Begins' };
    const watch = { type: 'topic', value: 'nato' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('does not match topic that is absent', () => {
    const article = { title: 'Weather forecast', summary: 'Sunny' };
    const watch = { type: 'topic', value: 'earthquake' };
    assert.ok(!matchArticleToWatch(article, watch));
  });

  it('matches article by entity name in people', () => {
    const article = {
      title: 'Summit',
      entities: { people: [{ name: 'Zelensky' }], organizations: [], locations: [] },
    };
    const watch = { type: 'entity', value: 'Zelensky' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('matches article by entity name in organizations', () => {
    const article = {
      title: 'UN meeting',
      entities: { people: [], organizations: [{ name: 'United Nations' }], locations: [] },
    };
    const watch = { type: 'entity', value: 'United Nations' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('matches article by partial entity name', () => {
    const article = {
      title: 'WHO report',
      entities: { people: [], organizations: [{ name: 'World Health Organization' }], locations: [] },
    };
    const watch = { type: 'entity', value: 'World Health' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('does not match entity when no entities present', () => {
    const article = { title: 'Plain article' };
    const watch = { type: 'entity', value: 'NATO' };
    assert.ok(!matchArticleToWatch(article, watch));
  });

  it('returns false for null article or watchItem', () => {
    assert.ok(!matchArticleToWatch(null, { type: 'topic', value: 'test' }));
    assert.ok(!matchArticleToWatch({ title: 'test' }, null));
    assert.ok(!matchArticleToWatch(null, null));
  });

  it('returns false for unknown watch type', () => {
    const article = { title: 'Test' };
    const watch = { type: 'unknown', value: 'test' };
    assert.ok(!matchArticleToWatch(article, watch));
  });
});

describe('countMatchesForWatchItems', () => {
  const articles = [
    { isoA2: 'UA', title: 'Ukraine conflict', category: 'Conflict' },
    { isoA2: 'UA', title: 'Ukraine aid', category: 'Humanitarian' },
    { isoA2: 'US', title: 'US election', category: 'Political' },
    { isoA2: 'JP', title: 'Earthquake in Japan', category: 'Seismic' },
  ];

  it('counts matches per watch item', () => {
    const watchItems = [
      { id: 'w1', type: 'region', value: 'UA' },
      { id: 'w2', type: 'topic', value: 'earthquake' },
    ];
    const counts = countMatchesForWatchItems(articles, watchItems);
    assert.equal(counts.w1, 2); // Two UA articles
    assert.equal(counts.w2, 1); // One earthquake article
  });

  it('returns empty object for empty articles', () => {
    const watchItems = [{ id: 'w1', type: 'region', value: 'UA' }];
    const counts = countMatchesForWatchItems([], watchItems);
    assert.deepEqual(counts, {});
  });

  it('returns empty object for empty watchItems', () => {
    const counts = countMatchesForWatchItems(articles, []);
    assert.deepEqual(counts, {});
  });

  it('returns 0 for items with no matches', () => {
    const watchItems = [{ id: 'w1', type: 'region', value: 'DE' }];
    const counts = countMatchesForWatchItems(articles, watchItems);
    assert.equal(counts.w1, 0);
  });
});

describe('computeNewMatches', () => {
  it('detects new matches when counts increase', () => {
    const watchItems = [
      { id: 'w1', type: 'region', value: 'UA', label: 'Ukraine' },
      { id: 'w2', type: 'topic', value: 'earthquake', label: 'Earthquake' },
    ];
    const prevCounts = { w1: 2, w2: 1 };
    const currentCounts = { w1: 5, w2: 1 };
    const result = computeNewMatches(currentCounts, prevCounts, watchItems);

    assert.equal(result.length, 1);
    assert.equal(result[0].watchId, 'w1');
    assert.equal(result[0].newCount, 3);
    assert.equal(result[0].totalCount, 5);
    assert.equal(result[0].label, 'Ukraine');
  });

  it('returns empty when no new matches', () => {
    const watchItems = [{ id: 'w1', type: 'region', value: 'UA', label: 'Ukraine' }];
    const prevCounts = { w1: 5 };
    const currentCounts = { w1: 5 };
    const result = computeNewMatches(currentCounts, prevCounts, watchItems);
    assert.equal(result.length, 0);
  });

  it('handles null previous counts (first check)', () => {
    const watchItems = [
      { id: 'w1', type: 'region', value: 'UA', label: 'Ukraine' },
    ];
    const currentCounts = { w1: 3 };
    const result = computeNewMatches(currentCounts, null, watchItems);
    assert.equal(result.length, 1);
    assert.equal(result[0].newCount, 3);
  });

  it('returns empty for null currentCounts', () => {
    const watchItems = [{ id: 'w1', type: 'region', value: 'UA', label: 'Ukraine' }];
    const result = computeNewMatches(null, {}, watchItems);
    assert.equal(result.length, 0);
  });

  it('returns empty for empty watchItems', () => {
    const result = computeNewMatches({ w1: 5 }, {}, []);
    assert.equal(result.length, 0);
  });

  it('does not report decreased counts as new matches', () => {
    const watchItems = [{ id: 'w1', type: 'region', value: 'UA', label: 'Ukraine' }];
    const prevCounts = { w1: 10 };
    const currentCounts = { w1: 5 }; // decreased (possible after time window change)
    const result = computeNewMatches(currentCounts, prevCounts, watchItems);
    assert.equal(result.length, 0);
  });
});
