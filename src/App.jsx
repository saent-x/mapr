import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal } from 'lucide-react';
import { Analytics } from '@vercel/analytics/react';
import ErrorBoundary from './components/ErrorBoundary';
import Header from './components/Header';
import FilterDrawer from './components/FilterDrawer';
import NewsPanel from './components/NewsPanel';
import {
  fetchBackendBriefing,
  fetchBackendCoverageHistory,
  fetchBackendCoverageRegion,
  fetchBackendRegionBriefing,
  fetchBackendHealth,
  refreshBackendBriefing
} from './services/backendService';
import { fetchLiveNews, getGdeltFetchHealth } from './services/gdeltService';
import { canonicalizeArticles, calculateCoverageMetrics } from './utils/newsPipeline';
import { COVERAGE_STATUS_ORDER, getCoverageMeta } from './utils/coverageMeta';
import { buildCoverageDiagnostics } from './utils/coverageDiagnostics';
import { mergeStoryLists } from './utils/aiState';
import { getSourceHost } from './utils/urlUtils';
import { buildRegionSourcePlan, buildSourceCoverageAudit } from './utils/sourceCoverage';
import { sortStories, storyMatchesFilters } from './utils/storyFilters';
import { isoToCountry } from './utils/geocoder';
import {
  MOCK_NEWS,
  calculateRegionSeverity,
  getSeverityMeta,
  resolveDateFloor
} from './utils/mockData';

