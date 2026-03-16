import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpsAlerts, buildRegionLagDiagnostics } from '../src/utils/opsDiagnostics.js';

test('buildRegionLagDiagnostics classifies watch and stale regions by last seen time', () => {
  const now = new Date('2026-03-16T12:00:00Z').getTime();
  const diagnostics = buildRegionLagDiagnostics([
    {
      isoA2: 'NG',
      region: 'Nigeria',
      lastSeenAt: '2026-03-16T02:00:00Z',
      severity: 80
    },
    {
      isoA2: 'JP',
      region: 'Japan',
      lastSeenAt: '2026-03-15T00:00:00Z',
      severity: 55
    },
    {
      isoA2: 'AR',
      region: 'Argentina',
      lastSeenAt: '2026-03-12T12:00:00Z',
      severity: 60
    }
  ], { now, watchHours: 24, staleHours: 72 });

  assert.equal(diagnostics.byIso.NG.lagStatus, 'fresh');
  assert.equal(diagnostics.byIso.JP.lagStatus, 'watch');
  assert.equal(diagnostics.byIso.AR.lagStatus, 'stale');
  assert.equal(diagnostics.stats.watchCount, 1);
  assert.equal(diagnostics.stats.staleCount, 1);
});

test('buildOpsAlerts summarizes backend, source, and region lag issues', () => {
  const alerts = buildOpsAlerts({
    backendHealth: {
      status: 'stale',
      snapshotAgeMs: 4 * 60 * 60 * 1000,
      consecutiveFailures: 2
    },
    sourceHealth: {
      rss: {
        failedFeeds: 3,
        healthyFeeds: 1,
        totalFeeds: 12
      },
      gdelt: {
        failedProfiles: 2,
        healthyProfiles: 0,
        totalProfiles: 6
      }
    },
    coverageDiagnostics: {
      diagnosticCounts: {
        ingestionRiskCountries: 4,
        sourceSparseCountries: 28
      }
    },
    regionLagDiagnostics: {
      stats: {
        staleCount: 3
      }
    }
  });

  assert.equal(alerts.summary.criticalCount, 2);
  assert.equal(alerts.summary.warningCount, 3);
  assert.equal(alerts.summary.infoCount, 2);
  assert.equal(alerts.alerts[0].code, 'backendStale');
  assert(alerts.alerts.some((alert) => alert.code === 'staleRegionLag'));
  assert(alerts.alerts.some((alert) => alert.code === 'sourceSparse'));
});
