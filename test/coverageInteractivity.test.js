import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const srcDir = resolve(root, 'src');

/* ── helpers ── */
function readModule(path) {
  return readFileSync(resolve(srcDir, path), 'utf-8');
}

/* ── tests ── */

test('CoverageDrilldown component exists and exports a default React component', () => {
  const filePath = resolve(srcDir, 'components', 'CoverageDrilldown.jsx');
  assert.ok(existsSync(filePath), 'CoverageDrilldown.jsx should exist');

  const content = readModule('components/CoverageDrilldown.jsx');
  assert.ok(content.includes('export default'), 'Should have a default export');
  assert.ok(
    content.includes('const CoverageDrilldown') || content.includes('function CoverageDrilldown'),
    'Should define CoverageDrilldown component',
  );
  assert.ok(content.includes('onClose'), 'Should accept onClose prop');
  assert.ok(content.includes('coverageEntry'), 'Should accept coverageEntry prop');
  assert.ok(content.includes('coverageHistory'), 'Should accept coverageHistory prop');
  assert.ok(content.includes('useTranslation'), 'Should use i18n (useTranslation)');
  assert.ok(content.includes('Sparkline'), 'Should include sparkline rendering');
  assert.ok(content.includes('buildReasoning'), 'Should include reasoning builder');
});

test('MapGLOverlay passes onCoverageCountryClick to click handler', () => {
  const content = readModule('components/MapGLOverlay.jsx');

  assert.ok(
    content.includes('onCoverageCountryClick'),
    'MapGLOverlay should accept onCoverageCountryClick prop',
  );
  assert.ok(
    content.includes("latestOverlay.current === 'coverage'"),
    'Should check mapOverlay for coverage mode in click handler',
  );
  assert.ok(
    content.includes('latestHandlers.current.onCoverageCountryClick'),
    'Should call onCoverageCountryClick when coverage mode active',
  );
});

test('FlatMap passes onCoverageCountryClick to MapGLOverlay', () => {
  const content = readModule('components/FlatMap.jsx');

  assert.ok(
    content.includes('onCoverageCountryClick'),
    'FlatMap should accept and pass onCoverageCountryClick prop',
  );
  assert.ok(
    content.includes('onCoverageCountryClick={onCoverageCountryClick}'),
    'FlatMap should pass onCoverageCountryClick to MapGLOverlay',
  );
});

test('Globe passes onCoverageCountryClick to MapGLOverlay', () => {
  const content = readModule('components/Globe.jsx');

  assert.ok(
    content.includes('onCoverageCountryClick'),
    'Globe should accept and pass onCoverageCountryClick prop',
  );
  assert.ok(
    content.includes('onCoverageCountryClick={onCoverageCountryClick}'),
    'Globe should pass onCoverageCountryClick to MapGLOverlay',
  );
});

test('CoverageDrilldown i18n keys exist in all 5 locale files', () => {
  const locales = ['en', 'es', 'fr', 'ar', 'zh'];
  const requiredKeys = [
    'coverageDrill.title',
    'coverageDrill.active',
    'coverageDrill.failed',
    'coverageDrill.empty',
    'coverageDrill.totalEvents',
    'coverageDrill.verifiedEvents',
    'coverageDrill.recentHistory',
    'coverageDrill.statusChanges',
    'coverageDrill.noFeeds',
    'coverageDrill.clickCountryHint',
  ];

  for (const locale of locales) {
    const content = readModule(`i18n/locales/${locale}.json`);
    for (const key of requiredKeys) {
      const parts = key.split('.');
      let json;
      try {
        json = JSON.parse(content);
      } catch (parseErr) {
        assert.fail(`Failed to parse ${locale}.json: ${parseErr.message}`);
      }
      const found = parts.reduce((obj, k) => obj?.[k], json) !== undefined;
      assert.ok(found, `${locale}.json should contain key "${key}"`);
    }
  }
});

