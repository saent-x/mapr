/**
 * Historical Queries test — verifies DateRangePicker, TimeTravelScrubber,
 * HistoricalQueriesPanel components, newsStore historical methods,
 * API endpoints, CSS styles, and i18n keys.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'src');

function readText(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf-8');
}

function fileExists(relPath) {
  return existsSync(resolve(ROOT, relPath));
}

// ── Component existence and structure tests ──

describe('DateRangePicker component', () => {
  it('DateRangePicker.jsx exists and exports default component', () => {
    const path = resolve(SRC, 'components', 'DateRangePicker.jsx');
    assert.ok(existsSync(path), 'DateRangePicker.jsx should exist');
    const content = readFileSync(path, 'utf-8');
    assert.ok(
      content.includes('export default function DateRangePicker'),
      'should export default function DateRangePicker',
    );
  });

  it('DateRangePicker uses i18n via useTranslation', () => {
    const content = readText('src/components/DateRangePicker.jsx');
    assert.ok(content.includes('useTranslation'), 'should import useTranslation');
    assert.ok(content.includes("t('historicalQueries."), 'should use t() with historicalQueries namespace');
  });

  it('DateRangePicker has from/to date inputs with validation', () => {
    const content = readText('src/components/DateRangePicker.jsx');
    assert.ok(content.includes('type="date"'), 'should have date input fields');
    assert.ok(content.includes('fromDate'), 'should track from date state');
    assert.ok(content.includes('toDate'), 'should track to date state');
    assert.ok(content.includes('validate'), 'should have validation function');
    assert.ok(content.includes('errorFromRequired'), 'should validate required from');
    assert.ok(content.includes('errorFromAfterTo'), 'should validate from <= to');
  });

  it('DateRangePicker has quick presets (24h, 7d, 30d)', () => {
    const content = readText('src/components/DateRangePicker.jsx');
    assert.ok(content.includes('presets24h'), 'should have 24h preset');
    assert.ok(content.includes('presets7d'), 'should have 7d preset');
    assert.ok(content.includes('presets30d'), 'should have 30d preset');
  });

  it('DateRangePicker imports required lucide icons', () => {
    const content = readText('src/components/DateRangePicker.jsx');
    assert.ok(content.includes('Calendar'), 'should import Calendar icon');
    assert.ok(content.includes('X'), 'should import X icon');
    assert.ok(content.includes('lucide-react'), 'should import from lucide-react');
  });

  it('DateRangePicker has cancel and apply actions', () => {
    const content = readText('src/components/DateRangePicker.jsx');
    assert.ok(content.includes('onApply'), 'should call onApply prop');
    assert.ok(content.includes('onCancel'), 'should call onCancel prop');
  });
});

describe('TimeTravelScrubber component', () => {
  it('TimeTravelScrubber.jsx exists and exports default component', () => {
    const path = resolve(SRC, 'components', 'TimeTravelScrubber.jsx');
    assert.ok(existsSync(path), 'TimeTravelScrubber.jsx should exist');
    const content = readFileSync(path, 'utf-8');
    assert.ok(
      content.includes('export default function TimeTravelScrubber'),
      'should export default function TimeTravelScrubber',
    );
  });

  it('TimeTravelScrubber uses i18n', () => {
    const content = readText('src/components/TimeTravelScrubber.jsx');
    assert.ok(content.includes('useTranslation'), 'should import useTranslation');
    assert.ok(content.includes("t('historicalQueries."), 'should use t() with historicalQueries namespace');
  });

  it('TimeTravelScrubber has range slider input', () => {
    const content = readText('src/components/TimeTravelScrubber.jsx');
    assert.ok(content.includes('type="range"'), 'should have range slider');
    assert.ok(content.includes('onScrub'), 'should accept onScrub callback');
  });

  it('TimeTravelScrubber has play/pause controls', () => {
    const content = readText('src/components/TimeTravelScrubber.jsx');
    assert.ok(content.includes('Play'), 'should import Play icon');
    assert.ok(content.includes('Pause'), 'should import Pause icon');
    assert.ok(content.includes('playing'), 'should track playing state');
  });

  it('TimeTravelScrubber has step and jump controls', () => {
    const content = readText('src/components/TimeTravelScrubber.jsx');
    assert.ok(content.includes('SkipBack'), 'should import SkipBack icon');
    assert.ok(content.includes('SkipForward'), 'should import SkipForward icon');
    assert.ok(content.includes('handleStepBack'), 'should have step back handler');
    assert.ok(content.includes('handleJumpEnd'), 'should have jump end handler');
  });

  it('TimeTravelScrubber shows empty state when no timestamps', () => {
    const content = readText('src/components/TimeTravelScrubber.jsx');
    assert.ok(content.includes('noSnapshots'), 'should show no snapshots message');
  });
});

describe('HistoricalQueriesPanel component', () => {
  it('HistoricalQueriesPanel.jsx exists and exports default component', () => {
    const path = resolve(SRC, 'components', 'HistoricalQueriesPanel.jsx');
    assert.ok(existsSync(path), 'HistoricalQueriesPanel.jsx should exist');
    const content = readFileSync(path, 'utf-8');
    assert.ok(
      content.includes('export default function HistoricalQueriesPanel'),
      'should export default function HistoricalQueriesPanel',
    );
  });

  it('HistoricalQueriesPanel has three mode tabs', () => {
    const content = readText('src/components/HistoricalQueriesPanel.jsx');
    assert.ok(content.includes('singleRange'), 'should have single range tab');
    assert.ok(content.includes('compareMode'), 'should have compare mode tab');
    assert.ok(content.includes('timeTravelMode'), 'should have time travel tab');
  });

  it('HistoricalQueriesPanel uses newsStore historical methods', () => {
    const content = readText('src/components/HistoricalQueriesPanel.jsx');
    assert.ok(content.includes('loadHistoricalState'), 'should use loadHistoricalState');
    assert.ok(content.includes('loadComparisonPeriods'), 'should use loadComparisonPeriods');
    assert.ok(content.includes('setComparisonMode'), 'should use setComparisonMode');
    assert.ok(content.includes('exitHistoricalMode'), 'should use exitHistoricalMode');
  });

  it('HistoricalQueriesPanel has overlay/side-by-side comparison toggles', () => {
    const content = readText('src/components/HistoricalQueriesPanel.jsx');
    assert.ok(content.includes("'overlay'"), 'should support overlay mode');
    assert.ok(content.includes("'side-by-side'"), 'should support side-by-side mode');
    assert.ok(content.includes('Layers'), 'should import Layers icon');
    assert.ok(content.includes('Columns2'), 'should import Columns2 icon');
  });
});

describe('HistoricalQueriesPage', () => {
  it('HistoricalQueriesPage.jsx exists and exports default', () => {
    const path = resolve(SRC, 'pages', 'HistoricalQueriesPage.jsx');
    assert.ok(existsSync(path), 'HistoricalQueriesPage.jsx should exist');
    const content = readFileSync(path, 'utf-8');
    assert.ok(
      content.includes('export default function HistoricalQueriesPage'),
      'should export default function HistoricalQueriesPage',
    );
  });

  it('HistoricalQueriesPage includes HistoricalQueriesPanel', () => {
    const content = readText('src/pages/HistoricalQueriesPage.jsx');
    assert.ok(content.includes('HistoricalQueriesPanel'), 'should render HistoricalQueriesPanel');
  });

  it('HistoricalQueriesPage has back navigation', () => {
    const content = readText('src/pages/HistoricalQueriesPage.jsx');
    assert.ok(content.includes('ArrowLeft'), 'should have back button');
    assert.ok(content.includes('navigate(-1)'), 'should navigate back');
  });
});

// ── Route registration ──

describe('Route registration', () => {
  it('/historical route is registered in main.jsx', () => {
    const content = readText('src/main.jsx');
    assert.ok(content.includes('HistoricalQueriesPage'), 'should import HistoricalQueriesPage');
    assert.ok(content.includes('/historical'), 'should have /historical route');
    assert.ok(content.includes('lazy(() => import'), 'should use lazy loading');
  });
});

// ── i18n coverage ──

describe('i18n coverage', () => {
  const HISTORICAL_KEYS = [
    'title', 'pageTitle', 'singleRange', 'compareMode', 'timeTravelMode',
    'timeTravel', 'dateRangeTitle', 'presets24h', 'presets7d', 'presets30d',
    'fromLabel', 'toLabel', 'apply', 'cancel', 'loading',
    'period1', 'period2', 'displayMode', 'overlay', 'sideBySide',
    'viewingRange', 'returnToLive', 'snapshotNOfM', 'noSnapshots',
    'play', 'pause', 'stepBack', 'stepForward', 'jumpStart', 'jumpEnd',
    'errorFromRequired', 'errorToRequired', 'errorFromFuture', 'errorFromAfterTo',
  ];

  const locales = ['en', 'es', 'fr', 'ar', 'zh'];

  for (const locale of locales) {
    it(`all historicalQueries keys exist in ${locale}.json`, () => {
      const raw = readText(`src/i18n/locales/${locale}.json`);
      const parsed = JSON.parse(raw);

      assert.ok(parsed.historicalQueries, `${locale}: historicalQueries namespace should exist`);
      assert.equal(
        typeof parsed.historicalQueries,
        'object',
        `${locale}: historicalQueries should be an object`,
      );

      for (const key of HISTORICAL_KEYS) {
        assert.ok(
          key in parsed.historicalQueries,
          `${locale}: should have historicalQueries.${key}`,
        );
        assert.ok(
          typeof parsed.historicalQueries[key] === 'string' && parsed.historicalQueries[key].length > 0,
          `${locale}: historicalQueries.${key} should be non-empty string`,
        );
      }
    });
  }
});

// ── newsStore historical state methods ──

describe('newsStore historical state', () => {
  it('newsStore has historical state fields', () => {
    const content = readText('src/stores/newsStore.ts');
    assert.ok(content.includes('historicalState'), 'should have historicalState field');
    assert.ok(content.includes('comparisonMode'), 'should have comparisonMode field');
    assert.ok(content.includes('comparisonPeriods'), 'should have comparisonPeriods field');
    assert.ok(content.includes('isTimeTravel'), 'should have isTimeTravel field');
    assert.ok(content.includes('availableTimestamps'), 'should have availableTimestamps field');
  });

  it('newsStore has historical action methods', () => {
    const content = readText('src/stores/newsStore.ts');
    assert.ok(content.includes('loadAvailableTimestamps'), 'should have loadAvailableTimestamps');
    assert.ok(content.includes('loadHistoricalState'), 'should have loadHistoricalState');
    assert.ok(content.includes('loadComparisonPeriods'), 'should have loadComparisonPeriods');
    assert.ok(content.includes('setComparisonMode'), 'should have setComparisonMode');
    assert.ok(content.includes('setTimeTravel'), 'should have setTimeTravel');
    assert.ok(content.includes('exitHistoricalMode'), 'should have exitHistoricalMode');
  });

  it('exitHistoricalMode resets all historical state', () => {
    const content = readText('src/stores/newsStore.ts');
    // Find exitHistoricalMode and verify it nullifies all fields
    const match = content.match(/exitHistoricalMode[^{]*\{[^}]*\}/);
    assert.ok(match, 'should find exitHistoricalMode implementation');
    const impl = match[0];
    assert.ok(impl.includes('historicalState: null'), 'should null historicalState');
    assert.ok(impl.includes('comparisonMode: null'), 'should null comparisonMode');
    assert.ok(impl.includes('comparisonPeriods: null'), 'should null comparisonPeriods');
    assert.ok(impl.includes('isTimeTravel: false'), 'should set isTimeTravel to false');
  });
});

// ── Backend API endpoints ──

describe('Backend API endpoints', () => {
  it('snapshot history endpoints are registered in server/index.js', () => {
    const content = readText('server/index.js');
    assert.ok(
      content.includes('/api/snapshot-history'),
      'should have /api/snapshot-history endpoint',
    );
    assert.ok(
      content.includes('/api/snapshot-history/timestamps'),
      'should have /api/snapshot-history/timestamps endpoint',
    );
  });

  it('server imports snapshot history storage functions', () => {
    const content = readText('server/index.js');
    assert.ok(content.includes('readSnapshotHistory'), 'should import readSnapshotHistory');
    assert.ok(content.includes('readSnapshotTimestamps'), 'should import readSnapshotTimestamps');
  });
});

// ── Backend storage functions ──

describe('Backend storage', () => {
  it('snapshot_history table is defined in storage.js schema', () => {
    const content = readText('server/storage.js');
    assert.ok(
      content.includes('CREATE TABLE IF NOT EXISTS snapshot_history'),
      'should create snapshot_history table',
    );
  });

  it('readSnapshotHistory function accepts from/to/limit params', () => {
    const content = readText('server/storage.js');
    assert.ok(
      content.includes('export async function readSnapshotHistory'),
      'should export readSnapshotHistory',
    );
  });

  it('readSnapshotTimestamps function exists', () => {
    const content = readText('server/storage.js');
    assert.ok(
      content.includes('export async function readSnapshotTimestamps'),
      'should export readSnapshotTimestamps',
    );
  });

  it('persistSnapshotHistory function exists', () => {
    const content = readText('server/storage.js');
    assert.ok(
      content.includes('export async function persistSnapshotHistory'),
      'should export persistSnapshotHistory',
    );
  });
});

// ── Persist pipeline integration ──

describe('Persist pipeline integration', () => {
  it('persistData.js imports persistSnapshotHistory', () => {
    const content = readText('server/pipeline/persistData.js');
    assert.ok(
      content.includes('persistSnapshotHistory'),
      'should import persistSnapshotHistory from storage',
    );
  });

  it('persistSnapshot calls persistSnapshotHistory', () => {
    const content = readText('server/pipeline/persistData.js');
    const fnMatch = content.match(/export async function persistSnapshot[^{]*\{[\s\S]*?\n\}/);
    assert.ok(fnMatch, 'should find persistSnapshot function');
    const impl = fnMatch[0];
    assert.ok(
      impl.includes('persistSnapshotHistory'),
      'persistSnapshot should call persistSnapshotHistory',
    );
  });
});

// ── Backend service fetch functions ──

describe('Backend service', () => {
  it('backendService exports fetchSnapshotHistory', () => {
    const content = readText('src/services/backendService.js');
    assert.ok(
      content.includes('export function fetchSnapshotHistory'),
      'should export fetchSnapshotHistory',
    );
  });

  it('backendService exports fetchSnapshotTimestamps', () => {
    const content = readText('src/services/backendService.js');
    assert.ok(
      content.includes('export function fetchSnapshotTimestamps'),
      'should export fetchSnapshotTimestamps',
    );
  });

  it('fetchSnapshotHistory constructs correct API URL', () => {
    const content = readText('src/services/backendService.js');
    const fnMatch = content.match(/export function fetchSnapshotHistory[^{]*\{[\s\S]*?\n\}/);
    assert.ok(fnMatch, 'should find fetchSnapshotHistory function');
    const impl = fnMatch[0];
    assert.ok(
      impl.includes('/snapshot-history'),
      'should call /snapshot-history endpoint',
    );
    assert.ok(
      impl.includes('from') && impl.includes('to'),
      'should pass from and to params',
    );
  });
});

// ── CSS styling coverage ──

describe('CSS styling', () => {
  it('DateRangePicker has MAPR-themed CSS', () => {
    const content = readText('src/components/DateRangePicker.jsx');
    assert.ok(content.includes('--bg-1'), 'should use MAPR CSS variable');
    assert.ok(content.includes('--amber'), 'should use amber accent');
    assert.ok(content.includes('--border'), 'should use border variable');
  });

  it('TimeTravelScrubber has MAPR-themed CSS', () => {
    const content = readText('src/components/TimeTravelScrubber.jsx');
    assert.ok(content.includes('--bg-1'), 'should use MAPR CSS variable');
    assert.ok(content.includes('--amber'), 'should use amber accent');
    assert.ok(content.includes('::-webkit-slider-thumb'), 'should style range slider thumb');
  });

  it('HistoricalQueriesPanel has tab styling', () => {
    const content = readText('src/components/HistoricalQueriesPanel.jsx');
    assert.ok(content.includes('mapr-historical-tab'), 'should have tab class');
    assert.ok(content.includes('.active'), 'should have active state style');
  });
});
