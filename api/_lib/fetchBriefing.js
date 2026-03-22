import { fetchLiveNews, getGdeltFetchHealth } from '../../src/services/gdeltService.js';
import { deduplicateArticles } from '../../src/utils/articleUtils.js';
import { isRunnableFeed } from '../../src/utils/sourceCoverage.js';
import { canonicalizeArticles } from '../../src/utils/newsPipeline.js';
import { deriveBriefingCoverage, normalizeAdminSourceHealth } from '../../src/utils/healthSummary.js';
import {
  mergeSourceState,
  readSourceCatalog,
  readSourceState,
  summarizeSourceCatalog,
  writeSourceState
} from '../../server/sourceCatalog.js';
import { fetchCatalogSource } from '../../server/sourceFetcher.js';

async function fetchAllRss(feeds) {
  const rssFeeds = (Array.isArray(feeds) ? feeds : []).filter((feed) => isRunnableFeed(feed));
  const results = await Promise.all(rssFeeds.map((feed) => fetchCatalogSource(feed, { idPrefix: 'serverless' })));

  const articles = [];
  const feedHealth = [];

  for (const result of results) {
    articles.push(...result.articles);
    feedHealth.push({
      feedId: result.feedId,
      name: result.name,
      sourceType: result.sourceType,
      sourceClass: result.sourceClass,
      fetchMode: result.fetchMode || 'rss',
      country: result.country,
      isoA2: result.isoA2,
      coverageCountries: result.coverageCountries,
      coverageIsoA2s: result.coverageIsoA2s,
      status: result.status,
      articleCount: result.articleCount,
      error: result.error || null
    });
  }

  return {
    articles,
    feedHealth,
    healthyFeeds: feedHealth.filter((feed) => feed.status === 'ok').length,
    failedFeeds: feedHealth.filter((feed) => feed.status === 'failed').length,
    emptyFeeds: feedHealth.filter((feed) => feed.status === 'empty').length,
    totalFeeds: rssFeeds.length
  };
}

// ── Build Briefing ───────────────────────────────────────────

export async function buildBriefing() {
  const [sourceCatalog, sourceState] = await Promise.all([
    readSourceCatalog(),
    readSourceState()
  ]);
  const runnableFeeds = sourceCatalog.filter((feed) => isRunnableFeed(feed));
  const [rssResult, gdeltResult] = await Promise.all([
    fetchAllRss(runnableFeeds),
    fetchLiveNews({ timespan: '24h', maxRecords: 250 }).catch(() => [])
  ]);
  const checkedAt = new Date().toISOString();
  const nextSourceState = mergeSourceState(sourceCatalog, sourceState, rssResult.feedHealth, checkedAt);
  await writeSourceState(nextSourceState);

  const rssArticles = rssResult.articles;
  const gdeltArticles = gdeltResult;
  const allArticles = deduplicateArticles([...gdeltArticles, ...rssArticles]);
  allArticles.sort((a, b) => b.severity - a.severity);

  const events = canonicalizeArticles(allArticles).map(evt => ({
    ...evt,
    lifecycle: evt.lifecycle || 'developing',
    firstSeenAt: evt.firstSeenAt || evt.publishedAt,
    lastUpdatedAt: evt.lastUpdatedAt || evt.publishedAt
  }));
  const sourceHealth = normalizeAdminSourceHealth({
    gdelt: getGdeltFetchHealth(),
    rss: {
      articlesFound: rssArticles.length,
      totalFeeds: rssResult.totalFeeds,
        healthyFeeds: rssResult.healthyFeeds,
        failedFeeds: rssResult.failedFeeds,
        emptyFeeds: rssResult.emptyFeeds,
        catalogSummary: summarizeSourceCatalog(sourceCatalog, nextSourceState),
        feeds: rssResult.feedHealth
      },
      backend: { status: 'ok', source: 'serverless' }
  });
  const { coverageMetrics, coverageDiagnostics } = deriveBriefingCoverage({
    events,
    sourceHealth
  });

  return {
    meta: {
      source: 'serverless',
      fetchedAt: checkedAt,
      totalFeeds: runnableFeeds.length,
      gdeltArticles: gdeltArticles.length,
      rssArticles: rssArticles.length,
      totalArticles: allArticles.length,
      totalEvents: events.length
    },
    articles: allArticles,
    events,
    coverageMetrics,
    coverageDiagnostics,
    sourceHealth,
    sourceCatalog: summarizeSourceCatalog(sourceCatalog, nextSourceState)
  };
}