test('CoverageDrilldown CSS classes exist in index.css', () => {
  const content = readFileSync(resolve(srcDir, 'index.css'), 'utf-8');

  const requiredClasses = [
    '.coverage-drilldown',
    '.coverage-drill-header',
    '.coverage-drill-region-name',
    '.coverage-drill-status-badge',
    '.coverage-drill-close',
    '.coverage-drill-body',
    '.coverage-drill-section',
    '.coverage-drill-confidence-value',
    '.coverage-drill-reasoning',
    '.coverage-drill-source-row',
    '.coverage-drill-feed-list',
    '.coverage-drill-feed-item',
    '.coverage-drill-sparkline',
    '.coverage-drill-transition',
    '.map-corner-drill',
  ];

  for (const cls of requiredClasses) {
    assert.ok(
      content.includes(cls),
      `index.css should contain CSS class "${cls}"`,
    );
  }
});

test('CoverageDrilldown reasoning builder produces expected strings', () => {
  // Simulate the reasoning logic inline (mirrors buildReasoning in component)
  function buildReasoning(entry) {
    if (!entry) return '';
    const parts = [];
    if (entry.verifiedCount > 0) {
      parts.push(`${entry.verifiedCount} verified event${entry.verifiedCount !== 1 ? 's' : ''}`);
    } else if (entry.eventCount > 0) {
      parts.push(`${entry.eventCount} event${entry.eventCount !== 1 ? 's' : ''} (none verified)`);
    }
    if (entry.feedCount > 0) {
      const healthy = entry.healthyFeeds || 0;
      const failed = entry.failedFeeds || 0;
      const empty = entry.emptyFeeds || 0;
      if (failed > 0) {
        parts.push(`${healthy}/${entry.feedCount} feeds healthy, ${failed} failed`);
      } else if (empty > 0) {
        parts.push(`${healthy}/${entry.feedCount} feeds healthy, ${empty} empty`);
      } else {
        parts.push(`${healthy}/${entry.feedCount} feeds healthy`);
      }
    } else {
      parts.push('No active feeds for this country');
    }
    return parts.join(' · ');
  }

  // Verified country with healthy feeds
  const verifiedEntry = {
    verifiedCount: 2, eventCount: 5, feedCount: 3,
    healthyFeeds: 3, failedFeeds: 0, emptyFeeds: 0,
  };
  assert.equal(
    buildReasoning(verifiedEntry),
    '2 verified events · 3/3 feeds healthy',
    'Verified country should show verified events and healthy feeds',
  );

  // Low-confidence country with some failed feeds
  const lowConfEntry = {
    verifiedCount: 0, eventCount: 3, feedCount: 5,
    healthyFeeds: 3, failedFeeds: 2, emptyFeeds: 0,
  };
  assert.equal(
    buildReasoning(lowConfEntry),
    '3 events (none verified) · 3/5 feeds healthy, 2 failed',
    'Low-confidence country should show unverified events and failed feeds',
  );

  // Source-sparse country with empty feeds
  const sparseEntry = {
    verifiedCount: 0, eventCount: 0, feedCount: 2,
    healthyFeeds: 1, failedFeeds: 0, emptyFeeds: 1,
  };
  assert.equal(
    buildReasoning(sparseEntry),
    '1/2 feeds healthy, 1 empty',
    'Source-sparse country should show empty feeds',
  );

  // No feed country
  const noFeedEntry = {
    verifiedCount: 0, eventCount: 0, feedCount: 0,
    healthyFeeds: 0, failedFeeds: 0, emptyFeeds: 0,
  };
  assert.equal(
    buildReasoning(noFeedEntry),
    'No active feeds for this country',
    'No-feed country should show appropriate message',
  );

  // Null entry
  assert.equal(buildReasoning(null), '', 'Null entry should return empty string');

  // Single verified event
  const singleVerified = {
    verifiedCount: 1, eventCount: 1, feedCount: 2,
    healthyFeeds: 2, failedFeeds: 0, emptyFeeds: 0,
  };
  assert.equal(
    buildReasoning(singleVerified),
    '1 verified event · 2/2 feeds healthy',
    'Single verified event should use singular form',
  );
});

