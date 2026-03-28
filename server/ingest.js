/**
 * Ingestion Pipeline Orchestrator
 *
 * Coordinates the data ingestion pipeline through discrete stages:
 *   1. Source Fetching     (GDELT + RSS + HTML)
 *   2. Article Normalization & Deduplication
 *   3. Entity Enrichment  (NER)
 *   4. Event Canonicalization
 *   5. Article Persistence
 *   6. Velocity Tracking
 *   7. Event Correlation & Enrichment
 *   8. Event Persistence & Pruning
 *   9. Snapshot Finalization
 *
 * Each stage is implemented in a separate module under server/pipeline/.
 */

import {
  buildRegionFocusQueries,
  clearCache as clearGdeltCache,
  fetchLiveNews
} from '../src/services/gdeltService.js';
import { deduplicateArticles } from '../src/utils/articleUtils.js';
import { buildCoverageDiagnostics } from '../src/utils/coverageDiagnostics.js';
import { buildRegionSourcePlan } from '../src/utils/sourceCoverage.js';
import {
  buildCoverageSnapshot,
  mergeCoverageHistory,
  summarizeCoverageHistory,
  buildCoverageTransitions,
  buildRegionTimeSeries,
  getRegionCoverageHistory as getRegionCoverageHistoryFromSnapshots,
  summarizeCoverageTrends
} from '../src/utils/coverageHistory.js';
import { countryToIso, isoToCountry } from '../src/utils/geocoder.js';
import { deriveBriefingCoverage } from '../src/utils/healthSummary.js';
import { calculateCoverageMetrics, canonicalizeArticles } from '../src/utils/newsPipeline.js';
import { buildOpsAlerts, buildRegionLagDiagnostics } from '../src/utils/opsDiagnostics.js';
import {
  getDefaultSourceCatalog,
  readSourceCatalog,
  readSourceState,
  summarizeSourceCatalog
} from './sourceCatalog.js';
import {
  DATABASE_PATH,
  readCoverageHistory,
  readEventArticles,
  readHistory,
  readSnapshot,
  writeCoverageHistory,
  writeSnapshot
} from './storage.js';

// ── Pipeline stage imports ───────────────────────────────────────────────────
import {
  fetchAllSources,
  createEmptyRssHealth,
  buildRssHealthFromCatalog,
  getRegionBackfillFeedPlan,
  fetchRegionRssBackfill,
  mergeRssArticles
} from './pipeline/fetchSources.js';
import { mergeAndDeduplicateArticles } from './pipeline/normalizeArticles.js';
import { enrichArticlesWithEntities } from './pipeline/enrichEntities.js';
import { trackAndComputeVelocity } from './pipeline/trackVelocity.js';
import { correlateAndEnrichEvents, persistEnrichedEvents } from './pipeline/correlateEvents.js';
import {
  persistArticles,
  pruneOldData,
  persistSnapshot,
  persistCoverageHistory,
  persistHistoryEntry,
  buildHistoryEntry
} from './pipeline/persistData.js';

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_TIMESPAN = '24h';
const DEFAULT_MAX_RECORDS = 750;
const REGION_BACKFILL_TIMESPAN = '168h';
const REGION_BACKFILL_MAX_RECORDS = 80;
const REGION_BACKFILL_FEED_LIMIT = 12;
const REFRESH_INTERVAL_MS = Number(process.env.MAPR_REFRESH_MS || 10 * 60 * 1000);
const STALE_AFTER_MS = Number(process.env.MAPR_STALE_AFTER_MS || 30 * 60 * 1000);

// ── Module state ─────────────────────────────────────────────────────────────
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

// ── State accessors ──────────────────────────────────────────────────────────

