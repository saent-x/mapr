import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, Radio } from 'lucide-react';
import { Analytics } from '@vercel/analytics/react';
import ErrorBoundary from './components/ErrorBoundary';
import Header from './components/Header';
import FilterDrawer from './components/FilterDrawer';
import NewsPanel from './components/NewsPanel';
import ArcPanel from './components/ArcPanel';
import BriefingExport from './components/BriefingExport';
import EventTimeline from './components/EventTimeline';
import useEventData from './hooks/useEventData';
import {
  fetchBackendCoverageRegion,
  fetchBackendRegionBriefing,
} from './services/backendService';
import { fetchLiveNews } from './services/gdeltService';
import {
  saveSnapshot,
  loadLastSnapshot,
  diffEventSnapshots,
  pruneOldSnapshots,
  loadSnapshotHistory,
} from './services/eventCache';
import { canonicalizeArticles, calculateCoverageMetrics } from './utils/newsPipeline';
import { COVERAGE_STATUS_ORDER, getCoverageMeta } from './utils/coverageMeta';
import { buildCoverageDiagnostics } from './utils/coverageDiagnostics';
import { mergeStoryLists } from './utils/aiState';
import { buildRegionSourcePlan, buildSourceCoverageAudit } from './utils/sourceCoverage';
import { sortStories, storyMatchesFilters } from './utils/storyFilters';
import { isoToCountry } from './utils/geocoder';
import { generateLifecycleMessages } from './utils/lifecycleMessages';
import { loadViews, saveViews, createView } from './utils/viewManager';
import { decodeURLToFilters, encodeViewToURL } from './utils/viewManager';
import {
  MOCK_NEWS,
  calculateRegionSeverity,
  getSeverityMeta,
  resolveDateFloor
} from './utils/mockData';

const Globe = lazy(() => import('./components/Globe'));
const FlatMap = lazy(() => import('./components/FlatMap'));

const REGION_BACKFILL_CACHE_LIMIT = 6;

function upsertRegionBackfill(cache, entry) {
  const nextCache = {
    ...cache,
    [entry.iso]: {
      ...(cache[entry.iso] || {}),
      ...entry,
      touchedAt: Date.now()
    }
  };

  const orderedEntries = Object.values(nextCache)
    .sort((left, right) => (right.touchedAt || 0) - (left.touchedAt || 0))
    .slice(0, REGION_BACKFILL_CACHE_LIMIT);

  return Object.fromEntries(orderedEntries.map((item) => [item.iso, item]));
}

