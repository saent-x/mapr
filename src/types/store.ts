/* ── Store State & Action Interfaces ── */

import type {
  Article,
  Event,
  CoverageMetrics,
  CoverageDiagnostics,
  SourceHealth,
  VelocitySpike,
  RegionSourcePlan,
  FeedCheck,
} from './api';

// ── filterStore ──────────────────────────────────────────────────────────────

export interface SavedViewFilters {
  searchQuery?: string;
  minSeverity?: number;
  minConfidence?: number;
  dateWindow?: string;
  sortMode?: string;
  verificationFilter?: string;
  sourceTypeFilter?: string;
  languageFilter?: string;
  accuracyMode?: string;
  precisionFilter?: string;
  hideAmplified?: boolean;
  entityFilter?: EntityFilter | null;
}

export interface SavedViewMapState {
  mapOverlay?: string;
}

export interface SavedView {
  id: string;
  name: string;
  filters: SavedViewFilters;
  mapState: SavedViewMapState;
  createdAt?: string;
  [key: string]: unknown;
}

export interface EntityFilter {
  id: string;
  name: string;
  type: string;
}

export interface FilterParams {
  minSeverity: number;
  minConfidence: number;
  dateFloor: Date | null;
  accuracyMode: string;
  verificationFilter: string;
  sourceTypeFilter: string;
  languageFilter: string;
  precisionFilter: string;
  hideAmplified: boolean;
}

export interface URLFilterParams {
  searchQuery?: string;
  minSeverity?: number;
  minConfidence?: number;
  dateWindow?: string;
  sortMode?: string;
  entityFilter?: EntityFilter | null;
}

export interface FilterState {
  searchQuery: string;
  debouncedSearch: string;
  dateWindow: string;
  minSeverity: number;
  minConfidence: number;
  sortMode: string;
  mapOverlay: string;
  showFlightsLayer: boolean;
  showVesselsLayer: boolean;
  verificationFilter: string;
  sourceTypeFilter: string;
  languageFilter: string;
  accuracyMode: string;
  precisionFilter: string;
  hideAmplified: boolean;
  entityFilter: EntityFilter | null;

  setSearchQuery: (q: string) => void;
  setDateWindow: (v: string) => void;
  setMinSeverity: (v: number) => void;
  setMinConfidence: (v: number) => void;
  setSortMode: (v: string) => void;
  setMapOverlay: (v: string) => void;
  setShowFlightsLayer: (v: boolean) => void;
  setShowVesselsLayer: (v: boolean) => void;
  toggleFlightsLayer: () => void;
  toggleVesselsLayer: () => void;
  setVerificationFilter: (v: string) => void;
  setSourceTypeFilter: (v: string) => void;
  setLanguageFilter: (v: string) => void;
  setAccuracyMode: (v: string) => void;
  setPrecisionFilter: (v: string) => void;
  setHideAmplified: (v: boolean) => void;
  setEntityFilter: (entity: EntityFilter) => void;
  clearEntityFilter: () => void;
  getFilterParams: () => FilterParams;
  applyView: (view: SavedView) => void;
  initFromURL: (searchParams: URLSearchParams) => { filters: URLFilterParams; mapState: SavedViewMapState };
  toURLParams: () => string;
}

// ── newsStore ────────────────────────────────────────────────────────────────

export interface RegionBackfillEntry {
  iso: string;
  region: string;
  status: 'loading' | 'done' | 'empty' | 'error';
  events: Event[];
  sourcePlan?: RegionSourcePlan;
  feedChecks?: FeedCheck[];
  fetchedAt?: string;
  touchedAt?: number;
}

export interface NewsState {
  liveNews: Article[] | null;
  backendEvents: Event[];
  // 'unavailable' replaces the old 'mock' state — when data can't be
  // fetched the UI shows an honest error, never fabricated mock entries.
  dataSource: 'loading' | 'live' | 'unavailable';
  dataError: string | null;
  lastDataLoadTime: number | null;
  sourceHealth: { gdelt: unknown; rss: unknown; backend: unknown };
  coverageTrends: unknown;
  coverageHistory: unknown;
  opsHealth: unknown;
  velocitySpikes: VelocitySpike[];

  regionBackfills: Record<string, RegionBackfillEntry>;
  regionCoverageHistory: unknown;

  sessionDiff: unknown;
  snapshotHistory: unknown[];

  historicalState: { snapshots: unknown[]; from: string; to: string } | null;
  comparisonMode: 'overlay' | 'side-by-side' | null;
  comparisonPeriods: {
    period1: { snapshots: unknown[]; from: string; to: string };
    period2: { snapshots: unknown[]; from: string; to: string };
  } | null;
  isTimeTravel: boolean;
  availableTimestamps: string[];

