import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, ChevronsDownUp, ChevronsUpDown, X, Users, Building2, MapPin, Clock } from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
import MapErrorBoundary from './components/MapErrorBoundary';
import MapLoadingFallback from './components/MapLoadingFallback';
import DataLoadingOverlay from './components/DataLoadingOverlay';
import DataErrorBanner from './components/DataErrorBanner';
import FilterDrawer from './components/FilterDrawer';
import NewsPanel from './components/NewsPanel';
import AnomalyPanel from './components/AnomalyPanel';
import WatchlistPanel from './components/WatchlistPanel';
import NarrativePanel from './components/NarrativePanel';
import MapFloatingIcons from './components/MapFloatingIcons';
import MobileSeverityChips from './components/MobileSeverityChips';
import MobileTimelineSheet from './components/MobileTimelineSheet';
import EventTimeline from './components/EventTimeline';
import useNewsStore from './stores/newsStore';
import useFilterStore from './stores/filterStore';
import useUIStore from './stores/uiStore';
import useWatchStore from './stores/watchStore';
import useSubscription from './hooks/useSubscription';
import useKeyboardNavigation from './hooks/useKeyboardNavigation';
import usePanelState from './hooks/usePanelState';
import useBreakpoint from './hooks/useBreakpoint';
import useBriefingStream from './hooks/useBriefingStream';
import useTrackingOverlayData from './hooks/useTrackingOverlayData';
import { canonicalizeArticles, calculateCoverageMetrics } from './utils/newsPipeline';
import { COVERAGE_STATUS_ORDER, getCoverageMeta } from './utils/coverageMeta';
import { computePerCountryReliability } from './utils/credibilityMeta';
import { buildCoverageDiagnostics } from './utils/coverageDiagnostics';
import { buildSourceCoverageAudit } from './utils/sourceCoverage';
import { sortStories, storyMatchesFilters } from './utils/storyFilters';
import { getSourceNetworkKey } from './utils/sourceMetadata';
import { getRelatedEvents } from './utils/entityGraph';
import { isoToCountry } from './utils/geocoder';
import { generateLifecycleMessages } from './utils/lifecycleMessages';
import { encodeViewToURL } from './utils/viewManager';
import { computeSilenceEntries } from './utils/anomalyUtils';
import { calculateRegionSeverity, getSeverityMeta, resolveDateFloor } from './utils/mockData';
import { getGeopoliticalLegend } from './utils/visualSystem';
import SaveViewDialog from './components/SaveViewDialog';
// jspdf + html2canvas pull ~100 KB gz that should not ship to every visitor.
// Lazy-loaded so the modal (and its PDF deps) only download when opened.
const BriefingExportModal = lazy(() => import('./components/BriefingExportModal'));
import CoverageDrilldown from './components/CoverageDrilldown';
import UpgradePrompt from './components/UpgradePrompt';
import db from './services/instantDb';

const Globe = lazy(() => import('./components/Globe'));
const FlatMap = lazy(() => import('./components/FlatMap'));

