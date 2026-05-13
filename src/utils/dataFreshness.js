/**
 * Pure utility functions for data freshness calculations.
 * Separated from the React hook so tests can import them without
 * pulling in the Zustand store dependency chain.
 */

export const GREEN_THRESHOLD = 5 * 60 * 1000;   // 5 minutes
export const AMBER_THRESHOLD = 15 * 60 * 1000;  // 15 minutes

/**
 * Formats a duration in milliseconds into a human-readable pair.
 * @param {number} ms
 * @returns {{ value: number, unit: 's' | 'm' | 'h' | 'd' }}
 */
export function formatAge(ms) {
  if (ms < 60_000) {
    return { value: Math.max(1, Math.floor(ms / 1000)), unit: 's' };
  }
  if (ms < 3_600_000) {
    return { value: Math.floor(ms / 60_000), unit: 'm' };
  }
  if (ms < 86_400_000) {
    return { value: Math.floor(ms / 3_600_000), unit: 'h' };
  }
  return { value: Math.floor(ms / 86_400_000), unit: 'd' };
}

/**
 * Determines the color class based on data age.
 * @param {number} ageMs - Age in milliseconds
 * @returns {'green' | 'amber' | 'red'}
 */
export function getFreshnessColor(ageMs) {
  if (ageMs < GREEN_THRESHOLD) return 'green';
  if (ageMs < AMBER_THRESHOLD) return 'amber';
  return 'red';
}
