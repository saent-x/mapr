import { ALL_RSS_FEEDS } from '../src/services/rssService.js';
import {
  buildRegionFocusQueries,
  clearCache as clearGdeltCache,
  fetchLiveNews,
  getGdeltFetchHealth
} from '../src/services/gdeltService.js';
import { deriveCategory, deriveSeverity, deduplicateArticles } from '../src/utils/articleUtils.js';
import { buildCoverageDiagnostics } from '../src/utils/coverageDiagnostics.js';
import { buildRegionSourcePlan, getFeedCoverageCountries, getFeedCoverageIsos } from '../src/utils/sourceCoverage.js';
import {
  buildCoverageSnapshot,
  buildCoverageTransitions,
  getRegionCoverageHistory as getRegionCoverageHistoryFromSnapshots,
  mergeCoverageHistory,
  summarizeCoverageHistory,
  summarizeCoverageTrends
} from '../src/utils/coverageHistory.js';
import { countryToIso, geocodeArticleAll, isoToCountry } from '../src/utils/geocoder.js';
import { detectLanguage } from '../src/utils/languageUtils.js';
import { calculateCoverageMetrics, canonicalizeArticles } from '../src/utils/newsPipeline.js';
import { buildOpsAlerts, buildRegionLagDiagnostics } from '../src/utils/opsDiagnostics.js';
import { classifySourceType } from '../src/utils/sourceMetadata.js';
import {
  appendHistory,
  DATABASE_PATH,
  readCoverageHistory,
  readHistory,
  readSnapshot,
  writeCoverageHistory,
  writeSnapshot
} from './storage.js';
import { parseFeedItems } from './rssParser.js';

const DEFAULT_TIMESPAN = '24h';
const DEFAULT_MAX_RECORDS = 250;
const REGION_BACKFILL_TIMESPAN = '168h';
const REGION_BACKFILL_MAX_RECORDS = 80;
const REGION_BACKFILL_FEED_LIMIT = 12;
const REGION_BACKFILL_TARGET_ARTICLES = 18;
const RSS_BATCH_SIZE = 6;
const RSS_BATCH_DELAY_MS = 400;
const REQUEST_TIMEOUT_MS = 6500;
const REFRESH_INTERVAL_MS = Number(process.env.MAPR_REFRESH_MS || 10 * 60 * 1000);
const STALE_AFTER_MS = Number(process.env.MAPR_STALE_AFTER_MS || 30 * 60 * 1000);

let currentSnapshot = null;
let refreshPromise = null;
let refreshTimer = null;
let loadedFromDisk = false;
let coverageHistory = [];
let coverageTrends = {
  latestAt: null,
  comparedAt: null,
  risingRegions: [],
  newlyVerifiedRegions: [],
  atRiskRegions: []
};

let ingestHealth = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  lastError: null
};

function createEmptyRssHealth() {
  return {
    lastUpdated: null,
    fromCache: false,
    totalFeeds: 0,
    healthyFeeds: 0,
    emptyFeeds: 0,
    failedFeeds: 0,
    articlesFound: 0,
    feeds: []
  };
}

function getSnapshotAgeMs() {
  if (!currentSnapshot?.fetchedAt) {
    return null;
  }

  const ageMs = Date.now() - new Date(currentSnapshot.fetchedAt).getTime();
  return Number.isFinite(ageMs) ? Math.max(0, ageMs) : null;
}

function isSnapshotStale() {
  const ageMs = getSnapshotAgeMs();
  return ageMs == null ? true : ageMs > STALE_AFTER_MS;
}

