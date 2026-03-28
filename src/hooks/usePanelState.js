import { useEffect, useMemo } from 'react';
import useNewsStore from '../stores/newsStore';
import useUIStore from '../stores/uiStore';
import { sortStories, storyMatchesFilters } from '../utils/storyFilters';
import { mergeStoryLists } from '../utils/aiState';
import { isoToCountry } from '../utils/geocoder';
import { calculateRegionSeverity } from '../utils/mockData';

/**
 * Derives all panel-related state (selected story, region info, backfill,
 * coverage transitions) plus map data lists from the active news, filters,
 * and store state.  Also runs the side-effects for region coverage fetching,
 * backfill triggering, and stale selectedStoryId cleanup.
 */
export default function usePanelState({
  activeNews,
  filterParams,
  sortMode,
  regionSeverities,
  coverageStatusByIso,
  coverageHistory,
  dataSource,
  coverageDiagnostics,
}) {
  const { selectedRegion, selectedStoryId } = useUIStore();
  const { regionBackfills } = useNewsStore();

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
  const mapNewsList = useMemo(() => {
    const base = activeNews.filter((a) =>
      a.coordinates && a.isoA2
      && Array.isArray(a.coordinates) && a.coordinates.length >= 2
      && !(a.coordinates[0] === 0 && a.coordinates[1] === 0)
    );
    return (!panelRegion || panelNews.length === 0) ? base : mergeStoryLists(base, panelNews);
  }, [activeNews, panelNews, panelRegion]);
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

  return {
    selectedStory,
    panelRegion,
    panelOpen,
    panelBackfillEntry,
    panelBackfillStories,
    panelNews,
    panelRegionData,
    panelRegionName,
    panelRegionStatus,
    panelCoverageEntry,
    panelBackfillStatus,
    panelCoverageTransitions,
    mapNewsList,
    mapRegionSeverities,
  };
}
