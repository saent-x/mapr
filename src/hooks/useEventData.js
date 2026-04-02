import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchBackendBriefing,
  fetchBackendCoverageHistory,
  fetchBackendHealth,
  refreshBackendBriefing
} from '../services/backendService';
import { fetchLiveNews, getGdeltFetchHealth } from '../services/gdeltService';

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Custom hook that encapsulates all event/article data fetching with
 * 3-tier fallback: backend → client-side GDELT → mock data.
 *
 * Returns raw articles (liveNews), plus source health, coverage trends,
 * coverage history, ops health, and data source status.
 *
 * Toast/notification logic is delegated to the caller via onNewData callback.
 */
export default function useEventData({ onNewData } = {}) {
  const [liveNews, setLiveNews] = useState(null);
  const [dataSource, setDataSource] = useState('loading');
  const [dataError, setDataError] = useState(null);
  const [sourceHealth, setSourceHealth] = useState({ gdelt: null, rss: null, backend: null });
  const [coverageTrends, setCoverageTrends] = useState(null);
  const [coverageHistory, setCoverageHistory] = useState(null);
  const [opsHealth, setOpsHealth] = useState(null);
  const [velocitySpikes, setVelocitySpikes] = useState([]);

  const refreshTimerRef = useRef(null);
  const prevArticleCountRef = useRef(0);
  const isFirstLoadRef = useRef(true);
  const onNewDataRef = useRef(onNewData);

  // Keep callback ref up to date without triggering re-renders
  useEffect(() => {
    onNewDataRef.current = onNewData;
  }, [onNewData]);

  const loadLiveData = useCallback(async ({ forceRefresh = false } = {}) => {
    // 1. Try backend API
    try {
      const [briefing, historyPayload] = await Promise.all([
        forceRefresh
          ? refreshBackendBriefing()
          : fetchBackendBriefing(),
        fetchBackendCoverageHistory().catch(() => null)
      ]);

      if (Array.isArray(briefing?.articles) && briefing.articles.length > 0) {
        const count = briefing.articles.length;
        const prevCount = prevArticleCountRef.current;
        setLiveNews(briefing.articles);
        setSourceHealth(briefing.sourceHealth || { gdelt: null, rss: null, backend: null });
        setCoverageTrends(historyPayload?.trends || briefing.coverageTrends || null);
        setCoverageHistory(historyPayload || null);
        setVelocitySpikes(Array.isArray(briefing.velocitySpikes) ? briefing.velocitySpikes : []);
        fetchBackendHealth().then(setOpsHealth).catch(() => setOpsHealth(null));
        setDataSource('live');
        setDataError(null);

        // Notify caller (not on first load)
        if (!isFirstLoadRef.current && onNewDataRef.current) {
          const diff = count - prevCount;
          if (diff > 0) {
            onNewDataRef.current({ type: 'new-data', count, diff });
          } else {
            onNewDataRef.current({ type: 'refresh', count });
          }
        }
        prevArticleCountRef.current = count;
        isFirstLoadRef.current = false;
        return;
      }
    } catch (backendErr) {
      console.warn('Backend briefing failed, trying client-side GDELT fallback:', backendErr.message);
    }

    // 2. Fallback: fetch directly from GDELT client-side
    try {
      const clientArticles = await fetchLiveNews({ timespan: '24h', maxRecords: 750 });
      if (Array.isArray(clientArticles) && clientArticles.length > 0) {
        const count = clientArticles.length;
        setLiveNews(clientArticles);
        const gdeltHealth = getGdeltFetchHealth();
        setSourceHealth({ gdelt: gdeltHealth, rss: null, backend: null });
        setCoverageTrends(null);
        setCoverageHistory(null);
        setOpsHealth(null);
        setDataSource('live');
        setDataError(null);
        if (!isFirstLoadRef.current && onNewDataRef.current) {
          onNewDataRef.current({ type: 'client-refresh', count });
        }
        prevArticleCountRef.current = count;
        isFirstLoadRef.current = false;
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

  const refresh = useCallback(() => {
    setDataSource('loading');
    setSourceHealth({ gdelt: null, rss: null, backend: null });
    setCoverageTrends(null);
    setCoverageHistory(null);
    setOpsHealth(null);
    loadLiveData({ forceRefresh: true });
  }, [loadLiveData]);

  return {
    liveNews,
    dataSource,
    dataError,
    sourceHealth,
    coverageTrends,
    coverageHistory,
    opsHealth,
    velocitySpikes,
    refresh
  };
}
