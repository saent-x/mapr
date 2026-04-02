import { create } from 'zustand';
import {
  fetchBackendCoverageRegion,
  fetchBackendHealth,
  fetchBackendRegionBriefing,
} from '../services/backendService.js';
import { fetchLiveNews } from '../services/gdeltService.js';
import { runLoadLiveDataPipeline } from '../services/loadLiveDataPipeline.js';
import {
  saveSnapshot,
  loadLastSnapshot,
  diffEventSnapshots,
  pruneOldSnapshots,
  loadSnapshotHistory,
} from '../services/eventCache.js';
import { canonicalizeArticles } from '../utils/newsPipeline.js';
import { buildRegionSourcePlan } from '../utils/sourceCoverage.js';
import { sortStories } from '../utils/storyFilters.js';
import { isoToCountry } from '../utils/geocoder.js';

/* ── constants ── */
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const REGION_BACKFILL_CACHE_LIMIT = 6;

/* ── module-level refs (not in state to avoid re-renders) ── */
let _refreshTimer = null;
let _prevArticleCount = 0;
let _isFirstLoad = true;
let _sessionDiffInit = false;
let _prevLiveNewsRef = null;

/* ── helpers ── */
function upsertRegionBackfill(cache, entry) {
  const nextCache = {
    ...cache,
    [entry.iso]: {
      ...(cache[entry.iso] || {}),
      ...entry,
      touchedAt: Date.now(),
    },
  };
  const ordered = Object.values(nextCache)
    .sort((a, b) => (b.touchedAt || 0) - (a.touchedAt || 0))
    .slice(0, REGION_BACKFILL_CACHE_LIMIT);
  return Object.fromEntries(ordered.map((item) => [item.iso, item]));
}

/**
 * News store — articles, events, source health, data fetching, region backfills,
 * session memory, snapshot history, lifecycle messages.
 */