  loadLiveData: (opts?: { forceRefresh?: boolean; addToast?: (msg: string, type?: string) => void }) => Promise<void>;
  refresh: (addToast?: (msg: string, type?: string) => void) => void;
  startAutoRefresh: (addToast?: (msg: string, type?: string) => void) => void;
  stopAutoRefresh: () => void;
  _initSessionMemory: (articles: Article[]) => Promise<void>;
  loadSnapshotHistory: () => Promise<void>;
  saveCurrentSnapshot: () => Promise<void>;
  loadAvailableTimestamps: () => Promise<void>;
  loadHistoricalState: (from: string, to: string) => Promise<void>;
  loadComparisonPeriods: (
    period1: { from: string; to: string },
    period2: { from: string; to: string }
  ) => Promise<void>;
  setComparisonMode: (mode: 'overlay' | 'side-by-side' | null) => void;
  setTimeTravel: (enabled: boolean) => void;
  exitHistoricalMode: () => void;
  fetchRegionCoverage: (iso: string) => Promise<void>;
  setRegionBackfill: (entry: RegionBackfillEntry) => void;
  clearRegionBackfills: () => void;
  fetchRegionBackfill: (
    iso: string,
    regionName: string,
    opts?: { sortMode?: string; coverageDiagnostics?: CoverageDiagnostics }
  ) => Promise<void>;
}

// ── uiStore ──────────────────────────────────────────────────────────────────

export interface Toast {
  id: string;
  message: string;
  type: string;
}

export interface PanelCollapsed {
  anomaly: boolean;
  watchlist: boolean;
  narrative: boolean;
  liveFeed: boolean;
}

export interface SearchResultRegion {
  type: 'region';
  iso: string;
}

export interface SearchResultStory {
  type: 'story';
  story: { id: string; isoA2?: string; [key: string]: unknown };
}

export type SearchResult = SearchResultRegion | SearchResultStory;

export interface UIState {
  mapMode: 'flat' | 'globe';
  drawerMode: string | null;
  selectedRegion: string | null;
  selectedStoryId: string | null;
  selectedArc: unknown;
  showExport: boolean;
  scrubTime: Date | null;
  toasts: Toast[];
  panelCollapsed: PanelCollapsed;
  lastRegionIso: string | null;
  savedViews: SavedView[];
  activeViewId: string | null;
  viewNotFound: boolean;

  setMapMode: (mode: 'flat' | 'globe') => void;
  toggleMapMode: () => void;
  setDrawerMode: (mode: string | null) => void;
  toggleDrawer: (mode: string) => void;
  selectRegion: (iso: string) => void;
  selectStory: (story: { id: string; isoA2?: string }) => void;
  clearStory: () => void;
  selectArc: (arc: unknown) => void;
  closePanel: () => void;
  setShowExport: (v: boolean) => void;
  setScrubTime: (v: Date | null) => void;
  setLastRegionIso: (iso: string | null) => void;
  togglePanelCollapsed: (key: keyof PanelCollapsed) => void;
  setPanelCollapsed: (key: keyof PanelCollapsed, collapsed: boolean) => void;
  toggleAllPanelsCollapsed: () => void;
  addToast: (message: string, type?: string) => void;
  saveCurrentView: (name: string, filterState: SavedViewFilters, mapState: SavedViewMapState) => void;
  selectView: (view: SavedView) => void;
  setActiveViewId: (id: string | null) => void;
  setViewNotFound: (v: boolean) => void;
  deleteView: (view: SavedView) => void;
  handleSearchSelect: (result: SearchResult) => void;
  initFromURL: (searchParams: URLSearchParams, mapState?: { mapMode?: string }) => void;
}

// ── watchStore ───────────────────────────────────────────────────────────────

export type WatchItemType =
  | 'region'
  | 'topic'
  | 'entity'
  | 'category'
  | 'severity'
  | 'sourceType'
  | 'verificationStatus';

export interface WatchItem {
  id: string;
  type: WatchItemType;
  value: string;
  label: string;
  addedAt: string;
}

export interface WatchNotification {
  watchId: string;
  label: string;
  type: string;
  newCount: number;
  totalCount: number;
  timestamp: number;
}

export interface WatchState {
  watchItems: WatchItem[];
  matchCounts: Record<string, number>;
  lastMatchTimestamps: Record<string, number>;
  notifications: WatchNotification[];

  addWatch: (type: WatchItemType, value: string, label?: string) => void;
  removeWatch: (id: string) => void;
  clearAll: () => void;
  checkNewArticles: (articles: Article[]) => void;
  clearNotifications: () => void;
  getNotificationCount: () => number;
}

// ── subscriptionStore ────────────────────────────────────────────────────────

export type SubscriptionTier = 'free' | 'pro' | 'enterprise';

export interface SubscriptionState {
  status: SubscriptionTier;
  isLoading: boolean;
  isAuthenticated: boolean;
  stripeCustomerId: string | null;
  userId: string | null;

  initFromUser: (user: { id: string; [key: string]: unknown } | null) => Promise<void>;
  setStatus: (status: SubscriptionTier) => void;
  reset: () => void;
}
