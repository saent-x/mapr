/**
 * Pipeline Stage 7: Persistence
 *
 * Handles all database persistence operations: articles, events, pruning,
 * snapshots, history, and coverage data.
 */

import {
  appendCoverageSnapshot,
  appendHistory,
  enforceDbSizeLimit,
  getDbSize,
  linkArticlesToEvent,
  persistSnapshotHistory,
  pruneOrphanedArticles,
  pruneResolvedEvents,
  upsertArticles,
  writeCoverageHistory,
  writeSnapshot
} from '../storage.js';
import { getQueue, QUEUE_NAMES, isQueueEnabled } from '../queue/index.js';

const EMBED_BATCH_SIZE = 32;

async function enqueueEmbeddingJobs(articles) {
  if (!isQueueEnabled() || !articles?.length) return;
  const queue = getQueue(QUEUE_NAMES.EMBED_ARTICLE);
  if (!queue) return;
  const ids = articles.map((a) => a.id).filter(Boolean);
  const jobs = [];
  for (let i = 0; i < ids.length; i += EMBED_BATCH_SIZE) {
    const batch = ids.slice(i, i + EMBED_BATCH_SIZE);
    jobs.push({
      name: QUEUE_NAMES.EMBED_ARTICLE,
      data: { articleIds: batch },
    });
  }
  if (jobs.length) {
    try { await queue.addBulk(jobs); }
    catch (err) { console.warn('[ingest] embed enqueue failed:', err.message); }
  }
}

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
  // Best-effort: enqueue embedding jobs for the freshly upserted set.
  // Silent no-op when REDIS_URL isn't set or the queue connection drops.
  await enqueueEmbeddingJobs(articles).catch((err) => {
    console.warn('[ingest] enqueueEmbeddingJobs failed:', err.message);
  });
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
  // Also persist to snapshot_history for historical queries
  // Build a lightweight historical entry with summary data (not full article list)
  const historyEntry = {
    at: snapshot?.fetchedAt || new Date().toISOString(),
    articleCount: snapshot?.articles?.length || 0,
    eventCount: snapshot?.events?.length || 0,
    sourceHealth: snapshot?.sourceHealth || {},
    velocitySpikes: snapshot?.velocitySpikes || [],
    coverageMetrics: snapshot?.coverageMetrics || null,
    ingestHealth: snapshot?.ingestHealth || null,
    // Store a representative sample: top severity events + full event IDs
    eventSummary: (snapshot?.events || []).slice(0, 50).map(e => ({
      id: e.id,
      title: e.title,
      severity: e.severity,
      lifecycle: e.lifecycle,
      primaryCountry: e.primaryCountry,
      category: e.category,
    })),
  };
  await persistSnapshotHistory(historyEntry);
}

/**
 * Persist coverage history.
 *
 * Accepts either a single new entry (preferred — append-only, ~2 row writes)
 * or a full history array (legacy — DELETE-all + reinsert). Detects shape:
 * arrays are treated as the legacy bootstrap path; plain objects as a single
 * entry to append.
 *
 * @param {Array|Object} historyOrEntry - Full array (legacy) or one entry
 * @param {number} [limit=48] - Max rows kept when appending
 */
export async function persistCoverageHistory(historyOrEntry, limit = 48) {
  if (Array.isArray(historyOrEntry)) {
    await writeCoverageHistory(historyOrEntry);
    return;
  }
  if (historyOrEntry && typeof historyOrEntry === 'object') {
    await appendCoverageSnapshot(historyOrEntry, limit);
  }
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
