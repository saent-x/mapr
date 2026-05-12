/**
 * Comparative Regions test — verifies the ComparativeRegions component,
 * CSS styles, i18n keys, and RegionDetailPage integration.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSeverityTrend,
  buildSharedEntityEvidence,
  summarizeRegionArticles,
} from '../src/utils/regionComparison.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'src');

function readText(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf-8');
}

describe('ComparativeRegions component', () => {
  it('ComparativeRegions.jsx exists and exports default component', () => {
    const path = resolve(SRC, 'components', 'ComparativeRegions.jsx');
    assert.ok(existsSync(path), 'ComparativeRegions.jsx should exist');
    const content = readFileSync(path, 'utf-8');
    assert.ok(
      content.includes('export default function ComparativeRegions'),
      'should export default function ComparativeRegions',
    );
  });

  it('ComparativeRegions imports required lucide icons', () => {
    const content = readText('src/components/ComparativeRegions.jsx');
    assert.ok(content.includes('Search'), 'should import Search icon');
    assert.ok(content.includes('X'), 'should import X icon');
    assert.ok(content.includes('ChevronDown'), 'should import ChevronDown icon');
    assert.ok(content.includes('lucide-react'), 'should import from lucide-react');
  });

  it('ComparativeRegions uses i18n via useTranslation', () => {
    const content = readText('src/components/ComparativeRegions.jsx');
    assert.ok(
      content.includes('useTranslation'),
      'should import useTranslation',
    );
    assert.ok(
      content.includes("t('regionDetail."),
      'should use t() for i18n keys from regionDetail namespace',
    );
  });

  it('ComparativeRegions imports required utilities', () => {
    const content = readText('src/components/ComparativeRegions.jsx');
    assert.ok(content.includes('isoToCountry'), 'should import isoToCountry');
    assert.ok(content.includes('canonicalizeArticles'), 'should import canonicalizeArticles');
    assert.ok(content.includes('useNewsStore'), 'should import useNewsStore');
    assert.ok(content.includes('buildSharedEntityEvidence'), 'should use ranked shared entity evidence');
    assert.ok(content.includes('summarizeRegionArticles'), 'should use shared stats utility');
  });

  it('ComparativeRegions renders split-view with DualSeverityChart', () => {
    const content = readText('src/components/ComparativeRegions.jsx');
    assert.ok(
      content.includes('function DualSeverityChart'),
      'should define DualSeverityChart inner component',
    );
  });

  it('ComparativeRegions renders RegionSelector dropdown', () => {
    const content = readText('src/components/ComparativeRegions.jsx');
    assert.ok(
      content.includes('function RegionSelector'),
      'should define RegionSelector inner component',
    );
  });

  it('ComparativeRegions has shared entity extraction logic', () => {
    const content = readText('src/components/ComparativeRegions.jsx');
    assert.ok(
      content.includes('buildSharedEntityEvidence'),
      'should compute shared entity evidence through the utility',
    );
    assert.ok(
      content.includes('sharedEntityEvidence'),
      'should render shared entity evidence',
    );
  });

  it('ComparativeRegions builds severity trend with buildSeverityTrend', () => {
    const content = readText('src/components/ComparativeRegions.jsx');
    assert.ok(
      content.includes('buildSeverityTrend'),
      'should use buildSeverityTrend helper',
    );
  });
});

describe('Region comparison analytics', () => {
  it('buildSeverityTrend bins daily average severity and critical counts', () => {
    const now = Date.parse('2026-05-08T12:00:00Z');
    const series = buildSeverityTrend([
      { id: 'a', firstSeenAt: '2026-05-08T10:00:00Z', severity: 80 },
      { id: 'b', firstSeenAt: '2026-05-08T11:00:00Z', severity: 40 },
    ], 2, now);
    const last = series.at(-1);
    assert.equal(last.count, 2);
    assert.equal(last.value, 6);
    assert.equal(last.critical, 1);
  });

  it('buildSharedEntityEvidence filters broad entities and ranks supported shared entities', () => {
    const left = [
      {
        id: 'l1',
        title: 'Zelensky visits Warsaw after air defense talks',
        source: 'Source A',
        severity: 80,
        entities: { people: [{ name: 'Zelensky' }], organizations: [{ name: 'WHO' }], locations: [] },
      },
    ];
    const right = [
      {
        id: 'r1',
        title: 'Zelensky asks Poland for more air defense support',
        source: 'Source B',
        severity: 70,
        entities: { people: [{ name: 'Zelensky' }], organizations: [{ name: 'WHO' }], locations: [] },
      },
    ];
    const shared = buildSharedEntityEvidence(left, right);
    assert.equal(shared.length, 1);
    assert.equal(shared[0].name, 'Zelensky');
    assert.equal(shared[0].leftCount, 1);
    assert.equal(shared[0].rightCount, 1);
    assert.equal(shared[0].sourceCount, 2);
  });

  it('summarizeRegionArticles returns professional comparison stats', () => {
    const stats = summarizeRegionArticles([
      { id: 'a', severity: 80, source: 'A' },
      { id: 'b', severity: 20, source: 'B' },
    ]);
    assert.equal(stats.avgSev, 5);
    assert.equal(stats.eventCount, 2);
    assert.equal(stats.sourceCount, 2);
    assert.equal(stats.criticalCount, 1);
  });
});

describe('RegionDetailPage — Compare integration', () => {
  it('RegionDetailPage imports ComparativeRegions and Columns2', () => {
    const content = readText('src/pages/RegionDetailPage.jsx');
    assert.ok(
      content.includes('ComparativeRegions'),
      'should import ComparativeRegions component',
    );
    assert.ok(
      content.includes('Columns2'),
      'should import Columns2 icon from lucide-react',
    );
  });

  it('RegionDetailPage has compareMode and compareIso state', () => {
    const content = readText('src/pages/RegionDetailPage.jsx');
    assert.ok(
      content.includes('const [compareMode, setCompareMode] = useState(false)'),
      'should initialize compareMode state as false',
    );
    assert.ok(
      content.includes('const [compareIso, setCompareIso] = useState(null)'),
      'should initialize compareIso state as null',
    );
  });

  it('RegionDetailPage has Compare toggle button with aria-pressed', () => {
    const content = readText('src/pages/RegionDetailPage.jsx');
    assert.ok(
      content.includes('aria-pressed={compareMode}'),
      'should have aria-pressed attribute on toggle',
    );
    assert.ok(
      content.includes('compare-toggle-btn'),
      'should have compare-toggle-btn class',
    );
  });

  it('RegionDetailPage fetches data for second region in compare mode', () => {
    const content = readText('src/pages/RegionDetailPage.jsx');
    assert.ok(
      content.includes('compareIso') && content.includes('fetchRegionCoverage'),
      'should call fetchRegionCoverage for second region',
    );
  });

  it('RegionDetailPage renders ComparativeRegions when compareMode is true', () => {
    const content = readText('src/pages/RegionDetailPage.jsx');
    assert.ok(
      content.includes('compareMode ?'),
      'should conditionally render based on compareMode',
    );
    assert.ok(
      content.includes('<ComparativeRegions'),
      'should render ComparativeRegions component',
    );
    assert.ok(
      content.includes('onRegionBChange={setCompareIso}'),
      'should pass onRegionBChange callback',
    );
    assert.ok(
      content.includes('onExit={() => setCompareMode(false)}'),
      'should pass onExit callback',
    );
  });
});

describe('CSS styles for comparative regions', () => {
  it('index.css has compare-toggle-btn styles', () => {
    const content = readText('src/index.css');
    assert.ok(
      content.includes('.compare-toggle-btn'),
      'should have compare-toggle-btn class',
    );
    assert.ok(
      content.includes('.compare-toggle-btn.active'),
      'should have active state for toggle button',
    );
  });

  it('index.css has compare-stats-row grid layout', () => {
    const content = readText('src/index.css');
    assert.ok(
      content.includes('.compare-stats-row'),
      'should have compare-stats-row class',
    );
  });

  it('index.css has dual-line chart styles', () => {
    const content = readText('src/index.css');
    assert.ok(
      content.includes('.compare-dual-chart'),
      'should have compare-dual-chart class',
    );
    assert.ok(
      content.includes('.compare-dual-chart-legend'),
      'should have chart legend styles',
    );
  });

  it('index.css has shared entity styles', () => {
    const content = readText('src/index.css');
    assert.ok(
      content.includes('.compare-shared-entities'),
      'should have compare-shared-entities class',
    );
    assert.ok(
      content.includes('.compare-shared-entity-tag'),
      'should have shared entity tag styles',
    );
  });

  it('index.css has region selector dropdown styles', () => {
    const content = readText('src/index.css');
    assert.ok(
      content.includes('.compare-region-selector'),
      'should have compare-region-selector class',
    );
    assert.ok(
      content.includes('.compare-region-selector-dropdown'),
      'should have dropdown styles',
    );
  });

  it('index.css has mobile responsive styles for comparative regions', () => {
    const content = readText('src/index.css');
    assert.ok(
      content.includes('@media (max-width: 767px)') &&
        content.includes('.compare-stats-row'),
      'should have mobile responsive styles for compare-stats-row',
    );
  });

  it('index.css has comparative regions wrapper styles', () => {
    const content = readText('src/index.css');
    assert.ok(
      content.includes('.comparative-regions'),
      'should have comparative-regions class',
    );
    assert.ok(
      content.includes('.region-comparative-wrap'),
      'should have region-comparative-wrap class',
    );
  });
});

describe('i18n keys for comparative regions', () => {
  const locales = ['en', 'es', 'fr', 'ar', 'zh'];

  const requiredKeys = [
    'regionDetail.compare',
    'regionDetail.compareExit',
    'regionDetail.selectSecondRegion',
    'regionDetail.sharedEntities',
    'regionDetail.noSharedEntities',
    'regionDetail.severityTrend',
    'regionDetail.regionA',
    'regionDetail.regionB',
    'regionDetail.searchRegionPlaceholder',
    'regionDetail.eventCount',
    'regionDetail.sourceCount',
    'regionDetail.avgSeverityShort',
  ];

  for (const locale of locales) {
    it(`"${locale}.json" contains all required regionDetail keys`, () => {
      const raw = readText(`src/i18n/locales/${locale}.json`);
      const json = JSON.parse(raw);

      for (const key of requiredKeys) {
        const [section, subkey] = key.split('.');
        assert.ok(
          json[section] && typeof json[section][subkey] === 'string' && json[section][subkey].length > 0,
          `"${key}" should exist and be a non-empty string in ${locale}.json`,
        );
      }
    });
  }
});
