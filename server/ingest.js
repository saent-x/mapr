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
import { deriveBriefingCoverage } from '../src/utils/healthSummary.js';
import { detectLanguage } from '../src/utils/languageUtils.js';
import { calculateCoverageMetrics, canonicalizeArticles } from '../src/utils/newsPipeline.js';
import { buildOpsAlerts, buildRegionLagDiagnostics } from '../src/utils/opsDiagnostics.js';
import { classifySourceType, getSourceNetworkKey } from '../src/utils/sourceMetadata.js';
import {
  getDefaultSourceCatalog,
  mergeSourceState,
  readSourceCatalog,
  readSourceState,
  selectSourcesForRun,
  summarizeSourceCatalog,
  writeSourceState
} from './sourceCatalog.js';
import {
  appendHistory,
  DATABASE_PATH,
  linkArticlesToEvent,
  pruneOrphanedArticles,
  pruneResolvedEvents,
  readActiveEvents,
  readCoverageHistory,
  readEventArticles,
  readHistory,
  readSnapshot,
  upsertArticles,
  upsertEvent,
  upsertVelocityBucket,
  readVelocityHistory,
  updateSourceCredibility,
  writeCoverageHistory,
  writeSnapshot
} from './storage.js';
import { fetchCatalogSource } from './sourceFetcher.js';
import { mergeArticlesIntoEvents, aggregateEntities, computeSourceProfile } from './eventStore.js';
import { computeLifecycleTransition } from '../src/utils/eventModel.js';
import { extractEntities } from './entityExtractor.js';
import { computeCompositeSeverity } from '../src/utils/severityModel.js';
import { detectAmplification } from '../src/utils/amplificationDetector.js';
import { computeVelocitySpikes } from './velocityTracker.js';
const DEFAULT_TIMESPAN = '24h';
const DEFAULT_MAX_RECORDS = 750;
const REGION_BACKFILL_TIMESPAN = '168h';
const REGION_BACKFILL_MAX_RECORDS = 80;
const REGION_BACKFILL_FEED_LIMIT = 12;
const REGION_BACKFILL_TARGET_ARTICLES = 18;
const RSS_BATCH_SIZE = 6;
const RSS_BATCH_DELAY_MS = 400;
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
let sourceCatalog = [];
let sourceState = {};