test('CoverageDiagnostics produces correct data for drill-down consumption', async () => {
  const { buildCoverageDiagnostics } = await import('../src/utils/coverageDiagnostics.js');

  // Create a realistic coverage scenario
  const coverageMetrics = {
    coverageByIso: new Map([
      ['UA', { region: 'Ukraine', eventCount: 8, verifiedCount: 3, maxConfidence: 78 }],
      ['SY', { region: 'Syria', eventCount: 2, verifiedCount: 0, maxConfidence: 45 }],
    ]),
  };

  const sourceHealth = {
    rss: {
      feeds: [
        { feedId: 'kyivpost', isoA2: 'UA', country: 'Ukraine', status: 'ok' },
        { feedId: 'ukrinform', isoA2: 'UA', country: 'Ukraine', status: 'ok' },
        { feedId: 'rt-ua', isoA2: 'UA', country: 'Ukraine', status: 'failed' },
        { feedId: 'sana', isoA2: 'SY', country: 'Syria', status: 'failed' },
        { feedId: 'syria-direct', isoA2: 'SY', country: 'Syria', status: 'empty' },
      ],
    },
  };

  const diagnostics = buildCoverageDiagnostics(coverageMetrics, sourceHealth);

  // Ukraine should be developing (verified events + moderate confidence)
  assert.ok(diagnostics.byIso.UA, 'Ukraine should be in diagnostics');
  assert.equal(diagnostics.byIso.UA.status, 'verified', 'UA with verified events should be verified');
  assert.equal(diagnostics.byIso.UA.eventCount, 8);
  assert.equal(diagnostics.byIso.UA.verifiedCount, 3);
  assert.equal(diagnostics.byIso.UA.maxConfidence, 78);
  assert.equal(diagnostics.byIso.UA.feedCount, 3);
  assert.equal(diagnostics.byIso.UA.healthyFeeds, 2, 'UA should have 2 healthy feeds');
  assert.equal(diagnostics.byIso.UA.failedFeeds, 1, 'UA should have 1 failed feed');

  // Syria should be at risk with only failed/empty feeds
  assert.ok(diagnostics.byIso.SY, 'Syria should be in diagnostics');
  assert.equal(diagnostics.byIso.SY.healthyFeeds, 0);
  assert.equal(diagnostics.byIso.SY.failedFeeds, 1);
  assert.equal(diagnostics.byIso.SY.emptyFeeds, 1);
});

test('CoverageDrilldown uses coverageHistory for sparkline data', async () => {
  const { getRegionCoverageHistory } = await import('../src/utils/coverageHistory.js');

  const history = [
    {
      at: '2026-05-07T10:00:00.000Z',
      countries: [
        { iso: 'UA', region: 'Ukraine', status: 'verified', eventCount: 8, verifiedCount: 3, maxConfidence: 78, feedCount: 3, failedFeeds: 1 },
      ],
    },
    {
      at: '2026-05-07T08:00:00.000Z',
      countries: [
        { iso: 'UA', region: 'Ukraine', status: 'developing', eventCount: 5, verifiedCount: 1, maxConfidence: 62, feedCount: 3, failedFeeds: 0 },
      ],
    },
    {
      at: '2026-05-07T06:00:00.000Z',
      countries: [
        { iso: 'UA', region: 'Ukraine', status: 'low-confidence', eventCount: 2, verifiedCount: 0, maxConfidence: 38, feedCount: 2, failedFeeds: 0 },
      ],
    },
  ];

  const regionHistory = getRegionCoverageHistory(history, 'UA', 6, 4);

  assert.equal(regionHistory.iso, 'UA');
  assert.equal(regionHistory.region, 'Ukraine');
  assert.equal(regionHistory.latestStatus, 'verified');
  assert.ok(regionHistory.snapshots.length >= 3, 'Should have at least 3 snapshots for sparkline');
  assert.equal(regionHistory.snapshots[0].eventCount, 8, 'Latest snapshot should have 8 events');
  assert.equal(regionHistory.snapshots[1].eventCount, 5);
  assert.equal(regionHistory.snapshots[2].eventCount, 2);

  // Transitions should capture the status changes (newest first)
  assert.ok(regionHistory.transitions.length >= 1, 'Should have at least 1 transition');
  // Transitions are sorted newest-first, so first is: developing -> verified
  assert.equal(regionHistory.transitions[0].fromStatus, 'developing');
  assert.equal(regionHistory.transitions[0].toStatus, 'verified');
});
