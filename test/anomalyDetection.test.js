import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSilence, computeSilenceMap } from '../src/utils/silenceDetector.js';
import { computeVelocitySpikes } from '../server/velocityTracker.js';

/* ── buildAnomalyList utility ── */

/**
 * Builds a unified anomaly list from velocity spikes and silence detection.
 * This mirrors the logic used in src/utils/anomalyUtils.js
 */
function buildAnomalyList({ velocitySpikes = [], silenceEntries = [] }) {
  const list = [];

  for (const spike of velocitySpikes) {
    list.push({
      iso: spike.iso,
      type: spike.level, // 'spike' or 'elevated'
      zScore: spike.zScore,
      category: 'velocity',
    });
  }

  for (const entry of silenceEntries) {
    if (entry.status === 'anomalous-silence' || entry.status === 'blind-spot' || entry.status === 'limited-access') {
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

test('buildAnomalyList combines velocity spikes and silence entries', () => {
  const spikes = [
    { iso: 'NG', zScore: 3.5, level: 'spike' },
    { iso: 'SD', zScore: 1.8, level: 'elevated' },
  ];
  const silence = [
    { iso: 'KP', status: 'limited-access' },
    { iso: 'TD', status: 'anomalous-silence' },
    { iso: 'US', status: 'covered' },
  ];

  const result = buildAnomalyList({ velocitySpikes: spikes, silenceEntries: silence });

  // Should have 4 entries (2 spikes + 2 silence, US is covered so excluded)
  assert.equal(result.length, 4);
  // Velocity spikes first, sorted by z-score
  assert.equal(result[0].iso, 'NG');
  assert.equal(result[0].category, 'velocity');
  assert.equal(result[1].iso, 'SD');
  assert.equal(result[1].category, 'velocity');
  // Then silence entries
  assert.equal(result[2].category, 'silence');
  assert.equal(result[3].category, 'silence');
});

test('buildAnomalyList returns empty for no anomalies', () => {
  const result = buildAnomalyList({ velocitySpikes: [], silenceEntries: [] });
  assert.equal(result.length, 0);
});

test('buildAnomalyList handles only velocity spikes', () => {
  const spikes = [{ iso: 'NG', zScore: 4.2, level: 'spike' }];
  const result = buildAnomalyList({ velocitySpikes: spikes, silenceEntries: [] });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'spike');
});

test('buildAnomalyList handles only silence entries', () => {
  const silence = [
    { iso: 'ER', status: 'blind-spot' },
  ];
  const result = buildAnomalyList({ velocitySpikes: [], silenceEntries: silence });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'blind-spot');
});

test('buildAnomalyList excludes covered and sparse statuses', () => {
  const silence = [
    { iso: 'US', status: 'covered' },
    { iso: 'TD', status: 'sparse' },
    { iso: 'KP', status: 'limited-access' },
  ];
  const result = buildAnomalyList({ velocitySpikes: [], silenceEntries: silence });
  // Only 'limited-access' should be included, 'covered' and 'sparse' are not anomalies
  assert.equal(result.length, 1);
  assert.equal(result[0].iso, 'KP');
});

test('velocity spike and silence integration: compute both from region data', () => {
  // Simulate a region with velocity spike
  const regionHistory = {
    'NG': { counts: [2, 3, 2, 3, 2, 3, 2], currentCount: 12 },
    'US': { counts: [10, 12, 11, 10, 12, 11, 10], currentCount: 11 },
  };
  const spikes = computeVelocitySpikes(regionHistory);
  assert.ok(spikes.some(s => s.iso === 'NG'));

  // Simulate silence detection
  const silenceRegions = [
    { iso: 'TD', currentCount: 1, rollingAverage: 10 },
    { iso: 'US', currentCount: 15, rollingAverage: 12 },
  ];
  const silenceMap = computeSilenceMap(silenceRegions);
  assert.equal(silenceMap.TD.status, 'anomalous-silence');

  // Combine
  const silenceEntries = Object.entries(silenceMap).map(([iso, entry]) => ({ iso, ...entry }));
  const anomalies = buildAnomalyList({ velocitySpikes: spikes, silenceEntries });
  assert.ok(anomalies.length > 0);
  assert.ok(anomalies.some(a => a.category === 'velocity'));
  assert.ok(anomalies.some(a => a.category === 'silence'));
});

test('buildSilenceEntries computes silence from article counts and coverage data', () => {
  // Simulate building silence entries from article data
  const articlesByRegion = {
    'NG': 15,
    'TD': 1,
    'KP': 0,
  };
  const historicalAverages = {
    'NG': 12,
    'TD': 10,
    'KP': 0,
  };

  const regions = Object.keys(articlesByRegion).map(iso => ({
    iso,
    currentCount: articlesByRegion[iso],
    rollingAverage: historicalAverages[iso] || 0,
  }));

  const silenceMap = computeSilenceMap(regions);
  assert.equal(silenceMap.NG.status, 'covered');
  assert.equal(silenceMap.TD.status, 'anomalous-silence');
  assert.equal(silenceMap.KP.status, 'limited-access');
});
