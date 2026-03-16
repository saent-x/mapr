import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCoverageSnapshot,
  buildCoverageTransitions,
  getRegionCoverageHistory,
  mergeCoverageHistory,
  summarizeCoverageHistory,
  summarizeCoverageTrends
} from '../src/utils/coverageHistory.js';

function createDiagnostics(byIso) {
  return { byIso };
}

test('buildCoverageSnapshot and mergeCoverageHistory preserve latest-first history', () => {
  const older = buildCoverageSnapshot(createDiagnostics({
    US: { iso: 'US', region: 'United States', status: 'developing', eventCount: 2, verifiedCount: 0, maxConfidence: 61, feedCount: 2, failedFeeds: 0 }
  }), '2026-03-14T10:00:00.000Z');
  const latest = buildCoverageSnapshot(createDiagnostics({
    US: { iso: 'US', region: 'United States', status: 'verified', eventCount: 4, verifiedCount: 1, maxConfidence: 88, feedCount: 2, failedFeeds: 0 }
  }), '2026-03-15T10:00:00.000Z');

  const merged = mergeCoverageHistory([older], latest, 4);

  assert.equal(merged[0].at, '2026-03-15T10:00:00.000Z');
  assert.equal(merged[1].at, '2026-03-14T10:00:00.000Z');
});

test('summarizeCoverageTrends detects rising, newly verified, and newly at-risk regions', () => {
  const previous = {
    at: '2026-03-14T10:00:00.000Z',
    countries: [
      { iso: 'US', region: 'United States', status: 'developing', eventCount: 2, verifiedCount: 0, maxConfidence: 58, feedCount: 2, failedFeeds: 0 },
      { iso: 'NG', region: 'Nigeria', status: 'low-confidence', eventCount: 1, verifiedCount: 0, maxConfidence: 32, feedCount: 2, failedFeeds: 0 },
      { iso: 'JP', region: 'Japan', status: 'uncovered', eventCount: 0, verifiedCount: 0, maxConfidence: 0, feedCount: 2, failedFeeds: 0 }
    ]
  };
  const latest = {
    at: '2026-03-15T10:00:00.000Z',
    countries: [
      { iso: 'US', region: 'United States', status: 'verified', eventCount: 5, verifiedCount: 1, maxConfidence: 86, feedCount: 2, failedFeeds: 0 },
      { iso: 'NG', region: 'Nigeria', status: 'developing', eventCount: 4, verifiedCount: 0, maxConfidence: 63, feedCount: 2, failedFeeds: 0 },
      { iso: 'JP', region: 'Japan', status: 'ingestion-risk', eventCount: 0, verifiedCount: 0, maxConfidence: 0, feedCount: 2, failedFeeds: 2 }
    ]
  };

  const summary = summarizeCoverageTrends([latest, previous]);

  assert.equal(summary.newlyVerifiedRegions[0].iso, 'US');
  assert.equal(summary.risingRegions[0].iso, 'NG');
  assert.equal(summary.atRiskRegions[0].iso, 'JP');
});

test('summarizeCoverageHistory and buildCoverageTransitions summarize snapshots and state changes', () => {
  const history = [
    {
      at: '2026-03-15T10:00:00.000Z',
      countries: [
        { iso: 'US', region: 'United States', status: 'verified', eventCount: 4, verifiedCount: 1, maxConfidence: 90, feedCount: 2, failedFeeds: 0 },
        { iso: 'BR', region: 'Brazil', status: 'ingestion-risk', eventCount: 0, verifiedCount: 0, maxConfidence: 0, feedCount: 1, failedFeeds: 1 },
        { iso: 'ZA', region: 'South Africa', status: 'source-sparse', eventCount: 0, verifiedCount: 0, maxConfidence: 0, feedCount: 0, failedFeeds: 0 }
      ]
    },
    {
      at: '2026-03-14T10:00:00.000Z',
      countries: [
        { iso: 'US', region: 'United States', status: 'developing', eventCount: 2, verifiedCount: 0, maxConfidence: 62, feedCount: 2, failedFeeds: 0 },
        { iso: 'BR', region: 'Brazil', status: 'uncovered', eventCount: 0, verifiedCount: 0, maxConfidence: 0, feedCount: 1, failedFeeds: 0 },
        { iso: 'ZA', region: 'South Africa', status: 'source-sparse', eventCount: 0, verifiedCount: 0, maxConfidence: 0, feedCount: 0, failedFeeds: 0 }
      ]
    }
  ];

  const checkpoints = summarizeCoverageHistory(history, 2);
  const transitions = buildCoverageTransitions(history, 4);

  assert.equal(checkpoints[0].verifiedCountries, 1);
  assert.equal(checkpoints[0].ingestionRiskCountries, 1);
  assert.equal(checkpoints[0].sourceSparseCountries, 1);
  assert.deepEqual(
    transitions.map((entry) => `${entry.iso}:${entry.fromStatus}->${entry.toStatus}`),
    ['BR:uncovered->ingestion-risk', 'US:developing->verified']
  );
});

test('getRegionCoverageHistory returns only the selected region timeline and transitions', () => {
  const history = [
    {
      at: '2026-03-15T10:00:00.000Z',
      countries: [
        { iso: 'NG', region: 'Nigeria', status: 'developing', eventCount: 4, verifiedCount: 0, maxConfidence: 66, feedCount: 2, failedFeeds: 0 },
        { iso: 'US', region: 'United States', status: 'verified', eventCount: 5, verifiedCount: 1, maxConfidence: 91, feedCount: 2, failedFeeds: 0 }
      ]
    },
    {
      at: '2026-03-14T10:00:00.000Z',
      countries: [
        { iso: 'NG', region: 'Nigeria', status: 'low-confidence', eventCount: 1, verifiedCount: 0, maxConfidence: 38, feedCount: 2, failedFeeds: 0 },
        { iso: 'US', region: 'United States', status: 'developing', eventCount: 2, verifiedCount: 0, maxConfidence: 62, feedCount: 2, failedFeeds: 0 }
      ]
    }
  ];

  const regionHistory = getRegionCoverageHistory(history, 'NG', 6, 4);

  assert.equal(regionHistory.region, 'Nigeria');
  assert.equal(regionHistory.latestStatus, 'developing');
  assert.deepEqual(regionHistory.snapshots.map((entry) => entry.iso), ['NG', 'NG']);
  assert.deepEqual(
    regionHistory.transitions.map((entry) => `${entry.fromStatus}->${entry.toStatus}`),
    ['low-confidence->developing']
  );
});
