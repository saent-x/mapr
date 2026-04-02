import { create } from 'zustand';
import { decodeURLToFilters, encodeViewToURL } from '../utils/viewManager.js';
import { resolveDateFloor } from '../utils/mockData.js';

/* ── module-level debounce timer (not in state to avoid re-renders) ── */
let _debounceTimer = null;

/**
 * Filter store — all filter state: severity, search, time range, sort mode,
 * verification, source type, language, accuracy, precision, amplification.
 */
const useFilterStore = create((set, get) => ({
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
  setSearchQuery: (q) => {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => set({ debouncedSearch: q }), 250);
    set({ searchQuery: q });
  },
  setDateWindow: (v) => set({ dateWindow: v }),
  setMinSeverity: (v) => set({ minSeverity: v }),
  setMinConfidence: (v) => set({ minConfidence: v }),
  setSortMode: (v) => set({ sortMode: v }),
  setMapOverlay: (v) => set({ mapOverlay: v }),
  setShowFlightsLayer: (v) => set({ showFlightsLayer: Boolean(v) }),
  setShowVesselsLayer: (v) => set({ showVesselsLayer: Boolean(v) }),
  toggleFlightsLayer: () => set((s) => ({ showFlightsLayer: !s.showFlightsLayer })),
  toggleVesselsLayer: () => set((s) => ({ showVesselsLayer: !s.showVesselsLayer })),
  setVerificationFilter: (v) => set({ verificationFilter: v }),
  setSourceTypeFilter: (v) => set({ sourceTypeFilter: v }),
  setLanguageFilter: (v) => set({ languageFilter: v }),
  setAccuracyMode: (v) => set({ accuracyMode: v }),
  setPrecisionFilter: (v) => set({ precisionFilter: v }),
  setHideAmplified: (v) => set({ hideAmplified: v }),
  setEntityFilter: (entity) => set({ entityFilter: entity }),
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
  applyView: (view) => {
    const { filters = {}, mapState = {} } = view;
    const updates = {};
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
    if (mapState.mapOverlay !== undefined) updates.mapOverlay = mapState.mapOverlay;
    set(updates);
  },

  /** Hydrate filter state from URL search params (called once on mount). */
  initFromURL: (searchParams) => {
    const { filters, mapState } = decodeURLToFilters(searchParams);
    const updates = {};
    if (filters.searchQuery) { updates.searchQuery = filters.searchQuery; updates.debouncedSearch = filters.searchQuery; }
    if (filters.minSeverity) updates.minSeverity = filters.minSeverity;
    if (filters.minConfidence) updates.minConfidence = filters.minConfidence;
    if (filters.dateWindow) updates.dateWindow = filters.dateWindow;
    if (filters.sortMode) updates.sortMode = filters.sortMode;
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
      },
      mapState: { mapOverlay: s.mapOverlay },
    });
  },
}));

export default useFilterStore;
