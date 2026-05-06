import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchArticleToWatch,
  countMatchesForWatchItems,
  computeNewMatches,
  SEVERITY_TIERS,
  SEVERITY_TIER_NAMES,
  severityThreshold,
} from '../src/utils/watchUtils.js';

/* ── Constants ─────────────────────────────────────────────────────────────── */

describe('SEVERITY_TIERS and severityThreshold', () => {
  it('exports severity tier constants', () => {
    assert.equal(SEVERITY_TIERS.CRITICAL, 85);
    assert.equal(SEVERITY_TIERS.ELEVATED, 60);
    assert.equal(SEVERITY_TIERS.WATCH, 35);
    assert.equal(SEVERITY_TIERS.LOW, 0);
  });

  it('severityThreshold returns correct numeric threshold', () => {
    assert.equal(severityThreshold('CRITICAL'), 85);
    assert.equal(severityThreshold('ELEVATED'), 60);
    assert.equal(severityThreshold('WATCH'), 35);
    assert.equal(severityThreshold('LOW'), 0);
  });

  it('severityThreshold returns 0 for unknown tier', () => {
    assert.equal(severityThreshold('UNKNOWN'), 0);
    assert.equal(severityThreshold(''), 0);
  });

  it('SEVERITY_TIER_NAMES is ordered most-to-least severe', () => {
    assert.deepEqual(SEVERITY_TIER_NAMES, ['CRITICAL', 'ELEVATED', 'WATCH', 'LOW']);
  });
});