function getSourceCatalog() {
  return sourceCatalog.length > 0 ? sourceCatalog : getDefaultSourceCatalog();
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

function persistIngestHealth(snapshot) {
  ingestHealth = {
    lastAttemptAt: snapshot?.ingestHealth?.lastAttemptAt || null,
    lastSuccessAt: snapshot?.ingestHealth?.lastSuccessAt || null,
    consecutiveFailures: snapshot?.ingestHealth?.consecutiveFailures || 0,
    lastError: snapshot?.ingestHealth?.lastError || null
  };
}

// ── Health & response builders ───────────────────────────────────────────────

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

  let enrichedEvents;
  try {
    enrichedEvents = await Promise.all(
      (currentSnapshot?.events || []).map(async (evt) => {
        const articles = await readEventArticles(evt.id);
        return { ...evt, supportingArticles: articles, articleCount: articles.length };
      })
    );
  } catch (err) {
    console.warn('[briefing] Failed to enrich events from DB:', err.message);
    enrichedEvents = (currentSnapshot?.events || []).map((evt) => ({
      ...evt,
      supportingArticles: [],
      articleCount: evt.articleIds?.length || 0
    }));
  }

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

// ── Initialization & scheduling ──────────────────────────────────────────────

export async function initializeIngestion() {
  const { mergeSourceState, writeSourceState } = await import('./sourceCatalog.js');

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

  // Force refresh if no snapshot OR if snapshot has no articles (empty/failed previous ingest)
  const hasRealData = currentSnapshot?.articles?.length > 0 || currentSnapshot?.fetchedAt;
  if (!hasRealData) {
    console.log('No valid snapshot found — forcing initial ingest...');
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

// ── Public API ───────────────────────────────────────────────────────────────

export async function getBriefing() {
  return createResponsePayload();
}

export async function getHealth() {
  let history = [];
  try {
    history = await readHistory();
  } catch (err) {
    console.warn('[health] Failed to read history from DB:', err.message);
  }
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

export function getCoverageHistory(limit = 8, transitionLimit = 16, { includeRegionSeries = false, topN = 20 } = {}) {
  const result = {
    snapshots: summarizeCoverageHistory(coverageHistory, limit),
    transitions: buildCoverageTransitions(coverageHistory, transitionLimit),
    trends: coverageTrends
  };
  if (includeRegionSeries) {
    result.regionSeries = buildRegionTimeSeries(coverageHistory, { topN });
  }
  return result;
}

export function getRegionCoverageHistory(iso, limit = 10, transitionLimit = 8) {
  return getRegionCoverageHistoryFromSnapshots(coverageHistory, iso, limit, transitionLimit);
}

export function getRegionBackfillFeedPlanForRegion(regionName) {
  return getRegionBackfillFeedPlan(regionName, getSourceCatalog());
}
// Keep backward-compatible export name
export { getRegionBackfillFeedPlanForRegion as getRegionBackfillFeedPlan };

export async function getRegionBriefing(iso) {
  const normalizedIso = (iso || '').trim().toUpperCase();
  if (!normalizedIso) {
    throw new Error('Missing iso for region briefing');
  }

  const regionName = isoToCountry(normalizedIso);
  if (!regionName) {
    throw new Error(`Unknown region iso: ${normalizedIso}`);
  }

  const catalog = getSourceCatalog();
  const coverageMetrics = calculateCoverageMetrics(currentSnapshot?.events || []);
  const coverageDiagnostics = buildCoverageDiagnostics(coverageMetrics, currentSnapshot?.sourceHealth || {});
  const sourcePlan = buildRegionSourcePlan(regionName, {
    limit: REGION_BACKFILL_FEED_LIMIT,
    coverageDiagnostics,
    feeds: catalog
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
    fetchRegionRssBackfill(regionName, normalizedIso, catalog).catch((error) => {
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

// ── Main pipeline orchestrator ───────────────────────────────────────────────

/**
 * refreshSnapshot — the main ingestion pipeline orchestrator.
 *
 * Executes the full data pipeline as a clear sequence of stages:
 *   1. Fetch sources          → GDELT + RSS/HTML articles
 *   2. Normalize & deduplicate → Merged, unique article set
 *   3. Enrich entities        → NER extraction (people, orgs, locations)
 *   4. Canonicalize events    → Group articles into events
 *   5. Persist articles       → Write to database
 *   6. Track velocity         → Detect regional activity spikes
 *   7. Correlate events       → Merge into existing events, lifecycle, severity
 *   8. Persist events & prune → Write events, clean up old data
 *   9. Finalize snapshot      → Coverage metrics, snapshot, history
 */
export async function refreshSnapshot({ force = false, reason = 'manual' } = {}) {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const startedAt = Date.now();
    const attemptedAt = new Date().toISOString();

    ingestHealth = { ...ingestHealth, lastAttemptAt: attemptedAt };

    if (force) {
      clearGdeltCache();
    }

    try {
      // ── Stage 1: Fetch from all sources (GDELT + RSS + HTML) ──
      const { gdeltArticles, rssResult, updatedSourceState, gdeltHealth } = await fetchAllSources({
        force,
        timespan: DEFAULT_TIMESPAN,
        maxRecords: DEFAULT_MAX_RECORDS,
        catalog: getSourceCatalog(),
        sourceState
      });
      sourceState = updatedSourceState;

      // ── Stage 2: Normalize and deduplicate articles ──
      const mergedArticles = mergeAndDeduplicateArticles({
        gdeltArticles,
        rssResult,
        previousArticles: currentSnapshot?.articles || [],
        catalog: getSourceCatalog()
      });

      if (mergedArticles.length === 0) {
        throw new Error('No articles available from GDELT or RSS sources');
      }

      // ── Stage 3: Enrich articles with named entities ──
      await enrichArticlesWithEntities(mergedArticles);

      // ── Stage 4: Canonicalize articles into events ──
      const events = canonicalizeArticles(mergedArticles);

      // ── Stage 5: Persist articles to database ──
      await persistArticles(mergedArticles);

      // ── Stage 6: Track velocity and detect spikes ──
      const velocitySpikes = await trackAndComputeVelocity(mergedArticles);

      // ── Stage 7: Correlate and enrich events ──
      const enrichedEvents = await correlateAndEnrichEvents({
        articles: mergedArticles,
        velocitySpikes
      });

      // ── Stage 8: Persist events and prune old data ──
      await persistEnrichedEvents(enrichedEvents);
      await pruneOldData();

      // ── Stage 9: Finalize snapshot ──
      const persistentEvents = enrichedEvents.filter(e => e.lifecycle !== 'resolved');
      const nextSourceHealth = {
        gdelt: gdeltHealth,
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

      await persistSnapshot(currentSnapshot);
      await persistCoverageHistory(coverageHistory);
      await persistHistoryEntry(buildHistoryEntry({
        status: 'ok',
        reason,
        startedAt,
        articles: mergedArticles,
        events
      }));

      return await createResponsePayload();
    } catch (error) {
      console.error('[ingest] refreshSnapshot FAILED:', error.message);
      console.error('[ingest] Stack:', error.stack?.split('\n').slice(0, 4).join('\n'));

      ingestHealth = {
        lastAttemptAt: attemptedAt,
        lastSuccessAt: ingestHealth.lastSuccessAt,
        consecutiveFailures: (ingestHealth.consecutiveFailures || 0) + 1,
        lastError: error.message
      };

      if (currentSnapshot) {
        currentSnapshot = { ...currentSnapshot, ingestHealth };
        await persistSnapshot(currentSnapshot).catch(() => {});
      }

      await persistHistoryEntry(buildHistoryEntry({
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
