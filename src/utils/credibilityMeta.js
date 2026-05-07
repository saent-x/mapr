/**
 * Source reliability / credibility metadata.
 *
 * Reliability tiers based on corroboration ratio (corroborated / total):
 *   high:    >= 0.7   → green
 *   medium:  >= 0.4   → amber
 *   low:     < 0.4    → red
 *   unknown: no data  → grey
 */

const RELIABILITY_META = {
  high: {
    accent: '#4ce39c',
    fill: 'rgba(76, 227, 156, 0.18)',
    hoverFill: 'rgba(76, 227, 156, 0.26)',
    selectedFill: 'rgba(76, 227, 156, 0.34)',
    stroke: 'rgba(76, 227, 156, 0.36)',
    labelKey: 'highReliability',
    dotColor: '#4ce39c'
  },
  medium: {
    accent: '#ffbe63',
    fill: 'rgba(255, 190, 99, 0.16)',
    hoverFill: 'rgba(255, 190, 99, 0.24)',
    selectedFill: 'rgba(255, 190, 99, 0.32)',
    stroke: 'rgba(255, 190, 99, 0.34)',
    labelKey: 'mediumReliability',
    dotColor: '#ffbe63'
  },
  low: {
    accent: '#ff5f7a',
    fill: 'rgba(255, 95, 122, 0.16)',
    hoverFill: 'rgba(255, 95, 122, 0.24)',
    selectedFill: 'rgba(255, 95, 122, 0.32)',
    stroke: 'rgba(255, 95, 122, 0.35)',
    labelKey: 'lowReliability',
    dotColor: '#ff5f7a'
  },
  unknown: {
    accent: 'rgba(255, 255, 255, 0.3)',
    fill: 'rgba(255, 255, 255, 0.02)',
    hoverFill: 'rgba(255, 255, 255, 0.05)',
    selectedFill: 'rgba(255, 255, 255, 0.08)',
    stroke: 'rgba(255, 255, 255, 0.1)',
    labelKey: 'noReliabilityData',
    dotColor: 'rgba(255, 255, 255, 0.3)'
  }
};

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
  return RELIABILITY_META[tier] || RELIABILITY_META.unknown;
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
