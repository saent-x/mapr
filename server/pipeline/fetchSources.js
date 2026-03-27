/**
 * Pipeline Stage 1: Source Fetching
 *
 * Fetches articles from all configured sources (GDELT, RSS, HTML scrapers).
 * Returns raw articles and health metadata for each source.
 */

import {
  fetchLiveNews,
  getGdeltFetchHealth
} from '../../src/services/gdeltService.js';
import { deduplicateArticles } from '../../src/utils/articleUtils.js';
import { buildRegionSourcePlan } from '../../src/utils/sourceCoverage.js';
import {
  mergeSourceState,
  selectSourcesForRun,
  summarizeSourceCatalog,
  writeSourceState
} from '../sourceCatalog.js';
import { fetchCatalogSource } from '../sourceFetcher.js';

const RSS_BATCH_SIZE = 6;
const RSS_BATCH_DELAY_MS = 400;

// ── Helpers ──────────────────────────────────────────────────────────────────

export function createEmptyRssHealth() {
  return {
    lastUpdated: null,
    fromCache: false,
    totalFeeds: 0,
    dueFeeds: 0,
    healthyFeeds: 0,
    emptyFeeds: 0,
    failedFeeds: 0,
    articlesFound: 0,
    catalogSummary: null,
    feeds: []
  };
}

export function getArticleFeedId(article, feeds) {
  if (article?.feedId) {
    return article.feedId;
  }

  const articleId = article?.id || '';
  if (!articleId.startsWith('rss-server-')) {
    return null;
  }

  const remainder = articleId.slice('rss-server-'.length);
  const matchedFeed = feeds.find((feed) => remainder.startsWith(`${feed.id}-`));
  return matchedFeed?.id || null;
}

export function buildRssHealthFromCatalog(catalog, state, checkedFeedResults = [], {
  checkedAt = new Date().toISOString(),
  fromCache = false,
  dueFeeds = null
} = {}) {
  const resultsById = new Map((checkedFeedResults || []).map((result) => [result.feedId, result]));
  const hydratedFeeds = (catalog || []).map((feed) => {
    const prior = state?.[feed.id] || {};
    const result = resultsById.get(feed.id);
    const lastStatus = result?.status || prior.lastStatus || 'never-checked';
    const lastCheckedAt = result ? checkedAt : prior.lastCheckedAt || null;
    const lastSuccessAt = result
      ? (result.status === 'failed' ? prior.lastSuccessAt || null : checkedAt)
      : prior.lastSuccessAt || null;

    return {
      feedId: feed.id,
      name: feed.name,
      sourceType: feed.sourceType || null,
      sourceClass: feed.sourceClass || null,
      fetchMode: feed.fetchMode || 'rss',
      country: feed.country || null,
      isoA2: feed.isoA2 || null,
      coverageCountries: feed.coverageCountries || [],
      coverageIsoA2s: feed.coverageIsoA2s || [],
      cadenceMinutes: feed.cadenceMinutes || null,
      status: lastStatus,
      articleCount: result ? result.articleCount : (prior.lastArticleCount || 0),
      proxy: result?.proxy || prior.proxy || null,
      error: result ? result.error || null : prior.lastError || null,
      lastCheckedAt,
      lastSuccessAt,
      nextCheckAt: prior.nextCheckAt || null,
      checkedThisRun: Boolean(result)
    };
  });

  return {
    lastUpdated: checkedAt,
    fromCache,
    totalFeeds: hydratedFeeds.length,
    dueFeeds: dueFeeds ?? hydratedFeeds.filter((feed) => feed.checkedThisRun).length,
    healthyFeeds: hydratedFeeds.filter((feed) => feed.status === 'ok').length,
    emptyFeeds: hydratedFeeds.filter((feed) => feed.status === 'empty').length,
    failedFeeds: hydratedFeeds.filter((feed) => feed.status === 'failed').length,
    articlesFound: hydratedFeeds.reduce((total, feed) => total + (feed.articleCount || 0), 0),
    catalogSummary: summarizeSourceCatalog(catalog, state),
    feeds: hydratedFeeds
  };
}

/**
 * Merge RSS articles: retain articles from feeds not refreshed this run,
 * replace articles from refreshed feeds with new results.
 */
export function mergeRssArticles(previousArticles, refreshedFeedIds, nextRssArticles, feeds) {
  const refreshedIds = refreshedFeedIds instanceof Set ? refreshedFeedIds : new Set(refreshedFeedIds || []);
  const retainedPreviousArticles = (previousArticles || []).filter((article) => {
    const feedId = getArticleFeedId(article, feeds);
    if (!feedId) {
      return false;
    }

    return !refreshedIds.has(feedId);
  });

  return [...retainedPreviousArticles, ...(nextRssArticles || [])];
}

/**
 * Retain previous GDELT articles from a snapshot (for fallback when GDELT fetch fails).
 */
export function retainPreviousGdeltArticles(previousArticles) {
  return (previousArticles || []).filter((article) => String(article?.id || '').startsWith('gdelt-'));
}

// ── Main fetch functions ─────────────────────────────────────────────────────

async function fetchRssFeed(feed) {
  return fetchCatalogSource(feed, { idPrefix: 'server' });
}

/**
 * Fetch articles from all RSS/HTML catalog sources.
 * Returns articles, checked feed IDs, health summary, and updated source state.
 */
