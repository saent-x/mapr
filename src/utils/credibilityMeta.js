/**
 * Source reliability / credibility metadata.
 *
 * Reliability tiers based on corroboration ratio (corroborated / total):
 *   high:    >= 0.7   → green
 *   medium:  >= 0.4   → amber
 *   low:     < 0.4    → red
 *   unknown: no data  → grey
 */

import { getReliabilityVisual } from './visualSystem.js';

export const RELIABILITY_TIER_ORDER = ['high', 'medium', 'low', 'unknown'];

/**
 * Determine the reliability tier from a credibility score (0-1).
 * @param {number|null|undefined} score
 * @returns {'high'|'medium'|'low'|'unknown'}
 */
export function getReliabilityTier(score) {
  if (score == null || typeof score !== 'number' || Number.isNaN(score)) {
    return 'unknown';
  }
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

/**
 * Get color/accent metadata for a reliability tier.
 * @param {'high'|'medium'|'low'|'unknown'} tier
 * @returns {object}
 */
export function getReliabilityMeta(tier = 'unknown') {
  return getReliabilityVisual(tier);
}

/**
 * Compute a human-readable reliability label from a score.
 * @param {number|null|undefined} score
 * @returns {string}
 */
export function getReliabilityLabel(score) {
  const tier = getReliabilityTier(score);
  if (tier === 'high') return 'HIGH';
  if (tier === 'medium') return 'MEDIUM';
  if (tier === 'low') return 'LOW';
  return '—';
}

/**
 * Compute average source reliability per ISO country from credibility scores.
 * @param {Array} newsList - Array of news articles
 * @param {Map<string, {score: number}>} credibilityBySourceKey - Map of sourceKey → score
 * @returns {Object<string, {avgScore: number, tier: string, sourceCount: number}>}
 */
export function computePerCountryReliability(newsList, credibilityBySourceKey) {
  const byCountry = {};

  for (const article of newsList) {
    const iso = article.isoA2 || article.region;
    if (!iso) continue;

    const sourceKey = article.source || article.sourceKey || '';
    const cred = credibilityBySourceKey?.[sourceKey];
    if (!cred || cred.score == null) continue;

    if (!byCountry[iso]) {
      byCountry[iso] = { totalScore: 0, count: 0 };
    }
    byCountry[iso].totalScore += cred.score;
    byCountry[iso].count++;
  }

  const result = {};
  for (const iso of Object.keys(byCountry)) {
    const { totalScore, count } = byCountry[iso];
    const avgScore = totalScore / count;
    result[iso] = {
      avgScore: Math.round(avgScore * 100) / 100,
      tier: getReliabilityTier(avgScore),
      sourceCount: count
    };
  }
  return result;
}
