import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── fetchSources stage tests ─────────────────────────────────────────────────

import {
  createEmptyRssHealth,
  getArticleFeedId,
  buildRssHealthFromCatalog,
  mergeRssArticles,
  retainPreviousGdeltArticles
} from '../server/pipeline/fetchSources.js';

test('createEmptyRssHealth returns a valid empty health object', () => {
  const health = createEmptyRssHealth();
  assert.equal(health.lastUpdated, null);
  assert.equal(health.totalFeeds, 0);
  assert.equal(health.healthyFeeds, 0);
  assert.equal(health.failedFeeds, 0);
  assert.equal(health.articlesFound, 0);
  assert.ok(Array.isArray(health.feeds));
  assert.equal(health.feeds.length, 0);
});

test('getArticleFeedId extracts feedId from article with explicit feedId', () => {
  const article = { id: 'rss-server-bbc-123', feedId: 'bbc' };
  assert.equal(getArticleFeedId(article, []), 'bbc');
});

test('getArticleFeedId extracts feedId from article id pattern', () => {
  const feeds = [{ id: 'bbc' }, { id: 'reuters' }];
  const article = { id: 'rss-server-bbc-456' };
  assert.equal(getArticleFeedId(article, feeds), 'bbc');
});

test('getArticleFeedId returns null for GDELT articles', () => {
  const article = { id: 'gdelt-crisis-123' };
  assert.equal(getArticleFeedId(article, []), null);
});

test('getArticleFeedId returns null for null/undefined article', () => {
  assert.equal(getArticleFeedId(null, []), null);
  assert.equal(getArticleFeedId(undefined, []), null);
});

test('buildRssHealthFromCatalog computes health summary from catalog and state', () => {
  const catalog = [
    { id: 'feed-a', name: 'Feed A' },
    { id: 'feed-b', name: 'Feed B' },
  ];
  const state = {
    'feed-a': { lastStatus: 'ok', lastArticleCount: 10, lastCheckedAt: '2025-01-01T00:00:00Z' },
    'feed-b': { lastStatus: 'failed', lastArticleCount: 0, lastCheckedAt: '2025-01-01T00:00:00Z' },
  };
  const health = buildRssHealthFromCatalog(catalog, state);

  assert.equal(health.totalFeeds, 2);
  assert.equal(health.healthyFeeds, 1);
  assert.equal(health.failedFeeds, 1);
  assert.equal(health.feeds.length, 2);
});

test('mergeRssArticles retains articles from unchecked feeds and replaces checked feeds', () => {
  const feeds = [{ id: 'bbc' }, { id: 'reuters' }];
  const previous = [
    { id: 'rss-server-bbc-1', feedId: 'bbc', title: 'Old BBC' },
    { id: 'rss-server-reuters-1', feedId: 'reuters', title: 'Old Reuters' },
  ];
  const refreshedFeedIds = ['bbc'];
  const next = [
    { id: 'rss-server-bbc-2', feedId: 'bbc', title: 'New BBC' },
  ];

  const merged = mergeRssArticles(previous, refreshedFeedIds, next, feeds);
  assert.equal(merged.length, 2);
  assert.ok(merged.some(a => a.title === 'Old Reuters'), 'unchecked feed articles retained');
  assert.ok(merged.some(a => a.title === 'New BBC'), 'checked feed articles replaced');
  assert.ok(!merged.some(a => a.title === 'Old BBC'), 'old checked feed articles removed');
});

test('retainPreviousGdeltArticles keeps only GDELT articles', () => {
  const articles = [
    { id: 'gdelt-crisis-1', title: 'GDELT article' },
    { id: 'rss-server-bbc-1', title: 'RSS article' },
    { id: 'gdelt-humanitarian-2', title: 'Another GDELT' },
  ];
  const retained = retainPreviousGdeltArticles(articles);
  assert.equal(retained.length, 2);
  assert.ok(retained.every(a => a.id.startsWith('gdelt-')));
});

test('retainPreviousGdeltArticles handles empty/null input', () => {
  assert.deepEqual(retainPreviousGdeltArticles([]), []);
  assert.deepEqual(retainPreviousGdeltArticles(null), []);
  assert.deepEqual(retainPreviousGdeltArticles(undefined), []);
});

// ── normalizeArticles stage tests ────────────────────────────────────────────

import { mergeAndDeduplicateArticles } from '../server/pipeline/normalizeArticles.js';

test('mergeAndDeduplicateArticles combines GDELT and RSS articles', () => {
  const gdelt = [
    { id: 'gdelt-1', url: 'https://a.com/1', title: 'A Story', source: 'gdelt-src' },
  ];
  const rssResult = {
    articles: [
      { id: 'rss-1', url: 'https://b.com/1', title: 'B Story', source: 'rss-src' },
    ],
    checkedFeedIds: ['feed-a'],
  };
  const merged = mergeAndDeduplicateArticles({
    gdeltArticles: gdelt,
    rssResult,
    previousArticles: [],
    catalog: [{ id: 'feed-a' }],
  });
  assert.equal(merged.length, 2);
});

