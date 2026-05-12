/* ── API Response Interfaces ── */

export interface BriefingMeta {
  source: string;
  fetchedAt: string | null;
  snapshotAgeMs: number;
  refreshInProgress: boolean;
  stale: boolean;
  loadedFromDisk: boolean;
}

export interface Article {
  id: string;
  title: string;
  description?: string;
  isoA2?: string;
  region?: string;
  url?: string;
  source?: string;
  sourceType?: string;
  publishedAt?: string;
  severity?: number;
  confidence?: number;
  categories?: string[];
  entities?: Entity[];
  verified?: boolean;
  amplified?: boolean;
  language?: string;
  precision?: string;
  accuracyTier?: string;
  [key: string]: unknown;
}

export interface Entity {
  name: string;
  type?: string;
  [key: string]: unknown;
}

export interface Event {
  id: string;
  title: string;
  description?: string;
  isoA2?: string;
  region?: string;
  severity?: number;
  confidence?: number;
  lat?: number;
  lng?: number;
  timestamp?: string;
  categories?: string[];
  entities?: Entity[];
  sources?: string[];
  articleIds?: string[];
  articleCount?: number;
  supportingArticles?: Article[];
  verified?: boolean;
  amplified?: boolean;
  [key: string]: unknown;
}

export interface VelocitySpike {
  id?: string;
  isoA2?: string;
  region?: string;
  count?: number;
  severity?: number;
  timestamp?: string;
  [key: string]: unknown;
}

export interface CoverageMetrics {
  totalRegions?: number;
  coveredRegions?: number;
  averageCoverage?: number;
  [key: string]: unknown;
}

export interface CoverageDiagnostics {
  [iso: string]: {
    status?: string;
    confidence?: number;
    reasoning?: string;
    activeFeeds?: number;
    failedFeeds?: number;
    emptyFeeds?: number;
    [key: string]: unknown;
  };
}

export interface SourceHealth {
  gdelt: { status?: string; lastCheck?: string; [key: string]: unknown } | null;
  rss: { status?: string; feeds?: FeedCheck[]; [key: string]: unknown } | null;
  backend?: { status?: string; [key: string]: unknown };
}

export interface FeedCheck {
  url?: string;
  country?: string;
  status?: string;
  lastCheck?: string;
  articleCount?: number;
  [key: string]: unknown;
}

export interface RegionSourcePlan {
  feeds?: FeedCheck[];
  totalFeeds?: number;
  [key: string]: unknown;
}

export interface BriefingResponse {
  meta: BriefingMeta;
  articles: Article[];
  events: Event[];
  velocitySpikes: VelocitySpike[];
  coverageMetrics: CoverageMetrics;
  coverageDiagnostics: CoverageDiagnostics;
  sourceHealth: SourceHealth;
}

export interface RegionBriefing {
  iso: string;
  region: string;
  fetchedAt: string;
  fromSnapshot?: boolean;
  articles: Article[];
  events: Event[];
  sourcePlan: RegionSourcePlan;
  feedChecks: FeedCheck[];
}

export interface HealthResponse {
  status: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  refreshInProgress: boolean;
  snapshotAgeMs: number;
  snapshotPath: string;
  storagePath: string;
  storageBackend: string;
  sourceCatalog: unknown;
  history: unknown[];
  coverageTrends: unknown;
  coverageMetrics: CoverageMetrics;
  coverageDiagnostics: CoverageDiagnostics;
  sourceHealth: SourceHealth;
  circuitBreaker?: unknown;
  regionLag?: unknown;
  opsAlerts?: unknown;
}

export interface CoverageHistoryResponse {
  snapshots: unknown[];
  transitions: unknown[];
  trends: unknown;
  regionSeries?: unknown[];
}

export interface SnapshotHistoryResponse {
  snapshots: unknown[];
  from?: string;
  to?: string;
}

export interface SnapshotTimestampsResponse {
  timestamps: string[];
}