/* ── Legacy match types (backward compatibility) ───────────────────────────── */

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

  /* ── Enhanced rule types ── */

  // VAL-M3-013: Category matching
  it('matches article by category', () => {
    const article = { title: 'Conflict erupts', category: 'Conflict' };
    const watch = { type: 'category', value: 'Conflict' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('category matching is case-insensitive', () => {
    const article = { title: 'News', category: 'conflict' };
    const watch = { type: 'category', value: 'Conflict' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('does not match wrong category', () => {
    const article = { title: 'News', category: 'Political' };
    const watch = { type: 'category', value: 'Conflict' };
    assert.ok(!matchArticleToWatch(article, watch));
  });

  it('does not match category when article has no category', () => {
    const article = { title: 'News' };
    const watch = { type: 'category', value: 'Conflict' };
    assert.ok(!matchArticleToWatch(article, watch));
  });

  it('returns false for empty category value', () => {
    const article = { title: 'News', category: 'Conflict' };
    const watch = { type: 'category', value: '' };
    assert.ok(!matchArticleToWatch(article, watch));
  });

  // VAL-M3-015: Severity threshold matching
  it('matches article at CRITICAL severity threshold', () => {
    const article = { title: 'Major event', severity: 90 };
    const watch = { type: 'severity', value: 'CRITICAL' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('matches article at ELEVATED severity threshold', () => {
    const article = { title: 'Event', severity: 75 };
    const watch = { type: 'severity', value: 'ELEVATED' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('article at severity 65 does not match CRITICAL', () => {
    const article = { title: 'Event', severity: 65 };
    const watch = { type: 'severity', value: 'CRITICAL' };
    assert.ok(!matchArticleToWatch(article, watch));
  });

  it('article at severity 65 matches ELEVATED', () => {
    const article = { title: 'Event', severity: 65 };
    const watch = { type: 'severity', value: 'ELEVATED' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('article at severity 25 does not match WATCH', () => {
    const article = { title: 'Event', severity: 25 };
    const watch = { type: 'severity', value: 'WATCH' };
    assert.ok(!matchArticleToWatch(article, watch));
  });

  it('article at severity 25 matches LOW', () => {
    const article = { title: 'Event', severity: 25 };
    const watch = { type: 'severity', value: 'LOW' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('article at severity 0 matches LOW', () => {
    const article = { title: 'Event', severity: 0 };
    const watch = { type: 'severity', value: 'LOW' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  // VAL-M3-016: Source type matching
  it('matches article by sourceType from array', () => {
    const article = { title: 'News', sourceTypes: ['rss', 'gdelt'] };
    const watch = { type: 'sourceType', value: 'rss' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('matches article by sourceType from scalar property', () => {
    const article = { title: 'News', sourceType: 'official' };
    const watch = { type: 'sourceType', value: 'official' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('sourceType matching is case-insensitive', () => {
    const article = { title: 'News', sourceTypes: ['RSS'] };
    const watch = { type: 'sourceType', value: 'rss' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('does not match wrong sourceType', () => {
    const article = { title: 'News', sourceTypes: ['rss'] };
    const watch = { type: 'sourceType', value: 'gdelt' };
    assert.ok(!matchArticleToWatch(article, watch));
  });

  it('does not match sourceType when article has none', () => {
    const article = { title: 'News' };
    const watch = { type: 'sourceType', value: 'rss' };
    assert.ok(!matchArticleToWatch(article, watch));
  });

  // VAL-M3-016: Verification status matching
  it('matches article by verificationStatus', () => {
    const article = { title: 'News', verificationStatus: 'verified' };
    const watch = { type: 'verificationStatus', value: 'verified' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('verificationStatus matching is case-insensitive', () => {
    const article = { title: 'News', verificationStatus: 'VERIFIED' };
    const watch = { type: 'verificationStatus', value: 'verified' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  it('does not match wrong verificationStatus', () => {
    const article = { title: 'News', verificationStatus: 'developing' };
    const watch = { type: 'verificationStatus', value: 'verified' };
    assert.ok(!matchArticleToWatch(article, watch));
  });

  it('does not match verificationStatus when article has none', () => {
    const article = { title: 'News' };
    const watch = { type: 'verificationStatus', value: 'verified' };
    assert.ok(!matchArticleToWatch(article, watch));
  });

  // VAL-M3-014: Region ISO matching (already covered but explicitly test)
  it('matches article by region ISO code UA', () => {
    const article = { isoA2: 'UA', title: 'Ukraine event' };
    const watch = { type: 'region', value: 'UA' };
    assert.ok(matchArticleToWatch(article, watch));
  });

  // Combined criteria test
  it('combined conditions: category AND severity both must match', () => {
    const article = {
      title: 'Earthquake',
      category: 'Seismic',
      severity: 90,
    };
    const catWatch = { type: 'category', value: 'Seismic' };
    const sevWatch = { type: 'severity', value: 'CRITICAL' };
    assert.ok(matchArticleToWatch(article, catWatch));
    assert.ok(matchArticleToWatch(article, sevWatch));
  });

  it('combined conditions: sourceType AND verificationStatus both must match', () => {
    const article = {
      title: 'Official report',
      sourceTypes: ['rss'],
      verificationStatus: 'verified',
    };
    const srcWatch = { type: 'sourceType', value: 'rss' };
    const verWatch = { type: 'verificationStatus', value: 'verified' };
    assert.ok(matchArticleToWatch(article, srcWatch));
    assert.ok(matchArticleToWatch(article, verWatch));
  });

  it('partial match: only one of two combined criteria matches', () => {
    const article = {
      title: 'Unverified report',
      sourceTypes: ['rss'],
      verificationStatus: 'single-source',
    };
    const srcWatch = { type: 'sourceType', value: 'rss' };
    const verWatch = { type: 'verificationStatus', value: 'verified' };
    assert.ok(matchArticleToWatch(article, srcWatch)); // should match
    assert.ok(!matchArticleToWatch(article, verWatch)); // should NOT match
  });
});

/* ── countMatchesForWatchItems (enhanced) ──────────────────────────────────── */

describe('countMatchesForWatchItems', () => {
  const articles = [
    { isoA2: 'UA', title: 'Ukraine conflict', category: 'Conflict', severity: 90, sourceTypes: ['rss'], verificationStatus: 'verified', publishedAt: '2025-06-01T10:00:00Z' },
    { isoA2: 'UA', title: 'Ukraine aid', category: 'Humanitarian', severity: 50, sourceTypes: ['gdelt'], verificationStatus: 'developing', publishedAt: '2025-06-01T11:00:00Z' },
    { isoA2: 'US', title: 'US election', category: 'Political', severity: 30, sourceTypes: ['rss'], verificationStatus: 'single-source', publishedAt: '2025-06-01T09:00:00Z' },
    { isoA2: 'JP', title: 'Earthquake in Japan', category: 'Seismic', severity: 70, sourceTypes: ['official'], verificationStatus: 'official', publishedAt: '2025-06-01T12:00:00Z' },
  ];

  it('returns { counts, timestamps } object', () => {
    const watchItems = [{ id: 'w1', type: 'region', value: 'UA' }];
    const result = countMatchesForWatchItems(articles, watchItems);
    assert.ok(result && typeof result === 'object');
    assert.ok('counts' in result);
    assert.ok('timestamps' in result);
  });

  it('counts matches per watch item (legacy region/topic)', () => {
    const watchItems = [
      { id: 'w1', type: 'region', value: 'UA' },
      { id: 'w2', type: 'topic', value: 'earthquake' },
    ];
    const result = countMatchesForWatchItems(articles, watchItems);
    assert.equal(result.counts.w1, 2); // Two UA articles
    assert.equal(result.counts.w2, 1); // One earthquake article
  });

  it('tracks last-match timestamps', () => {
    const watchItems = [{ id: 'w1', type: 'region', value: 'UA' }];
    const result = countMatchesForWatchItems(articles, watchItems);
    assert.ok(result.timestamps.w1);
    assert.equal(result.timestamps.w1, '2025-06-01T11:00:00.000Z'); // latest UA article
  });

  it('sets timestamp to null for items with no matches', () => {
    const watchItems = [{ id: 'w1', type: 'region', value: 'DE' }];
    const result = countMatchesForWatchItems(articles, watchItems);
    assert.equal(result.counts.w1, 0);
    assert.equal(result.timestamps.w1, null);
  });

  it('returns empty counts/timestamps for empty articles', () => {
    const watchItems = [{ id: 'w1', type: 'region', value: 'UA' }];
    const result = countMatchesForWatchItems([], watchItems);
    assert.deepEqual(result, { counts: {}, timestamps: {} });
  });

  it('returns empty counts/timestamps for empty watchItems', () => {
    const result = countMatchesForWatchItems(articles, []);
    assert.deepEqual(result, { counts: {}, timestamps: {} });
  });

  // VAL-M3-013: Category counts
  it('counts category matches correctly', () => {
    const watchItems = [
      { id: 'c1', type: 'category', value: 'Conflict' },
      { id: 'c2', type: 'category', value: 'Seismic' },
    ];
    const result = countMatchesForWatchItems(articles, watchItems);
    assert.equal(result.counts.c1, 1); // One Conflict article
    assert.equal(result.counts.c2, 1); // One Seismic article
  });

  // VAL-M3-014: Region ISO counts
  it('counts region ISO matches correctly', () => {
    const watchItems = [
      { id: 'r1', type: 'region', value: 'UA' },
      { id: 'r2', type: 'region', value: 'JP' },
    ];
    const result = countMatchesForWatchItems(articles, watchItems);
    assert.equal(result.counts.r1, 2);
    assert.equal(result.counts.r2, 1);
  });

  // VAL-M3-015: Severity threshold counts
  it('counts severity threshold matches correctly', () => {
    const watchItems = [
      { id: 's1', type: 'severity', value: 'CRITICAL' },
      { id: 's2', type: 'severity', value: 'ELEVATED' },
      { id: 's3', type: 'severity', value: 'WATCH' },
    ];
    const result = countMatchesForWatchItems(articles, watchItems);
    // Article severities: 90 (UA+Conflict), 50 (UA+Humanitarian), 30 (US+Political), 70 (JP+Seismic)
    assert.equal(result.counts.s1, 1); // severity 90
    assert.equal(result.counts.s2, 2); // severity 90, 70
    assert.equal(result.counts.s3, 3); // severity 90, 50, 70
  });

  // VAL-M3-016: Source type and verification counts
  it('counts sourceType matches correctly', () => {
    const watchItems = [
      { id: 'st1', type: 'sourceType', value: 'rss' },
      { id: 'st2', type: 'sourceType', value: 'official' },
    ];
    const result = countMatchesForWatchItems(articles, watchItems);
    assert.equal(result.counts.st1, 2); // UA+Conflict (rss), US+Political (rss)
    assert.equal(result.counts.st2, 1); // JP+Seismic (official)
  });

  it('counts verificationStatus matches correctly', () => {
    const watchItems = [
      { id: 'v1', type: 'verificationStatus', value: 'verified' },
      { id: 'v2', type: 'verificationStatus', value: 'official' },
      { id: 'v3', type: 'verificationStatus', value: 'single-source' },
    ];
    const result = countMatchesForWatchItems(articles, watchItems);
    assert.equal(result.counts.v1, 1);
    assert.equal(result.counts.v2, 1);
    assert.equal(result.counts.v3, 1);
  });

  it('returns 0 for items with no matches', () => {
    const watchItems = [{ id: 'w1', type: 'region', value: 'DE' }];
    const result = countMatchesForWatchItems(articles, watchItems);
    assert.equal(result.counts.w1, 0);
  });

  it('legacy entity type still works alongside enhanced types', () => {
    const articlesWithEntities = [
      {
        id: 'e1',
        title: 'Test',
        severity: 50,
        category: 'Conflict',
        sourceTypes: ['rss'],
        verificationStatus: 'verified',
        entities: { people: [{ name: 'Zelensky' }], organizations: [], locations: [] },
        publishedAt: '2025-06-01T10:00:00Z',
      },
    ];
    const watchItems = [
      { id: 'leg1', type: 'entity', value: 'Zelensky' },
      { id: 'leg2', type: 'region', value: 'UA' },
      { id: 'enh1', type: 'severity', value: 'WATCH' },
      { id: 'enh2', type: 'category', value: 'Conflict' },
    ];
    const result = countMatchesForWatchItems(articlesWithEntities, watchItems);
    assert.equal(result.counts.leg1, 1); // entity match
    assert.equal(result.counts.leg2, 0); // no UA in this article
    assert.equal(result.counts.enh1, 1); // severity 50 >= 35 (WATCH)
    assert.equal(result.counts.enh2, 1); // category Conflict
  });
});

/* ── computeNewMatches ──────────────────────────────────────────────────────── */

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
    const currentCounts = { w1: 5 };
    const result = computeNewMatches(currentCounts, prevCounts, watchItems);
    assert.equal(result.length, 0);
  });

  it('works with enhanced rule types', () => {
    const watchItems = [
      { id: 'e1', type: 'category', value: 'Conflict', label: 'Conflict' },
      { id: 'e2', type: 'severity', value: 'CRITICAL', label: 'Critical Events' },
    ];
    const prevCounts = { e1: 2, e2: 0 };
    const currentCounts = { e1: 5, e2: 3 };
    const result = computeNewMatches(currentCounts, prevCounts, watchItems);

    assert.equal(result.length, 2);
    assert.equal(result[0].watchId, 'e1');
    assert.equal(result[0].newCount, 3);
    assert.equal(result[1].watchId, 'e2');
    assert.equal(result[1].newCount, 3);
    assert.equal(result[1].type, 'severity');
  });
});