test('mergeAndDeduplicateArticles removes URL duplicates across sources', () => {
  const gdelt = [
    { id: 'gdelt-1', url: 'https://same.com/article', title: 'Story A', source: 'gdelt-src' },
  ];
  const rssResult = {
    articles: [
      { id: 'rss-1', url: 'https://same.com/article', title: 'Story A', source: 'rss-src' },
    ],
    checkedFeedIds: ['feed-a'],
  };
  const merged = mergeAndDeduplicateArticles({
    gdeltArticles: gdelt,
    rssResult,
    previousArticles: [],
    catalog: [{ id: 'feed-a' }],
  });
  assert.equal(merged.length, 1, 'duplicate URL should be deduplicated');
});

test('mergeAndDeduplicateArticles falls back to previous GDELT articles when current is empty', () => {
  const previousArticles = [
    { id: 'gdelt-old-1', url: 'https://old.com/1', title: 'Old GDELT', source: 'old-src' },
    { id: 'rss-server-bbc-1', url: 'https://bbc.com/1', title: 'Old BBC', feedId: 'bbc', source: 'bbc-src' },
  ];
  const rssResult = {
    articles: [
      { id: 'rss-new-1', url: 'https://new.com/1', title: 'New RSS', source: 'new-src' },
    ],
    checkedFeedIds: ['feed-new'],
  };
  const merged = mergeAndDeduplicateArticles({
    gdeltArticles: [], // empty GDELT
    rssResult,
    previousArticles,
    catalog: [{ id: 'bbc' }, { id: 'feed-new' }],
  });
  assert.ok(merged.some(a => a.id === 'gdelt-old-1'), 'should retain old GDELT articles as fallback');
  assert.ok(merged.some(a => a.id === 'rss-new-1'), 'should include new RSS articles');
});

// ── enrichEntities stage tests ───────────────────────────────────────────────

import { enrichArticlesWithEntities } from '../server/pipeline/enrichEntities.js';

test('enrichArticlesWithEntities adds entities to articles', async () => {
  const articles = [
    { id: 'a1', title: 'NATO secretary general meets with EU leaders in Brussels' },
    { id: 'a2', title: 'Earthquake strikes northern Japan causing widespread damage' },
  ];
  await enrichArticlesWithEntities(articles);

  assert.ok(articles[0].entities, 'first article should have entities');
  assert.ok(Array.isArray(articles[0].entities.organizations), 'should have organizations array');
  assert.ok(articles[1].entities, 'second article should have entities');
  assert.ok(Array.isArray(articles[1].entities.locations), 'should have locations array');
});

test('enrichArticlesWithEntities skips articles that already have entities', async () => {
  const existingEntities = { people: [{ name: 'Test' }], organizations: [], locations: [], category: 'politics' };
  const articles = [
    { id: 'a1', title: 'Some headline', entities: existingEntities },
  ];
  await enrichArticlesWithEntities(articles);
  assert.deepEqual(articles[0].entities, existingEntities, 'should not overwrite existing entities');
});

test('enrichArticlesWithEntities handles errors gracefully', async () => {
  const articles = [
    { id: 'a1', title: '' }, // empty title, may fail
    { id: 'a2', title: 'Valid headline about world affairs' },
  ];
  // Should not throw
  await enrichArticlesWithEntities(articles);
  assert.ok(articles[0].entities, 'even errored articles get empty entities');
  assert.ok(articles[1].entities, 'valid articles get entities');
});

// ── persistData stage tests ──────────────────────────────────────────────────

import { buildHistoryEntry } from '../server/pipeline/persistData.js';

test('buildHistoryEntry creates a valid history entry on success', () => {
  const entry = buildHistoryEntry({
    status: 'ok',
    reason: 'manual',
    startedAt: Date.now() - 5000,
    articles: [{ id: '1' }, { id: '2' }],
    events: [{ id: 'e1' }],
  });

  assert.equal(entry.status, 'ok');
  assert.equal(entry.reason, 'manual');
  assert.equal(entry.articleCount, 2);
  assert.equal(entry.eventCount, 1);
  assert.ok(entry.durationMs >= 0);
  assert.equal(entry.error, null);
  assert.ok(entry.at, 'should have timestamp');
});

