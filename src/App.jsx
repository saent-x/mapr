import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, ChevronsDownUp, ChevronsUpDown, X, Users, Building2, MapPin } from 'lucide-react';
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
import MobileIntelSheet from './components/MobileIntelSheet';
import MapFloatingIcons from './components/MapFloatingIcons';
import EventTimeline from './components/EventTimeline';
import useNewsStore from './stores/newsStore';
import useFilterStore from './stores/filterStore';
import useUIStore from './stores/uiStore';
import useWatchStore from './stores/watchStore';
import usePanelState from './hooks/usePanelState';
import useBreakpoint from './hooks/useBreakpoint';
import useBriefingStream from './hooks/useBriefingStream';
import useTrackingOverlayData from './hooks/useTrackingOverlayData';
import { canonicalizeArticles, calculateCoverageMetrics } from './utils/newsPipeline';
import { COVERAGE_STATUS_ORDER, getCoverageMeta } from './utils/coverageMeta';
import { buildCoverageDiagnostics } from './utils/coverageDiagnostics';
import { buildSourceCoverageAudit } from './utils/sourceCoverage';
import { sortStories, storyMatchesFilters } from './utils/storyFilters';
import { getRelatedEvents } from './utils/entityGraph';
import { isoToCountry } from './utils/geocoder';
import { generateLifecycleMessages } from './utils/lifecycleMessages';
import { encodeViewToURL } from './utils/viewManager';
import { computeSilenceEntries } from './utils/anomalyUtils';
import { getMockNews, calculateRegionSeverity, getSeverityMeta, resolveDateFloor } from './utils/mockData';

const Globe = lazy(() => import('./components/Globe'));
const FlatMap = lazy(() => import('./components/FlatMap'));

