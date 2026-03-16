import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverageDiagnostics } from '../src/utils/coverageDiagnostics.js';

function createCoverageMetrics(entries) {
  return {
    coverageByIso: new Map(entries.map((entry) => [entry.iso, {
      region: entry.region,
      eventCount: entry.eventCount,
      verifiedCount: entry.verifiedCount,
      maxConfidence: entry.maxConfidence
    }]))
  };
}

test('buildCoverageDiagnostics classifies countries across all diagnostic states', () => {
  const coverageMetrics = createCoverageMetrics([
    { iso: 'US', region: 'United States', eventCount: 4, verifiedCount: 2, maxConfidence: 92 },
    { iso: 'FR', region: 'France', eventCount: 2, verifiedCount: 0, maxConfidence: 67 },
    { iso: 'BR', region: 'Brazil', eventCount: 1, verifiedCount: 0, maxConfidence: 31 }
  ]);

  const sourceHealth = {
    rss: {
      feeds: [
        { isoA2: 'JP', country: 'Japan', status: 'failed' },
        { isoA2: 'JP', country: 'Japan', status: 'failed' },
        { isoA2: 'MX', country: 'Mexico', status: 'empty' },
        { isoA2: 'MX', country: 'Mexico', status: 'ok' }
      ]
    }
  };

  const diagnostics = buildCoverageDiagnostics(coverageMetrics, sourceHealth);

  assert.equal(diagnostics.byIso.US.status, 'verified');
  assert.equal(diagnostics.byIso.FR.status, 'developing');
  assert.equal(diagnostics.byIso.BR.status, 'low-confidence');
  assert.equal(diagnostics.byIso.JP.status, 'ingestion-risk');
  assert.equal(diagnostics.byIso.MX.status, 'uncovered');
  assert.equal(diagnostics.byIso.ZA.status, 'source-sparse');
});

test('buildCoverageDiagnostics orders low-confidence and ingest-risk lists by severity of problem', () => {
  const coverageMetrics = createCoverageMetrics([
    { iso: 'AR', region: 'Argentina', eventCount: 2, verifiedCount: 0, maxConfidence: 44 },
    { iso: 'CL', region: 'Chile', eventCount: 1, verifiedCount: 0, maxConfidence: 28 }
  ]);

  const sourceHealth = {
    rss: {
      feeds: [
        { isoA2: 'KE', country: 'Kenya', status: 'failed' },
        { isoA2: 'KE', country: 'Kenya', status: 'failed' },
        { isoA2: 'KE', country: 'Kenya', status: 'failed' },
        { isoA2: 'NG', country: 'Nigeria', status: 'failed' }
      ]
    }
  };

  const diagnostics = buildCoverageDiagnostics(coverageMetrics, sourceHealth);

  assert.deepEqual(
    diagnostics.lowConfidenceRegions.slice(0, 2).map((entry) => entry.iso),
    ['CL', 'AR']
  );
  assert.deepEqual(
    diagnostics.ingestionRiskRegions.slice(0, 2).map((entry) => entry.iso),
    ['KE', 'NG']
  );
  assert.equal(diagnostics.diagnosticCounts.lowConfidenceCountries, 2);
  assert.equal(diagnostics.diagnosticCounts.ingestionRiskCountries, 2);
});

test('buildCoverageDiagnostics counts regional feed checks against all covered countries', () => {
  const diagnostics = buildCoverageDiagnostics(null, {
    rss: {
      feeds: [
        {
          feedId: 'ocmedia',
          country: null,
          coverageIsoA2s: ['GE', 'AM', 'AZ'],
          status: 'failed'
        },
        {
          feedId: 'africanews',
          country: null,
          coverageIsoA2s: ['NG', 'GH'],
          status: 'ok'
        }
      ]
    }
  });

  assert.equal(diagnostics.byIso.GE.status, 'ingestion-risk');
  assert.equal(diagnostics.byIso.AM.status, 'ingestion-risk');
  assert.equal(diagnostics.byIso.NG.status, 'uncovered');
  assert.equal(diagnostics.byIso.NG.feedCount, 1);
  assert.equal(diagnostics.byIso.GH.feedCount, 1);
});