export async function fetchRssNewsDirect({ force = false, catalog, sourceState: inputSourceState } = {}) {
  const selectedFeeds = selectSourcesForRun(catalog, inputSourceState, { force });
  const checkedAt = new Date().toISOString();

  if (selectedFeeds.length === 0) {
    return {
      articles: [],
      checkedFeedIds: [],
      health: buildRssHealthFromCatalog(catalog, inputSourceState, [], {
        checkedAt,
        fromCache: true,
        dueFeeds: 0
      }),
      updatedSourceState: inputSourceState
    };
  }

  const articles = [];
  const feeds = [];

  for (let index = 0; index < selectedFeeds.length; index += RSS_BATCH_SIZE) {
    const batch = selectedFeeds.slice(index, index + RSS_BATCH_SIZE);
    const results = await Promise.all(batch.map((feed) => fetchRssFeed(feed)));

    results.forEach((result) => {
      articles.push(...result.articles);
      feeds.push({
        feedId: result.feedId,
        name: result.name,
        sourceType: result.sourceType,
        sourceClass: result.sourceClass,
        fetchMode: result.fetchMode || 'rss',
        cadenceMinutes: result.cadenceMinutes || null,
        country: result.country,
        isoA2: result.isoA2,
        coverageCountries: result.coverageCountries,
        coverageIsoA2s: result.coverageIsoA2s,
        status: result.status,
        articleCount: result.articleCount,
        proxy: 'direct',
        error: result.error
      });
    });

    if (index + RSS_BATCH_SIZE < selectedFeeds.length) {
      await new Promise((resolve) => setTimeout(resolve, RSS_BATCH_DELAY_MS));
    }
  }

  articles.sort((left, right) => right.severity - left.severity);
  const updatedSourceState = mergeSourceState(catalog, inputSourceState, feeds, checkedAt);
  await writeSourceState(updatedSourceState);

  return {
    articles,
    checkedFeedIds: selectedFeeds.map((feed) => feed.id),
    health: buildRssHealthFromCatalog(catalog, updatedSourceState, feeds, {
      checkedAt,
      fromCache: false,
      dueFeeds: selectedFeeds.length
    }),
    updatedSourceState
  };
}

/**
 * Stage 1 entry point: Fetch all sources (GDELT + RSS/HTML) in parallel.
 *
 * @param {Object} options
 * @param {boolean} options.force - Force refresh regardless of cadence
 * @param {string} options.timespan - GDELT query timespan
 * @param {number} options.maxRecords - GDELT max records
 * @param {Array} options.catalog - Source catalog array
 * @param {Object} options.sourceState - Current source state
 * @returns {{ gdeltArticles: Array, rssResult: Object, updatedSourceState: Object }}
 */
export async function fetchAllSources({ force = false, timespan, maxRecords, catalog, sourceState: inputSourceState }) {
  const [gdeltArticles, rssResult] = await Promise.all([
    fetchLiveNews({ timespan, maxRecords }).catch((error) => {
      console.warn('GDELT ingest failed:', error.message);
      return [];
    }),
    fetchRssNewsDirect({ force, catalog, sourceState: inputSourceState }).catch((error) => {
      console.warn('RSS ingest failed:', error.message);
      return {
        articles: [],
        checkedFeedIds: [],
        health: createEmptyRssHealth(),
        updatedSourceState: inputSourceState
      };
    })
  ]);

  console.log(`[ingest] GDELT returned ${gdeltArticles.length} articles, RSS returned ${rssResult.articles?.length || 0} articles from ${rssResult.checkedFeedIds?.length || 0} feeds`);

  return {
    gdeltArticles,
    rssResult,
    updatedSourceState: rssResult.updatedSourceState || inputSourceState,
    gdeltHealth: getGdeltFetchHealth()
  };
}

// ── Region backfill (used by getRegionBriefing) ─────────────────────────────

const REGION_BACKFILL_FEED_LIMIT = 12;
const REGION_BACKFILL_TARGET_ARTICLES = 18;
const REGION_BACKFILL_MAX_RECORDS = 80;

export function getRegionBackfillFeedPlan(regionName, catalog) {
  return buildRegionSourcePlan(regionName, {
    limit: REGION_BACKFILL_FEED_LIMIT,
    feeds: catalog
  }).plannedFeeds
    .map((plannedFeed) => catalog.find((feed) => feed.id === plannedFeed.id))
    .filter(Boolean);
}

export async function fetchRegionRssBackfill(regionName, iso, catalog) {
  const feeds = getRegionBackfillFeedPlan(regionName, catalog);
  if (feeds.length === 0) {
    return { articles: [], feedHealth: [] };
  }

  const regionArticles = [];
  const feedHealth = [];

  for (let index = 0; index < feeds.length; index += RSS_BATCH_SIZE) {
    const batch = feeds.slice(index, index + RSS_BATCH_SIZE);
    const results = await Promise.all(batch.map((feed) => fetchRssFeed(feed)));

    results.forEach((result) => {
      feedHealth.push({
        feedId: result.feedId,
        name: result.name,
        sourceType: result.sourceType,
        sourceClass: result.sourceClass,
        fetchMode: result.fetchMode || 'rss',
        cadenceMinutes: result.cadenceMinutes || null,
        country: result.country,
        isoA2: result.isoA2,
        coverageCountries: result.coverageCountries,
        coverageIsoA2s: result.coverageIsoA2s,
        status: result.status,
        articleCount: result.articleCount,
        proxy: 'direct',
        error: result.error
      });

      regionArticles.push(...result.articles.filter((article) => article.isoA2 === iso));
    });

    if (regionArticles.length >= REGION_BACKFILL_TARGET_ARTICLES) {
      break;
    }

    if (index + RSS_BATCH_SIZE < feeds.length) {
      await new Promise((resolve) => setTimeout(resolve, RSS_BATCH_DELAY_MS));
    }
  }

  return {
    articles: deduplicateArticles(regionArticles).slice(0, REGION_BACKFILL_MAX_RECORDS),
    feedHealth
  };
}
