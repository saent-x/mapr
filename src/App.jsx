import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal } from 'lucide-react';
import Header from './components/Header';
import FilterDrawer from './components/FilterDrawer';
import NewsPanel from './components/NewsPanel';
import { fetchLiveNews, clearCache } from './services/gdeltService';
import { fetchRssNews, clearRssCache } from './services/rssService';
import { deduplicateArticles } from './utils/articleUtils';
import { classifyArticles, mergeAiSeverity, inferLocations, mergeAiLocations } from './services/aiService';
import {
  MOCK_NEWS,
  calculateRegionSeverity,
  getSeverityMeta,
  resolveDateFloor
} from './utils/mockData';

const Globe = lazy(() => import('./components/Globe'));
const FlatMap = lazy(() => import('./components/FlatMap'));

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

function App() {
  const { t, i18n } = useTranslation();

  // RTL + lang attribute
  useEffect(() => {
    document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  const [searchQuery, setSearchQuery] = useState('');
  const [dateWindow, setDateWindow] = useState('168h');
  const [startDate, setStartDate] = useState('');
  const [minSeverity, setMinSeverity] = useState(0);
  const [sortMode, setSortMode] = useState('severity');
  const [mapMode, setMapMode] = useState('globe');
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [selectedStoryId, setSelectedStoryId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Live data state
  const [liveNews, setLiveNews] = useState(null);
  const [dataSource, setDataSource] = useState('loading'); // 'loading' | 'live' | 'mock'
  const [dataError, setDataError] = useState(null);
  const refreshTimerRef = useRef(null);

  // AI classification state
  const [aiScores, setAiScores] = useState(null);
  const [aiLocations, setAiLocations] = useState(null);
  const [aiStatus, setAiStatus] = useState('idle'); // 'idle' | 'loading' | 'analyzing' | 'done' | 'error'
  const [aiProgress, setAiProgress] = useState({ done: 0, total: 0 });
  const classifiedIdsRef = useRef(new Set());
  const nerDoneRef = useRef(false);

  // Fetch live data from GDELT + RSS (progressive: show GDELT immediately, merge RSS when ready)
  const loadLiveData = useCallback(async () => {
    try {
      // Start both fetches
      const gdeltPromise = fetchLiveNews({ timespan: '24h', maxRecords: 250 }).catch(() => []);
      const rssPromise = fetchRssNews().catch(() => []);

      // Show GDELT data as soon as it arrives
      const gdelt = await gdeltPromise;
      if (gdelt.length > 0) {
        setLiveNews(gdelt);
        setDataSource('live');
        setDataError(null);
      }

      // Merge RSS when it finishes (may take 15-20s with batching)
      const rss = await rssPromise;
      const allArticles = deduplicateArticles([...gdelt, ...rss]);

      if (allArticles.length > 0) {
        setLiveNews(allArticles);
        setDataSource('live');
        setDataError(null);
      } else if (!gdelt.length) {
        setLiveNews(null);
        setDataSource('mock');
      }
    } catch (err) {
      console.warn('News fetch failed, using mock data:', err.message);
      setLiveNews(null);
      setDataSource('mock');
      setDataError(err.message);
    }
  }, []);

  // Initial load + auto-refresh
  useEffect(() => {
    loadLiveData();

    refreshTimerRef.current = setInterval(loadLiveData, REFRESH_INTERVAL);
    return () => clearInterval(refreshTimerRef.current);
  }, [loadLiveData]);

  // AI classification: runs in background after articles load
  useEffect(() => {
    if (!liveNews || liveNews.length === 0) return;

    // Find articles not yet classified
    const unclassified = liveNews.filter((a) => !classifiedIdsRef.current.has(a.id));
    if (unclassified.length === 0) return;

    let cancelled = false;

    setAiStatus((prev) => (prev === 'done' ? 'analyzing' : 'loading'));

    classifyArticles(unclassified, (done, total) => {
      if (!cancelled) {
        setAiStatus('analyzing');
        setAiProgress({ done, total });
      }
    })
      .then((newScores) => {
        if (cancelled) return;
        unclassified.forEach((a) => classifiedIdsRef.current.add(a.id));
        setAiScores((prev) => {
          const merged = new Map(prev || []);
          for (const [id, score] of newScores) {
            merged.set(id, score);
          }
          return merged;
        });
        setAiStatus('done');
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('AI classification failed:', err.message);
          setAiStatus('error');
        }
      });

    return () => { cancelled = true; };
  }, [liveNews]);

  // AI NER pass: runs after sentiment classification completes
  // Corrects articles that were assigned to the wrong country
  useEffect(() => {
    if (aiStatus !== 'done' || !liveNews || nerDoneRef.current) return;

    let cancelled = false;
    nerDoneRef.current = true;

    inferLocations(liveNews, () => {})
      .then((locMap) => {
        if (cancelled || locMap.size === 0) return;
        setAiLocations(locMap);
      })
      .catch((err) => {
        console.warn('NER location inference failed:', err.message);
      });

    return () => { cancelled = true; };
  }, [aiStatus, liveNews]);

  // Base news: live data or fallback to mock — enhanced with AI severity + locations
  const baseNews = useMemo(() => {
    let news = liveNews || MOCK_NEWS;
    if (aiLocations && aiLocations.size > 0) {
      news = mergeAiLocations(news, aiLocations);
    }
    if (aiScores && aiScores.size > 0) {
      news = mergeAiSeverity(news, aiScores);
    }
    return news;
  }, [liveNews, aiScores, aiLocations]);

  const dateFloor = useMemo(
    () => resolveDateFloor(dateWindow, startDate),
    [dateWindow, startDate]
  );

  const activeNews = useMemo(() => {
    const filtered = baseNews.filter((story) => {
      if (story.severity < minSeverity) return false;
      if (dateFloor && new Date(story.publishedAt) < dateFloor) return false;
      return true;
    });

    filtered.sort((a, b) => {
      if (sortMode === 'latest') return new Date(b.publishedAt) - new Date(a.publishedAt);
      return b.severity - a.severity || new Date(b.publishedAt) - new Date(a.publishedAt);
    });

    return filtered;
  }, [baseNews, dateFloor, minSeverity, sortMode]);

  const regionSeverities = useMemo(
    () => calculateRegionSeverity(activeNews),
    [activeNews]
  );

  useEffect(() => {
    if (selectedRegion && !activeNews.some((s) => s.isoA2 === selectedRegion)) {
      setSelectedRegion(null);
    }
    if (selectedStoryId && !activeNews.some((s) => s.id === selectedStoryId)) {
      setSelectedStoryId(null);
    }
  }, [activeNews, selectedRegion, selectedStoryId]);

  const selectedStory = activeNews.find((s) => s.id === selectedStoryId) ?? null;
  const panelRegion = selectedRegion || selectedStory?.isoA2 || null;
  const panelOpen = Boolean(panelRegion);
  const panelNews = panelRegion ? activeNews.filter((s) => s.isoA2 === panelRegion) : [];
  const panelRegionData = panelRegion ? regionSeverities[panelRegion] : null;

  const activeRegions = Object.keys(regionSeverities).length;
  const criticalCount = activeNews.filter((s) => s.severity >= 85).length;

  const handleRegionSelect = (iso) => {
    setSelectedRegion((prev) => (prev === iso ? null : iso));
    setSelectedStoryId(null);
  };

  const handleStorySelect = (story) => {
    setSelectedStoryId(story.id);
    setSelectedRegion(story.isoA2);
  };

  const handleClosePanel = () => {
    setSelectedRegion(null);
    setSelectedStoryId(null);
  };

  const handleSearchSelect = useCallback((result) => {
    if (result.type === 'region') {
      setSelectedRegion(result.iso);
      setSelectedStoryId(null);
    } else if (result.type === 'story') {
      setSelectedStoryId(result.story.id);
      setSelectedRegion(result.story.isoA2);
    }
  }, []);

  const handleRefresh = () => {
    clearCache();
    clearRssCache();
    setDataSource('loading');
    setAiScores(null);
    setAiLocations(null);
    setAiStatus('idle');
    classifiedIdsRef.current.clear();
    nerDoneRef.current = false;
    loadLiveData();
  };

  return (
    <div className="app">
      <Suspense fallback={null}>
        {mapMode === 'globe' ? (
          <Globe
            newsList={activeNews}
            regionSeverities={regionSeverities}
            selectedRegion={selectedRegion}
            selectedStory={selectedStory}
            onRegionSelect={handleRegionSelect}
            onStorySelect={handleStorySelect}
          />
        ) : (
          <FlatMap
            newsList={activeNews}
            regionSeverities={regionSeverities}
            selectedRegion={selectedRegion}
            selectedStory={selectedStory}
            onRegionSelect={handleRegionSelect}
            onStorySelect={handleStorySelect}
          />
        )}
      </Suspense>

      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchSelect={handleSearchSelect}
        newsList={baseNews}
        regionSeverities={regionSeverities}
        storyCount={activeNews.length}
        regionCount={activeRegions}
        criticalCount={criticalCount}
        mapMode={mapMode}
        onMapModeChange={setMapMode}
        dataSource={dataSource}
        onRefresh={handleRefresh}
        aiStatus={aiStatus}
        aiProgress={aiProgress}
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
        minSeverity={minSeverity}
        setMinSeverity={setMinSeverity}
        sortMode={sortMode}
        setSortMode={setSortMode}
      />

      <div className="legend">
        <span className="legend-label">{t('legend.severity')}</span>
        <div className="legend-items">
          {[
            { key: 'critical', color: 'var(--critical)' },
            { key: 'elevated', color: 'var(--elevated)' },
            { key: 'watch', color: 'var(--watch)' },
            { key: 'low', color: 'var(--low)' }
          ].map((item) => (
            <div key={item.key} className="legend-item">
              <span className="legend-dot" style={{ background: item.color }} />
              {t(`legend.${item.key}`)}
            </div>
          ))}
        </div>
      </div>

      <div className={`story-bar ${panelOpen ? 'is-shifted' : ''}`}>
        {activeNews.slice(0, 8).map((story) => {
          const meta = getSeverityMeta(story.severity);
          return (
            <button
              key={story.id}
              className={`story-chip ${selectedStoryId === story.id ? 'is-active' : ''}`}
              onClick={() => handleStorySelect(story)}
            >
              <span className="story-chip-dot" style={{ background: meta.accent }} />
              <div className="story-chip-text">
                <div className="story-chip-title">{story.title}</div>
                <div className="story-chip-location">{story.locality}</div>
              </div>
            </button>
          );
        })}
      </div>

      <NewsPanel
        isOpen={panelOpen}
        regionData={panelRegionData}
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
    </div>
  );
}

export default App;