const Globe = lazy(() => import('./components/Globe'));
const FlatMap = lazy(() => import('./components/FlatMap'));

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
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
  const [mapMode, setMapMode] = useState('globe');
  const [mapOverlay, setMapOverlay] = useState('severity');
  const [verificationFilter, setVerificationFilter] = useState('all');
  const [sourceTypeFilter, setSourceTypeFilter] = useState('all');
  const [languageFilter, setLanguageFilter] = useState('all');
  const [accuracyMode, setAccuracyMode] = useState('standard');
  const [precisionFilter, setPrecisionFilter] = useState('all');
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [selectedStoryId, setSelectedStoryId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Live data state
  const [liveNews, setLiveNews] = useState(null);
  const [dataSource, setDataSource] = useState('loading'); // 'loading' | 'live' | 'mock'
  const [dataError, setDataError] = useState(null);
  const [sourceHealth, setSourceHealth] = useState({ gdelt: null, rss: null, backend: null });
  const [coverageTrends, setCoverageTrends] = useState(null);
  const [coverageHistory, setCoverageHistory] = useState(null);
  const [regionCoverageHistory, setRegionCoverageHistory] = useState(null);
  const [regionBackfills, setRegionBackfills] = useState({});
  const [opsHealth, setOpsHealth] = useState(null);
  const refreshTimerRef = useRef(null);

  // Fetch live data — tries backend first, falls back to client-side GDELT
  const loadLiveData = useCallback(async ({ forceRefresh = false } = {}) => {
    // 1. Try backend API (Vercel serverless functions)
    try {
      const [briefing, historyPayload] = await Promise.all([
        forceRefresh
          ? refreshBackendBriefing()
          : fetchBackendBriefing(),
        fetchBackendCoverageHistory().catch(() => null)
      ]);

      if (Array.isArray(briefing?.articles) && briefing.articles.length > 0) {
        setLiveNews(briefing.articles);
        setRegionBackfills({});
        setSourceHealth(briefing.sourceHealth || { gdelt: null, rss: null, backend: null });
        setCoverageTrends(historyPayload?.trends || briefing.coverageTrends || null);
        setCoverageHistory(historyPayload || null);
        fetchBackendHealth().then(setOpsHealth).catch(() => setOpsHealth(null));
        setDataSource('live');
        setDataError(null);
        return;
      }
    } catch (backendErr) {
      console.warn('Backend briefing failed, trying client-side GDELT fallback:', backendErr.message);
    }

    // 2. Fallback: fetch directly from GDELT client-side (no serverless function needed)
    try {
      const clientArticles = await fetchLiveNews({ timespan: '24h', maxRecords: 250 });
      if (Array.isArray(clientArticles) && clientArticles.length > 0) {
        setLiveNews(clientArticles);
        setRegionBackfills({});
        const gdeltHealth = getGdeltFetchHealth();
        setSourceHealth({ gdelt: gdeltHealth, rss: null, backend: null });
        setCoverageTrends(null);
        setCoverageHistory(null);
        setOpsHealth(null);
        setDataSource('live');
        setDataError(null);
        console.info(`Client-side GDELT fallback loaded ${clientArticles.length} articles`);
        return;
      }
    } catch (clientErr) {
      console.warn('Client-side GDELT fallback also failed:', clientErr.message);
    }

    // 3. Last resort: static mock data
    setLiveNews(null);
    setDataSource('mock');
    setDataError('Both backend and client-side fetching failed');
  }, []);

  // Initial load + auto-refresh
  useEffect(() => {
    loadLiveData();

    refreshTimerRef.current = setInterval(loadLiveData, REFRESH_INTERVAL);
    return () => clearInterval(refreshTimerRef.current);
  }, [loadLiveData]);

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
    const filtered = canonicalNews.filter((story) => (
      storyMatchesFilters(story, {
        minSeverity,
        minConfidence,
        dateFloor,
        accuracyMode,
        verificationFilter,
        sourceTypeFilter,
        languageFilter,
        precisionFilter
      })
    ));

    return sortStories(filtered, sortMode);
  }, [accuracyMode, canonicalNews, dateFloor, languageFilter, minConfidence, minSeverity, precisionFilter, sortMode, sourceTypeFilter, verificationFilter]);

  const regionSeverities = useMemo(
    () => calculateRegionSeverity(activeNews),
    [activeNews]
  );

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
        precisionFilter
      })
    )), sortMode);
  }, [accuracyMode, dateFloor, languageFilter, minConfidence, minSeverity, precisionFilter, regionBackfills, selectedRegion, sortMode, sourceTypeFilter, verificationFilter]);

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
        precisionFilter
      })
    )), sortMode);
  }, [accuracyMode, dateFloor, languageFilter, minConfidence, minSeverity, panelBackfillEntry, panelRegion, precisionFilter, sortMode, sourceTypeFilter, verificationFilter]);
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
  };

  const handleStorySelect = (story) => {
    setSelectedStoryId(story.id);
    setSelectedRegion(story.isoA2);
  };

  const handleClosePanel = useCallback(() => {
    setSelectedRegion(null);
    setSelectedStoryId(null);
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
    setDataSource('loading');
    setSourceHealth({ gdelt: null, rss: null, backend: null });
    setCoverageTrends(null);
    setCoverageHistory(null);
    setRegionCoverageHistory(null);
    setRegionBackfills({});
    setOpsHealth(null);
    loadLiveData({ forceRefresh: true });
  }, [loadLiveData]);

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
            setFiltersOpen(false);
          }
          break;
        case 'g':
          setMapMode((prev) => (prev === 'globe' ? 'flat' : 'globe'));
          break;
        case 'f':
          setFiltersOpen((prev) => !prev);
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [panelOpen, filtersOpen, handleRefresh, handleClosePanel]);

  // ── URL deep linking ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const regionParam = params.get('region');
    const storyParam = params.get('story');
    if (regionParam) {
      setSelectedRegion(regionParam.toUpperCase());
    }
    if (storyParam) {
      setSelectedStoryId(storyParam);
    }
  }, []);

  // Sync state → URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedRegion) params.set('region', selectedRegion);
    if (selectedStoryId) params.set('story', selectedStoryId);
    const search = params.toString();
    const url = search ? `${window.location.pathname}?${search}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [selectedRegion, selectedStoryId]);

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
            selectedRegion={selectedRegion}
            selectedStory={selectedStory}
            onRegionSelect={handleRegionSelect}
            onStorySelect={handleStorySelect}
          />
        ) : (
          <FlatMap
            newsList={mapNewsList}
            regionSeverities={mapRegionSeverities}
            mapOverlay={mapOverlay}
            coverageStatusByIso={coverageStatusByIso}
            selectedRegion={selectedRegion}
            selectedStory={selectedStory}
            onRegionSelect={handleRegionSelect}
            onStorySelect={handleStorySelect}
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
        dataSource={dataSource}
        onRefresh={handleRefresh}
        backendStatus={opsHealth?.status || sourceHealth?.backend?.status || null}
      />

      <button
        className={`filter-toggle ${filtersOpen ? 'is-active' : ''}`}
        onClick={() => setFiltersOpen((p) => !p)}
      >
        <SlidersHorizontal size={14} />
        {t('filters.label')}
      </button>

      <FilterDrawer
        isOpen={filtersOpen}
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
      />

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

      <div className={`story-bar ${panelOpen ? 'is-shifted' : ''}`}>
        {activeNews.slice(0, 8).map((story) => {
          const meta = getSeverityMeta(story.severity);
          const sourceLabel = getSourceHost(story.url, story.source || t('article.readFull'));
          return (
            <div
              key={story.id}
              className={`story-chip-shell ${selectedStoryId === story.id ? 'is-active' : ''}`}
            >
              <button
                type="button"
                className="story-chip"
                onClick={() => handleStorySelect(story)}
              >
                <span className="story-chip-dot" style={{ background: meta.accent }} />
                <div className="story-chip-text">
                  <div className="story-chip-title">{story.title}</div>
                  <div className="story-chip-location">{story.locality}</div>
                </div>
              </button>
              {story.url && (
                <a
                  className="story-chip-link"
                  href={story.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t('article.readFull')}
                >
                  {sourceLabel}
                </a>
              )}
            </div>
          );
        })}
      </div>

      <NewsPanel
        key={panelRegion || 'closed'}
        isOpen={panelOpen}
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
      />

      {dataError && (
        <div className="data-error-badge">
          {t('errors.fallbackData')}
        </div>
      )}
      <Analytics />
    </div>
    </ErrorBoundary>
  );
}

export default App;
