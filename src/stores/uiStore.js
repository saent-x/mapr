import { create } from 'zustand';
import { loadViews, saveViews, createView } from '../utils/viewManager.js';

/**
 * UI store — map mode, drawer state, selection, toasts, saved views, timeline.
 */
const useUIStore = create((set, get) => ({
  /* ── map ── */
  mapMode: typeof window !== 'undefined' && window.innerWidth < 768 ? 'flat' : 'globe',

  /* ── drawer ── */
  drawerMode: null, // null | 'filters' | 'intel'

  /* ── selection ── */
  selectedRegion: null,
  selectedStoryId: null,
  selectedArc: null,

  /* ── export modal ── */
  showExport: false,

  /* ── timeline ── */
  scrubTime: null, // null = live, Date = historical

  /* ── toasts ── */
  toasts: [],

  /* ── saved views ── */
  savedViews: typeof window !== 'undefined' ? loadViews() : [],
  activeViewId: null,

  /* ────────── actions ────────── */

  setMapMode: (mode) => set({ mapMode: mode }),
  toggleMapMode: () => set((s) => ({ mapMode: s.mapMode === 'globe' ? 'flat' : 'globe' })),

  setDrawerMode: (mode) => set({ drawerMode: mode }),
  toggleDrawer: (mode) => set((s) => ({ drawerMode: s.drawerMode === mode ? null : mode })),

  selectRegion: (iso) => set((s) => ({
    selectedRegion: s.selectedRegion === iso ? null : iso,
    selectedStoryId: null,
    selectedArc: null,
  })),

  selectStory: (story) => set({
    selectedStoryId: story.id,
    selectedRegion: story.isoA2,
    selectedArc: null,
  }),

  selectArc: (arc) => set({
    selectedArc: arc,
    selectedRegion: null,
    selectedStoryId: null,
  }),

  closePanel: () => set({
    selectedRegion: null,
    selectedStoryId: null,
    selectedArc: null,
  }),

  setShowExport: (v) => set({ showExport: v }),
  setScrubTime: (v) => set({ scrubTime: v }),

  /* ── toasts ── */
  addToast: (message, type = 'info') => {
    const id = Date.now();
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },

  /* ── saved views ── */
  saveCurrentView: (name, filterState, mapState) => {
    if (!name?.trim()) return;
    const view = createView(name.trim(), filterState, mapState);
    set((s) => {
      const next = [...s.savedViews, view];
      saveViews(next);
      return { savedViews: next, activeViewId: view.id };
    });
  },

  selectView: (view) => set({ activeViewId: view.id }),

  deleteView: (view) => set((s) => {
    const next = s.savedViews.filter((v) => v.id !== view.id);
    saveViews(next);
    return {
      savedViews: next,
      activeViewId: s.activeViewId === view.id ? null : s.activeViewId,
    };
  }),

  /** Convenience handler for search-result selection (region or story). */
  handleSearchSelect: (result) => {
    if (result.type === 'region') {
      set({ selectedRegion: result.iso, selectedStoryId: null });
    } else if (result.type === 'story') {
      set({ selectedStoryId: result.story.id, selectedRegion: result.story.isoA2 });
    }
  },

  /** Read from URL params on mount (region, story, mapMode). */
  initFromURL: (searchParams, mapState) => {
    const updates = {};
    if (mapState?.mapMode) updates.mapMode = mapState.mapMode;
    const selectedRegion = searchParams.get('region') || null;
    if (selectedRegion) updates.selectedRegion = selectedRegion;
    const story = searchParams.get('story') || null;
    if (story) updates.selectedStoryId = story;
    if (Object.keys(updates).length > 0) set(updates);
  },
}));

export default useUIStore;