test('buildHistoryEntry creates a valid history entry on failure', () => {
  const entry = buildHistoryEntry({
    status: 'failed',
    reason: 'scheduled',
    startedAt: Date.now() - 1000,
    error: 'Connection timeout',
  });

  assert.equal(entry.status, 'failed');
  assert.equal(entry.error, 'Connection timeout');
  assert.equal(entry.articleCount, 0);
  assert.equal(entry.eventCount, 0);
});

// ── Pipeline module structure tests ──────────────────────────────────────────

test('server/pipeline/ directory has all pipeline stage modules', () => {
  const pipelineDir = resolve(__dirname, '..', 'server', 'pipeline');
  const expectedFiles = [
    'fetchSources.js',
    'normalizeArticles.js',
    'enrichEntities.js',
    'correlateEvents.js',
    'trackVelocity.js',
    'persistData.js',
    'index.js',
  ];

  for (const file of expectedFiles) {
    const filePath = resolve(pipelineDir, file);
    try {
      readFileSync(filePath);
    } catch {
      assert.fail(`Pipeline module ${file} should exist in server/pipeline/`);
    }
  }
});

test('pipeline index.js barrel exports all stage functions', async () => {
  const barrel = await import('../server/pipeline/index.js');

  // Stage 1: fetchSources
  assert.equal(typeof barrel.fetchAllSources, 'function', 'fetchAllSources should be exported');
  assert.equal(typeof barrel.createEmptyRssHealth, 'function', 'createEmptyRssHealth should be exported');
  assert.equal(typeof barrel.mergeRssArticles, 'function', 'mergeRssArticles should be exported');
  assert.equal(typeof barrel.retainPreviousGdeltArticles, 'function', 'retainPreviousGdeltArticles should be exported');

  // Stage 2-4: normalizeArticles
  assert.equal(typeof barrel.mergeAndDeduplicateArticles, 'function', 'mergeAndDeduplicateArticles should be exported');

  // Stage 5: enrichEntities
  assert.equal(typeof barrel.enrichArticlesWithEntities, 'function', 'enrichArticlesWithEntities should be exported');

  // Stage 6: trackVelocity
  assert.equal(typeof barrel.trackAndComputeVelocity, 'function', 'trackAndComputeVelocity should be exported');

  // Stage 7: correlateEvents
  assert.equal(typeof barrel.correlateAndEnrichEvents, 'function', 'correlateAndEnrichEvents should be exported');
  assert.equal(typeof barrel.persistEnrichedEvents, 'function', 'persistEnrichedEvents should be exported');

  // Stage 8: persistData
  assert.equal(typeof barrel.persistArticles, 'function', 'persistArticles should be exported');
  assert.equal(typeof barrel.pruneOldData, 'function', 'pruneOldData should be exported');
  assert.equal(typeof barrel.buildHistoryEntry, 'function', 'buildHistoryEntry should be exported');
});

test('ingest.js refreshSnapshot reads as a clear pipeline of numbered stages', () => {
  const ingestSource = readFileSync(resolve(__dirname, '..', 'server', 'ingest.js'), 'utf-8');

  // Verify all 9 stages are clearly marked with comments
  const stageComments = [
    'Stage 1: Fetch from all sources',
    'Stage 2: Normalize and deduplicate',
    'Stage 3: Enrich articles with named entities',
    'Stage 4: Canonicalize articles into events',
    'Stage 5: Persist articles',
    'Stage 6: Track velocity',
    'Stage 7: Correlate and enrich events',
    'Stage 8: Persist events and prune',
    'Stage 9: Finalize snapshot',
  ];

  for (const comment of stageComments) {
    assert.ok(
      ingestSource.includes(comment),
      `refreshSnapshot should contain stage comment: "${comment}"`
    );
  }
});

test('ingest.js imports pipeline stages from server/pipeline/', () => {
  const ingestSource = readFileSync(resolve(__dirname, '..', 'server', 'ingest.js'), 'utf-8');

  const pipelineImports = [
    './pipeline/fetchSources.js',
    './pipeline/normalizeArticles.js',
    './pipeline/enrichEntities.js',
    './pipeline/trackVelocity.js',
    './pipeline/correlateEvents.js',
    './pipeline/persistData.js',
  ];

  for (const importPath of pipelineImports) {
    assert.ok(
      ingestSource.includes(importPath),
      `ingest.js should import from ${importPath}`
    );
  }
});

test('each pipeline stage module has a JSDoc header describing its purpose', () => {
  const stageFiles = [
    'fetchSources.js',
    'normalizeArticles.js',
    'enrichEntities.js',
    'correlateEvents.js',
    'trackVelocity.js',
    'persistData.js',
  ];

  for (const file of stageFiles) {
    const source = readFileSync(resolve(__dirname, '..', 'server', 'pipeline', file), 'utf-8');
    assert.ok(
      source.startsWith('/**'),
      `${file} should start with a JSDoc comment describing the pipeline stage`
    );
  }
});
