/**
 * Velocity tracker with z-score anomaly detection.
 * Identifies regions with abnormal event count spikes.
 */

// Cap z-scores so a zero-variance baseline with sudden activity doesn't
// inject `Infinity` into severity / baseline-ratio math downstream.
const MAX_Z_SCORE = 10;

function clampZScore(z) {
  if (!Number.isFinite(z)) return z > 0 ? MAX_Z_SCORE : 0;
  if (z > MAX_Z_SCORE) return MAX_Z_SCORE;
  if (z < -MAX_Z_SCORE) return -MAX_Z_SCORE;
  return z;
}

/**
 * Compute the z-score of a current value relative to a historical baseline.
 *
 * @param {number} current - The current observation.
 * @param {number[]} history - Array of past observations.
 * @returns {number} The z-score, or 0 if history is empty / zero stddev / zero mean.
 */
export function computeZScore(current, history) {
  if (!history || history.length === 0) return 0;
  if (!Number.isFinite(current)) return 0;

  const finite = history.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return 0;

  const n = finite.length;
  const mean = finite.reduce((sum, v) => sum + v, 0) / n;
  const variance = finite.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  if (stddev === 0) {
    if (mean === 0) {
      // Flat-zero baseline: any positive current is "a spike" but capped, not Infinity.
      return current > 0 ? clampZScore(MAX_Z_SCORE) : 0;
    }
    return clampZScore((current - mean) / (mean / 2));
  }

  return clampZScore((current - mean) / stddev);
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
