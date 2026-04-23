import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import AnomalyPanel from '../components/AnomalyPanel';
import WatchlistPanel from '../components/WatchlistPanel';
import NarrativePanel from '../components/NarrativePanel';
import NewsPanel from '../components/NewsPanel';
import useDerivedIntel from '../hooks/useDerivedIntel';
import useUIStore from '../stores/uiStore';

export default function IntelPage() {
  const navigate = useNavigate();
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

  return (
    <div className="mobile-tab-page">
      <header className="mobile-tab-header">
        <button
          type="button"
          className="mobile-tab-back"
          onClick={() => navigate('/')}
          aria-label="Back to map"
        >
          <ChevronLeft size={18} aria-hidden />
        </button>
        <span className="mobile-tab-title">Intel</span>
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
