/**
 * Pipeline Stage 7: Persistence
 *
 * Handles all database persistence operations: articles, events, pruning,
 * snapshots, history, and coverage data.
 */

import {
  appendHistory,
  enforceDbSizeLimit,
  getDbSize,
  linkArticlesToEvent,
  pruneOrphanedArticles,
  pruneResolvedEvents,
  upsertArticles,
  writeCoverageHistory,
  writeSnapshot
} from '../storage.js';

/**
 * Persist articles to the database.
 *
 * @param {Array} articles - Deduplicated, enriched articles
 * @returns {Promise<void>}
 */
export async function persistArticles(articles) {
  console.log(`[ingest] Persisting ${articles.length} articles...`);
  await upsertArticles(articles);
  console.log(`[ingest] Articles persisted.`);
}

/**
 * Prune old resolved events and orphaned articles.
 *
 * @param {Object} options
 * @param {number} options.resolvedDays - Days after which resolved events are pruned (default 30)
 * @param {number} options.orphanDays - Days after which orphaned articles are pruned (default 7)
 * @returns {Promise<void>}
 */
export async function pruneOldData({ resolvedDays = 30, orphanDays = 7 } = {}) {
  await pruneResolvedEvents(resolvedDays);
  await pruneOrphanedArticles(orphanDays);
  // Enforce DB size cap (default 400 MB, hard ceiling 500 MB).
  // Trims oldest articles when over the soft limit; no-op below.
  try {
    const result = await enforceDbSizeLimit();
    if (result.deletedArticles > 0) {
      console.log(`[ingest] DB size trim: ${result.startMb} → ${result.endMb} MB (deleted ${result.deletedArticles} articles)`);
    }
  } catch (err) {
    console.warn('[ingest] enforceDbSizeLimit failed:', err.message);
  }
}

export { getDbSize, enforceDbSizeLimit };

/**
 * Write the final snapshot to storage.
 *
 * @param {Object} snapshot - The snapshot object to persist
 * @returns {Promise<void>}
 */
export async function persistSnapshot(snapshot) {
  await writeSnapshot(snapshot);
}

/**
 * Write coverage history to storage.
 *
 * @param {Array} history - Coverage history array
 * @returns {Promise<void>}
 */
export async function persistCoverageHistory(history) {
  await writeCoverageHistory(history);
}

/**
 * Append an ingestion history entry.
 *
 * @param {Object} entry - History entry object
 * @returns {Promise<void>}
 */
export async function persistHistoryEntry(entry) {
  await appendHistory(entry);
}

/**
 * Build a history entry for the ingestion run.
 *
 * @param {Object} options
 * @param {string} options.status - 'ok' or 'failed'
 * @param {string} options.reason - Reason for the ingest run
 * @param {number} options.startedAt - Timestamp when the run started (Date.now())
 * @param {Array} options.articles - Articles array (for count)
 * @param {Array} options.events - Events array (for count)
 * @param {string} options.error - Error message if failed
 * @returns {Object} History entry
 */
export function buildHistoryEntry({ status, reason, startedAt, articles, events, error }) {
  return {
    at: new Date().toISOString(),
    status,
    reason,
    durationMs: Date.now() - startedAt,
    articleCount: articles?.length || 0,
    eventCount: events?.length || 0,
    error: error || null
  };
}
