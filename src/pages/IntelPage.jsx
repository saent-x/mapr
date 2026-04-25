import React, { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import AnomalyPanel from '../components/AnomalyPanel';
import WatchlistPanel from '../components/WatchlistPanel';
import NarrativePanel from '../components/NarrativePanel';
import NewsPanel from '../components/NewsPanel';
import useDerivedIntel from '../hooks/useDerivedIntel';
import useNewsStore from '../stores/newsStore';
import useUIStore from '../stores/uiStore';

/**
 * Intel page perf shape: header + panel chrome render synchronously on mount.
 * Each panel owns its own empty/loading state — they fill in independently as
 * the shared news pipeline (useDerivedIntel) recomputes off liveNews.
 *
 * Direct-nav fix: the page kicks off loadLiveData() if no data is loaded yet,
 * because Layout (which wraps Intel) does not start the data pipeline — only
 * App.jsx does. Visiting /intel without first hitting / would otherwise show
 * empty panels indefinitely.
 */
export default function IntelPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const liveNews = useNewsStore((s) => s.liveNews);
  const dataSource = useNewsStore((s) => s.dataSource);

  useEffect(() => {
    if (!liveNews) useNewsStore.getState().loadLiveData();
  }, [liveNews]);

  const { activeNews, velocitySpikes, silenceEntries } = useDerivedIntel();

  const selectRegion = useUIStore((s) => s.selectRegion);
  const setLastRegionIso = useUIStore((s) => s.setLastRegionIso);
  const selectStory = useUIStore((s) => s.selectStory);

  const handleRegionSelect = useCallback((iso) => {
    selectRegion(iso);
    if (iso) setLastRegionIso(iso);
    navigate('/');
  }, [selectRegion, setLastRegionIso, navigate]);

  const handleStorySelect = useCallback((story) => {
    selectStory(story);
  }, [selectStory]);

  const isLoading = !liveNews && dataSource === 'loading';

  return (
    <div className="mobile-tab-page">
      <header className="mobile-tab-header">
        <button
          type="button"
          className="mobile-tab-back"
          onClick={() => navigate('/')}
          aria-label={t('nav.backToMap', 'Back to map')}
        >
          <ChevronLeft size={18} aria-hidden />
        </button>
        <span className="mobile-tab-title">{t('nav.intel', 'Intel')}</span>
        {isLoading && (
          <span className="mobile-tab-loading" role="status" aria-live="polite">
            {t('loading.initialData', 'Loading…')}
          </span>
        )}
      </header>
      <div className="mobile-tab-body">
        <div className="mobile-intel-stack">
          <AnomalyPanel
            velocitySpikes={velocitySpikes}
            silenceEntries={silenceEntries}
            onRegionSelect={handleRegionSelect}
          />
          <WatchlistPanel onRegionSelect={handleRegionSelect} />
          <NarrativePanel newsList={activeNews} onRegionSelect={handleRegionSelect} />
          <NewsPanel
            variant="inline"
            news={activeNews}
            allEvents={activeNews}
            onStorySelect={handleStorySelect}
          />
        </div>
      </div>
    </div>
  );
}
