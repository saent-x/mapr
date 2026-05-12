/**
 * Data Freshness Indicator Tests — VAL-M3-025 through VAL-M3-030
 *
 * Covers:
 *   VAL-M3-025: Visual freshness indicator shows data age
 *   VAL-M3-026: Color-coded freshness — green (<5m)
 *   VAL-M3-027: Color-coded freshness — amber (5-15m)
 *   VAL-M3-028: Color-coded freshness — red (>15m)
 *   VAL-M3-029: Freshness updates in real time (interval-driven)
 *   VAL-M3-030: Freshness tooltip on refresh button
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'src');

function read(p) {
  return readFileSync(path.join(root, p), 'utf-8');
}

// ═══════════════════════════════════════════
// VAL-M3-025: Visual freshness indicator shows data age
// ═══════════════════════════════════════════

test('VAL-M3-025: useDataFreshness hook exists', () => {
  const f = path.join(SRC, 'hooks', 'useDataFreshness.js');
  assert.ok(existsSync(f), 'src/hooks/useDataFreshness.js must exist');
});

test('VAL-M3-025: dataFreshness utility exports formatAge and getFreshnessColor', () => {
  const src = read('src/utils/dataFreshness.js');
  assert.match(src, /export\s+function\s+formatAge/, 'must export formatAge');
  assert.match(src, /export\s+function\s+getFreshnessColor/, 'must export getFreshnessColor');
});

test('VAL-M3-025: useDataFreshness hook re-exports from utils', () => {
  const src = read('src/hooks/useDataFreshness.js');
  assert.match(src, /import.*formatAge.*getFreshnessColor.*from.*dataFreshness/, 'hook must import from utils');
  assert.match(src, /export.*formatAge.*getFreshnessColor/, 'hook must re-export from utils');
});

test('VAL-M3-025: formatAge returns correct units', async () => {
  const { formatAge } = await import(path.join(root, 'src', 'utils', 'dataFreshness.js'));

  // seconds
  assert.deepStrictEqual(formatAge(0), { value: 1, unit: 's' });
  assert.deepStrictEqual(formatAge(30_000), { value: 30, unit: 's' });
  assert.deepStrictEqual(formatAge(59_000), { value: 59, unit: 's' });

  // minutes
  assert.deepStrictEqual(formatAge(60_000), { value: 1, unit: 'm' });
  assert.deepStrictEqual(formatAge(120_000), { value: 2, unit: 'm' });
  assert.deepStrictEqual(formatAge(3_599_000), { value: 59, unit: 'm' });

  // hours
  assert.deepStrictEqual(formatAge(3_600_000), { value: 1, unit: 'h' });
  assert.deepStrictEqual(formatAge(7_200_000), { value: 2, unit: 'h' });

  // days
  assert.deepStrictEqual(formatAge(86_400_000), { value: 1, unit: 'd' });
  assert.deepStrictEqual(formatAge(172_800_000), { value: 2, unit: 'd' });
});

test('VAL-M3-025: formatAge rounds seconds down but minimum 1', async () => {
  const { formatAge } = await import(path.join(root, 'src', 'utils', 'dataFreshness.js'));

  const s = formatAge(500);
  assert.strictEqual(s.unit, 's');
  assert.ok(s.value >= 1 && s.value <= 1, '500ms should round to 1s');
});

// ═══════════════════════════════════════════
// VAL-M3-026: Color-coded freshness — green (<5m)
// ═══════════════════════════════════════════

test('VAL-M3-026: getFreshnessColor returns green for age < 5 minutes', async () => {
  const { getFreshnessColor, GREEN_THRESHOLD } = await import(path.join(root, 'src', 'utils', 'dataFreshness.js'));

  assert.strictEqual(getFreshnessColor(0), 'green', '0ms should be green');
  assert.strictEqual(getFreshnessColor(60_000), 'green', '1m should be green');
  assert.strictEqual(getFreshnessColor(4 * 60_000), 'green', '4m should be green');
  assert.strictEqual(getFreshnessColor(GREEN_THRESHOLD - 1), 'green', 'just below 5m should be green');
  assert.strictEqual(GREEN_THRESHOLD, 5 * 60 * 1000, 'GREEN_THRESHOLD should be 5 minutes in ms');
});

// ═══════════════════════════════════════════
// VAL-M3-027: Color-coded freshness — amber (5-15m)
// ═══════════════════════════════════════════

test('VAL-M3-027: getFreshnessColor returns amber for age 5-15 minutes', async () => {
  const { getFreshnessColor, GREEN_THRESHOLD, AMBER_THRESHOLD } = await import(path.join(root, 'src', 'utils', 'dataFreshness.js'));

  assert.strictEqual(getFreshnessColor(GREEN_THRESHOLD), 'amber', 'exactly 5m should be amber');
  assert.strictEqual(getFreshnessColor(6 * 60_000), 'amber', '6m should be amber');
  assert.strictEqual(getFreshnessColor(10 * 60_000), 'amber', '10m should be amber');
  assert.strictEqual(getFreshnessColor(14 * 60_000), 'amber', '14m should be amber');
  assert.strictEqual(getFreshnessColor(AMBER_THRESHOLD - 1), 'amber', 'just below 15m should be amber');
  assert.strictEqual(AMBER_THRESHOLD, 15 * 60 * 1000, 'AMBER_THRESHOLD should be 15 minutes in ms');
});

// ═══════════════════════════════════════════
// VAL-M3-028: Color-coded freshness — red (>15m)
// ═══════════════════════════════════════════

test('VAL-M3-028: getFreshnessColor returns red for age > 15 minutes', async () => {
  const { getFreshnessColor, AMBER_THRESHOLD } = await import(path.join(root, 'src', 'utils', 'dataFreshness.js'));

  assert.strictEqual(getFreshnessColor(AMBER_THRESHOLD), 'red', 'exactly 15m should be red');
  assert.strictEqual(getFreshnessColor(16 * 60_000), 'red', '16m should be red');
  assert.strictEqual(getFreshnessColor(60 * 60_000), 'red', '1h should be red');
  assert.strictEqual(getFreshnessColor(24 * 60 * 60_000), 'red', '24h should be red');
});

// ═══════════════════════════════════════════
// VAL-M3-029: Freshness updates in real time (interval-driven)
// ═══════════════════════════════════════════

test('VAL-M3-029: useDataFreshness uses setInterval for real-time updates', () => {
  const src = read('src/hooks/useDataFreshness.js');
  assert.match(src, /setInterval/, 'hook must use setInterval for real-time updates');
  assert.match(src, /clearInterval/, 'hook must clean up with clearInterval');
  assert.match(src, /1000/, 'update interval should be every second');
});

test('VAL-M3-029: Layout imports useDataFreshness for real-time display', () => {
  const src = read('src/components/Layout.jsx');
  assert.match(src, /import\s+useDataFreshness/, 'Layout must import useDataFreshness');
});

// ═══════════════════════════════════════════
// VAL-M3-030: Freshness tooltip on refresh button
// ═══════════════════════════════════════════

test('VAL-M3-030: Header has refresh button with RefreshCw icon', () => {
  const src = read('src/components/Header.jsx');
  assert.match(src, /RefreshCw/, 'Header must import RefreshCw');
  assert.match(src, /header-refresh-btn/, 'Header must have a refresh button');
  assert.match(src, /handleRefreshClick/, 'Header must have refresh click handler');
});

test('VAL-M3-030: Header refresh button has tooltip with freshness classes', () => {
  const src = read('src/components/Header.jsx');
  assert.match(src, /header-refresh-tooltip/, 'Header must have refresh tooltip');
  assert.match(src, /freshness-\$\{ageColor\}/, 'Tooltip must use color class from freshness');
  assert.match(src, /freshness-dot/, 'Tooltip must include freshness dot indicator');
});

test('VAL-M3-030: Header imports useDataFreshness for tooltip', () => {
  const src = read('src/components/Header.jsx');
  assert.match(src, /import\s+useDataFreshness/, 'Header must import useDataFreshness');
  assert.match(src, /useDataFreshness\(\)/, 'Header must call useDataFreshness hook');
});

// ═══════════════════════════════════════════
// Store integration: lastDataLoadTime
// ═══════════════════════════════════════════

test('newsStore has lastDataLoadTime in initial state', () => {
  const src = read('src/stores/newsStore.ts');
  assert.match(src, /lastDataLoadTime:\s*null/, 'newsStore initial state must have lastDataLoadTime: null');
});

test('newsStore sets lastDataLoadTime in loadLiveData', () => {
  const src = read('src/stores/newsStore.ts');
  const matches = src.match(/lastDataLoadTime:\s*(?:serverFetchedAt|Date\.now\(\))/g);
  assert.ok(matches && matches.length >= 2, 'lastDataLoadTime must be set from server ingest time for backend data and client time for client_gdelt');
});

// ═══════════════════════════════════════════
// CSS styles for freshness indicator
// ═══════════════════════════════════════════

test('CSS has status-freshness class', () => {
  const src = read('src/index.css');
  assert.match(src, /\.status-freshness/, 'index.css must have .status-freshness styles');
});

test('CSS has freshness color classes', () => {
  const src = read('src/index.css');
  assert.match(src, /\.freshness-green/, 'index.css must have .freshness-green');
  assert.match(src, /\.freshness-amber/, 'index.css must have .freshness-amber');
  assert.match(src, /\.freshness-red/, 'index.css must have .freshness-red');
});

test('CSS has header refresh button styles', () => {
  const src = read('src/index.css');
  assert.match(src, /\.header-refresh-btn/, 'index.css must have .header-refresh-btn');
  assert.match(src, /\.header-refresh-tooltip/, 'index.css must have .header-refresh-tooltip');
  assert.match(src, /\.is-spinning/, 'index.css must have spinning animation');
});

// ═══════════════════════════════════════════
// i18n keys
// ═══════════════════════════════════════════

test('All 5 locale files have freshness keys', () => {
  const locales = ['en', 'es', 'fr', 'ar', 'zh'];
  const requiredKeys = ['secondsAgo', 'minutesAgo', 'hoursAgo', 'daysAgo'];

  for (const lang of locales) {
    const json = JSON.parse(read(`src/i18n/locales/${lang}.json`));
    assert.ok(json.freshness, `${lang}.json must have "freshness" section`);

    for (const key of requiredKeys) {
      assert.ok(
        json.freshness[key] && json.freshness[key].length > 0,
        `${lang}.json freshness.${key} must be non-empty`,
      );
      assert.match(
        json.freshness[key],
        /\{\{value\}\}/,
        `${lang}.json freshness.${key} must contain {{value}} placeholder`,
      );
    }
  }
});

// ═══════════════════════════════════════════
// Color threshold boundary tests
// ═══════════════════════════════════════════

test('Color thresholds are consistent', async () => {
  const { getFreshnessColor, GREEN_THRESHOLD, AMBER_THRESHOLD } = await import(
    path.join(root, 'src', 'utils', 'dataFreshness.js')
  );

  // Verify thresholds are properly ordered
  assert.ok(GREEN_THRESHOLD > 0, 'GREEN_THRESHOLD must be positive');
  assert.ok(AMBER_THRESHOLD > GREEN_THRESHOLD, 'AMBER_THRESHOLD must be larger than GREEN_THRESHOLD');

  // Test boundary transitions
  assert.strictEqual(getFreshnessColor(GREEN_THRESHOLD - 1), 'green');
  assert.strictEqual(getFreshnessColor(GREEN_THRESHOLD), 'amber');
  assert.strictEqual(getFreshnessColor(AMBER_THRESHOLD - 1), 'amber');
  assert.strictEqual(getFreshnessColor(AMBER_THRESHOLD), 'red');

  // Verify exact millisecond values
  assert.strictEqual(GREEN_THRESHOLD, 300_000, '5 minutes = 300,000ms');
  assert.strictEqual(AMBER_THRESHOLD, 900_000, '15 minutes = 900,000ms');
});
