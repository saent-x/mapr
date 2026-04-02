/**
 * Pipeline Stage: Velocity Tracking
 *
 * Computes article velocity per region and detects velocity spikes
 * (anomalous increases in article volume for a region).
 */

import {
  upsertVelocityBucket,
  readVelocityHistory
} from '../storage.js';
import { computeVelocitySpikes } from '../velocityTracker.js';

/**
 * Track article velocity and compute spikes.
 *
 * Groups articles by ISO country code, records the current bucket count,
 * compares against historical data, and detects velocity spikes.
 *
 * @param {Array} articles - Merged article array
 * @param {Object} [options]
 * @param {Set|Array} [options.previousArticleIds] - IDs of articles from the previous snapshot (to count only new ones)
 * @returns {Promise<Array>} Velocity spikes array with { iso, zScore, classification }
 */
export async function trackAndComputeVelocity(articles, { previousArticleIds } = {}) {
  // Compute 2-hour bucket timestamp (rounded to even hours)
  const nowDate = new Date();
  const bucketHour = Math.floor(nowDate.getUTCHours() / 2) * 2;
  const bucketAt = `${nowDate.toISOString().slice(0, 10)}T${String(bucketHour).padStart(2, '0')}`;

  // Count only NEW articles per ISO code (not retained from previous snapshot)
  const prevIds = previousArticleIds instanceof Set ? previousArticleIds : new Set(previousArticleIds || []);
  const newArticles = prevIds.size > 0 ? articles.filter(a => !prevIds.has(a.id)) : articles;
  const isoCounts = {};
  for (const article of newArticles) {
    const iso = article.isoA2;
    if (iso) {
      isoCounts[iso] = (isoCounts[iso] || 0) + 1;
    }
  }

  // Persist velocity buckets and build history map
  const regionHistory = {};
  for (const [iso, count] of Object.entries(isoCounts)) {
    await upsertVelocityBucket(iso, bucketAt, count);
    const historyRows = await readVelocityHistory(iso, 7);
    const counts = historyRows
      .filter(row => row.bucketAt !== bucketAt)
      .map(row => row.articleCount);
    regionHistory[iso] = { counts, currentCount: count };
  }

  // Compute velocity spikes
  return computeVelocitySpikes(regionHistory);
}