function buildBackendHealth() {
  const snapshotAgeMs = getSnapshotAgeMs();
  let status = 'cold';

  if (currentSnapshot) {
    status = isSnapshotStale() ? 'stale' : 'healthy';
    if (ingestHealth.lastError && !isSnapshotStale()) {
      status = 'degraded';
    }
  }

  return {
    status,
    lastAttemptAt: ingestHealth.lastAttemptAt,
    lastSuccessAt: ingestHealth.lastSuccessAt,
    lastError: ingestHealth.lastError,
    consecutiveFailures: ingestHealth.consecutiveFailures,
    refreshInProgress: Boolean(refreshPromise),
    snapshotAgeMs,
    snapshotPath: DATABASE_PATH,
    storagePath: DATABASE_PATH,
    storageBackend: 'sqlite'
  };
}

function createResponsePayload() {
  const backend = buildBackendHealth();

  return {
    meta: {
      source: 'server',
      fetchedAt: currentSnapshot?.fetchedAt || null,
      snapshotAgeMs: backend.snapshotAgeMs,
      refreshInProgress: backend.refreshInProgress,
      stale: backend.status === 'stale',
      loadedFromDisk
    },
    articles: currentSnapshot?.articles || [],
    events: currentSnapshot?.events || [],
    coverageTrends,
    sourceHealth: {
      gdelt: currentSnapshot?.sourceHealth?.gdelt || null,
      rss: currentSnapshot?.sourceHealth?.rss || null,
      backend
    },
    ingestHealth
  };
}