const useNewsStore = create((set, get) => ({
  /* ── raw data ── */
  liveNews: null,
  backendEvents: [],
  dataSource: 'loading',
  dataError: null,
  sourceHealth: { gdelt: null, rss: null, backend: null },
  coverageTrends: null,
  coverageHistory: null,
  opsHealth: null,
  velocitySpikes: [],

  /* ── region ── */
  regionBackfills: {},
  regionCoverageHistory: null,

  /* ── session memory ── */
  sessionDiff: null,
  snapshotHistory: [],

  /* ────────── actions ────────── */

  /**
   * Core data fetch — 3-tier fallback: backend → GDELT → mock.
   * Optionally triggers server-side refresh via POST.
   */
  loadLiveData: async ({ forceRefresh = false, addToast } = {}) => {
    const result = await runLoadLiveDataPipeline({ forceRefresh });

    if (result.kind === 'backend' || result.kind === 'backend_warming') {
      const { briefing, historyPayload } = result;
      const articles = briefing.articles || [];
      const count = articles.length;
      const prevCount = _prevArticleCount;
      const isWarming = result.kind === 'backend_warming';

      set({
        liveNews: articles,
        backendEvents: Array.isArray(briefing.events) ? briefing.events : [],
        sourceHealth: briefing.sourceHealth || { gdelt: null, rss: null, backend: null },
        coverageTrends: historyPayload?.trends || briefing.coverageTrends || null,
        coverageHistory: historyPayload || null,
        velocitySpikes: Array.isArray(briefing.velocitySpikes) ? briefing.velocitySpikes : [],
        dataSource: 'live',
        dataError: isWarming ? 'Backend briefing not ready yet — ingest may still be running' : null,
      });

      if (_prevLiveNewsRef !== articles) {
        set({ regionBackfills: {} });
      }
      _prevLiveNewsRef = articles;

      fetchBackendHealth().then((h) => set({ opsHealth: h })).catch(() => set({ opsHealth: null }));

      if (!_isFirstLoad && addToast && count > 0) {
        const diff = count - prevCount;
        if (diff > 0) {
          addToast(`${diff} new stories detected · ${count} total`, 'new-data');
        } else {
          addToast(`Intel refreshed · ${count} stories`, 'refresh');
        }
      } else if (!_isFirstLoad && addToast && isWarming) {
        addToast('Waiting for backend briefing…', 'refresh');
      }

      _prevArticleCount = count;
      _isFirstLoad = false;

      if (articles.length > 0) {
        get()._initSessionMemory(articles);
      }
      return;
    }

    if (result.kind === 'client_gdelt') {
      const { articles, gdeltHealth } = result;
      const count = articles.length;

      set({
        liveNews: articles,
        sourceHealth: { gdelt: gdeltHealth, rss: null, backend: null },
        coverageTrends: null,
        coverageHistory: null,
        opsHealth: null,
        dataSource: 'live',
        dataError: null,
      });

      if (_prevLiveNewsRef !== articles) {
        set({ regionBackfills: {} });
      }
      _prevLiveNewsRef = articles;

      if (!_isFirstLoad && addToast) {
        addToast(`Client-side refresh · ${count} stories`, 'refresh');
      }

      _prevArticleCount = count;
      _isFirstLoad = false;
      get()._initSessionMemory(articles);
      return;
    }

    set({ liveNews: null, dataSource: 'mock', dataError: result.errorMessage });
  },

  /** Force a full refresh cycle. */
  refresh: (addToast) => {
    set({
      dataSource: 'loading',
      sourceHealth: { gdelt: null, rss: null, backend: null },
      coverageTrends: null,
      coverageHistory: null,
      opsHealth: null,
      regionCoverageHistory: null,
      regionBackfills: {},
    });
    get().loadLiveData({ forceRefresh: true, addToast });
  },

  /** Start the auto-refresh interval. Call once from a React effect. */
  startAutoRefresh: (addToast) => {
    get().loadLiveData({ addToast });
    _refreshTimer = setInterval(() => get().loadLiveData({ addToast }), REFRESH_INTERVAL);
  },

  /** Stop the auto-refresh interval. */
  stopAutoRefresh: () => {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  },

  /* ── session memory (internal) ── */
  _initSessionMemory: async (articles) => {
    if (_sessionDiffInit || !articles || articles.length === 0) return;
    _sessionDiffInit = true;

    try {
      const lastSnap = await loadLastSnapshot();
      const previousEvents = lastSnap?.events || [];
      const diff = diffEventSnapshots(previousEvents, articles);
      set({ sessionDiff: diff });
      await saveSnapshot(articles);
      await pruneOldSnapshots();
    } catch (err) {
      console.warn('Session memory init failed:', err.message);
    }
  },

  /** Load snapshot history for timeline display. */
  loadSnapshotHistory: async () => {
    try {
      const history = await loadSnapshotHistory();
      set({ snapshotHistory: history });
    } catch (err) {
      console.warn('Failed to load snapshot history:', err.message);
    }
  },

  /** Save a snapshot after data refreshes (called from effects). */
  saveCurrentSnapshot: async () => {
    const { liveNews } = get();
    if (!liveNews || liveNews.length === 0) return;
    try {
      await saveSnapshot(liveNews);
      await pruneOldSnapshots();
    } catch (err) {
      console.warn('Snapshot save failed:', err.message);
    }
  },

  /* ── region coverage ── */
  fetchRegionCoverage: async (iso) => {
    if (!iso) { set({ regionCoverageHistory: null }); return; }
    set({ regionCoverageHistory: null });
    try {
      const payload = await fetchBackendCoverageRegion({ iso });
      set({ regionCoverageHistory: payload });
    } catch {
      set({ regionCoverageHistory: null });
    }
  },

  /* ── region backfill ── */
  setRegionBackfill: (entry) => {
    set((s) => ({ regionBackfills: upsertRegionBackfill(s.regionBackfills, entry) }));
  },

  clearRegionBackfills: () => set({ regionBackfills: {} }),

  /**
   * Fetch region-specific backfill data (backend → GDELT client fallback).
   */
  fetchRegionBackfill: async (iso, regionName, { sortMode, coverageDiagnostics } = {}) => {
    const state = get();
    const entry = state.regionBackfills[iso];
    if (entry && (entry.status === 'loading' || entry.status === 'done' || entry.status === 'empty')) return;

    const sourcePlan = buildRegionSourcePlan(regionName, { coverageDiagnostics });

    set((s) => ({
      regionBackfills: upsertRegionBackfill(s.regionBackfills, {
        iso,
        region: regionName,
        status: 'loading',
        events: [],
        sourcePlan,
        feedChecks: [],
      }),
    }));

    // 1. Try backend
    try {
      const payload = await fetchBackendRegionBriefing({ iso });
      const events = sortStories(
        (payload?.events || canonicalizeArticles((payload?.articles || []).filter((a) => a.isoA2 === iso)))
          .filter((s) => s.isoA2 === iso),
        sortMode || 'severity',
      );
      set((s) => ({
        regionBackfills: upsertRegionBackfill(s.regionBackfills, {
          iso,
          region: payload?.region || regionName,
          status: events.length > 0 ? 'done' : 'empty',
          fetchedAt: payload?.fetchedAt || new Date().toISOString(),
          sourcePlan: payload?.sourcePlan || sourcePlan,
          feedChecks: payload?.feedChecks || [],
          events,
        }),
      }));
      return;
    } catch (err) {
      console.warn('Region backfill backend failed, trying client-side:', err.message);
    }

    // 2. Fallback: client-side GDELT
    try {
      const clientArticles = await fetchLiveNews({ query: `"${regionName}"`, timespan: '24h', maxRecords: 50 });
      const events = sortStories(
        (clientArticles || []).filter((s) => s.isoA2 === iso),
        sortMode || 'severity',
      );
      set((s) => ({
        regionBackfills: upsertRegionBackfill(s.regionBackfills, {
          iso,
          region: regionName,
          status: events.length > 0 ? 'done' : 'empty',
          fetchedAt: new Date().toISOString(),
          sourcePlan,
          feedChecks: [],
          events,
        }),
      }));
      return;
    } catch (err) {
      console.warn('Region backfill client-side also failed:', err.message);
    }

    // 3. Both failed
    set((s) => ({
      regionBackfills: upsertRegionBackfill(s.regionBackfills, {
        iso,
        region: regionName,
        status: 'error',
        fetchedAt: new Date().toISOString(),
        sourcePlan,
        feedChecks: [],
        events: [],
      }),
    }));
  },
}));

export default useNewsStore;
