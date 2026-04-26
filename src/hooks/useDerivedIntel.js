import { useMemo } from 'react';
import useNewsStore from '../stores/newsStore';
import useFilterStore from '../stores/filterStore';
import useUIStore from '../stores/uiStore';
import { canonicalizeArticles, calculateCoverageMetrics } from '../utils/newsPipeline';
import { buildCoverageDiagnostics } from '../utils/coverageDiagnostics';
import { buildSourceCoverageAudit } from '../utils/sourceCoverage';
import { sortStories, storyMatchesFilters } from '../utils/storyFilters';
import { getRelatedEvents } from '../utils/entityGraph';
import { computeSilenceEntries } from '../utils/anomalyUtils';
import { calculateRegionSeverity, getMockNews, resolveDateFloor } from '../utils/mockData';

/**
 * Shared filter + derivation pipeline used by App.jsx, IntelPage, FiltersPage.
 * Mirrors App.jsx computation order so mobile tab pages see the same
 * activeNews / anomaly / coverage state as the map view.
 */
export default function useDerivedIntel() {
  const liveNews = useNewsStore((s) => s.liveNews);
  const dataSource = useNewsStore((s) => s.dataSource);
  const sourceHealth = useNewsStore((s) => s.sourceHealth);
  const coverageTrends = useNewsStore((s) => s.coverageTrends);
  const coverageHistory = useNewsStore((s) => s.coverageHistory);
  const opsHealth = useNewsStore((s) => s.opsHealth);
  const hookVelocitySpikes = useNewsStore((s) => s.velocitySpikes);

  const debouncedSearch = useFilterStore((s) => s.debouncedSearch);
  const dateWindow = useFilterStore((s) => s.dateWindow);
  const minSeverity = useFilterStore((s) => s.minSeverity);
  const minConfidence = useFilterStore((s) => s.minConfidence);
  const sortMode = useFilterStore((s) => s.sortMode);
  const verificationFilter = useFilterStore((s) => s.verificationFilter);
  const sourceTypeFilter = useFilterStore((s) => s.sourceTypeFilter);
  const languageFilter = useFilterStore((s) => s.languageFilter);
  const accuracyMode = useFilterStore((s) => s.accuracyMode);
  const precisionFilter = useFilterStore((s) => s.precisionFilter);
  const hideAmplified = useFilterStore((s) => s.hideAmplified);
  const entityFilter = useFilterStore((s) => s.entityFilter);

  const scrubTime = useUIStore((s) => s.scrubTime);

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

  return {
    canonicalNews,
    activeNews,
    regionSeverities,
    velocitySpikes,
    silenceEntries,
    coverageMetrics,
    coverageDiagnostics,
    sourceCoverageAudit,
    coverageStatusByIso,
    coverageTrends,
    coverageHistory,
    opsHealth,
    sourceHealth,
  };
}
