import { create } from 'zustand';
import {
  fetchBackendCoverageRegion,
  fetchBackendHealth,
  fetchBackendRegionBriefing,
  fetchSnapshotHistory,
  fetchSnapshotTimestamps,
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
import type { NewsState, RegionBackfillEntry } from '../types/store';
import type { Article, Event, VelocitySpike, CoverageDiagnostics } from '../types/api';

/* ── constants ── */
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const REGION_BACKFILL_CACHE_LIMIT = 6;

/* ── module-level refs (not in state to avoid re-renders) ── */
let _refreshTimer: ReturnType<typeof setInterval> | null = null;
let _prevArticleCount = 0;
let _isFirstLoad = true;
let _sessionDiffInit = false;
let _prevLiveNewsRef: Article[] | null = null;

/* ── helpers ── */
function upsertRegionBackfill(
  cache: Record<string, RegionBackfillEntry>,
  entry: RegionBackfillEntry
): Record<string, RegionBackfillEntry> {
  const nextCache: Record<string, RegionBackfillEntry> = {
    ...cache,
    [entry.iso]: {
      ...(cache[entry.iso] || {}),
      ...entry,
      touchedAt: Date.now(),
    } as RegionBackfillEntry,
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
const useNewsStore = create<NewsState>()((set, get) => ({
  /* ── raw data ── */
  liveNews: null,
  backendEvents: [],
  dataSource: 'loading',
  dataError: null,
  lastDataLoadTime: null,
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

  /* ── historical queries ── */
  historicalState: null,
  comparisonMode: null,
  comparisonPeriods: null,
  isTimeTravel: false,
  availableTimestamps: [],

  /* ────────── actions ────────── */

  /**
   * Core data fetch — 3-tier fallback: backend → GDELT → mock.
   * Optionally triggers server-side refresh via POST.
   */
  loadLiveData: async ({ forceRefresh = false, addToast } = {}) => {
    const result = await runLoadLiveDataPipeline({ forceRefresh }) as {
      kind: string;
      briefing?: Record<string, unknown>;
      historyPayload?: Record<string, unknown> | null;
      articles?: Article[];
      gdeltHealth?: unknown;
      errorMessage?: string | null;
    };

    if (result.kind === 'backend' || result.kind === 'backend_warming') {
      const { briefing, historyPayload } = result;
      const rawBriefing = briefing as Record<string, unknown> || {};
      const articles = (rawBriefing.articles as Article[]) || [];
      const count = articles.length;
      const prevCount = _prevArticleCount;
      const isWarming = result.kind === 'backend_warming';

      set({
        liveNews: articles,
        backendEvents: Array.isArray(rawBriefing.events) ? rawBriefing.events as Event[] : [],
        sourceHealth: (rawBriefing.sourceHealth || { gdelt: null, rss: null, backend: null }) as NewsState['sourceHealth'],
        coverageTrends: (historyPayload as Record<string, unknown>)?.trends || rawBriefing.coverageTrends || null,
        coverageHistory: historyPayload || null,
        velocitySpikes: Array.isArray(rawBriefing.velocitySpikes) ? rawBriefing.velocitySpikes as VelocitySpike[] : [],
        lastDataLoadTime: Date.now(),
        // Safety net: if backend_warming returned 0 articles (shouldn't happen
        // after pipeline fix, but guard against it), mark as mock so the UI
        // doesn't show "NO ITEMS" under a 'live' label.
        dataSource: isWarming && count === 0 ? 'mock' : 'live',
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
      const articles = (result.articles as Article[]) || [];
      const gdeltHealth = result.gdeltHealth;
      const count = articles.length;

      set({
        liveNews: articles,
        sourceHealth: { gdelt: gdeltHealth, rss: null, backend: null },
        coverageTrends: null,
        coverageHistory: null,
        opsHealth: null,
        dataSource: 'live',
        dataError: null,
        lastDataLoadTime: Date.now(),
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
    if (_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = null;
  },

  /* ── session memory (internal) ── */
  _initSessionMemory: async (articles: Article[]) => {
    if (_sessionDiffInit || !articles || articles.length === 0) return;
    _sessionDiffInit = true;

    try {
      const lastSnap = await loadLastSnapshot();
      const previousEvents = lastSnap?.events || [];
      const diff = diffEventSnapshots(previousEvents as unknown as { id: string; lifecycle: string; severity?: number }[], articles as unknown as { id: string; lifecycle: string; severity?: number }[]);
      set({ sessionDiff: diff });
      await saveSnapshot(articles);
      await pruneOldSnapshots();
    } catch (err: unknown) {
      console.warn('Session memory init failed:', (err as Error).message);
    }
  },

  /** Load snapshot history for timeline display. */
  loadSnapshotHistory: async () => {
    try {
      const history = await loadSnapshotHistory();
      set({ snapshotHistory: history });
    } catch (err: unknown) {
      console.warn('Failed to load snapshot history:', (err as Error).message);
    }
  },

  /** Save a snapshot after data refreshes (called from effects). */
  saveCurrentSnapshot: async () => {
    const { liveNews } = get();
    if (!liveNews || liveNews.length === 0) return;
    try {
      await saveSnapshot(liveNews);
      await pruneOldSnapshots();
    } catch (err: unknown) {
      console.warn('Snapshot save failed:', (err as Error).message);
    }
  },

  /* ── historical queries ── */

  /** Load available snapshot timestamps for scrubber and date picker. */
  loadAvailableTimestamps: async () => {
    try {
      const result = await fetchSnapshotTimestamps();
      set({ availableTimestamps: result.timestamps || [] });
    } catch (err: unknown) {
      console.warn('Failed to load snapshot timestamps:', (err as Error).message);
    }
  },

  /** Load historical snapshot state for a date range. */
  loadHistoricalState: async (from: string, to: string) => {
    if (!from || !to) {
      set({ historicalState: null, isTimeTravel: false });
      return;
    }
    try {
      const result = await fetchSnapshotHistory({ from, to } as Record<string, unknown>);
      set({
        historicalState: { snapshots: result.snapshots || [], from, to },
        isTimeTravel: false,
      });
    } catch (err: unknown) {
      console.warn('Failed to load historical state:', (err as Error).message);
      set({ historicalState: null });
    }
  },

  /** Compare two time periods. */
  loadComparisonPeriods: async (period1, period2) => {
    if (!period1?.from || !period1?.to || !period2?.from || !period2?.to) {
      set({ comparisonPeriods: null, comparisonMode: null });
      return;
    }
    try {
      const [result1, result2] = await Promise.all([
        fetchSnapshotHistory({ from: period1.from, to: period1.to } as Record<string, unknown>),
        fetchSnapshotHistory({ from: period2.from, to: period2.to } as Record<string, unknown>),
      ]);
      set({
        comparisonPeriods: {
          period1: { snapshots: result1.snapshots || [], from: period1.from, to: period1.to },
          period2: { snapshots: result2.snapshots || [], from: period2.from, to: period2.to },
        },
      });
    } catch (err: unknown) {
      console.warn('Failed to load comparison periods:', (err as Error).message);
      set({ comparisonPeriods: null });
    }
  },

  /** Set comparison mode: 'overlay' or 'side-by-side' */
  setComparisonMode: (mode) => set({ comparisonMode: mode }),

  /** Enter time travel mode with scrubber control. */
  setTimeTravel: (enabled: boolean) => set({ isTimeTravel: enabled }),

  /** Exit all historical modes and return to live data. */
  exitHistoricalMode: () => set({
    historicalState: null,
    comparisonMode: null,
    comparisonPeriods: null,
    isTimeTravel: false,
  }),

  /* ── region coverage ── */
  fetchRegionCoverage: async (iso: string) => {
    if (!iso) { set({ regionCoverageHistory: null }); return; }
    set({ regionCoverageHistory: null });
    try {
      const payload = await fetchBackendCoverageRegion({ iso } as Record<string, unknown>);
      set({ regionCoverageHistory: payload });
    } catch {
      set({ regionCoverageHistory: null });
    }
  },

  /* ── region backfill ── */
  setRegionBackfill: (entry: RegionBackfillEntry) => {
    set((s) => ({ regionBackfills: upsertRegionBackfill(s.regionBackfills, entry) }));
  },

  clearRegionBackfills: () => set({ regionBackfills: {} }),

  /**
   * Fetch region-specific backfill data (backend → GDELT client fallback).
   */
  fetchRegionBackfill: async (iso: string, regionName: string, { sortMode, coverageDiagnostics } = {}) => {
    const state = get();
    const entry = state.regionBackfills[iso];
    if (entry && (entry.status === 'loading' || entry.status === 'done' || entry.status === 'empty')) return;

    const sourcePlan = buildRegionSourcePlan(regionName, { coverageDiagnostics: coverageDiagnostics ?? undefined } as Record<string, unknown>);

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
      const rawEvents = payload?.events || canonicalizeArticles((payload?.articles || []).filter((a: Article) => a.isoA2 === iso));
      const events = sortStories(
        rawEvents.filter((s: { isoA2?: string }) => s.isoA2 === iso),
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
    } catch (err: unknown) {
      console.warn('Region backfill backend failed, trying client-side:', (err as Error).message);
    }

    // 2. Fallback: client-side GDELT
    try {
      const clientArticles = await fetchLiveNews({ query: `"${regionName}"`, timespan: '24h', maxRecords: 50 });
      const events = sortStories(
        (clientArticles || []).filter((s: { isoA2?: string }) => s.isoA2 === iso),
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
    } catch (err: unknown) {
      console.warn('Region backfill client-side also failed:', (err as Error).message);
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
