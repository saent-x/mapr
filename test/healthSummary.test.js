import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAdminHealthPayload,
  mergeAdminHealthPayloads,
  normalizeAdminSourceHealth
} from '../src/utils/healthSummary.js';

test('buildAdminHealthPayload derives coverage and diagnostics from events instead of missing briefing fields', () => {
  const payload = buildAdminHealthPayload({
    meta: {
      source: 'server',
      fetchedAt: '2026-03-19T16:36:21.446Z'
    },
    articles: [
      { id: 'a1' },
      { id: 'a2' }
    ],
    events: [
      {
        id: 'event-ng',
        isoA2: 'NG',
        region: 'Nigeria',
        confidence: 82,
        verificationStatus: 'verified',
        lastSeenAt: '2026-03-19T15:00:00.000Z'
      },
      {
        id: 'event-jp',
        isoA2: 'JP',
        region: 'Japan',
        confidence: 46,
        verificationStatus: 'developing',
        lastSeenAt: '2026-03-19T14:00:00.000Z'
      }
    ],
    sourceHealth: {
      gdelt: {
        totalProfiles: 3,
        healthyProfiles: 0,
        failedProfiles: 3,
        normalizedArticles: 0,
        profiles: [{ id: 'crisis', status: 'failed' }]
      },
      rss: {
        totalFeeds: 133,
        healthyFeeds: 55,
        failedFeeds: 31,
        emptyFeeds: 47,
        articlesFound: 1892,
        feeds: []
      },
      backend: {
        status: 'healthy'
      }
    }
  }, {
    timestamp: '2026-03-19T16:40:50.458Z'
  });

  assert.equal(payload.pipeline.totalEvents, 2);
  assert.equal(payload.coverageMetrics.coveredCountries, 2);
  assert.equal(payload.coverageMetrics.verifiedCountries, 1);
  assert.equal(payload.coverageDiagnostics.lowConfidenceCountries, 1);
  assert.equal(payload.sourceHealth.gdelt.status, 'degraded');
  assert.equal(payload.sourceHealth.rss.status, 'degraded');
});

test('mergeAdminHealthPayloads falls back to operational coverage when admin payload still reports zeros', () => {
  const merged = mergeAdminHealthPayloads({
    pipeline: {
      totalEvents: 1567
    },
    coverageMetrics: {
      totalCountries: 148,
      coveredCountries: 0,
      verifiedCountries: 0,
      uncoveredCountries: 0,
      coverageRate: 0
    },
    coverageDiagnostics: {
      lowConfidenceCountries: 0,
      ingestionRiskCountries: 0,
      sourceSparseCountries: 0
    },
    sourceHealth: {
      rss: {
        totalFeeds: 133,
        healthyFeeds: 57,
        emptyFeeds: 46,
        failedFeeds: 30
      }
    }
  }, {
    coverageMetrics: {
      totalCountries: 148,
      coveredCountries: 110,
      verifiedCountries: 18,
      uncoveredCountries: 38,
      coverageRate: 110 / 148
    },
    coverageDiagnostics: {
      diagnosticCounts: {
        lowConfidenceCountries: 45,
        ingestionRiskCountries: 1,
        sourceSparseCountries: 12
      }
    }
  });

  assert.equal(merged.coverageMetrics.coveredCountries, 110);
  assert.equal(merged.coverageMetrics.verifiedCountries, 18);
  assert.equal(merged.coverageDiagnostics.lowConfidenceCountries, 45);
  assert.equal(merged.coverageDiagnostics.ingestionRiskCountries, 1);
});

test('normalizeAdminSourceHealth treats empty but reachable RSS feeds separately from failures', () => {
  const normalized = normalizeAdminSourceHealth({
    rss: {
      totalFeeds: 10,
      healthyFeeds: 4,
      emptyFeeds: 5,
      failedFeeds: 1,
      articlesFound: 200
    }
  });

  assert.equal(normalized.rss.reachableFeeds, 9);
  assert.equal(normalized.rss.status, 'degraded');
});
