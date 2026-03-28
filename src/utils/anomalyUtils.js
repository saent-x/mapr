/**
 * Anomaly detection utilities — combines velocity spikes and silence detection
 * into a unified anomaly list for the UI.
 *
 * Shared between frontend components and tests.
 */

import { detectSilence } from './silenceDetector.js';

/**
 * Build a unified anomaly list from velocity spikes and silence entries.
 *
 * @param {Object} options
 * @param {Array<{ iso: string, zScore: number, level: 'spike'|'elevated' }>} options.velocitySpikes
 * @param {Array<{ iso: string, status: string }>} options.silenceEntries
 * @returns {Array<{ iso: string, type: string, zScore: number|null, category: 'velocity'|'silence' }>}
 */
export function buildAnomalyList({ velocitySpikes = [], silenceEntries = [] }) {
  const list = [];

  for (const spike of velocitySpikes) {
    list.push({
      iso: spike.iso,
      type: spike.level, // 'spike' or 'elevated'
      zScore: spike.zScore,
      category: 'velocity',
    });
  }

  const SILENCE_ANOMALY_STATUSES = new Set(['anomalous-silence', 'blind-spot', 'limited-access']);

  for (const entry of silenceEntries) {
    if (SILENCE_ANOMALY_STATUSES.has(entry.status)) {
      list.push({
        iso: entry.iso,
        type: entry.status,
        zScore: null,
        category: 'silence',
      });
    }
  }

  // Sort: velocity spikes first (by z-score desc), then silence entries
  list.sort((a, b) => {
    if (a.category !== b.category) return a.category === 'velocity' ? -1 : 1;
    if (a.zScore != null && b.zScore != null) return b.zScore - a.zScore;
    return 0;
  });

  return list;
}

/**
 * Compute silence entries from current article data and historical coverage.
 * Uses the detectSilence function from silenceDetector.js.
 *
 * @param {Object} options
 * @param {Array} options.articles - Current filtered articles
 * @param {Record<string, { count: number }>} options.regionSeverities - Current region data
 * @param {Record<string, Object>} options.coverageStatusByIso - Coverage status map
 * @param {Array<{ iso: string }>} options.velocitySpikes - Already detected spikes (to exclude)
 * @returns {Array<{ iso: string, status: string }>}
 */
export function computeSilenceEntries({
  articles = [],
  regionSeverities = {},
  coverageStatusByIso = {},
  velocitySpikes = [],
}) {
  // Build current counts per ISO
  const currentCounts = {};
  for (const article of articles) {
    const iso = article.isoA2;
    if (iso) {
      currentCounts[iso] = (currentCounts[iso] || 0) + 1;
    }
  }

  // Collect all known regions (from coverage + existing data)
  const allIsos = new Set([
    ...Object.keys(coverageStatusByIso),
    ...Object.keys(regionSeverities),
  ]);

  // Skip regions already flagged as velocity spikes
  const spikeIsos = new Set(velocitySpikes.map((s) => s.iso));

  const entries = [];

  for (const iso of allIsos) {
    if (spikeIsos.has(iso)) continue;

    const currentCount = currentCounts[iso] || 0;
    const regionEntry = regionSeverities[iso];
    // Estimate rolling average from region severity data
    // If a region has historical coverage, use its count as a baseline estimate
    const rollingAverage = regionEntry?.count || 0;

    // Only run silence detection for regions that have had some prior activity
    if (rollingAverage === 0 && currentCount === 0) continue;

    const result = detectSilence({
      iso,
      currentCount,
      rollingAverage: Math.max(rollingAverage, currentCount), // don't flag regions that are at normal levels
      gdeltActive: coverageStatusByIso[iso]?.status === 'developing' || coverageStatusByIso[iso]?.status === 'verified',
    });

    if (result.status !== 'covered') {
      entries.push({ iso, ...result });
    }
  }

  return entries;
}

/**
 * Get anomaly severity level for styling.
 * @param {string} type - The anomaly type
 * @returns {{ color: string, label: string, icon: string }}
 */
export function getAnomalySeverity(type) {
  switch (type) {
    case 'spike':
      return { color: '#ff5577', label: 'Spike', icon: '⚡' };
    case 'elevated':
      return { color: '#ffaa33', label: 'Elevated', icon: '↑' };
    case 'anomalous-silence':
      return { color: '#8b5cf6', label: 'Silence', icon: '◉' };
    case 'blind-spot':
      return { color: '#6b7280', label: 'Blind Spot', icon: '○' };
    case 'limited-access':
      return { color: '#9ca3af', label: 'Limited', icon: '⊘' };
    default:
      return { color: '#6b7280', label: type, icon: '•' };
  }
}
