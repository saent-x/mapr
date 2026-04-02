import { useCallback, useEffect, useRef, useState } from 'react';
import { runLoadLiveDataPipeline } from '../services/loadLiveDataPipeline.js';
import { fetchBackendHealth } from '../services/backendService.js';

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Article/event data via the shared load pipeline (backend → GDELT → mock).
 * Toast/notification logic is delegated via onNewData.
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

  useEffect(() => {
    onNewDataRef.current = onNewData;
  }, [onNewData]);

  const applyPipelineResult = useCallback((result) => {
    if (result.kind === 'backend' || result.kind === 'backend_warming') {
      const { briefing, historyPayload } = result;
      const articles = briefing.articles || [];
      const count = articles.length;
      const prevCount = prevArticleCountRef.current;

      setLiveNews(articles);
      setSourceHealth(briefing.sourceHealth || { gdelt: null, rss: null, backend: null });
      setCoverageTrends(historyPayload?.trends || briefing.coverageTrends || null);
      setCoverageHistory(historyPayload || null);
      setVelocitySpikes(Array.isArray(briefing.velocitySpikes) ? briefing.velocitySpikes : []);
      fetchBackendHealth().then(setOpsHealth).catch(() => setOpsHealth(null));
      setDataSource('live');
      setDataError(
        result.kind === 'backend_warming'
          ? 'Backend briefing not ready yet — ingest may still be running'
          : null
      );

      if (!isFirstLoadRef.current && onNewDataRef.current && count > 0) {
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

    if (result.kind === 'client_gdelt') {
      const { articles, gdeltHealth } = result;
      const count = articles.length;
      setLiveNews(articles);
      setSourceHealth({ gdelt: gdeltHealth, rss: null, backend: null });
      setCoverageTrends(null);
      setCoverageHistory(null);
      setOpsHealth(null);
      setVelocitySpikes([]);
      setDataSource('live');
      setDataError(null);
      if (!isFirstLoadRef.current && onNewDataRef.current) {
        onNewDataRef.current({ type: 'client-refresh', count });
      }
      prevArticleCountRef.current = count;
      isFirstLoadRef.current = false;
      return;
    }

    setLiveNews(null);
    setDataSource('mock');
    setDataError(result.errorMessage);
  }, []);

  const loadLiveData = useCallback(async ({ forceRefresh = false } = {}) => {
    const result = await runLoadLiveDataPipeline({ forceRefresh });
    applyPipelineResult(result);
  }, [applyPipelineResult]);

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
