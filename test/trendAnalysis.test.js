import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegionTimeSeries } from '../src/utils/coverageHistory.js';

describe('buildRegionTimeSeries', () => {
  const mockHistory = [
    {
      at: '2024-03-28T12:00:00Z',
      countries: [
        { iso: 'US', region: 'United States', status: 'verified', eventCount: 12, verifiedCount: 10, maxConfidence: 85, feedCount: 5, failedFeeds: 0 },
        { iso: 'RU', region: 'Russia', status: 'developing', eventCount: 8, verifiedCount: 5, maxConfidence: 70, feedCount: 3, failedFeeds: 1 },
        { iso: 'CN', region: 'China', status: 'developing', eventCount: 6, verifiedCount: 3, maxConfidence: 60, feedCount: 2, failedFeeds: 0 },
        { iso: 'UA', region: 'Ukraine', status: 'verified', eventCount: 10, verifiedCount: 8, maxConfidence: 80, feedCount: 4, failedFeeds: 0 },
      ]
    },
    {
      at: '2024-03-28T11:00:00Z',
      countries: [
        { iso: 'US', region: 'United States', status: 'verified', eventCount: 10, verifiedCount: 9, maxConfidence: 83, feedCount: 5, failedFeeds: 0 },
        { iso: 'RU', region: 'Russia', status: 'developing', eventCount: 7, verifiedCount: 4, maxConfidence: 68, feedCount: 3, failedFeeds: 1 },
        { iso: 'CN', region: 'China', status: 'developing', eventCount: 5, verifiedCount: 2, maxConfidence: 58, feedCount: 2, failedFeeds: 0 },
        { iso: 'UA', region: 'Ukraine', status: 'verified', eventCount: 9, verifiedCount: 7, maxConfidence: 78, feedCount: 4, failedFeeds: 0 },
      ]
    },
    {
      at: '2024-03-28T10:00:00Z',
      countries: [
        { iso: 'US', region: 'United States', status: 'verified', eventCount: 8, verifiedCount: 7, maxConfidence: 80, feedCount: 5, failedFeeds: 0 },
        { iso: 'RU', region: 'Russia', status: 'developing', eventCount: 5, verifiedCount: 3, maxConfidence: 65, feedCount: 3, failedFeeds: 1 },
        { iso: 'CN', region: 'China', status: 'low-confidence', eventCount: 3, verifiedCount: 1, maxConfidence: 45, feedCount: 2, failedFeeds: 0 },
      ]
    }
  ];

  it('returns timestamps in chronological order (oldest first)', () => {
    const result = buildRegionTimeSeries(mockHistory);
    assert.ok(result.timestamps.length === 3);
    assert.ok(new Date(result.timestamps[0]) < new Date(result.timestamps[1]));
    assert.ok(new Date(result.timestamps[1]) < new Date(result.timestamps[2]));
  });

  it('returns region data keyed by iso code', () => {
    const result = buildRegionTimeSeries(mockHistory);
    assert.ok(result.regions.US);
    assert.ok(result.regions.RU);
    assert.ok(result.regions.CN);
    assert.ok(result.regions.UA);
  });

  it('includes region name and event count arrays', () => {
    const result = buildRegionTimeSeries(mockHistory);
    assert.equal(result.regions.US.name, 'United States');
    assert.ok(Array.isArray(result.regions.US.counts));
    assert.equal(result.regions.US.counts.length, 3);
  });

  it('counts are in chronological order matching timestamps', () => {
    const result = buildRegionTimeSeries(mockHistory);
    // Oldest snapshot first: 8, 10, 12
    assert.deepEqual(result.regions.US.counts, [8, 10, 12]);
    assert.deepEqual(result.regions.RU.counts, [5, 7, 8]);
  });

  it('fills missing regions in earlier snapshots with 0', () => {
    const result = buildRegionTimeSeries(mockHistory);
    // UA only appears in first two snapshots (newest), not in third (oldest)
    assert.deepEqual(result.regions.UA.counts, [0, 9, 10]);
  });

  it('ranks regions by latest event count descending', () => {
    const result = buildRegionTimeSeries(mockHistory);
    const isos = Object.keys(result.regions);
    const latestCounts = isos.map((iso) => result.regions[iso].counts.at(-1));
    for (let i = 1; i < latestCounts.length; i++) {
      assert.ok(latestCounts[i] <= latestCounts[i - 1], `regions not sorted: ${latestCounts}`);
    }
  });

  it('respects topN limit', () => {
    const result = buildRegionTimeSeries(mockHistory, { topN: 2 });
    assert.equal(Object.keys(result.regions).length, 2);
    assert.ok(result.regions.US);
    assert.ok(result.regions.UA);
  });

  it('handles empty history', () => {
    const result = buildRegionTimeSeries([]);
    assert.deepEqual(result.timestamps, []);
    assert.deepEqual(result.regions, {});
  });

  it('handles null/undefined history', () => {
    const result = buildRegionTimeSeries(null);
    assert.deepEqual(result.timestamps, []);
    assert.deepEqual(result.regions, {});
  });

  it('handles single snapshot', () => {
    const result = buildRegionTimeSeries([mockHistory[0]]);
    assert.equal(result.timestamps.length, 1);
    assert.equal(result.regions.US.counts.length, 1);
    assert.deepEqual(result.regions.US.counts, [12]);
  });

  it('includes latest eventCount as latestCount property', () => {
    const result = buildRegionTimeSeries(mockHistory);
    assert.equal(result.regions.US.latestCount, 12);
    assert.equal(result.regions.RU.latestCount, 8);
  });
});
