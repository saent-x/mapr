import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
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
import useNewsStore from './stores/newsStore';
import useFilterStore from './stores/filterStore';
import useUIStore from './stores/uiStore';
import { canonicalizeArticles, calculateCoverageMetrics } from './utils/newsPipeline';
import { COVERAGE_STATUS_ORDER, getCoverageMeta } from './utils/coverageMeta';
import { buildCoverageDiagnostics } from './utils/coverageDiagnostics';
import { mergeStoryLists } from './utils/aiState';
import { buildSourceCoverageAudit } from './utils/sourceCoverage';
import { sortStories, storyMatchesFilters } from './utils/storyFilters';
import { isoToCountry } from './utils/geocoder';
import { generateLifecycleMessages } from './utils/lifecycleMessages';
import { encodeViewToURL } from './utils/viewManager';
import { MOCK_NEWS, calculateRegionSeverity, getSeverityMeta, resolveDateFloor } from './utils/mockData';

const Globe = lazy(() => import('./components/Globe'));
const FlatMap = lazy(() => import('./components/FlatMap'));

function App() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  /* ── stores ── */
  const { liveNews, dataSource, dataError, sourceHealth, coverageTrends, coverageHistory,
    opsHealth, velocitySpikes: hookVelocitySpikes, regionBackfills, regionCoverageHistory,
    sessionDiff, snapshotHistory } = useNewsStore();
  const { searchQuery, debouncedSearch, dateWindow, minSeverity, minConfidence, sortMode,
    mapOverlay, verificationFilter, sourceTypeFilter, languageFilter, accuracyMode,
    precisionFilter, hideAmplified } = useFilterStore();
  const { mapMode, drawerMode, selectedRegion, selectedStoryId, selectedArc,
    showExport, scrubTime, toasts, savedViews, activeViewId } = useUIStore();
  const filtersOpen = drawerMode !== null;
  const addToast = useUIStore((s) => s.addToast);

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
    if (dataSource !== 'live') return liveNews || MOCK_NEWS;
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
    return sortStories(pool.filter((s) => storyMatchesFilters(s, filterParams)), sortMode);
  }, [canonicalNews, scrubTime, filterParams, sortMode]);

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

  /* ── Lifecycle messages ── */
  const prevEventsRef = useRef([]);
  const [lifecycleMessages, setLifecycleMessages] = React.useState([]);
  useEffect(() => {
    const msgs = generateLifecycleMessages(activeNews, prevEventsRef.current);
    if (msgs.length > 0) setLifecycleMessages(msgs);
    prevEventsRef.current = activeNews;
  }, [activeNews]);

  /* ── Panel-derived state ── */
  const selectedStory = activeNews.find((s) => s.id === selectedStoryId)
    ?? (selectedRegion ? (regionBackfills[selectedRegion]?.events || []).find((s) => s.id === selectedStoryId) : null) ?? null;
  const panelRegion = selectedRegion || selectedStory?.isoA2 || null;
  const panelOpen = Boolean(panelRegion);
  const panelBackfillEntry = panelRegion ? regionBackfills[panelRegion] || null : null;
  const panelBackfillStories = useMemo(() => (
    panelRegion ? sortStories((panelBackfillEntry?.events || []).filter((s) => storyMatchesFilters(s, filterParams)), sortMode) : []
  ), [panelRegion, panelBackfillEntry, filterParams, sortMode]);
  const panelLiveNews = panelRegion ? activeNews.filter((s) => s.isoA2 === panelRegion) : [];
  const panelNews = panelLiveNews.length > 0 ? panelLiveNews : panelBackfillStories;
  const panelRegionData = useMemo(() => (
    panelRegion ? (regionSeverities[panelRegion] || calculateRegionSeverity(panelNews)[panelRegion] || null) : null
  ), [panelNews, panelRegion, regionSeverities]);
  const panelRegionName = panelRegion
    ? (coverageStatusByIso[panelRegion]?.region || panelRegionData?.region || selectedStory?.region
      || panelBackfillEntry?.region || isoToCountry(panelRegion) || panelRegion) : null;
  const panelRegionStatus = panelRegion ? coverageStatusByIso[panelRegion]?.status || null : null;
  const panelCoverageEntry = panelRegion ? coverageStatusByIso[panelRegion] || null : null;
  const panelBackfillStatus = panelBackfillEntry?.status || 'idle';
  const panelCoverageTransitions = useMemo(() => (
    panelRegion ? (coverageHistory?.transitions || []).filter((e) => e.iso === panelRegion).slice(0, 4) : []
  ), [coverageHistory, panelRegion]);

  /* ── Map data ── */
  const mapArticles = useMemo(() => baseArticles.filter((a) => a.coordinates && a.isoA2), [baseArticles]);
  const mapNewsList = useMemo(() => {
    const base = mapArticles.length > 0 ? mapArticles : activeNews;
    return (!panelRegion || panelNews.length === 0) ? base : mergeStoryLists(base, panelNews);
  }, [mapArticles, activeNews, panelNews, panelRegion]);
  const mapRegionSeverities = useMemo(() => (
    (!panelRegion || !panelRegionData || regionSeverities[panelRegion]) ? regionSeverities : { ...regionSeverities, [panelRegion]: panelRegionData }
  ), [panelRegion, panelRegionData, regionSeverities]);

  /* ── Region coverage + backfill effects ── */
  useEffect(() => {
    useNewsStore.getState().fetchRegionCoverage(panelRegion);
  }, [panelRegion]);

  useEffect(() => {
    if (!panelRegion || dataSource !== 'live' || panelLiveNews.length > 0) return;
    if (['loading', 'done', 'empty'].includes(panelBackfillStatus)) return;
    const regionName = panelRegionName || isoToCountry(panelRegion) || panelRegion;
    useNewsStore.getState().fetchRegionBackfill(panelRegion, regionName, { sortMode, coverageDiagnostics });
  }, [panelRegion, dataSource, panelLiveNews.length, panelBackfillStatus, panelRegionName, sortMode, coverageDiagnostics]);

  /* ── Ensure selectedStoryId stays valid ── */
  useEffect(() => {
    const available = selectedRegion
      ? mergeStoryLists(activeNews.filter((s) => s.isoA2 === selectedRegion), panelBackfillStories)
      : activeNews;
    if (selectedStoryId && !available.some((s) => s.id === selectedStoryId)) {
      useUIStore.setState({ selectedStoryId: null });
    }
  }, [activeNews, selectedRegion, panelBackfillStories, selectedStoryId]);

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

  const handleRefresh = useCallback(() => {
    useNewsStore.getState().refresh(addToast);
  }, [addToast]);

  /* ── Saved views ── */
  const handleSaveView = useCallback(() => {
    const name = window.prompt('Name this view:');
    if (!name?.trim()) return;
    useUIStore.getState().saveCurrentView(
      name.trim(),
      { searchQuery, minSeverity, minConfidence, dateWindow, sortMode, selectedRegion },
      { mapMode, mapOverlay },
    );
  }, [searchQuery, minSeverity, minConfidence, dateWindow, sortMode, selectedRegion, mapMode, mapOverlay]);

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
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      switch (e.key) {
        case 'r': handleRefresh(); break;
        case '/': e.preventDefault(); document.querySelector('.search-input')?.focus(); break;
        case 'Escape':
          if (panelOpen) handleClosePanel();
          else if (filtersOpen) setDrawerMode(null);
          break;
        case 'g': useUIStore.getState().toggleMapMode(); break;
        case 'f': useUIStore.getState().toggleDrawer('filters'); break;
        default: break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [panelOpen, filtersOpen, handleRefresh, handleClosePanel, setDrawerMode]);

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

  /* ── Render ── */
  return (
    <ErrorBoundary>
    <div className="app">
      <Suspense fallback={null}>
        {mapMode === 'globe' ? (
          <Globe newsList={mapNewsList} regionSeverities={mapRegionSeverities} mapOverlay={mapOverlay}
            coverageStatusByIso={coverageStatusByIso} velocitySpikes={velocitySpikes}
            selectedRegion={selectedRegion} selectedStory={selectedStory}
            onRegionSelect={handleRegionSelect} onStorySelect={handleStorySelect} onArcSelect={handleArcSelect} />
        ) : (
          <FlatMap newsList={mapNewsList} regionSeverities={mapRegionSeverities} mapOverlay={mapOverlay}
            coverageStatusByIso={coverageStatusByIso} velocitySpikes={velocitySpikes}
            selectedRegion={selectedRegion} selectedStory={selectedStory}
            onRegionSelect={handleRegionSelect} onStorySelect={handleStorySelect} onArcSelect={handleArcSelect} />
        )}
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
      </div>

      <FilterDrawer
        isOpen={filtersOpen} defaultTab={drawerMode || 'filters'} onClose={() => setDrawerMode(null)}
        sourceCoverageAudit={sourceCoverageAudit} coverageMetrics={coverageMetrics}
        coverageDiagnostics={coverageDiagnostics} coverageTrends={coverageTrends}
        coverageHistory={coverageHistory} opsHealth={opsHealth}
        allNews={canonicalNews} filteredNews={activeNews} sourceHealth={sourceHealth}
        onRegionSelect={handleRegionSelect} />

      <EventTimeline events={activeNews} snapshotHistory={snapshotHistory}
        scrubTime={scrubTime} onScrub={useUIStore.getState().setScrubTime} />

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

      <NewsPanel key={panelRegion || 'closed'} isOpen={panelOpen && !selectedArc}
        regionName={panelRegionName} regionStatus={panelRegionStatus} regionData={panelRegionData}
        coverageEntry={panelCoverageEntry} coverageTransitions={panelCoverageTransitions}
        regionHistory={regionCoverageHistory} regionBackfillStatus={panelBackfillStatus}
        regionSourcePlan={panelBackfillEntry?.sourcePlan || null} regionFeedChecks={panelBackfillEntry?.feedChecks || []}
        news={panelNews} selectedStoryId={selectedStoryId} onStorySelect={handleStorySelect}
        onClose={handleClosePanel} sessionDiff={sessionDiff} velocitySpikes={velocitySpikes} />

      {dataError && <div className="data-error-badge">{t('errors.fallbackData')}</div>}

      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.type}`}>
              <span className="toast-dot" />{toast.message}
            </div>
          ))}
        </div>
      )}

      {showExport && (
        <BriefingExport events={activeNews}
          filters={{ minSeverity, minConfidence, dateWindow, sortMode, mapOverlay }}
          onClose={() => setShowExport(false)} />
      )}

      <Analytics />
    </div>
    </ErrorBoundary>
  );
}

export default App;
