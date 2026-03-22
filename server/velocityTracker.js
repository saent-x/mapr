/**
 * Velocity tracker with z-score anomaly detection.
 * Identifies regions with abnormal event count spikes.
 */

/**
 * Compute the z-score of a current value relative to a historical baseline.
 *
 * @param {number} current - The current observation.
 * @param {number[]} history - Array of past observations.
 * @returns {number} The z-score, or 0 if history is empty or has zero std dev.
 */
export function computeZScore(current, history) {
  if (!history || history.length === 0) return 0;

  const n = history.length;
  const mean = history.reduce((sum, v) => sum + v, 0) / n;
  const variance = history.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  if (stddev === 0) {
    // All history values are identical; use half the mean as a proxy for scale
    // so that a meaningful z-score can still be returned.
    if (mean === 0) return current > 0 ? Infinity : 0;
    return (current - mean) / (mean / 2);
  }

  return (current - mean) / stddev;
}

/**
 * Evaluate velocity spikes across multiple regions.
 *
 * @param {Record<string, { counts: number[], currentCount: number }>} regionHistory
 *   A map of ISO region code to its historical counts and current count.
 * @returns {{ iso: string, zScore: number, level: 'spike' | 'elevated' }[]}
 *   Regions that exceed anomaly thresholds, sorted by z-score descending.
 */
export function computeVelocitySpikes(regionHistory) {
  const SPIKE_THRESHOLD = 2.0;
  const ELEVATED_THRESHOLD = 1.5;

  const results = [];

  for (const [iso, { counts, currentCount }] of Object.entries(regionHistory)) {
    const zScore = computeZScore(currentCount, counts);

    if (zScore >= SPIKE_THRESHOLD) {
      results.push({ iso, zScore, level: 'spike' });
    } else if (zScore >= ELEVATED_THRESHOLD) {
      results.push({ iso, zScore, level: 'elevated' });
    }
  }

  results.sort((a, b) => b.zScore - a.zScore);
  return results;
}