function App() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  /* ── stores ── */
  const {
    liveNews, dataSource, dataError, sourceHealth, coverageTrends, coverageHistory,
    opsHealth, velocitySpikes: hookVelocitySpikes, regionCoverageHistory,
    sessionDiff,
  } = useNewsStore();
  const {
    searchQuery, debouncedSearch, dateWindow, minSeverity, minConfidence, sortMode,
    mapOverlay, showFlightsLayer, showVesselsLayer, verificationFilter, sourceTypeFilter,
    languageFilter, accuracyMode, precisionFilter, hideAmplified, entityFilter,
  } = useFilterStore();
  const {
    mapMode, drawerMode, selectedRegion, selectedStoryId, selectedArc,
    showExport, scrubTime, toasts,
  } = useUIStore();

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

  useEffect(() => {
    useNewsStore.getState().startAutoRefresh(addToast);
    useNewsStore.getState().loadSnapshotHistory();
    return () => useNewsStore.getState().stopAutoRefresh();
  }, [addToast]);

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
  useEffect(() => {
    if (urlInitRef.current) return;
    urlInitRef.current = true;
    const { filters, mapState } = useFilterStore.getState().initFromURL(searchParams);
    useUIStore.getState().initFromURL(searchParams, mapState);
    if (filters.selectedRegion) useUIStore.setState({ selectedRegion: filters.selectedRegion });
  }, [searchParams]);

  /* ── Computed data ── */
  const baseArticles = useMemo(() => {
    if (dataSource !== 'live') return liveNews || getMockNews();
    return liveNews || [];
  }, [dataSource, liveNews]);

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

  /* ── Derived map/panel state ── */
  const {
    selectedStory, panelRegion, panelOpen, panelBackfillEntry, panelNews,
    panelRegionData, panelRegionName, panelRegionStatus, panelCoverageEntry,
    panelBackfillStatus, panelCoverageTransitions, mapNewsList, mapRegionSeverities,
  } = usePanelState({
    activeNews, filterParams, sortMode, regionSeverities, coverageStatusByIso,
    coverageHistory, dataSource, coverageDiagnostics,
  });

  const selectRegionAction = useUIStore((s) => s.selectRegion);
  const setLastRegionIso = useUIStore((s) => s.setLastRegionIso);
  const handleRegionSelect = useCallback((iso) => {
    selectRegionAction(iso);
    if (iso) setLastRegionIso(iso);
  }, [selectRegionAction, setLastRegionIso]);
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
  const [showSaveDialog, setShowSaveDialog] = React.useState(false);

  /* ── Keyboard ── */
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== 'Escape' && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
      switch (e.key) {
        case 'r': handleRefresh(); break;
        case '/': e.preventDefault(); document.querySelector('.search-input')?.focus(); break;
        case 'Escape':
          if (showExport) { setShowExport(false); break; }
          if (showSaveDialog) { setShowSaveDialog(false); break; }
          if (selectedArc) { useUIStore.setState({ selectedArc: null }); break; }
          if (panelOpen) { handleClosePanel(); break; }
          if (filtersOpen) { setDrawerMode(null); break; }
          break;
        case 'g': useUIStore.getState().toggleMapMode(); break;
        case 'f': useUIStore.getState().toggleDrawer('filters'); break;
        default: break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    panelOpen, filtersOpen, handleRefresh, handleClosePanel, setDrawerMode,
    showExport, setShowExport, showSaveDialog, selectedArc,
  ]);

  /* ── URL sync ── */
  useEffect(() => {
    if (!urlInitRef.current) return;
    const qs = encodeViewToURL({
      filters: { searchQuery: debouncedSearch, minSeverity, minConfidence, dateWindow, sortMode, selectedRegion },
      mapState: { mapMode, mapOverlay },
    });
    const params = new URLSearchParams(qs);
    if (selectedStoryId) params.set('story', selectedStoryId);
    else params.delete('story');
    setSearchParams(params, { replace: true });
  }, [debouncedSearch, minSeverity, minConfidence, dateWindow, sortMode, selectedRegion, mapMode, mapOverlay, selectedStoryId, setSearchParams]);

  const handleGlobeFallback = useCallback(() => {
    useUIStore.getState().setMapMode('flat');
  }, []);

  const { isMobile, isTablet } = useBreakpoint();
  const didForceFlatRef = useRef(false);
  useEffect(() => {
    if ((isMobile || isTablet) && mapMode === 'globe' && !didForceFlatRef.current) {
      didForceFlatRef.current = true;
      setMapMode('flat');
    }
  }, [isMobile, isTablet, mapMode, setMapMode]);

  return (
    <ErrorBoundary>
      <div className="map-stage">
        <Suspense fallback={<MapLoadingFallback />}>
          <MapErrorBoundary mapMode={mapMode} onFallbackToFlat={handleGlobeFallback}>
            {mapMode === 'globe' ? (
              <Globe
                newsList={mapNewsList}
                regionSeverities={mapRegionSeverities}
                mapOverlay={mapOverlay}
                coverageStatusByIso={coverageStatusByIso}
                velocitySpikes={velocitySpikes}
                trackingPoints={trackingPoints}
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
                trackingPoints={trackingPoints}
                selectedRegion={selectedRegion}
                selectedStory={selectedStory}
                onRegionSelect={handleRegionSelect}
                onStorySelect={handleStorySelect}
                onArcSelect={handleArcSelect}
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

      <MobileIntelSheet
        velocitySpikes={velocitySpikes}
        silenceEntries={silenceEntries}
        newsList={activeNews}
        onRegionSelect={handleRegionSelect}
      />

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
        key={panelRegion || 'closed'}
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
        news={panelNews.length > 0 ? panelNews : activeNews}
        allEvents={activeNews}
        selectedStoryId={selectedStoryId}
        onStorySelect={handleStorySelect}
        onClose={handleClosePanel}
        sessionDiff={sessionDiff}
        velocitySpikes={velocitySpikes}
      />

      <EventTimeline
        events={activeNews}
        scrubTime={scrubTime}
        onScrub={useUIStore.getState().setScrubTime}
        onEventSelect={handleStorySelect}
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
                  onClick={() => handleStorySelect(story)}
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

      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.type}`}>
              <span className="toast-dot" />{toast.message}
            </div>
          ))}
        </div>
      )}

      {/*
        Coverage legend (mapped onto the current overlay). Rendered hidden when no
        overlay-specific chip set would apply, so the main canvas stays clean.
      */}
      {mapOverlay && (
        <div className="map-corner br" aria-hidden>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="micro">{t(`legend.${mapOverlay}`)}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {mapOverlay === 'severity'
                ? ['critical', 'elevated', 'watch', 'low'].map((key) => (
                    <span key={key} className="legend-item">
                      <span className="legend-dot" style={{ background: `var(--${key})` }} />
                      {t(`legend.${key}`)}
                    </span>
                  ))
                : mapOverlay === 'geopolitical'
                  ? [
                      { key: 'low', color: 'rgba(0, 212, 255, 0.8)', label: t('legend.geoLow') },
                      { key: 'medium', color: 'rgba(255, 170, 0, 0.8)', label: t('legend.geoMedium') },
                      { key: 'high', color: 'rgba(255, 85, 85, 0.8)', label: t('legend.geoHigh') },
                    ].map(({ key, color, label }) => (
                      <span key={key} className="legend-item">
                        <span className="legend-dot" style={{ background: color }} />
                        {label}
                      </span>
                    ))
                  : COVERAGE_STATUS_ORDER.map((status) => {
                      const meta = getCoverageMeta(status);
                      return (
                        <span key={status} className="legend-item">
                          <span className="legend-dot" style={{ background: meta.accent }} />
                          {t(`coverageStatus.${meta.labelKey}`)}
                        </span>
                      );
                    })}
            </div>
          </div>
        </div>
      )}
    </ErrorBoundary>
  );
}

export default App;