function buildHistoryEntry({ status, reason, startedAt, articles, events, error }) {
  return {
    at: new Date().toISOString(),
    status,
    reason,
    durationMs: Date.now() - startedAt,
    articleCount: articles?.length || 0,
    eventCount: events?.length || 0,
    error: error || null
  };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
        'user-agent': 'Mapr/1.0 (+local ingest)'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeServerRssArticle(item, feed, index) {
  if (!item?.title) {
    return [];
  }

  const geos = geocodeArticleAll(item.title, feed.country, item.summary);
  if (geos.length === 0) {
    return [];
  }

  const publishedDate = new Date(item.publishedAt || Date.now());
  const publishedAt = Number.isNaN(publishedDate.getTime())
    ? new Date().toISOString()
    : publishedDate.toISOString();
  const baseId = `rss-server-${feed.id}-${index}`;

  return geos.map((geo, geoIdx) => ({
    id: geos.length > 1 ? `${baseId}-${geoIdx}` : baseId,
    title: item.title,
    summary: item.summary || item.title,
    url: item.link || '',
    severity: deriveSeverity(item.title),
    publishedAt,
    region: geo.region,
    isoA2: countryToIso(geo.region) || 'XX',
    locality: geo.locality,
    category: deriveCategory(item.title),
    coordinates: [geo.lat, geo.lng],
    source: feed.name,
    sourceCountry: feed.country || null,
    sourceType: classifySourceType({
      source: feed.name,
      sourceCountry: feed.country,
      sourceType: feed.sourceType
    }),
    language: detectLanguage(`${item.title} ${item.summary || ''}`, feed.language || null),
    geocodePrecision: geo.precision,
    geocodeMatchedOn: geo.matchedOn,
    socialimage: item.mediaUrl || null,
    isLive: true
  }));
}

async function fetchRssFeed(feed) {
  try {
    const xmlText = await fetchText(feed.url);
    const parsedItems = parseFeedItems(xmlText);
    const articles = parsedItems
      .flatMap((item, index) => normalizeServerRssArticle(item, feed, index));

    return {
      feedId: feed.id,
      name: feed.name,
      sourceType: feed.sourceType || null,
      country: feed.country || null,
      isoA2: feed.country ? countryToIso(feed.country) || null : null,
      coverageCountries: getFeedCoverageCountries(feed),
      coverageIsoA2s: getFeedCoverageIsos(feed),
      status: articles.length > 0 ? 'ok' : 'empty',
      articleCount: articles.length,
      error: null,
      articles
    };
  } catch (error) {
    return {
      feedId: feed.id,
      name: feed.name,
      sourceType: feed.sourceType || null,
      country: feed.country || null,
      isoA2: feed.country ? countryToIso(feed.country) || null : null,
      coverageCountries: getFeedCoverageCountries(feed),
      coverageIsoA2s: getFeedCoverageIsos(feed),
      status: 'failed',
      articleCount: 0,
      error: error.message,
      articles: []
    };
  }
}

async function fetchRssNewsDirect() {
  const articles = [];
  const feeds = [];

  for (let index = 0; index < ALL_RSS_FEEDS.length; index += RSS_BATCH_SIZE) {
    const batch = ALL_RSS_FEEDS.slice(index, index + RSS_BATCH_SIZE);
    const results = await Promise.all(batch.map((feed) => fetchRssFeed(feed)));

    results.forEach((result) => {
      articles.push(...result.articles);
      feeds.push({
        feedId: result.feedId,
        name: result.name,
        sourceType: result.sourceType,
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

    if (index + RSS_BATCH_SIZE < ALL_RSS_FEEDS.length) {
      await new Promise((resolve) => setTimeout(resolve, RSS_BATCH_DELAY_MS));
    }
  }

  articles.sort((left, right) => right.severity - left.severity);

  return {
    articles,
    health: {
      lastUpdated: new Date().toISOString(),
      fromCache: false,
      totalFeeds: ALL_RSS_FEEDS.length,
      healthyFeeds: feeds.filter((feed) => feed.status === 'ok').length,
      emptyFeeds: feeds.filter((feed) => feed.status === 'empty').length,
      failedFeeds: feeds.filter((feed) => feed.status === 'failed').length,
      articlesFound: articles.length,
      feeds
    }
  };
}

export function getRegionBackfillFeedPlan(regionName) {
  return buildRegionSourcePlan(regionName, { limit: REGION_BACKFILL_FEED_LIMIT }).plannedFeeds
    .map((plannedFeed) => ALL_RSS_FEEDS.find((feed) => feed.id === plannedFeed.id))
    .filter(Boolean);
}

async function fetchRegionRssBackfill(regionName, iso) {
  const feeds = getRegionBackfillFeedPlan(regionName);
  if (feeds.length === 0) {
    return {
      articles: [],
      feedHealth: []
    };
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

function persistIngestHealth(snapshot) {
  ingestHealth = {
    lastAttemptAt: snapshot?.ingestHealth?.lastAttemptAt || null,
    lastSuccessAt: snapshot?.ingestHealth?.lastSuccessAt || null,
    consecutiveFailures: snapshot?.ingestHealth?.consecutiveFailures || 0,
    lastError: snapshot?.ingestHealth?.lastError || null
  };
}

export async function initializeIngestion() {
  currentSnapshot = await readSnapshot();
  coverageHistory = await readCoverageHistory();
  coverageTrends = summarizeCoverageTrends(coverageHistory);
  loadedFromDisk = Boolean(currentSnapshot);
  persistIngestHealth(currentSnapshot);

  if (currentSnapshot && coverageHistory.length === 0) {
    const snapshotEvents = currentSnapshot.events || canonicalizeArticles(currentSnapshot.articles || []);
    const coverageMetrics = calculateCoverageMetrics(snapshotEvents);
    const diagnostics = buildCoverageDiagnostics(coverageMetrics, currentSnapshot.sourceHealth || {});
    coverageHistory = mergeCoverageHistory(
      coverageHistory,
      buildCoverageSnapshot(diagnostics, currentSnapshot.fetchedAt || new Date().toISOString()),
      48
    );
    coverageTrends = summarizeCoverageTrends(coverageHistory);
    await writeCoverageHistory(coverageHistory).catch(() => {});
  }

  if (process.env.MAPR_SKIP_INITIAL_REFRESH === '1') {
    return;
  }

  if (!currentSnapshot) {
    try {
      await refreshSnapshot({ force: true, reason: 'startup' });
    } catch (error) {
      console.warn('Initial ingest failed:', error.message);
    }
    return;
  }

  if (isSnapshotStale()) {
    refreshSnapshot({ reason: 'warm-start' }).catch((error) => {
      console.warn('Warm-start refresh failed:', error.message);
    });
  }
}

export function startScheduler() {
  if (process.env.MAPR_DISABLE_AUTO_REFRESH === '1' || refreshTimer) {
    return;
  }

  refreshTimer = setInterval(() => {
    refreshSnapshot({ reason: 'scheduled' }).catch((error) => {
      console.warn('Scheduled refresh failed:', error.message);
    });
  }, REFRESH_INTERVAL_MS);
}

export function stopScheduler() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

export function getBriefing() {
  return createResponsePayload();
}

export async function getHealth() {
  const history = await readHistory();
  const backend = buildBackendHealth();
  const sourceHealth = currentSnapshot?.sourceHealth || {
    gdelt: null,
    rss: createEmptyRssHealth()
  };
  const coverageMetrics = calculateCoverageMetrics(currentSnapshot?.events || []);
  const coverageDiagnostics = buildCoverageDiagnostics(coverageMetrics, sourceHealth);
  const regionLag = buildRegionLagDiagnostics(currentSnapshot?.events || []);
  const opsAlerts = buildOpsAlerts({
    backendHealth: backend,
    sourceHealth,
    coverageDiagnostics,
    regionLagDiagnostics: regionLag
  });

  return {
    ...backend,
    history: history.slice(0, 12),
    coverageTrends,
    sourceHealth,
    alerts: opsAlerts.alerts,
    alertSummary: opsAlerts.summary,
    regionLag
  };
}

export function getCoverageHistory(limit = 8, transitionLimit = 16) {
  return {
    snapshots: summarizeCoverageHistory(coverageHistory, limit),
    transitions: buildCoverageTransitions(coverageHistory, transitionLimit),
    trends: coverageTrends
  };
}

export function getRegionCoverageHistory(iso, limit = 10, transitionLimit = 8) {
  return getRegionCoverageHistoryFromSnapshots(coverageHistory, iso, limit, transitionLimit);
}

export async function getRegionBriefing(iso) {
  const normalizedIso = (iso || '').trim().toUpperCase();
  if (!normalizedIso) {
    throw new Error('Missing iso for region briefing');
  }

  const regionName = isoToCountry(normalizedIso);
  if (!regionName) {
    throw new Error(`Unknown region iso: ${normalizedIso}`);
  }

  const coverageMetrics = calculateCoverageMetrics(currentSnapshot?.events || []);
  const coverageDiagnostics = buildCoverageDiagnostics(coverageMetrics, currentSnapshot?.sourceHealth || {});
  const sourcePlan = buildRegionSourcePlan(regionName, {
    limit: REGION_BACKFILL_FEED_LIMIT,
    coverageDiagnostics
  });

  const existingArticles = (currentSnapshot?.articles || []).filter((article) => article.isoA2 === normalizedIso);
  if (existingArticles.length > 0) {
    return {
      iso: normalizedIso,
      region: regionName,
      fetchedAt: currentSnapshot?.fetchedAt || new Date().toISOString(),
      fromSnapshot: true,
      articles: existingArticles,
      events: canonicalizeArticles(existingArticles),
      sourcePlan,
      feedChecks: (currentSnapshot?.sourceHealth?.rss?.feeds || []).filter((feed) => (
        feed.isoA2 === normalizedIso
        || (Array.isArray(feed.coverageIsoA2s) && feed.coverageIsoA2s.includes(normalizedIso))
      ))
    };
  }

  const focusedQueries = buildRegionFocusQueries(regionName);
  const [fetchedArticles, rssBackfill] = await Promise.all([
    fetchLiveNews({
      queries: focusedQueries,
      timespan: REGION_BACKFILL_TIMESPAN,
      maxRecords: REGION_BACKFILL_MAX_RECORDS
    }).catch((error) => {
      console.warn(`Region GDELT backfill failed for ${normalizedIso}:`, error.message);
      return [];
    }),
    fetchRegionRssBackfill(regionName, normalizedIso).catch((error) => {
      console.warn(`Region RSS backfill failed for ${normalizedIso}:`, error.message);
      return { articles: [], feedHealth: [] };
    })
  ]);
  const regionArticles = deduplicateArticles(
    [
      ...fetchedArticles.filter((article) => article.isoA2 === normalizedIso),
      ...(rssBackfill.articles || [])
    ]
  );

  return {
    iso: normalizedIso,
    region: regionName,
    fetchedAt: new Date().toISOString(),
    fromSnapshot: false,
    articles: regionArticles,
    events: canonicalizeArticles(regionArticles),
    sourcePlan,
    feedChecks: rssBackfill.feedHealth || [],
    sourceHealth: {
      rss: rssBackfill.feedHealth || []
    }
  };
}

export async function refreshSnapshot({ force = false, reason = 'manual' } = {}) {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const startedAt = Date.now();
    const attemptedAt = new Date().toISOString();

    ingestHealth = {
      ...ingestHealth,
      lastAttemptAt: attemptedAt
    };

    if (force) {
      clearGdeltCache();
    }

    try {
      const [gdeltArticles, rssResult] = await Promise.all([
        fetchLiveNews({ timespan: DEFAULT_TIMESPAN, maxRecords: DEFAULT_MAX_RECORDS }).catch((error) => {
          console.warn('GDELT ingest failed:', error.message);
          return [];
        }),
        fetchRssNewsDirect().catch((error) => {
          console.warn('RSS ingest failed:', error.message);
          return { articles: [], health: createEmptyRssHealth() };
        })
      ]);

      const mergedArticles = deduplicateArticles([...gdeltArticles, ...rssResult.articles]);
      if (mergedArticles.length === 0) {
        throw new Error('No articles available from GDELT or RSS sources');
      }

      const events = canonicalizeArticles(mergedArticles);
      const nextSourceHealth = {
        gdelt: getGdeltFetchHealth(),
        rss: rssResult.health
      };
      const coverageMetrics = calculateCoverageMetrics(events);
      const diagnostics = buildCoverageDiagnostics(coverageMetrics, nextSourceHealth);
      const fetchedAt = new Date().toISOString();
      coverageHistory = mergeCoverageHistory(
        coverageHistory,
        buildCoverageSnapshot(diagnostics, fetchedAt),
        48
      );
      coverageTrends = summarizeCoverageTrends(coverageHistory);
      currentSnapshot = {
        fetchedAt,
        articles: mergedArticles,
        events,
        sourceHealth: nextSourceHealth,
        ingestHealth: {
          lastAttemptAt: attemptedAt,
          lastSuccessAt: fetchedAt,
          consecutiveFailures: 0,
          lastError: null
        }
      };

      loadedFromDisk = false;
      persistIngestHealth(currentSnapshot);
      await writeSnapshot(currentSnapshot);
      await writeCoverageHistory(coverageHistory);
      await appendHistory(buildHistoryEntry({
        status: 'ok',
        reason,
        startedAt,
        articles: mergedArticles,
        events
      }));

      return createResponsePayload();
    } catch (error) {
      ingestHealth = {
        lastAttemptAt: attemptedAt,
        lastSuccessAt: ingestHealth.lastSuccessAt,
        consecutiveFailures: (ingestHealth.consecutiveFailures || 0) + 1,
        lastError: error.message
      };

      if (currentSnapshot) {
        currentSnapshot = {
          ...currentSnapshot,
          ingestHealth
        };
        await writeSnapshot(currentSnapshot).catch(() => {});
      }

      await appendHistory(buildHistoryEntry({
        status: 'failed',
        reason,
        startedAt,
        error: error.message
      })).catch(() => {});

      if (currentSnapshot) {
        return createResponsePayload();
      }

      throw error;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
