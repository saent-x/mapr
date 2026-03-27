/**
 * Pipeline Stage Barrel Exports
 *
 * Re-exports all pipeline stages for convenient import.
 * The ingestion pipeline flows through these stages in order:
 *
 *   1. fetchSources     → Fetch from GDELT + RSS + HTML sources
 *   2. normalizeArticles → Merge multi-source articles and deduplicate
 *   3. enrichEntities    → Run NER to extract people, orgs, locations
 *   4. trackVelocity     → Compute per-region article velocity and detect spikes
 *   5. correlateEvents   → Group articles into events, compute lifecycle/severity
 *   6. persistData       → Write articles, events, snapshots to database
 */

export {
  fetchAllSources,
  fetchRssNewsDirect,
  fetchRegionRssBackfill,
  getRegionBackfillFeedPlan,
  createEmptyRssHealth,
  getArticleFeedId,
  buildRssHealthFromCatalog,
  mergeRssArticles,
  retainPreviousGdeltArticles
} from './fetchSources.js';

export { mergeAndDeduplicateArticles } from './normalizeArticles.js';

export { enrichArticlesWithEntities } from './enrichEntities.js';

export { trackAndComputeVelocity } from './trackVelocity.js';

export {
  correlateAndEnrichEvents,
  persistEnrichedEvents
} from './correlateEvents.js';

export {
  persistArticles,
  pruneOldData,
  persistSnapshot,
  persistCoverageHistory,
  persistHistoryEntry,
  buildHistoryEntry
} from './persistData.js';

export {
  isCircuitOpen,
  recordSuccess,
  recordFailure,
  getCircuitStates,
  getCircuitSummary,
  resetAllCircuits,
  resetCircuit
} from '../circuitBreaker.js';
