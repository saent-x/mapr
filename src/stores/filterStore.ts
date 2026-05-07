import { create } from 'zustand';
import { decodeURLToFilters, encodeViewToURL } from '../utils/viewManager.js';
import { resolveDateFloor } from '../utils/mockData.js';
import type { FilterState, SavedView, URLFilterParams, SavedViewMapState, EntityFilter } from '../types/store';

/* ── module-level debounce timer (not in state to avoid re-renders) ── */
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Filter store — all filter state: severity, search, time range, sort mode,
 * verification, source type, language, accuracy, precision, amplification.
 */
const useFilterStore = create<FilterState>()((set, get) => ({
  searchQuery: '',
  debouncedSearch: '',
  dateWindow: '168h',
  minSeverity: 0,
  minConfidence: 0,
  sortMode: 'severity',
  mapOverlay: 'severity',
  /** Live ADS-B / AIS overlays (lazy-loaded; no extra fetch until enabled). */
  showFlightsLayer: false,
  showVesselsLayer: false,
  verificationFilter: 'all',
  sourceTypeFilter: 'all',
  languageFilter: 'all',
  accuracyMode: 'standard',
  precisionFilter: 'all',
  hideAmplified: false,

  /* ── entity filter (set from entity explorer → map integration) ── */
  entityFilter: null, // null | { id: string, name: string, type: string }

  /* ── setters ── */
  setSearchQuery: (q: string) => {
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => set({ debouncedSearch: q }), 250);
    set({ searchQuery: q });
  },
  setDateWindow: (v: string) => set({ dateWindow: v }),
  setMinSeverity: (v: number) => set({ minSeverity: v }),
  setMinConfidence: (v: number) => set({ minConfidence: v }),
  setSortMode: (v: string) => set({ sortMode: v }),
  setMapOverlay: (v: string) => set({ mapOverlay: v }),
  setShowFlightsLayer: (v: boolean) => set({ showFlightsLayer: Boolean(v) }),
  setShowVesselsLayer: (v: boolean) => set({ showVesselsLayer: Boolean(v) }),
  toggleFlightsLayer: () => set((s) => ({ showFlightsLayer: !s.showFlightsLayer })),
  toggleVesselsLayer: () => set((s) => ({ showVesselsLayer: !s.showVesselsLayer })),
  setVerificationFilter: (v: string) => set({ verificationFilter: v }),
  setSourceTypeFilter: (v: string) => set({ sourceTypeFilter: v }),
  setLanguageFilter: (v: string) => set({ languageFilter: v }),
  setAccuracyMode: (v: string) => set({ accuracyMode: v }),
  setPrecisionFilter: (v: string) => set({ precisionFilter: v }),
  setHideAmplified: (v: boolean) => set({ hideAmplified: v }),
  setEntityFilter: (entity: EntityFilter) => set({ entityFilter: entity }),
  clearEntityFilter: () => set({ entityFilter: null }),

  /**
   * Returns the current filter parameters in the shape expected by
   * `storyMatchesFilters()`.
   */
  getFilterParams: () => {
    const s = get();
    return {
      minSeverity: s.minSeverity,
      minConfidence: s.minConfidence,
      dateFloor: resolveDateFloor(s.dateWindow),
      accuracyMode: s.accuracyMode,
      verificationFilter: s.verificationFilter,
      sourceTypeFilter: s.sourceTypeFilter,
      languageFilter: s.languageFilter,
      precisionFilter: s.precisionFilter,
      hideAmplified: s.hideAmplified,
    };
  },

  /** Apply a saved view's filters + mapState. */
  applyView: (view: SavedView) => {
    const { filters = {}, mapState = {} } = view;
    const updates: Partial<FilterState> = {};
    if (filters.searchQuery !== undefined) { updates.searchQuery = filters.searchQuery; updates.debouncedSearch = filters.searchQuery; }
    if (filters.minSeverity !== undefined) updates.minSeverity = filters.minSeverity;
    if (filters.minConfidence !== undefined) updates.minConfidence = filters.minConfidence;
    if (filters.dateWindow !== undefined) updates.dateWindow = filters.dateWindow;
    if (filters.sortMode !== undefined) updates.sortMode = filters.sortMode;
    if (filters.verificationFilter !== undefined) updates.verificationFilter = filters.verificationFilter;
    if (filters.sourceTypeFilter !== undefined) updates.sourceTypeFilter = filters.sourceTypeFilter;
    if (filters.languageFilter !== undefined) updates.languageFilter = filters.languageFilter;
    if (filters.accuracyMode !== undefined) updates.accuracyMode = filters.accuracyMode;
    if (filters.precisionFilter !== undefined) updates.precisionFilter = filters.precisionFilter;
    if (filters.hideAmplified !== undefined) updates.hideAmplified = filters.hideAmplified;
    if (filters.entityFilter !== undefined) updates.entityFilter = filters.entityFilter;
    if (mapState.mapOverlay !== undefined) updates.mapOverlay = mapState.mapOverlay;
    set(updates);
  },

  /** Hydrate filter state from URL search params (called once on mount). */
  initFromURL: (searchParams: URLSearchParams) => {
    const decoded = decodeURLToFilters(searchParams);
    const filters = decoded.filters as URLFilterParams;
    const mapState = decoded.mapState as SavedViewMapState;
    const updates: Partial<FilterState> = {};
    if (filters.searchQuery) { updates.searchQuery = filters.searchQuery; updates.debouncedSearch = filters.searchQuery; }
    if (filters.minSeverity) updates.minSeverity = filters.minSeverity;
    if (filters.minConfidence) updates.minConfidence = filters.minConfidence;
    if (filters.dateWindow) updates.dateWindow = filters.dateWindow;
    if (filters.sortMode) updates.sortMode = filters.sortMode;
    if (filters.entityFilter) updates.entityFilter = filters.entityFilter;
    if (mapState.mapOverlay) updates.mapOverlay = mapState.mapOverlay;
    if (Object.keys(updates).length > 0) set(updates);
    return { filters, mapState };
  },

  /** Encode current filter state into a URL query string. */
  toURLParams: () => {
    const s = get();
    return encodeViewToURL({
      filters: {
        searchQuery: s.debouncedSearch,
        minSeverity: s.minSeverity,
        minConfidence: s.minConfidence,
        dateWindow: s.dateWindow,
        sortMode: s.sortMode,
        entityFilter: s.entityFilter,
      },
      mapState: { mapOverlay: s.mapOverlay },
    });
  },
}));

export default useFilterStore;