function App() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  // RTL + lang attribute
  useEffect(() => {
    document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input (250ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const [dateWindow, setDateWindow] = useState('168h');
  const [minSeverity, setMinSeverity] = useState(0);
  const [minConfidence, setMinConfidence] = useState(0);
  const [sortMode, setSortMode] = useState('severity');
  const [mapMode, setMapMode] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'flat' : 'globe'
  );
  const [mapOverlay, setMapOverlay] = useState('severity');
  const [verificationFilter, setVerificationFilter] = useState('all');
  const [sourceTypeFilter, setSourceTypeFilter] = useState('all');
  const [languageFilter, setLanguageFilter] = useState('all');
  const [accuracyMode, setAccuracyMode] = useState('standard');
  const [precisionFilter, setPrecisionFilter] = useState('all');
  const [hideAmplified, setHideAmplified] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [selectedStoryId, setSelectedStoryId] = useState(null);
  const [selectedArc, setSelectedArc] = useState(null);
  const [drawerMode, setDrawerMode] = useState(null); // null | 'filters' | 'intel'
  const filtersOpen = drawerMode !== null;

  // ── Session memory (event cache) ──
  const [sessionDiff, setSessionDiff] = useState(null);
  const sessionDiffInitRef = useRef(false);

  // ── Saved views ──
  const [savedViews, setSavedViews] = useState(() => loadViews());
  const [activeViewId, setActiveViewId] = useState(null);

  // ── Timeline ──
  const [scrubTime, setScrubTime] = useState(null); // null = live, Date = historical
  const [snapshotHistory, setSnapshotHistory] = useState([]);

  // ── Export modal ──
  const [showExport, setShowExport] = useState(false);

  // Toast notifications (UI concern — stays in App)
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now();
    setToasts((prev) => [...prev.slice(-3), { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  // Data fetching hook with toast bridging
  const onNewData = useCallback((signal) => {
    switch (signal.type) {
      case 'new-data':
        addToast(`${signal.diff} new stories detected · ${signal.count} total`, 'new-data');
        break;
      case 'refresh':
        addToast(`Intel refreshed · ${signal.count} stories`, 'refresh');
        break;
      case 'client-refresh':
        addToast(`Client-side refresh · ${signal.count} stories`, 'refresh');
        break;
      default:
        break;
    }
  }, [addToast]);

  const {
    liveNews,
    dataSource,
    dataError,
    sourceHealth,
    coverageTrends,
    coverageHistory,
    opsHealth,
    velocitySpikes: hookVelocitySpikes,
    refresh: refreshEventData
  } = useEventData({ onNewData });

  // Velocity spike toast notifications (uses backend spikes when available)
  const prevVelocitySpikesRef = useRef([]);
  useEffect(() => {
    if (!hookVelocitySpikes || hookVelocitySpikes.length === 0) return;
    const prevIsos = new Set(prevVelocitySpikesRef.current.map((s) => s.iso));
    const topSpike = hookVelocitySpikes.find((s) => s.level === 'spike') || hookVelocitySpikes[0];
    if (topSpike && !prevIsos.has(topSpike.iso)) {
      const countryName = isoToCountry(topSpike.iso) || topSpike.iso;
      const zLabel = topSpike.zScore === Infinity ? '∞' : topSpike.zScore.toFixed(1);
      addToast(`Velocity spike · ${countryName} · z=${zLabel}`, 'velocity-spike');
    }
    prevVelocitySpikesRef.current = hookVelocitySpikes;
  }, [hookVelocitySpikes, addToast]);

  // Region-specific state (stays in App — it's tied to panel selection)
  const [regionCoverageHistory, setRegionCoverageHistory] = useState(null);
  const [regionBackfills, setRegionBackfills] = useState({});

  // Clear region backfills whenever fresh global data arrives
  const prevLiveNewsRef = useRef(liveNews);
  useEffect(() => {
    if (liveNews && liveNews !== prevLiveNewsRef.current) {
      setRegionBackfills({});
    }
    prevLiveNewsRef.current = liveNews;
  }, [liveNews]);

  // ── Session memory: diff against last snapshot on initial data load ──
  useEffect(() => {
    if (!liveNews || liveNews.length === 0 || sessionDiffInitRef.current) return;
    sessionDiffInitRef.current = true;

    (async () => {
      try {
        const lastSnap = await loadLastSnapshot();
        const previousEvents = lastSnap?.events || [];
        const diff = diffEventSnapshots(previousEvents, liveNews);
        setSessionDiff(diff);
        // Save current snapshot and prune old ones
        await saveSnapshot(liveNews);
        await pruneOldSnapshots();
      } catch (err) {
        console.warn('Session memory init failed:', err.message);
      }
    })();
  }, [liveNews]);

  // Save snapshot after each data refresh (beyond initial)
  useEffect(() => {
    if (!sessionDiffInitRef.current || !liveNews || liveNews.length === 0) return;
    // The initial save is handled above; subsequent saves happen here
    // We skip if prevLiveNewsRef still matches (no actual change)
    if (liveNews === prevLiveNewsRef.current) return;

    (async () => {
      try {
        await saveSnapshot(liveNews);
        await pruneOldSnapshots();
      } catch (err) {
        console.warn('Snapshot save failed:', err.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveNews]);

  // ── Load snapshot history for timeline ──
  useEffect(() => {
    (async () => {
      try {
        const history = await loadSnapshotHistory();
        setSnapshotHistory(history);
      } catch (err) {
        console.warn('Failed to load snapshot history:', err.message);
      }
    })();
  }, []);

  // ── URL state: read params on mount ──
  const urlInitRef = useRef(false);
  useEffect(() => {
    if (urlInitRef.current) return;
    urlInitRef.current = true;

    const { filters, mapState } = decodeURLToFilters(searchParams);
    if (filters.searchQuery) setSearchQuery(filters.searchQuery);
    if (filters.minSeverity) setMinSeverity(filters.minSeverity);
    if (filters.minConfidence) setMinConfidence(filters.minConfidence);
    if (filters.dateWindow) setDateWindow(filters.dateWindow);
    if (filters.sortMode) setSortMode(filters.sortMode);
    if (filters.selectedRegion) setSelectedRegion(filters.selectedRegion);
    if (mapState.mapMode) setMapMode(mapState.mapMode);
    if (mapState.mapOverlay) setMapOverlay(mapState.mapOverlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Saved views handlers ──
  const handleSaveView = useCallback(() => {
    const name = window.prompt('Name this view:');
    if (!name || !name.trim()) return;
    const view = createView(
      name.trim(),
      { searchQuery, minSeverity, minConfidence, dateWindow, sortMode, selectedRegion },
      { mapMode, mapOverlay }
    );
    const next = [...savedViews, view];
    setSavedViews(next);
    setActiveViewId(view.id);
    saveViews(next);
  }, [savedViews, searchQuery, minSeverity, minConfidence, dateWindow, sortMode, selectedRegion, mapMode, mapOverlay]);

  const handleSelectView = useCallback((view) => {
    setActiveViewId(view.id);
    const { filters = {}, mapState = {} } = view;
    if (filters.searchQuery !== undefined) setSearchQuery(filters.searchQuery);
    if (filters.minSeverity !== undefined) setMinSeverity(filters.minSeverity);
    if (filters.minConfidence !== undefined) setMinConfidence(filters.minConfidence);
    if (filters.dateWindow !== undefined) setDateWindow(filters.dateWindow);
    if (filters.sortMode !== undefined) setSortMode(filters.sortMode);
    if (filters.selectedRegion !== undefined) setSelectedRegion(filters.selectedRegion);
    if (mapState.mapMode !== undefined) setMapMode(mapState.mapMode);
    if (mapState.mapOverlay !== undefined) setMapOverlay(mapState.mapOverlay);
  }, []);

  const handleDeleteView = useCallback((view) => {
    const next = savedViews.filter((v) => v.id !== view.id);
    setSavedViews(next);
    if (activeViewId === view.id) setActiveViewId(null);
    saveViews(next);
  }, [savedViews, activeViewId]);

  // Base articles: live data or fallback to mock
  const baseArticles = useMemo(() => {
    if (dataSource !== 'live') {
      return liveNews || MOCK_NEWS;
    }
    return liveNews || [];
  }, [dataSource, liveNews]);

  const canonicalNews = useMemo(
    () => canonicalizeArticles(baseArticles),
    [baseArticles]
  );

  const dateFloor = useMemo(
    () => resolveDateFloor(dateWindow),
    [dateWindow]
  );

  const activeNews = useMemo(() => {
    let pool = canonicalNews;

    // Timeline scrub: only include events first seen before scrubTime
    if (scrubTime != null) {
      pool = pool.filter((story) => {
        const ts = story.firstSeenAt ? new Date(story.firstSeenAt).getTime() : 0;
        return ts <= scrubTime;
      });
    }

    const filtered = pool.filter((story) => (
      storyMatchesFilters(story, {
        minSeverity,
        minConfidence,
        dateFloor,
        accuracyMode,
        verificationFilter,
        sourceTypeFilter,
        languageFilter,
        precisionFilter,
        hideAmplified
      })
    ));

    return sortStories(filtered, sortMode);
  }, [accuracyMode, canonicalNews, dateFloor, hideAmplified, languageFilter, minConfidence, minSeverity, precisionFilter, scrubTime, sortMode, sourceTypeFilter, verificationFilter]);

  // Lifecycle transition messages for the intel ticker
  const prevEventsRef = useRef([]);
  const [lifecycleMessages, setLifecycleMessages] = useState([]);
  useEffect(() => {
    const msgs = generateLifecycleMessages(activeNews, prevEventsRef.current);
    if (msgs.length > 0) {
      setLifecycleMessages(msgs);
    }
    prevEventsRef.current = activeNews;
  }, [activeNews]);

  const regionSeverities = useMemo(
    () => calculateRegionSeverity(activeNews),
    [activeNews]
  );

  // Velocity spikes: prefer backend z-score spikes; fall back to client-side count heuristic
  const velocitySpikes = useMemo(() => {
    // Use backend spikes when available (they have zScore + level)
    if (hookVelocitySpikes && hookVelocitySpikes.length > 0) {
      return hookVelocitySpikes;
    }
    // Client-side fallback: regions with event count >= 3x the median non-zero region count
    const countByIso = {};
    activeNews.forEach((story) => {
      if (story.isoA2) {
        countByIso[story.isoA2] = (countByIso[story.isoA2] || 0) + 1;
      }
    });
    const counts = Object.values(countByIso).filter((c) => c > 0).sort((a, b) => a - b);
    if (counts.length < 3) return [];
    const medianIdx = Math.floor(counts.length / 2);
    const median = counts[medianIdx] || 1;
    const threshold = Math.max(3, median * 3);
    return Object.entries(countByIso)
      .filter(([, count]) => count >= threshold)
      .map(([iso, count]) => ({ iso, count, zScore: count / (median || 1), level: 'spike' }));
  }, [activeNews, hookVelocitySpikes]);

  const coverageMetrics = useMemo(
    () => calculateCoverageMetrics(activeNews),
    [activeNews]
  );

  const coverageDiagnostics = useMemo(
    () => buildCoverageDiagnostics(coverageMetrics, sourceHealth),
    [coverageMetrics, sourceHealth]
  );
  const sourceCoverageAudit = useMemo(
    () => buildSourceCoverageAudit(coverageDiagnostics),
    [coverageDiagnostics]
  );

  const coverageStatusByIso = coverageDiagnostics.byIso;

  const selectedRegionBackfillStories = useMemo(() => {
    if (!selectedRegion) {
      return [];
    }

    const backfillStories = regionBackfills[selectedRegion]?.events || [];
    return sortStories(backfillStories.filter((story) => (
      storyMatchesFilters(story, {
        minSeverity,
        minConfidence,
        dateFloor,
        accuracyMode,
        verificationFilter,
        sourceTypeFilter,
        languageFilter,
        precisionFilter,
        hideAmplified
      })
    )), sortMode);
  }, [accuracyMode, dateFloor, hideAmplified, languageFilter, minConfidence, minSeverity, precisionFilter, regionBackfills, selectedRegion, sortMode, sourceTypeFilter, verificationFilter]);

  useEffect(() => {
    const availableStories = selectedRegion
      ? mergeStoryLists(activeNews.filter((story) => story.isoA2 === selectedRegion), selectedRegionBackfillStories)
      : activeNews;

    if (selectedStoryId && !availableStories.some((story) => story.id === selectedStoryId)) {
      setSelectedStoryId(null);
    }
  }, [activeNews, selectedRegion, selectedRegionBackfillStories, selectedStoryId]);

  const selectedStory = activeNews.find((story) => story.id === selectedStoryId)
    ?? selectedRegionBackfillStories.find((story) => story.id === selectedStoryId)
    ?? null;
  const panelRegion = selectedRegion || selectedStory?.isoA2 || null;
  const panelOpen = Boolean(panelRegion);
  const panelBackfillEntry = panelRegion ? regionBackfills[panelRegion] || null : null;
  const panelBackfillStories = useMemo(() => {
    if (!panelRegion) {
      return [];
    }

    const backfillStories = panelBackfillEntry?.events || [];
    return sortStories(backfillStories.filter((story) => (
      storyMatchesFilters(story, {
        minSeverity,
        minConfidence,
        dateFloor,
        accuracyMode,
        verificationFilter,
        sourceTypeFilter,
        languageFilter,
        precisionFilter,
        hideAmplified
      })
    )), sortMode);
  }, [accuracyMode, dateFloor, hideAmplified, languageFilter, minConfidence, minSeverity, panelBackfillEntry, panelRegion, precisionFilter, sortMode, sourceTypeFilter, verificationFilter]);
  const panelLiveNews = panelRegion ? activeNews.filter((story) => story.isoA2 === panelRegion) : [];
  const panelNews = panelLiveNews.length > 0 ? panelLiveNews : panelBackfillStories;
  const panelRegionData = useMemo(() => {
    if (!panelRegion) {
      return null;
    }

    if (regionSeverities[panelRegion]) {
      return regionSeverities[panelRegion];
    }

    return calculateRegionSeverity(panelNews)[panelRegion] || null;
  }, [panelNews, panelRegion, regionSeverities]);
  const panelRegionName = panelRegion
    ? coverageStatusByIso[panelRegion]?.region
      || panelRegionData?.region
      || selectedStory?.region
      || panelBackfillEntry?.region
      || isoToCountry(panelRegion)
      || panelRegion
    : null;
  const panelRegionStatus = panelRegion ? coverageStatusByIso[panelRegion]?.status || null : null;
  const panelCoverageEntry = panelRegion ? coverageStatusByIso[panelRegion] || null : null;
  const panelBackfillStatus = panelBackfillEntry?.status || 'idle';
  const panelCoverageTransitions = useMemo(() => (
    panelRegion
      ? (coverageHistory?.transitions || []).filter((entry) => entry.iso === panelRegion).slice(0, 4)
      : []
  ), [coverageHistory, panelRegion]);
  const mapNewsList = useMemo(() => {
    if (!panelRegion || panelNews.length === 0) {
      return activeNews;
    }

    return mergeStoryLists(activeNews, panelNews);
  }, [activeNews, panelNews, panelRegion]);
  const mapRegionSeverities = useMemo(() => {
    if (!panelRegion || !panelRegionData || regionSeverities[panelRegion]) {
      return regionSeverities;
    }

    return {
      ...regionSeverities,
      [panelRegion]: panelRegionData
    };
  }, [panelRegion, panelRegionData, regionSeverities]);

  useEffect(() => {
    if (!panelRegion) {
      setRegionCoverageHistory(null);
      return;
    }

    setRegionCoverageHistory(null);
    let cancelled = false;

    fetchBackendCoverageRegion({ iso: panelRegion })
      .then((payload) => {
        if (!cancelled) {
          setRegionCoverageHistory(payload);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRegionCoverageHistory(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [panelRegion]);

  useEffect(() => {
    if (!panelRegion || dataSource !== 'live') {
      return undefined;
    }

    if (panelLiveNews.length > 0) {
      return undefined;
    }

    if (panelBackfillStatus === 'loading' || panelBackfillStatus === 'done' || panelBackfillStatus === 'empty') {
      return undefined;
    }

    const regionName = panelRegionName || isoToCountry(panelRegion) || panelRegion;
    let cancelled = false;

    setRegionBackfills((prev) => upsertRegionBackfill(prev, {
      iso: panelRegion,
      region: regionName,
      status: 'loading',
      events: [],
      sourcePlan: buildRegionSourcePlan(regionName, { coverageDiagnostics }),
      feedChecks: []
    }));

    // Try backend first, fall back to client-side GDELT
    const doBackfill = async () => {
      // 1. Try backend
      try {
        const payload = await fetchBackendRegionBriefing({ iso: panelRegion });
        if (cancelled) return;

        const events = sortStories(
          (payload?.events || canonicalizeArticles((payload?.articles || []).filter((article) => article.isoA2 === panelRegion)))
            .filter((story) => story.isoA2 === panelRegion),
          sortMode
        );
        setRegionBackfills((prev) => upsertRegionBackfill(prev, {
          iso: panelRegion,
          region: payload?.region || regionName,
          status: events.length > 0 ? 'done' : 'empty',
          fetchedAt: payload?.fetchedAt || new Date().toISOString(),
          sourcePlan: payload?.sourcePlan || buildRegionSourcePlan(regionName, { coverageDiagnostics }),
          feedChecks: payload?.feedChecks || [],
          events
        }));
        return;
      } catch (backendErr) {
        console.warn('Region backfill backend failed, trying client-side:', backendErr.message);
      }

      // 2. Fallback: client-side GDELT query for this region
      try {
        const clientArticles = await fetchLiveNews({
          query: `"${regionName}"`,
          timespan: '24h',
          maxRecords: 50
        });
        if (cancelled) return;

        const events = sortStories(
          (clientArticles || []).filter((story) => story.isoA2 === panelRegion),
          sortMode
        );
        setRegionBackfills((prev) => upsertRegionBackfill(prev, {
          iso: panelRegion,
          region: regionName,
          status: events.length > 0 ? 'done' : 'empty',
          fetchedAt: new Date().toISOString(),
          sourcePlan: buildRegionSourcePlan(regionName, { coverageDiagnostics }),
          feedChecks: [],
          events
        }));
        return;
      } catch (clientErr) {
        console.warn('Region backfill client-side also failed:', clientErr.message);
      }

      // 3. Both failed
      if (!cancelled) {
        setRegionBackfills((prev) => upsertRegionBackfill(prev, {
          iso: panelRegion,
          region: regionName,
          status: 'error',
          fetchedAt: new Date().toISOString(),
          sourcePlan: buildRegionSourcePlan(regionName, { coverageDiagnostics }),
          feedChecks: [],
          events: []
        }));
      }
    };

    doBackfill();

    return () => {
      cancelled = true;
    };
  }, [coverageDiagnostics, dataSource, panelBackfillStatus, panelLiveNews.length, panelRegion, panelRegionName, sortMode]);

  const activeRegions = coverageMetrics.coveredCountries;
  const verifiedRegions = coverageMetrics.verifiedCountries;
  const criticalCount = activeNews.filter((s) => s.severity >= 85).length;

  const handleRegionSelect = (iso) => {
    setSelectedRegion((prev) => (prev === iso ? null : iso));
    setSelectedStoryId(null);
    setSelectedArc(null);
  };

  const handleStorySelect = (story) => {
    setSelectedStoryId(story.id);
    setSelectedRegion(story.isoA2);
    setSelectedArc(null);
  };

  const handleArcSelect = useCallback((arc) => {
    setSelectedArc(arc);
    setSelectedRegion(null);
    setSelectedStoryId(null);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedRegion(null);
    setSelectedStoryId(null);
    setSelectedArc(null);
  }, []);

  const handleSearchSelect = useCallback((result) => {
    if (result.type === 'region') {
      setSelectedRegion(result.iso);
      setSelectedStoryId(null);
    } else if (result.type === 'story') {
      setSelectedStoryId(result.story.id);
      setSelectedRegion(result.story.isoA2);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    setRegionCoverageHistory(null);
    setRegionBackfills({});
    refreshEventData();
  }, [refreshEventData]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore when typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }

      switch (e.key) {
        case 'r':
          handleRefresh();
          break;
        case '/':
          e.preventDefault();
          document.querySelector('.search-input')?.focus();
          break;
        case 'Escape':
          if (panelOpen) {
            handleClosePanel();
          } else if (filtersOpen) {
            setDrawerMode(null);
          }
          break;
        case 'g':
          setMapMode((prev) => (prev === 'globe' ? 'flat' : 'globe'));
          break;
        case 'f':
          setDrawerMode((prev) => prev === 'filters' ? null : 'filters');
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [panelOpen, filtersOpen, handleRefresh, handleClosePanel]);

  // ── URL state sync: write current filters to URL (replaceState to avoid clutter) ──
  useEffect(() => {
    // Skip the initial render to avoid overwriting URL params we just read
    if (!urlInitRef.current) return;

    const qs = encodeViewToURL({
      filters: { searchQuery: debouncedSearch, minSeverity, minConfidence, dateWindow, sortMode, selectedRegion },
      mapState: { mapMode, mapOverlay }
    });
    // Also keep story param for deep links
    const params = new URLSearchParams(qs);
    if (selectedStoryId) params.set('story', selectedStoryId);
    setSearchParams(params, { replace: true });
  }, [debouncedSearch, minSeverity, minConfidence, dateWindow, sortMode, selectedRegion, mapMode, mapOverlay, selectedStoryId, setSearchParams]);

  return (
    <ErrorBoundary>
    <div className="app">
      <Suspense fallback={null}>
        {mapMode === 'globe' ? (
          <Globe
            newsList={mapNewsList}
            regionSeverities={mapRegionSeverities}
            mapOverlay={mapOverlay}
            coverageStatusByIso={coverageStatusByIso}
            velocitySpikes={velocitySpikes}
            selectedRegion={selectedRegion}
            selectedStory={selectedStory}
            onRegionSelect={handleRegionSelect}
            onStorySelect={handleStorySelect}
            onArcSelect={handleArcSelect}
          />
        ) : (
          <FlatMap
            newsList={mapNewsList}
            regionSeverities={mapRegionSeverities}
            mapOverlay={mapOverlay}
            coverageStatusByIso={coverageStatusByIso}
            velocitySpikes={velocitySpikes}
            selectedRegion={selectedRegion}
            selectedStory={selectedStory}
            onRegionSelect={handleRegionSelect}
            onStorySelect={handleStorySelect}
            onArcSelect={handleArcSelect}
          />
        )}
      </Suspense>

      <Header
        searchQuery={searchQuery}
        debouncedSearch={debouncedSearch}
        onSearchChange={setSearchQuery}
        onSearchSelect={handleSearchSelect}
        newsList={activeNews}
        regionSeverities={regionSeverities}
        storyCount={activeNews.length}
        regionCount={activeRegions}
        verifiedCount={verifiedRegions}
        criticalCount={criticalCount}
        mapMode={mapMode}
        onMapModeChange={setMapMode}
        mapOverlay={mapOverlay}
        onMapOverlayChange={setMapOverlay}
        dataSource={dataSource}
        onRefresh={handleRefresh}
        backendStatus={opsHealth?.status || sourceHealth?.backend?.status || null}
        savedViews={savedViews}
        activeViewId={activeViewId}
        onSaveView={handleSaveView}
        onSelectView={handleSelectView}
        onDeleteView={handleDeleteView}
        sessionDiff={sessionDiff}
        onExport={() => setShowExport(true)}
      >
        <div className="legend">
          <span className="legend-label">{t(`legend.${mapOverlay}`)}</span>
          <div className="legend-items">
            {mapOverlay === 'severity'
              ? [
                { key: 'critical', color: 'var(--critical)' },
                { key: 'elevated', color: 'var(--elevated)' },
                { key: 'watch', color: 'var(--watch)' },
                { key: 'low', color: 'var(--low)' }
              ].map((item) => (
                <div key={item.key} className="legend-item">
                  <span className="legend-dot" style={{ background: item.color }} />
                  {t(`legend.${item.key}`)}
                </div>
              ))
              : COVERAGE_STATUS_ORDER.map((status) => {
                const meta = getCoverageMeta(status);
                return (
                  <div key={status} className="legend-item">
                    <span className="legend-dot" style={{ background: meta.accent }} />
                    {t(`coverageStatus.${meta.labelKey}`)}
                  </div>
                );
              })}
          </div>
          <span className="legend-credit">crafted by <strong>tor</strong></span>
        </div>
      </Header>

      <div className="drawer-toggles">
        <button
          className={`filter-toggle ${drawerMode === 'filters' ? 'is-active' : ''}`}
          onClick={() => setDrawerMode((prev) => prev === 'filters' ? null : 'filters')}
        >
          <SlidersHorizontal size={12} />
          {t('filters.label')}
        </button>
        <button
          className={`filter-toggle ${drawerMode === 'intel' ? 'is-active' : ''}`}
          onClick={() => setDrawerMode((prev) => prev === 'intel' ? null : 'intel')}
        >
          <Radio size={12} />
          INTEL
        </button>
      </div>

      <FilterDrawer
        isOpen={filtersOpen}
        defaultTab={drawerMode || 'filters'}
        onClose={() => setDrawerMode(null)}
        dateWindow={dateWindow}
        setDateWindow={setDateWindow}
        mapOverlay={mapOverlay}
        setMapOverlay={setMapOverlay}
        verificationFilter={verificationFilter}
        setVerificationFilter={setVerificationFilter}
        sourceTypeFilter={sourceTypeFilter}
        setSourceTypeFilter={setSourceTypeFilter}
        languageFilter={languageFilter}
        setLanguageFilter={setLanguageFilter}
        accuracyMode={accuracyMode}
        setAccuracyMode={setAccuracyMode}
        sourceCoverageAudit={sourceCoverageAudit}
        precisionFilter={precisionFilter}
        setPrecisionFilter={setPrecisionFilter}
        minSeverity={minSeverity}
        setMinSeverity={setMinSeverity}
        minConfidence={minConfidence}
        setMinConfidence={setMinConfidence}
        sortMode={sortMode}
        setSortMode={setSortMode}
        coverageMetrics={coverageMetrics}
        coverageDiagnostics={coverageDiagnostics}
        coverageTrends={coverageTrends}
        coverageHistory={coverageHistory}
        opsHealth={opsHealth}
        allNews={canonicalNews}
        filteredNews={activeNews}
        sourceHealth={sourceHealth}
        onRegionSelect={handleRegionSelect}
        hideAmplified={hideAmplified}
        setHideAmplified={setHideAmplified}
      />

      <EventTimeline
        events={activeNews}
        snapshotHistory={snapshotHistory}
        scrubTime={scrubTime}
        onScrub={setScrubTime}
      />

      <div className={`intel-ticker ${panelOpen ? 'is-shifted' : ''}`}>
        <span className="intel-ticker-label">INTEL</span>
        <div className="intel-ticker-track">
          <div className="intel-ticker-scroll">
            {lifecycleMessages.map((msg, idx) => {
              const meta = getSeverityMeta(msg.severity);
              return (
                <span
                  key={`lifecycle-${idx}`}
                  className="intel-ticker-item intel-ticker-lifecycle"
                >
                  <span className="intel-ticker-dot" style={{ background: meta.accent }} />
                  <span className="intel-ticker-severity" style={{ color: meta.accent }}>{msg.lifecycle}</span>
                  <span className="intel-ticker-title">{msg.text}</span>
                </span>
              );
            })}
            {activeNews.slice(0, 12).map((story) => {
              const meta = getSeverityMeta(story.severity);
              return (
                <button
                  key={story.id}
                  type="button"
                  className={`intel-ticker-item ${selectedStoryId === story.id ? 'is-active' : ''}`}
                  onClick={() => handleStorySelect(story)}
                >
                  <span className="intel-ticker-dot" style={{ background: meta.accent }} />
                  <span className="intel-ticker-severity" style={{ color: meta.accent }}>{meta.label}</span>
                  <span className="intel-ticker-title">{story.title}</span>
                  <span className="intel-ticker-loc">{story.locality}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {selectedArc && (
        <ArcPanel
          arc={selectedArc}
          newsList={activeNews}
          onStorySelect={handleStorySelect}
          onRegionSelect={handleRegionSelect}
          onClose={() => setSelectedArc(null)}
        />
      )}

      <NewsPanel
        key={panelRegion || 'closed'}
        isOpen={panelOpen && !selectedArc}
        regionName={panelRegionName}
        regionStatus={panelRegionStatus}
        regionData={panelRegionData}
        coverageEntry={panelCoverageEntry}
        coverageTransitions={panelCoverageTransitions}
        regionHistory={regionCoverageHistory}
        regionBackfillStatus={panelBackfillStatus}
        regionSourcePlan={panelBackfillEntry?.sourcePlan || null}
        regionFeedChecks={panelBackfillEntry?.feedChecks || []}
        news={panelNews}
        selectedStoryId={selectedStoryId}
        onStorySelect={handleStorySelect}
        onClose={handleClosePanel}
        sessionDiff={sessionDiff}
        velocitySpikes={velocitySpikes}
      />

      {dataError && (
        <div className="data-error-badge">
          {t('errors.fallbackData')}
        </div>
      )}
      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.type}`}>
              <span className="toast-dot" />
              {toast.message}
            </div>
          ))}
        </div>
      )}

      {showExport && (
        <BriefingExport
          events={activeNews}
          filters={{ minSeverity, minConfidence, dateWindow, sortMode, mapOverlay }}
          onClose={() => setShowExport(false)}
        />
      )}

      <Analytics />
    </div>
    </ErrorBoundary>
  );
}

export default App;