function MapOverlayLegend({ overlay }) {
  const { t } = useTranslation();
  if (!overlay) return null;

  const items = overlay === 'severity'
    ? ['critical', 'elevated', 'watch', 'low'].map((key) => ({
        key,
        color: `var(--${key})`,
        label: t(`legend.${key}`),
      }))
    : overlay === 'geopolitical'
      ? getGeopoliticalLegend().map(({ key, color, labelKey }) => ({
          key,
          color,
          label: t(labelKey),
        }))
      : COVERAGE_STATUS_ORDER.map((status) => {
          const meta = getCoverageMeta(status);
          return {
            key: status,
            color: meta.accent,
            label: t(`coverageStatus.${meta.labelKey}`),
          };
        });

  return (
    <div className="map-overlay-legend" aria-label={t(`legend.${overlay}`)}>
      <span className="micro">{t(`legend.${overlay}`)}</span>
      <div className="legend-items">
        {items.map(({ key, color, label }) => (
          <span key={key} className="legend-item">
            <span className="legend-dot" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function App() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  /* ── stores ──
   *
   * Per-field selectors (NOT whole-store destructure). Reading the whole
   * store object subscribes the component to every field, so a single
   * `addToast` push or `searchQuery` debounce-tick re-renders all of App.
   * With per-field selectors we only re-render when the field we read
   * changes — measured ~5-10× re-render reduction on filter/scrub flows.
   */
  // newsStore
  const liveNews = useNewsStore((s) => s.liveNews);
  const dataSource = useNewsStore((s) => s.dataSource);
  const dataError = useNewsStore((s) => s.dataError);
  const sourceHealth = useNewsStore((s) => s.sourceHealth);
  const coverageTrends = useNewsStore((s) => s.coverageTrends);
  const coverageHistory = useNewsStore((s) => s.coverageHistory);
  const opsHealth = useNewsStore((s) => s.opsHealth);
  const hookVelocitySpikes = useNewsStore((s) => s.velocitySpikes);
  const regionCoverageHistory = useNewsStore((s) => s.regionCoverageHistory);
  const sessionDiff = useNewsStore((s) => s.sessionDiff);
  const historicalState = useNewsStore((s) => s.historicalState);
  const isTimeTravel = useNewsStore((s) => s.isTimeTravel);

  // filterStore
  const searchQuery = useFilterStore((s) => s.searchQuery);
  const debouncedSearch = useFilterStore((s) => s.debouncedSearch);
  const dateWindow = useFilterStore((s) => s.dateWindow);
  const minSeverity = useFilterStore((s) => s.minSeverity);
  const minConfidence = useFilterStore((s) => s.minConfidence);
  const sortMode = useFilterStore((s) => s.sortMode);
  const mapOverlay = useFilterStore((s) => s.mapOverlay);
  const showFlightsLayer = useFilterStore((s) => s.showFlightsLayer);
  const showVesselsLayer = useFilterStore((s) => s.showVesselsLayer);
  const verificationFilter = useFilterStore((s) => s.verificationFilter);
  const sourceTypeFilter = useFilterStore((s) => s.sourceTypeFilter);
  const languageFilter = useFilterStore((s) => s.languageFilter);
  const accuracyMode = useFilterStore((s) => s.accuracyMode);
  const precisionFilter = useFilterStore((s) => s.precisionFilter);
  const hideAmplified = useFilterStore((s) => s.hideAmplified);
  const entityFilter = useFilterStore((s) => s.entityFilter);

  // uiStore
  const mapMode = useUIStore((s) => s.mapMode);
  const drawerMode = useUIStore((s) => s.drawerMode);
  const selectedRegion = useUIStore((s) => s.selectedRegion);
  const selectedStoryId = useUIStore((s) => s.selectedStoryId);
  const selectedArc = useUIStore((s) => s.selectedArc);
  const showExport = useUIStore((s) => s.showExport);
  const scrubTime = useUIStore((s) => s.scrubTime);
  const toasts = useUIStore((s) => s.toasts);
  const activeViewId = useUIStore((s) => s.activeViewId);
  const viewNotFound = useUIStore((s) => s.viewNotFound);

  const { hasFeatureAccess } = useSubscription();
  const canExportBriefings = hasFeatureAccess('briefingExport');

  const filtersOpen = drawerMode !== null;
  const addToast = useUIStore((s) => s.addToast);

  const { points: trackingPoints, vesselsDisabled } = useTrackingOverlayData(showFlightsLayer, showVesselsLayer);

  const shownVesselWarning = useRef(false);
  useEffect(() => {
    if (vesselsDisabled && showVesselsLayer && !shownVesselWarning.current) {
      shownVesselWarning.current = true;
      addToast('Ship tracking requires AISSTREAM_API_KEY — not configured on server', 'warning');
    }
  }, [vesselsDisabled, showVesselsLayer, addToast]);

  const sseReloadBriefing = useCallback(() => {
    useNewsStore.getState().loadLiveData({ addToast });
  }, [addToast]);
  useBriefingStream(sseReloadBriefing);

  useEffect(() => {
    document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  const prevLiveNewsRef = useRef(liveNews);
  useEffect(() => {
    if (liveNews && liveNews !== prevLiveNewsRef.current) {
      useNewsStore.getState().saveCurrentSnapshot();
    }
    prevLiveNewsRef.current = liveNews;
  }, [liveNews]);

  const prevSpikesRef = useRef([]);
  useEffect(() => {
    if (!hookVelocitySpikes || hookVelocitySpikes.length === 0) return;
    const prevIsos = new Set(prevSpikesRef.current.map((s) => s.iso));
    const topSpike = hookVelocitySpikes.find((s) => s.level === 'spike') || hookVelocitySpikes[0];
    if (topSpike && !prevIsos.has(topSpike.iso)) {
      const countryName = isoToCountry(topSpike.iso) || topSpike.iso;
      const zLabel = topSpike.zScore === Infinity ? '∞' : topSpike.zScore.toFixed(1);
      addToast(`Velocity spike · ${countryName} · z=${zLabel}`, 'velocity-spike');
    }
    prevSpikesRef.current = hookVelocitySpikes;
  }, [hookVelocitySpikes, addToast]);

  /* ── URL hydration ── */
  const urlInitRef = useRef(false);
  const viewUrlHandledRef = useRef(false);
  // Last URL search string we wrote OUT from the store. If the incoming
  // searchParams differ from this we know the change came from outside (back
  // button, deep link, paste) and re-hydrate the store.
  const lastSyncedQsRef = useRef(null);
  useEffect(() => {
    const currentQs = searchParams.toString();
    const isExternalChange = urlInitRef.current && lastSyncedQsRef.current !== currentQs;
    if (urlInitRef.current && !isExternalChange) return;
    urlInitRef.current = true;
    const { filters, mapState } = useFilterStore.getState().initFromURL(searchParams);
    useUIStore.getState().initFromURL(searchParams, mapState);
    if (filters.selectedRegion) useUIStore.setState({ selectedRegion: filters.selectedRegion });

    // Handle shared view URL param
    const viewId = searchParams.get('view');
    if (viewId && !viewUrlHandledRef.current) {
      viewUrlHandledRef.current = true;
      // Try to load the view from InstantDB
      db.queryOnce({ savedViews: { $: { where: { id: viewId } } } })
        .then((resp) => {
          const view = resp?.data?.savedViews?.[0];
          if (view) {
            useFilterStore.getState().applyView({
              filters: view.filterState || {},
              mapState: view.mapState || {},
            });
            useUIStore.getState().setActiveViewId(view.id);
          } else {
            useUIStore.getState().setViewNotFound(true);
          }
        })
        .catch(() => {
          useUIStore.getState().setViewNotFound(true);
        });
    }
  }, [searchParams]);

  /* ── Computed data ── */
  /* ── Historical time travel data ── */
  const historicalArticles = useMemo(() => {
    if (!isTimeTravel || !historicalState?.snapshots) return null;
    // Flatten all snapshot event summaries into article-like objects
    const articles = [];
    for (const snap of historicalState.snapshots) {
      if (!snap.eventSummary) continue;
      for (const ev of snap.eventSummary) {
        articles.push({
          id: ev.id,
          title: ev.title || 'Untitled',
          severity: ev.severity ?? 0,
          primaryCountry: ev.primaryCountry || '',
          isoA2: ev.primaryCountry || '',
          category: ev.category || '',
          lifecycle: ev.lifecycle || '',
          summary: ev.title || '',
          firstSeenAt: snap.at || null,
          entities: { organizations: [], people: [], locations: [] },
          source: '',
          url: '',
        });
      }
    }
    return articles;
  }, [isTimeTravel, historicalState]);

  const baseArticles = useMemo(() => {
    if (isTimeTravel && historicalArticles) return historicalArticles;
    // No mock fallback — when data isn't available the UI shows an empty
    // state plus DataErrorBanner with retry. We never substitute fake data.
    return liveNews || [];
  }, [liveNews, isTimeTravel, historicalArticles]);

  const canonicalNews = useMemo(() => canonicalizeArticles(baseArticles), [baseArticles]);
  const dateFloor = useMemo(() => resolveDateFloor(dateWindow), [dateWindow]);

  const filterParams = useMemo(() => ({
    minSeverity, minConfidence, dateFloor, accuracyMode,
    verificationFilter, sourceTypeFilter, languageFilter, precisionFilter, hideAmplified,
  }), [
    minSeverity, minConfidence, dateFloor, accuracyMode,
    verificationFilter, sourceTypeFilter, languageFilter, precisionFilter, hideAmplified,
  ]);

  const activeNews = useMemo(() => {
    let pool = canonicalNews;
    if (scrubTime != null) {
      pool = pool.filter((s) => {
        const ts = s.firstSeenAt ? new Date(s.firstSeenAt).getTime() : 0;
        return ts <= scrubTime;
      });
    }
    let filtered = pool.filter((s) => storyMatchesFilters(s, filterParams));
    const q = (debouncedSearch || '').trim().toLowerCase();
    if (q.length >= 2) {
      filtered = filtered.filter((s) => {
        const haystack = [s.title, s.summary, s.locality, s.category, s.region]
          .filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }
    if (entityFilter) {
      const entityEvents = new Set(
        getRelatedEvents(filtered, entityFilter.name, entityFilter.type).map((e) => e.id),
      );
      filtered = filtered.filter((s) => entityEvents.has(s.id));
    }
    return sortStories(filtered, sortMode);
  }, [canonicalNews, scrubTime, filterParams, sortMode, debouncedSearch, entityFilter]);

  const regionSeverities = useMemo(() => calculateRegionSeverity(activeNews), [activeNews]);

  const velocitySpikes = useMemo(() => {
    if (hookVelocitySpikes?.length > 0) return hookVelocitySpikes;
    const countByIso = {};
    activeNews.forEach((s) => { if (s.isoA2) countByIso[s.isoA2] = (countByIso[s.isoA2] || 0) + 1; });
    const counts = Object.values(countByIso).filter((c) => c > 0).sort((a, b) => a - b);
    if (counts.length < 3) return [];
    const median = counts[Math.floor(counts.length / 2)] || 1;
    return Object.entries(countByIso).filter(([, c]) => c >= Math.max(3, median * 3))
      .map(([iso, count]) => ({ iso, count, zScore: count / (median || 1), level: 'spike' }));
  }, [activeNews, hookVelocitySpikes]);

  const coverageMetrics = useMemo(() => calculateCoverageMetrics(activeNews), [activeNews]);
  const coverageDiagnostics = useMemo(
    () => buildCoverageDiagnostics(coverageMetrics, sourceHealth),
    [coverageMetrics, sourceHealth],
  );
  const sourceCoverageAudit = useMemo(() => buildSourceCoverageAudit(coverageDiagnostics), [coverageDiagnostics]);
  const coverageStatusByIso = coverageDiagnostics.byIso;

  /* ── Source reliability ── */
  const [sourceCredibilityMap, setSourceCredibilityMap] = useState({});

  const fetchSourceCredibility = useCallback(async () => {
    try {
      const res = await fetch('/api/source-reliability');
      if (!res.ok) return;
      const scores = await res.json();
      const map = {};
      for (const entry of scores) {
        if (entry.sourceKey) {
          map[entry.sourceKey] = { score: entry.score, totalEvents: entry.totalEvents, corroboratedEvents: entry.corroboratedEvents };
        }
      }
      setSourceCredibilityMap(map);
    } catch {
      // Silently ignore — reliability overlay is non-critical
    }
  }, []);

  useEffect(() => {
    fetchSourceCredibility();
    let interval = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(fetchSourceCredibility, 120_000);
    };
    const stop = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };
    const handleVisibility = () => {
      if (document.hidden) stop();
      else { fetchSourceCredibility(); start(); }
    };
    start();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchSourceCredibility]);

  // Enrich articles with source credibility score for display
  const activeNewsWithCredibility = useMemo(() => {
    if (Object.keys(sourceCredibilityMap).length === 0) return activeNews;
    return activeNews.map(article => {
      const sourceKey = getSourceNetworkKey({ source: article.source, url: article.url });
      const cred = sourceCredibilityMap[sourceKey];
      return cred ? { ...article, sourceCredibility: cred.score } : article;
    });
  }, [activeNews, sourceCredibilityMap]);

  /* ── Derived map/panel state ── */
  const {
    selectedStory, panelRegion, panelOpen, panelBackfillEntry, panelNews,
    panelRegionData, panelRegionName, panelRegionStatus, panelCoverageEntry,
    panelBackfillStatus, panelCoverageTransitions, mapNewsList, mapRegionSeverities,
  } = usePanelState({
    activeNews, filterParams, sortMode, regionSeverities, coverageStatusByIso,
    coverageHistory, dataSource, coverageDiagnostics,
  });

  // Enrich map news list with source credibility score
  const enrichedMapNews = useMemo(() => {
    if (Object.keys(sourceCredibilityMap).length === 0) return mapNewsList;
    return mapNewsList.map(article => {
      const sourceKey = getSourceNetworkKey({ source: article.source, url: article.url });
      const cred = sourceCredibilityMap[sourceKey];
      return cred ? { ...article, sourceCredibility: cred.score } : article;
    });
  }, [mapNewsList, sourceCredibilityMap]);

  const perCountryReliability = useMemo(() =>
    computePerCountryReliability(enrichedMapNews, sourceCredibilityMap),
    [enrichedMapNews, sourceCredibilityMap]
  );

  const silenceEntries = useMemo(() => computeSilenceEntries({
    articles: activeNews,
    regionSeverities,
    coverageStatusByIso,
    velocitySpikes,
  }), [activeNews, regionSeverities, coverageStatusByIso, velocitySpikes]);

  const watchItems = useWatchStore((s) => s.watchItems);

  const panelCollapsed = useUIStore((s) => s.panelCollapsed);
  const toggleAllPanelsCollapsed = useUIStore((s) => s.toggleAllPanelsCollapsed);
  const panelsMostlyCollapsed = (
    (panelCollapsed.anomaly ? 1 : 0)
    + (panelCollapsed.watchlist ? 1 : 0)
    + (panelCollapsed.narrative ? 1 : 0)
    + (panelCollapsed.liveFeed ? 1 : 0)
  ) > 2;

  /* ── Watchlist: new-article notifications on data change ── */
  const prevWatchNewsRef = useRef(null);
  useEffect(() => {
    if (!canonicalNews?.length || !watchItems.length) return;
    const isNewData = canonicalNews !== prevWatchNewsRef.current;
    useWatchStore.getState().checkNewArticles(canonicalNews);
    if (isNewData && prevWatchNewsRef.current !== null) {
      const notifications = useWatchStore.getState().notifications;
      if (notifications.length > 0) {
        if (notifications.length === 1) {
          const n = notifications[0];
          addToast(t('watchlist.notification', { count: n.newCount, label: n.label }), 'watch-alert');
        } else {
          addToast(t('watchlist.notificationMultiple', { count: notifications.length }), 'watch-alert');
        }
      }
    }
    prevWatchNewsRef.current = canonicalNews;
  }, [canonicalNews, watchItems, addToast, t]);

  const prevEventsRef = useRef([]);
  const [lifecycleMessages, setLifecycleMessages] = React.useState([]);
  useEffect(() => {
    const msgs = generateLifecycleMessages(activeNews, prevEventsRef.current);
    if (msgs.length > 0) setLifecycleMessages(msgs);
    prevEventsRef.current = activeNews;
  }, [activeNews]);

  const selectRegionAction = useUIStore((s) => s.selectRegion);
  const setLastRegionIso = useUIStore((s) => s.setLastRegionIso);
  const handleRegionSelect = useCallback((iso) => {
    selectRegionAction(iso);
    if (iso) setLastRegionIso(iso);
  }, [selectRegionAction, setLastRegionIso]);

  // Coverage drill-down state
  const [coverageDrillIso, setCoverageDrillIso] = useState(null);
  const handleCoverageCountryClick = useCallback((iso) => {
    setCoverageDrillIso((prev) => (prev === iso ? null : iso));
  }, []);
  const handleCloseCoverageDrill = useCallback(() => {
    setCoverageDrillIso(null);
  }, []);

  // Clear coverage drill when overlay changes away from coverage
  useEffect(() => {
    if (mapOverlay !== 'coverage') {
      setCoverageDrillIso(null);
    }
  }, [mapOverlay]);
  const handleStorySelect = useUIStore((s) => s.selectStory);
  const handleArcSelect = useUIStore((s) => s.selectArc);
  const handleClosePanel = useUIStore((s) => s.closePanel);
  const setMapMode = useUIStore((s) => s.setMapMode);
  const setDrawerMode = useUIStore((s) => s.setDrawerMode);
  const setShowExport = useUIStore((s) => s.setShowExport);

  const clearEntityFilter = useFilterStore((s) => s.clearEntityFilter);

  const handleRefresh = useCallback(() => {
    useNewsStore.getState().refresh(addToast);
  }, [addToast]);

  /* ── Save-dialog state (kept so Escape keyboard path matches tests) ── */
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  /* ── Keyboard-selected story index (for j/k navigation) ── */
  const [kbSelectedIdx, setKbSelectedIdx] = useState(-1);

  /** Story ID highlighted by keyboard j/k navigation. */
  const kbHighlightedStoryId = useMemo(() => {
    if (kbSelectedIdx >= 0 && kbSelectedIdx < activeNews.length) {
      return activeNews[kbSelectedIdx]?.id || null;
    }
    return null;
  }, [kbSelectedIdx, activeNews]);

  /* ── Keyboard: j/k navigation, Enter expand, s save, b bookmark ── */
  const { getSelectedIndex, setSelectedIndex, subscribe: subscribeKbIdx } = useKeyboardNavigation({
    items: activeNews,
    searchSelector: '.search-input, .header-search input',
    onSelect: useCallback((story) => {
      handleStorySelect(story);
    }, [handleStorySelect]),
    onBookmark: useCallback((story) => {
      useWatchStore.getState().addWatch('entity', story.title, story.title);
      addToast(t('watchlist.bookmarked', { title: story.title }), 'info');
    }, [addToast, t]),
    onSaveView: useCallback(() => {
      setShowSaveDialog(true);
    }, []),
    onEscape: useCallback(() => {
      if (showExport) { setShowExport(false); return true; }
      if (showSaveDialog) { setShowSaveDialog(false); return true; }
      if (selectedArc) { useUIStore.setState({ selectedArc: null }); return true; }
      if (panelOpen) { handleClosePanel(); return true; }
      if (filtersOpen) { setDrawerMode(null); return true; }
      return true;
    }, [showExport, showSaveDialog, selectedArc, panelOpen, filtersOpen, handleClosePanel, setDrawerMode, setShowExport]),
    onHelp: useCallback(() => {
      window.dispatchEvent(new CustomEvent('mapr:openShortcutHelp'));
    }, []),
  });

  // Mirror the ref-based selected index into React state via subscription so
  // the consumer re-renders on keypress instead of polling every 50ms.
  useEffect(() => {
    setKbSelectedIdx(getSelectedIndex());
    return subscribeKbIdx((idx) => setKbSelectedIdx(idx));
  }, [getSelectedIndex, subscribeKbIdx]);

  /* ── Keyboard: global shortcuts (r refresh, g globe, f filters) ── */
  useEffect(() => {
    const handleKeyDown = (e) => {
      const target = e.target;
      const editing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (editing) return;
      switch (e.key) {
        case 'r': handleRefresh(); break;
        case 'g': useUIStore.getState().toggleMapMode(); break;
        case 'f': useUIStore.getState().toggleDrawer('filters'); break;
        default: break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleRefresh]);

  /* ── URL sync ── */
  useEffect(() => {
    if (!urlInitRef.current) return;
    const qs = encodeViewToURL({
      filters: { searchQuery: debouncedSearch, minSeverity, minConfidence, dateWindow, sortMode, selectedRegion, entityFilter },
      mapState: { mapMode, mapOverlay },
    });
    const params = new URLSearchParams(qs);
    if (selectedStoryId) params.set('story', selectedStoryId);
    else params.delete('story');
    if (activeViewId) params.set('view', activeViewId);
    else params.delete('view');
    // Record this as the store-authored URL so the hydration effect can tell
    // it apart from an external (back/forward) URL change.
    lastSyncedQsRef.current = params.toString();
    setSearchParams(params, { replace: true });
  }, [debouncedSearch, minSeverity, minConfidence, dateWindow, sortMode, selectedRegion, entityFilter, mapMode, mapOverlay, selectedStoryId, activeViewId, setSearchParams]);

  const handleGlobeFallback = useCallback(() => {
    useUIStore.getState().setMapMode('flat');
  }, []);

  const { isMobile, isTablet } = useBreakpoint();
  const didForceFlatRef = useRef(false);
  const mapStageRef = useRef(null);
  useEffect(() => {
    if ((isMobile || isTablet) && mapMode === 'globe' && !didForceFlatRef.current) {
      didForceFlatRef.current = true;
      setMapMode('flat');
    }
  }, [isMobile, isTablet, mapMode, setMapMode]);

  return (
    <ErrorBoundary>
      <div className="map-stage" ref={mapStageRef}>
        <Suspense fallback={<MapLoadingFallback />}>
          <MapErrorBoundary mapMode={mapMode} onFallbackToFlat={handleGlobeFallback}>
            {mapMode === 'globe' ? (
              <Globe
                newsList={enrichedMapNews}
                regionSeverities={mapRegionSeverities}
                mapOverlay={mapOverlay}
                coverageStatusByIso={coverageStatusByIso}
                perCountryReliability={perCountryReliability}
                velocitySpikes={velocitySpikes}
                trackingPoints={trackingPoints}
                selectedRegion={selectedRegion}
                selectedStory={selectedStory}
                onRegionSelect={handleRegionSelect}
                onStorySelect={handleStorySelect}
                onArcSelect={handleArcSelect}
                onCoverageCountryClick={handleCoverageCountryClick}
              />
            ) : (
              <FlatMap
                newsList={enrichedMapNews}
                regionSeverities={mapRegionSeverities}
                mapOverlay={mapOverlay}
                coverageStatusByIso={coverageStatusByIso}
                perCountryReliability={perCountryReliability}
                velocitySpikes={velocitySpikes}
                trackingPoints={trackingPoints}
                selectedRegion={selectedRegion}
                selectedStory={selectedStory}
                onRegionSelect={handleRegionSelect}
                onStorySelect={handleStorySelect}
                onArcSelect={handleArcSelect}
                onCoverageCountryClick={handleCoverageCountryClick}
              />
            )}
          </MapErrorBoundary>
        </Suspense>
      </div>

      {/* Map controls (flat/globe toggle + legend) */}
      <div className="map-controls" role="group" aria-label="Map mode">
        <button
          type="button"
          data-active={mapMode === 'flat'}
          aria-pressed={mapMode === 'flat'}
          onClick={() => setMapMode('flat')}
          title="Flat map"
          aria-label="Flat map"
        >
          {/* flat icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
            <rect x="3" y="6" width="18" height="12"/><path d="M3 10h18M3 14h18M9 6v12M15 6v12"/>
          </svg>
        </button>
        <button
          type="button"
          data-active={mapMode === 'globe'}
          aria-pressed={mapMode === 'globe'}
          onClick={() => setMapMode('globe')}
          title="Globe"
          aria-label="Globe"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
            <circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>
          </svg>
        </button>
      </div>

      {mapOverlay && !coverageDrillIso && (
        <div className="map-corner br map-legend-corner">
          <MapOverlayLegend overlay={mapOverlay} />
        </div>
      )}

      {/* Drawer toggles (top-left of main area) */}
      <div className="drawer-toggles">
        <button
          type="button"
          className={`filter-toggle ${drawerMode === 'filters' ? 'is-active' : ''}`}
          onClick={() => setDrawerMode(drawerMode === 'filters' ? null : 'filters')}
          aria-pressed={drawerMode === 'filters'}
          aria-label={t('filters.label')}
        >
          <SlidersHorizontal size={12} aria-hidden /> {t('filters.label')}
        </button>
        <button
          type="button"
          className="collapse-all-toggle"
          onClick={toggleAllPanelsCollapsed}
          aria-pressed={panelsMostlyCollapsed}
          aria-label={panelsMostlyCollapsed ? t('panels.expandAll') : t('panels.collapseAll')}
        >
          {panelsMostlyCollapsed
            ? <ChevronsUpDown size={12} aria-hidden />
            : <ChevronsDownUp size={12} aria-hidden />}
          {' '}
          {panelsMostlyCollapsed ? t('panels.expandAll') : t('panels.collapseAll')}
        </button>
      </div>

      {/* Left mini-panels */}
      <div className="side-panels">
        <AnomalyPanel
          velocitySpikes={velocitySpikes}
          silenceEntries={silenceEntries}
          onRegionSelect={handleRegionSelect}
        />
        <WatchlistPanel onRegionSelect={handleRegionSelect} />
        <NarrativePanel
          newsList={activeNews}
          onRegionSelect={handleRegionSelect}
        />
      </div>

      <MapFloatingIcons />

      {entityFilter && (
        <div className="entity-filter-breadcrumb" role="status" aria-live="polite">
          <div className="entity-filter-breadcrumb-inner">
            {entityFilter.type === 'person' && <Users size={14} aria-hidden />}
            {entityFilter.type === 'organization' && <Building2 size={14} aria-hidden />}
            {entityFilter.type === 'location' && <MapPin size={14} aria-hidden />}
            <span className="entity-filter-breadcrumb-label">
              {t('entities.filterActive', { name: entityFilter.name })}
            </span>
            <span className="entity-filter-breadcrumb-count">
              {activeNews.length} {t('entities.relatedEvents')}
            </span>
            <button
              className="entity-filter-breadcrumb-clear"
              onClick={clearEntityFilter}
              aria-label={t('entities.clearFilter')}
            >
              <X size={14} aria-hidden />
              <span>{t('entities.clearFilter')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Time travel mode indicator */}
      {isTimeTravel && historicalState && (
        <div className="entity-filter-breadcrumb time-travel-banner" role="status" aria-live="polite" style={{ borderColor: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 8%, var(--bg-0))' }}>
          <div className="entity-filter-breadcrumb-inner">
            <Clock size={14} aria-hidden style={{ color: 'var(--amber)' }} />
            <span className="entity-filter-breadcrumb-label" style={{ color: 'var(--amber)' }}>
              {t('historicalQueries.timeTravelActive', 'TIME TRAVEL ACTIVE')}
            </span>
            <span className="entity-filter-breadcrumb-count mono" style={{ color: 'var(--ink-1)' }}>
              {activeNews.length || 0} {t('historicalQueries.eventsLoaded', 'events loaded')}
            </span>
            <button
              className="entity-filter-breadcrumb-clear"
              onClick={() => { useNewsStore.getState().exitHistoricalMode(); }}
              aria-label={t('historicalQueries.returnToLive')}
            >
              <X size={14} aria-hidden />
              <span>{t('historicalQueries.returnToLive')}</span>
            </button>
          </div>
        </div>
      )}

      <FilterDrawer
        isOpen={filtersOpen}
        defaultTab={drawerMode || 'filters'}
        onClose={() => setDrawerMode(null)}
        sourceCoverageAudit={sourceCoverageAudit}
        coverageMetrics={coverageMetrics}
        coverageDiagnostics={coverageDiagnostics}
        coverageTrends={coverageTrends}
        coverageHistory={coverageHistory}
        opsHealth={opsHealth}
        allNews={canonicalNews}
        filteredNews={activeNews}
        sourceHealth={sourceHealth}
        onRegionSelect={handleRegionSelect}
      />

      <NewsPanel
        isOpen={panelOpen && !selectedArc}
        regionIso={panelRegion}
        regionName={panelRegionName}
        regionStatus={panelRegionStatus}
        regionData={panelRegionData}
        coverageEntry={panelCoverageEntry}
        coverageTransitions={panelCoverageTransitions}
        regionHistory={regionCoverageHistory}
        regionBackfillStatus={panelBackfillStatus}
        regionSourcePlan={panelBackfillEntry?.sourcePlan || null}
        regionFeedChecks={panelBackfillEntry?.feedChecks || []}
        news={panelNews.length > 0 ? panelNews : activeNewsWithCredibility}
        allEvents={activeNewsWithCredibility}
        selectedStoryId={selectedStoryId}
        kbHighlightedStoryId={kbHighlightedStoryId}
        onStorySelect={handleStorySelect}
        onClose={handleClosePanel}
        dataSource={dataSource}
        sessionDiff={sessionDiff}
        velocitySpikes={velocitySpikes}
      />

      <EventTimeline
        events={activeNews}
        scrubTime={scrubTime}
        onScrub={useUIStore.getState().setScrubTime}
        onEventSelect={(story) => { navigate('/event/' + story.id); }}
        selectedStoryId={selectedStoryId}
      />

      <MobileSeverityChips allNews={canonicalNews} />
      <MobileTimelineSheet
        events={activeNews}
        scrubTime={scrubTime}
        onScrub={useUIStore.getState().setScrubTime}
        onEventSelect={(story) => { navigate('/event/' + story.id); }}
        selectedStoryId={selectedStoryId}
      />

      <div className={`intel-ticker ${panelOpen ? 'is-shifted' : ''}`} aria-hidden>
        <span className="intel-ticker-label">INTEL</span>
        <div className="intel-ticker-track">
          <div className="intel-ticker-scroll">
            {lifecycleMessages.map((msg, idx) => {
              const m = getSeverityMeta(msg.severity);
              return (
                <span key={`lc-${idx}`} className="intel-ticker-item">
                  <span className="intel-ticker-dot" style={{ background: m.accent }} />
                  <span className="intel-ticker-severity" style={{ color: m.accent }}>{msg.lifecycle}</span>
                  <span className="intel-ticker-title">{msg.text}</span>
                </span>
              );
            })}
            {activeNews.slice(0, 12).map((story) => {
              const m = getSeverityMeta(story.severity);
              return (
                <button
                  key={story.id}
                  type="button"
                  className={`intel-ticker-item ${selectedStoryId === story.id ? 'is-active' : ''}`}
                  onClick={() => { navigate('/event/' + story.id); }}
                >
                  <span className="intel-ticker-dot" style={{ background: m.accent }} />
                  <span className="intel-ticker-severity" style={{ color: m.accent }}>{m.label}</span>
                  <span className="intel-ticker-title">{story.title}</span>
                  <span className="intel-ticker-loc">{story.locality}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {dataSource === 'loading' && !liveNews && <DataLoadingOverlay />}

      {dataError && <DataErrorBanner onRetry={handleRefresh} />}
      {!dataError && dataSource === 'unavailable' && <DataErrorBanner onRetry={handleRefresh} />}

      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.type}`}>
              <span className="toast-dot" />{toast.message}
            </div>
          ))}
        </div>
      )}

      {/* Saved view not found banner */}
      {viewNotFound && (
        <div className="view-not-found-banner" role="alert">
          <span>{t('savedViews.viewNotFound', 'View not found — showing default state')}</span>
          <button
            type="button"
            className="view-not-found-dismiss"
            onClick={() => useUIStore.getState().setViewNotFound(false)}
            aria-label={t('savedViews.dismiss', 'Dismiss')}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Save view dialog */}
      <SaveViewDialog
        isOpen={showSaveDialog}
        onClose={(saved) => {
          setShowSaveDialog(false);
          if (saved) addToast(t('savedViews.viewSaved', 'View saved'), 'info');
        }}
        filterState={{
          searchQuery: debouncedSearch,
          minSeverity,
          minConfidence,
          dateWindow,
          sortMode,
          verificationFilter,
          sourceTypeFilter,
          languageFilter,
          accuracyMode,
          precisionFilter,
          hideAmplified,
          entityFilter,
        }}
        mapState={{ mapMode, mapOverlay }}
      />

      {/* Briefing export modal — admin-configurable feature gate */}
      {showExport && !canExportBriefings ? (
        <div className="mapr-export-gate" style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--bg-0) 85%, transparent)', backdropFilter: 'blur(4px)' }}>
          <UpgradePrompt feature="export" />
        </div>
      ) : showExport ? (
        <Suspense fallback={null}>
          <BriefingExportModal
          events={activeNews}
          filters={{
            dateWindow,
            minSeverity,
            minConfidence,
            sortMode,
            verificationFilter,
            sourceTypeFilter,
            languageFilter,
            entityFilter,
            hideAmplified,
            searchQuery: debouncedSearch,
            region: selectedRegion,
          }}
          mapContainerRef={mapStageRef}
        />
        </Suspense>
      ) : null}

      {/*
        Coverage legend (mapped onto the current overlay). Rendered hidden when no
        overlay-specific chip set would apply, so the main canvas stays clean.
        For coverage overlay: shows static legend OR interactive drill-down.
      */}
      {mapOverlay === 'coverage' && coverageDrillIso && (
        <div className={`map-corner br${mapOverlay === 'coverage' && coverageDrillIso ? ' map-corner-drill' : ''}`} aria-hidden={mapOverlay !== 'coverage' || !coverageDrillIso}>
          <CoverageDrilldown
            iso={coverageDrillIso}
            coverageEntry={coverageStatusByIso[coverageDrillIso] || null}
            coverageHistory={coverageHistory}
            sourceHealth={sourceHealth}
            onClose={handleCloseCoverageDrill}
          />
        </div>
      )}
    </ErrorBoundary>
  );
}

export default App;
