import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, Radio, AlertTriangle, Eye, X, Users, Building2, MapPin } from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
import MapErrorBoundary from './components/MapErrorBoundary';
import MapLoadingFallback from './components/MapLoadingFallback';
import DataLoadingOverlay from './components/DataLoadingOverlay';
import DataErrorBanner from './components/DataErrorBanner';
import Header from './components/Header';
import FilterDrawer from './components/FilterDrawer';
import NewsPanel from './components/NewsPanel';
import ArcPanel from './components/ArcPanel';
import AnomalyPanel from './components/AnomalyPanel';
import WatchlistPanel from './components/WatchlistPanel';
import BriefingExport from './components/BriefingExport';
import SaveViewDialog from './components/SaveViewDialog';
import EventTimeline from './components/EventTimeline';
import useNewsStore from './stores/newsStore';
import useFilterStore from './stores/filterStore';
import useUIStore from './stores/uiStore';
import useWatchStore from './stores/watchStore';
import usePanelState from './hooks/usePanelState';
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
  const { liveNews, dataSource, dataError, sourceHealth, coverageTrends, coverageHistory,
    opsHealth, velocitySpikes: hookVelocitySpikes, regionCoverageHistory,
    sessionDiff, snapshotHistory } = useNewsStore();
  const { searchQuery, debouncedSearch, dateWindow, minSeverity, minConfidence, sortMode,
    mapOverlay, showFlightsLayer, showVesselsLayer, verificationFilter, sourceTypeFilter, languageFilter, accuracyMode,
    precisionFilter, hideAmplified, entityFilter } = useFilterStore();
  const { mapMode, drawerMode, selectedRegion, selectedStoryId, selectedArc,
    showExport, scrubTime, toasts, savedViews, activeViewId } = useUIStore();
  const filtersOpen = drawerMode !== null;
  const addToast = useUIStore((s) => s.addToast);

  const { points: trackingPoints, vesselsDisabled } = useTrackingOverlayData(showFlightsLayer, showVesselsLayer);

  // Notify user when ship tracking is not configured
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

  /* ── RTL + lang attribute ── */
  useEffect(() => {
    document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  /* ── Data fetching (auto-refresh lifecycle) ── */
  useEffect(() => {
    useNewsStore.getState().startAutoRefresh(addToast);
    useNewsStore.getState().loadSnapshotHistory();
    return () => useNewsStore.getState().stopAutoRefresh();
  }, [addToast]);

  /* ── Save snapshot on data changes ── */
  const prevLiveNewsRef = useRef(liveNews);
  useEffect(() => {
    if (liveNews && liveNews !== prevLiveNewsRef.current) {
      useNewsStore.getState().saveCurrentSnapshot();
    }
    prevLiveNewsRef.current = liveNews;
  }, [liveNews]);

  /* ── Velocity spike toast notifications ── */
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

  /* ── URL state: hydrate on mount ── */
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
  }), [minSeverity, minConfidence, dateFloor, accuracyMode, verificationFilter, sourceTypeFilter, languageFilter, precisionFilter, hideAmplified]);

  const activeNews = useMemo(() => {
    let pool = canonicalNews;
    if (scrubTime != null) {
      pool = pool.filter((s) => {
        const ts = s.firstSeenAt ? new Date(s.firstSeenAt).getTime() : 0;
        return ts <= scrubTime;
      });
    }
    let filtered = pool.filter((s) => storyMatchesFilters(s, filterParams));
    // Apply search keyword filter
    const q = (debouncedSearch || '').trim().toLowerCase();
    if (q.length >= 2) {
      filtered = filtered.filter((s) => {
        const haystack = [s.title, s.summary, s.locality, s.category, s.region]
          .filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }
    // Apply entity filter — show only events involving the selected entity
    if (entityFilter) {
      const entityEvents = new Set(
        getRelatedEvents(filtered, entityFilter.name, entityFilter.type).map((e) => e.id)
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
  const coverageDiagnostics = useMemo(() => buildCoverageDiagnostics(coverageMetrics, sourceHealth), [coverageMetrics, sourceHealth]);
  const sourceCoverageAudit = useMemo(() => buildSourceCoverageAudit(coverageDiagnostics), [coverageDiagnostics]);
  const coverageStatusByIso = coverageDiagnostics.byIso;

  /* ── Silence detection ── */
  const silenceEntries = useMemo(() => computeSilenceEntries({
    articles: activeNews,
    regionSeverities,
    coverageStatusByIso,
    velocitySpikes,
  }), [activeNews, regionSeverities, coverageStatusByIso, velocitySpikes]);

  /* ── Anomaly panel state ── */
  const [anomalyPanelOpen, setAnomalyPanelOpen] = React.useState(false);
  const anomalyCount = velocitySpikes.length + silenceEntries.length;

  /* ── Watchlist panel state ── */
  const [watchlistPanelOpen, setWatchlistPanelOpen] = React.useState(false);
  const watchItems = useWatchStore((s) => s.watchItems);
  const watchNotifications = useWatchStore((s) => s.notifications);
  const watchNotificationCount = watchNotifications.reduce((sum, n) => sum + n.newCount, 0);

  /* ── Watchlist: check new articles on data change or watchlist change ── */
  // Use canonicalNews (full unfiltered dataset) so watched items outside
  // the current filter view still trigger notifications.
  const prevWatchNewsRef = useRef(null);
  useEffect(() => {
    if (!canonicalNews?.length || !watchItems.length) return;

    const isNewData = canonicalNews !== prevWatchNewsRef.current;
    useWatchStore.getState().checkNewArticles(canonicalNews);

    // Only show toast notifications when new DATA arrives (not when adding items)
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

  /* ── Lifecycle messages ── */
  const prevEventsRef = useRef([]);
  const [lifecycleMessages, setLifecycleMessages] = React.useState([]);
  useEffect(() => {
    const msgs = generateLifecycleMessages(activeNews, prevEventsRef.current);
    if (msgs.length > 0) setLifecycleMessages(msgs);
    prevEventsRef.current = activeNews;
  }, [activeNews]);

  /* ── Panel + map derived state (hook) ── */
  const {
    selectedStory, panelRegion, panelOpen, panelBackfillEntry, panelNews,
    panelRegionData, panelRegionName, panelRegionStatus, panelCoverageEntry,
    panelBackfillStatus, panelCoverageTransitions, mapNewsList, mapRegionSeverities,
  } = usePanelState({
    activeNews, filterParams, sortMode, regionSeverities, coverageStatusByIso,
    coverageHistory, dataSource, coverageDiagnostics,
  });

  /* ── Counts + store actions ── */
  const activeRegions = coverageMetrics.coveredCountries;
  const verifiedRegions = coverageMetrics.verifiedCountries;
  const criticalCount = activeNews.filter((s) => s.severity >= 85).length;
  const handleRegionSelect = useUIStore((s) => s.selectRegion);
  const handleStorySelect = useUIStore((s) => s.selectStory);
  const handleArcSelect = useUIStore((s) => s.selectArc);
  const handleClosePanel = useUIStore((s) => s.closePanel);
  const handleSearchSelect = useUIStore((s) => s.handleSearchSelect);
  const setMapMode = useUIStore((s) => s.setMapMode);
  const setDrawerMode = useUIStore((s) => s.setDrawerMode);
  const setShowExport = useUIStore((s) => s.setShowExport);

  const clearEntityFilter = useFilterStore((s) => s.clearEntityFilter);

  const handleRefresh = useCallback(() => {
    useNewsStore.getState().refresh(addToast);
  }, [addToast]);

  /* ── Saved views ── */
  const [showSaveDialog, setShowSaveDialog] = React.useState(false);

  const handleSaveView = useCallback(() => {
    setShowSaveDialog(true);
  }, []);

  const handleConfirmSaveView = useCallback((name) => {
    useUIStore.getState().saveCurrentView(
      name,
      { searchQuery, minSeverity, minConfidence, dateWindow, sortMode, selectedRegion,
        verificationFilter, sourceTypeFilter, languageFilter, accuracyMode, precisionFilter, hideAmplified },
      { mapMode, mapOverlay },
    );
    setShowSaveDialog(false);
    addToast(`View "${name}" saved`, 'info');
  }, [searchQuery, minSeverity, minConfidence, dateWindow, sortMode, selectedRegion,
    verificationFilter, sourceTypeFilter, languageFilter, accuracyMode, precisionFilter,
    hideAmplified, mapMode, mapOverlay, addToast]);

  const handleSelectView = useCallback((view) => {
    useUIStore.getState().selectView(view);
    useFilterStore.getState().applyView(view);
    if (view.filters?.selectedRegion !== undefined) useUIStore.setState({ selectedRegion: view.filters.selectedRegion });
    if (view.mapState?.mapMode !== undefined) useUIStore.setState({ mapMode: view.mapState.mapMode });
  }, []);

  const handleDeleteView = useUIStore((s) => s.deleteView);
  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Allow Escape to work even when focused on inputs (for closing panels)
      if (e.key !== 'Escape' && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
      switch (e.key) {
        case 'r': handleRefresh(); break;
        case '/': e.preventDefault(); document.querySelector('.search-input')?.focus(); break;
        case 'Escape':
          if (showExport) { setShowExport(false); break; }
          if (showSaveDialog) { setShowSaveDialog(false); break; }
          if (selectedArc) { useUIStore.setState({ selectedArc: null }); break; }
          if (anomalyPanelOpen) { setAnomalyPanelOpen(false); break; }
          if (watchlistPanelOpen) { setWatchlistPanelOpen(false); break; }
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
  }, [panelOpen, filtersOpen, handleRefresh, handleClosePanel, setDrawerMode,
    showExport, setShowExport, showSaveDialog, selectedArc, anomalyPanelOpen, watchlistPanelOpen]);

  /* ── URL sync ── */
  useEffect(() => {
    if (!urlInitRef.current) return;
    const qs = encodeViewToURL({
      filters: { searchQuery: debouncedSearch, minSeverity, minConfidence, dateWindow, sortMode, selectedRegion },
      mapState: { mapMode, mapOverlay },
    });
    const params = new URLSearchParams(qs);
    if (selectedStoryId) params.set('story', selectedStoryId);
    setSearchParams(params, { replace: true });
  }, [debouncedSearch, minSeverity, minConfidence, dateWindow, sortMode, selectedRegion, mapMode, mapOverlay, selectedStoryId, setSearchParams]);

  /* ── Globe fallback ── */
  const handleGlobeFallback = useCallback(() => {
    useUIStore.getState().setMapMode('flat');
  }, []);

  /* ── Render ── */
  return (
    <ErrorBoundary>
    <div className="app">
      <Suspense fallback={<MapLoadingFallback />}>
        <MapErrorBoundary mapMode={mapMode} onFallbackToFlat={handleGlobeFallback}>
          {mapMode === 'globe' ? (
            <Globe newsList={mapNewsList} regionSeverities={mapRegionSeverities} mapOverlay={mapOverlay}
              coverageStatusByIso={coverageStatusByIso} velocitySpikes={velocitySpikes}
              trackingPoints={trackingPoints}
              selectedRegion={selectedRegion} selectedStory={selectedStory}
              onRegionSelect={handleRegionSelect} onStorySelect={handleStorySelect} onArcSelect={handleArcSelect} />
          ) : (
            <FlatMap newsList={mapNewsList} regionSeverities={mapRegionSeverities} mapOverlay={mapOverlay}
              coverageStatusByIso={coverageStatusByIso} velocitySpikes={velocitySpikes}
              trackingPoints={trackingPoints}
              selectedRegion={selectedRegion} selectedStory={selectedStory}
              onRegionSelect={handleRegionSelect} onStorySelect={handleStorySelect} onArcSelect={handleArcSelect} />
          )}
        </MapErrorBoundary>
      </Suspense>

      <Header searchQuery={searchQuery} debouncedSearch={debouncedSearch}
        onSearchChange={useFilterStore.getState().setSearchQuery} onSearchSelect={handleSearchSelect}
        newsList={activeNews} regionSeverities={regionSeverities}
        storyCount={activeNews.length} regionCount={activeRegions} verifiedCount={verifiedRegions}
        criticalCount={criticalCount} mapMode={mapMode} onMapModeChange={setMapMode}
        mapOverlay={mapOverlay} onMapOverlayChange={useFilterStore.getState().setMapOverlay}
        dataSource={dataSource} onRefresh={handleRefresh}
        backendStatus={opsHealth?.status || sourceHealth?.backend?.status || null}
        savedViews={savedViews} activeViewId={activeViewId}
        onSaveView={handleSaveView} onSelectView={handleSelectView} onDeleteView={handleDeleteView}
        sessionDiff={sessionDiff} onExport={() => setShowExport(true)}>
        <div className="legend">
          <span className="legend-label">{t(`legend.${mapOverlay}`)}</span>
          <div className="legend-items">
            {mapOverlay === 'severity'
              ? ['critical', 'elevated', 'watch', 'low'].map((key) => (
                <div key={key} className="legend-item">
                  <span className="legend-dot" style={{ background: `var(--${key})` }} />{t(`legend.${key}`)}
                </div>))
              : mapOverlay === 'geopolitical'
              ? [
                { key: 'low', color: 'rgba(0, 212, 255, 0.8)', label: t('legend.geoLow') },
                { key: 'medium', color: 'rgba(255, 170, 0, 0.8)', label: t('legend.geoMedium') },
                { key: 'high', color: 'rgba(255, 85, 85, 0.8)', label: t('legend.geoHigh') },
              ].map(({ key, color, label }) => (
                <div key={key} className="legend-item">
                  <span className="legend-dot" style={{ background: color }} />{label}
                </div>))
              : COVERAGE_STATUS_ORDER.map((status) => {
                const meta = getCoverageMeta(status);
                return (<div key={status} className="legend-item">
                  <span className="legend-dot" style={{ background: meta.accent }} />{t(`coverageStatus.${meta.labelKey}`)}
                </div>);
              })}
          </div>
          <span className="legend-credit">crafted by <strong>tor</strong></span>
        </div>
      </Header>

      <div className="drawer-toggles">
        <button className={`filter-toggle ${drawerMode === 'filters' ? 'is-active' : ''}`}
          onClick={() => setDrawerMode(drawerMode === 'filters' ? null : 'filters')}>
          <SlidersHorizontal size={12} /> {t('filters.label')}
        </button>
        <button className={`filter-toggle ${drawerMode === 'intel' ? 'is-active' : ''}`}
          onClick={() => setDrawerMode(drawerMode === 'intel' ? null : 'intel')}>
          <Radio size={12} /> INTEL
        </button>
        <button className={`anomaly-toggle ${anomalyPanelOpen ? 'is-active' : ''}`}
          onClick={() => setAnomalyPanelOpen((v) => !v)}
          aria-pressed={anomalyPanelOpen}>
          <AlertTriangle size={12} /> {t('anomaly.toggleLabel')}
          {anomalyCount > 0 && <span className="anomaly-toggle-count">{anomalyCount}</span>}
        </button>
        <button className={`watchlist-toggle ${watchlistPanelOpen ? 'is-active' : ''}`}
          onClick={() => { setWatchlistPanelOpen((v) => !v); useWatchStore.getState().clearNotifications(); }}
          aria-pressed={watchlistPanelOpen}>
          <Eye size={12} /> {t('watchlist.toggleLabel')}
          {watchItems.length > 0 && <span className="watchlist-toggle-count">{watchItems.length}</span>}
          {watchNotificationCount > 0 && <span className="watchlist-toggle-alert">+{watchNotificationCount}</span>}
        </button>
      </div>

      {entityFilter && (
        <div className="entity-filter-breadcrumb" role="status" aria-live="polite">
          <div className="entity-filter-breadcrumb-inner">
            {entityFilter.type === 'person' && <Users size={14} />}
            {entityFilter.type === 'organization' && <Building2 size={14} />}
            {entityFilter.type === 'location' && <MapPin size={14} />}
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
              <X size={14} />
              <span>{t('entities.clearFilter')}</span>
            </button>
          </div>
        </div>
      )}

      <FilterDrawer
        isOpen={filtersOpen} defaultTab={drawerMode || 'filters'} onClose={() => setDrawerMode(null)}
        sourceCoverageAudit={sourceCoverageAudit} coverageMetrics={coverageMetrics}
        coverageDiagnostics={coverageDiagnostics} coverageTrends={coverageTrends}
        coverageHistory={coverageHistory} opsHealth={opsHealth}
        allNews={canonicalNews} filteredNews={activeNews} sourceHealth={sourceHealth}
        onRegionSelect={handleRegionSelect} />

      <EventTimeline events={activeNews} snapshotHistory={snapshotHistory}
        scrubTime={scrubTime} onScrub={useUIStore.getState().setScrubTime}
        onEventSelect={handleStorySelect} selectedStoryId={selectedStoryId} />

      <div className={`intel-ticker ${panelOpen ? 'is-shifted' : ''}`}>
        <span className="intel-ticker-label">INTEL</span>
        <div className="intel-ticker-track"><div className="intel-ticker-scroll">
          {lifecycleMessages.map((msg, idx) => {
            const m = getSeverityMeta(msg.severity);
            return (<span key={`lc-${idx}`} className="intel-ticker-item intel-ticker-lifecycle">
              <span className="intel-ticker-dot" style={{ background: m.accent }} />
              <span className="intel-ticker-severity" style={{ color: m.accent }}>{msg.lifecycle}</span>
              <span className="intel-ticker-title">{msg.text}</span>
            </span>);
          })}
          {activeNews.slice(0, 12).map((story) => {
            const m = getSeverityMeta(story.severity);
            return (<button key={story.id} type="button" className={`intel-ticker-item ${selectedStoryId === story.id ? 'is-active' : ''}`}
              onClick={() => handleStorySelect(story)}>
              <span className="intel-ticker-dot" style={{ background: m.accent }} />
              <span className="intel-ticker-severity" style={{ color: m.accent }}>{m.label}</span>
              <span className="intel-ticker-title">{story.title}</span>
              <span className="intel-ticker-loc">{story.locality}</span>
            </button>);
          })}
        </div></div>
      </div>

      {selectedArc && (
        <ArcPanel arc={selectedArc} newsList={activeNews}
          onStorySelect={handleStorySelect} onRegionSelect={handleRegionSelect}
          onClose={() => useUIStore.setState({ selectedArc: null })} />
      )}

      <AnomalyPanel
        velocitySpikes={velocitySpikes}
        silenceEntries={silenceEntries}
        isOpen={anomalyPanelOpen}
        onClose={() => setAnomalyPanelOpen(false)}
        onRegionSelect={handleRegionSelect}
      />

      <WatchlistPanel
        isOpen={watchlistPanelOpen}
        onClose={() => setWatchlistPanelOpen(false)}
        onRegionSelect={handleRegionSelect}
      />

      <NewsPanel key={panelRegion || 'closed'} isOpen={panelOpen && !selectedArc}
        regionName={panelRegionName} regionStatus={panelRegionStatus} regionData={panelRegionData}
        coverageEntry={panelCoverageEntry} coverageTransitions={panelCoverageTransitions}
        regionHistory={regionCoverageHistory} regionBackfillStatus={panelBackfillStatus}
        regionSourcePlan={panelBackfillEntry?.sourcePlan || null} regionFeedChecks={panelBackfillEntry?.feedChecks || []}
        news={panelNews} allEvents={activeNews} selectedStoryId={selectedStoryId} onStorySelect={handleStorySelect}
        onClose={handleClosePanel} sessionDiff={sessionDiff} velocitySpikes={velocitySpikes} />

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

      {showSaveDialog && (
        <SaveViewDialog
          onSave={handleConfirmSaveView}
          onClose={() => setShowSaveDialog(false)}
        />
      )}

      {showExport && (
        <BriefingExport events={activeNews}
          filters={{ minSeverity, minConfidence, dateWindow, sortMode, mapOverlay }}
          onClose={() => setShowExport(false)} />
      )}

    </div>
    </ErrorBoundary>
  );
}

export default App;
