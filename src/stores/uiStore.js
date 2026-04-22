import { create } from 'zustand';
import { loadViews, saveViews, createView } from '../utils/viewManager.js';

const PANEL_COLLAPSE_KEY = 'mapr:rightRailCollapsed:v1';
const LAST_REGION_KEY = 'mapr:lastRegionIso:v1';

function loadLastRegionIso() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(LAST_REGION_KEY) || null;
  } catch {
    return null;
  }
}

function saveLastRegionIso(iso) {
  if (typeof window === 'undefined') return;
  try {
    if (iso) window.localStorage.setItem(LAST_REGION_KEY, iso);
    else window.localStorage.removeItem(LAST_REGION_KEY);
  } catch {
    /* ignore */
  }
}

const PANEL_KEYS = ['anomaly', 'watchlist', 'narrative', 'liveFeed'];

function loadPanelCollapsed() {
  const fallback = { anomaly: false, watchlist: false, narrative: false, liveFeed: false };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(PANEL_COLLAPSE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      anomaly: !!parsed.anomaly,
      watchlist: !!parsed.watchlist,
      narrative: !!parsed.narrative,
      liveFeed: !!parsed.liveFeed,
    };
  } catch {
    return fallback;
  }
}

function savePanelCollapsed(state) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PANEL_COLLAPSE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / disabled storage */
  }
}

/**
 * UI store — map mode, drawer state, selection, toasts, saved views, timeline.
 */
const useUIStore = create((set, get) => ({
  /* ── map ── */
  mapMode: 'flat',

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

  /* ── panel collapsed state (persisted per-panel) ── */
  panelCollapsed: loadPanelCollapsed(),

  /* ── last region iso (persisted; powers sidebar region link) ── */
  lastRegionIso: loadLastRegionIso(),

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

  selectStory: (story) => set((state) => ({
    selectedStoryId: story.id,
    selectedRegion: story.isoA2 ?? state.selectedRegion,
    selectedArc: null,
  })),

  clearStory: () => set({
    selectedStoryId: null,
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

  setLastRegionIso: (iso) => set(() => {
    const val = iso ? String(iso).toUpperCase() : null;
    saveLastRegionIso(val);
    return { lastRegionIso: val };
  }),

  togglePanelCollapsed: (key) => set((s) => {
    const next = { ...s.panelCollapsed, [key]: !s.panelCollapsed[key] };
    savePanelCollapsed(next);
    return { panelCollapsed: next };
  }),
  setPanelCollapsed: (key, collapsed) => set((s) => {
    const next = { ...s.panelCollapsed, [key]: !!collapsed };
    savePanelCollapsed(next);
    return { panelCollapsed: next };
  }),
  toggleAllPanelsCollapsed: () => set((s) => {
    const collapsedCount = PANEL_KEYS.reduce((n, k) => n + (s.panelCollapsed[k] ? 1 : 0), 0);
    const target = collapsedCount > PANEL_KEYS.length / 2 ? false : true;
    const next = PANEL_KEYS.reduce((acc, k) => { acc[k] = target; return acc; }, {});
    savePanelCollapsed(next);
    return { panelCollapsed: next };
  }),

  /* ── toasts ── */
  addToast: (message, type = 'info') => {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