function createEmptyRssHealth() {
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

function getSourceCatalog() {
  return sourceCatalog.length > 0 ? sourceCatalog : getDefaultSourceCatalog();
}

function getArticleFeedId(article, feeds = getSourceCatalog()) {
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

function buildRssHealthFromCatalog(catalog, state, checkedFeedResults = [], {
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

function mergeRssArticles(previousArticles, refreshedFeedIds, nextRssArticles, feeds = getSourceCatalog()) {
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

function retainPreviousGdeltArticles(previousArticles) {
  return (previousArticles || []).filter((article) => String(article?.id || '').startsWith('gdelt-'));
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
    storageBackend: 'sqlite',
    sourceCatalog: summarizeSourceCatalog(getSourceCatalog(), sourceState)
  };
}

async function createResponsePayload() {
  const backend = buildBackendHealth();
  const sourceHealth = {
    gdelt: currentSnapshot?.sourceHealth?.gdelt || null,
    rss: currentSnapshot?.sourceHealth?.rss || null,
    backend
  };
  const { coverageMetrics, coverageDiagnostics } = deriveBriefingCoverage({
    events: currentSnapshot?.events || [],
    sourceHealth
  });

  const enrichedEvents = await Promise.all(
    (currentSnapshot?.events || []).map(async (evt) => {
      const articles = await readEventArticles(evt.id);
      return { ...evt, supportingArticles: articles, articleCount: articles.length };
    })
  );

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
    events: enrichedEvents,
    velocitySpikes: currentSnapshot?.velocitySpikes || [],
    coverageMetrics,
    coverageDiagnostics,
    coverageTrends,
    sourceHealth,
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

async function fetchRssFeed(feed) {
  return fetchCatalogSource(feed, { idPrefix: 'server' });
}

async function fetchRssNewsDirect({ force = false } = {}) {
  const catalog = getSourceCatalog();
  const selectedFeeds = selectSourcesForRun(catalog, sourceState, { force });
  const checkedAt = new Date().toISOString();

  if (selectedFeeds.length === 0) {
    return {
      articles: [],
      checkedFeedIds: [],
      health: buildRssHealthFromCatalog(catalog, sourceState, [], {
        checkedAt,
        fromCache: true,
        dueFeeds: 0
      })
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
  sourceState = mergeSourceState(catalog, sourceState, feeds, checkedAt);
  await writeSourceState(sourceState);

  return {
    articles,
    checkedFeedIds: selectedFeeds.map((feed) => feed.id),
    health: buildRssHealthFromCatalog(catalog, sourceState, feeds, {
      checkedAt,
      fromCache: false,
      dueFeeds: selectedFeeds.length
    })
  };
}

export function getRegionBackfillFeedPlan(regionName) {
  const catalog = getSourceCatalog();
  return buildRegionSourcePlan(regionName, {
    limit: REGION_BACKFILL_FEED_LIMIT,
    feeds: catalog
  }).plannedFeeds
    .map((plannedFeed) => catalog.find((feed) => feed.id === plannedFeed.id))
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

function persistIngestHealth(snapshot) {
  ingestHealth = {
    lastAttemptAt: snapshot?.ingestHealth?.lastAttemptAt || null,
    lastSuccessAt: snapshot?.ingestHealth?.lastSuccessAt || null,
    consecutiveFailures: snapshot?.ingestHealth?.consecutiveFailures || 0,
    lastError: snapshot?.ingestHealth?.lastError || null
  };
}

export async function initializeIngestion() {
  sourceCatalog = await readSourceCatalog();
  sourceState = await readSourceState();
  currentSnapshot = await readSnapshot();

  if (
    currentSnapshot?.sourceHealth?.rss?.feeds?.length > 0 &&
    (!sourceState || Object.keys(sourceState).length === 0)
  ) {
    sourceState = mergeSourceState(
      getSourceCatalog(),
      {},
      currentSnapshot.sourceHealth.rss.feeds,
      currentSnapshot.fetchedAt || new Date().toISOString()
    );
    await writeSourceState(sourceState).catch(() => {});
  }

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

export async function getBriefing() {
  return createResponsePayload();
}

export async function getHealth() {
  const history = await readHistory();
  const backend = buildBackendHealth();
  const sourceHealth = currentSnapshot?.sourceHealth || {
    gdelt: null,
    rss: createEmptyRssHealth()
  };
  const { coverageMetrics, coverageDiagnostics } = deriveBriefingCoverage({
    events: currentSnapshot?.events || [],
    sourceHealth
  });
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
    coverageMetrics,
    coverageDiagnostics,
    sourceHealth,
    sourceCatalog: summarizeSourceCatalog(getSourceCatalog(), sourceState),
    alerts: opsAlerts.alerts,
    alertSummary: opsAlerts.summary,
    regionLag
  };
}

export function getSourceCatalogStatus() {
  const catalog = getSourceCatalog();
  const summary = summarizeSourceCatalog(catalog, sourceState);

  return {
    summary,
    feeds: catalog.map((feed) => {
      const state = sourceState?.[feed.id] || {};

      return {
        ...feed,
        lastCheckedAt: state.lastCheckedAt || null,
        lastSuccessAt: state.lastSuccessAt || null,
        lastStatus: state.lastStatus || 'never-checked',
        lastError: state.lastError || null,
        lastArticleCount: state.lastArticleCount || 0,
        nextCheckAt: state.nextCheckAt || null
      };
    })
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
    coverageDiagnostics,
    feeds: getSourceCatalog()
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
        fetchRssNewsDirect({ force }).catch((error) => {
          console.warn('RSS ingest failed:', error.message);
          return { articles: [], checkedFeedIds: [], health: createEmptyRssHealth() };
        })
      ]);

      const effectiveGdeltArticles = gdeltArticles.length > 0
        ? gdeltArticles
        : retainPreviousGdeltArticles(currentSnapshot?.articles || []);
      const mergedRssArticles = mergeRssArticles(
        currentSnapshot?.articles || [],
        rssResult.checkedFeedIds || [],
        rssResult.articles,
        getSourceCatalog()
      );
      const mergedArticles = deduplicateArticles([...effectiveGdeltArticles, ...mergedRssArticles]);
      if (mergedArticles.length === 0) {
        throw new Error('No articles available from GDELT or RSS sources');
      }

      // Run NER on articles before persisting
      for (const article of mergedArticles) {
        if (!article.entities) {
          try {
            const extracted = await extractEntities(article.title);
            article.entities = extracted;
            if (extracted.category !== 'general') {
              article.nerCategory = extracted.category;
            }
          } catch (nerErr) {
            // Don't let one bad article crash the entire ingest
            article.entities = { people: [], organizations: [], locations: [], category: 'general' };
          }
        }
      }

      const events = canonicalizeArticles(mergedArticles);

      // --- Persistent event store ---
      // 1. Persist individual articles
      await upsertArticles(mergedArticles);

      // --- Velocity tracking ---
      // Compute 2-hour bucket timestamp (e.g. "2026-03-22T14" rounded to even hours)
      const nowDate = new Date();
      const bucketHour = Math.floor(nowDate.getUTCHours() / 2) * 2;
      const bucketAt = `${nowDate.toISOString().slice(0, 10)}T${String(bucketHour).padStart(2, '0')}`;

      // Count articles per ISO code in this batch
      const isoCounts = {};
      for (const article of mergedArticles) {
        const iso = article.isoA2;
        if (iso) {
          isoCounts[iso] = (isoCounts[iso] || 0) + 1;
        }
      }

      // Persist velocity buckets and build history map
      const regionHistory = {};
      for (const [iso, count] of Object.entries(isoCounts)) {
        await upsertVelocityBucket(iso, bucketAt, count);
        const historyRows = await readVelocityHistory(iso, 7);
        const counts = historyRows
          .filter(row => row.bucketAt !== bucketAt)
          .map(row => row.articleCount);
        regionHistory[iso] = { counts, currentCount: count };
      }

      // Compute velocity spikes
      const velocitySpikes = computeVelocitySpikes(regionHistory);

      // 2. Load existing events from DB (only last 72h per spec)
      const existingEvents = await readActiveEvents({ maxAgeHours: 72 });

      // 3. Merge new articles into events
      const mergedEvents = mergeArticlesIntoEvents(mergedArticles, existingEvents);

      // 4. Update lifecycle for all events
      for (const event of mergedEvents) {
        // Link articles first so readEventArticles works
        try {
          await linkArticlesToEvent(event.id, event.articleIds);
        } catch (linkErr) {
          // FK violation — some articleIds were deduped. Non-fatal.
        }
        // Get ALL articles for this event (from DB, not just current batch)
        const allEventArticles = await readEventArticles(event.id);
        const now = Date.now();
        const twoHoursAgo = now - 2 * 60 * 60 * 1000;
        const fourHoursAgo = now - 4 * 60 * 60 * 1000;
        const currWindow = allEventArticles.filter(a => new Date(a.publishedAt).getTime() >= twoHoursAgo).length;
        const prevWindow = allEventArticles.filter(a => {
          const t = new Date(a.publishedAt).getTime();
          return t >= fourHoursAgo && t < twoHoursAgo;
        }).length;

        event.lifecycle = computeLifecycleTransition({
          lifecycle: event.lifecycle,
          firstSeenAt: event.firstSeenAt,
          articleCount: event.articleIds.length,
          lastUpdatedAt: event.lastUpdatedAt,
          prevWindowArticleCount: prevWindow,
          currWindowArticleCount: currWindow
        });

        // Entity aggregation and source profile
        const sourceProfile = computeSourceProfile(allEventArticles);
        event.sourceProfile = sourceProfile;
        event.entities = aggregateEntities(allEventArticles);

        // Update source credibility based on corroboration
        const isCorroborated = allEventArticles.length >= 2 && sourceProfile.diversityScore > 0.3;
        for (const article of allEventArticles) {
          const sourceKey = getSourceNetworkKey(article);
          await updateSourceCredibility(sourceKey, isCorroborated);
        }

        // Use composite severity instead of the old weighted max/avg blend
        const regionSpike = velocitySpikes.find(s => s.iso === event.primaryCountry);
        const severityCtx = {
          keywordSeverity: Math.max(...allEventArticles.map(a => a.severity || 0)),
          articleCount: allEventArticles.length,
          diversityScore: sourceProfile.diversityScore,
          entities: event.entities,
          category: event.nerCategory || event.category
        };
        if (regionSpike) {
          severityCtx.velocitySignal = Math.min(100, regionSpike.zScore * 30);
        }
        event.severity = computeCompositeSeverity(severityCtx);

        // Run amplification detection
        const amplification = detectAmplification(allEventArticles);
        event.amplification = amplification;

        // Compute confidence
        const confidence = Math.min(1, Math.max(0,
          (sourceProfile.diversityScore * 0.4) +
          (Math.min(1, Math.log2(Math.max(1, allEventArticles.length)) / 4) * 0.35) +
          (sourceProfile.wireCount > 0 ? 0.15 : 0) +
          (amplification.isAmplified ? -0.2 : 0.1)
        ));
        event.confidence = Math.round(confidence * 100) / 100;
      }

      // 5. Persist events
      for (const event of mergedEvents) {
        await upsertEvent({
          ...event,
          countries: event.countries,
          topicFingerprint: event.topicFingerprint,
          coordinates: event.coordinates,
          enrichment: JSON.stringify({
            entities: event.entities,
            sourceProfile: event.sourceProfile,
            confidence: event.confidence,
            amplification: event.amplification
          })
        });
      }

      // 6. Prune old data
      await pruneResolvedEvents(30);
      await pruneOrphanedArticles(7);

      // Use persistent events for the snapshot
      const persistentEvents = mergedEvents.filter(e => e.lifecycle !== 'resolved');

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
        events: persistentEvents,
        velocitySpikes,
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

      return await createResponsePayload();
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
        return await createResponsePayload();
      }

      throw error;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
